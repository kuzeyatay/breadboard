import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const BUILD_TIMEOUT_MS = 20 * 60_000;
const MAX_REPOSITORY_PATH_BYTES = 32 * 1024;
const MAX_OUTPUT_TAIL_BYTES = 64 * 1024;

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
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function validateGraftIndexRequest(value) {
  if (
    !exactRecord(value, ["repositoryPath"]) ||
    typeof value.repositoryPath !== "string" ||
    !path.isAbsolute(value.repositoryPath) ||
    value.repositoryPath !== value.repositoryPath.trim() ||
    /[\u0000\r\n]/u.test(value.repositoryPath) ||
    Buffer.byteLength(value.repositoryPath, "utf8") > MAX_REPOSITORY_PATH_BYTES
  ) {
    throw new Error("The canonical Graft index request is invalid.");
  }
  return value;
}

function directRepository(repositoryPath) {
  const resolved = path.resolve(repositoryPath);
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("The authorized Graft repository is unavailable.");
  }
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) {
    throw new Error("The authorized Graft repository changed after admission.");
  }
  const gitMetadata = fs.lstatSync(path.join(canonical, ".git"));
  if (
    (!gitMetadata.isDirectory() && !gitMetadata.isFile()) ||
    gitMetadata.isSymbolicLink()
  ) {
    throw new Error("The authorized Graft repository is not a Git worktree.");
  }
  return canonical;
}

function repositoryKey(repositoryPath) {
  const normalized = process.platform === "win32"
    ? path.resolve(repositoryPath).toLowerCase()
    : path.resolve(repositoryPath);
  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

function ensureDirectDirectory(root, ...segments) {
  const canonicalRoot = fs.realpathSync.native(path.resolve(root));
  let current = canonicalRoot;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || /[\\/\u0000]/u.test(segment)) {
      throw new Error("The Runtime-owned Graft directory is invalid.");
    }
    current = path.join(current, segment);
    if (!pathWithin(canonicalRoot, current)) {
      throw new Error("The Runtime-owned Graft directory escaped its data root.");
    }
    try {
      const metadata = fs.lstatSync(current);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error("The Runtime-owned Graft directory is unavailable.");
      }
    } catch (error) {
      if (!isRecord(error) || error.code !== "ENOENT") throw error;
      fs.mkdirSync(current, { recursive: false, mode: 0o700 });
      const metadata = fs.lstatSync(current);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error("The Runtime-owned Graft directory could not be created safely.");
      }
    }
  }
  return current;
}

function graphPaths(launch, repositoryPath) {
  const graphRoot = ensureDirectDirectory(launch.dataRoot, "runtime-v2", "graft");
  const label = path.basename(repositoryPath).replace(/[^A-Za-z0-9._-]/gu, "-") || "repository";
  const graphName = `${label}-${repositoryKey(repositoryPath)}`;
  const graphDirectory = path.join(graphRoot, graphName);
  const stageName = `${graphName}.pending-${launch.identity.jobId}-${launch.identity.attempt}-${launch.identity.workerInstanceId}`;
  const stageDirectory = path.join(graphRoot, stageName);
  if (!pathWithin(graphRoot, graphDirectory) || !pathWithin(graphRoot, stageDirectory)) {
    throw new Error("The fenced Graft graph path escaped its Runtime root.");
  }
  return { graphRoot, graphDirectory, stageDirectory };
}

export function resolveRuntimeGraftCli(env = process.env) {
  const configured = env.BREADBOARD_GRAFT_CLI?.trim();
  if (
    !configured ||
    !path.isAbsolute(configured) ||
    /[\u0000\r\n]/u.test(configured) ||
    Buffer.byteLength(configured, "utf8") > MAX_REPOSITORY_PATH_BYTES
  ) {
    throw new Error("The Runtime-owned Graft CLI is unavailable.");
  }
  const resolved = path.resolve(configured);
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("The Runtime-owned Graft CLI is unavailable.");
  }
  return fs.realpathSync.native(resolved);
}

function systemRoot() {
  const value = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!value || !path.isAbsolute(value) || /[\u0000\r\n]/u.test(value)) {
    throw new Error("The Runtime-owned system environment is unavailable.");
  }
  return path.resolve(value);
}

