#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveStagedRuntimeProbePath } from "./runtime-manifest-staging-roots.mjs";
import { validateMandatoryRuntimeServices } from "./mandatory-runtime-services.mjs";
import { validateGbrainNodeLaunch } from "./gbrain-node-launch-contract.mjs";

const qaDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDirectory, "..", "..");
const desktopRoot = path.join(repoRoot, "desktop");
const sourceManifestRoot = path.join(desktopRoot, "runtime-v2", "manifests");
const stagedRuntimeRoot = path.join(desktopRoot, "build-resources");
const stagedBinRoot = path.join(desktopRoot, "resources", "bin");
const stagedManifestRoot = path.join(stagedRuntimeRoot, "runtime-v2", "manifests");
const stagedAppRoot = path.join(stagedRuntimeRoot, "app-services");
const failures = [];
const MAX_MANIFEST_ENTRIES = 256;
const MAX_JOB_TYPES_PER_WORKER = 128;
const MAX_CAPABILITIES_PER_DEFINITION = 256;
const MAX_DEPENDENCIES_PER_SERVICE = 64;
const MAX_SERVICE_LAUNCH_PROFILES = 3;
const MAX_SERVICE_LAUNCH_ARGUMENTS = 64;
const MAX_SERVICE_INSTALL_PROBE_FILES = 32;
const MAX_SERVICE_ARGUMENT_BYTES = 4096;
const MAX_SERVICE_READINESS_MATCH_BYTES = 1024;
const MAX_CONCURRENCY = 256;
const MAX_COMMIT_LIMIT_MB = 1024 * 1024;
const MAX_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
const HOT_DASHBOARD_LAUNCHER = "dashboard/scripts/runtime-v2-hot-dashboard.mjs";
const HOT_DASHBOARD_NEXT_CLI = "dashboard/node_modules/next/dist/bin/next";

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
  "minimumInputBlobs",
  "maximumInputBlobs",
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
  "requirement",
  "launchProfiles",
  "readiness",
  "startupPolicy",
  "resourceClass",
  "dependencies",
  "maximumConcurrentLeases",
  "maximumLeaseMs",
  "idleTtlMs",
  "gracefulShutdownMs",
  "restartPolicy",
  "restartBounds",
];
const RUNTIME_MODES = new Set(["lean", "hot", "packaged"]);
const TRUSTED_SERVICE_ENVIRONMENT_SOURCES = new Set([
  "chatmock",
  "comfyui",
  "dashboard",
  "gbrain",
  "hermes",
  "telegram-gateway",
  "whatsapp-gateway",
  "openwork",
  "openscience",
  "money-printer",
  "wardrobe",
  "penecho",
  "vlm-ocr",
  "recall",
  "mem0-semantic-engine",
  "local-mcp-broker",
  "postiz-coordinator",
  "inbox-zero-stack",
  "spotify-playback",
  "cliproxy",
  "quartz",
  "ui-tars",
  "cad",
  "colpali",
  "humanizer",
  "voicebox",
  "scriberr",
  "deep-research",
  "deer-flow",
  "vibe-trading",
  "stock-analyst",
  "solidworks-mcp",
]);
const TRUSTED_WORKER_ENVIRONMENT_SOURCES = new Set([
  "minimal",
  "background",
  "document-ingestion",
  "audio-analyzer",
  "image-search-google",
  "interactive-visualizer",
  "quartz-publish",
  "managed-setup",
  "terminal",
  "code-index",
  "agent-edits",
  "outer-opencode",
  "trading-agent",
  "outer-career-ops",
  "outer-openexecutive",
  "system-location",
  "chatmock",
  "vimax",
  "vox-director",
  "outer-shorts",
  "outer-open-gym",
  "agent-reach-setup",
  "gbrain-sync",
  "thought-topology",
  "outer-agent-reach",
  "agent-browser-profile",
  "agent-tars",
  "outer-legal",
  "sf3d",
  "outer-codex",
  "outer-ruflo",
  "outer-deep-tutor",
  "deep-tutor-maintenance",
  "outer-openplanter",
  "manim",
  "premortem",
  "agent-loop",
  "omh",
  "factcheck",
  "watch-media",
  "loopx",
  "resource2skill",
  "outer-matraix",
  "formsmith",
  "hyperframes",
  "openmontage",
  "outer-bolt-slides",
  "subsai",
  "speech-media",
  "generated-visual-browser",
  "scriberr-garden",
  "watermark",
  "outer-hardware-blueprint",
  "get-doc",
  "get-doc-download",
  "meeting-notes",
  "outer-inbox-zero",
  "outer-socials-manager",
  "outer-max-research",
  "outer-wardrobe",
  "outer-parametric-cad",
  "outer-stock-analyst",
  "outer-vibe-trading",
  "outer-deer-flow",
  "outer-money-printer",
  "outer-video-use",
  "outer-deep-research",
  "outer-openscience",
  "outer-openwork",
]);
const WORKER_SERVICE_DEPENDENCY_CONDITIONS = new Set([
  "document-ingestion-parse-with-vlm",
  "gbrain-sync-always",
  "always",
  "scriberr-garden-transcription-always",
  "meeting-notes-engine-scriberr",
  "meeting-notes-engine-voicebox",
  "meeting-notes-needs-chatmock",
  "max-research-openscience-enabled",
]);
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

