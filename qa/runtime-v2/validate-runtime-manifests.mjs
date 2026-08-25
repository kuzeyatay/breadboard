#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qaDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDirectory, "..", "..");
const desktopRoot = path.join(repoRoot, "desktop");
const sourceManifestRoot = path.join(desktopRoot, "runtime-v2", "manifests");
const stagedRuntimeRoot = path.join(desktopRoot, "build-resources");
const stagedManifestRoot = path.join(stagedRuntimeRoot, "runtime-v2", "manifests");
const stagedAppRoot = path.join(stagedRuntimeRoot, "app-services");
const failures = [];
const MAX_MANIFEST_ENTRIES = 256;
const MAX_JOB_TYPES_PER_WORKER = 128;
const MAX_CAPABILITIES_PER_DEFINITION = 256;
const MAX_DEPENDENCIES_PER_SERVICE = 64;
const MAX_CONCURRENCY = 64;
const MAX_COMMIT_LIMIT_MB = 1024 * 1024;
const MAX_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

const WORKER_FIELDS = [
  "kind",
  "jobTypes",
  "capabilityIds",
  "allowedExecutable",
  "allowedEntrypoint",
  "protocolVersion",
  "resourceClass",
  "estimatedColdStartCommitMb",
  "softCommitLimitMb",
  "hardCommitLimitMb",
  "maximumConcurrency",
  "workspacePolicy",
  "readyTimeoutMs",
  "heartbeatTimeoutMs",
  "gracefulCancellationMs",
  "maximumRuntimeMs",
  "exitAfterJob",
];
const SERVICE_FIELDS = [
  "id",
  "displayName",
  "capabilityIds",
  "allowedExecutable",
  "allowedEntrypoint",
  "startupPolicy",
  "resourceClass",
  "dependencies",
  "estimatedColdStartCommitMb",
  "softCommitLimitMb",
  "hardCommitLimitMb",
  "idleTtlMs",
  "gracefulShutdownMs",
  "restartPolicy",
];
const RESOURCE_CLASSES = new Set([
  "core",
  "large-generation",
  "document-processing",
  "document-model",
  "media-processing",
  "browser-automation",
  "local-model",
  "docker-stack",
]);

function fail(message) {
  failures.push(message);
}

function readText(file, label) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    fail(`missing ${label}: ${path.relative(repoRoot, file)}`);
    return "";
  }
}

function readJson(file, label) {
  const text = readText(file, label);
  if (!text) return { text, value: {} };
  try {
    return { text, value: JSON.parse(text) };
  } catch (error) {
    fail(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return { text, value: {} };
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) {
    fail(`${label} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} fields differ: expected ${wanted.join(", ")}; found ${actual.join(", ")}`);
    return false;
  }
  return true;
}

function isIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

function isCapabilityId(value) {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value, "utf8") <= 128 &&
    value.split(":").every((part) => /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(part))
  );
}

function isRelativeLaunchPath(value) {
  if (typeof value !== "string" || value.length < 1 || Buffer.byteLength(value, "utf8") > 4096) {
    return false;
  }
  if (
    path.isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes(":") ||
    /\p{Cc}/u.test(value)
  ) return false;
  return value.split(/[\\/]/u).every(
    (part) =>
      part.length > 0 &&
      part !== "." &&
      part !== ".." &&
      !/[. ]$/u.test(part) &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
  );
}

