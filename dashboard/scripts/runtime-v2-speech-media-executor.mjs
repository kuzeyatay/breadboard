import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROTOCOL_VERSION = 1;
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_SOURCE_DURATION_SECONDS = 4 * 60 * 60;
const METADATA_TIMEOUT_MS = 90_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const MEDIA_TIMEOUT_MS = 2 * 60 * 60_000;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 400 * 1024;
const MAX_PROGRESS_LINE_BYTES = 32 * 1024;
const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg", "wmv",
]);
const ASPECTS = new Set(["original", "16:9", "9:16", "1:1", "4:5"]);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function boundedText(value, maximumBytes, { empty = false } = {}) {
  return typeof value === "string" &&
    (empty || value.length > 0) &&
    value.trim() === value &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value);
}

function runtimeRelativePath(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 32 * 1024 &&
    !value.includes("\\") &&
    value.split("/").length >= 2 &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..") &&
    !/\p{Cc}/u.test(value);
}

function validateSource(value) {
  if (
    !exactRecord(value, ["canonicalUrl", "label"]) ||
    !boundedText(value.canonicalUrl, 8 * 1024) ||
    !boundedText(value.label, 512)
  ) fail("The canonical video source is invalid.");
  let parsed;
  try {
    parsed = new URL(value.canonicalUrl);
  } catch {
    fail("The canonical video source URL is invalid.");
  }
  if (
    !new Set(["http:", "https:"]).has(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname
  ) fail("The canonical video source URL is not fetchable.");
  return value;
}

function validateProgram(value) {
  if (!exactRecord(value, ["ranges", "grade", "aspect", "subtitles", "transform"])) {
    fail("The canonical Video Use program is invalid.");
  }
  if (!Array.isArray(value.ranges) || value.ranges.length < 1 || value.ranges.length > 120) {
    fail("The canonical Video Use ranges are invalid.");
  }
  for (const range of value.ranges) {
    if (
      !exactRecord(range, ["start", "end", "reason"]) ||
      !Number.isFinite(range.start) ||
      !Number.isFinite(range.end) ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end > 24 * 60 * 60 ||
      typeof range.reason !== "string" ||
      Buffer.byteLength(range.reason, "utf8") > 2 * 1024 ||
      /\u0000/u.test(range.reason)
    ) fail("The canonical Video Use range is invalid.");
  }
  if (
    (value.grade !== null &&
      (typeof value.grade !== "string" ||
        !value.grade.trim() ||
        value.grade !== value.grade.trim() ||
        Buffer.byteLength(value.grade, "utf8") > 2_000 ||
        /\p{Cc}/u.test(value.grade))) ||
    !ASPECTS.has(value.aspect) ||
    !new Set(["none", "burn"]).has(value.subtitles) ||
    !exactRecord(value.transform, [
      "speed", "mute", "volumeDb", "fadeInSeconds", "fadeOutSeconds", "reverse",
    ]) ||
    !Number.isFinite(value.transform.speed) ||
    value.transform.speed < 0.25 ||
    value.transform.speed > 4 ||
    typeof value.transform.mute !== "boolean" ||
    !Number.isFinite(value.transform.volumeDb) ||
    value.transform.volumeDb < -30 ||
    value.transform.volumeDb > 20 ||
    !Number.isFinite(value.transform.fadeInSeconds) ||
    value.transform.fadeInSeconds < 0 ||
    value.transform.fadeInSeconds > 10 ||
    !Number.isFinite(value.transform.fadeOutSeconds) ||
    value.transform.fadeOutSeconds < 0 ||
    value.transform.fadeOutSeconds > 10 ||
    typeof value.transform.reverse !== "boolean"
  ) fail("The canonical Video Use program options are invalid.");
  return value;
}

export const SPEECH_MEDIA_OPERATIONS = Object.freeze([
  "speech-mp3",
  "recording-segments",
  "video-source-inspect",
  "video-source-download",
  "video-probe",
  "video-silences",
  "video-extract-audio",
  "video-pack-transcript",
  "video-render",
  "video-visual-qc",
]);

export function validateSpeechMediaRequest(value) {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION) {
    fail("The speech/media request is invalid.");
  }
  switch (value.operation) {
    case "speech-mp3":
    case "recording-segments":
    case "video-visual-qc":
      if (!exactRecord(value, ["protocolVersion", "operation"])) {
        fail("The speech/media request shape is invalid.");
      }
      break;
    case "video-source-inspect":
    case "video-source-download":
      if (!exactRecord(value, ["protocolVersion", "operation", "source"])) {
        fail("The video-source request shape is invalid.");
      }
      validateSource(value.source);
      break;
    case "video-probe":
    case "video-extract-audio":
      if (
        !exactRecord(value, ["protocolVersion", "operation", "fileRelativePath"]) ||
        !runtimeRelativePath(value.fileRelativePath)
      ) fail("The Video Use file request is invalid.");
      break;
    case "video-silences":
      if (
        !exactRecord(value, [
          "protocolVersion", "operation", "fileRelativePath", "thresholdDb", "minimumSeconds",
        ]) ||
        !runtimeRelativePath(value.fileRelativePath) ||
        !Number.isFinite(value.thresholdDb) ||
        value.thresholdDb < -100 ||
        value.thresholdDb > 0 ||
        !Number.isFinite(value.minimumSeconds) ||
        value.minimumSeconds < 0.05 ||
        value.minimumSeconds > 60
      ) fail("The Video Use silence request is invalid.");
      break;
    case "video-pack-transcript":
      if (
        !exactRecord(value, ["protocolVersion", "operation", "sessionRootRelativePath"]) ||
        !runtimeRelativePath(value.sessionRootRelativePath)
      ) fail("The Video Use transcript-pack request is invalid.");
      break;
    case "video-render":
      if (
        !exactRecord(value, [
          "protocolVersion", "operation", "sessionRootRelativePath", "program", "quality",
        ]) ||
        !runtimeRelativePath(value.sessionRootRelativePath) ||
        !new Set(["final", "preview"]).has(value.quality)
      ) fail("The Video Use render request is invalid.");
      validateProgram(value.program);
      break;
    default:
      fail("The speech/media operation is unavailable.");
  }
  return value;
}

