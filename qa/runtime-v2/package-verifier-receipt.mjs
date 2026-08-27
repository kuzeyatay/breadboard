import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const PACKAGE_VERIFIER_RECEIPT_SCHEMA_VERSION = 1;
export const PACKAGE_VERIFIER_RECEIPT_KIND =
  "breadboard-runtime-v2-package-verifier-receipt";

const PACKAGE_TREE_ALGORITHM = "breadboard-package-tree-sha256-v1";
const FILE_SET_ALGORITHM = "breadboard-source-file-set-sha256-v1";
const VERIFIER_PATH = "desktop/scripts/verify-package.mjs";
const POLICY_INPUT_PATHS = Object.freeze([
  "desktop/electron-builder.yml",
  "desktop/runtime-v2/manifests/services.json",
  "desktop/runtime-v2/manifests/workers.json",
]);
const CRITICAL_ARTIFACT_PATHS = Object.freeze({
  breadboardExecutable: "Breadboard.exe",
  appAsar: "resources/app.asar",
  runtimeServicesManifest: "resources/runtime-v2/manifests/services.json",
  runtimeWorkersManifest: "resources/runtime-v2/manifests/workers.json",
  dashboardRuntimeEntrypoint:
    "resources/app-services/dashboard/scripts/runtime-v2-dashboard.mjs",
  bundledNode: "resources/runtimes/node/node.exe",
  bundledBun: "resources/runtimes/bun/bun.exe",
  bundledPython: "resources/runtimes/python/python.exe",
  codex: "resources/bin/codex.exe",
  runtimeSupervisor: "resources/bin/runtime-supervisor.exe",
  breadboardRuntime: "resources/bin/breadboard-runtime.exe",
});
const CRITICAL_ARTIFACT_NAMES = Object.freeze(Object.keys(CRITICAL_ARTIFACT_PATHS));
const RECEIPT_ROOTS = Object.freeze([".qa-results/", "qa/runtime-v2/evidence/"]);
const MAX_RECEIPT_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_VERIFIER_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_VERIFICATION_DURATION_MS = 12 * 60 * 60_000;
const MAX_RECEIPT_AGE_MS = 12 * 60 * 60_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const FILE_TIME_TOLERANCE_MS = 5 * 60_000;
const SHA256_PATTERN = /^[0-9A-F]{64}$/u;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

let fullPackageTreeSnapshotCount = 0;
let criticalArtifactOnlySnapshotCount = 0;
const validatedPackageAuthorities = new WeakSet();

export function getPackageVerifierReceiptDiagnostics() {
  return Object.freeze({
    fullPackageTreeSnapshotCount,
    criticalArtifactOnlySnapshotCount,
  });
}

function fail(message) {
  throw new Error(`Runtime V2 package verifier receipt rejected: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} fields must be exactly ${wanted.join(", ")}.`);
  }
}

function rejectUnknownOptionKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    fail(`${label} has unexpected option(s): ${unexpected.sort().join(", ")}.`);
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function same(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function deepFreeze(value) {
  if (!isRecord(value) && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function sha256Text(value) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

function canonicalJsonSha256(value) {
  return sha256Text(JSON.stringify(stableValue(value)));
}

function uppercaseSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} must be an uppercase SHA-256.`);
  }
  return value;
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer.`);
  return value;
}

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer.`);
  return value;
}

function canonicalIso(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical ISO timestamp.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(`${label} must be a canonical ISO timestamp.`);
  }
  return parsed;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function canonicalRepoRoot(repoRoot) {
  if (typeof repoRoot !== "string" || !path.isAbsolute(repoRoot)) {
    fail("repoRoot must be an existing absolute directory.");
  }
  const resolved = fs.realpathSync(path.resolve(repoRoot));
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    fail("repoRoot must be an existing direct directory.");
  }
  return resolved;
}

function canonicalRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes("\\") ||
    value.includes("\0") ||
    /[\r\n]/u.test(value) ||
    path.posix.isAbsolute(value)
  ) {
    fail(`${label} is not a canonical relative path.`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail(`${label} is not a canonical relative path.`);
  }
  return value;
}

function receiptRelativePath(repoRoot, receiptPath) {
  if (typeof receiptPath !== "string" || receiptPath.length === 0) {
    fail("receiptPath must identify a new receipt under an immutable QA evidence root.");
  }
  const absolute = path.isAbsolute(receiptPath)
    ? path.resolve(receiptPath)
    : path.resolve(repoRoot, ...receiptPath.replaceAll("\\", "/").split("/"));
  if (!withinRoot(repoRoot, absolute)) fail("receiptPath escapes repoRoot.");
  const relative = canonicalRelativePath(path.relative(repoRoot, absolute).replaceAll("\\", "/"), "receiptPath");
  if (!RECEIPT_ROOTS.some((prefix) => relative.startsWith(prefix))) {
    fail("receiptPath must live under .qa-results/ or qa/runtime-v2/evidence/.");
  }
  return Object.freeze({ absolute, relative });
}

function assertDirectPath(root, absolutePath, label, { allowMissingLeaf = false } = {}) {
  if (!withinRoot(root, absolutePath)) fail(`${label} escapes its authority root.`);
  const relative = path.relative(root, absolutePath);
  const segments = relative === "" ? [] : relative.split(path.sep);
  let cursor = root;
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    const metadata = fs.lstatSync(cursor, { throwIfNoEntry: false });
    if (!metadata) {
      if (allowMissingLeaf) return;
      fail(`${label} is missing.`);
    }
    if (metadata.isSymbolicLink()) fail(`${label} traverses a symbolic link or junction.`);
    if (index < segments.length - 1 && !metadata.isDirectory()) {
      fail(`${label} has a non-directory parent component.`);
    }
  }
}

function canonicalAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value) {
    fail(`${label} must be a normalized absolute path.`);
  }
  return value;
}

function normalizedPathForHash(value) {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function absolutePathSha256(value) {
  return sha256Text(normalizedPathForHash(value));
}

function sameFileState(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function snapshotFile(
  file,
  label,
  maxBytes = Number.MAX_SAFE_INTEGER,
  { allowEmpty = false } = {},
) {
  const before = fs.statSync(file, { throwIfNoEntry: false });
  if (
    !before?.isFile() ||
    before.size < 0 ||
    (!allowEmpty && before.size === 0) ||
    before.size > maxBytes
  ) {
    fail(
      `${label} must be a ${allowEmpty ? "regular" : "non-empty regular"} file no larger than ${maxBytes} bytes.`,
    );
  }
  const descriptor = fs.openSync(file, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  const after = fs.statSync(file, { throwIfNoEntry: false });
  if (!after?.isFile() || !sameFileState(before, after)) {
    fail(`${label} changed while it was being hashed.`);
  }
  return Object.freeze({
    bytes: after.size,
    sha256: hash.digest("hex").toUpperCase(),
    _state: Object.freeze({
      dev: after.dev,
      ino: after.ino,
      size: after.size,
      mtimeMs: after.mtimeMs,
      ctimeMs: after.ctimeMs,
    }),
  });
}

function updateLengthFramed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function digestFileReferences(domain, references) {
  const hash = createHash("sha256");
  updateLengthFramed(hash, domain);
  for (const reference of references) {
    updateLengthFramed(hash, reference.path);
    updateLengthFramed(hash, String(reference.bytes));
    updateLengthFramed(hash, Buffer.from(reference.sha256, "hex"));
  }
  return hash.digest("hex").toUpperCase();
}

function digestTree(directories, files) {
  const hash = createHash("sha256");
  updateLengthFramed(hash, PACKAGE_TREE_ALGORITHM);
  for (const directory of directories) {
    updateLengthFramed(hash, "D");
    updateLengthFramed(hash, directory);
  }
  for (const file of files) {
    updateLengthFramed(hash, "F");
    updateLengthFramed(hash, file.path);
    updateLengthFramed(hash, String(file.bytes));
    updateLengthFramed(hash, Buffer.from(file.sha256, "hex"));
  }
  return hash.digest("hex").toUpperCase();
}

function digestStates(directories, files) {
  const hash = createHash("sha256");
  updateLengthFramed(hash, "BREADBOARD_PACKAGE_TREE_STATE_V1");
  for (const directory of directories) {
    updateLengthFramed(hash, "D");
    updateLengthFramed(hash, directory);
  }
  for (const entry of files) {
    updateLengthFramed(hash, "F");
    updateLengthFramed(hash, entry.path);
    for (const field of ["dev", "ino", "size", "mtimeMs", "ctimeMs"]) {
      updateLengthFramed(hash, field);
      updateLengthFramed(hash, String(entry._state[field]));
    }
  }
  return hash.digest("hex").toUpperCase();
}

function enumeratePackageTree(packageRoot) {
  const directories = [];
  const files = [];
  const visit = (absoluteDirectory, relativeDirectory) => {
    const children = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
    children.sort((left, right) => compareText(left.name, right.name));
    for (const child of children) {
      if (/\0|\r|\n/u.test(child.name)) fail("package tree contains a non-canonical path name.");
      const absolute = path.join(absoluteDirectory, child.name);
      const relative = relativeDirectory
        ? `${relativeDirectory}/${child.name}`
        : child.name;
      canonicalRelativePath(relative, "package tree path");
      const metadata = fs.lstatSync(absolute, { throwIfNoEntry: false });
      if (!metadata) fail(`package tree entry disappeared during enumeration: ${relative}.`);
      if (metadata.isSymbolicLink()) {
        fail(`package tree contains a symbolic link or junction: ${relative}.`);
      }
      if (metadata.isDirectory()) {
        directories.push(relative);
        visit(absolute, relative);
      } else if (metadata.isFile()) {
        files.push(relative);
      } else {
        fail(`package tree contains a non-file entry: ${relative}.`);
      }
    }
  };
  visit(packageRoot, "");
  return Object.freeze({ directories: Object.freeze(directories), files: Object.freeze(files) });
}

function snapshotPackageTree(packageRoot) {
  fullPackageTreeSnapshotCount += 1;
  const firstEnumeration = enumeratePackageTree(packageRoot);
  const files = [];
  let totalBytes = 0;
  for (const relative of firstEnumeration.files) {
    const absolute = path.resolve(packageRoot, ...relative.split("/"));
    assertDirectPath(packageRoot, absolute, `package file ${relative}`);
    const identity = snapshotFile(absolute, `package file ${relative}`, Number.MAX_SAFE_INTEGER, {
      allowEmpty: true,
    });
    totalBytes += identity.bytes;
    if (!Number.isSafeInteger(totalBytes)) fail("package closure byte count exceeds safe integer range.");
    files.push(Object.freeze({ path: relative, ...identity }));
  }
  const finalEnumeration = enumeratePackageTree(packageRoot);
  if (
    !same(firstEnumeration.directories, finalEnumeration.directories) ||
    !same(firstEnumeration.files, finalEnumeration.files)
  ) {
    fail("package tree changed while its recursive closure was being captured.");
  }
  for (const entry of files) {
    const current = fs.statSync(path.resolve(packageRoot, ...entry.path.split("/")), {
      throwIfNoEntry: false,
    });
    if (!current?.isFile() || !sameFileState(entry._state, current)) {
      fail(`package file changed during closure finalization: ${entry.path}.`);
    }
  }
  const publicFiles = files.map(({ _state, ...entry }) => Object.freeze(entry));
  const closure = Object.freeze({
    algorithm: PACKAGE_TREE_ALGORITHM,
    directoryCount: firstEnumeration.directories.length,
    fileCount: publicFiles.length,
    totalBytes,
    sha256: digestTree(firstEnumeration.directories, publicFiles),
  });
  return Object.freeze({
    closure,
    directories: firstEnumeration.directories,
    files: Object.freeze(publicFiles),
    stateSha256: digestStates(firstEnumeration.directories, files),
  });
}

function packageRootFromExecutable(executablePath) {
  if (typeof executablePath !== "string" || !path.isAbsolute(executablePath)) {
    fail("executablePath must be the absolute path to packaged Breadboard.exe.");
  }
  const resolvedExecutable = fs.realpathSync(path.resolve(executablePath));
  if (path.basename(resolvedExecutable).toLowerCase() !== "breadboard.exe") {
    fail("executablePath must identify Breadboard.exe.");
  }
  const identity = snapshotFile(resolvedExecutable, "packaged Breadboard.exe");
  const packageRoot = fs.realpathSync(path.dirname(resolvedExecutable));
  if (path.basename(packageRoot).toLowerCase() !== "win-unpacked") {
    fail("Breadboard.exe must be the direct child of a win-unpacked directory.");
  }
  if (path.dirname(resolvedExecutable) !== packageRoot) {
    fail("executablePath traverses a symbolic link or junction.");
  }
  return Object.freeze({ packageRoot, resolvedExecutable, identity });
}

function packageRootFromReceipt(receipt) {
  const candidate = canonicalAbsolutePath(receipt.package.rootPath, "package.rootPath");
  const resolved = fs.realpathSync(candidate);
  if (resolved !== candidate) fail("package.rootPath no longer resolves to its recorded direct path.");
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    fail("package.rootPath is not a direct directory.");
  }
  if (path.basename(resolved).toLowerCase() !== "win-unpacked") {
    fail("package.rootPath must identify win-unpacked.");
  }
  return resolved;
}

function snapshotCriticalArtifacts(packageRoot, packageTree = null) {
  if (packageTree === null) criticalArtifactOnlySnapshotCount += 1;
  const treeFiles = packageTree
    ? new Map(packageTree.files.map((entry) => [entry.path, entry]))
    : null;
  const critical = {};
  for (const name of CRITICAL_ARTIFACT_NAMES) {
    const relative = CRITICAL_ARTIFACT_PATHS[name];
    const absolute = path.resolve(packageRoot, ...relative.split("/"));
    assertDirectPath(packageRoot, absolute, `critical artifact ${relative}`);
    let identity = treeFiles?.get(relative);
    if (!identity) {
      if (treeFiles) fail(`critical artifact is absent from the package closure: ${relative}.`);
      identity = snapshotFile(absolute, `critical artifact ${relative}`);
    }
    const reference = { path: relative, bytes: identity.bytes, sha256: identity.sha256 };
    if (name === "breadboardExecutable") {
      reference.pathSha256 = absolutePathSha256(fs.realpathSync(absolute));
    }
    critical[name] = Object.freeze(reference);
  }
  return deepFreeze(critical);
}

function criticalArtifactsSha256(criticalArtifacts) {
  return canonicalJsonSha256(criticalArtifacts);
}

function snapshotPackageClosureAndCritical(packageRoot) {
  const tree = snapshotPackageTree(packageRoot);
  const criticalArtifacts = snapshotCriticalArtifacts(packageRoot, tree);
  return Object.freeze({
    closure: tree.closure,
    stateSha256: tree.stateSha256,
    criticalArtifacts,
  });
}

function extractLocalModuleSpecifiers(source) {
  const found = new Set();
  const staticPattern = /(?:^|[\r\n])\s*(?:import\s+(?:(?:[\w$*\{\},\s]+?)\s+from\s+)?|export\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[\w$,\s]*\})\s+(?:from\s+))(["'])([^"'\r\n]+)\1/gu;
  const dynamicPattern = /\bimport\s*\(\s*(["'])([^"'\r\n]+)\1/gu;
  for (const pattern of [staticPattern, dynamicPattern]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier.startsWith("./") || specifier.startsWith("../")) found.add(specifier);
    }
  }
  return [...found].sort(compareText);
}

function resolveRepoSourceModule(repoRoot, importer, specifier) {
  if (specifier.includes("?") || specifier.includes("#") || specifier.includes("\0")) {
    fail(`local source import is not a direct file specifier: ${specifier}.`);
  }
  const candidate = path.resolve(path.dirname(importer), ...specifier.replaceAll("\\", "/").split("/"));
  if (!withinRoot(repoRoot, candidate)) fail(`local source import escapes repoRoot: ${specifier}.`);
  assertDirectPath(repoRoot, candidate, `local source import ${specifier}`);
  const metadata = fs.lstatSync(candidate, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    fail(`local source import is not a direct regular file: ${specifier}.`);
  }
  const resolved = fs.realpathSync(candidate);
  if (resolved !== candidate) fail(`local source import traverses a link: ${specifier}.`);
  return resolved;
}

function snapshotVerifierImportClosure(repoRoot) {
  const verifier = path.resolve(repoRoot, ...VERIFIER_PATH.split("/"));
  assertDirectPath(repoRoot, verifier, "fixed package verifier");
  const pending = [verifier];
  const visited = new Set();
  const files = [];
  const states = [];
  while (pending.length > 0) {
    const current = pending.shift();
    const relative = path.relative(repoRoot, current).replaceAll("\\", "/");
    if (visited.has(relative)) continue;
    visited.add(relative);
    const identity = snapshotFile(current, `verifier source ${relative}`, MAX_SOURCE_BYTES);
    const bytes = fs.readFileSync(current);
    const afterRead = fs.statSync(current, { throwIfNoEntry: false });
    if (!afterRead?.isFile() || !sameFileState(identity._state, afterRead)) {
      fail(`verifier source changed while imports were being inspected: ${relative}.`);
    }
    const source = bytes.toString("utf8");
    if (!Buffer.from(source, "utf8").equals(bytes)) {
      fail(`verifier source is not canonical UTF-8: ${relative}.`);
    }
    if (sha256Bytes(bytes) !== identity.sha256) {
      fail(`verifier source changed between hashing and import inspection: ${relative}.`);
    }
    files.push(Object.freeze({ path: relative, bytes: identity.bytes, sha256: identity.sha256 }));
    states.push(Object.freeze({ path: relative, state: identity._state }));
    for (const specifier of extractLocalModuleSpecifiers(source)) {
      pending.push(resolveRepoSourceModule(repoRoot, current, specifier));
    }
  }
  files.sort((left, right) => compareText(left.path, right.path));
  states.sort((left, right) => compareText(left.path, right.path));
  const totalBytes = files.reduce((sum, entry) => sum + entry.bytes, 0);
  if (!Number.isSafeInteger(totalBytes)) fail("verifier source closure exceeds safe integer range.");
  const closure = deepFreeze({
    algorithm: FILE_SET_ALGORITHM,
    fileCount: files.length,
    totalBytes,
    sha256: digestFileReferences("BREADBOARD_VERIFIER_IMPORT_CLOSURE_V1", files),
    files,
  });
  return Object.freeze({ closure, stateSha256: canonicalJsonSha256(states) });
}

function snapshotPolicyInputs(repoRoot) {
  const files = [];
  const states = [];
  for (const relative of POLICY_INPUT_PATHS) {
    const absolute = path.resolve(repoRoot, ...relative.split("/"));
    assertDirectPath(repoRoot, absolute, `package policy input ${relative}`);
    const identity = snapshotFile(absolute, `package policy input ${relative}`, MAX_SOURCE_BYTES);
    files.push(Object.freeze({ path: relative, bytes: identity.bytes, sha256: identity.sha256 }));
    states.push(Object.freeze({ path: relative, state: identity._state }));
  }
  files.sort((left, right) => compareText(left.path, right.path));
  states.sort((left, right) => compareText(left.path, right.path));
  const totalBytes = files.reduce((sum, entry) => sum + entry.bytes, 0);
  const closure = deepFreeze({
    algorithm: FILE_SET_ALGORITHM,
    fileCount: files.length,
    totalBytes,
    sha256: digestFileReferences("BREADBOARD_PACKAGE_POLICY_INPUTS_V1", files),
    files,
  });
  return Object.freeze({ closure, stateSha256: canonicalJsonSha256(states) });
}

function snapshotSourceAuthority(repoRoot) {
  const verifier = snapshotVerifierImportClosure(repoRoot);
  const policy = snapshotPolicyInputs(repoRoot);
  const publicAuthority = deepFreeze({
    verifierImportClosure: verifier.closure,
    policyInputs: policy.closure,
    sha256: canonicalJsonSha256({
      verifierImportClosure: verifier.closure,
      policyInputs: policy.closure,
    }),
  });
  return Object.freeze({
    authority: publicAuthority,
    stateSha256: canonicalJsonSha256({ verifier: verifier.stateSha256, policy: policy.stateSha256 }),
  });
}

function validateFileReference(reference, expectedPath, label, { executable = false } = {}) {
  exactKeys(
    reference,
    executable ? ["path", "pathSha256", "bytes", "sha256"] : ["path", "bytes", "sha256"],
    label,
  );
  if (reference.path !== expectedPath) fail(`${label}.path must be ${expectedPath}.`);
  positiveSafeInteger(reference.bytes, `${label}.bytes`);
  uppercaseSha256(reference.sha256, `${label}.sha256`);
  if (executable) uppercaseSha256(reference.pathSha256, `${label}.pathSha256`);
  return reference;
}

function validateSourceFileSet(value, label, { expectedPaths = null, requiredPath = null } = {}) {
  exactKeys(value, ["algorithm", "fileCount", "totalBytes", "sha256", "files"], label);
  if (value.algorithm !== FILE_SET_ALGORITHM) fail(`${label}.algorithm is unsupported.`);
  positiveSafeInteger(value.fileCount, `${label}.fileCount`);
  positiveSafeInteger(value.totalBytes, `${label}.totalBytes`);
  uppercaseSha256(value.sha256, `${label}.sha256`);
  if (!Array.isArray(value.files) || value.files.length !== value.fileCount) {
    fail(`${label}.files does not match fileCount.`);
  }
  const seen = new Set();
  let previous = null;
  let totalBytes = 0;
  for (let index = 0; index < value.files.length; index += 1) {
    const reference = value.files[index];
    exactKeys(reference, ["path", "bytes", "sha256"], `${label}.files[${index}]`);
    canonicalRelativePath(reference.path, `${label}.files[${index}].path`);
    positiveSafeInteger(reference.bytes, `${label}.files[${index}].bytes`);
    uppercaseSha256(reference.sha256, `${label}.files[${index}].sha256`);
    if (seen.has(reference.path) || (previous !== null && compareText(previous, reference.path) >= 0)) {
      fail(`${label}.files must be uniquely sorted by path.`);
    }
    seen.add(reference.path);
    previous = reference.path;
    totalBytes += reference.bytes;
  }
  if (totalBytes !== value.totalBytes) fail(`${label}.totalBytes does not match its files.`);
  if (expectedPaths && !same([...seen], [...expectedPaths].sort(compareText))) {
    fail(`${label}.files do not match the fixed policy input paths.`);
  }
  if (requiredPath && !seen.has(requiredPath)) fail(`${label}.files omit ${requiredPath}.`);
  const domain = label.endsWith("policyInputs")
    ? "BREADBOARD_PACKAGE_POLICY_INPUTS_V1"
    : "BREADBOARD_VERIFIER_IMPORT_CLOSURE_V1";
  if (digestFileReferences(domain, value.files) !== value.sha256) {
    fail(`${label}.sha256 does not match its file identities.`);
  }
}

function exactOkLineCount(stdout) {
  return stdout.split(/\r?\n/u).filter((line) => line === "[verify-package] OK").length;
}

function validateVerifierTranscript(verifier) {
  exactKeys(
    verifier,
    [
      "path",
      "exitCode",
      "okLine",
      "okLineCount",
      "stdout",
      "stderr",
      "stdoutBytes",
      "stderrBytes",
      "stdoutSha256",
      "stderrSha256",
    ],
    "verifier",
  );
  if (verifier.path !== VERIFIER_PATH) fail(`verifier.path must be ${VERIFIER_PATH}.`);
  if (verifier.exitCode !== 0) fail("verifier.exitCode must be zero.");
  if (verifier.okLine !== "[verify-package] OK" || verifier.okLineCount !== 1) {
    fail("verifier must contain exactly one exact [verify-package] OK line.");
  }
  if (typeof verifier.stdout !== "string" || typeof verifier.stderr !== "string") {
    fail("verifier stdout and stderr must be strings.");
  }
  const stdoutBytes = Buffer.byteLength(verifier.stdout, "utf8");
  const stderrBytes = Buffer.byteLength(verifier.stderr, "utf8");
  if (
    stdoutBytes > MAX_VERIFIER_OUTPUT_BYTES ||
    stderrBytes > MAX_VERIFIER_OUTPUT_BYTES ||
    verifier.stdoutBytes !== stdoutBytes ||
    verifier.stderrBytes !== stderrBytes
  ) {
    fail("verifier transcript byte identities are invalid.");
  }
  uppercaseSha256(verifier.stdoutSha256, "verifier.stdoutSha256");
  uppercaseSha256(verifier.stderrSha256, "verifier.stderrSha256");
  if (
    sha256Text(verifier.stdout) !== verifier.stdoutSha256 ||
    sha256Text(verifier.stderr) !== verifier.stderrSha256
  ) {
    fail("verifier transcript hashes do not match the recorded output.");
  }
  if (exactOkLineCount(verifier.stdout) !== 1) {
    fail("verifier stdout does not contain exactly one exact OK line.");
  }
  if (verifier.stdout.includes("[verify-package] FAILED:") || verifier.stderr.includes("[verify-package] FAILED:")) {
    fail("verifier transcript contains a failure marker.");
  }
}

function validateReceiptShape(receipt, { nowMs, enforceFreshness, capturedAt = null }) {
  exactKeys(
    receipt,
    [
      "schemaVersion",
      "kind",
      "runId",
      "startedAt",
      "finishedAt",
      "recordedAt",
      "package",
      "verifier",
      "sourceAuthority",
      "contentSha256",
    ],
    "receipt",
  );
  if (receipt.schemaVersion !== PACKAGE_VERIFIER_RECEIPT_SCHEMA_VERSION) {
    fail("receipt schemaVersion is unsupported.");
  }
  if (receipt.kind !== PACKAGE_VERIFIER_RECEIPT_KIND) fail("receipt kind is unsupported.");
  if (typeof receipt.runId !== "string" || !RUN_ID_PATTERN.test(receipt.runId)) {
    fail("receipt.runId is not a canonical run identifier.");
  }
  const startedAt = canonicalIso(receipt.startedAt, "receipt.startedAt");
  const finishedAt = canonicalIso(receipt.finishedAt, "receipt.finishedAt");
  const recordedAt = canonicalIso(receipt.recordedAt, "receipt.recordedAt");
  if (startedAt > finishedAt || finishedAt > recordedAt) {
    fail("receipt timestamps are not ordered.");
  }
  if (recordedAt - startedAt > MAX_VERIFICATION_DURATION_MS) {
    fail("receipt verification duration exceeds the maximum.");
  }
  if (!Number.isFinite(nowMs)) fail("nowMs must be a finite epoch millisecond value.");
  if (enforceFreshness) {
    if (recordedAt > nowMs + FUTURE_TOLERANCE_MS) fail("receipt is dated too far in the future.");
    if (nowMs - recordedAt > MAX_RECEIPT_AGE_MS) fail("receipt is stale.");
  }
  if (capturedAt !== null) {
    const receiptFileTime = canonicalIso(capturedAt, "receipt file capturedAt");
    if (Math.abs(receiptFileTime - recordedAt) > FILE_TIME_TOLERANCE_MS) {
      fail("receipt file timestamp is not contemporaneous with recordedAt.");
    }
  }

  exactKeys(
    receipt.package,
    [
      "rootName",
      "rootPath",
      "rootPathSha256",
      "closure",
      "criticalArtifacts",
      "criticalArtifactsSha256",
    ],
    "package",
  );
  if (receipt.package.rootName !== "win-unpacked") fail("package.rootName must be win-unpacked.");
  const rootPath = canonicalAbsolutePath(receipt.package.rootPath, "package.rootPath");
  if (path.basename(rootPath).toLowerCase() !== "win-unpacked") {
    fail("package.rootPath must end in win-unpacked.");
  }
  uppercaseSha256(receipt.package.rootPathSha256, "package.rootPathSha256");
  if (absolutePathSha256(rootPath) !== receipt.package.rootPathSha256) {
    fail("package.rootPathSha256 does not match package.rootPath.");
  }
  exactKeys(
    receipt.package.closure,
    ["algorithm", "directoryCount", "fileCount", "totalBytes", "sha256"],
    "package.closure",
  );
  if (receipt.package.closure.algorithm !== PACKAGE_TREE_ALGORITHM) {
    fail("package.closure.algorithm is unsupported.");
  }
  nonNegativeSafeInteger(receipt.package.closure.directoryCount, "package.closure.directoryCount");
  positiveSafeInteger(receipt.package.closure.fileCount, "package.closure.fileCount");
  positiveSafeInteger(receipt.package.closure.totalBytes, "package.closure.totalBytes");
  uppercaseSha256(receipt.package.closure.sha256, "package.closure.sha256");

  exactKeys(receipt.package.criticalArtifacts, CRITICAL_ARTIFACT_NAMES, "package.criticalArtifacts");
  for (const name of CRITICAL_ARTIFACT_NAMES) {
    validateFileReference(
      receipt.package.criticalArtifacts[name],
      CRITICAL_ARTIFACT_PATHS[name],
      `package.criticalArtifacts.${name}`,
      { executable: name === "breadboardExecutable" },
    );
  }
  const expectedExecutablePathHash = absolutePathSha256(
    path.join(rootPath, ...CRITICAL_ARTIFACT_PATHS.breadboardExecutable.split("/")),
  );
  if (
    receipt.package.criticalArtifacts.breadboardExecutable.pathSha256 !==
    expectedExecutablePathHash
  ) {
    fail("Breadboard.exe pathSha256 does not match package.rootPath.");
  }
  uppercaseSha256(receipt.package.criticalArtifactsSha256, "package.criticalArtifactsSha256");
  if (
    criticalArtifactsSha256(receipt.package.criticalArtifacts) !==
    receipt.package.criticalArtifactsSha256
  ) {
    fail("package.criticalArtifactsSha256 does not match the critical artifact identities.");
  }

  validateVerifierTranscript(receipt.verifier);
  exactKeys(
    receipt.sourceAuthority,
    ["verifierImportClosure", "policyInputs", "sha256"],
    "sourceAuthority",
  );
  validateSourceFileSet(receipt.sourceAuthority.verifierImportClosure, "sourceAuthority.verifierImportClosure", {
    requiredPath: VERIFIER_PATH,
  });
  validateSourceFileSet(receipt.sourceAuthority.policyInputs, "sourceAuthority.policyInputs", {
    expectedPaths: POLICY_INPUT_PATHS,
  });
  uppercaseSha256(receipt.sourceAuthority.sha256, "sourceAuthority.sha256");
  if (
    canonicalJsonSha256({
      verifierImportClosure: receipt.sourceAuthority.verifierImportClosure,
      policyInputs: receipt.sourceAuthority.policyInputs,
    }) !== receipt.sourceAuthority.sha256
  ) {
    fail("sourceAuthority.sha256 does not match its closures.");
  }

  const policyByPath = new Map(
    receipt.sourceAuthority.policyInputs.files.map((entry) => [entry.path, entry]),
  );
  for (const [criticalName, sourcePath] of [
    ["runtimeServicesManifest", "desktop/runtime-v2/manifests/services.json"],
    ["runtimeWorkersManifest", "desktop/runtime-v2/manifests/workers.json"],
  ]) {
    const packaged = receipt.package.criticalArtifacts[criticalName];
    const source = policyByPath.get(sourcePath);
    if (packaged.bytes !== source.bytes || packaged.sha256 !== source.sha256) {
      fail(`${criticalName} is not byte-identical to ${sourcePath}.`);
    }
  }

  uppercaseSha256(receipt.contentSha256, "receipt.contentSha256");
  const { contentSha256, ...unsealed } = receipt;
  if (canonicalJsonSha256(unsealed) !== contentSha256) {
    fail("receipt.contentSha256 does not match; the receipt was altered or incompletely sealed.");
  }
}

function readReceiptSnapshot(repoRoot, receiptPath) {
  const target = receiptRelativePath(repoRoot, receiptPath);
  assertDirectPath(repoRoot, target.absolute, "receipt");
  const linkMetadata = fs.lstatSync(target.absolute, { throwIfNoEntry: false });
  if (!linkMetadata?.isFile() || linkMetadata.isSymbolicLink()) {
    fail("receipt is missing or is not a direct regular file.");
  }
  if ((linkMetadata.mode & 0o222) !== 0) fail("receipt is not immutable/read-only.");
  if (linkMetadata.nlink !== 1) fail("receipt has an unexpected hard-link alias.");
  const before = fs.statSync(target.absolute);
  if (before.size <= 0 || before.size > MAX_RECEIPT_BYTES) {
    fail(`receipt must be between 1 and ${MAX_RECEIPT_BYTES} bytes.`);
  }
  const descriptor = fs.openSync(target.absolute, "r");
  let bytes;
  try {
    bytes = fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  const after = fs.statSync(target.absolute, { throwIfNoEntry: false });
  if (!after?.isFile() || bytes.length !== after.size || !sameFileState(before, after)) {
    fail("receipt changed while it was being read.");
  }
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`receipt is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return Object.freeze({
    receipt,
    reference: Object.freeze({
      path: target.relative,
      bytes: bytes.length,
      sha256: sha256Bytes(bytes),
      capturedAt: after.mtime.toISOString(),
    }),
    absolutePath: target.absolute,
  });
}

