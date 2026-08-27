import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PROTOCOL_VERSION = 1;
const PROBE_TIMEOUT_MS = 90_000;
const INDEX_TIMEOUT_MS = 45 * 60_000;
const MAX_PATH_BYTES = 32 * 1024;
const MAX_DETAIL_BYTES = 8 * 1024;
const MAX_STREAM_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_LINE_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_INDEXED_FILES = 600;
const MAX_INDEXED_FILE_BYTES = 8 * 1024 * 1024;

const INDEXABLE = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".csv",
]);

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  "dist",
  "build",
  ".obsidian",
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

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function boundedText(value, maximumBytes) {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/[\u0000\r\n]/u.test(value);
}

function boundedPath(value) {
  return boundedText(value, MAX_PATH_BYTES) && path.isAbsolute(value);
}

export function validateDeepTutorProbeRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation"]) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.operation !== "probe"
  ) fail("The canonical Deep Tutor probe request is invalid.");
  return value;
}

export function validateDeepTutorIndexRequest(value) {
  if (
    !exactRecord(value, [
      "protocolVersion",
      "operation",
      "root",
      "scopeId",
      "kb",
      "fingerprint",
    ]) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.operation !== "index" ||
    !boundedPath(value.root) ||
    typeof value.scopeId !== "string" ||
    !/^[A-Za-z0-9._-]{1,100}$/u.test(value.scopeId) ||
    typeof value.kb !== "string" ||
    value.kb !== knowledgeBaseName(value.scopeId) ||
    !boundedText(value.fingerprint, 256)
  ) fail("The canonical Deep Tutor index request is invalid.");
  return value;
}

function validateExecutionScope(value, expectedConversation) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    value.conversationId !== expectedConversation
  ) fail("The Deep Tutor maintenance worker scope is invalid.");
  return value;
}

export function validateDeepTutorProbeExecutionScope(value) {
  return validateExecutionScope(value, "deep-tutor-health");
}

export function validateDeepTutorIndexExecutionScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    typeof value.conversationId !== "string" ||
    !/^deep-tutor-index-[0-9a-f]{24}$/u.test(value.conversationId)
  ) fail("The Deep Tutor index worker scope is invalid.");
  return value;
}

export function deepTutorIndexConversationId(scopeId) {
  if (typeof scopeId !== "string" || !/^[A-Za-z0-9._-]{1,100}$/u.test(scopeId)) {
    fail("The Deep Tutor index scope identifier is invalid.");
  }
  return `deep-tutor-index-${crypto.createHash("sha256").update(scopeId).digest("hex").slice(0, 24)}`;
}

function knowledgeBaseName(scopeId) {
  return scopeId.replace(/[<>:"/\\|?*#%]/gu, "-").slice(0, 100) || null;
}

function directPath(value, kind, label) {
  if (!boundedPath(value)) fail(`${label} is not an absolute sealed path.`);
  const resolved = path.resolve(value);
  const metadata = fs.lstatSync(resolved);
  if (
    (kind === "file" ? !metadata.isFile() : !metadata.isDirectory()) ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) fail(`${label} is unavailable or indirect.`);
  return resolved;
}

function requiredEnvironmentPath(name, kind) {
  const value = process.env[name]?.trim();
  if (!value) fail(`The sealed ${name} path is unavailable.`);
  return directPath(value, kind, `The sealed ${name} path`);
}

function cloneRoot() {
  const root = requiredEnvironmentPath("DEEP_TUTOR_ROOT", "directory");
  for (const relative of [
    ["pyproject.toml"],
    ["deeptutor", "app", "facade.py"],
    ["deeptutor_cli", "main.py"],
  ]) directPath(path.join(root, ...relative), "file", "The immutable DeepTutor source");
  return root;
}

function pythonExecutable() {
  return requiredEnvironmentPath("DEEP_TUTOR_PYTHON", "file");
}

function indexScript(root) {
  const script = requiredEnvironmentPath("DEEP_TUTOR_INDEX_SCRIPT", "file");
  const expected = path.join(path.dirname(root), "scripts", "deeptutor-index.py");
  if (!samePath(script, expected)) fail("The Deep Tutor index script escaped immutable application source.");
  return script;
}

function ensureDirectDirectory(root, ...segments) {
  const canonicalRoot = fs.realpathSync.native(path.resolve(root));
  let current = canonicalRoot;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || /[\\/\u0000]/u.test(segment)) {
      fail("The Runtime-owned Deep Tutor directory is invalid.");
    }
    current = path.join(current, segment);
    if (!pathWithin(canonicalRoot, current)) fail("The Deep Tutor directory escaped Runtime data.");
    const existing = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!existing) fs.mkdirSync(current, { recursive: false, mode: 0o700 });
    const metadata = fs.lstatSync(current);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(current), current)
    ) fail("The Runtime-owned Deep Tutor directory is unavailable or indirect.");
  }
  return current;
}

