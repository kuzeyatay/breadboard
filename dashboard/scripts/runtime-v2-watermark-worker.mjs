import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalRuntimeInputAsync,
  runRuntimeV2FiniteMcpWorker,
} from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const MAX_INPUT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_CLEANED_BYTES = 256 * 1024 * 1024;
const MAX_AUDIT_FILES = 10_000;
const MAX_ARCHIVE_HEADER_BYTES = 8 * 1024;
const SCRIPT_TIMEOUT_MS = 120_000;
const OPERATIONS = new Set(["inspect", "clean", "audit"]);
const MODES = new Set(["auto", "text"]);
const SHA256 = /^[0-9a-f]{64}$/u;

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

function boundedText(value, maximumBytes) {
  return typeof value === "string" && value.trim() === value && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes && !/\p{Cc}/u.test(value);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  );
}

function directFile(candidate) {
  try {
    const metadata = fs.lstatSync(candidate);
    return metadata.isFile() && !metadata.isSymbolicLink() &&
      samePath(fs.realpathSync.native(candidate), candidate);
  } catch {
    return false;
  }
}

function directDirectory(candidate) {
  try {
    const metadata = fs.lstatSync(candidate);
    return metadata.isDirectory() && !metadata.isSymbolicLink() &&
      samePath(fs.realpathSync.native(candidate), candidate);
  } catch {
    return false;
  }
}

export function validateRuntimeV2WatermarkScope(value) {
  const scope = (item) => item === null || boundedText(item, 256);
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) || value.userId < 1 ||
    !scope(value.gardenId) || !boundedText(value.conversationId, 256)
  ) fail("Watermark work requires exact authenticated conversation scope.");
  return value;
}

export function validateRuntimeV2WatermarkRequest(value) {
  if (!isRecord(value) || value.protocolVersion !== 1 || !OPERATIONS.has(value.operation)) {
    fail("The watermark request is invalid.");
  }
  if (value.operation === "inspect") {
    if (
      !exactRecord(value, ["protocolVersion", "operation", "mode", "aggressive"]) ||
      !MODES.has(value.mode) || typeof value.aggressive !== "boolean"
    ) fail("The watermark inspection request is invalid.");
  } else if (value.operation === "clean") {
    if (
      !exactRecord(value, [
        "protocolVersion", "operation", "mode", "nfkc", "aggressiveHomoglyphs",
        "keepNonAiMetadata", "strictExit",
      ]) ||
      !MODES.has(value.mode) || typeof value.nfkc !== "boolean" ||
      typeof value.aggressiveHomoglyphs !== "boolean" ||
      typeof value.keepNonAiMetadata !== "boolean" || typeof value.strictExit !== "boolean"
    ) fail("The watermark cleaning request is invalid.");
  } else if (
    !exactRecord(value, ["protocolVersion", "operation", "directory"]) ||
    !boundedText(value.directory, 1_024)
  ) fail("The watermark audit request is invalid.");
  return value;
}

function configuredLayout(launch) {
  const python = process.env.BREADBOARD_WATERMARKS_PYTHON?.trim();
  const scripts = process.env.BREADBOARD_WATERMARKS_SCRIPTS_ROOT?.trim();
  if (!python || !path.isAbsolute(python) || !directFile(path.resolve(python))) {
    fail("The sealed watermark Python runtime is unavailable.");
  }
  if (!scripts || !path.isAbsolute(scripts) || !directDirectory(path.resolve(scripts))) {
    fail("The sealed watermark script closure is unavailable.");
  }
  for (const name of ["inspect_text.py", "inspect_file.py", "clean_text.py", "clean_file.py", "audit_dir.py"]) {
    if (!directFile(path.join(scripts, name))) fail("The sealed watermark script closure is incomplete.");
  }
  const home = path.join(launch.workspacePath, "watermark-home");
  const temp = path.join(launch.workspacePath, "watermark-temp");
  fs.mkdirSync(home, { recursive: false, mode: 0o700 });
  fs.mkdirSync(temp, { recursive: false, mode: 0o700 });
  const systemRoot = process.env.SystemRoot?.trim() || process.env.SYSTEMROOT?.trim() ||
    process.env.WINDIR?.trim();
  return {
    python: path.resolve(python),
    scripts: path.resolve(scripts),
    env: {
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      LOCALAPPDATA: home,
      TEMP: temp,
      TMP: temp,
      TMPDIR: temp,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      PYTHONNOUSERSITE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      // Node otherwise supplies a platform search path on Windows even when
      // the key is omitted. The interpreter and every script are absolute.
      PATH: "",
      ...(systemRoot ? { SystemRoot: systemRoot, SYSTEMROOT: systemRoot, WINDIR: systemRoot } : {}),
    },
  };
}

