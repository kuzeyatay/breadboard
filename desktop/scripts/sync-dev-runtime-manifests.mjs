#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestNames = Object.freeze(["services.json", "workers.json"]);
const mandatoryRuntimeBinPath = "bin/runtime-supervisor.exe";
const stageRuntimeBinsOption = "--stage-runtime-bins";
let temporarySequence = 0;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateManifest(bytes, name) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Runtime V2 ${name} is not valid JSON.`, { cause: error });
  }
  if (!isRecord(manifest)) {
    throw new Error(`Runtime V2 ${name} must contain an object.`);
  }

  const collectionName = name === "services.json" ? "services" : "workers";
  const identityName = name === "services.json" ? "id" : "kind";
  const entries = manifest[collectionName];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`Runtime V2 ${name} must contain at least one ${collectionName} entry.`);
  }
  const identities = entries.map((entry) => entry?.[identityName]);
  if (identities.some((identity) => typeof identity !== "string" || identity.length === 0)) {
    throw new Error(`Runtime V2 ${name} contains an invalid ${identityName}.`);
  }
  if (new Set(identities).size !== identities.length) {
    throw new Error(`Runtime V2 ${name} contains a duplicate ${identityName}.`);
  }
  if (name === "services.json" && !identities.includes("gbrain")) {
    throw new Error("Runtime V2 services.json is missing mandatory GBrain authority.");
  }
  return Object.freeze({ manifest, entries });
}

function requireAbsolutePath(candidate, label) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return path.resolve(candidate);
}

function pathIdentity(candidate) {
  const resolved = path.resolve(candidate);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertDirectPathSegments(candidate, label, { allowMissing = false } = {}) {
  const resolved = requireAbsolutePath(candidate, label);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const metadata = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!metadata) {
      if (allowMissing) break;
      throw new Error(`${label} is missing: ${current}`);
    }
    if (metadata.isSymbolicLink()) {
      throw new Error(`${label} traverses a symbolic link or junction: ${current}`);
    }
    if (index < segments.length - 1 && !metadata.isDirectory()) {
      throw new Error(`${label} traverses a non-directory path: ${current}`);
    }
  }
  return resolved;
}

function assertDirectDirectory(candidate, label) {
  const resolved = assertDirectPathSegments(candidate, label);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a direct directory.`);
  }
  return resolved;
}

function ensureDirectDirectory(candidate, label) {
  const resolved = requireAbsolutePath(candidate, label);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!metadata) {
      fs.mkdirSync(current);
      continue;
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`${label} traverses a non-directory or link: ${current}`);
    }
  }
  return resolved;
}

