import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// v2 means the artifact passed the fail-closed post-Turbopack trace verifier.
// Older manifests predate that guarantee and must never be reused or packaged.
const MANIFEST_VERSION = 2;
const MANIFEST_NAME = "breadboard-build-manifest.json";
const RUNTIME_DEPENDENCY_RECEIPT = "breadboard-runtime-dependencies.json";
const RUNTIME_DEPENDENCY_STAGE = ".breadboard-runtime-dependencies-stage";
const RUNTIME_DEPENDENCY_ROLLBACK = ".breadboard-runtime-dependencies-rollback";
const RUNTIME_DEPENDENCY_TRANSACTION = "transaction.json";

const RUNTIME_DEPENDENCY_TARGETS = Object.freeze([
  Object.freeze({ name: "esbuild", relative: path.join("node_modules", "esbuild") }),
  Object.freeze({ name: "@esbuild", relative: path.join("node_modules", "@esbuild") }),
  Object.freeze({ name: "typescript", relative: path.join("node_modules", "typescript") }),
  Object.freeze({ name: "three", relative: path.join("node_modules", "three") }),
]);

const ESBUILD_PLATFORM_CLOSURES = new Map([
  ["aix:ppc64", ["@esbuild/aix-ppc64", "bin/esbuild"]],
  ["android:arm", ["@esbuild/android-arm", "bin/esbuild"]],
  ["android:arm64", ["@esbuild/android-arm64", "bin/esbuild"]],
  ["android:x64", ["@esbuild/android-x64", "bin/esbuild"]],
  ["darwin:arm64", ["@esbuild/darwin-arm64", "bin/esbuild"]],
  ["darwin:x64", ["@esbuild/darwin-x64", "bin/esbuild"]],
  ["freebsd:arm64", ["@esbuild/freebsd-arm64", "bin/esbuild"]],
  ["freebsd:x64", ["@esbuild/freebsd-x64", "bin/esbuild"]],
  ["linux:arm", ["@esbuild/linux-arm", "bin/esbuild"]],
  ["linux:arm64", ["@esbuild/linux-arm64", "bin/esbuild"]],
  ["linux:ia32", ["@esbuild/linux-ia32", "bin/esbuild"]],
  ["linux:loong64", ["@esbuild/linux-loong64", "bin/esbuild"]],
  ["linux:mips64el", ["@esbuild/linux-mips64el", "bin/esbuild"]],
  ["linux:ppc64", ["@esbuild/linux-ppc64", "bin/esbuild"]],
  ["linux:riscv64", ["@esbuild/linux-riscv64", "bin/esbuild"]],
  ["linux:s390x", ["@esbuild/linux-s390x", "bin/esbuild"]],
  ["linux:x64", ["@esbuild/linux-x64", "bin/esbuild"]],
  ["netbsd:arm64", ["@esbuild/netbsd-arm64", "bin/esbuild"]],
  ["netbsd:x64", ["@esbuild/netbsd-x64", "bin/esbuild"]],
  ["openbsd:arm64", ["@esbuild/openbsd-arm64", "bin/esbuild"]],
  ["openbsd:x64", ["@esbuild/openbsd-x64", "bin/esbuild"]],
  ["openharmony:arm64", ["@esbuild/openharmony-arm64", "bin/esbuild"]],
  ["sunos:x64", ["@esbuild/sunos-x64", "bin/esbuild"]],
  ["win32:arm64", ["@esbuild/win32-arm64", "esbuild.exe"]],
  ["win32:ia32", ["@esbuild/win32-ia32", "esbuild.exe"]],
  ["win32:x64", ["@esbuild/win32-x64", "esbuild.exe"]],
]);

function comparablePath(candidate) {
  const resolved = path.resolve(candidate);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function containedPath(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} escaped its trusted destination root.`);
  }
  return { resolvedRoot, resolvedCandidate, relative };
}

function lstatIfPresent(candidate) {
  try {
    return fs.lstatSync(candidate);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

function assertDirectEntry(candidate, metadata, label) {
  if (metadata.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link or junction.`);
  }
  if (comparablePath(fs.realpathSync.native(candidate)) !== comparablePath(candidate)) {
    throw new Error(`${label} must not traverse a symbolic link or junction.`);
  }
}

function assertDirectDirectory(candidate, label) {
  const resolved = path.resolve(candidate);
  const metadata = lstatIfPresent(resolved);
  if (!metadata) {
    throw new Error(`${label} is unavailable at ${resolved}`);
  }
  assertDirectEntry(resolved, metadata, label);
  if (!metadata.isDirectory()) {
    throw new Error(`${label} must be a direct directory.`);
  }
  return resolved;
}

/**
 * Validate every existing component between a trusted direct directory and a
 * destination. Missing trailing components are permitted. This is used before
 * creating any staging or rollback path so an ancestor junction cannot redirect
 * a rename, copy, or removal outside the standalone build.
 */
function assertDirectDestinationPath(root, candidate, label, expectedType = "any") {
  const trustedRoot = assertDirectDirectory(root, `${label} root`);
  const { resolvedCandidate, relative } = containedPath(trustedRoot, candidate, label);
  if (!relative) {
    if (expectedType === "file") throw new Error(`${label} must be a direct file.`);
    return true;
  }
  const segments = relative.split(path.sep).filter(Boolean);
  let cursor = trustedRoot;
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    const metadata = lstatIfPresent(cursor);
    if (!metadata) return false;
    assertDirectEntry(cursor, metadata, `${label} component ${segments[index]}`);
    const isFinal = index === segments.length - 1;
    if (!isFinal && !metadata.isDirectory()) {
      throw new Error(`${label} has a non-directory ancestor at ${cursor}`);
    }
    if (isFinal && expectedType === "directory" && !metadata.isDirectory()) {
      throw new Error(`${label} must be a direct directory.`);
    }
    if (isFinal && expectedType === "file" && !metadata.isFile()) {
      throw new Error(`${label} must be a direct file.`);
    }
  }
  return true;
}