function validateExpectedFileIdentity(expected, actual) {
  if (expected === undefined || expected === null) return;
  if (!isRecord(expected)) fail("expectedFileIdentity must be a receipt file identity.");
  const keys = Object.keys(expected).sort();
  const three = ["bytes", "path", "sha256"].sort();
  const four = ["bytes", "capturedAt", "path", "sha256"].sort();
  if (!same(keys, three) && !same(keys, four)) {
    fail("expectedFileIdentity fields must be path, bytes, sha256, and optional capturedAt.");
  }
  canonicalRelativePath(expected.path, "expectedFileIdentity.path");
  positiveSafeInteger(expected.bytes, "expectedFileIdentity.bytes");
  uppercaseSha256(expected.sha256, "expectedFileIdentity.sha256");
  if (Object.hasOwn(expected, "capturedAt")) canonicalIso(expected.capturedAt, "expectedFileIdentity.capturedAt");
  if (!same(expected, Object.fromEntries(Object.keys(expected).map((key) => [key, actual[key]])))) {
    fail("receipt file identity does not match expectedFileIdentity.");
  }
}

function comparePackageClosure(recorded, current, label = "package closure") {
  if (!same(recorded, current)) fail(`${label} no longer matches the recorded win-unpacked tree.`);
}

function compareSourceAuthority(recorded, current) {
  if (!same(recorded, current)) {
    fail("verifier/source authority no longer matches the recorded import closure and policy inputs.");
  }
}