async function terminateTree(child, env) {
  if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
  if (process.platform === "win32") {
    const root = env.SystemRoot || env.SYSTEMROOT || env.WINDIR;
    const taskkill = root ? path.join(root, "System32", "taskkill.exe") : null;
    if (taskkill && directFile(taskkill)) {
      await new Promise((resolve) => {
        let killer;
        try {
          killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
            env: {
              SystemRoot: root,
              SYSTEMROOT: root,
              WINDIR: root,
            },
          });
        } catch {
          resolve();
          return;
        }
        killer.once("error", resolve);
        killer.once("close", resolve);
      });
      return;
    }
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch { /* Fall through to the direct child. */ }
  }
  try { child.kill("SIGKILL"); } catch { /* Rust remains the final owner. */ }
}

export function runRuntimeV2WatermarkPython(layout, script, args, cwd, signal) {
  return new Promise((resolve) => {
    let child;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    try {
      child = spawn(layout.python, [path.join(layout.scripts, script), ...args], {
        cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: layout.env,
      });
    } catch (error) {
      resolve({
        code: null,
        stdout,
        stderr: error instanceof Error ? error.message : "Python could not start.",
        truncated,
        timedOut,
        spawnError: true,
      });
      return;
    }
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      resolve(value);
    };
    const stop = () => { void terminateTree(child, layout.env); };
    const append = (channel, chunk) => {
      const text = String(chunk);
      const bytes = Buffer.byteLength(text, "utf8");
      if (channel === "stdout") {
        stdoutBytes += bytes;
        if (stdoutBytes <= MAX_OUTPUT_BYTES) stdout += text;
      } else {
        stderrBytes += bytes;
        if (stderrBytes <= MAX_OUTPUT_BYTES) stderr += text;
      }
      if (stdoutBytes > MAX_OUTPUT_BYTES || stderrBytes > MAX_OUTPUT_BYTES) {
        truncated = true;
        stop();
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.once("error", (error) => finish({
      code: null,
      stdout,
      stderr: `${stderr}${error.message}`.slice(-MAX_OUTPUT_BYTES),
      truncated,
      timedOut,
      spawnError: true,
    }));
    child.once("close", (code) => finish({
      code,
      stdout,
      stderr,
      truncated,
      timedOut,
      spawnError: false,
    }));
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, SCRIPT_TIMEOUT_MS);
    timer.unref?.();
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
}

function parseReport(run, what) {
  const text = run.stdout.trim();
  if (text && !run.truncated) {
    try {
      const value = JSON.parse(text);
      if (isRecord(value)) return value;
    } catch { /* Use the bounded diagnostic below. */ }
  }
  const detail = run.timedOut
    ? "timed out"
    : run.truncated
      ? "exceeded the output bound"
      : run.stderr.trim().split(/\r?\n/u).slice(-4).join(" ").slice(0, 400) ||
        `exited with code ${run.code}`;
  fail(`${what} failed: ${detail}`);
}

function safeExtension(displayName) {
  const extension = path.extname(displayName).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/u.test(extension) ? extension : ".bin";
}

async function copySealedInput(launch, signal, target) {
  const source = await canonicalRuntimeInputAsync(launch, 0, signal);
  await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  const metadata = await fsp.lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== launch.inputBlobs[0].sizeBytes) {
    fail("The watermark input copy is invalid.");
  }
}

async function fileReceipt(launch, file) {
  const before = await fsp.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > MAX_CLEANED_BYTES) {
    fail("The cleaned watermark output is invalid.");
  }
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  const after = await fsp.lstat(file);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) {
    fail("The cleaned watermark output changed while it was hashed.");
  }
  const relativePath = path.relative(launch.dataRoot, file).split(path.sep).join("/");
  if (relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    fail("The cleaned watermark output escaped Runtime data.");
  }
  return { relativePath, sizeBytes: before.size, sha256: hash.digest("hex") };
}