function assertDirectRegularFile(candidate, label) {
  const resolved = assertDirectPathSegments(candidate, label);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a direct regular file.`);
  }
  if (metadata.nlink !== 1) {
    throw new Error(`${label} must have exactly one hard link; found ${metadata.nlink}.`);
  }
  const canonical = fs.realpathSync.native(resolved);
  if (pathIdentity(canonical) !== pathIdentity(resolved)) {
    throw new Error(`${label} traverses a symbolic link or junction: ${resolved}`);
  }
  return Object.freeze({ resolved, mode: metadata.mode & 0o777 });
}

function assertSafeTargetFile(candidate, label) {
  const resolved = assertDirectPathSegments(candidate, label, { allowMissing: true });
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (metadata && (!metadata.isFile() || metadata.isSymbolicLink())) {
    throw new Error(`${label} must be absent or a direct regular file.`);
  }
  if (metadata?.isFile() && metadata.nlink !== 1) {
    throw new Error(`${label} must have exactly one hard link; found ${metadata.nlink}.`);
  }
  return resolved;
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

function addRuntimeBinReference(closure, candidate, label) {
  const relativePath = validateRuntimeRelativePath(candidate, label);
  if (relativePath === "bin") {
    throw new Error(`${label} must name a regular file below bin/.`);
  }
  if (relativePath.startsWith("bin/")) closure.add(relativePath);
}

function hotRuntimeBinClosure(servicesManifest) {
  const services = servicesManifest.services;
  if (!Array.isArray(services) || services.length === 0) {
    throw new Error("Runtime V2 services.json has no services for hot bin staging.");
  }
  const closure = new Set([mandatoryRuntimeBinPath]);
  for (const service of services) {
    if (!isRecord(service) || typeof service.id !== "string" || service.id.length === 0) {
      throw new Error("Runtime V2 hot bin staging found an invalid service record.");
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
        addRuntimeBinReference(
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
          addRuntimeBinReference(
            closure,
            file.path,
            `${profileLabel} install probe file ${fileIndex}`,
          );
        }
      }
    }
  }
  return Object.freeze([...closure].sort());
}

function resolveRuntimeChild(root, relativePath, label) {
  const safeRelativePath = validateRuntimeRelativePath(relativePath, label);
  const resolvedRoot = requireAbsolutePath(root, `${label} root`);
  const candidate = path.resolve(resolvedRoot, ...safeRelativePath.split("/"));
  const relation = path.relative(resolvedRoot, candidate);
  if (relation === "" || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Error(`${label} escapes its runtime root.`);
  }
  return candidate;
}

function filePayload(source, target, label) {
  const direct = assertDirectRegularFile(source, `${label} source`);
  return Object.freeze({
    source: direct.resolved,
    target: path.resolve(target),
    label,
    mode: direct.mode,
  });
}

function directFilesEqual(leftPath, rightPath, label) {
  const left = assertDirectRegularFile(leftPath, `${label} source comparison`);
  const right = assertDirectRegularFile(rightPath, `${label} target comparison`);
  const leftSize = fs.lstatSync(left.resolved).size;
  if (leftSize !== fs.lstatSync(right.resolved).size) return false;

  const leftFd = fs.openSync(left.resolved, "r");
  const rightFd = fs.openSync(right.resolved, "r");
  const leftBuffer = Buffer.allocUnsafe(1024 * 1024);
  const rightBuffer = Buffer.allocUnsafe(leftBuffer.length);
  let position = 0;
  try {
    while (position < leftSize) {
      const length = Math.min(leftBuffer.length, leftSize - position);
      const leftBytes = fs.readSync(leftFd, leftBuffer, 0, length, position);
      const rightBytes = fs.readSync(rightFd, rightBuffer, 0, length, position);
      if (
        leftBytes !== length ||
        rightBytes !== length ||
        !leftBuffer.subarray(0, length).equals(rightBuffer.subarray(0, length))
      ) {
        return false;
      }
      position += length;
    }
    return true;
  } finally {
    fs.closeSync(leftFd);
    fs.closeSync(rightFd);
  }
}

function payloadMatches(payload, candidate) {
  if (Buffer.isBuffer(payload.bytes)) {
    return fs.readFileSync(candidate).equals(payload.bytes);
  }
  return directFilesEqual(payload.source, candidate, payload.label);
}

function stagePayload(payload) {
  const target = assertSafeTargetFile(payload.target, `${payload.label} target`);
  const existing = fs.lstatSync(target, { throwIfNoEntry: false });
  if (existing && payloadMatches(payload, target)) return false;

  const parent = ensureDirectDirectory(path.dirname(target), `${payload.label} target parent`);
  const temporary = path.join(
    parent,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.${temporarySequence}.tmp`,
  );
  temporarySequence += 1;
  let created = false;
  try {
    if (Buffer.isBuffer(payload.bytes)) {
      fs.writeFileSync(temporary, payload.bytes, {
        flag: "wx",
        mode: payload.mode,
      });
    } else {
      fs.copyFileSync(payload.source, temporary, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(temporary, payload.mode);
    }
    created = true;
    const staged = assertDirectRegularFile(temporary, `${payload.label} temporary file`);
    if (!payloadMatches(payload, staged.resolved)) {
      throw new Error(`${payload.label} temporary file differs from its source.`);
    }
    fs.renameSync(staged.resolved, target);
    created = false;
    const committed = assertDirectRegularFile(target, `${payload.label} staged file`);
    if (!payloadMatches(payload, committed.resolved)) {
      throw new Error(`${payload.label} staged file differs from its source.`);
    }
    return true;
  } finally {
    if (created) fs.rmSync(temporary, { force: true });
  }
}