export function expectedSpeechMediaInputCount(request) {
  return new Set(["speech-mp3", "recording-segments"]).has(request.operation) ? 1 : 0;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function directFile(filePath, label) {
  const resolved = path.resolve(filePath);
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`${label} is unavailable.`);
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) fail(`${label} is indirect.`);
  return canonical;
}

function directDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail(`${label} is unavailable.`);
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) fail(`${label} is indirect.`);
  return canonical;
}

function ensureDirectDirectory(directory, label) {
  try {
    fs.mkdirSync(directory);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return directDirectory(directory, label);
}

function resolveDataPath(dataRoot, relativePath) {
  if (!runtimeRelativePath(relativePath)) fail("The Runtime media path is invalid.");
  const resolved = path.resolve(dataRoot, ...relativePath.split("/"));
  if (!pathWithin(dataRoot, resolved)) fail("The Runtime media path escaped its data root.");
  return resolved;
}

function relativeDataPath(dataRoot, absolutePath) {
  const relative = path.relative(path.resolve(dataRoot), path.resolve(absolutePath));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) fail("The Runtime media output escaped its data root.");
  return relative.split(path.sep).join("/");
}

function videoUseFile(context, relativePath) {
  const resolved = directFile(resolveDataPath(context.dataRoot, relativePath), "The Video Use input");
  const segments = relativePath.split("/");
  const marker = segments.lastIndexOf("video-use");
  if (
    marker < 0 ||
    segments[marker + 1] !== String(context.executionScope.userId) ||
    !/^art_[a-z0-9-]{6,64}$/iu.test(segments[marker + 2] ?? "")
  ) fail("The Video Use input is outside the authenticated user's session.");
  return resolved;
}

function videoSession(context, relativeRoot) {
  const root = directDirectory(
    resolveDataPath(context.dataRoot, relativeRoot),
    "The Video Use session",
  );
  const segments = relativeRoot.split("/");
  const marker = segments.lastIndexOf("video-use");
  if (
    marker < 0 ||
    segments.length !== marker + 3 ||
    segments[marker + 1] !== String(context.executionScope.userId) ||
    !/^art_[a-z0-9-]{6,64}$/iu.test(segments[marker + 2] ?? "")
  ) fail("The Video Use session is outside the authenticated user's scope.");
  const sourceDirectory = directDirectory(path.join(root, "source"), "The Video Use source directory");
  const sourceNames = fs.readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^source\.[a-z0-9]{1,8}$/iu.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (sourceNames.length !== 1) fail("The Video Use session has no unique source.");
  const sourcePath = directFile(path.join(sourceDirectory, sourceNames[0]), "The Video Use source");
  const editDir = ensureDirectDirectory(path.join(root, "edit"), "The Video Use edit directory");
  const transcriptsDir = ensureDirectDirectory(
    path.join(editDir, "transcripts"),
    "The Video Use transcript directory",
  );
  return {
    artifactId: segments[marker + 2],
    root,
    sourcePath,
    editDir,
    transcriptsDir,
    transcriptPath: path.join(transcriptsDir, "source.json"),
    packedTranscriptPath: path.join(editDir, "takes_packed.md"),
    edlPath: path.join(editDir, "edl.json"),
    outputPath: path.join(editDir, "final.mp4"),
  };
}

function runtimeTool(env, name) {
  const key = `BREADBOARD_RUNTIME_V2_MEDIA_${name.toUpperCase()}_PATH`;
  const configured = env[key]?.trim();
  if (!configured || !path.isAbsolute(configured) || /[\u0000\r\n]/u.test(configured)) return null;
  try {
    return directFile(configured, `The Runtime-owned ${name} executable`);
  } catch {
    return null;
  }
}

function videoUseRoot(env) {
  const configured = env.BREADBOARD_RUNTIME_V2_MEDIA_VIDEO_USE_ROOT?.trim();
  if (!configured || !path.isAbsolute(configured) || /[\u0000\r\n]/u.test(configured)) return null;
  try {
    const root = directDirectory(configured, "The Runtime-owned Video Use root");
    for (const helper of ["render.py", "grade.py", "pack_transcripts.py"]) {
      directFile(path.join(root, "helpers", helper), `The Video Use ${helper} helper`);
    }
    return root;
  } catch {
    return null;
  }
}