async function readExact(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (bytesRead === 0) fail("The watermark audit bundle ended early.");
    offset += bytesRead;
  }
}

function safeBundlePath(value) {
  if (!boundedText(value, 1_024) || value.includes("\\") || path.posix.isAbsolute(value)) return false;
  const parts = value.split("/");
  return parts.length > 0 && parts.every((part, index) =>
    part && part !== "." && part !== ".." &&
    (index === parts.length - 1 || !part.startsWith(".")));
}

async function unpackAuditBundle(launch, signal) {
  const archive = await canonicalRuntimeInputAsync(launch, 0, signal);
  const root = path.join(launch.workspacePath, "audit-root");
  fs.mkdirSync(root, { recursive: false, mode: 0o700 });
  const handle = await fsp.open(archive, "r");
  const magic = Buffer.from("BREADBOARD-WATERMARK-AUDIT-V1\n", "utf8");
  let position = 0;
  let files = 0;
  const skipped = [];
  try {
    const actualMagic = Buffer.alloc(magic.length);
    await readExact(handle, actualMagic, position);
    position += actualMagic.length;
    if (!actualMagic.equals(magic)) fail("The watermark audit bundle has an invalid header.");
    while (position < launch.inputBlobs[0].sizeBytes) {
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const lengthBytes = Buffer.alloc(4);
      await readExact(handle, lengthBytes, position);
      position += 4;
      const headerLength = lengthBytes.readUInt32BE(0);
      if (headerLength === 0) break;
      if (headerLength > MAX_ARCHIVE_HEADER_BYTES) fail("A watermark audit entry header is too large.");
      const headerBytes = Buffer.alloc(headerLength);
      await readExact(handle, headerBytes, position);
      position += headerLength;
      let header;
      try { header = JSON.parse(headerBytes.toString("utf8")); } catch { fail("A watermark audit entry is invalid."); }
      if (!isRecord(header) || !safeBundlePath(header.path)) fail("A watermark audit path is invalid.");
      if (Object.hasOwn(header, "skipReason")) {
        if (
          !exactRecord(header, ["path", "skipReason"]) ||
          !boundedText(header.skipReason, 256)
        ) fail("A skipped watermark audit entry is invalid.");
        skipped.push({ path: header.path, reason: header.skipReason });
        continue;
      }
      if (
        !exactRecord(header, ["path", "sizeBytes"]) ||
        !Number.isSafeInteger(header.sizeBytes) || header.sizeBytes < 0 ||
        header.sizeBytes > MAX_FILE_BYTES || files >= MAX_AUDIT_FILES ||
        position + header.sizeBytes > launch.inputBlobs[0].sizeBytes
      ) fail("A watermark audit file entry is invalid.");
      const target = path.resolve(root, ...header.path.split("/"));
      if (!pathWithin(root, target)) fail("A watermark audit file escaped its private root.");
      await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const output = await fsp.open(target, "wx", 0o600);
      try {
        let remaining = header.sizeBytes;
        const chunk = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, remaining)));
        while (remaining > 0) {
          if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
          const amount = Math.min(chunk.length, remaining);
          await readExact(handle, chunk.subarray(0, amount), position);
          await output.write(chunk, 0, amount, header.sizeBytes - remaining);
          position += amount;
          remaining -= amount;
        }
      } finally {
        await output.close();
      }
      files += 1;
    }
    if (position !== launch.inputBlobs[0].sizeBytes) {
      fail("The watermark audit bundle has trailing or missing bytes.");
    }
  } finally {
    await handle.close();
  }
  return { root, skipped };
}