/**
 * Dev launches from immutable staged runtimes but the authoritative manifests
 * remain checked in. The npm predev call refreshes only the manifests because
 * native transcription assets are prepared later in the lifecycle. A strict
 * post-preparation call with `stageRuntimeBins: true` additionally stages the
 * exact hot-mode runtime-root bin closure immediately before Electron starts.
 */
export function syncDevRuntimeManifests({
  sourceDir = path.join(desktopRoot, "runtime-v2", "manifests"),
  targetDir = path.join(desktopRoot, "build-resources", "runtime-v2", "manifests"),
  sourceRuntimeRoot = path.join(desktopRoot, "resources"),
  targetRuntimeRoot = path.join(desktopRoot, "build-resources"),
  stageRuntimeBins = false,
} = {}) {
  sourceDir = assertDirectDirectory(sourceDir, "Runtime V2 checked-in manifest directory");
  const payloads = manifestNames.map((name) => {
    const source = path.join(sourceDir, name);
    const direct = assertDirectRegularFile(source, `Runtime V2 checked-in ${name}`);
    const bytes = fs.readFileSync(direct.resolved);
    const validated = validateManifest(bytes, name);
    return {
      name,
      bytes,
      mode: direct.mode,
      count: validated.entries.length,
      manifest: validated.manifest,
    };
  });

  const stagedPayloads = payloads.map((payload) =>
    Object.freeze({
      source: path.join(sourceDir, payload.name),
      target: path.join(path.resolve(targetDir), payload.name),
      label: `Runtime V2 ${payload.name}`,
      bytes: payload.bytes,
      mode: payload.mode,
    }),
  );

  if (stageRuntimeBins) {
    sourceRuntimeRoot = assertDirectDirectory(
      sourceRuntimeRoot,
      "development source runtime root",
    );
    targetRuntimeRoot = requireAbsolutePath(
      targetRuntimeRoot,
      "development target runtime root",
    );
    const services = payloads.find(({ name }) => name === "services.json")?.manifest;
    const closure = hotRuntimeBinClosure(services);
    for (const relativePath of closure) {
      const source = resolveRuntimeChild(
        sourceRuntimeRoot,
        relativePath,
        `development source ${relativePath}`,
      );
      const target = resolveRuntimeChild(
        targetRuntimeRoot,
        relativePath,
        `development target ${relativePath}`,
      );
      stagedPayloads.push(filePayload(source, target, `development runtime ${relativePath}`));
    }
  }

  // Validate every target before mutating any of them. Missing source assets,
  // malformed paths, and link traversal therefore leave the previous staged
  // manifest/bin set untouched.
  for (const payload of stagedPayloads) {
    assertSafeTargetFile(payload.target, `${payload.label} target`);
  }
  ensureDirectDirectory(path.resolve(targetDir), "Runtime V2 staged manifest directory");
  if (stageRuntimeBins) {
    ensureDirectDirectory(path.resolve(targetRuntimeRoot), "development target runtime root");
  }
  for (const payload of stagedPayloads) stagePayload(payload);

  return Object.freeze(Object.fromEntries(payloads.map(({ name, count }) => [name, count])));
}

const invokedAsMain =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  const args = process.argv.slice(2);
  const stageRuntimeBins = args.length === 1 && args[0] === stageRuntimeBinsOption;
  if (args.length > 0 && !stageRuntimeBins) {
    process.stderr.write(
      `[runtime-v2] unknown development staging option(s): ${args.join(", ")}\n`,
    );
    process.exitCode = 2;
  } else {
    try {
      const counts = syncDevRuntimeManifests({ stageRuntimeBins });
      process.stdout.write(
        `[runtime-v2] staged ${counts["services.json"]} services and ` +
          `${counts["workers.json"]} workers for development` +
          `${stageRuntimeBins ? " with strict hot runtime bins" : ""}.\n`,
      );
    } catch (error) {
      process.stderr.write(
        `[runtime-v2] development manifest staging failed: ` +
          `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  }
}