function validateLivePackage(receipt, packageRoot, verifyClosure) {
  if (absolutePathSha256(packageRoot) !== receipt.package.rootPathSha256) {
    fail("live package root does not match package.rootPathSha256.");
  }
  let critical;
  if (verifyClosure) {
    const snapshot = snapshotPackageClosureAndCritical(packageRoot);
    comparePackageClosure(receipt.package.closure, snapshot.closure);
    critical = snapshot.criticalArtifacts;
  } else {
    critical = snapshotCriticalArtifacts(packageRoot);
  }
  if (!same(critical, receipt.package.criticalArtifacts)) {
    fail("one or more critical packaged artifacts no longer match the receipt.");
  }
  if (criticalArtifactsSha256(critical) !== receipt.package.criticalArtifactsSha256) {
    fail("live critical artifact aggregate no longer matches the receipt.");
  }
  return critical;
}

function executableIdentity(receipt) {
  const executable = receipt.package.criticalArtifacts.breadboardExecutable;
  return deepFreeze({
    fileName: "Breadboard.exe",
    pathSha256: executable.pathSha256,
    bytes: executable.bytes,
    sha256: executable.sha256,
  });
}

function packageVerificationBindingFromValidatedShape(validated) {
  if (!isRecord(validated) || !isRecord(validated.receipt) || !isRecord(validated.reference)) {
    fail("packageVerificationBinding requires a validated package verifier receipt result.");
  }
  const receipt = validated.receipt;
  const reference = validated.reference;
  validateReceiptShape(receipt, {
    nowMs: Date.parse(receipt.recordedAt),
    enforceFreshness: false,
    capturedAt: reference.capturedAt,
  });
  validateExpectedFileIdentity(reference, reference);
  return deepFreeze({
    receipt: {
      path: reference.path,
      bytes: reference.bytes,
      sha256: reference.sha256,
      capturedAt: reference.capturedAt,
    },
    packageRootPathSha256: receipt.package.rootPathSha256,
    closureSha256: receipt.package.closure.sha256,
    closureFileCount: receipt.package.closure.fileCount,
    closureBytes: receipt.package.closure.totalBytes,
    verifierSourceClosureSha256: receipt.sourceAuthority.verifierImportClosure.sha256,
  });
}