function homeRoot(dataRoot) {
  const expected = ensureDirectDirectory(dataRoot, "runtime-v2", "services", "deep-tutor", "home");
  const configured = process.env.DEEP_TUTOR_HOME_ROOT?.trim();
  if (!configured || !boundedPath(configured) || !samePath(configured, expected)) {
    fail("The sealed Deep Tutor home root does not match Runtime data.");
  }
  return expected;
}

function scopedHome(launch, scopeId) {
  return ensureDirectDirectory(
    homeRoot(launch.dataRoot),
    `u${launch.executionScope.userId}`,
    scopeId,
  );
}

function systemRoot() {
  const value = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!value || !boundedPath(value)) return null;
  try {
    return directPath(value, "directory", "The sealed Windows system root");
  } catch {
    return null;
  }
}

function childEnvironment(extra = {}) {
  const allowed = new Set([
    "ALL_PROXY",
    "APPDATA",
    "HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "LANG",
    "LOCALAPPDATA",
    "NODE_EXTRA_CA_CERTS",
    "NO_PROXY",
    "PATH",
    "PATHEXT",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
  ]);
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name, value]) => allowed.has(name.toUpperCase()) && value !== undefined,
      ),
    ),
    ELECTRON_RUN_AS_NODE: "1",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    ...extra,
  };
}

async function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const root = systemRoot();
    if (root) {
      const taskkill = path.join(root, "System32", "taskkill.exe");
      try {
        await new Promise((resolve) => {
          const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
            env: childEnvironment(),
          });
          killer.once("error", () => {
            try { child.kill(); } catch {}
            resolve();
          });
          killer.once("close", resolve);
        });
        return;
      } catch {
        // Fall through to the direct child. Native still owns the full worker tree.
      }
    }
    try { child.kill(); } catch {}
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch {}
  }
}

function appendTail(current, chunk, maximumBytes) {
  const combined = Buffer.concat([current, Buffer.from(chunk)]);
  return combined.length <= maximumBytes
    ? combined
    : combined.subarray(combined.length - maximumBytes);
}