function systemRoot(env) {
  const configured = env.SystemRoot ?? env.SYSTEMROOT;
  return configured && path.isAbsolute(configured) && !/[\u0000\r\n]/u.test(configured)
    ? path.resolve(configured)
    : null;
}

export function sealedSpeechMediaEnvironment(env = process.env, tools = {}) {
  const allowed = new Set([
    "ALL_PROXY", "APPDATA", "COMSPEC", "CURL_CA_BUNDLE", "HOME", "HOMEDRIVE",
    "HOMEPATH", "HTTP_PROXY", "HTTPS_PROXY", "LANG", "LC_ALL", "LOCALAPPDATA",
    "NODE_EXTRA_CA_CERTS", "NO_PROXY", "NUMBER_OF_PROCESSORS", "OS", "PATHEXT",
    "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "REQUESTS_CA_BUNDLE",
    "SSL_CERT_DIR", "SSL_CERT_FILE", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP",
    "USERPROFILE", "WINDIR",
  ]);
  const result = Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) => allowed.has(name.toUpperCase()) && value !== undefined,
    ),
  );
  const directories = [tools.ffmpeg, tools.ffprobe, tools.python]
    .filter(Boolean)
    .map((filePath) => path.dirname(filePath));
  result.PATH = [...new Set(directories)].join(path.delimiter);
  result.PYTHONUTF8 = "1";
  result.PYTHONIOENCODING = "utf-8";
  result.PYTHONDONTWRITEBYTECODE = "1";
  result.PYTHONNOUSERSITE = "1";
  result.NO_COLOR = "1";
  return result;
}

async function terminateProcessTree(child, env, terminateImpl) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (terminateImpl) {
    await terminateImpl(child);
    return;
  }
  if (process.platform === "win32") {
    const root = systemRoot(env);
    const taskkill = root ? path.join(root, "System32", "taskkill.exe") : null;
    if (taskkill && fs.existsSync(taskkill)) {
      await new Promise((resolve) => {
        const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
          env: sealedSpeechMediaEnvironment(env),
        });
        killer.once("error", resolve);
        killer.once("close", resolve);
      });
      return;
    }
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall through to the direct child.
    }
  }
  try { child.kill("SIGKILL"); } catch {}
}

function appendBounded(current, chunk, maximumBytes) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  if (current.byteLength >= maximumBytes) return current;
  return Buffer.concat([current, bytes.subarray(0, maximumBytes - current.byteLength)]);
}

function appendTailBounded(current, chunk, maximumBytes) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  const combined = Buffer.concat([current, bytes]);
  return combined.byteLength <= maximumBytes
    ? combined
    : combined.subarray(combined.byteLength - maximumBytes);
}

export function runSpeechMediaProcess(command, args, options = {}) {
  const spawnImpl = options.spawnImpl ?? spawn;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: options.env,
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let lineBuffer = "";
    let timedOut = false;
    let settled = false;
    const emitLines = (chunk) => {
      if (!options.onLine) return;
      lineBuffer = `${lineBuffer}${chunk.toString("utf8")}`;
      for (;;) {
        const newline = lineBuffer.indexOf("\n");
        if (newline < 0) break;
        const line = lineBuffer.slice(0, newline).trim();
        lineBuffer = lineBuffer.slice(newline + 1);
        if (line) options.onLine(line.slice(0, MAX_PROGRESS_LINE_BYTES));
      }
      if (Buffer.byteLength(lineBuffer, "utf8") > MAX_PROGRESS_LINE_BYTES) lineBuffer = "";
    };
    const kill = () => {
      void terminateProcessTree(
        child,
        options.runtimeEnv ?? process.env,
        options.terminateImpl,
      ).catch(() => {
        try { child.kill("SIGKILL"); } catch {}
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs ?? MEDIA_TIMEOUT_MS);
    timer.unref?.();
    const onAbort = () => kill();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk, options.maxStdoutBytes ?? MAX_STDOUT_BYTES);
      emitLines(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendTailBounded(stderr, chunk, options.maxStderrBytes ?? MAX_STDERR_BYTES);
      if (options.linesFromStderr) emitLines(chunk);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (options.signal?.aborted) {
        reject(options.signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      resolve({
        code: code ?? -1,
        signal,
        timedOut,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      });
    });
    if (options.signal?.aborted) onAbort();
  });
}

function publicError(operation, errorCode, message) {
  return { ok: false, operation, errorCode, message };
}

function mediaStage(context) {
  const root = path.join(context.workspacePath, "media-stage");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function writeStageJson(context, name, value) {
  const stage = mediaStage(context);
  const target = path.join(stage, name);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength > 32 * 1024 * 1024) fail("The media analysis output exceeded its bound.");
  fs.writeFileSync(target, bytes, { flag: "wx" });
  return relativeDataPath(context.dataRoot, target);
}

