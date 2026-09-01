import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

import { createSealedRuntimeV2QuartzPublishExecutor } from "./runtime-v2-quartz-publish-executor.mjs";

const PROTOCOL_VERSION = 1;
const JOB_ID = /^vtj-[a-z0-9-]{8,80}$/u;
const MEDIA_EXTENSIONS = new Set([
  ".mp4", ".mov", ".mkv", ".webm", ".m4v",
  ".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg",
]);
const MAX_TEXT_BYTES = 4096;
const DEVELOPMENT_SCRIBERR_SETTING_NAMES = new Set([
  "SCRIBERR_MODEL_FAMILY",
  "SCRIBERR_MODEL",
  "SCRIBERR_LANGUAGE",
  "SCRIBERR_DIARIZATION",
]);

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

function boundedText(value, maximumBytes = MAX_TEXT_BYTES) {
  return typeof value === "string" && value.trim() === value && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes && !/\p{Cc}/u.test(value);
}

function unquoteLocalSetting(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) return trimmed.slice(1, -1);
  return trimmed;
}

/**
 * Runtime's sealed worker environment is authoritative. In repository-backed
 * development, however, dashboard settings resolved from `.env.local` are not
 * necessarily present in the Runtime host's OS environment. Project only the
 * non-secret Scriberr inference settings from that attested local file, and
 * never override a value supplied by Runtime.
 */
export function projectDevelopmentScriberrSettings(repositoryRoot, env = process.env) {
  const settingsPath = path.join(repositoryRoot, "dashboard", ".env.local");
  if (!fs.existsSync(settingsPath)) return [];
  const metadata = fs.lstatSync(settingsPath);
  if (
    !metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 64 * 1024 ||
    !samePath(fs.realpathSync.native(settingsPath), settingsPath)
  ) fail("The development Scriberr settings file is unavailable or indirect.");
  const projected = [];
  for (const rawLine of fs.readFileSync(settingsPath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    if (!DEVELOPMENT_SCRIBERR_SETTING_NAMES.has(name)) continue;
    if (boundedText(env[name], 128)) continue;
    const value = unquoteLocalSetting(line.slice(separator + 1));
    if (!boundedText(value, 128)) fail(`Invalid development ${name} setting.`);
    env[name] = value;
    projected.push(name);
  }
  return projected;
}

function samePath(left, right) {
  const normalize = (value) => {
    let resolved = path.resolve(value);
    if (process.platform === "win32") {
      if (resolved.startsWith("\\\\?\\UNC\\")) resolved = `\\\\${resolved.slice(8)}`;
      else if (resolved.startsWith("\\\\?\\")) resolved = resolved.slice(4);
    }
    return resolved;
  };
  const a = normalize(left);
  const b = normalize(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function directDirectory(value, label) {
  if (!boundedText(value) || !path.isAbsolute(value)) fail(`${label} is not configured.`);
  const resolved = path.resolve(value);
  const metadata = fs.lstatSync(resolved);
  const canonical = fs.realpathSync.native(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      !samePath(canonical, resolved)) {
    fail(`${label} is unavailable or indirect.`);
  }
  return canonical;
}

function ensureDirectContainedDirectory(root, target, label) {
  if (!pathWithin(root, target) || samePath(root, target)) fail(`${label} escaped its owner root.`);
  fs.mkdirSync(target, { recursive: true });
  const metadata = fs.lstatSync(target);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(target), target)) fail(`${label} is unavailable or indirect.`);
  return target;
}

export function validateScriberrGardenExecutionScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) || value.userId < 1 ||
    !boundedText(value.gardenId, 256) || value.conversationId !== null
  ) fail("Scriberr Garden work requires authenticated garden scope.");
  return value;
}