export function packageVerificationBinding(validated) {
  if (!isRecord(validated) || !validatedPackageAuthorities.has(validated)) {
    fail("packageVerificationBinding requires a genuine in-process validated package authority.");
  }
  return packageVerificationBindingFromValidatedShape(validated);
}

export function validatePackageVerifierReceipt(options) {
  if (!isRecord(options)) fail("options must be an object.");
  rejectUnknownOptionKeys(
    options,
    [
      "repoRoot",
      "receiptPath",
      "expectedFileIdentity",
      "executablePath",
      "nowMs",
      "enforceFreshness",
      "verifyClosure",
    ],
    "validatePackageVerifierReceipt",
  );
  const {
    repoRoot: repoRootOption,
    receiptPath,
    expectedFileIdentity = null,
    executablePath = null,
    nowMs = Date.now(),
    enforceFreshness = true,
    verifyClosure = true,
  } = options;
  if (typeof enforceFreshness !== "boolean" || typeof verifyClosure !== "boolean") {
    fail("enforceFreshness and verifyClosure must be booleans.");
  }
  const repoRoot = canonicalRepoRoot(repoRootOption);
  const snapshot = readReceiptSnapshot(repoRoot, receiptPath);
  validateExpectedFileIdentity(expectedFileIdentity, snapshot.reference);
  validateReceiptShape(snapshot.receipt, {
    nowMs,
    enforceFreshness,
    capturedAt: snapshot.reference.capturedAt,
  });
  const firstSourceAuthority = snapshotSourceAuthority(repoRoot);
  compareSourceAuthority(snapshot.receipt.sourceAuthority, firstSourceAuthority.authority);

  let packageRoot;
  if (executablePath === null || executablePath === undefined) {
    packageRoot = packageRootFromReceipt(snapshot.receipt);
  } else {
    const resolved = packageRootFromExecutable(executablePath);
    packageRoot = resolved.packageRoot;
    if (resolved.resolvedExecutable !== path.join(packageRoot, "Breadboard.exe")) {
      fail("executablePath is not the package root's direct Breadboard.exe.");
    }
  }
  validateLivePackage(snapshot.receipt, packageRoot, verifyClosure);

  const finalSourceAuthority = snapshotSourceAuthority(repoRoot);
  compareSourceAuthority(snapshot.receipt.sourceAuthority, finalSourceAuthority.authority);
  if (firstSourceAuthority.stateSha256 !== finalSourceAuthority.stateSha256) {
    fail("verifier/source authority changed while the receipt was being validated.");
  }

  const base = {
    receipt: deepFreeze(structuredClone(snapshot.receipt)),
    reference: deepFreeze(structuredClone(snapshot.reference)),
    executableIdentity: executableIdentity(snapshot.receipt),
  };
  const binding = packageVerificationBindingFromValidatedShape(base);
  const validated = deepFreeze({ ...base, binding });
  validatedPackageAuthorities.add(validated);
  return validated;
}

