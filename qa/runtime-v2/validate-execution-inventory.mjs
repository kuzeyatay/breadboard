#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, "..", "..");
const inventoryPath = path.join(qaDir, "execution-inventory.json");
const featureParityPath = path.join(qaDir, "feature-parity.json");

const CLASSIFICATIONS = [
  "core",
  "disposable-job",
  "on-demand-service",
  "scheduled-service",
  "external",
  "proven-lightweight",
];

const REQUIRED_ENTRY_FIELDS = [
  "runtime_id",
  "source_identity",
  "display_name",
  "capability_ids",
  "current_owner",
  "executable_runtime",
  "root_command",
  "startup_policy",
  "dependency_chain",
  "flags",
  "finite",
  "persistent",
  "exits_after_work",
  "idle_behavior",
  "cancel_behavior",
  "recovery_behavior",
  "current_memory_baseline_mb",
  "measured_peak_mb",
  "memory_metric",
  "return_after_completion",
  "classification",
  "current_state",
  "target_state",
  "sources",
  "evidence",
];

const REQUIRED_FLAGS = [
  "spawns_descendants",
  "calls_model",
  "launches_chromium",
  "uses_docker",
  "uses_wsl",
  "handles_large_files",
];

const REQUIRED_GAP_FIELDS = [
  "gap_id",
  "status",
  "description",
  "required_resolution",
  "sources",
];

const AMBIGUOUS_TARGET =
  /(?:^|[_\s;|/()\-])or(?:$|[_\s;|/()\-])|\b(?:either|choose|tbd|unknown)\b|not[_ -]decided/i;

const failures = [];
const checkedSourcePaths = new Set();

function fail(message) {
  failures.push(message);
}