export function validateScriberrGardenRequest(value) {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION) {
    fail("The Scriberr Garden request has an unsupported protocol.");
  }
  if (value.operation === "health") {
    if (!exactRecord(value, ["protocolVersion", "operation"])) fail("Invalid Scriberr health request.");
    return value;
  }
  if (value.operation === "inspect-youtube") {
    if (
      !exactRecord(value, ["protocolVersion", "operation", "videoId", "canonicalUrl"]) ||
      !/^[A-Za-z0-9_-]{11}$/u.test(value.videoId) ||
      value.canonicalUrl !== `https://www.youtube.com/watch?v=${value.videoId}`
    ) fail("Invalid Scriberr YouTube inspection request.");
    return value;
  }
  if (
    !["transcribe", "retry", "recover"].includes(value.operation) ||
    !exactRecord(value, [
      "protocolVersion", "operation", "legacyJobId", "clusterId", "inputKind",
    ]) ||
    !JOB_ID.test(value.legacyJobId) ||
    !Number.isSafeInteger(value.clusterId) || value.clusterId < 1 ||
    !["upload", "youtube"].includes(value.inputKind)
  ) fail("Invalid Scriberr transcription request.");
  if (value.operation !== "transcribe" && value.inputKind === "upload") {
    // Retry/recovery consumes only the durable worker-owned media checkpoint.
  }
  return value;
}

export function expectedScriberrGardenInputCount(request) {
  return request.operation === "transcribe" && request.inputKind === "upload" ? 1 : 0;
}

function sourceLayout(launch) {
  // The finite worker core derives this root from the identity-bound launch
  // directory. In development the dashboard deliberately clears
  // BREADBOARD_DATA_DIR to preserve the historical repository layout, so the
  // environment is neither necessary nor authoritative here.
  const dataRoot = directDirectory(launch.dataRoot, "Runtime data root");
  const sourceRoot = directDirectory(
    process.env.BREADBOARD_SCRIBERR_SOURCE_ROOT,
    "Staged Scriberr source root",
  );
  const repositoryRoot = directDirectory(
    process.env.BREADBOARD_REPO_ROOT,
    "Staged Breadboard repository root",
  );
  const developmentSourceRoot = path.join(repositoryRoot, "dashboard", "src");
  if (samePath(sourceRoot, developmentSourceRoot)) {
    projectDevelopmentScriberrSettings(repositoryRoot);
  }
  const quartzSourceRoot = samePath(sourceRoot, developmentSourceRoot)
    ? directDirectory(
        path.join(repositoryRoot, "quartz"),
        "Staged Quartz source root",
      )
    : repositoryRoot;
  for (const relative of [
    "lib/scriberr/job-runner.ts",
    "lib/scriberr/job-store.ts",
    "lib/scriberr/client.ts",
    "lib/scriberr/ffprobe.ts",
    "lib/scriberr/ytdlp.ts",
    "lib/scriberr/health.ts",
    "lib/scriberr/ingest.ts",
    "lib/scriberr/video-source-store.ts",
    "lib/quartz-publish.ts",
  ]) {
    const target = path.join(sourceRoot, ...relative.split("/"));
    const metadata = fs.lstatSync(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail("The staged Scriberr source closure is incomplete.");
  }
  const databaseModulePath = path.resolve(
    sourceRoot,
    "..",
    "node_modules",
    "better-sqlite3",
    "lib",
    "index.js",
  );
  const databaseModule = fs.lstatSync(databaseModulePath);
  if (!databaseModule.isFile() || databaseModule.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(databaseModulePath), databaseModulePath)) {
    fail("The staged SQLite module is unavailable or indirect.");
  }
  const contentPath = path.join(dataRoot, "quartz", "content");
  ensureDirectContainedDirectory(dataRoot, path.dirname(contentPath), "Quartz state root");
  ensureDirectContainedDirectory(dataRoot, contentPath, "Quartz content root");
  const mediaRoot = path.join(dataRoot, "runtime-v2", "services", "scriberr-garden", "media");
  ensureDirectContainedDirectory(dataRoot, path.dirname(mediaRoot), "Scriberr Garden state root");
  ensureDirectContainedDirectory(dataRoot, mediaRoot, "Scriberr media root");
  // The sealed worker intentionally does not inherit the caller's TEMP/TMP.
  // Without a worker-owned replacement, Node falls back to the system temp
  // directory on Windows, where the durable knowledge transaction cannot
  // create its rollback journal. Keep every temporary write inside the
  // identity-bound attempt workspace instead.
  const finiteMutation = ["transcribe", "retry", "recover"].includes(
    launch.request.operation,
  );
  const chatmockBaseUrl = process.env.CHATMOCK_BASE_URL;
  if (finiteMutation && !boundedText(chatmockBaseUrl, 2048)) {
    fail("The trusted ChatMock endpoint is unavailable for Scriberr ingestion.");
  }
  if (boundedText(chatmockBaseUrl, 2048)) {
    // Transcript ingestion uses the OpenAI SDK, while the sealed Scriberr
    // profile exposes only the trusted ChatMock names. Project that endpoint
    // into the SDK contract here and never inherit a host credential.
    process.env.OPENAI_BASE_URL = chatmockBaseUrl;
    process.env.OPENAI_API_KEY = "local";
  }
  const scratchOwner = finiteMutation
    ? directDirectory(launch.workspacePath, "Scriberr worker workspace")
    : path.join(dataRoot, "runtime-v2", "services", "scriberr-garden");
  const scratchRoot = ensureDirectContainedDirectory(
    scratchOwner,
    path.join(scratchOwner, "tmp"),
    "Scriberr worker scratch root",
  );
  process.env.TEMP = scratchRoot;
  process.env.TMP = scratchRoot;
  process.env.TMPDIR = scratchRoot;
  process.env.QUARTZ_CONTENT_PATH = contentPath;
  process.env.VIDEO_TRANSCRIPTION_TEMP_DIR = mediaRoot;
  return {
    dataRoot,
    sourceRoot,
    repositoryRoot,
    quartzSourceRoot,
    databaseModulePath,
    contentPath,
    mediaRoot,
    scratchRoot,
  };
}