function verifierTranscript(result) {
  if (result.error) {
    fail(`fixed package verifier could not run: ${result.error.message}.`);
  }
  if (result.signal) fail(`fixed package verifier was terminated by ${result.signal}.`);
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (result.status !== 0) {
    fail(`fixed package verifier exited with status ${String(result.status)}.`);
  }
  if (exactOkLineCount(stdout) !== 1) {
    fail("fixed package verifier did not emit exactly one exact [verify-package] OK line.");
  }
  if (stdout.includes("[verify-package] FAILED:") || stderr.includes("[verify-package] FAILED:")) {
    fail("fixed package verifier emitted a failure marker.");
  }
  const stdoutBytes = Buffer.byteLength(stdout, "utf8");
  const stderrBytes = Buffer.byteLength(stderr, "utf8");
  if (stdoutBytes > MAX_VERIFIER_OUTPUT_BYTES || stderrBytes > MAX_VERIFIER_OUTPUT_BYTES) {
    fail("fixed package verifier output exceeded the receipt limit.");
  }
  return deepFreeze({
    path: VERIFIER_PATH,
    exitCode: 0,
    okLine: "[verify-package] OK",
    okLineCount: 1,
    stdout,
    stderr,
    stdoutBytes,
    stderrBytes,
    stdoutSha256: sha256Text(stdout),
    stderrSha256: sha256Text(stderr),
  });
}