function assertDirectTree(root, candidate, label) {
  if (!assertDirectDestinationPath(root, candidate, label)) return false;
  const resolved = path.resolve(candidate);
  const visit = (entry) => {
    const metadata = lstatIfPresent(entry);
    if (!metadata) throw new Error(`${label} changed while it was being validated.`);
    assertDirectEntry(entry, metadata, label);
    if (metadata.isDirectory()) {
      for (const name of fs.readdirSync(entry)) visit(path.join(entry, name));
      return;
    }
    if (!metadata.isFile()) {
      throw new Error(`${label} contains an unsupported filesystem entry at ${entry}`);
    }
    if (metadata.nlink !== 1) {
      throw new Error(`${label} contains a hard-linked file at ${entry}`);
    }
  };
  visit(resolved);
  return true;
}

function ensureDirectDirectory(root, candidate, label) {
  const trustedRoot = assertDirectDirectory(root, `${label} root`);
  const { resolvedCandidate, relative } = containedPath(trustedRoot, candidate, label);
  if (!relative) return trustedRoot;
  let cursor = trustedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const metadata = lstatIfPresent(cursor);
    if (!metadata) fs.mkdirSync(cursor);
    const current = fs.lstatSync(cursor);
    assertDirectEntry(cursor, current, `${label} component ${segment}`);
    if (!current.isDirectory()) {
      throw new Error(`${label} has a non-directory component at ${cursor}`);
    }
  }
  return resolvedCandidate;
}

function removeDirectTree(root, candidate, label) {
  if (!assertDirectTree(root, candidate, label)) return false;
  const remove = (entry) => {
    const metadata = fs.lstatSync(entry);
    assertDirectEntry(entry, metadata, label);
    if (metadata.isDirectory()) {
      const names = fs.readdirSync(entry).sort((left, right) => {
        if (left === RUNTIME_DEPENDENCY_TRANSACTION) return 1;
        if (right === RUNTIME_DEPENDENCY_TRANSACTION) return -1;
        return left.localeCompare(right);
      });
      for (const name of names) remove(path.join(entry, name));
      fs.rmdirSync(entry);
      return;
    }
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new Error(`${label} became an unsafe filesystem entry at ${entry}`);
    }
    fs.unlinkSync(entry);
  };
  remove(path.resolve(candidate));
  return true;
}

function assertDirectFile(root, relative, label) {
  const resolvedRoot = assertDirectDirectory(root, `${label} package`);
  const candidate = path.resolve(resolvedRoot, relative);
  const relativeCandidate = path.relative(resolvedRoot, candidate);
  if (
    relativeCandidate === "" ||
    relativeCandidate === ".." ||
    relativeCandidate.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeCandidate)
  ) {
    throw new Error(`${label} escaped its package root.`);
  }
  let metadata;
  try {
    metadata = fs.lstatSync(candidate);
  } catch {
    throw new Error(`${label} is unavailable at ${candidate}`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a direct file.`);
  }
  if (comparablePath(fs.realpathSync.native(candidate)) !== comparablePath(candidate)) {
    throw new Error(`${label} must not traverse a link or junction.`);
  }
  if (metadata.nlink !== 1) {
    throw new Error(`${label} must not be a hard-linked file.`);
  }
  return candidate;
}

function readJsonFile(candidate, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(candidate, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return value;
}

function fileReceipt(candidate, relative) {
  const bytes = fs.readFileSync(candidate);
  return {
    path: relative.replaceAll(path.sep, "/"),
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function lockedDashboardPackageVersion(repoRoot, packageName) {
  const dashboard = path.join(repoRoot, "dashboard");
  const lockPath = assertDirectFile(dashboard, "package-lock.json", "dashboard npm lock");
  const lock = readJsonFile(lockPath, "dashboard npm lock");
  const version = lock.packages?.[`node_modules/${packageName}`]?.version;
  if (typeof version !== "string" || !version) {
    throw new Error(`The dashboard npm lock does not contain ${packageName}.`);
  }
  return version;
}

/**
 * Resolve the reviewed esbuild runtime closure for the platform that will run
 * the standalone dashboard workers. This deliberately returns five files,
 * rather than asking Next's tracer to walk esbuild's dynamic package lookup.
 */
export function resolveEsbuildRuntimeClosure(
  repoRoot,
  { platform = process.platform, arch = process.arch } = {},
) {
  const platformClosure = ESBUILD_PLATFORM_CLOSURES.get(`${platform}:${arch}`);
  if (!platformClosure) {
    throw new Error(`No reviewed esbuild runtime closure exists for ${platform}/${arch}.`);
  }
  const [platformPackage, binaryRelative] = platformClosure;
  const modulesRoot = path.join(repoRoot, "dashboard", "node_modules");
  const esbuildRoot = path.join(modulesRoot, "esbuild");
  const platformRoot = path.join(modulesRoot, ...platformPackage.split("/"));
  const esbuildPackagePath = assertDirectFile(esbuildRoot, "package.json", "esbuild metadata");
  const platformPackagePath = assertDirectFile(
    platformRoot,
    "package.json",
    `${platformPackage} metadata`,
  );
  const esbuildPackage = readJsonFile(esbuildPackagePath, "esbuild metadata");
  const nativePackage = readJsonFile(platformPackagePath, `${platformPackage} metadata`);
  const version = typeof esbuildPackage.version === "string" ? esbuildPackage.version : "";
  if (
    esbuildPackage.name !== "esbuild" ||
    !version ||
    lockedDashboardPackageVersion(repoRoot, "esbuild") !== version ||
    esbuildPackage.optionalDependencies?.[platformPackage] !== version
  ) {
    throw new Error(`esbuild does not pin ${platformPackage} to its own version.`);
  }
  if (
    nativePackage.name !== platformPackage ||
    nativePackage.version !== version ||
    !Array.isArray(nativePackage.os) ||
    !nativePackage.os.includes(platform) ||
    !Array.isArray(nativePackage.cpu) ||
    !nativePackage.cpu.includes(arch)
  ) {
    throw new Error(`${platformPackage} does not match esbuild ${version} on ${platform}/${arch}.`);
  }

  const binaryHashKey = `${platformPackage}/${binaryRelative}`;
  const binarySha256 = esbuildPackage["esbuild.binaryHashes"]?.[binaryHashKey];
  if (typeof binarySha256 !== "string" || !/^[a-f0-9]{64}$/u.test(binarySha256)) {
    throw new Error(`esbuild ${version} does not declare a trusted digest for ${binaryHashKey}.`);
  }
  const binaryPath = assertDirectFile(
    platformRoot,
    binaryRelative,
    `${platformPackage} executable`,
  );
  const actualBinarySha256 = createHash("sha256")
    .update(fs.readFileSync(binaryPath))
    .digest("hex");
  if (actualBinarySha256 !== binarySha256) {
    throw new Error(`${platformPackage} executable does not match esbuild's trusted digest.`);
  }

  const files = [
    {
      source: esbuildPackagePath,
      relative: path.join("node_modules", "esbuild", "package.json"),
    },
    {
      source: assertDirectFile(esbuildRoot, path.join("lib", "main.js"), "esbuild library"),
      relative: path.join("node_modules", "esbuild", "lib", "main.js"),
    },
    {
      source: assertDirectFile(esbuildRoot, "LICENSE.md", "esbuild license"),
      relative: path.join("node_modules", "esbuild", "LICENSE.md"),
    },
    {
      source: platformPackagePath,
      relative: path.join("node_modules", ...platformPackage.split("/"), "package.json"),
    },
    {
      source: binaryPath,
      relative: path.join("node_modules", ...platformPackage.split("/"), ...binaryRelative.split("/")),
    },
  ];
  return { version, platform, arch, platformPackage, binarySha256, files };
}