function existingStagedRuntimeFile(relative, label) {
  let absolute;
  try {
    absolute = resolveStagedRuntimeProbePath(stagedRuntimeRoot, stagedBinRoot, relative);
  } catch {
    fail(`${label} escaped its authority root`);
    return;
  }
  try {
    if (!fs.statSync(absolute).isFile()) throw new Error("not a file");
  } catch {
    fail(`${label} is not staged at ${path.relative(repoRoot, absolute)}`);
  }
}

function validateServiceInstallProbe(
  probe,
  executableAuthority,
  executable,
  appPaths,
  modes,
  label,
) {
  if (!exactKeys(probe, ["kind", "files"], `${label}.installProbe`)) return;
  if (probe.kind !== "files-present") fail(`${label}.installProbe.kind is invalid`);
  if (
    !Array.isArray(probe.files) ||
    probe.files.length < 1 ||
    probe.files.length > MAX_SERVICE_INSTALL_PROBE_FILES
  ) {
    fail(`${label}.installProbe.files is not a bounded nonempty array`);
    return;
  }
  const files = new Set();
  for (const [index, file] of probe.files.entries()) {
    const fileLabel = `${label}.installProbe.files[${index}]`;
    if (!exactKeys(file, ["authority", "path"], fileLabel)) continue;
    if (!new Set(["runtime-root", "app-root", "data-root"]).has(file.authority)) {
      fail(`${fileLabel}.authority is invalid`);
    }
    if (!isRelativeLaunchPath(file.path)) fail(`${fileLabel}.path is not a safe relative path`);
    const key = `${file.authority}\0${file.path}`;
    if (files.has(key)) fail(`${fileLabel} duplicates an install probe file`);
    files.add(key);
    if (file.authority === "runtime-root") {
      existingStagedRuntimeFile(file.path, `${fileLabel} (runtime)`);
    } else if (file.authority === "app-root") {
      // Lean's standalone server is a generated build output and may be absent
      // before the explicit lean rebuild. The runtime install probe remains
      // authoritative at launch. Hot source and packaged staged files, by
      // contrast, must already exist in their respective immutable app roots.
      if (modes.has("hot")) {
        existingRegularFile(repoRoot, file.path, `${fileLabel} (development)`);
      }
      if (modes.has("packaged")) {
        existingRegularFile(stagedAppRoot, file.path, `${fileLabel} (packaged)`);
      }
    }
  }
  if (!files.has(`${executableAuthority}\0${executable}`)) {
    fail(`${label}.installProbe does not prove its executable`);
  }
  for (const appPath of appPaths) {
    if (!files.has(`app-root\0${appPath}`)) {
      fail(`${label}.installProbe does not prove argv app path ${appPath}`);
    }
  }
}