function parseSourceMetadata(raw, source) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return publicError("video-source-inspect", "probe_failed", "That link could not be read as a video.");
  }
  if (!isRecord(parsed) || parsed._type === "playlist" || Array.isArray(parsed.entries)) {
    return publicError("video-source-inspect", "playlist", "That is a playlist. Link one video.");
  }
  if (parsed.is_live === true) {
    return publicError("video-source-inspect", "live", "That is a live stream, which cannot be fetched.");
  }
  const duration = Number(parsed.duration);
  const durationSeconds = Number.isFinite(duration) && duration > 0 ? duration : null;
  if (durationSeconds && durationSeconds > MAX_SOURCE_DURATION_SECONDS) {
    return publicError(
      "video-source-inspect",
      "too_long",
      `That video is ${Math.round(durationSeconds / 3600)} hours long, which is beyond what this fetches.`,
    );
  }
  return {
    ok: true,
    operation: "video-source-inspect",
    metadata: {
      title: typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim().slice(0, 2_000)
        : source.label || "video",
      durationSeconds,
      isLive: false,
      extension: typeof parsed.ext === "string" ? parsed.ext.toLowerCase().slice(0, 16) : "mp4",
    },
  };
}

async function inspectVideoSource(request, context, ytdlp) {
  if (!ytdlp) {
    return publicError(
      request.operation,
      "ytdlp_unavailable",
      "yt-dlp was not found, so linked videos cannot be fetched. Install it or set YTDLP_PATH.",
    );
  }
  let run;
  try {
    run = await runSpeechMediaProcess(
      ytdlp,
      [
        "--ignore-config", "--dump-single-json", "--no-playlist", "--skip-download",
        "--no-warnings", "--", request.source.canonicalUrl,
      ],
      {
        timeoutMs: METADATA_TIMEOUT_MS,
        signal: context.signal,
        env: context.childEnv,
        runtimeEnv: context.env,
        spawnImpl: context.spawnImpl,
        terminateImpl: context.terminateImpl,
      },
    );
  } catch {
    return publicError(request.operation, "probe_failed", "That link could not be read.");
  }
  if (run.timedOut) {
    return publicError(request.operation, "probe_failed", "Reading that link timed out.");
  }
  if (run.code !== 0) {
    return publicError(request.operation, "probe_failed", "That link could not be read as a single video.");
  }
  const parsed = parseSourceMetadata(run.stdout, request.source);
  return parsed.ok ? { ...parsed, operation: request.operation } : { ...parsed, operation: request.operation };
}

function parseVideoProbe(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("The video probe returned invalid JSON.");
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => isRecord(stream) && stream.codec_type === "video");
  const audio = streams.find((stream) => isRecord(stream) && stream.codec_type === "audio");
  if (!video) fail("That file has no video track.");
  const rate = (value) => {
    if (typeof value !== "string") return 0;
    const [topValue, bottomValue = "1"] = value.split("/");
    const top = Number(topValue);
    const bottom = Number(bottomValue);
    return Number.isFinite(top) && Number.isFinite(bottom) && bottom !== 0
      ? Math.round((top / bottom) * 100) / 100
      : 0;
  };
  const width = Number(video.width) || 0;
  const height = Number(video.height) || 0;
  const durationSeconds = Number(parsed.format?.duration) || Number(video.duration) || 0;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    fail("That video reports no duration, so it cannot be cut.");
  }
  return {
    durationSeconds: Math.round(durationSeconds * 1000) / 1000,
    width,
    height,
    fps: rate(video.avg_frame_rate) || rate(video.r_frame_rate) || 0,
    hasAudio: Boolean(audio),
    videoCodec: typeof video.codec_name === "string" ? video.codec_name : null,
    audioCodec: audio && typeof audio.codec_name === "string" ? audio.codec_name : null,
    sizeBytes: Number(parsed.format?.size) || 0,
    portrait: height > width,
  };
}

async function probeVideoFile(filePath, context, ffprobe) {
  if (!ffprobe) fail("No ffprobe was found, so this video cannot be read.");
  const run = await runSpeechMediaProcess(
    ffprobe,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
    {
      timeoutMs: 120_000,
      signal: context.signal,
      env: context.childEnv,
      runtimeEnv: context.env,
      spawnImpl: context.spawnImpl,
      terminateImpl: context.terminateImpl,
    },
  );
  if (run.code !== 0 || run.timedOut) fail("That file could not be read as a video.");
  return parseVideoProbe(run.stdout);
}

function clearRenderOutputs(session) {
  for (const entry of ["clips_graded", "clips_preview", "clips_draft"]) {
    fs.rmSync(path.join(session.editDir, entry), { recursive: true, force: true });
  }
  for (const entry of [
    "base.mp4", "base_preview.mp4", "base_draft.mp4", "concat.txt", "edl.json",
    "master.srt", "final.mp4", "final.prenorm.mp4", "assembled.mp4", "assembled.prenorm.mp4",
  ]) fs.rmSync(path.join(session.editDir, entry), { force: true });
}