/** Resolve TypeScript's two-file runtime plus its required license notices. */
export function resolveTypeScriptRuntimeClosure(repoRoot) {
  const packageRoot = path.join(repoRoot, "dashboard", "node_modules", "typescript");
  const packagePath = assertDirectFile(packageRoot, "package.json", "TypeScript metadata");
  const metadata = readJsonFile(packagePath, "TypeScript metadata");
  const version = typeof metadata.version === "string" ? metadata.version : "";
  if (
    metadata.name !== "typescript" ||
    metadata.main !== "./lib/typescript.js" ||
    !version ||
    lockedDashboardPackageVersion(repoRoot, "typescript") !== version
  ) {
    throw new Error("TypeScript does not match the dashboard's immutable npm lock.");
  }
  return {
    version,
    files: [
      {
        source: packagePath,
        relative: path.join("node_modules", "typescript", "package.json"),
      },
      {
        source: assertDirectFile(
          packageRoot,
          path.join("lib", "typescript.js"),
          "TypeScript runtime",
        ),
        relative: path.join("node_modules", "typescript", "lib", "typescript.js"),
      },
      {
        source: assertDirectFile(packageRoot, "LICENSE.txt", "TypeScript license"),
        relative: path.join("node_modules", "typescript", "LICENSE.txt"),
      },
      {
        source: assertDirectFile(
          packageRoot,
          "ThirdPartyNoticeText.txt",
          "TypeScript third-party notice",
        ),
        relative: path.join("node_modules", "typescript", "ThirdPartyNoticeText.txt"),
      },
    ],
  };
}

/** Resolve the exact browser module used by the visualizer worker's 3D bundle. */
export function resolveThreeRuntimeClosure(repoRoot) {
  const packageRoot = path.join(repoRoot, "dashboard", "node_modules", "three");
  const packagePath = assertDirectFile(packageRoot, "package.json", "Three.js metadata");
  const metadata = readJsonFile(packagePath, "Three.js metadata");
  const version = typeof metadata.version === "string" ? metadata.version : "";
  if (
    metadata.name !== "three" ||
    metadata.type !== "module" ||
    metadata.module !== "./build/three.module.js" ||
    metadata.exports?.["."]?.import !== "./build/three.module.js" ||
    !version ||
    lockedDashboardPackageVersion(repoRoot, "three") !== version
  ) {
    throw new Error("Three.js does not match the dashboard's immutable npm lock and ESM export.");
  }
  return {
    version,
    files: [
      {
        source: packagePath,
        relative: path.join("node_modules", "three", "package.json"),
      },
      {
        source: assertDirectFile(
          packageRoot,
          path.join("build", "three.module.js"),
          "Three.js ESM runtime",
        ),
        relative: path.join("node_modules", "three", "build", "three.module.js"),
      },
      {
        source: assertDirectFile(
          packageRoot,
          path.join("build", "three.core.js"),
          "Three.js core runtime",
        ),
        relative: path.join("node_modules", "three", "build", "three.core.js"),
      },
      {
        source: assertDirectFile(packageRoot, "LICENSE", "Three.js license"),
        relative: path.join("node_modules", "three", "LICENSE"),
      },
    ],
  };
}

function runtimeDependencyReceipt(esbuild, typescript, three, receipts) {
  return {
    version: 1,
    dependencies: {
      esbuild: {
        version: esbuild.version,
        platform: esbuild.platform,
        arch: esbuild.arch,
        platformPackage: esbuild.platformPackage,
        files: receipts.get("esbuild"),
      },
      typescript: {
        version: typescript.version,
        files: receipts.get("typescript"),
      },
      three: {
        version: three.version,
        files: receipts.get("three"),
      },
    },
  };
}