function uniqueStrings(value, predicate, label) {
  if (!Array.isArray(value) || value.length < 1 || value.some((item) => !predicate(item))) {
    fail(`${label} must be a nonempty array of valid unique strings`);
    return false;
  }
  if (new Set(value).size !== value.length) {
    fail(`${label} contains duplicates`);
    return false;
  }
  return true;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function integerInRange(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function existingRegularFile(root, relative, label) {
  const absolute = path.resolve(root, relative);
  const relation = path.relative(path.resolve(root), absolute);
  if (relation.startsWith("..") || path.isAbsolute(relation)) {
    fail(`${label} escaped its authority root`);
    return;
  }
  try {
    if (!fs.statSync(absolute).isFile()) throw new Error("not a file");
  } catch {
    fail(`${label} is not staged at ${path.relative(repoRoot, absolute)}`);
  }
}

const contractSource = readJson(
  path.join(repoRoot, "native", "runtime-protocol", "runtime-control-contract.json"),
  "runtime control contract",
);
if (!isRecord(contractSource.value)) fail("runtime control contract must be an object");
const contract = isRecord(contractSource.value) ? contractSource.value : {};
const workerSource = readJson(path.join(sourceManifestRoot, "workers.json"), "source worker manifest");
const serviceSource = readJson(path.join(sourceManifestRoot, "services.json"), "source service manifest");
const workerStage = readJson(path.join(stagedManifestRoot, "workers.json"), "staged worker manifest");
const serviceStage = readJson(path.join(stagedManifestRoot, "services.json"), "staged service manifest");

for (const [label, manifest] of [
  ["source workers.json", workerSource],
  ["source services.json", serviceSource],
  ["staged workers.json", workerStage],
  ["staged services.json", serviceStage],
]) {
  const maximumBytes = contract.launchManifests?.maximumFileBytes;
  if (!positiveInteger(maximumBytes) || Buffer.byteLength(manifest.text, "utf8") > maximumBytes) {
    fail(`${label} exceeds or cannot prove the contract manifest byte limit`);
  }
}

if (workerSource.text !== workerStage.text) fail("staged workers.json differs from its source authority");
if (serviceSource.text !== serviceStage.text) fail("staged services.json differs from its source authority");

const workerShapeValid = exactKeys(workerSource.value, ["version", "workers"], "worker manifest");
const serviceShapeValid = exactKeys(serviceSource.value, ["version", "services"], "service manifest");
const workerManifest = workerShapeValid ? workerSource.value : {};
const serviceManifest = serviceShapeValid ? serviceSource.value : {};
if (workerManifest.version !== contract.launchManifests?.workerManifestVersion) {
  fail("worker manifest version differs from the runtime contract");
}
if (serviceManifest.version !== contract.launchManifests?.serviceManifestVersion) {
  fail("service manifest version differs from the runtime contract");
}

if (!Array.isArray(workerManifest.workers)) fail("worker manifest workers must be an array");
if (!Array.isArray(serviceManifest.services)) fail("service manifest services must be an array");
const workers = Array.isArray(workerManifest.workers) ? workerManifest.workers : [];
const services = Array.isArray(serviceManifest.services) ? serviceManifest.services : [];
if (workers.length > MAX_MANIFEST_ENTRIES) fail("worker manifest has too many definitions");
if (services.length > MAX_MANIFEST_ENTRIES) fail("service manifest has too many definitions");
const workerKinds = new Set();
const jobTypes = new Set();
for (const [index, worker] of workers.entries()) {
  const label = `worker[${index}]`;
  if (!exactKeys(worker, WORKER_FIELDS, label)) continue;
  if (!isIdentifier(worker.kind) || workerKinds.has(worker.kind)) fail(`${label}.kind is invalid or duplicate`);
  workerKinds.add(worker.kind);
  if (uniqueStrings(worker.jobTypes, isIdentifier, `${label}.jobTypes`)) {
    if (worker.jobTypes.length > MAX_JOB_TYPES_PER_WORKER) fail(`${label}.jobTypes has too many entries`);
    for (const jobType of worker.jobTypes) {
      if (jobTypes.has(jobType)) fail(`job type ${jobType} is claimed by multiple workers`);
      jobTypes.add(jobType);
    }
  }
  if (uniqueStrings(worker.capabilityIds, isCapabilityId, `${label}.capabilityIds`) &&
      worker.capabilityIds.length > MAX_CAPABILITIES_PER_DEFINITION) {
    fail(`${label}.capabilityIds has too many entries`);
  }
  if (!isRelativeLaunchPath(worker.allowedExecutable)) fail(`${label}.allowedExecutable is not a safe relative path`);
  if (!isRelativeLaunchPath(worker.allowedEntrypoint)) fail(`${label}.allowedEntrypoint is not a safe relative path`);
  if (worker.protocolVersion !== 1) fail(`${label}.protocolVersion must be 1`);
  if (!RESOURCE_CLASSES.has(worker.resourceClass)) fail(`${label}.resourceClass is invalid`);
  for (const field of ["estimatedColdStartCommitMb", "softCommitLimitMb", "hardCommitLimitMb"]) {
    if (!integerInRange(worker[field], 1, MAX_COMMIT_LIMIT_MB)) {
      fail(`${label}.${field} must be an integer from 1 through ${MAX_COMMIT_LIMIT_MB}`);
    }
  }
  if (!integerInRange(worker.maximumConcurrency, 1, MAX_CONCURRENCY)) {
    fail(`${label}.maximumConcurrency must be an integer from 1 through ${MAX_CONCURRENCY}`);
  }
  for (const field of [
    "readyTimeoutMs",
    "heartbeatTimeoutMs",
    "gracefulCancellationMs",
    "maximumRuntimeMs",
  ]) {
    if (!integerInRange(worker[field], 1, MAX_TIMEOUT_MS)) {
      fail(`${label}.${field} must be an integer from 1 through ${MAX_TIMEOUT_MS}`);
    }
  }
  if (worker.softCommitLimitMb >= worker.hardCommitLimitMb) fail(`${label} commit limits are invalid`);
  if (worker.estimatedColdStartCommitMb > worker.hardCommitLimitMb) {
    fail(`${label} cold-start estimate exceeds its hard commit limit`);
  }
  if (worker.workspacePolicy !== "private-per-job") fail(`${label} must use a private per-job workspace`);
  if (worker.exitAfterJob !== true) fail(`${label} must exit after one job`);
  existingRegularFile(stagedRuntimeRoot, worker.allowedExecutable, `${label}.allowedExecutable`);
  existingRegularFile(repoRoot, worker.allowedEntrypoint, `${label}.allowedEntrypoint (dev)`);
  existingRegularFile(stagedAppRoot, worker.allowedEntrypoint, `${label}.allowedEntrypoint (packaged)`);
}

const serviceIds = new Set();
for (const [index, service] of services.entries()) {
  const label = `service[${index}]`;
  if (!exactKeys(service, SERVICE_FIELDS, label)) continue;
  if (!isIdentifier(service.id) || serviceIds.has(service.id)) fail(`${label}.id is invalid or duplicate`);
  serviceIds.add(service.id);
  if (
    typeof service.displayName !== "string" ||
    !service.displayName.trim() ||
    Buffer.byteLength(service.displayName, "utf8") > 256 ||
    /\p{Cc}/u.test(service.displayName)
  ) fail(`${label}.displayName is empty, oversized, or contains control characters`);
  if (uniqueStrings(service.capabilityIds, isCapabilityId, `${label}.capabilityIds`) &&
      service.capabilityIds.length > MAX_CAPABILITIES_PER_DEFINITION) {
    fail(`${label}.capabilityIds has too many entries`);
  }
  if (!isRelativeLaunchPath(service.allowedExecutable)) fail(`${label}.allowedExecutable is not a safe relative path`);
  if (service.allowedEntrypoint !== null && !isRelativeLaunchPath(service.allowedEntrypoint)) {
    fail(`${label}.allowedEntrypoint is not a safe relative path or null`);
  }
  if (!new Set(["eager", "on-demand", "scheduled", "external"]).has(service.startupPolicy)) {
    fail(`${label}.startupPolicy is invalid`);
  }
  if (!RESOURCE_CLASSES.has(service.resourceClass)) fail(`${label}.resourceClass is invalid`);
  if (!Array.isArray(service.dependencies) || service.dependencies.some((item) => !isIdentifier(item))) {
    fail(`${label}.dependencies is invalid`);
  } else {
    if (service.dependencies.length > MAX_DEPENDENCIES_PER_SERVICE) {
      fail(`${label}.dependencies has too many entries`);
    }
    if (new Set(service.dependencies).size !== service.dependencies.length) {
      fail(`${label}.dependencies contains duplicates`);
    }
  }
  for (const field of ["estimatedColdStartCommitMb", "softCommitLimitMb", "hardCommitLimitMb"]) {
    if (!integerInRange(service[field], 1, MAX_COMMIT_LIMIT_MB)) {
      fail(`${label}.${field} must be an integer from 1 through ${MAX_COMMIT_LIMIT_MB}`);
    }
  }
  if (!integerInRange(service.gracefulShutdownMs, 1, MAX_TIMEOUT_MS)) {
    fail(`${label}.gracefulShutdownMs must be an integer from 1 through ${MAX_TIMEOUT_MS}`);
  }
  if (service.softCommitLimitMb >= service.hardCommitLimitMb) fail(`${label} commit limits are invalid`);
  if (service.estimatedColdStartCommitMb > service.hardCommitLimitMb) {
    fail(`${label} cold-start estimate exceeds its hard commit limit`);
  }
  if (new Set(["on-demand", "scheduled"]).has(service.startupPolicy)) {
    if (!integerInRange(service.idleTtlMs, 1, MAX_TIMEOUT_MS)) {
      fail(`${label}.idleTtlMs must be a bounded positive integer for leased services`);
    }
  } else if (service.idleTtlMs !== null) {
    fail(`${label}.idleTtlMs must be null for non-leased services`);
  }
  if (!new Set(["never", "on_failure"]).has(service.restartPolicy)) fail(`${label}.restartPolicy is invalid`);
  existingRegularFile(stagedRuntimeRoot, service.allowedExecutable, `${label}.allowedExecutable`);
  if (service.allowedEntrypoint !== null) {
    existingRegularFile(repoRoot, service.allowedEntrypoint, `${label}.allowedEntrypoint (dev)`);
    existingRegularFile(stagedAppRoot, service.allowedEntrypoint, `${label}.allowedEntrypoint (packaged)`);
  }
}
for (const service of services) {
  for (const dependency of service.dependencies ?? []) {
    if (!serviceIds.has(dependency)) fail(`service ${service.id} has unknown dependency ${dependency}`);
  }
}

function visitService(id, visiting, visited) {
  if (visited.has(id)) return;
  if (visiting.has(id)) {
    fail(`service dependency graph contains a cycle at ${id}`);
    return;
  }
  visiting.add(id);
  const service = services.find((candidate) => candidate.id === id);
  for (const dependency of service?.dependencies ?? []) {
    if (serviceIds.has(dependency)) visitService(dependency, visiting, visited);
  }
  visiting.delete(id);
  visited.add(id);
}
const visitedServices = new Set();
for (const id of serviceIds) visitService(id, new Set(), visitedServices);

for (const required of contract.launchManifests?.requiredServiceIds ?? []) {
  if (!serviceIds.has(required)) fail(`required Runtime V2 service ${required} is not registered`);
}
for (const required of contract.launchManifests?.requiredWorkerJobTypes ?? []) {
  if (!jobTypes.has(required)) {
    const detail = required === "learn"
      ? "; the existing Learn worker requires legacy Node IPC/start-file orchestration and is not a Runtime V2 ready/event worker"
      : required === "document-ingestion"
        ? "; no dedicated finite ingestion worker entrypoint exists, and the in-process API route is not a worker"
        : "";
    fail(`required Runtime V2 job type ${required} is not registered${detail}`);
  }
}

const prepareSource = readText(
  path.join(desktopRoot, "scripts", "prepare-app-resources.mjs"),
  "app-resource staging source",
);
if (!/runtimeV2ManifestSource[\s\S]*?runtimeV2ManifestTarget[\s\S]*?copyTree\(runtimeV2ManifestSource, runtimeV2ManifestTarget\)/u.test(prepareSource)) {
  fail("prepare-app-resources does not byte-stage the authoritative Runtime V2 manifests");
}
for (const entry of ["runtime-v2-dashboard.mjs"]) {
  if (!prepareSource.includes(entry)) fail(`prepare-app-resources does not stage ${entry}`);
  const source = path.join(repoRoot, "dashboard", "scripts", entry);
  const staged = path.join(stagedAppRoot, "dashboard", "scripts", entry);
  if (readText(source, `${entry} source`) !== readText(staged, `${entry} stage`)) {
    fail(`staged ${entry} differs from its source authority`);
  }
}

const builder = readText(path.join(desktopRoot, "electron-builder.yml"), "Electron package config");
if (!/- from:\s*build-resources\/runtime-v2\s*[\r\n]+\s*to:\s*runtime-v2/u.test(builder)) {
  fail("electron-builder does not install build-resources/runtime-v2 as resources/runtime-v2");
}
const verifyPackage = readText(path.join(desktopRoot, "scripts", "verify-package.mjs"), "package verifier");
for (const required of ["runtime-v2", "workers.json", "services.json", "runtime-v2-dashboard.mjs"]) {
  if (!verifyPackage.includes(required)) fail(`package verifier does not require ${required}`);
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`[runtime-v2-manifests] FAIL: ${failure}\n`);
  process.stderr.write(
    `[runtime-v2-manifests] FAILED: ${failures.length} source/package coverage issue(s). No compiler, build, app, service, or worker was started.\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `[runtime-v2-manifests] PASS: ${services.length} service and ${workers.length} worker definitions have truthful dev/staged launch paths and package coverage. Source-only validation started no compiler, build, app, service, or worker.\n`,
  );
}
