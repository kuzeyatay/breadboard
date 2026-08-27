import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SNAPSHOT_REF_PREFIX = "refs/breadboard/agent-edits";
const SNAPSHOT_INDEX = "breadboard-agent-edits-index";
const GIT_TIMEOUT_MS = 120_000;
const MAX_GIT_BUFFER = 64 * 1024 * 1024;
const MAX_PATH_BYTES = 32 * 1024;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const GIT_BASE_ARGS = ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
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

export function isAgentEditsSnapshotId(value) {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function canonicalRepository(repositoryPath) {
  if (
    typeof repositoryPath !== "string" ||
    !path.isAbsolute(repositoryPath) ||
    repositoryPath !== repositoryPath.trim() ||
    /[\u0000\r\n]/u.test(repositoryPath) ||
    Buffer.byteLength(repositoryPath, "utf8") > MAX_PATH_BYTES
  ) throw new Error("The agent-edits repository path is invalid.");
  const resolved = path.resolve(repositoryPath);
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isDirectory()) {
    throw new Error("The agent-edits repository is unavailable.");
  }
  const canonical = fs.realpathSync.native(resolved);
  const gitPath = path.join(canonical, ".git");
  const gitMetadata = fs.lstatSync(gitPath);
  if (
    (!gitMetadata.isDirectory() && !gitMetadata.isFile()) ||
    gitMetadata.isSymbolicLink()
  ) throw new Error("The agent-edits repository is not a Git worktree.");
  return canonical;
}

function canonicalFilePath(filePath) {
  if (
    typeof filePath !== "string" ||
    !filePath ||
    path.isAbsolute(filePath) ||
    /[\u0000\r\n]/u.test(filePath) ||
    Buffer.byteLength(filePath, "utf8") > MAX_PATH_BYTES
  ) throw new Error("The agent-edits file path is invalid.");
  const segments = filePath.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("The agent-edits file path is invalid.");
  }
  return filePath;
}

export function validateAgentEditsRequest(value) {
  if (!isRecord(value) || typeof value.operation !== "string") {
    throw new Error("The canonical agent-edits request is invalid.");
  }
  const common = ["operation", "repositoryPath", "before", "after"];
  if (
    !["summary", "finalize", "patch", "undo"].includes(value.operation) ||
    !exactRecord(value, value.operation === "patch" ? [...common, "filePath"] : common) ||
    typeof value.repositoryPath !== "string" ||
    !path.isAbsolute(value.repositoryPath) ||
    value.repositoryPath !== value.repositoryPath.trim() ||
    /[\u0000\r\n]/u.test(value.repositoryPath) ||
    Buffer.byteLength(value.repositoryPath, "utf8") > MAX_PATH_BYTES ||
    !isAgentEditsSnapshotId(value.before) ||
    !isAgentEditsSnapshotId(value.after)
  ) throw new Error("The canonical agent-edits request is invalid.");
  if (value.operation === "patch") canonicalFilePath(value.filePath);
  return value;
}

function fixedGitExecutable(env = process.env) {
  const configured = env.BREADBOARD_GIT_BIN?.trim();
  if (!configured) {
    if (env.BREADBOARD_RUNTIME_V2_FIXED_TOOLS === "1") {
      throw new Error("The Runtime-owned Git executable is unavailable.");
    }
    return "git";
  }
  if (
    !path.isAbsolute(configured) ||
    /[\u0000\r\n]/u.test(configured) ||
    Buffer.byteLength(configured, "utf8") > MAX_PATH_BYTES
  ) throw new Error("The Runtime-owned Git executable is invalid.");
  const resolved = path.resolve(configured);
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("The Runtime-owned Git executable is unavailable.");
  }
  return fs.realpathSync.native(resolved);
}

function sealedGitEnvironment(extra = {}) {
  const allowed = new Set([
    "APPDATA",
    "HOME",
    "LANG",
    "LC_ALL",
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
        ([name, item]) => allowed.has(name.toUpperCase()) && item !== undefined,
      ),
    ),
    GIT_CONFIG_NOSYSTEM: "1",
    ...extra,
  };
}

function gitArgs(repositoryPath, args) {
  return ["-C", repositoryPath, ...GIT_BASE_ARGS, ...args];
}

function git(repositoryPath, args, env = sealedGitEnvironment()) {
  return execFileSync(fixedGitExecutable(), gitArgs(repositoryPath, args), {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_BUFFER,
    windowsHide: true,
    env,
  });
}

function gitWithInput(repositoryPath, args, input, env) {
  execFileSync(fixedGitExecutable(), gitArgs(repositoryPath, args), {
    input,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_BUFFER,
    windowsHide: true,
    env,
    stdio: ["pipe", "ignore", "ignore"],
  });
}