function runtimeDependencyReceiptEntries(receipt) {
  if (
    !receipt ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    receipt.version !== 1 ||
    !receipt.dependencies ||
    typeof receipt.dependencies !== "object" ||
    Array.isArray(receipt.dependencies)
  ) {
    throw new Error("The standalone compiler dependency receipt has an invalid schema.");
  }
  const entries = [];
  for (const name of ["esbuild", "typescript", "three"]) {
    const dependency = receipt.dependencies[name];
    if (!dependency || typeof dependency !== "object" || !Array.isArray(dependency.files)) {
      throw new Error(`The standalone ${name} dependency receipt has an invalid schema.`);
    }
    for (const entry of dependency.files) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.path !== "string" ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 1 ||
        typeof entry.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(entry.sha256)
      ) {
        throw new Error(`The standalone ${name} dependency receipt contains an invalid file.`);
      }
      entries.push(entry);
    }
  }
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw new Error("The standalone compiler dependency receipt contains duplicate paths.");
  }
  return entries;
}

function validateRuntimeDependencyReceiptFiles(root, receipt) {
  for (const entry of runtimeDependencyReceiptEntries(receipt)) {
    if (
      entry.path.includes("\\") ||
      entry.path.startsWith("/") ||
      entry.path.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new Error(`The standalone compiler dependency path is unsafe: ${entry.path}`);
    }
    const candidate = path.resolve(root, ...entry.path.split("/"));
    containedPath(root, candidate, `standalone compiler dependency ${entry.path}`);
    if (!assertDirectTree(root, candidate, `standalone compiler dependency ${entry.path}`)) {
      throw new Error(`The standalone compiler dependency is absent: ${entry.path}`);
    }
    const identity = fileReceipt(candidate, entry.path);
    if (identity.bytes !== entry.bytes || identity.sha256 !== entry.sha256) {
      throw new Error(`The standalone compiler dependency changed while staging: ${entry.path}`);
    }
  }
}

function collectDirectFilePaths(root, candidate, label) {
  if (!assertDirectTree(root, candidate, label)) return [];
  const files = [];
  const visit = (entry) => {
    const metadata = fs.lstatSync(entry);
    assertDirectEntry(entry, metadata, label);
    if (metadata.isDirectory()) {
      for (const name of fs.readdirSync(entry).sort()) visit(path.join(entry, name));
      return;
    }
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new Error(`${label} contains an unsafe filesystem entry at ${entry}`);
    }
    files.push(path.relative(root, entry).replaceAll(path.sep, "/"));
  };
  visit(candidate);
  return files;
}

function assertRuntimeDependencyClosureAt(
  repoRoot,
  standaloneDashboard,
  closures = null,
) {
  const resolvedClosures = closures ?? {
    esbuild: resolveEsbuildRuntimeClosure(repoRoot),
    typescript: resolveTypeScriptRuntimeClosure(repoRoot),
    three: resolveThreeRuntimeClosure(repoRoot),
  };
  const receipts = new Map();
  for (const [name, closure] of Object.entries(resolvedClosures)) {
    receipts.set(
      name,
      closure.files.map((file) => fileReceipt(file.source, file.relative)),
    );
  }
  const expectedReceipt = runtimeDependencyReceipt(
    resolvedClosures.esbuild,
    resolvedClosures.typescript,
    resolvedClosures.three,
    receipts,
  );
  const receiptPath = path.join(standaloneDashboard, RUNTIME_DEPENDENCY_RECEIPT);
  if (!assertDirectTree(standaloneDashboard, receiptPath, "compiler dependency receipt")) {
    throw new Error("The standalone compiler dependency receipt is absent.");
  }
  const actualReceipt = readJsonFile(receiptPath, "standalone compiler dependency receipt");
  if (JSON.stringify(actualReceipt) !== JSON.stringify(expectedReceipt)) {
    throw new Error("The standalone compiler dependency receipt does not match the reviewed closure.");
  }
  validateRuntimeDependencyReceiptFiles(standaloneDashboard, actualReceipt);

  const expectedPaths = Object.values(resolvedClosures)
    .flatMap((closure) => closure.files.map((file) => file.relative.replaceAll(path.sep, "/")))
    .sort();
  const actualPaths = RUNTIME_DEPENDENCY_TARGETS
    .flatMap((target) => collectDirectFilePaths(
      standaloneDashboard,
      path.join(standaloneDashboard, target.relative),
      `standalone ${target.name} dependency closure`,
    ))
    .sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("The standalone compiler dependency tree contains missing or unreviewed files.");
  }
  return { ...resolvedClosures, receipt: actualReceipt };
}

/** Validate the current standalone compiler closure before reuse or packaging. */
export function assertStandaloneDashboardRuntimeDependencies(repoRoot) {
  const { standaloneDashboard } = dashboardBuildPaths(repoRoot);
  assertDirectDirectory(standaloneDashboard, "standalone dashboard destination");
  return assertRuntimeDependencyClosureAt(repoRoot, standaloneDashboard);
}

function exactObjectKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function validateRuntimeDependencyTransaction(value) {
  if (
    !exactObjectKeys(value, [
      "version",
      "receiptExisted",
      "previousReceiptSha256",
      "nextReceiptSha256",
      "targets",
    ]) ||
    value.version !== 1 ||
    typeof value.receiptExisted !== "boolean" ||
    (value.previousReceiptSha256 !== null &&
      (typeof value.previousReceiptSha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(value.previousReceiptSha256))) ||
    value.receiptExisted !== (value.previousReceiptSha256 !== null) ||
    typeof value.nextReceiptSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.nextReceiptSha256) ||
    !Array.isArray(value.targets) ||
    value.targets.length !== RUNTIME_DEPENDENCY_TARGETS.length
  ) {
    throw new Error("The standalone compiler dependency transaction is invalid.");
  }
  for (let index = 0; index < RUNTIME_DEPENDENCY_TARGETS.length; index += 1) {
    const expected = RUNTIME_DEPENDENCY_TARGETS[index];
    const actual = value.targets[index];
    if (
      !exactObjectKeys(actual, ["name", "relative", "existed"]) ||
      actual.name !== expected.name ||
      actual.relative !== expected.relative.replaceAll(path.sep, "/") ||
      typeof actual.existed !== "boolean"
    ) {
      throw new Error("The standalone compiler dependency transaction targets are invalid.");
    }
  }
  return value;
}

function readRuntimeDependencyTransaction(standaloneDashboard, stage, rollback) {
  const candidates = [
    path.join(stage, RUNTIME_DEPENDENCY_TRANSACTION),
    path.join(rollback, RUNTIME_DEPENDENCY_TRANSACTION),
  ];
  const available = [];
  for (const candidate of candidates) {
    if (!assertDirectTree(standaloneDashboard, candidate, "compiler staging transaction")) continue;
    available.push(fs.readFileSync(candidate, "utf8"));
  }
  if (!available.length) {
    throw new Error("The interrupted compiler staging transaction has no recovery record.");
  }
  if (available.some((source) => source !== available[0])) {
    throw new Error("The interrupted compiler staging recovery records disagree.");
  }
  return validateRuntimeDependencyTransaction(JSON.parse(available[0]));
}

function writeExclusiveDirectFile(root, candidate, source, label) {
  ensureDirectDirectory(root, path.dirname(candidate), `${label} parent`);
  fs.writeFileSync(candidate, source, { encoding: "utf8", flag: "wx" });
  if (!assertDirectTree(root, candidate, label)) {
    throw new Error(`${label} was not created.`);
  }
}

