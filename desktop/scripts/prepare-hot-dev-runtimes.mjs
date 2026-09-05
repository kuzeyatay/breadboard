#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureHermesSourceHook } from "./hermes-python-source-hook.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maximumManifestBytes = 4 * 1024 * 1024;

export const hotRuntimeMappings = Object.freeze([
  Object.freeze({ target: "node", prefix: "runtimes/node/" }),
  Object.freeze({ target: "bun", prefix: "runtimes/bun/" }),
  Object.freeze({ target: "python", prefix: "runtimes/python/" }),
  Object.freeze({ target: "cad", prefix: "runtimes/cad-python/" }),
  Object.freeze({ target: "colpali", prefix: "runtimes/colpali-python/" }),
  Object.freeze({ target: "humanizer", prefix: "runtimes/humanizer-python/" }),
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pathIdentity(candidate) {
  const resolved = path.resolve(candidate);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function requireAbsolutePath(candidate, label) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return path.resolve(candidate);
}

function validateRuntimeRelativePath(candidate, label) {
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.length > 512 ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(candidate) ||
    path.posix.isAbsolute(candidate)
  ) {
    throw new Error(`${label} must be one safe runtime-root relative path.`);
  }
  const segments = candidate.split("/");
  if (
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    path.posix.normalize(candidate) !== candidate
  ) {
    throw new Error(`${label} must be one safe runtime-root relative path.`);
  }
  return candidate;
}

function runtimeTarget(relativePath, label) {
  const matches = hotRuntimeMappings.filter(({ prefix }) => relativePath.startsWith(prefix));
  if (matches.length !== 1) {
    throw new Error(`${label} has no unique reviewed hot-runtime preparation target.`);
  }
  return matches[0].target;
}

function addNonBinRuntimeReference(closure, candidate, label) {
  const relativePath = validateRuntimeRelativePath(candidate, label);
  if (relativePath.startsWith("bin/")) return;
  const target = runtimeTarget(relativePath, label);
  const previousTarget = closure.get(relativePath);
  if (previousTarget && previousTarget !== target) {
    throw new Error(`${label} maps to conflicting hot-runtime preparation targets.`);
  }
  closure.set(relativePath, target);
}

/**
 * Derives the immutable non-bin runtime-root closure required by every hot
 * service profile. No target may be inferred from a service id: each path must
 * live under one explicitly reviewed runtime directory above.
 */
export function deriveHotRuntimeClosure(servicesManifest) {
  if (!isRecord(servicesManifest) || !Array.isArray(servicesManifest.services)) {
    throw new Error("Runtime V2 services.json has no services for hot runtime preparation.");
  }
  const closure = new Map();
  for (const service of servicesManifest.services) {
    if (!isRecord(service) || typeof service.id !== "string" || service.id.length === 0) {
      throw new Error("Runtime V2 hot runtime preparation found an invalid service record.");
    }
    if (!Array.isArray(service.launchProfiles) || service.launchProfiles.length === 0) {
      throw new Error(`Runtime V2 service ${service.id} has no launch profiles.`);
    }
    for (const [profileIndex, profile] of service.launchProfiles.entries()) {
      const profileLabel = `Runtime V2 service ${service.id} launch profile ${profileIndex}`;
      if (!isRecord(profile) || !Array.isArray(profile.modes)) {
        throw new Error(`${profileLabel} is invalid.`);
      }
      if (!profile.modes.every((mode) => typeof mode === "string")) {
        throw new Error(`${profileLabel} contains an invalid mode.`);
      }
      if (!profile.modes.includes("hot")) continue;

      if (profile.executableAuthority === "runtime-root") {
        addNonBinRuntimeReference(
          closure,
          profile.allowedExecutable,
          `${profileLabel} allowed executable`,
        );
      }
      if (!isRecord(profile.installProbe) || profile.installProbe.kind !== "files-present") {
        throw new Error(`${profileLabel} must use one files-present install probe.`);
      }
      if (!Array.isArray(profile.installProbe.files)) {
        throw new Error(`${profileLabel} install probe files are invalid.`);
      }
      for (const [fileIndex, file] of profile.installProbe.files.entries()) {
        if (!isRecord(file) || typeof file.authority !== "string") {
          throw new Error(`${profileLabel} install probe file ${fileIndex} is invalid.`);
        }
        if (file.authority === "runtime-root") {
          addNonBinRuntimeReference(
            closure,
            file.path,
            `${profileLabel} install probe file ${fileIndex}`,
          );
        }
      }
    }
  }
  if (closure.size === 0) {
    throw new Error("Runtime V2 services.json has an empty hot non-bin runtime closure.");
  }
  return Object.freeze(
    [...closure.entries()]
      .map(([relativePath, target]) => Object.freeze({ relativePath, target }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  );
}

function inspectDirectPath(candidate, label, { allowMissing = false, file = false } = {}) {
  const resolved = requireAbsolutePath(candidate, label);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const metadata = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!metadata) {
      if (allowMissing) return Object.freeze({ state: "missing", resolved });
      throw new Error(`${label} is missing: ${current}`);
    }
    if (metadata.isSymbolicLink()) {
      throw new Error(`${label} traverses a symbolic link or junction: ${current}`);
    }
    const isLeaf = index === segments.length - 1;
    if (!isLeaf && !metadata.isDirectory()) {
      throw new Error(`${label} traverses a non-directory path: ${current}`);
    }
    if (isLeaf) {
      if (file && !metadata.isFile()) {
        throw new Error(`${label} must be a direct regular file.`);
      }
      if (!file && !metadata.isDirectory()) {
        throw new Error(`${label} must be a direct directory.`);
      }
      if (file && metadata.nlink !== 1) {
        throw new Error(`${label} must have exactly one hard link; found ${metadata.nlink}.`);
      }
    }
  }
  const canonical = fs.realpathSync.native(resolved);
  if (pathIdentity(canonical) !== pathIdentity(resolved)) {
    throw new Error(`${label} traverses a symbolic link or junction: ${resolved}`);
  }
  return Object.freeze({ state: "present", resolved });
}

function resolveRuntimeChild(runtimeRoot, relativePath, label) {
  const safeRelativePath = validateRuntimeRelativePath(relativePath, label);
  const candidate = path.resolve(runtimeRoot, ...safeRelativePath.split("/"));
  const relation = path.relative(runtimeRoot, candidate);
  if (relation === "" || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Error(`${label} escapes its runtime root.`);
  }
  return candidate;
}

function readServicesManifest(manifestPath) {
  const direct = inspectDirectPath(manifestPath, "Runtime V2 services manifest", { file: true });
  const size = fs.lstatSync(direct.resolved).size;
  if (size <= 0 || size > maximumManifestBytes) {
    throw new Error(`Runtime V2 services manifest size ${size} is outside the reviewed limit.`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(direct.resolved, "utf8"));
  } catch (error) {
    throw new Error("Runtime V2 services manifest is not valid JSON.", { cause: error });
  }
  return manifest;
}

function defaultPrepareRunner(target, { prepareScript, cwd }) {
  const script = inspectDirectPath(prepareScript, "Runtime preparation script", { file: true });
  return spawnSync(process.execPath, [script.resolved, "--only", target], {
    cwd,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
}

function assertPrepareResult(result, target) {
  if (typeof result === "number") {
    if (result !== 0) {
      throw new Error(`Hot development runtime preparation for ${target} exited with ${result}.`);
    }
    return;
  }
  if (!isRecord(result)) {
    throw new Error(`Hot development runtime preparation for ${target} returned no status.`);
  }
  if (result.error) {
    throw new Error(`Hot development runtime preparation for ${target} could not start.`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(
      `Hot development runtime preparation for ${target} exited with ${String(result.status)}.`,
    );
  }
}

function targetOrder(closure) {
  const required = new Set(closure.map(({ target }) => target));
  return hotRuntimeMappings.map(({ target }) => target).filter((target) => required.has(target));
}

function inspectClosureTarget(runtimeRoot, entries, target, { allowMissing }) {
  let missing = false;
  for (const entry of entries) {
    if (entry.target !== target) continue;
    const candidate = resolveRuntimeChild(
      runtimeRoot,
      entry.relativePath,
      `hot development runtime ${entry.relativePath}`,
    );
    const status = inspectDirectPath(
      candidate,
      `Hot development runtime ${entry.relativePath}`,
      { allowMissing, file: true },
    );
    if (status.state === "missing") missing = true;
  }
  return missing;
}

/**
 * Prepares only missing reviewed hot-runtime groups, then proves the complete
 * manifest-derived closure again. Cached interpreters/dependencies are reused;
 * the small source-selection hook is repaired independently. Links, hard links,
 * non-files, and unknown mappings fail before any repair.
 */
export function prepareHotDevRuntimes({
  manifestPath = path.join(desktopRoot, "runtime-v2", "manifests", "services.json"),
  runtimeRoot = path.join(desktopRoot, "build-resources"),
  prepareScript = path.join(desktopRoot, "scripts", "prepare-runtimes.mjs"),
  runPrepare = defaultPrepareRunner,
} = {}) {
  if (typeof runPrepare !== "function") {
    throw new TypeError("Hot development runtime preparer requires a runner function.");
  }
  manifestPath = requireAbsolutePath(manifestPath, "Runtime V2 services manifest path");
  runtimeRoot = requireAbsolutePath(runtimeRoot, "Hot development runtime root");
  prepareScript = requireAbsolutePath(prepareScript, "Runtime preparation script path");
  inspectDirectPath(runtimeRoot, "Hot development runtime root");

  const closure = deriveHotRuntimeClosure(readServicesManifest(manifestPath));
  const requiredTargets = targetOrder(closure);
  const initiallyMissing = requiredTargets.filter((target) =>
    inspectClosureTarget(runtimeRoot, closure, target, { allowMissing: true }),
  );
  // Cached dependencies are reusable; their old app-source selector is not.
  // Migrate it even when no download/reassembly is necessary.
  const pythonRoot = path.join(runtimeRoot, "runtimes", "python");
  if (requiredTargets.includes("python") && fs.existsSync(path.join(pythonRoot, "python.exe"))) {
    ensureHermesSourceHook(pythonRoot);
  }
  const missingTargets = initiallyMissing.filter((target) =>
    inspectClosureTarget(runtimeRoot, closure, target, { allowMissing: true }),
  );
  const preparedTargets = [];
  for (const target of missingTargets) {
    const result = runPrepare(target, {
      cwd: desktopRoot,
      prepareScript,
      runtimeRoot,
      requiredPaths: Object.freeze(
        closure
          .filter((entry) => entry.target === target)
          .map((entry) => entry.relativePath),
      ),
    });
    assertPrepareResult(result, target);
    if (inspectClosureTarget(runtimeRoot, closure, target, { allowMissing: true })) {
      throw new Error(
        `Hot development runtime preparation for ${target} did not produce its complete reviewed closure.`,
      );
    }
    preparedTargets.push(target);
  }

  // A runner may have replaced a shared ancestor. Revalidate every required
  // file after all preparations before allowing the Electron chain to continue.
  for (const target of requiredTargets) {
    inspectClosureTarget(runtimeRoot, closure, target, { allowMissing: false });
  }
  return Object.freeze({
    requiredPaths: Object.freeze(closure.map(({ relativePath }) => relativePath)),
    requiredTargets: Object.freeze(requiredTargets),
    preparedTargets: Object.freeze(preparedTargets),
  });
}

const invokedAsMain =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  if (process.argv.length !== 2) {
    process.stderr.write("[desktop] hot runtime preparation accepts no command-line options.\n");
    process.exitCode = 2;
  } else {
    try {
      const result = prepareHotDevRuntimes();
      process.stdout.write(
        `[desktop] hot runtime closure ready (${result.requiredPaths.length} files; ` +
          `${result.preparedTargets.length === 0 ? "no preparation needed" : `prepared ${result.preparedTargets.join(", ")}`}).\n`,
      );
    } catch (error) {
      process.stderr.write(
        `[desktop] hot runtime preparation failed: ` +
          `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  }
}