function gitBlob(repositoryPath, snapshot, filePath) {
  return execFileSync(
    fixedGitExecutable(),
    gitArgs(repositoryPath, ["cat-file", "blob", `${snapshot}:${filePath}`]),
    {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_BUFFER,
      windowsHide: true,
      env: sealedGitEnvironment(),
    },
  );
}

function snapshotEnvironment(repositoryPath) {
  const base = sealedGitEnvironment();
  const indexFile = git(
    repositoryPath,
    ["rev-parse", "--git-path", SNAPSHOT_INDEX],
    base,
  ).trim();
  return sealedGitEnvironment({
    GIT_INDEX_FILE: path.isAbsolute(indexFile)
      ? indexFile
      : path.join(repositoryPath, indexFile),
    GIT_AUTHOR_NAME: "Breadboard",
    GIT_AUTHOR_EMAIL: "agent@breadboard.local",
    GIT_COMMITTER_NAME: "Breadboard",
    GIT_COMMITTER_EMAIL: "agent@breadboard.local",
  });
}

function prepareSnapshotIndex(repositoryPath, env) {
  const indexFile = env.GIT_INDEX_FILE;
  if (!indexFile || !fs.existsSync(indexFile)) {
    try {
      git(repositoryPath, ["read-tree", "HEAD"], env);
    } catch {
      git(repositoryPath, ["read-tree", "--empty"], env);
    }
    return;
  }
  const ignored = git(
    repositoryPath,
    ["ls-files", "--cached", "--ignored", "--exclude-standard", "-z"],
    env,
  ).split("\0").filter(Boolean);
  if (ignored.length === 0) return;
  let trackedAtHead = new Set();
  try {
    trackedAtHead = new Set(
      git(repositoryPath, ["ls-tree", "-r", "--name-only", "-z", "HEAD"])
        .split("\0")
        .filter(Boolean),
    );
  } catch {
    // An unborn repository has no tracked paths to preserve.
  }
  const staleIgnored = ignored.filter((filePath) => !trackedAtHead.has(filePath));
  if (staleIgnored.length === 0) return;
  gitWithInput(
    repositoryPath,
    ["update-index", "--force-remove", "-z", "--stdin"],
    `${staleIgnored.join("\0")}\0`,
    env,
  );
}

function dropLiveDatabaseClusters(repositoryPath, env) {
  const markers = git(
    repositoryPath,
    ["ls-files", "--cached", "-z", "--", "*/PG_VERSION"],
    env,
  ).split("\0").filter(Boolean);
  if (markers.length === 0) return;
  const directories = new Set(
    markers.map((marker) => marker.slice(0, marker.lastIndexOf("/"))),
  );
  const roots = [...directories].filter(
    (candidate) => ![...directories].some(
      (other) => other !== candidate && candidate.startsWith(`${other}/`),
    ),
  );
  if (roots.length === 0) return;
  const indexed = git(
    repositoryPath,
    ["ls-files", "--cached", "-z", "--", ...roots],
    env,
  ).split("\0").filter(Boolean);
  if (indexed.length === 0) return;
  gitWithInput(
    repositoryPath,
    ["update-index", "--force-remove", "-z", "--stdin"],
    `${indexed.join("\0")}\0`,
    env,
  );
}

/** Worker-only snapshot primitive. It never runs in Next.js. */
export function captureAgentEditsSnapshot(repositoryPath) {
  try {
    const repository = canonicalRepository(repositoryPath);
    const env = snapshotEnvironment(repository);
    prepareSnapshotIndex(repository, env);
    git(repository, ["add", "--all", "--"], env);
    dropLiveDatabaseClusters(repository, env);
    const tree = git(repository, ["write-tree"], env).trim();
    if (!isAgentEditsSnapshotId(tree)) return null;
    const commit = git(
      repository,
      ["commit-tree", tree, "-m", "breadboard agent edits snapshot"],
      env,
    ).trim();
    if (!isAgentEditsSnapshotId(commit)) return null;
    git(repository, ["update-ref", `${SNAPSHOT_REF_PREFIX}/${commit}`, commit], env);
    return commit;
  } catch {
    return null;
  }
}

function parseNumstat(raw) {
  const stats = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [additions, deletions, ...rest] = line.split("\t");
    const filePath = rest.join("\t");
    if (!filePath) continue;
    const binary = additions === "-" || deletions === "-";
    stats.set(filePath, {
      additions: binary ? 0 : Number(additions) || 0,
      deletions: binary ? 0 : Number(deletions) || 0,
      binary,
    });
  }
  return stats;
}

function parseNameStatus(raw) {
  const statuses = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [code, ...rest] = line.split("\t");
    const filePath = rest.join("\t");
    if (!filePath) continue;
    statuses.set(
      filePath,
      code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified",
    );
  }
  return statuses;
}