function runBoundedChild(input) {
  return new Promise((resolve, reject) => {
    if (input.signal.aborted) {
      reject(input.signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    let child;
    try {
      child = spawn(input.command, input.args, {
        cwd: input.cwd,
        windowsHide: true,
        detached: process.platform !== "win32",
        env: input.env,
        stdio: [input.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let totalOutputBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let streamError = null;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const stop = () => { void terminateProcessTree(child); };
    const onAbort = () => stop();
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, input.timeoutMs);
    timeout.unref?.();
    child.stdout?.on("data", (chunk) => {
      totalOutputBytes += chunk.length;
      if (totalOutputBytes > MAX_STREAM_BYTES) {
        outputExceeded = true;
        stop();
        return;
      }
      try {
        input.onStdout?.(chunk.toString("utf8"));
      } catch (error) {
        streamError = error;
        stop();
      }
      stdout = appendTail(stdout, chunk, input.stdoutBytes ?? MAX_DETAIL_BYTES);
    });
    child.stderr?.on("data", (chunk) => {
      totalOutputBytes += chunk.length;
      if (totalOutputBytes > MAX_STREAM_BYTES) {
        outputExceeded = true;
        stop();
        return;
      }
      stderr = appendTail(stderr, chunk, MAX_DETAIL_BYTES);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (input.signal.aborted) {
        finish(input.signal.reason ?? new DOMException("Aborted", "AbortError"));
      } else if (streamError) {
        finish(streamError);
      } else if (outputExceeded) {
        finish(new Error("Deep Tutor produced more output than the Runtime contract permits."));
      } else {
        finish(null, {
          code,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          timedOut,
        });
      }
    });
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.stdin !== undefined) {
      child.stdin?.once("error", (error) => {
        stop();
        finish(error);
      });
      child.stdin?.end(input.stdin);
    }
    if (input.signal.aborted) onAbort();
  });
}

function finalLine(value) {
  const line = value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean).at(-1) ?? "";
  return Buffer.from(line, "utf8").subarray(0, MAX_DETAIL_BYTES).toString("utf8");
}

function errorMessage(error, fallback) {
  const raw = error instanceof Error ? error.message : fallback;
  return Buffer.from(raw, "utf8").subarray(0, MAX_DETAIL_BYTES).toString("utf8") || fallback;
}

export async function executeDeepTutorProbe(launch, signal) {
  const startedAt = Date.now();
  validateDeepTutorProbeRequest(launch.request);
  try {
    const root = cloneRoot();
    const result = await runBoundedChild({
      command: pythonExecutable(),
      args: [
        "-c",
        "import importlib.util as u; import deeptutor; from deeptutor.app import DeepTutorApp;"
          + " print('ok mcp' if u.find_spec('mcp') else 'ok')",
      ],
      cwd: root,
      env: childEnvironment({ DEEPTUTOR_CLONE_ROOT: root }),
      signal,
      timeoutMs: PROBE_TIMEOUT_MS,
      stdoutBytes: 32 * 1024,
    });
    const packageInstalled = result.code === 0 && result.stdout.includes("ok");
    return {
      packageInstalled,
      mcpInstalled: packageInstalled && result.stdout.includes("ok mcp"),
      timedOut: result.timedOut,
      detail: packageInstalled ? "" : finalLine(result.stderr),
      durationMs: Math.min(Date.now() - startedAt, PROBE_TIMEOUT_MS + 30_000),
    };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      packageInstalled: false,
      mcpInstalled: false,
      timedOut: false,
      detail: errorMessage(error, "The Deep Tutor environment could not be inspected."),
      durationMs: Math.min(Date.now() - startedAt, PROBE_TIMEOUT_MS + 30_000),
    };
  }
}

function indexableDocuments(root) {
  const found = [];
  let pathBytes = 0;
  const walk = (directory, depth) => {
    if (depth > 6 || found.length >= MAX_INDEXED_FILES) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (found.length >= MAX_INDEXED_FILES) return;
      if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (!pathWithin(root, full)) continue;
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !INDEXABLE.has(path.extname(full).toLowerCase())) continue;
      try {
        const metadata = fs.lstatSync(full);
        const bytes = Buffer.byteLength(full, "utf8");
        if (
          !metadata.isFile() ||
          metadata.isSymbolicLink() ||
          metadata.size < 1 ||
          metadata.size > MAX_INDEXED_FILE_BYTES ||
          bytes > MAX_PATH_BYTES ||
          pathBytes + bytes > 4 * 1024 * 1024
        ) continue;
        found.push({
          path: full,
          size: metadata.size,
          modified: Math.trunc(metadata.mtimeMs),
        });
        pathBytes += bytes;
      } catch {
        // A file that vanished during the scan is not admitted to this build.
      }
    }
  };
  walk(root, 0);
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

function parseIndexerEvent(line) {
  if (!line.trim()) return null;
  if (Buffer.byteLength(line, "utf8") > MAX_STREAM_LINE_BYTES) {
    fail("The Deep Tutor indexer emitted an oversized event.");
  }
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    fail("The Deep Tutor indexer emitted invalid progress JSON.");
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    fail("The Deep Tutor indexer emitted an invalid progress event.");
  }
  return value;
}

function safeProgress(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.trunc(value))) : 0;
}

function writeManifest(home, manifest) {
  const target = path.join(home, "breadboard-index.json");
  const existing = fs.lstatSync(target, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    fail("The Deep Tutor index manifest is indirect.");
  }
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_MANIFEST_BYTES) {
    fail("The Deep Tutor index manifest exceeded its bound.");
  }
  const pending = `${target}.pending-${process.pid}-${crypto.randomUUID()}`;
  let descriptor;
  try {
    descriptor = fs.openSync(pending, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(pending, target);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(pending, { force: true });
    throw error;
  }
}