function readJson(absolutePath, label) {
  if (!fs.existsSync(absolutePath)) {
    process.stderr.write(`[runtime-v2-execution-inventory] FAIL: missing ${label}: ${absolutePath}\n`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[runtime-v2-execution-inventory] FAIL: invalid ${label}: ${detail}\n`);
    process.exit(1);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sameOrderedStrings(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function sameStringSet(actual, expected) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== "string")) return false;
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return (
    actualSet.size === actual.length &&
    actualSet.size === expectedSet.size &&
    [...actualSet].every((value) => expectedSet.has(value))
  );
}

function validNullableMemory(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function stripLineAnchor(reference) {
  const match = reference.match(/^(.*?):\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/);
  return match ? match[1] : reference;
}

function checkSourceReference(reference, owner) {
  if (!nonEmptyString(reference)) {
    fail(`${owner} contains an empty source reference`);
    return;
  }
  const relativePath = stripLineAnchor(reference.trim());
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relativeToRoot = path.relative(repoRoot, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    fail(`${owner} source escapes the repository: ${reference}`);
    return;
  }
  checkedSourcePaths.add(relativePath.replaceAll("\\", "/"));
  if (!fs.existsSync(absolutePath)) fail(`${owner} references missing source ${relativePath}`);
}

function requireEntry(entriesById, runtimeId) {
  const entry = entriesById.get(runtimeId);
  if (!entry) fail(`required runtime entry is missing: ${runtimeId}`);
  return entry;
}

function requireDisposition(entry, classification, { finite, persistent }) {
  if (!entry) return;
  if (entry.classification !== classification) {
    fail(`${entry.runtime_id} must be ${classification}, found ${entry.classification}`);
  }
  if (entry.finite !== finite || entry.persistent !== persistent) {
    fail(
      `${entry.runtime_id} lifecycle must be finite=${finite}, persistent=${persistent}; found finite=${entry.finite}, persistent=${entry.persistent}`,
    );
  }
}

const inventory = readJson(inventoryPath, "execution inventory JSON");
const featureParity = readJson(featureParityPath, "feature parity JSON");

if (!Number.isInteger(inventory.schema_version) || inventory.schema_version !== 1) {
  fail(`schema_version must be 1, found ${inventory.schema_version}`);
}
if (inventory.status !== "SOURCE_AUDITED_NOT_EXECUTED") {
  fail(`status must remain SOURCE_AUDITED_NOT_EXECUTED, found ${inventory.status}`);
}
if (inventory.migration_status !== "NOT_CUT_OVER") {
  fail(`migration_status must remain NOT_CUT_OVER, found ${inventory.migration_status}`);
}
if (!sameOrderedStrings(inventory.classification_values, CLASSIFICATIONS)) {
  fail(`classification_values must exactly equal ${CLASSIFICATIONS.join(", ")}`);
}
if (!Array.isArray(inventory.entries)) fail("entries must be an array");
if (!Array.isArray(inventory.unclassified_or_blocked_gaps)) {
  fail("unclassified_or_blocked_gaps must be an array");
}
if (!isObject(inventory.inventory_counts)) fail("inventory_counts must be an object");
if (!isObject(inventory.parity_registry)) fail("parity_registry must be an object");

const entries = Array.isArray(inventory.entries) ? inventory.entries : [];
const entriesById = new Map();

for (const [index, entry] of entries.entries()) {
  const owner = nonEmptyString(entry?.runtime_id) ? entry.runtime_id : `entries[${index}]`;
  if (!isObject(entry)) {
    fail(`${owner} must be an object`);
    continue;
  }
  for (const field of REQUIRED_ENTRY_FIELDS) {
    if (!hasOwn(entry, field)) fail(`${owner} is missing mandatory field ${field}`);
  }
  if (!nonEmptyString(entry.runtime_id)) {
    fail(`${owner} runtime_id must be a non-empty string`);
  } else if (entriesById.has(entry.runtime_id)) {
    fail(`duplicate runtime_id ${entry.runtime_id}`);
  } else {
    entriesById.set(entry.runtime_id, entry);
  }
  for (const field of [
    "source_identity",
    "display_name",
    "current_owner",
    "executable_runtime",
    "startup_policy",
    "idle_behavior",
    "cancel_behavior",
    "recovery_behavior",
    "return_after_completion",
    "current_state",
    "target_state",
  ]) {
    if (!nonEmptyString(entry[field])) fail(`${owner} ${field} must be a non-empty string`);
  }
  if (entry.root_command !== null && !nonEmptyString(entry.root_command)) {
    fail(`${owner} root_command must be null or a non-empty string`);
  }
  for (const field of ["capability_ids", "dependency_chain", "sources", "evidence"]) {
    if (!Array.isArray(entry[field])) fail(`${owner} ${field} must be an array`);
  }
  if (Array.isArray(entry.capability_ids)) {
    if (entry.capability_ids.length === 0) fail(`${owner} capability_ids must not be empty`);
    if (!sameStringSet(entry.capability_ids, entry.capability_ids)) {
      fail(`${owner} capability_ids must contain unique strings`);
    }
  }
  if (Array.isArray(entry.dependency_chain) && !sameStringSet(entry.dependency_chain, entry.dependency_chain)) {
    fail(`${owner} dependency_chain must contain unique strings`);
  }
  if (!isObject(entry.flags)) {
    fail(`${owner} flags must be an object`);
  } else {
    const flagNames = Object.keys(entry.flags).sort();
    const requiredFlagNames = [...REQUIRED_FLAGS].sort();
    if (!sameOrderedStrings(flagNames, requiredFlagNames)) {
      fail(`${owner} flags must contain exactly ${REQUIRED_FLAGS.join(", ")}`);
    }
    for (const flag of REQUIRED_FLAGS) {
      if (typeof entry.flags[flag] !== "boolean") fail(`${owner} flag ${flag} must be boolean`);
    }
  }
  for (const field of ["finite", "persistent", "exits_after_work"]) {
    if (typeof entry[field] !== "boolean") fail(`${owner} ${field} must be boolean`);
  }
  if (typeof entry.finite === "boolean" && typeof entry.persistent === "boolean") {
    if (entry.finite === entry.persistent) {
      fail(`${owner} must be exactly one of finite or persistent`);
    }
  }
  if (!CLASSIFICATIONS.includes(entry.classification)) {
    fail(`${owner} has invalid classification ${entry.classification}`);
  }
  if (entry.classification === "disposable-job" && (!entry.finite || entry.persistent)) {
    fail(`${owner} disposable-job must be finite and not persistent`);
  }
  if (
    ["core", "on-demand-service", "scheduled-service", "proven-lightweight"].includes(
      entry.classification,
    ) &&
    (entry.finite || !entry.persistent)
  ) {
    fail(`${owner} ${entry.classification} must be persistent and not finite`);
  }
  if (!validNullableMemory(entry.current_memory_baseline_mb)) {
    fail(`${owner} current_memory_baseline_mb must be null or a non-negative finite number`);
  }
  if (!validNullableMemory(entry.measured_peak_mb)) {
    fail(`${owner} measured_peak_mb must be null or a non-negative finite number`);
  }
  if (entry.memory_metric !== null && !nonEmptyString(entry.memory_metric)) {
    fail(`${owner} memory_metric must be null or a non-empty string`);
  }
  if (nonEmptyString(entry.target_state) && AMBIGUOUS_TARGET.test(entry.target_state)) {
    fail(`${owner} has an ambiguous target_state: ${entry.target_state}`);
  }
  if (Array.isArray(entry.sources)) {
    if (entry.sources.length === 0) fail(`${owner} sources must not be empty`);
    for (const source of entry.sources) checkSourceReference(source, owner);
  }
}

for (const entry of entries) {
  if (!isObject(entry) || !nonEmptyString(entry.runtime_id)) continue;
  for (const dependency of Array.isArray(entry.dependency_chain) ? entry.dependency_chain : []) {
    if (!nonEmptyString(dependency)) {
      fail(`${entry.runtime_id} has an empty dependency ID`);
    } else if (dependency === entry.runtime_id) {
      fail(`${entry.runtime_id} depends on itself`);
    } else if (!entriesById.has(dependency)) {
      fail(`${entry.runtime_id} references unresolved dependency ${dependency}`);
    }
  }
}

const counts = isObject(inventory.inventory_counts) ? inventory.inventory_counts : {};
const computedClassCounts = Object.fromEntries(
  CLASSIFICATIONS.map((classification) => [
    classification,
    entries.filter((entry) => entry?.classification === classification).length,
  ]),
);
const finiteCount = entries.filter((entry) => entry?.finite === true).length;
const persistentCount = entries.filter((entry) => entry?.persistent === true).length;
const runtimeAgentEntries = entries.filter((entry) =>
  entry?.runtime_id?.startsWith("job:runtime-agent:"),
);
const nonAgentFiniteCount = entries.filter(
  (entry) => entry?.finite === true && !entry?.runtime_id?.startsWith("job:runtime-agent:"),
).length;

for (const [field, actual] of [
  ["total_entries", entries.length],
  ["finite_entries", finiteCount],
  ["persistent_entries", persistentCount],
  ["runtime_agent_jobs", runtimeAgentEntries.length],
  ["non_agent_finite_jobs", nonAgentFiniteCount],
]) {
  if (counts[field] !== actual) fail(`inventory_counts.${field}=${counts[field]}; computed ${actual}`);
}
if (!isObject(counts.by_classification)) {
  fail("inventory_counts.by_classification must be an object");
} else {
  if (!sameStringSet(Object.keys(counts.by_classification), CLASSIFICATIONS)) {
    fail("inventory_counts.by_classification must contain exactly the six classifications");
  }
  for (const classification of CLASSIFICATIONS) {
    if (counts.by_classification[classification] !== computedClassCounts[classification]) {
      fail(
        `inventory_counts.by_classification.${classification}=${counts.by_classification[classification]}; computed ${computedClassCounts[classification]}`,
      );
    }
  }
}

const gaps = Array.isArray(inventory.unclassified_or_blocked_gaps)
  ? inventory.unclassified_or_blocked_gaps
  : [];
const gapIds = new Set();
for (const [index, gap] of gaps.entries()) {
  const owner = nonEmptyString(gap?.gap_id) ? gap.gap_id : `gaps[${index}]`;
  if (!isObject(gap)) {
    fail(`${owner} must be an object`);
    continue;
  }
  for (const field of REQUIRED_GAP_FIELDS) {
    if (!hasOwn(gap, field)) fail(`${owner} is missing mandatory field ${field}`);
  }
  if (!nonEmptyString(gap.gap_id)) {
    fail(`${owner} gap_id must be a non-empty string`);
  } else if (gapIds.has(gap.gap_id)) {
    fail(`duplicate gap_id ${gap.gap_id}`);
  } else {
    gapIds.add(gap.gap_id);
  }
  for (const field of ["status", "description", "required_resolution"]) {
    if (!nonEmptyString(gap[field])) fail(`${owner} ${field} must be a non-empty string`);
  }
  if (!Array.isArray(gap.sources) || gap.sources.length === 0) {
    fail(`${owner} sources must be a non-empty array`);
  } else {
    for (const source of gap.sources) checkSourceReference(source, owner);
  }
}
if (counts.unclassified_or_blocked_gaps !== gaps.length) {
  fail(
    `inventory_counts.unclassified_or_blocked_gaps=${counts.unclassified_or_blocked_gaps}; computed ${gaps.length}`,
  );
}

if (!Array.isArray(featureParity.capabilities)) fail("feature-parity capabilities must be an array");
const parityCapabilities = Array.isArray(featureParity.capabilities)
  ? featureParity.capabilities
  : [];
const parityById = new Map();
for (const capability of parityCapabilities) {
  if (!nonEmptyString(capability?.capabilityId)) {
    fail("feature-parity contains a capability without a capabilityId");
  } else if (parityById.has(capability.capabilityId)) {
    fail(`feature-parity contains duplicate capabilityId ${capability.capabilityId}`);
  } else {
    parityById.set(capability.capabilityId, capability);
  }
}
if (featureParity.capabilityCount !== parityCapabilities.length) {
  fail(
    `feature-parity capabilityCount=${featureParity.capabilityCount}; computed ${parityCapabilities.length}`,
  );
}

const joinedRuntimeAgentIds = new Set();
const sourceRunKinds = new Set();
for (const entry of runtimeAgentEntries) {
  const primaryId = entry.runtime_id.slice("job:".length);
  if (!/^runtime-agent:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(primaryId)) {
    fail(`${entry.runtime_id} has an invalid stable runtime-agent ID`);
  }
  if (!Array.isArray(entry.capability_ids) || !entry.capability_ids.includes(primaryId)) {
    fail(`${entry.runtime_id} capability_ids does not contain ${primaryId}`);
  }
  const parityRow = parityById.get(primaryId);
  if (!parityRow) {
    fail(`${entry.runtime_id} does not join feature-parity capability ${primaryId}`);
  } else if (parityRow.category !== "runtime-agent") {
    fail(`${primaryId} joins feature-parity category ${parityRow.category}, expected runtime-agent`);
  }
  if (joinedRuntimeAgentIds.has(primaryId)) fail(`duplicate runtime-agent join ${primaryId}`);
  joinedRuntimeAgentIds.add(primaryId);
  if (!nonEmptyString(entry.external_run_kind)) {
    fail(`${entry.runtime_id} external_run_kind must be a non-empty string`);
  } else if (sourceRunKinds.has(entry.external_run_kind)) {
    fail(`duplicate runtime-agent external_run_kind ${entry.external_run_kind}`);
  } else {
    sourceRunKinds.add(entry.external_run_kind);
  }
  if (!nonEmptyString(entry.api_root)) fail(`${entry.runtime_id} api_root must be a non-empty string`);
  requireDisposition(entry, "disposable-job", { finite: true, persistent: false });
}
const parityRuntimeAgentIds = new Set(
  parityCapabilities
    .filter((capability) => capability.category === "runtime-agent")
    .map((capability) => capability.capabilityId),
);
if (runtimeAgentEntries.length !== 37) {
  fail(`execution inventory contains ${runtimeAgentEntries.length} runtime-agent jobs; expected 37`);
}
if (parityRuntimeAgentIds.size !== 37) {
  fail(`feature-parity contains ${parityRuntimeAgentIds.size} runtime-agent rows; expected 37`);
}
for (const capabilityId of parityRuntimeAgentIds) {
  if (!joinedRuntimeAgentIds.has(capabilityId)) {
    fail(`feature-parity runtime agent is missing from execution inventory: ${capabilityId}`);
  }
}

const parityRegistry = isObject(inventory.parity_registry) ? inventory.parity_registry : {};
const allCapabilityRefs = new Set(
  entries.flatMap((entry) => (Array.isArray(entry?.capability_ids) ? entry.capability_ids : [])),
);
const matchedCapabilityRefs = [...allCapabilityRefs].filter((capabilityId) =>
  parityById.has(capabilityId),
).length;
const inventoryOnlyCapabilityRefs = allCapabilityRefs.size - matchedCapabilityRefs;
const expectedParityPath = path.relative(repoRoot, featureParityPath).replaceAll("\\", "/");
for (const [field, actual] of [
  ["path", expectedParityPath],
  ["schema_version", featureParity.schemaVersion],
  ["capability_count", parityCapabilities.length],
  ["verified_runtime_agent_joins", joinedRuntimeAgentIds.size],
  ["unique_capability_references", allCapabilityRefs.size],
  ["references_present_in_parity_registry", matchedCapabilityRefs],
  ["inventory_only_references_pending_reconciliation", inventoryOnlyCapabilityRefs],
]) {
  if (parityRegistry[field] !== actual) {
    fail(`parity_registry.${field}=${parityRegistry[field]}; computed ${actual}`);
  }
}

const localMcp = requireEntry(entriesById, "service:local-mcp-stdio");
requireDisposition(localMcp, "on-demand-service", { finite: false, persistent: true });
if (localMcp?.root_command === null) fail("service:local-mcp-stdio must identify an app-launched command boundary");
const remoteMcp = requireEntry(entriesById, "external:remote-mcp-endpoints");
requireDisposition(remoteMcp, "external", { finite: false, persistent: true });
if (remoteMcp?.root_command !== null) {
  fail("external:remote-mcp-endpoints must not declare an app-launched root command");
}
for (const entry of entries.filter((candidate) => candidate?.classification === "external")) {
  if (/stdio/i.test(entry.executable_runtime ?? "") || /stdio/i.test(entry.root_command ?? "")) {
    fail(`${entry.runtime_id} classifies an app-spawned stdio executable as external`);
  }
}

const quartzServer = requireEntry(entriesById, "service:quartz");
requireDisposition(quartzServer, "on-demand-service", { finite: false, persistent: true });
if (!/prebuilt/i.test(quartzServer?.target_state ?? "") || !/no.compiler/i.test(quartzServer?.target_state ?? "")) {
  fail("service:quartz target_state must be prebuilt serving with no compiler");
}
for (const runtimeId of ["job:quartz-esbuild-compiler", "job:quartz-publish"]) {
  const entry = requireEntry(entriesById, runtimeId);
  requireDisposition(entry, "disposable-job", { finite: true, persistent: false });
}
if (entriesById.has("service:quartz-esbuild")) {
  fail("legacy service:quartz-esbuild must not remain classified as a persistent service");
}

const browserWorker = requireEntry(entriesById, "job:agent-browser-chromium-worker");
requireDisposition(browserWorker, "disposable-job", { finite: true, persistent: false });
if (browserWorker?.flags?.launches_chromium !== true || browserWorker?.exits_after_work !== true) {
  fail("job:agent-browser-chromium-worker must launch Chromium and exit after its run");
}
if (entriesById.has("service:agent-browser-chromium")) {
  fail("legacy service:agent-browser-chromium must not remain a persistent service");
}
const agentBrowserRun = requireEntry(entriesById, "job:runtime-agent:agent-browser");
if (!agentBrowserRun?.dependency_chain?.includes("job:agent-browser-chromium-worker")) {
  fail("job:runtime-agent:agent-browser must depend on the disposable Chromium worker");
}
if (/leased.browser/i.test(agentBrowserRun?.target_state ?? "")) {
  fail("job:runtime-agent:agent-browser target_state must not retain a leased browser service");
}

const baselineReceipt = inventory.measurement_baseline?.receipt;
if (!nonEmptyString(baselineReceipt)) {
  fail("measurement_baseline.receipt must be a non-empty source path");
} else {
  checkSourceReference(baselineReceipt, "measurement_baseline");
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`[runtime-v2-execution-inventory] FAIL: ${failure}\n`);
  }
  process.stderr.write(
    `[runtime-v2-execution-inventory] FAILED: ${failures.length} issue(s) across ${entries.length} entry row(s).\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `[runtime-v2-execution-inventory] PASS: ${entries.length} entries (${finiteCount} finite, ${persistentCount} persistent), ${runtimeAgentEntries.length} runtime-agent joins, ${gaps.length} gap rows, ${checkedSourcePaths.size} source paths; classifications=${JSON.stringify(computedClassCounts)}. Source-only validation started no build, compiler, app, browser, model, container, worker, or service.\n`,
  );
}