export function summarizeAgentEdits(repositoryPath, ref) {
  const repository = canonicalRepository(repositoryPath);
  if (!isAgentEditsSnapshotId(ref?.before) || !isAgentEditsSnapshotId(ref?.after)) {
    throw new Error("The agent-edits snapshot pair is invalid.");
  }
  const diff = (format) =>
    git(repository, ["diff", "--no-renames", format, ref.before, ref.after, "--"]);
  const stats = parseNumstat(diff("--numstat"));
  const statuses = parseNameStatus(diff("--name-status"));
  const files = [];
  for (const [filePath, status] of statuses) {
    const stat = stats.get(filePath) ?? { additions: 0, deletions: 0, binary: false };
    files.push({ path: filePath, status, ...stat });
  }
  files.sort(
    (left, right) =>
      right.additions + right.deletions - (left.additions + left.deletions) ||
      left.path.localeCompare(right.path),
  );
  return {
    files,
    filesChanged: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

export function agentEditPatch(repositoryPath, ref, filePath) {
  const repository = canonicalRepository(repositoryPath);
  const canonicalFile = canonicalFilePath(filePath);
  const summary = summarizeAgentEdits(repository, ref);
  if (!summary.files.some((file) => file.path === canonicalFile)) {
    throw new Error("The requested file is not part of this agent run.");
  }
  return git(repository, [
    "diff",
    "--no-renames",
    "--no-color",
    ref.before,
    ref.after,
    "--",
    canonicalFile,
  ]);
}

function existsInSnapshot(repositoryPath, snapshot, filePath) {
  try {
    execFileSync(
      fixedGitExecutable(),
      gitArgs(repositoryPath, ["cat-file", "-e", `${snapshot}:${filePath}`]),
      {
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        stdio: "ignore",
        env: sealedGitEnvironment(),
      },
    );
    return true;
  } catch {
    return false;
  }
}

export function undoAgentEdits(repositoryPath, ref, signal) {
  const repository = canonicalRepository(repositoryPath);
  const summary = summarizeAgentEdits(repository, ref);
  const current = captureAgentEditsSnapshot(repository);
  const touchedSince = new Set(
    current
      ? git(repository, ["diff", "--no-renames", "--name-only", ref.after, current, "--"])
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : [],
  );
  const restored = [];
  const skipped = [];
  for (const file of summary.files) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (touchedSince.has(file.path)) {
      skipped.push(file.path);
      continue;
    }
    const target = path.resolve(repository, ...file.path.replaceAll("\\", "/").split("/"));
    if (!pathWithin(repository, target) || samePath(repository, target)) {
      throw new Error("The agent-edits restore path escaped its repository.");
    }
    if (existsInSnapshot(repository, ref.before, file.path)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, gitBlob(repository, ref.before, file.path));
    } else {
      fs.rmSync(target, { force: true });
    }
    restored.push(file.path);
  }
  return { restored, skipped };
}

function atomicArtifact(workspacePath, value) {
  const workspace = fs.realpathSync.native(path.resolve(workspacePath));
  const metadata = fs.lstatSync(workspace);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("The agent-edits Runtime workspace is unavailable.");
  }
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error("The agent-edits response exceeds its bounded artifact envelope.");
  }
  const target = path.join(workspace, "agent-edits-response.json");
  const pending = `${target}.pending.${process.pid}`;
  try {
    const descriptor = fs.openSync(pending, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(pending, target);
  } catch (error) {
    try {
      fs.rmSync(pending, { force: true });
    } catch {
      // Preserve the original artifact failure; Runtime workspace cleanup is
      // still authoritative for any pending file the host cannot unlink here.
    }
    throw error;
  }
  return {
    path: target,
    sizeBytes: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function executeAgentEditsOperation(launch, signal, progress) {
  const request = validateAgentEditsRequest(launch.request);
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  progress.checkpoint({ operation: request.operation, stage: "running" });
  // Let the worker consume a stop record published in response to this first
  // checkpoint before entering a synchronous Git command.
  await new Promise((resolve) => setTimeout(resolve, 25));
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const ref = { before: request.before, after: request.after };
  let response;
  if (request.operation === "patch") {
    response = {
      ok: true,
      path: request.filePath,
      patch: agentEditPatch(request.repositoryPath, ref, request.filePath),
    };
  } else if (request.operation === "undo") {
    response = { ok: true, ...undoAgentEdits(request.repositoryPath, ref, signal) };
  } else {
    const summary = summarizeAgentEdits(request.repositoryPath, ref);
    response = request.operation === "finalize"
      ? { ok: true, edits: { ...ref, ...summary } }
      : { ok: true, ...summary };
  }
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const artifact = atomicArtifact(launch.workspacePath, response);
  const relativePath = path.relative(launch.dataRoot, artifact.path).split(path.sep).join("/");
  if (!relativePath || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    throw new Error("The agent-edits artifact escaped its Runtime data root.");
  }
  return {
    operation: request.operation,
    artifactRelativePath: relativePath,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    mediaType: "application/json",
  };
}