export async function executeDeepTutorIndex(launch, signal, progress) {
  const startedAt = Date.now();
  const request = validateDeepTutorIndexRequest(launch.request);
  if (
    launch.executionScope.conversationId !== deepTutorIndexConversationId(request.scopeId)
  ) fail("The Deep Tutor index request is outside its authenticated worker scope.");
  let candidateCount = 0;
  try {
    const root = directPath(request.root, "directory", "The authorized Deep Tutor Garden root");
    const clone = cloneRoot();
    const home = scopedHome(launch, request.scopeId);
    progress.checkpoint({
      operation: "index",
      kb: request.kb,
      candidateCount: 0,
      stage: "scanning",
      percent: 0,
      startedAt,
    });
    const documents = indexableDocuments(root);
    candidateCount = documents.length;
    if (!candidateCount) fail("There is nothing to index in this Garden yet.");
    const childInput = Buffer.from(`${JSON.stringify({
      home,
      kb: request.kb,
      documents: documents.map((document) => document.path),
    })}\n`, "utf8");
    if (childInput.byteLength > 8 * 1024 * 1024) {
      fail("The Deep Tutor index request exceeded its fixed child-input bound.");
    }
    let buffer = "";
    let completed = null;
    let reportedFailure = null;
    const publish = (stage, percent) => progress.checkpoint({
      operation: "index",
      kb: request.kb,
      candidateCount,
      stage,
      percent: safeProgress(percent),
      startedAt,
    });
    publish("starting", 0);
    const result = await runBoundedChild({
      command: pythonExecutable(),
      args: [indexScript(clone)],
      cwd: clone,
      env: childEnvironment({
        DEEPTUTOR_CLONE_ROOT: clone,
        DEEPTUTOR_HOME: home,
      }),
      signal,
      timeoutMs: INDEX_TIMEOUT_MS,
      stdin: childInput,
      stdoutBytes: MAX_STREAM_LINE_BYTES,
      onStdout(chunk) {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          const event = parseIndexerEvent(line);
          if (event?.type === "progress") {
            const stage = boundedText(event.stage, 128) ? event.stage : "indexing";
            publish(stage, event.percent);
          } else if (event?.type === "completed") {
            completed = {
              documents: Number.isSafeInteger(event.documents) && event.documents >= 0
                ? event.documents
                : documents.length,
              chunks: Number.isSafeInteger(event.chunks) && event.chunks >= 0
                ? event.chunks
                : 0,
            };
          } else if (event?.type === "failed") {
            reportedFailure = boundedText(event.error, MAX_DETAIL_BYTES)
              ? event.error
              : "Deep Tutor reported an indexing failure.";
          }
          newline = buffer.indexOf("\n");
        }
        if (Buffer.byteLength(buffer, "utf8") > MAX_STREAM_LINE_BYTES) {
          fail("The Deep Tutor indexer emitted an unterminated oversized event.");
        }
      },
    });
    if (result.timedOut) fail("Indexing ran past its time limit and was stopped.");
    if (reportedFailure) fail(reportedFailure);
    if (result.code !== 0 || !completed) {
      const detail = finalLine(result.stderr);
      fail(`Indexing stopped unexpectedly (exit ${result.code ?? "unknown"}). ${detail}`.trim());
    }
    const builtAt = new Date().toISOString();
    writeManifest(home, {
      kb: request.kb,
      fingerprint: request.fingerprint,
      builtAt,
      documents,
      documentCount: completed.documents || documents.length,
      chunkCount: completed.chunks,
    });
    publish("completed", 100);
    return {
      ok: true,
      kb: request.kb,
      fingerprint: request.fingerprint,
      builtAt,
      candidateCount,
      documentCount: completed.documents || documents.length,
      chunkCount: completed.chunks,
      durationMs: Math.min(Date.now() - startedAt, INDEX_TIMEOUT_MS + 60_000),
      error: "",
    };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      ok: false,
      kb: request.kb,
      fingerprint: request.fingerprint,
      builtAt: null,
      candidateCount,
      documentCount: 0,
      chunkCount: 0,
      durationMs: Math.min(Date.now() - startedAt, INDEX_TIMEOUT_MS + 60_000),
      error: errorMessage(error, "The Deep Tutor index could not be built."),
    };
  }
}