function renderStage(line) {
  const extracting = /^extracting (\d+) segment/iu.exec(line);
  if (extracting) return { stage: `Extracting ${extracting[1]} segment${extracting[1] === "1" ? "" : "s"}` };
  const segment = /^\[(\d+)\]\s+\S+\s+([\d.]+)-\s*([\d.]+)/u.exec(line);
  if (segment) {
    return {
      stage: `Segment ${Number(segment[1]) + 1}`,
      detail: `${Number(segment[2]).toFixed(2)}s – ${Number(segment[3]).toFixed(2)}s`,
    };
  }
  if (/^concat/iu.test(line)) return { stage: "Joining segments" };
  if (/^compositing/iu.test(line)) return { stage: "Burning captions" };
  if (/^building master\.srt|^wrote .*\.srt/iu.test(line)) return { stage: "Building captions" };
  if (/^loudness normalization/iu.test(line)) return { stage: "Normalizing loudness" };
  if (/^\s*loudnorm pass 1/iu.test(line)) return { stage: "Measuring loudness" };
  if (/^\s*loudnorm pass 2/iu.test(line)) return { stage: "Normalizing loudness" };
  return null;
}

function identityTransform(transform) {
  return transform.speed === 1 &&
    transform.mute === false &&
    transform.volumeDb === 0 &&
    transform.fadeInSeconds === 0 &&
    transform.fadeOutSeconds === 0 &&
    transform.reverse === false;
}

function atempoChain(speed) {
  const stages = [];
  let remaining = speed;
  while (remaining > 2) { stages.push(2); remaining /= 2; }
  while (remaining < 0.5) { stages.push(0.5); remaining /= 0.5; }
  stages.push(Math.round(remaining * 1000) / 1000);
  return stages.map((stage) => `atempo=${stage}`);
}

async function runRender(request, context, tools) {
  if (!tools.python) return publicError(request.operation, "python_missing", "No Python interpreter was found to run the renderer.");
  if (!tools.ffmpeg) return publicError(request.operation, "ffmpeg_missing", "No ffmpeg was found to finish the edit.");
  if (!tools.ffprobe) return publicError(request.operation, "ffprobe_missing", "No ffprobe was found, so this video cannot be read.");
  if (!tools.videoUseRoot) {
    return publicError(request.operation, "clone_missing", "The video-use clone was not found next to the dashboard.");
  }
  const session = videoSession(context, request.sessionRootRelativePath);
  const filtersLayout = context.sourceLayout?.();
  if (!filtersLayout) fail("The staged Video Use filter contract is unavailable.");
  const filters = await import(pathToFileURL(filtersLayout.filtersPath).href);
  const grade = filters.validateGrade(request.program.grade);
  const composedGrade = filters.composeGrade(request.program.aspect, grade);
  const edl = {
    version: 1,
    sources: { source: session.sourcePath },
    ranges: request.program.ranges.map((range, index) => ({
      source: "source",
      start: range.start,
      end: range.end,
      beat: `SEG${String(index + 1).padStart(2, "0")}`,
      quote: "",
      reason: range.reason,
    })),
    ...(composedGrade ? { grade: composedGrade } : {}),
    ...(request.program.subtitles === "burn" ? { subtitles: "master.srt" } : {}),
    total_duration_s: request.program.ranges.reduce(
      (total, range) => total + (range.end - range.start),
      0,
    ),
  };
  clearRenderOutputs(session);
  fs.writeFileSync(session.edlPath, JSON.stringify(edl, null, 2), { flag: "wx" });
  const assembled = path.join(session.editDir, "assembled.mp4");
  context.checkpoint({ operation: request.operation, stage: "Assembling the cut" });
  const assembledRun = await runSpeechMediaProcess(
    tools.python,
    [
      path.join(tools.videoUseRoot, "helpers", "render.py"),
      session.edlPath,
      "-o",
      assembled,
      ...(request.quality === "preview" ? ["--preview"] : []),
      ...(request.program.subtitles === "burn" ? ["--build-subtitles"] : ["--no-subtitles"]),
    ],
    {
      cwd: tools.videoUseRoot,
      timeoutMs: MEDIA_TIMEOUT_MS,
      signal: context.signal,
      env: context.childEnv,
      runtimeEnv: context.env,
      spawnImpl: context.spawnImpl,
      terminateImpl: context.terminateImpl,
      onLine: (line) => {
        const progress = renderStage(line);
        if (progress) context.checkpoint({ operation: request.operation, ...progress });
      },
    },
  );
  if (assembledRun.code !== 0 || assembledRun.timedOut || !fs.existsSync(assembled)) {
    const detail = assembledRun.stderr.split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("["))
      .slice(-4)
      .join(" ");
    return publicError(
      request.operation,
      "render_failed",
      detail ? `The render failed: ${detail}` : "The renderer finished without writing a video.",
    );
  }
  let output = directFile(assembled, "The assembled Video Use render");
  if (!identityTransform(request.program.transform)) {
    const sourceProbe = await probeVideoFile(assembled, context, tools.ffprobe);
    const transform = request.program.transform;
    const finalDuration = sourceProbe.durationSeconds / (transform.speed || 1);
    const videoFilters = [];
    const audioFilters = [];
    if (transform.reverse) { videoFilters.push("reverse"); audioFilters.push("areverse"); }
    if (transform.speed !== 1) {
      videoFilters.push(`setpts=${(1 / transform.speed).toFixed(6)}*PTS`);
      audioFilters.push(...atempoChain(transform.speed));
    }
    if (transform.volumeDb !== 0) audioFilters.push(`volume=${transform.volumeDb}dB`);
    if (transform.fadeInSeconds > 0) {
      const seconds = Math.min(transform.fadeInSeconds, finalDuration / 2);
      videoFilters.push(`fade=t=in:st=0:d=${seconds.toFixed(3)}`);
      audioFilters.push(`afade=t=in:st=0:d=${seconds.toFixed(3)}`);
    }
    if (transform.fadeOutSeconds > 0) {
      const seconds = Math.min(transform.fadeOutSeconds, finalDuration / 2);
      const start = Math.max(0, finalDuration - seconds);
      videoFilters.push(`fade=t=out:st=${start.toFixed(3)}:d=${seconds.toFixed(3)}`);
      audioFilters.push(`afade=t=out:st=${start.toFixed(3)}:d=${seconds.toFixed(3)}`);
    }
    const silent = transform.mute || !sourceProbe.hasAudio;
    context.checkpoint({ operation: request.operation, stage: "Applying the finish" });
    const transformed = await runSpeechMediaProcess(
      tools.ffmpeg,
      [
        "-y", "-hide_banner", "-nostats", "-i", assembled,
        ...(videoFilters.length ? ["-vf", videoFilters.join(",")] : []),
        ...(silent ? ["-an"] : audioFilters.length ? ["-af", audioFilters.join(",")] : []),
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
        ...(silent ? [] : ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]),
        "-movflags", "+faststart", session.outputPath,
      ],
      {
        timeoutMs: MEDIA_TIMEOUT_MS,
        signal: context.signal,
        env: context.childEnv,
        runtimeEnv: context.env,
        spawnImpl: context.spawnImpl,
        terminateImpl: context.terminateImpl,
      },
    );
    if (transformed.code !== 0 || transformed.timedOut || !fs.existsSync(session.outputPath)) {
      const detail = transformed.stderr.split(/\r?\n/u).filter(Boolean).slice(-4).join(" ");
      return publicError(
        request.operation,
        "render_failed",
        detail ? `The render failed: ${detail}` : "The finishing pass produced no file.",
      );
    }
    output = directFile(session.outputPath, "The finished Video Use render");
  }
  const outputSize = fs.statSync(output).size;
  if (outputSize < 1 || outputSize > MAX_VIDEO_BYTES) {
    return publicError(request.operation, "render_failed", "The finished video exceeds the 2 GB limit.");
  }
  const probe = await probeVideoFile(output, context, tools.ffprobe);
  return {
    ok: true,
    operation: request.operation,
    outputRelativePath: relativeDataPath(context.dataRoot, output),
    durationSeconds: probe.durationSeconds,
    sizeBytes: probe.sizeBytes || outputSize,
    width: probe.width,
    height: probe.height,
  };
}