function finalReceiptIsCommitted(standaloneDashboard, transaction) {
  const receiptPath = path.join(standaloneDashboard, RUNTIME_DEPENDENCY_RECEIPT);
  if (!assertDirectTree(standaloneDashboard, receiptPath, "compiler dependency receipt")) {
    return false;
  }
  const source = fs.readFileSync(receiptPath);
  if (createHash("sha256").update(source).digest("hex") !== transaction.nextReceiptSha256) {
    return false;
  }
  let receipt;
  try {
    receipt = JSON.parse(source.toString("utf8"));
  } catch {
    return false;
  }
  try {
    validateRuntimeDependencyReceiptFiles(standaloneDashboard, receipt);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recover a process-killed compiler dependency swap. A matching final receipt
 * proves the last rename committed the new closure; otherwise the old roots
 * are restored and their receipt is republished last.
 */
export function recoverInterruptedDashboardRuntimeDependencyStaging(repoRoot) {
  const { standaloneDashboard } = dashboardBuildPaths(repoRoot);
  const stage = path.join(standaloneDashboard, RUNTIME_DEPENDENCY_STAGE);
  const rollback = path.join(standaloneDashboard, RUNTIME_DEPENDENCY_ROLLBACK);
  assertDirectDirectory(standaloneDashboard, "standalone dashboard destination");
  const stagePresent = assertDirectTree(
    standaloneDashboard,
    stage,
    "compiler dependency staging directory",
  );
  const rollbackPresent = assertDirectTree(
    standaloneDashboard,
    rollback,
    "compiler dependency rollback directory",
  );
  if (!stagePresent && !rollbackPresent) return false;
  if (!rollbackPresent) {
    removeDirectTree(standaloneDashboard, stage, "abandoned compiler dependency staging directory");
    return true;
  }

  const stageTransaction = path.join(stage, RUNTIME_DEPENDENCY_TRANSACTION);
  const rollbackTransaction = path.join(rollback, RUNTIME_DEPENDENCY_TRANSACTION);
  const hasTransaction = assertDirectTree(
    standaloneDashboard,
    stageTransaction,
    "compiler staging transaction",
  ) || assertDirectTree(
    standaloneDashboard,
    rollbackTransaction,
    "compiler rollback transaction",
  );
  if (!hasTransaction) {
    const stageEmpty = !stagePresent || fs.readdirSync(stage).length === 0;
    const rollbackEmpty = fs.readdirSync(rollback).length === 0;
    if (!stageEmpty || !rollbackEmpty) {
      throw new Error("The interrupted compiler staging transaction has no recovery record.");
    }
    if (stagePresent) fs.rmdirSync(stage);
    fs.rmdirSync(rollback);
    return true;
  }

  const transaction = readRuntimeDependencyTransaction(standaloneDashboard, stage, rollback);
  if (finalReceiptIsCommitted(standaloneDashboard, transaction)) {
    if (stagePresent) {
      removeDirectTree(standaloneDashboard, stage, "committed compiler dependency staging directory");
    }
    removeDirectTree(
      standaloneDashboard,
      rollback,
      "committed compiler dependency rollback directory",
    );
    return true;
  }

  const finalReceipt = path.join(standaloneDashboard, RUNTIME_DEPENDENCY_RECEIPT);
  const rollbackReceipt = path.join(rollback, RUNTIME_DEPENDENCY_RECEIPT);
  const rollbackReceiptPresent = assertDirectTree(
    standaloneDashboard,
    rollbackReceipt,
    "rollback compiler dependency receipt",
  );
  if (rollbackReceiptPresent || !transaction.receiptExisted) {
    removeDirectTree(standaloneDashboard, finalReceipt, "partial compiler dependency receipt");
  } else if (!assertDirectTree(
    standaloneDashboard,
    finalReceipt,
    "previous compiler dependency receipt",
  )) {
    throw new Error("The previous compiler dependency receipt cannot be recovered.");
  }

  for (let index = 0; index < RUNTIME_DEPENDENCY_TARGETS.length; index += 1) {
    const target = RUNTIME_DEPENDENCY_TARGETS[index];
    const previous = transaction.targets[index];
    const finalTarget = path.join(standaloneDashboard, target.relative);
    const rollbackTarget = path.join(rollback, target.relative);
    const backedUp = assertDirectTree(
      standaloneDashboard,
      rollbackTarget,
      `rollback ${target.name} dependency`,
    );
    if (backedUp) {
      removeDirectTree(standaloneDashboard, finalTarget, `partial ${target.name} dependency`);
      ensureDirectDirectory(
        standaloneDashboard,
        path.dirname(finalTarget),
        `restored ${target.name} dependency parent`,
      );
      fs.renameSync(rollbackTarget, finalTarget);
      assertDirectTree(standaloneDashboard, finalTarget, `restored ${target.name} dependency`);
    } else if (!previous.existed) {
      removeDirectTree(standaloneDashboard, finalTarget, `partial ${target.name} dependency`);
    } else if (!assertDirectTree(
      standaloneDashboard,
      finalTarget,
      `previous ${target.name} dependency`,
    )) {
      throw new Error(`The previous ${target.name} dependency cannot be recovered.`);
    }
  }

  if (rollbackReceiptPresent) {
    fs.renameSync(rollbackReceipt, finalReceipt);
  }
  if (transaction.receiptExisted) {
    if (!assertDirectTree(standaloneDashboard, finalReceipt, "restored compiler dependency receipt")) {
      throw new Error("The previous compiler dependency receipt was not restored.");
    }
    const restoredSha256 = createHash("sha256")
      .update(fs.readFileSync(finalReceipt))
      .digest("hex");
    if (restoredSha256 !== transaction.previousReceiptSha256) {
      throw new Error("The restored compiler dependency receipt changed during recovery.");
    }
  }

  if (stagePresent) {
    removeDirectTree(standaloneDashboard, stage, "recovered compiler dependency staging directory");
  }
  removeDirectTree(
    standaloneDashboard,
    rollback,
    "recovered compiler dependency rollback directory",
  );
  return true;
}

function assertManagedRuntimeDependencyDestinations(standaloneDashboard) {
  assertDirectDirectory(standaloneDashboard, "standalone dashboard destination");
  assertDirectDestinationPath(
    standaloneDashboard,
    path.join(standaloneDashboard, "node_modules"),
    "standalone dashboard node_modules",
    "directory",
  );
  for (const target of RUNTIME_DEPENDENCY_TARGETS) {
    assertDirectTree(
      standaloneDashboard,
      path.join(standaloneDashboard, target.relative),
      `existing ${target.name} dependency`,
    );
  }
  assertDirectTree(
    standaloneDashboard,
    path.join(standaloneDashboard, RUNTIME_DEPENDENCY_RECEIPT),
    "existing compiler dependency receipt",
  );
}

/**
 * Stage only the compiler files used by the disposable visualizer worker.
 * The complete closure is copied into a sibling directory before any live path
 * changes. Managed roots are then swapped by same-volume rename and the receipt
 * is published as the final commit marker.
 */
export function stageStandaloneDashboardRuntimeDependencies(
  repoRoot,
  { onCommitStep = null } = {},
) {
  const { standaloneDashboard } = dashboardBuildPaths(repoRoot);
  const stage = path.join(standaloneDashboard, RUNTIME_DEPENDENCY_STAGE);
  const rollback = path.join(standaloneDashboard, RUNTIME_DEPENDENCY_ROLLBACK);
  const notify = typeof onCommitStep === "function" ? onCommitStep : () => {};
  assertDirectDirectory(standaloneDashboard, "standalone dashboard destination");
  recoverInterruptedDashboardRuntimeDependencyStaging(repoRoot);
  assertManagedRuntimeDependencyDestinations(standaloneDashboard);
  if (
    assertDirectDestinationPath(standaloneDashboard, stage, "compiler dependency staging directory") ||
    assertDirectDestinationPath(standaloneDashboard, rollback, "compiler dependency rollback directory")
  ) {
    throw new Error("A compiler dependency staging transaction is already present.");
  }

  const esbuild = resolveEsbuildRuntimeClosure(repoRoot);
  const typescript = resolveTypeScriptRuntimeClosure(repoRoot);
  const three = resolveThreeRuntimeClosure(repoRoot);
  let transactionStarted = false;
  try {
    fs.mkdirSync(stage);
    assertDirectTree(standaloneDashboard, stage, "compiler dependency staging directory");
    const receipts = new Map();
    for (const [name, closure] of [
      ["esbuild", esbuild],
      ["typescript", typescript],
      ["three", three],
    ]) {
      const receiptFiles = [];
      for (const file of closure.files) {
        const target = path.join(stage, file.relative);
        ensureDirectDirectory(stage, path.dirname(target), `staged ${name} dependency parent`);
        fs.copyFileSync(file.source, target, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(target, fs.statSync(file.source).mode & 0o777);
        if (!assertDirectTree(stage, target, `staged ${name} dependency file`)) {
          throw new Error(`The staged ${name} dependency file is absent.`);
        }
        receiptFiles.push(fileReceipt(target, file.relative));
      }
      receipts.set(name, receiptFiles);
    }

    const receipt = runtimeDependencyReceipt(esbuild, typescript, three, receipts);
    const receiptSource = `${JSON.stringify(receipt, null, 2)}\n`;
    const stagedReceipt = path.join(stage, RUNTIME_DEPENDENCY_RECEIPT);
    writeExclusiveDirectFile(
      stage,
      stagedReceipt,
      receiptSource,
      "staged compiler dependency receipt",
    );
    validateRuntimeDependencyReceiptFiles(stage, receipt);
    assertRuntimeDependencyClosureAt(repoRoot, stage, { esbuild, typescript, three });

    assertManagedRuntimeDependencyDestinations(standaloneDashboard);
    const finalReceipt = path.join(standaloneDashboard, RUNTIME_DEPENDENCY_RECEIPT);
    const receiptExisted = assertDirectTree(
      standaloneDashboard,
      finalReceipt,
      "previous compiler dependency receipt",
    );
    const transaction = {
      version: 1,
      receiptExisted,
      previousReceiptSha256: receiptExisted
        ? createHash("sha256").update(fs.readFileSync(finalReceipt)).digest("hex")
        : null,
      nextReceiptSha256: createHash("sha256").update(receiptSource).digest("hex"),
      targets: RUNTIME_DEPENDENCY_TARGETS.map((target) => ({
        name: target.name,
        relative: target.relative.replaceAll(path.sep, "/"),
        existed: assertDirectTree(
          standaloneDashboard,
          path.join(standaloneDashboard, target.relative),
          `previous ${target.name} dependency`,
        ),
      })),
    };
    validateRuntimeDependencyTransaction(transaction);
    const transactionSource = `${JSON.stringify(transaction, null, 2)}\n`;
    writeExclusiveDirectFile(
      stage,
      path.join(stage, RUNTIME_DEPENDENCY_TRANSACTION),
      transactionSource,
      "compiler dependency staging transaction",
    );

    fs.mkdirSync(rollback);
    assertDirectTree(standaloneDashboard, rollback, "compiler dependency rollback directory");
    writeExclusiveDirectFile(
      rollback,
      path.join(rollback, RUNTIME_DEPENDENCY_TRANSACTION),
      transactionSource,
      "compiler dependency rollback transaction",
    );
    transactionStarted = true;

    if (receiptExisted) {
      fs.renameSync(finalReceipt, path.join(rollback, RUNTIME_DEPENDENCY_RECEIPT));
    }
    notify("receipt-withdrawn");

    for (const target of RUNTIME_DEPENDENCY_TARGETS) {
      const finalTarget = path.join(standaloneDashboard, target.relative);
      if (assertDirectTree(standaloneDashboard, finalTarget, `previous ${target.name} dependency`)) {
        const rollbackTarget = path.join(rollback, target.relative);
        ensureDirectDirectory(
          rollback,
          path.dirname(rollbackTarget),
          `rollback ${target.name} dependency parent`,
        );
        fs.renameSync(finalTarget, rollbackTarget);
      }
      notify(`dependency-backed-up:${target.name}`);
    }

    ensureDirectDirectory(
      standaloneDashboard,
      path.join(standaloneDashboard, "node_modules"),
      "standalone dashboard node_modules",
    );
    for (const target of RUNTIME_DEPENDENCY_TARGETS) {
      const stagedTarget = path.join(stage, target.relative);
      const finalTarget = path.join(standaloneDashboard, target.relative);
      ensureDirectDirectory(
        standaloneDashboard,
        path.dirname(finalTarget),
        `installed ${target.name} dependency parent`,
      );
      if (assertDirectDestinationPath(
        standaloneDashboard,
        finalTarget,
        `installed ${target.name} dependency`,
      )) {
        throw new Error(`The installed ${target.name} dependency target is not empty.`);
      }
      fs.renameSync(stagedTarget, finalTarget);
      assertDirectTree(standaloneDashboard, finalTarget, `installed ${target.name} dependency`);
      notify(`dependency-installed:${target.name}`);
    }

    validateRuntimeDependencyReceiptFiles(standaloneDashboard, receipt);
    fs.renameSync(stagedReceipt, finalReceipt);
    notify("receipt-published");
    removeDirectTree(standaloneDashboard, stage, "committed compiler dependency staging directory");
    removeDirectTree(
      standaloneDashboard,
      rollback,
      "committed compiler dependency rollback directory",
    );
    return { esbuild, typescript, three };
  } catch (error) {
    try {
      if (transactionStarted || lstatIfPresent(stage) || lstatIfPresent(rollback)) {
        recoverInterruptedDashboardRuntimeDependencyStaging(repoRoot);
      }
    } catch (recoveryError) {
      throw new AggregateError(
        [error, recoveryError],
        "Compiler dependency staging failed and its prior closure could not be restored.",
      );
    }
    throw error;
  }
}

function collectFiles(root, target, files) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    files.push({ absolute: target, relative: path.relative(root, target), link: fs.readlinkSync(target) });
    return;
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target).sort()) {
      collectFiles(root, path.join(target, name), files);
    }
    return;
  }
  if (stat.isFile()) files.push({ absolute: target, relative: path.relative(root, target), link: null });
}