function sealedEnvironment() {
  const allowed = new Set([
    "APPDATA",
    "HOME",
    "LANG",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
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
    NO_COLOR: "1",
  };
}

async function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const taskkill = path.join(systemRoot(), "System32", "taskkill.exe");
    await new Promise((resolve) => {
      let killer;
      try {
        killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
          env: sealedEnvironment(),
        });
      } catch {
        try { child.kill(); } catch {}
        resolve();
        return;
      }
      killer.once("error", () => {
        try { child.kill(); } catch {}
        resolve();
      });
      killer.once("close", resolve);
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch {}
  }
}

function appendTail(current, chunk) {
  const combined = Buffer.concat([current, chunk]);
  return combined.length <= MAX_OUTPUT_TAIL_BYTES
    ? combined
    : combined.subarray(combined.length - MAX_OUTPUT_TAIL_BYTES);
}

function directIndexExists(directory) {
  try {
    const metadata = fs.lstatSync(path.join(directory, "INDEX.md"));
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function removeOwnedDirectory(graphRoot, directory) {
  if (!pathWithin(graphRoot, directory) || samePath(graphRoot, directory)) {
    throw new Error("Refusing to remove a Graft path outside its Runtime root.");
  }
  try {
    const metadata = fs.lstatSync(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("The Runtime-owned Graft directory is unsafe to replace.");
    }
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return;
    throw error;
  }
  fs.rmSync(directory, { recursive: true, force: false });
}

function runGraftBuild({ cliPath, repositoryPath, stageDirectory, signal }) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const child = spawn(
      process.execPath,
      [cliPath, "--dir", stageDirectory, "build", repositoryPath],
      {
        cwd: repositoryPath,
        windowsHide: true,
        detached: process.platform !== "win32",
        env: sealedEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timedOut = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const stop = () => {
      void terminateProcessTree(child);
    };
    const onAbort = () => stop();
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, BUILD_TIMEOUT_MS);
    timeout.unref?.();
    child.stdout.on("data", (chunk) => { stdout = appendTail(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendTail(stderr, chunk); });
    child.once("error", (error) => finish(error));
    child.once("close", (exitCode) => {
      if (signal.aborted) {
        finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
      } else if (timedOut) {
        finish(new Error("The Graft index build exceeded its fixed Runtime deadline."));
      } else if (exitCode === 0) {
        finish();
      } else {
        const detail = (stderr.length ? stderr : stdout).toString("utf8").trim();
        finish(new Error(detail
          ? `The Graft index builder exited with code ${exitCode}: ${detail}`
          : `The Graft index builder exited with code ${exitCode}.`));
      }
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export async function executeGraftIndexBuild(launch, signal, progress) {
  const startedAt = Date.now();
  const request = validateGraftIndexRequest(launch.request);
  const repositoryPath = directRepository(request.repositoryPath);
  const { graphRoot, graphDirectory, stageDirectory } = graphPaths(launch, repositoryPath);
  if (directIndexExists(graphDirectory)) {
    return { built: false, durationMs: Date.now() - startedAt, ready: true };
  }
  removeOwnedDirectory(graphRoot, stageDirectory);
  fs.mkdirSync(stageDirectory, { recursive: false, mode: 0o700 });
  progress.checkpoint({ stage: "building", startedAt });
  try {
    await runGraftBuild({
      cliPath: resolveRuntimeGraftCli(),
      repositoryPath,
      stageDirectory,
      signal,
    });
    if (signal.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (!directIndexExists(stageDirectory)) {
      throw new Error("The Graft builder did not produce a complete index.");
    }
    if (directIndexExists(graphDirectory)) {
      removeOwnedDirectory(graphRoot, stageDirectory);
    } else {
      removeOwnedDirectory(graphRoot, graphDirectory);
      fs.renameSync(stageDirectory, graphDirectory);
    }
    if (!directIndexExists(graphDirectory)) {
      throw new Error("The Graft index could not be promoted atomically.");
    }
    return { built: true, durationMs: Date.now() - startedAt, ready: true };
  } finally {
    removeOwnedDirectory(graphRoot, stageDirectory);
  }
}

const launchedAsEntry = process.argv[1] &&
  samePath(process.argv[1], fileURLToPath(import.meta.url));
if (launchedAsEntry) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-graft-index-worker",
    validateRequest: validateGraftIndexRequest,
    expectedInputCount: () => 0,
    execute: executeGraftIndexBuild,
  });
}