function immutableTarget(repoRoot, receiptPath, packageRoot) {
  const target = receiptRelativePath(repoRoot, receiptPath);
  assertDirectPath(repoRoot, path.dirname(target.absolute), "receipt parent", { allowMissingLeaf: true });
  if (withinRoot(packageRoot, target.absolute)) fail("receiptPath cannot be inside the package closure.");
  if (fs.existsSync(target.absolute)) fail("receipt target already exists; receipts are immutable.");
  return target;
}

function publishImmutableReceipt(repoRoot, target, receipt) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  assertDirectPath(repoRoot, path.dirname(target), "receipt parent");
  const resolvedParent = fs.realpathSync(path.dirname(target));
  if (!withinRoot(repoRoot, resolvedParent)) fail("receipt parent escapes repoRoot after creation.");
  const temporary = `${target}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.chmodSync(temporary, 0o444);
    try {
      fs.linkSync(temporary, target);
    } catch (error) {
      if (error?.code === "EEXIST") fail("receipt target already exists; receipts are immutable.");
      throw error;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

function removeFailedPublication(target) {
  try {
    fs.chmodSync(target, 0o600);
  } catch {}
  try {
    fs.unlinkSync(target);
  } catch {}
}

export function recordPackageVerifierReceipt(options) {
  if (!isRecord(options)) fail("options must be an object.");
  rejectUnknownOptionKeys(
    options,
    ["repoRoot", "receiptPath", "executablePath", "runId"],
    "recordPackageVerifierReceipt",
  );
  const { repoRoot: repoRootOption, receiptPath, executablePath, runId = randomUUID() } = options;
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    fail("runId is not a canonical run identifier.");
  }
  const repoRoot = canonicalRepoRoot(repoRootOption);
  const executable = packageRootFromExecutable(executablePath);
  const target = immutableTarget(repoRoot, receiptPath, executable.packageRoot);
  const verifierAbsolutePath = path.resolve(repoRoot, ...VERIFIER_PATH.split("/"));
  assertDirectPath(repoRoot, verifierAbsolutePath, "fixed package verifier");

  const startedAtMs = Date.now();
  const preSource = snapshotSourceAuthority(repoRoot);
  const prePackage = snapshotPackageClosureAndCritical(executable.packageRoot);

  const verifierEnvironment = { ...process.env };
  delete verifierEnvironment.NODE_OPTIONS;
  delete verifierEnvironment.NODE_PATH;
  verifierEnvironment.BREADBOARD_DESKTOP_RELEASE_DIR = path.dirname(executable.packageRoot);
  const result = spawnSync(process.execPath, [verifierAbsolutePath], {
    cwd: repoRoot,
    env: verifierEnvironment,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: MAX_VERIFICATION_DURATION_MS,
    maxBuffer: MAX_VERIFIER_OUTPUT_BYTES,
  });
  const transcript = verifierTranscript(result);

  const postPackage = snapshotPackageClosureAndCritical(executable.packageRoot);
  const postSource = snapshotSourceAuthority(repoRoot);
  comparePackageClosure(prePackage.closure, postPackage.closure, "pre/post package closure");
  if (prePackage.stateSha256 !== postPackage.stateSha256) {
    fail("package tree metadata changed while the fixed verifier was running.");
  }
  if (!same(prePackage.criticalArtifacts, postPackage.criticalArtifacts)) {
    fail("critical package artifacts changed while the fixed verifier was running.");
  }
  compareSourceAuthority(preSource.authority, postSource.authority);
  if (preSource.stateSha256 !== postSource.stateSha256) {
    fail("verifier/source authority changed while the fixed verifier was running.");
  }

  const finishedAtMs = Date.now();
  const packageSection = deepFreeze({
    rootName: "win-unpacked",
    rootPath: executable.packageRoot,
    rootPathSha256: absolutePathSha256(executable.packageRoot),
    closure: postPackage.closure,
    criticalArtifacts: postPackage.criticalArtifacts,
    criticalArtifactsSha256: criticalArtifactsSha256(postPackage.criticalArtifacts),
  });
  const unsealed = {
    schemaVersion: PACKAGE_VERIFIER_RECEIPT_SCHEMA_VERSION,
    kind: PACKAGE_VERIFIER_RECEIPT_KIND,
    runId,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    recordedAt: new Date(Date.now()).toISOString(),
    package: packageSection,
    verifier: transcript,
    sourceAuthority: postSource.authority,
  };
  const receipt = deepFreeze({ ...unsealed, contentSha256: canonicalJsonSha256(unsealed) });
  validateReceiptShape(receipt, {
    nowMs: Date.now(),
    enforceFreshness: true,
  });

  publishImmutableReceipt(repoRoot, target.absolute, receipt);
  try {
    const validated = validatePackageVerifierReceipt({
      repoRoot,
      receiptPath: target.relative,
      executablePath: executable.resolvedExecutable,
      nowMs: Date.now(),
      enforceFreshness: true,
      verifyClosure: true,
    });
    const recorded = deepFreeze({
      ...validated,
      verifierOutput: { stdout: transcript.stdout, stderr: transcript.stderr },
    });
    validatedPackageAuthorities.add(recorded);
    return recorded;
  } catch (error) {
    removeFailedPublication(target.absolute);
    throw error;
  }
}