export async function executeSpeechMedia(request, inputContext) {
  validateSpeechMediaRequest(request);
  const tools = {
    ffmpeg: runtimeTool(inputContext.env, "ffmpeg"),
    ffprobe: runtimeTool(inputContext.env, "ffprobe"),
    ytdlp: runtimeTool(inputContext.env, "ytdlp"),
    python: runtimeTool(inputContext.env, "python"),
    videoUseRoot: videoUseRoot(inputContext.env),
  };
  const context = {
    ...inputContext,
    childEnv: sealedSpeechMediaEnvironment(inputContext.env, tools),
  };
  switch (request.operation) {
    case "speech-mp3": { // Voicebox WAV -> bounded MP3 file.
      if (!tools.ffmpeg) {
        return publicError(request.operation, "ffmpeg_missing", "No ffmpeg was found, so the spoken response could not be encoded as an .mp3 file.");
      }
      const stage = mediaStage(context);
      const output = path.join(stage, "speech.mp3");
      const run = await runSpeechMediaProcess(
        tools.ffmpeg,
        [
          "-nostdin", "-y", "-loglevel", "error", "-i", context.inputPaths[0],
          "-vn", "-c:a", "libmp3lame", "-b:a", "128k", output,
        ],
        {
          timeoutMs: 10 * 60_000,
          signal: context.signal,
          env: context.childEnv,
          runtimeEnv: context.env,
          spawnImpl: context.spawnImpl,
          terminateImpl: context.terminateImpl,
        },
      );
      const size = fs.statSync(output, { throwIfNoEntry: false })?.size ?? 0;
      if (run.code !== 0 || run.timedOut || size < 1) {
        const detail = run.stderr.trim().split(/\r?\n/u).pop();
        return publicError(
          request.operation,
          "speech_encode_failed",
          detail
            ? `The spoken response could not be saved as an .mp3 file: ${detail}`
            : "The spoken response could not be saved as an .mp3 file.",
        );
      }
      return {
        ok: true,
        operation: request.operation,
        outputRelativePath: relativeDataPath(context.dataRoot, output),
        sizeBytes: size,
      };
    }
    case "recording-segments": {
      if (!tools.ffmpeg) {
        return { ok: true, operation: request.operation, available: false, partRelativePaths: [] };
      }
      const stage = mediaStage(context);
      const parts = path.join(stage, "parts");
      fs.mkdirSync(parts);
      context.checkpoint({ operation: request.operation, stage: "extracting" });
      const run = await runSpeechMediaProcess(
        tools.ffmpeg,
        [
          "-nostdin", "-y", "-loglevel", "error", "-i", context.inputPaths[0],
          "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "segment",
          "-segment_time", "300", "-reset_timestamps", "1", path.join(parts, "part-%04d.wav"),
        ],
        {
          timeoutMs: MEDIA_TIMEOUT_MS,
          signal: context.signal,
          env: context.childEnv,
          runtimeEnv: context.env,
          spawnImpl: context.spawnImpl,
          terminateImpl: context.terminateImpl,
        },
      );
      const produced = fs.readdirSync(parts, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^part-\d{4}\.wav$/u.test(entry.name))
        .map((entry) => path.join(parts, entry.name))
        .sort();
      if (run.code !== 0 || run.timedOut || produced.length === 0) {
        return publicError(
          request.operation,
          "recording_unreadable",
          run.code !== 0 || run.timedOut
            ? "No audio could be read from that file. It may have no sound track, or be a format ffmpeg does not know."
            : "That recording came out silent.",
        );
      }
      return {
        ok: true,
        operation: request.operation,
        available: true,
        partRelativePaths: produced.map((filePath) => relativeDataPath(context.dataRoot, filePath)),
      };
    }
    case "video-source-inspect":
      return inspectVideoSource(request, context, tools.ytdlp);
    case "video-source-download": {
      const inspected = await inspectVideoSource(request, context, tools.ytdlp);
      if (!inspected.ok) return inspected;
      const stage = mediaStage(context);
      context.checkpoint({ operation: request.operation, percent: 0, detail: "Reading the link" });
      context.checkpoint({ operation: request.operation, percent: 1, detail: "Starting the download" });
      const args = [
        "--ignore-config", "--no-playlist", "--no-warnings", "--newline", "--no-part",
        "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b",
        "--merge-output-format", "mp4", "--max-filesize", String(MAX_VIDEO_BYTES),
        ...(tools.ffmpeg ? ["--ffmpeg-location", path.dirname(tools.ffmpeg)] : []),
        "-o", path.join(stage, "source.%(ext)s"), "--", request.source.canonicalUrl,
      ];
      const run = await runSpeechMediaProcess(tools.ytdlp, args, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        signal: context.signal,
        env: context.childEnv,
        runtimeEnv: context.env,
        spawnImpl: context.spawnImpl,
        terminateImpl: context.terminateImpl,
        onLine: (line) => {
          const match = /^\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)(?:\s+at\s+(\S+))?/u.exec(line);
          if (match) {
            context.checkpoint({
              operation: request.operation,
              percent: Math.min(100, Math.max(0, Number(match[1]) || 0)),
              detail: `${match[1]}% of ${match[2]}${match[3] ? ` at ${match[3]}` : ""}`,
            });
          } else if (/^\[Merger\]|^\[ffmpeg\]/u.test(line)) {
            context.checkpoint({ operation: request.operation, percent: 99, detail: "Merging audio and video" });
          }
        },
      });
      if (run.code !== 0 || run.timedOut) {
        const detail = run.stderr.split(/\r?\n/u)
          .map((line) => line.replace(/^ERROR:\s*/u, "").trim())
          .filter(Boolean)
          .slice(-1)[0];
        return publicError(
          request.operation,
          "download_failed",
          detail ? `The video could not be downloaded: ${detail}` : "The video could not be downloaded.",
        );
      }
      const names = fs.readdirSync(stage, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.startsWith("source."))
        .map((entry) => entry.name)
        .sort();
      const produced = names.find((name) => VIDEO_EXTENSIONS.has(path.extname(name).slice(1).toLowerCase()));
      if (!produced) {
        return publicError(
          request.operation,
          "download_failed",
          "The download finished without producing a file — the video may exceed the 2 GB limit.",
        );
      }
      const output = directFile(path.join(stage, produced), "The downloaded video");
      const size = fs.statSync(output).size;
      if (size < 1 || size > MAX_VIDEO_BYTES) {
        return publicError(request.operation, "download_failed", "The downloaded video exceeds the 2 GB limit.");
      }
      return {
        ok: true,
        operation: request.operation,
        metadata: inspected.metadata,
        format: path.extname(produced).slice(1).toLowerCase(),
        outputRelativePath: relativeDataPath(context.dataRoot, output),
        sizeBytes: size,
      };
    }
    case "video-probe": {
      try {
        const probe = await probeVideoFile(
          videoUseFile(context, request.fileRelativePath),
          context,
          tools.ffprobe,
        );
        return { ok: true, operation: request.operation, probe };
      } catch (error) {
        return publicError(
          request.operation,
          "media_probe_failed",
          error instanceof Error ? error.message : "That file could not be read as a video.",
        );
      }
    }
    case "video-silences": {
      if (!tools.ffmpeg) return publicError(request.operation, "ffmpeg_missing", "No ffmpeg was found, so this video cannot be read.");
      const filePath = videoUseFile(context, request.fileRelativePath);
      const run = await runSpeechMediaProcess(
        tools.ffmpeg,
        [
          "-hide_banner", "-nostats", "-i", filePath,
          "-af", `silencedetect=noise=${request.thresholdDb}dB:d=${request.minimumSeconds}`,
          "-f", "null", "-",
        ],
        {
          timeoutMs: 15 * 60_000,
          signal: context.signal,
          env: context.childEnv,
          runtimeEnv: context.env,
          spawnImpl: context.spawnImpl,
          terminateImpl: context.terminateImpl,
        },
      );
      const windows = [];
      let open = null;
      for (const line of run.stderr.split(/\r?\n/u)) {
        const start = /silence_start:\s*(-?[\d.]+)/u.exec(line);
        if (start) { open = Math.max(0, Number(start[1])); continue; }
        const end = /silence_end:\s*(-?[\d.]+)/u.exec(line);
        if (end && open !== null) {
          const stop = Number(end[1]);
          if (Number.isFinite(stop) && stop > open) {
            windows.push({
              start: Math.round(open * 1000) / 1000,
              end: Math.round(stop * 1000) / 1000,
              durationSeconds: Math.round((stop - open) * 1000) / 1000,
            });
          }
          open = null;
        }
      }
      const dataRelativePath = writeStageJson(context, "silences.json", { windows });
      return { ok: true, operation: request.operation, dataRelativePath, count: windows.length };
    }
    case "video-extract-audio": {
      if (!tools.ffmpeg) return publicError(request.operation, "ffmpeg_missing", "No ffmpeg was found, so the audio cannot be read.");
      const stage = mediaStage(context);
      const output = path.join(stage, "audio.wav");
      const run = await runSpeechMediaProcess(
        tools.ffmpeg,
        [
          "-y", "-i", videoUseFile(context, request.fileRelativePath), "-vn", "-ac", "1",
          "-ar", "16000", "-c:a", "pcm_s16le", output,
        ],
        {
          timeoutMs: MEDIA_TIMEOUT_MS,
          signal: context.signal,
          env: context.childEnv,
          runtimeEnv: context.env,
          spawnImpl: context.spawnImpl,
          terminateImpl: context.terminateImpl,
        },
      );
      const size = fs.statSync(output, { throwIfNoEntry: false })?.size ?? 0;
      if (run.code !== 0 || run.timedOut || size < 1) {
        const detail = run.stderr.split(/\r?\n/u).filter(Boolean).slice(-2).join(" ");
        return publicError(request.operation, "audio_extract_failed", detail || "The audio track could not be extracted.");
      }
      return {
        ok: true,
        operation: request.operation,
        outputRelativePath: relativeDataPath(context.dataRoot, output),
        sizeBytes: size,
      };
    }
    case "video-pack-transcript": {
      if (!tools.python || !tools.videoUseRoot) {
        return { ok: true, operation: request.operation, available: false, packedRelativePath: null };
      }
      const session = videoSession(context, request.sessionRootRelativePath);
      if (!fs.existsSync(session.transcriptPath)) {
        return { ok: true, operation: request.operation, available: true, packedRelativePath: null };
      }
      for (const entry of fs.readdirSync(session.transcriptsDir, { withFileTypes: true })) {
        if (!entry.name.toLowerCase().endsWith(".json")) continue;
        if (!entry.isFile()) fail("The Video Use transcript input is indirect.");
        directFile(path.join(session.transcriptsDir, entry.name), "The Video Use transcript input");
      }
      fs.rmSync(session.packedTranscriptPath, { force: true });
      const run = await runSpeechMediaProcess(
        tools.python,
        [path.join(tools.videoUseRoot, "helpers", "pack_transcripts.py"), "--edit-dir", session.editDir],
        {
          cwd: tools.videoUseRoot,
          timeoutMs: 10 * 60_000,
          signal: context.signal,
          env: context.childEnv,
          runtimeEnv: context.env,
          spawnImpl: context.spawnImpl,
          terminateImpl: context.terminateImpl,
        },
      );
      if (run.code !== 0 || run.timedOut) {
        return publicError(request.operation, "transcript_pack_failed", run.stderr.trim() || "The transcript could not be packed.");
      }
      const metadata = fs.statSync(session.packedTranscriptPath, { throwIfNoEntry: false });
      const packed = metadata?.isFile()
        ? directFile(session.packedTranscriptPath, "The packed Video Use transcript")
        : null;
      if (metadata && metadata.size > 32 * 1024 * 1024) {
        fs.rmSync(session.packedTranscriptPath, { force: true });
        return publicError(request.operation, "transcript_pack_failed", "The packed transcript exceeded its output bound.");
      }
      return {
        ok: true,
        operation: request.operation,
        available: true,
        packedRelativePath: packed
          ? relativeDataPath(context.dataRoot, packed)
          : null,
      };
    }
    case "video-render":
      return runRender(request, context, tools);
    case "video-visual-qc": {
      if (!tools.python || !tools.videoUseRoot) {
        return { ok: true, operation: request.operation, available: false };
      }
      const run = await runSpeechMediaProcess(tools.python, ["-c", "import numpy, PIL"], {
        cwd: tools.videoUseRoot,
        timeoutMs: 30_000,
        signal: context.signal,
        env: context.childEnv,
        runtimeEnv: context.env,
        spawnImpl: context.spawnImpl,
        terminateImpl: context.terminateImpl,
      });
      return { ok: true, operation: request.operation, available: run.code === 0 && !run.timedOut };
    }
    default:
      fail("The speech/media operation is unavailable.");
  }
}