function normalizeAuditReport(report, root, directory, skipped) {
  report.root = directory;
  if (Array.isArray(report.files)) {
    for (const item of report.files) {
      if (!isRecord(item) || typeof item.path !== "string") continue;
      const relative = path.relative(root, item.path).split(path.sep).join("/");
      if (safeBundlePath(relative)) item.path = relative;
      else item.path = "invalid-path";
    }
  }
  const existing = Array.isArray(report.files_skipped) ? report.files_skipped : [];
  for (const item of existing) {
    if (!isRecord(item) || typeof item.path !== "string") continue;
    const relative = path.relative(root, item.path).split(path.sep).join("/");
    item.path = safeBundlePath(relative) ? relative : "invalid-path";
  }
  report.files_skipped = [...existing, ...skipped];
  return report;
}

export async function executeRuntimeV2WatermarkOperation(
  launch,
  signal,
  progress,
  dependencies = {},
) {
  const request = validateRuntimeV2WatermarkRequest(launch.request);
  validateRuntimeV2WatermarkScope(launch.executionScope);
  const layout = (dependencies.layout ?? configuredLayout)(launch);
  const runPython = dependencies.runPython ?? runRuntimeV2WatermarkPython;
  progress.checkpoint({ stage: "preparing", operation: request.operation });
  if (request.operation === "audit") {
    const unpacked = await unpackAuditBundle(launch, signal);
    const run = await runPython(
      layout,
      "audit_dir.py",
      [unpacked.root, "--json", "--skip", ".watermarks,.officecli,.breadboard"],
      unpacked.root,
      signal,
    );
    const report = normalizeAuditReport(
      parseReport(run, "Auditing the workspace"),
      unpacked.root,
      request.directory,
      unpacked.skipped,
    );
    progress.checkpoint({ stage: "complete", operation: request.operation });
    return { ok: true, operation: "audit", report, output: null };
  }

  const extension = safeExtension(launch.inputBlobs[0].displayName);
  const source = path.join(launch.workspacePath, `source${extension}`);
  await copySealedInput(launch, signal, source);
  if (request.operation === "inspect") {
    const script = request.mode === "text" ? "inspect_text.py" : "inspect_file.py";
    const args = [source, "--json", ...(request.aggressive ? ["--aggressive"] : [])];
    const run = await runPython(layout, script, args, launch.workspacePath, signal);
    const report = parseReport(run, "Inspecting the source");
    progress.checkpoint({ stage: "complete", operation: request.operation });
    return { ok: true, operation: "inspect", report, output: null };
  }

  const output = path.join(launch.workspacePath, `cleaned${extension}`);
  const script = request.mode === "text" ? "clean_text.py" : "clean_file.py";
  const args = request.mode === "text"
    ? [
        source, "-o", output, "--stats",
        ...(request.nfkc ? ["--nfkc"] : []),
        ...(request.aggressiveHomoglyphs ? ["--aggressive-homoglyphs"] : []),
      ]
    : [
        source, "-o", output, "--json",
        ...(request.nfkc ? ["--nfkc"] : []),
        ...(request.aggressiveHomoglyphs ? ["--aggressive-homoglyphs"] : []),
        ...(request.keepNonAiMetadata ? ["--keep-non-ai-metadata"] : []),
      ];
  const run = await runPython(layout, script, args, launch.workspacePath, signal);
  if (request.strictExit && run.code !== 0) {
    return {
      ok: false,
      operation: "clean",
      errorCode: run.timedOut ? "timeout" : "clean_failed",
      message: run.stderr.trim().split(/\r?\n/u).slice(-3).join(" ").slice(0, 400) ||
        `Watermark cleaning exited with code ${run.code}.`,
      report: null,
      output: null,
    };
  }
  const report = request.mode === "text"
    ? parseReport({ ...run, stdout: run.stderr }, "Cleaning the text")
    : parseReport(run, "Cleaning the file");
  if (!directFile(output)) fail("Watermark cleaning produced no direct output file.");
  const receipt = await fileReceipt(launch, output);
  if (!SHA256.test(receipt.sha256)) fail("The watermark output receipt is invalid.");
  progress.checkpoint({ stage: "complete", operation: request.operation });
  return { ok: true, operation: "clean", report, output: receipt };
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-watermark-worker",
    validateRequest: validateRuntimeV2WatermarkRequest,
    validateExecutionScope: validateRuntimeV2WatermarkScope,
    expectedInputCount: () => 1,
    maximumInputBytes: MAX_INPUT_BYTES,
    execute: executeRuntimeV2WatermarkOperation,
  });
}