function validateServiceLaunchProfile(profile, coveredModes, label) {
  if (!exactKeys(
    profile,
    [
      "modes",
      "executableAuthority",
      "allowedExecutable",
      "arguments",
      "environmentSource",
      "workingDirectory",
      "installProbe",
      "resourceLimits",
    ],
    label,
  )) return;
  const profileModes = new Set();
  if (
    !Array.isArray(profile.modes) ||
    profile.modes.length < 1 ||
    profile.modes.length > MAX_SERVICE_LAUNCH_PROFILES
  ) {
    fail(`${label}.modes is not a bounded nonempty array`);
  } else {
    for (const mode of profile.modes) {
      if (!RUNTIME_MODES.has(mode) || profileModes.has(mode) || coveredModes.has(mode)) {
        fail(`${label}.modes contains an invalid, duplicate, or overlapping mode`);
      }
      profileModes.add(mode);
      coveredModes.add(mode);
    }
  }
  if (!isRelativeLaunchPath(profile.allowedExecutable)) {
    fail(`${label}.allowedExecutable is not a safe relative path`);
  }
  if (!new Set(["runtime-root", "data-root"]).has(profile.executableAuthority)) {
    fail(`${label}.executableAuthority is invalid`);
  }
  const appPaths = [];
  if (!Array.isArray(profile.arguments) || profile.arguments.length > MAX_SERVICE_LAUNCH_ARGUMENTS) {
    fail(`${label}.arguments is not a bounded array`);
  } else {
    for (const [index, argument] of profile.arguments.entries()) {
      const argumentLabel = `${label}.arguments[${index}]`;
      if (!isRecord(argument) || typeof argument.kind !== "string") {
        fail(`${argumentLabel} must be a typed argument object`);
        continue;
      }
      if (argument.kind === "literal") {
        if (!exactKeys(argument, ["kind", "value"], argumentLabel)) continue;
        if (
          typeof argument.value !== "string" ||
          argument.value.length < 1 ||
          Buffer.byteLength(argument.value, "utf8") > MAX_SERVICE_ARGUMENT_BYTES ||
          /\p{Cc}/u.test(argument.value) ||
          argument.value.includes("${") ||
          argument.value.includes("{{") ||
          argument.value.includes("}}")
        ) fail(`${argumentLabel}.value is not a fixed bounded literal`);
      } else if (argument.kind === "app-path") {
        if (!exactKeys(argument, ["kind", "path"], argumentLabel)) continue;
        if (!isRelativeLaunchPath(argument.path)) fail(`${argumentLabel}.path is unsafe`);
        else appPaths.push(argument.path);
      } else if (argument.kind === "data-path") {
        if (!exactKeys(argument, ["kind", "path"], argumentLabel)) continue;
        if (!isRelativeLaunchPath(argument.path)) fail(`${argumentLabel}.path is unsafe`);
      } else if (argument.kind === "runtime-value") {
        if (!exactKeys(argument, ["kind", "value"], argumentLabel)) continue;
        if (argument.value !== "service-port") {
          fail(`${argumentLabel}.value is not runtime-minted`);
        }
      } else if (argument.kind === "runtime-arguments") {
        if (!exactKeys(argument, ["kind", "value"], argumentLabel)) continue;
        if (argument.value !== "recall-capture") {
          fail(`${argumentLabel}.value is not a closed runtime argument list`);
        }
      } else {
        fail(`${argumentLabel}.kind is invalid`);
      }
    }
  }
  if (!TRUSTED_SERVICE_ENVIRONMENT_SOURCES.has(profile.environmentSource)) {
    fail(`${label}.environmentSource is not trusted`);
  }
  if (!isRecord(profile.workingDirectory) || typeof profile.workingDirectory.kind !== "string") {
    fail(`${label}.workingDirectory must be a typed policy object`);
  } else if (profile.workingDirectory.kind === "app-root") {
    exactKeys(profile.workingDirectory, ["kind"], `${label}.workingDirectory`);
  } else if (profile.workingDirectory.kind === "hot-development-workspace") {
    if (
      exactKeys(
        profile.workingDirectory,
        ["kind", "appPath", "isolatedDataPath"],
        `${label}.workingDirectory`,
      )
    ) {
      if (!isRelativeLaunchPath(profile.workingDirectory.appPath)) {
        fail(`${label}.workingDirectory.appPath is unsafe`);
      }
      if (!isRelativeLaunchPath(profile.workingDirectory.isolatedDataPath)) {
        fail(`${label}.workingDirectory.isolatedDataPath is unsafe`);
      }
    }
    if (profileModes.size !== 1 || !profileModes.has("hot")) {
      fail(`${label}.workingDirectory hot development workspace is hot-only`);
    }
  } else if (
    profile.workingDirectory.kind === "app-subdirectory" ||
    profile.workingDirectory.kind === "data-subdirectory"
  ) {
    if (
      exactKeys(profile.workingDirectory, ["kind", "path"], `${label}.workingDirectory`) &&
      !isRelativeLaunchPath(profile.workingDirectory.path)
    ) fail(`${label}.workingDirectory.path is unsafe`);
  } else {
    fail(`${label}.workingDirectory.kind is invalid`);
  }
  validateServiceInstallProbe(
    profile.installProbe,
    profile.executableAuthority,
    profile.allowedExecutable,
    appPaths,
    profileModes,
    label,
  );
  if (!exactKeys(
    profile.resourceLimits,
    ["estimatedColdStartCommitMb", "softCommitLimitMb", "hardCommitLimitMb"],
    `${label}.resourceLimits`,
  )) return;
  for (const field of ["estimatedColdStartCommitMb", "softCommitLimitMb", "hardCommitLimitMb"]) {
    if (!integerInRange(profile.resourceLimits[field], field === "estimatedColdStartCommitMb" ? 1 : 0, MAX_COMMIT_LIMIT_MB)) {
      fail(`${label}.resourceLimits.${field} is invalid`);
    }
  }
  if (
    profile.resourceLimits.hardCommitLimitMb > 0 &&
    profile.resourceLimits.softCommitLimitMb >= profile.resourceLimits.hardCommitLimitMb
  ) fail(`${label}.resourceLimits commit ordering is invalid`);
  if (
    profile.resourceLimits.estimatedColdStartCommitMb >= profile.resourceLimits.hardCommitLimitMb
  ) fail(`${label}.resourceLimits cold-start estimate must be strictly less than the hard limit`);
}