/**
 * Content fingerprint for files that can change the standalone server graph.
 * Public assets are deliberately excluded: they are copied into a reusable
 * artifact on every launch and do not require webpack to run again.
 */
export function dashboardBuildFingerprint(repoRoot) {
  const dashboard = path.join(repoRoot, "dashboard");
  const files = [];
  for (const relative of [
    "src",
    "scripts",
    "package.json",
    "package-lock.json",
    "bun.lock",
    "next.config.ts",
    "next-env.d.ts",
    "postcss.config.mjs",
    "tsconfig.json",
    "tsconfig.desktop.json",
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
  ]) {
    collectFiles(dashboard, path.join(dashboard, relative), files);
  }
  collectFiles(repoRoot, path.join(repoRoot, "scripts", "setup-mem0.mjs"), files);
  files.sort((left, right) => left.relative.localeCompare(right.relative));

  const hash = createHash("sha256");
  hash.update(`breadboard-dashboard-build-v${MANIFEST_VERSION}\0`);
  for (const file of files) {
    hash.update(file.relative.replaceAll(path.sep, "/"));
    hash.update("\0");
    if (file.link !== null) hash.update(`link:${file.link}`);
    else hash.update(fs.readFileSync(file.absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function dashboardBuildPaths(repoRoot) {
  const output = path.join(repoRoot, "dashboard", ".next-desktop");
  const standaloneDashboard = path.join(output, "standalone");
  return {
    output,
    standaloneDashboard,
    server: path.join(standaloneDashboard, "server.js"),
    manifest: path.join(output, MANIFEST_NAME),
  };
}

function dashboardBuildBackupPath(repoRoot) {
  return path.join(repoRoot, "dashboard", ".next-desktop-last-good");
}

function removeDashboardBuildTree(target) {
  fs.rmSync(target, {
    recursive: true,
    force: true,
    // A stopped Next/Turbopack process can release the final directory handle
    // a moment after it exits on Windows. Let Node retry ENOTEMPTY/EBUSY rather
    // than turning a successfully contained build interruption into a crash.
    maxRetries: 12,
    retryDelay: 250,
  });
}

/** Restore the last complete artifact after a killed/interrupted build. */
export function recoverInterruptedDashboardBuild(repoRoot) {
  const { output } = dashboardBuildPaths(repoRoot);
  const backup = dashboardBuildBackupPath(repoRoot);
  if (fs.existsSync(backup)) {
    if (fs.existsSync(output)) removeDashboardBuildTree(output);
    fs.renameSync(backup, output);
    return true;
  }

  // A first build has no last-good rollback slot. If it is killed or rejected
  // by the trace-safety gate, never leave its unvalidated server tree available
  // for a later packaging command to mistake for a completed artifact.
  if (fs.existsSync(output) && !availableDashboardBuild(repoRoot).available) {
    removeDashboardBuildTree(output);
    return true;
  }
  return false;
}

/**
 * Move the current complete artifact out of Next's destructive output path.
 * Directory rename is same-volume and immediate; no second multi-GiB copy is
 * committed while the build is already under memory pressure.
 */
export function beginDashboardBuild(repoRoot) {
  recoverInterruptedDashboardBuild(repoRoot);
  const { output } = dashboardBuildPaths(repoRoot);
  const backup = dashboardBuildBackupPath(repoRoot);
  if (fs.existsSync(backup)) removeDashboardBuildTree(backup);
  const current = availableDashboardBuild(repoRoot);
  if (current.available) {
    fs.renameSync(output, backup);
    return true;
  }
  if (fs.existsSync(output)) removeDashboardBuildTree(output);
  return false;
}

/** Commit the newly validated artifact and discard its rollback slot. */
export function completeDashboardBuild(repoRoot) {
  const backup = dashboardBuildBackupPath(repoRoot);
  if (fs.existsSync(backup)) removeDashboardBuildTree(backup);
}

export function reusableDashboardBuild(repoRoot) {
  const available = availableDashboardBuild(repoRoot);
  if (!available.available) {
    return { reusable: false, reason: available.reason };
  }
  return available.current
    ? { reusable: true, reason: "dashboard inputs are unchanged" }
    : { reusable: false, reason: "dashboard inputs changed" };
}

/**
 * Describe the last complete standalone artifact independently of freshness.
 *
 * Lean mode may deliberately run a stale artifact when Windows cannot safely
 * admit another production build. That is still a lean, bounded server; the
 * important invariant is that a manifest from this build format and its
 * server entry both exist. Missing/incompatible artifacts never fall through
 * to `next dev`.
 */
export function availableDashboardBuild(repoRoot) {
  const paths = dashboardBuildPaths(repoRoot);
  if (!fs.existsSync(paths.server)) return { available: false, current: false, reason: "standalone server is absent" };
  if (!fs.existsSync(paths.manifest)) return { available: false, current: false, reason: "build manifest is absent" };
  try {
    const manifest = JSON.parse(fs.readFileSync(paths.manifest, "utf8"));
    if (manifest.version !== MANIFEST_VERSION || typeof manifest.fingerprint !== "string") {
      return { available: false, current: false, reason: "build manifest is incompatible" };
    }
    const fingerprint = dashboardBuildFingerprint(repoRoot);
    const current = manifest.fingerprint === fingerprint;
    return {
      available: true,
      current,
      reason: current ? "dashboard inputs are unchanged" : "dashboard inputs changed",
      builtAt: typeof manifest.builtAt === "string" ? manifest.builtAt : null,
    };
  } catch {
    return { available: false, current: false, reason: "build manifest is unreadable" };
  }
}

export function writeDashboardBuildManifest(repoRoot) {
  const paths = dashboardBuildPaths(repoRoot);
  if (!fs.existsSync(paths.server)) {
    throw new Error(`Standalone dashboard build did not produce ${paths.server}`);
  }
  fs.writeFileSync(
    paths.manifest,
    `${JSON.stringify({
      version: MANIFEST_VERSION,
      fingerprint: dashboardBuildFingerprint(repoRoot),
      builtAt: new Date().toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );
}

/** Refresh assets that Next intentionally keeps outside its traced server. */
export function refreshStandaloneDashboardAssets(repoRoot) {
  const dashboard = path.join(repoRoot, "dashboard");
  const { standaloneDashboard } = dashboardBuildPaths(repoRoot);
  const staticSource = path.join(dashboard, ".next-desktop", "static");
  if (fs.existsSync(staticSource)) {
    fs.cpSync(staticSource, path.join(standaloneDashboard, ".next-desktop", "static"), {
      recursive: true,
      force: true,
    });
  }
  const publicSource = path.join(dashboard, "public");
  if (fs.existsSync(publicSource)) {
    fs.cpSync(publicSource, path.join(standaloneDashboard, "public"), {
      recursive: true,
      force: true,
    });
  }
  stageStandaloneDashboardRuntimeDependencies(repoRoot);
}