async function importSource(layout, relative) {
  return import(pathToFileURL(path.join(layout.sourceRoot, ...relative.split("/"))).href);
}

export function resolveScriberrGardenDatabasePath(layout) {
  const historicalDevelopmentData =
    samePath(layout.dataRoot, layout.repositoryRoot) &&
    samePath(layout.sourceRoot, path.join(layout.repositoryRoot, "dashboard", "src"));
  const databasePath = historicalDevelopmentData
    ? path.join(layout.dataRoot, "dashboard", "db", "brain.db")
    : path.join(layout.dataRoot, "database", "brain.db");
  const metadata = fs.lstatSync(databasePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() ||
      !pathWithin(layout.dataRoot, databasePath) ||
      !samePath(fs.realpathSync.native(databasePath), databasePath)) {
    fail("The Breadboard database is unavailable or indirect.");
  }
  return databasePath;
}

async function openStore(layout) {
  await import("./runtime-v2-scriberr-import-hook.mjs");
  const [{ default: Database }, storeModule] = await Promise.all([
    import(pathToFileURL(layout.databaseModulePath).href),
    importSource(layout, "lib/scriberr/job-store.ts"),
  ]);
  const databasePath = resolveScriberrGardenDatabasePath(layout);
  const database = new Database(databasePath);
  database.pragma("busy_timeout = 30000");
  database.pragma("foreign_keys = ON");
  return { database, store: new storeModule.VideoTranscriptionJobStore(database) };
}