function validateHotDashboardLaunch(services) {
  const dashboard = services.find((service) => service?.id === "dashboard");
  const hotProfiles = Array.isArray(dashboard?.launchProfiles)
    ? dashboard.launchProfiles.filter(
      (profile) => Array.isArray(profile?.modes) && profile.modes.includes("hot"),
    )
    : [];
  if (hotProfiles.length !== 1) {
    fail("dashboard must have exactly one Hot launch profile");
    return;
  }
  const hot = hotProfiles[0];
  if (
    JSON.stringify(hot.modes) !== JSON.stringify(["hot"]) ||
    hot.executableAuthority !== "runtime-root" ||
    hot.allowedExecutable !== "runtimes/node/node.exe" ||
    hot.environmentSource !== "dashboard"
  ) {
    fail("dashboard Hot launch must use the pinned Node runtime and dashboard environment");
  }
  const expectedArguments = [
    { kind: "app-path", path: HOT_DASHBOARD_LAUNCHER },
    { kind: "literal", value: "dev" },
    { kind: "literal", value: "--turbopack" },
    { kind: "literal", value: "--port" },
    { kind: "runtime-value", value: "service-port" },
    { kind: "literal", value: "--hostname" },
    { kind: "literal", value: "127.0.0.1" },
  ];
  if (JSON.stringify(hot.arguments) !== JSON.stringify(expectedArguments)) {
    fail("dashboard Hot launch must enter Next dev through the dotenv-shadow launcher");
  }
  if (JSON.stringify(hot.resourceLimits) !== JSON.stringify({
    estimatedColdStartCommitMb: 3072,
    softCommitLimitMb: 9216,
    hardCommitLimitMb: 11264,
  })) {
    fail("dashboard Hot launch must retain the reviewed bounded Turbopack memory envelope");
  }
  if (
    JSON.stringify(hot.workingDirectory) !==
    JSON.stringify({ kind: "app-subdirectory", path: "dashboard" })
  ) {
    fail("dashboard Hot launch must run from the physical dashboard source tree");
  }
  const expectedProbeFiles = new Set([
    "runtime-root\0runtimes/node/node.exe",
    `app-root\0${HOT_DASHBOARD_LAUNCHER}`,
    `app-root\0${HOT_DASHBOARD_NEXT_CLI}`,
  ]);
  const probeFiles = Array.isArray(hot.installProbe?.files)
    ? hot.installProbe.files
    : [];
  const actualProbeFiles = new Set(
    probeFiles.map(({ authority, path: filePath }) =>
      `${authority}\0${filePath}`,
    ),
  );
  if (
    hot.installProbe?.kind !== "files-present" ||
    probeFiles.length !== expectedProbeFiles.size ||
    actualProbeFiles.size !== expectedProbeFiles.size ||
    [...expectedProbeFiles].some((file) => !actualProbeFiles.has(file))
  ) {
    fail("dashboard Hot install probe must prove only Node, its Hot launcher, and Next");
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
for (const error of validateMandatoryRuntimeServices(services)) fail(error);
const workerKinds = new Set();
const jobTypes = new Set();
const workerServiceDependencies = [];
for (const [index, worker] of workers.entries()) {
  const label = `worker[${index}]`;
  const expectedWorkerFields = [
    ...WORKER_FIELDS,
    ...(Object.hasOwn(worker, "submissionAuthority") ? ["submissionAuthority"] : []),
    ...(Object.hasOwn(worker, "environmentSource") ? ["environmentSource"] : []),
    ...(Object.hasOwn(worker, "serviceDependencies") ? ["serviceDependencies"] : []),
  ];
  if (!exactKeys(worker, expectedWorkerFields, label)) continue;
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
  const maximumInputBlobs = contract.jobSubmission?.inputUploads?.maximumCount;
  if (
    !integerInRange(worker.minimumInputBlobs, 0, maximumInputBlobs) ||
    !integerInRange(worker.maximumInputBlobs, 0, maximumInputBlobs) ||
    worker.minimumInputBlobs > worker.maximumInputBlobs
  ) {
    fail(`${label} input blob count policy is invalid`);
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
  if (worker.estimatedColdStartCommitMb >= worker.hardCommitLimitMb) {
    fail(`${label} cold-start estimate must be strictly less than its hard commit limit`);
  }
  if (worker.workspacePolicy !== "private-per-job") fail(`${label} must use a private per-job workspace`);
  if (worker.exitAfterJob !== true) fail(`${label} must exit after one job`);
  const submissionAuthority = worker.submissionAuthority ?? "user";
  if (!new Set(["user", "runtime"]).has(submissionAuthority)) {
    fail(`${label}.submissionAuthority is invalid`);
  }
  const environmentSource = worker.environmentSource ?? "minimal";
  if (!TRUSTED_WORKER_ENVIRONMENT_SOURCES.has(environmentSource)) {
    fail(`${label}.environmentSource is not trusted`);
  }
  const dependencies = worker.serviceDependencies ?? [];
  if (!Array.isArray(dependencies) || dependencies.length > 8) {
    fail(`${label}.serviceDependencies is not a bounded array`);
  } else {
    const seenDependencies = new Set();
    for (const [dependencyIndex, dependency] of dependencies.entries()) {
      const dependencyLabel = `${label}.serviceDependencies[${dependencyIndex}]`;
      if (!exactKeys(dependency, ["serviceId", "condition"], dependencyLabel)) continue;
      if (!isIdentifier(dependency.serviceId) || seenDependencies.has(dependency.serviceId)) {
        fail(`${dependencyLabel}.serviceId is invalid or duplicate`);
      }
      seenDependencies.add(dependency.serviceId);
      if (!WORKER_SERVICE_DEPENDENCY_CONDITIONS.has(dependency.condition)) {
        fail(`${dependencyLabel}.condition is not a closed predicate`);
      }
      if (
        dependency.condition === "document-ingestion-parse-with-vlm" &&
        (worker.kind !== "document-ingestion-node" || !worker.jobTypes.includes("document-ingestion"))
      ) {
        fail(`${dependencyLabel}.condition is outside the worker's sealed request contract`);
      }
      if (
        dependency.condition.startsWith("meeting-notes-") &&
        (worker.kind !== "outer-meeting-notes-node" || !worker.jobTypes.includes("meeting-notes-run"))
      ) {
        fail(`${dependencyLabel}.condition is outside the Meeting Notes sealed request contract`);
      }
      if (
        dependency.condition === "max-research-openscience-enabled" &&
        (worker.kind !== "outer-max-research-node" || !worker.jobTypes.includes("max-research-run"))
      ) {
        fail(`${dependencyLabel}.condition is outside the Max Research sealed request contract`);
      }
      const requiredServiceForCondition = {
        "meeting-notes-engine-scriberr": "scriberr",
        "meeting-notes-engine-voicebox": "voicebox",
        "meeting-notes-needs-chatmock": "chatmock",
        "max-research-openscience-enabled": "openscience",
      }[dependency.condition];
      if (requiredServiceForCondition && dependency.serviceId !== requiredServiceForCondition) {
        fail(`${dependencyLabel}.serviceId does not match its closed predicate`);
      }
      workerServiceDependencies.push({ label: dependencyLabel, serviceId: dependency.serviceId });
    }
  }
  existingStagedRuntimeFile(worker.allowedExecutable, `${label}.allowedExecutable`);
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
  if (!new Set(["required", "optional"]).has(service.requirement)) {
    fail(`${label}.requirement is invalid`);
  }
  const coveredModes = new Set();
  if (
    !Array.isArray(service.launchProfiles) ||
    service.launchProfiles.length < 1 ||
    service.launchProfiles.length > MAX_SERVICE_LAUNCH_PROFILES
  ) {
    fail(`${label}.launchProfiles is not a bounded nonempty array`);
  } else {
    for (const [profileIndex, profile] of service.launchProfiles.entries()) {
      validateServiceLaunchProfile(profile, coveredModes, `${label}.launchProfiles[${profileIndex}]`);
    }
    if (coveredModes.size !== RUNTIME_MODES.size) {
      fail(`${label}.launchProfiles must cover lean, hot, and packaged exactly once`);
    }
  }
  if (!exactKeys(
    service.readiness,
    ["path", "expectedBodyContains", "requestTimeoutMs", "pollIntervalMs", "startupTimeoutMs"],
    `${label}.readiness`,
  )) {
    // exactKeys records the structural failure.
  } else {
    if (
      typeof service.readiness.path !== "string" ||
      Buffer.byteLength(service.readiness.path, "utf8") > 2048 ||
      !service.readiness.path.startsWith("/") ||
      service.readiness.path.startsWith("//") ||
      /[?#]/u.test(service.readiness.path) ||
      /\p{Cc}/u.test(service.readiness.path)
    ) fail(`${label}.readiness.path is not a bounded loopback HTTP path`);
    if (
      service.readiness.expectedBodyContains !== null &&
      (
        typeof service.readiness.expectedBodyContains !== "string" ||
        service.readiness.expectedBodyContains.length < 1 ||
        Buffer.byteLength(service.readiness.expectedBodyContains, "utf8") > MAX_SERVICE_READINESS_MATCH_BYTES ||
        /\p{Cc}/u.test(service.readiness.expectedBodyContains)
      )
    ) fail(`${label}.readiness.expectedBodyContains is invalid`);
    for (const field of ["requestTimeoutMs", "pollIntervalMs", "startupTimeoutMs"]) {
      if (!integerInRange(service.readiness[field], 1, MAX_TIMEOUT_MS)) {
        fail(`${label}.readiness.${field} must be a bounded positive integer`);
      }
    }
    if (
      service.readiness.requestTimeoutMs > service.readiness.startupTimeoutMs ||
      service.readiness.pollIntervalMs > service.readiness.startupTimeoutMs
    ) fail(`${label}.readiness timeout ordering is invalid`);
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
  if (!integerInRange(service.gracefulShutdownMs, 1, MAX_TIMEOUT_MS)) {
    fail(`${label}.gracefulShutdownMs must be an integer from 1 through ${MAX_TIMEOUT_MS}`);
  }
  if (!integerInRange(service.maximumConcurrentLeases, 1, MAX_CONCURRENCY)) {
    fail(`${label}.maximumConcurrentLeases must be an integer from 1 through ${MAX_CONCURRENCY}`);
  }
  if (!integerInRange(service.maximumLeaseMs, 1, MAX_TIMEOUT_MS)) {
    fail(`${label}.maximumLeaseMs must be an integer from 1 through ${MAX_TIMEOUT_MS}`);
  }
  if (new Set(["on-demand", "scheduled"]).has(service.startupPolicy)) {
    if (!integerInRange(service.idleTtlMs, 1, MAX_TIMEOUT_MS)) {
      fail(`${label}.idleTtlMs must be a bounded positive integer for leased services`);
    }
  } else if (service.idleTtlMs !== null) {
    fail(`${label}.idleTtlMs must be null for non-leased services`);
  }
  if (service.idleTtlMs !== null && service.idleTtlMs > service.maximumLeaseMs) {
    fail(`${label}.idleTtlMs exceeds maximumLeaseMs`);
  }
  if (!new Set(["never", "on_failure"]).has(service.restartPolicy)) fail(`${label}.restartPolicy is invalid`);
  if (service.restartPolicy === "never") {
    if (service.restartBounds !== null) fail(`${label}.restartBounds must be null when restarts are disabled`);
  } else if (!exactKeys(
    service.restartBounds,
    ["maximumRestarts", "windowMs", "initialBackoffMs", "maximumBackoffMs"],
    `${label}.restartBounds`,
  )) {
    // exactKeys records the structural failure.
  } else {
    if (!integerInRange(service.restartBounds.maximumRestarts, 1, MAX_CONCURRENCY)) {
      fail(`${label}.restartBounds.maximumRestarts is invalid`);
    }
    for (const field of ["windowMs", "initialBackoffMs", "maximumBackoffMs"]) {
      if (!integerInRange(service.restartBounds[field], 1, MAX_TIMEOUT_MS)) {
        fail(`${label}.restartBounds.${field} is invalid`);
      }
    }
    if (
      service.restartBounds.initialBackoffMs > service.restartBounds.maximumBackoffMs ||
      service.restartBounds.maximumBackoffMs > service.restartBounds.windowMs
    ) fail(`${label}.restartBounds ordering is invalid`);
  }
}
validateHotDashboardLaunch(services);
for (const error of validateGbrainNodeLaunch(services)) fail(error);
for (const service of services) {
  for (const dependency of service.dependencies ?? []) {
    if (!serviceIds.has(dependency)) fail(`service ${service.id} has unknown dependency ${dependency}`);
  }
}
for (const dependency of workerServiceDependencies) {
  if (!serviceIds.has(dependency.serviceId)) {
    fail(`${dependency.label} references unknown service ${dependency.serviceId}`);
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
if (!/copyTree\(\s*path\.join\(repoRoot, "dashboard", "src"\),\s*path\.join\(dashboardTarget, "dashboard", "worker-src"\)/u.test(prepareSource)) {
  fail("prepare-app-resources does not stage the finite-worker dashboard source closure");
}
for (const entry of [
  "runtime-v2-dashboard.mjs",
  "runtime-v2-learn-worker.mjs",
  "runtime-v2-document-ingestion-worker.mjs",
  "runtime-v2-office-artifact-worker.mjs",
  "runtime-v2-agent-browser-worker.mjs",
  "runtime-v2-agent-browser-executor.mjs",
  "runtime-v2-quartz-publish-worker.mjs",
  "runtime-v2-quartz-publish-executor.mjs",
  "runtime-v2-quartz-static-service.mjs",
  "runtime-v2-background-worker.mjs",
  "runtime-v2-background-executor.mjs",
  "runtime-v2-gateway-http.mjs",
  "runtime-v2-telegram-gateway-service.mjs",
  "runtime-v2-whatsapp-gateway-service.mjs",
  "runtime-v2-agent-service.mjs",
  "runtime-v2-vlm-ocr-service.mjs",
  "runtime-v2-recall-install-worker.mjs",
  "runtime-v2-recall-install-executor.mjs",
  "runtime-v2-mem0-service.mjs",
  "runtime-v2-local-mcp-broker-service.mjs",
  "runtime-v2-inbox-zero-service.mjs",
  "runtime-v2-spotify-playback-service.mjs",
  "runtime-v2-solidworks-mcp-service.mjs",
  "runtime-v2-audio-analyzer-worker.mjs",
  "runtime-v2-image-search-worker.mjs",
  "runtime-v2-finite-mcp-worker-core.mjs",
  "runtime-v2-interactive-visualizer-worker.mjs",
  "runtime-v2-interactive-visualizer-executor.mjs",
  "runtime-v2-managed-python-service.mjs",
  "runtime-v2-managed-setup-worker.mjs",
  "runtime-v2-managed-setup-executor.mjs",
  "runtime-v2-terminal-command-worker.mjs",
  "runtime-v2-graft-index-worker.mjs",
  "runtime-v2-agent-edits-worker.mjs",
  "runtime-v2-agent-edits-executor.mjs",
  "runtime-v2-codex-worker.mjs",
  "runtime-v2-ruflo-worker.mjs",
  "runtime-v2-deep-tutor-worker.mjs",
  "runtime-v2-opencode-worker.mjs",
  "runtime-v2-trading-agent-worker.mjs",
  "runtime-v2-career-ops-worker.mjs",
  "runtime-v2-openexecutive-worker.mjs",
  "runtime-v2-chatmock-login-worker.mjs",
  "runtime-v2-chatmock-login-executor.mjs",
  "runtime-v2-vimax-worker.mjs",
  "runtime-v2-vox-director-worker.mjs",
  "runtime-v2-cinema-agent-worker-core.mjs",
  "runtime-v2-cinema-agent-adapters.mjs",
  "runtime-v2-shorts-worker.mjs",
  "runtime-v2-open-gym-worker.mjs",
  "runtime-v2-agent-reach-setup-worker.mjs",
  "runtime-v2-agent-reach-setup-executor.mjs",
  "runtime-v2-agent-reach-configure.py",
  "runtime-v2-gbrain-sync-worker.mjs",
  "runtime-v2-thought-topology-worker.mjs",
  "runtime-v2-legal-worker.mjs",
  "runtime-v2-sf3d-worker.mjs",
  "sf3d-bridge.py",
  "runtime-v2-openplanter-worker.mjs",
  "openplanter-chatmock-runner.py",
  "runtime-v2-manim-worker.mjs",
  "runtime-v2-deep-tutor-probe-worker.mjs",
  "runtime-v2-deep-tutor-index-worker.mjs",
  "runtime-v2-deep-tutor-maintenance-executor.mjs",
  "runtime-v2-premortem-worker.mjs",
  "runtime-v2-agent-loop-worker.mjs",
  "runtime-v2-omh-worker.mjs",
  "runtime-v2-factcheck-worker.mjs",
  "runtime-v2-watch-worker.mjs",
  "runtime-v2-watch-executor.mjs",
  "runtime-v2-loopx-worker.mjs",
  "runtime-v2-resource2skill-worker.mjs",
  "runtime-v2-career-ops-probe-worker.mjs",
  "runtime-v2-matraix-worker.mjs",
  "runtime-v2-matraix-probe-worker.mjs",
  "runtime-v2-formsmith-worker.mjs",
  "runtime-v2-formsmith-executor.mjs",
  "runtime-v2-hyperframes-worker.mjs",
  "runtime-v2-openmontage-worker.mjs",
  "runtime-v2-openmontage-probe-worker.mjs",
  "runtime-v2-bolt-slides-worker.mjs",
  "runtime-v2-legal-probe-worker.mjs",
  "runtime-v2-shorts-probe-worker.mjs",
  "runtime-v2-tradingagents-probe-worker.mjs",
  "runtime-v2-subsai-transcription-worker.mjs",
  "runtime-v2-subsai-probe-worker.mjs",
  "runtime-v2-subsai-worker-layout.mjs",
  "runtime-v2-speech-media-worker.mjs",
  "runtime-v2-speech-media-executor.mjs",
  "runtime-v2-generated-visual-browser-worker.mjs",
  "runtime-v2-generated-visual-browser-executor.mjs",
  "runtime-v2-generated-visual-compiler-worker.mjs",
  "runtime-v2-generated-visual-compiler-executor.mjs",
  "runtime-v2-agent-browser-profile-worker.mjs",
  "runtime-v2-agent-browser-profile-executor.mjs",
  "runtime-v2-scriberr-worker.mjs",
  "runtime-v2-scriberr-executor.mjs",
  "runtime-v2-scriberr-import-hook.mjs",
  "runtime-v2-watermark-worker.mjs",
  "runtime-v2-hardware-blueprint-worker.mjs",
  "runtime-v2-get-doc-worker.mjs",
  "runtime-v2-get-doc-download-worker.mjs",
  "runtime-v2-meeting-notes-worker.mjs",
  "runtime-v2-inbox-zero-worker.mjs",
  "runtime-v2-socials-manager-worker.mjs",
  "runtime-v2-max-research-worker.mjs",
  "runtime-v2-wardrobe-worker.mjs",
  "runtime-v2-parametric-cad-worker.mjs",
  "runtime-v2-stock-analyst-worker.mjs",
  "runtime-v2-vibe-trading-worker.mjs",
  "runtime-v2-deer-flow-worker.mjs",
  "runtime-v2-money-printer-worker.mjs",
  "runtime-v2-video-use-worker.mjs",
  "runtime-v2-deep-research-worker.mjs",
  "runtime-v2-openscience-worker.mjs",
  "runtime-v2-openwork-worker.mjs",
  "runtime-v2-python-agent-probe-worker-core.mjs",
  "runtime-v2-agent-reach-worker.mjs",
  "runtime-v2-agent-tars-worker.mjs",
  "runtime-v2-outer-agent-worker-core.mjs",
  "runtime-v2-outer-agent-adapters.mjs",
  "runtime-v2-system-location-worker.mjs",
  "runtime-v2-system-location-executor.mjs",
  "runtime-v2-worker-events.mjs",
  "vox_local.py",
  "book-to-skill-bridge.py",
  "learn-worker-import-hook.mjs",
]) {
  if (!prepareSource.includes(entry)) fail(`prepare-app-resources does not stage ${entry}`);
  const source = path.join(repoRoot, "dashboard", "scripts", entry);
  const staged = path.join(stagedAppRoot, "dashboard", "scripts", entry);
  if (readText(source, `${entry} source`) !== readText(staged, `${entry} stage`)) {
    fail(`staged ${entry} differs from its source authority`);
  }
}

for (const relative of [
  "app/api/ingest/route.ts",
  "lib/knowledge.ts",
  "lib/ingest-token-usage.ts",
  "lib/anydoc/convert.ts",
  "lib/document-safety/index.ts",
  "lib/vlm-ocr/parse.ts",
  "lib/office/officecli.ts",
  "lib/office/contract.ts",
  "lib/office/agent-query.ts",
  "lib/genoffice/agent-query.ts",
  "lib/genoffice/pdf-query.ts",
  "lib/document-skills/bridge.ts",
  "lib/document-skills/validate-worker.ts",
  "lib/hermes/artifact-renderers.ts",
  "lib/markdown-render/frontmatter.ts",
  "lib/markdown-render/theme.ts",
  "lib/markdown-render/docx.ts",
  "lib/markdown-render/pdf.ts",
  "lib/generated-visual-browser-tests.ts",
  "lib/generated-visual-compiler.ts",
  "lib/generated-visuals.ts",
]) {
  const source = path.join(repoRoot, "dashboard", "src", ...relative.split("/"));
  const staged = path.join(
    stagedAppRoot,
    "dashboard-standalone",
    "dashboard",
    "worker-src",
    ...relative.split("/"),
  );
  if (readText(source, `${relative} worker source`) !== readText(staged, `${relative} worker stage`)) {
    fail(`staged finite-worker source differs for ${relative}`);
  }
}

for (const dependency of [
  "@embedpdf/pdfium",
  "@firecrawl/anydoc",
  "adm-zip",
  "bidi-js",
  "fast-xml-parser",
  "jszip",
  "katex",
  "mathjax-full",
  "openai",
  "pdf-parse",
  "pdfkit",
  "remark-gfm",
  "remark-math",
  "remark-parse",
  "svg-to-pdfkit",
  "unified",
  "utif2",
]) {
  if (!prepareSource.includes(`"${dependency}"`)) {
    fail(`prepare-app-resources does not stage the ${dependency} finite-worker dependency closure`);
  }
  existingRegularFile(
    path.join(stagedAppRoot, "dashboard-standalone", "dashboard", "node_modules"),
    `${dependency}/package.json`,
    `${dependency} finite-worker dependency package`,
  );
}

for (const relative of [
  "book-to-skill/book_to_skill/utils.py",
  "book-to-skill/tools/validate_skill.py",
  "book-to-skill/LICENSE.md",
]) {
  existingRegularFile(stagedAppRoot, relative, `${relative} worker dependency`);
}

const builder = readText(path.join(desktopRoot, "electron-builder.yml"), "Electron package config");
if (!/- from:\s*build-resources\/runtime-v2\s*[\r\n]+\s*to:\s*runtime-v2/u.test(builder)) {
  fail("electron-builder does not install build-resources/runtime-v2 as resources/runtime-v2");
}
if (!/- from:\s*resources\/bin\s*[\r\n]+\s*to:\s*bin/u.test(builder)) {
  fail("electron-builder does not install resources/bin as resources/bin");
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