async function sha256File(filePath, signal) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Runtime cancellation requested", "AbortError");
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function sealDurableUpload(layout, launch, store, inputPath, signal) {
  const job = store.getJob(launch.request.legacyJobId);
  if (!job || job.inputKind !== "upload") fail("The durable Scriberr upload job is unavailable.");
  const blob = launch.inputBlobs[0];
  if (!blob || blob.sha256 !== job.mediaSha256) fail("The Scriberr upload digest does not match its durable job.");
  const extension = path.extname(job.originalFilename ?? "").toLowerCase();
  if (!MEDIA_EXTENSIONS.has(extension)) fail("The durable Scriberr upload extension is invalid.");
  const jobRoot = path.join(layout.mediaRoot, job.id);
  if (!pathWithin(layout.mediaRoot, jobRoot) || samePath(layout.mediaRoot, jobRoot)) fail("Invalid Scriberr media root.");
  ensureDirectContainedDirectory(layout.mediaRoot, jobRoot, "Scriberr job media root");
  const destination = path.join(jobRoot, `media${extension}`);
  const pending = path.join(jobRoot, `.media.${launch.identity.workerInstanceId}.pending`);
  if (fs.existsSync(destination)) {
    const metadata = fs.lstatSync(destination);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== blob.sizeBytes ||
        !samePath(fs.realpathSync.native(destination), destination) ||
        await sha256File(destination, signal) !== blob.sha256) fail("The durable Scriberr media checkpoint is invalid.");
  } else {
    fs.rmSync(pending, { force: true });
    try {
      const copyHash = crypto.createHash("sha256");
      const hashingStream = new Transform({
        transform(chunk, _encoding, done) {
          copyHash.update(chunk);
          done(null, chunk);
        },
      });
      await pipeline(
        fs.createReadStream(inputPath),
        hashingStream,
        fs.createWriteStream(pending, { flags: "wx", mode: 0o600 }),
        { signal },
      );
      const metadata = fs.lstatSync(pending);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== blob.sizeBytes ||
          copyHash.digest("hex") !== blob.sha256) fail("The sealed Scriberr upload changed while copying.");
      fs.renameSync(pending, destination);
    } finally {
      fs.rmSync(pending, { force: true });
    }
  }
  store.updateJob(job.id, { mediaTempPath: destination });
}

function publicCheckpoint(job) {
  return {
    operation: "transcription",
    legacyJobId: job.id,
    status: job.status,
    progressPercent: job.progressPercent,
    currentStage: job.currentStage,
    errorCode: job.errorCode,
  };
}

async function executeTranscription(layout, launch, signal, io, inputPath) {
  const { database, store } = await openStore(layout);
  let checkpointTimer = null;
  let checkpointFault = null;
  try {
    let job = store.getJob(launch.request.legacyJobId);
    if (
      !job || job.userId !== launch.executionScope.userId ||
      job.gardenId !== launch.executionScope.gardenId ||
      job.clusterId !== launch.request.clusterId || job.inputKind !== launch.request.inputKind
    ) fail("The Scriberr job does not match its authenticated Runtime scope.");
    if (inputPath) await sealDurableUpload(layout, launch, store, inputPath, signal);

    const [runnerModule, configModule, clientModule, ffprobeModule, ingestModule, sourceModule, quartzModule] =
      await Promise.all([
        importSource(layout, "lib/scriberr/job-runner.ts"),
        importSource(layout, "lib/scriberr/config.ts"),
        importSource(layout, "lib/scriberr/client.ts"),
        importSource(layout, "lib/scriberr/ffprobe.ts"),
        importSource(layout, "lib/scriberr/ingest.ts"),
        importSource(layout, "lib/scriberr/video-source-store.ts"),
        importSource(layout, "lib/quartz-publish.ts"),
      ]);
    quartzModule.installSealedRuntimeV2QuartzPublishExecutor(
      createSealedRuntimeV2QuartzPublishExecutor({
        identity: launch.identity,
        dataRoot: launch.dataRoot,
        contentPath: layout.contentPath,
        sourceRoot: layout.quartzSourceRoot,
        workspacePath: launch.workspacePath,
        signal,
      }),
    );
    const config = configModule.loadVideoTranscriptionConfig(process.env);
    const runner = new runnerModule.VideoTranscriptionRunner({
      config,
      store,
      createScriberrClient: () => clientModule.scriberrClientFromConfig(),
      probeMedia: (filePath) => ffprobeModule.probeMediaFile(config.ffprobePath, filePath),
      ingest: ingestModule.ingestTranscriptSource,
      resumeIndexing: ingestModule.resumeTranscriptIndexing,
      findExistingVideoSource: sourceModule.findExistingVideoSource,
      contentPath: () => layout.contentPath,
      withScriberrLease: (_reason, operation) => operation(),
      signal,
    });
    let prior = "";
    const publish = () => {
      const current = store.getJob(job.id);
      if (!current) return;
      const checkpoint = publicCheckpoint(current);
      const serialized = JSON.stringify(checkpoint);
      if (serialized !== prior) { prior = serialized; io.checkpoint(checkpoint); }
    };
    publish();
    checkpointTimer = setInterval(() => {
      try {
        publish();
      } catch (error) {
        checkpointFault = error;
        clearInterval(checkpointTimer);
      }
    }, 1_000);
    checkpointTimer.unref?.();
    await runner.runExact(job.id, launch.request.operation === "transcribe" ? "start" : launch.request.operation);
    if (checkpointFault) throw checkpointFault;
    publish();
    job = store.getJob(job.id);
    if (!job) fail("The durable Scriberr job disappeared during execution.");
    return {
      ok: job.status === "completed",
      operation: launch.request.operation,
      legacyJobId: job.id,
      status: job.status,
      sourceSlug: job.sourceSlug,
      outputRelativePath: job.outputRelativePath,
      errorCode: job.errorCode,
    };
  } finally {
    if (checkpointTimer) clearInterval(checkpointTimer);
    database.close();
  }
}

async function executeProbe(layout, launch) {
  await import("./runtime-v2-scriberr-import-hook.mjs");
  if (launch.request.operation === "inspect-youtube") {
    const ytdlp = await importSource(layout, "lib/scriberr/ytdlp.ts");
    const config = (await importSource(layout, "lib/scriberr/config.ts"))
      .loadVideoTranscriptionConfig(process.env);
    try {
      const metadata = await ytdlp.inspectYouTubeVideo(
        { ytdlpPath: config.ytdlpPath, timeoutMs: 60_000 },
        {
          videoId: launch.request.videoId,
          canonicalUrl: launch.request.canonicalUrl,
          originalUrl: launch.request.canonicalUrl,
        },
      );
      return { ok: true, operation: "inspect-youtube", metadata };
    } catch (error) {
      if (
        error && typeof error === "object" &&
        ["ytdlp_unavailable", "youtube_metadata_failed", "youtube_playlist"].includes(error.code)
      ) {
        return { ok: false, operation: "inspect-youtube", errorCode: error.code };
      }
      throw error;
    }
  }
  const [healthModule, configModule, clientModule] = await Promise.all([
    importSource(layout, "lib/scriberr/health.ts"),
    importSource(layout, "lib/scriberr/config.ts"),
    importSource(layout, "lib/scriberr/client.ts"),
  ]);
  const config = configModule.loadVideoTranscriptionConfig(process.env);
  const health = await healthModule.checkVideoTranscriptionHealth(config, {
    contentPath: layout.contentPath,
    clusterSlug: launch.executionScope.gardenId,
    scriberrHealthCheck: () => clientModule.scriberrClientFromConfig().healthCheck(),
  });
  return { ok: true, operation: "health", health };
}

export async function executeScriberrGardenJob(launch, signal, io, inputPath) {
  const layout = sourceLayout(launch);
  if (["transcribe", "retry", "recover"].includes(launch.request.operation)) {
    return executeTranscription(layout, launch, signal, io, inputPath);
  }
  return executeProbe(layout, launch);
}
