import { createHash } from "node:crypto";

import { applyParityContractCorrections } from "../runtime-v2/parity-contract-corrections.mjs";

const DRIVER_BY_CATEGORY = Object.freeze({
  approval: "approval",
  "artifact-type": "artifact",
  attachment: "attachment",
  "chat-surface": "surface",
  connection: "connection",
  "connection-catalog": "connection-catalog",
  "model-selection": "model",
  profile: "profile",
  provider: "provider",
  recovery: "recovery",
  registry: "registry",
  repository: "repository",
  "tool-family": "tool",
  workflow: "workflow",
});

const SLASH_CATEGORIES = new Set([
  "agency-persona",
  "default-prompt",
  "first-party-persona",
  "first-party-skill",
  "installed-reviewed-skill",
  "runtime-agent",
]);

const PREREQUISITE_SOURCES = Object.freeze([
  ["credentialRequirements", "CREDENTIAL"],
  ["providerRequirements", "EXTERNAL_SERVICE"],
  ["externalSoftwareRequirements", "EXTERNAL_SOFTWARE"],
]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;

// A planner descriptor is not execution authority. Keep every new family
// fail-closed until its packaged UI executor and typed observation validator
// are both implemented and covered by focused tests.
const IMPLEMENTED_RECOVERY_DRIVER_KINDS = new Set([
  "REFRESH",
  "SOURCE_SELECTION_FAIL_CLOSED",
  "STORED_SELECTION_APP_RESTART",
]);

const INCOMPLETE_OUTPUT_DRIVER_KIND_BY_CAPABILITY = Object.freeze({
  // Each value names the real observation family. None is a PASS authority:
  // its null driver keeps prelaunch closed until the dedicated workflow
  // exercises every required case/facet in packaged Electron.
  "skill:first-party:office": "ARTIFACT_KIND_MATRIX",
  "workflow:document-editing": "ARTIFACT_KIND_MATRIX",

  "registry:artifact-renderers": "RENDERER_MATRIX",
  "tool-family:artifacts": "RENDERER_MATRIX",
  "workflow:artifact-lifecycle": "RENDERER_MATRIX",

  "skill:first-party:resource2skill": Object.freeze({
    kind: "RUNTIME_EVENT_FACETS",
    identities: Object.freeze([
      "web domain outputs",
      "presentation domain outputs",
      "spreadsheet domain outputs",
      "scene domain outputs",
      "audio domain outputs",
    ]),
  }),
  "runtime-agent:agent-tars": "RUNTIME_EVENT_FACETS",
  "runtime-agent:deep-research": "RUNTIME_EVENT_FACETS",
  "runtime-agent:deer-flow": "RUNTIME_EVENT_FACETS",
  "runtime-agent:get-doc": "RUNTIME_EVENT_FACETS",
  "runtime-agent:hardware-blueprint": "RUNTIME_EVENT_FACETS",
  "runtime-agent:inbox-zero": "RUNTIME_EVENT_FACETS",
  "runtime-agent:max-research": "RUNTIME_EVENT_FACETS",
  "runtime-agent:meeting-notes": "RUNTIME_EVENT_FACETS",
  "runtime-agent:money-printer": "RUNTIME_EVENT_FACETS",
  "runtime-agent:openscience": "RUNTIME_EVENT_FACETS",
  "runtime-agent:openwork": "RUNTIME_EVENT_FACETS",
  "runtime-agent:parametric-cad": "RUNTIME_EVENT_FACETS",
  "runtime-agent:socials-manager": "RUNTIME_EVENT_FACETS",
  "runtime-agent:stock-analyst": "RUNTIME_EVENT_FACETS",
  "runtime-agent:vibe-trading": "RUNTIME_EVENT_FACETS",
  "runtime-agent:video-use": "RUNTIME_EVENT_FACETS",
  "runtime-agent:wardrobe": "RUNTIME_EVENT_FACETS",
  "tool-family:artifact-render": "RUNTIME_EVENT_FACETS",
  "tool-family:image-generation": "RUNTIME_EVENT_FACETS",
  "workflow:meeting-notes-transcription": "RUNTIME_EVENT_FACETS",
  "workflow:parametric-cad": "RUNTIME_EVENT_FACETS",

  "repository:agent-edits": "ROUTE_RESULT_FIELDS",
  "repository:snapshot-inspection": "ROUTE_RESULT_FIELDS",
  "tool-family:watermark": "ROUTE_RESULT_FIELDS",
  "workflow:research": Object.freeze({
    kind: "ROUTE_RESULT_FIELDS",
    identities: Object.freeze([
      "research_begin state",
      "research_record evidence conflicts and gaps",
      "research_status coverage and stop reason",
      "final cited chat synthesis",
    ]),
  }),
  "workflow:watch-video": Object.freeze({
    kind: "ROUTE_RESULT_FIELDS",
    identities: Object.freeze([
      "report",
      "framePaths",
      "analyzedFrameCount",
      "workDirectory",
      "durationMs",
      "stderr",
      "optional ChatMock analysis or warning",
    ]),
  }),

  "workflow:garden-mutations": "LIFECYCLE_SEQUENCE",
  "workflow:learn": "LIFECYCLE_SEQUENCE",
  "workflow:runtime-setup": "LIFECYCLE_SEQUENCE",
  "workflow:scriberr-transcription": "LIFECYCLE_SEQUENCE",
});

const RECOVERY_NOT_APPLICABLE_AUTHORITIES = Object.freeze({
  "surface:temporary-chat": Object.freeze({
    reasonCode: "INTENTIONAL_NON_DURABLE_TEMPORARY_CHAT",
    correctionReasonCode: "FROZEN_BASELINE_OVERGENERALIZED_TEMPORARY_CHAT_DURABILITY",
    requiredEvidencePrefixes: Object.freeze([
      "dashboard/src/app/components/hermes/use-agent-session.ts:",
      "dashboard/src/lib/conversations/store.ts:",
      "dashboard/tests/temporary-chat.test.mjs:",
    ]),
  }),
});

// These are deliberate corrections for frozen inventory rows whose prose
// runtime dependency predates the native manifest capabilityIds. They are
// finite and capability-specific: adding a new row or dependency still fails
// closed instead of entering through name similarity.
export const PACKAGED_PARITY_RUNTIME_ALIASES = Object.freeze({
  services: Object.freeze({
    "surface:legacy-garden-chat": Object.freeze(["dashboard", "hermes"]),
    "surface:temporary-chat": Object.freeze(["dashboard", "hermes"]),
    "model:default": Object.freeze(["chatmock"]),
    "model:gpt-5.4": Object.freeze(["chatmock"]),
    "model:gpt-5.5": Object.freeze(["chatmock"]),
    "model:gpt-5.6-luna": Object.freeze(["chatmock"]),
    "model:gpt-5.6-sol": Object.freeze(["chatmock"]),
    "model:gpt-5.6-terra": Object.freeze(["chatmock"]),
    "provider:anthropic": Object.freeze(["chatmock"]),
    "provider:chatgpt": Object.freeze(["chatmock"]),
    "provider:custom": Object.freeze(["chatmock"]),
    "provider:deepseek": Object.freeze(["chatmock"]),
    "provider:google": Object.freeze(["chatmock"]),
    "provider:groq": Object.freeze(["chatmock"]),
    "provider:mistral": Object.freeze(["chatmock"]),
    "provider:openai": Object.freeze(["chatmock"]),
    "provider:openrouter": Object.freeze(["chatmock"]),
    "provider:together": Object.freeze(["chatmock"]),
    "provider:xai": Object.freeze(["chatmock"]),
    "tool-family:humanizer": Object.freeze(["humanizer"]),
    "workflow:garden-mutations": Object.freeze(["dashboard"]),
    "workflow:image-generation": Object.freeze(["comfyui"]),
    "workflow:meeting-notes-transcription": Object.freeze(["scriberr"]),
    "workflow:memory": Object.freeze(["mem0-semantic-engine"]),
    "workflow:research": Object.freeze(["chatmock"]),
    "workflow:scriberr-transcription": Object.freeze(["scriberr"]),
    "workflow:semantic-retrieval": Object.freeze(["chatmock"]),
    "workflow:speech-transcription": Object.freeze(["voicebox"]),
  }),
  workers: Object.freeze({
    "workflow:ingestion": Object.freeze(["document-ingestion-node"]),
    "workflow:meeting-notes-transcription": Object.freeze(["subsai-transcription-node"]),
    "workflow:speech-transcription": Object.freeze(["speech-media-node"]),
  }),
});

const EXPLICIT_NON_NATIVE_RUNTIME_REQUIREMENTS = new Set([
  "Gemini API",
  "Upload-Post",
  "Wechatsync",
  "xiaohongshu-mcp",
  "biliup",
  "Xquik",
  "connected-apps broker",
  "renderer-specific workers when needed",
  "sandboxed gadget renderer",
  "optional Quartz publisher",
  "selected image provider or ComfyUI",
  "document extractors",
  "optional Anydoc/VLM/Quartz parser",
  "Scriberr or Voicebox",
  "ffmpeg",
  "optional Mem0 embeddings",
  "selected model",
  "web retrieval",
  "Scriberr",
  "ffmpeg/ffprobe",
  "yt-dlp for YouTube",
  "optional local ChatMock embeddings",
  "Voicebox",
  "Runtime V2 speech-media-node with fixed ffmpeg",
]);

function fail(message) {
  throw new Error(`Packaged parity plan rejected: ${message}`);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    fail(`${label} must be an array of non-empty strings.`);
  }
  return [...value];
}

function stableToken(value, prefix = "value") {
  const readable = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._:@/-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
  const digest = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
  return `${prefix}:${readable || "unnamed"}:${digest}`;
}

function manifestEntries(manifest, field, label) {
  if (!record(manifest) || !Array.isArray(manifest[field])) fail(`${label} manifest is malformed.`);
  const seen = new Set();
  return manifest[field].map((entry, index) => {
    if (!record(entry)) fail(`${label}[${index}] must be an object.`);
    const idField = field === "services" ? "id" : "kind";
    const id = nonEmptyString(entry[idField], `${label}[${index}].${idField}`);
    if (seen.has(id)) fail(`${label} manifest duplicates ${id}.`);
    seen.add(id);
    const capabilityIds = stringArray(entry.capabilityIds ?? [], `${label}[${index}].capabilityIds`);
    return Object.freeze({
      id,
      capabilityIds: Object.freeze(capabilityIds),
      ...(field === "services"
        ? {
            requirement: nonEmptyString(entry.requirement, `${label}[${index}].requirement`),
            startupPolicy: nonEmptyString(entry.startupPolicy, `${label}[${index}].startupPolicy`),
          }
        : {
            jobTypes: Object.freeze(stringArray(entry.jobTypes, `${label}[${index}].jobTypes`)),
            gracefulCancellationMs: Number(entry.gracefulCancellationMs),
          }),
    });
  });
}

function driverFor(row) {
  if (SLASH_CATEGORIES.has(row.category)) {
    const slashCommand = nonEmptyString(row.slashCommand, `${row.capabilityId}.slashCommand`);
    if (!slashCommand.startsWith("/")) fail(`${row.capabilityId} slashCommand must start with '/'.`);
    return Object.freeze({ kind: "slash", slashCommand });
  }
  if (row.slashCommand !== null) {
    fail(`${row.capabilityId} has an unexpected slashCommand outside an allowlisted slash category.`);
  }
  const kind = DRIVER_BY_CATEGORY[row.category];
  if (!kind) fail(`${row.capabilityId} has unsupported category ${String(row.category)}.`);
  return Object.freeze({ kind });
}

function prerequisitesFor(row) {
  const prerequisites = [];
  for (const [field, prerequisiteType] of PREREQUISITE_SOURCES) {
    for (const requirement of stringArray(row[field], `${row.capabilityId}.${field}`)) {
      prerequisites.push(Object.freeze({
        prerequisiteType,
        // The receipt validator compares this byte-for-byte with the frozen
        // inventory array. Do not slug or hash it even though today's
        // observation schema cannot encode several space-containing values;
        // that incompatibility must remain a visible fail-closed gap.
        prerequisiteId: requirement,
        frozenRequirement: requirement,
      }));
    }
  }
  prerequisites.sort((left, right) =>
    `${left.prerequisiteType}:${left.prerequisiteId}`.localeCompare(
      `${right.prerequisiteType}:${right.prerequisiteId}`,
    ));
  return Object.freeze(prerequisites);
}

function outputContract(row) {
  const outputTypes = stringArray(row.outputTypes, `${row.capabilityId}.outputTypes`);
  const artifactTypes = stringArray(row.artifactTypes, `${row.capabilityId}.artifactTypes`);
  if (outputTypes.length === 0 && artifactTypes.length === 0) {
    fail(`${row.capabilityId} has no observable output contract.`);
  }
  // Chat surfaces and attachment acceptance are proven by their own visible
  // output contract. Their artifactTypes arrays describe what the surface can
  // carry, not an artifact that every smoke turn must generate. Treating values
  // such as "all surface-authorized artifact kinds" as one literal renderer
  // kind would let the planner ask for an impossible, invented artifact.
  const representativeArtifactRequired =
    artifactTypes.length > 0 &&
    row.category !== "chat-surface" &&
    row.category !== "attachment";
  const source = representativeArtifactRequired ? artifactTypes[0] : outputTypes[0] ?? artifactTypes[0];
  const reviewedOutput = INCOMPLETE_OUTPUT_DRIVER_KIND_BY_CAPABILITY[row.capabilityId] ?? "SINGLE_OUTPUT";
  const semanticKind = typeof reviewedOutput === "string" ? reviewedOutput : reviewedOutput.kind;
  const explicitIdentities = typeof reviewedOutput === "string" ? null : reviewedOutput.identities;
  const requiredOutputIdentities = explicitIdentities ?? artifactTypes;
  if (artifactTypes.length > 1 && semanticKind === "SINGLE_OUTPUT") {
    fail(`${row.capabilityId} has multiple output identities without a reviewed output-contract family.`);
  }
  if (artifactTypes.length <= 1 && semanticKind !== "SINGLE_OUTPUT" && explicitIdentities === null) {
    fail(`${row.capabilityId} output-contract family is stale after its source correction.`);
  }
  return Object.freeze({
    outputKind: stableToken(source, "output"),
    expectedType: source,
    requiresOpenArtifact: representativeArtifactRequired && semanticKind === "SINGLE_OUTPUT",
    requiredArtifactTypes: Object.freeze(representativeArtifactRequired ? [...artifactTypes] : []),
    requiredOutputIdentities: Object.freeze([...requiredOutputIdentities]),
    contractKind: semanticKind,
    driverKind: semanticKind === "SINGLE_OUTPUT" ? "GENERIC_SINGLE_OUTPUT" : null,
  });
}

function cancellationSupported(row) {
  const contract = nonEmptyString(row.cancellationBehavior, `${row.capabilityId}.cancellationBehavior`);
  return !/^not applicable\.?$/iu.test(contract) && !/does not create a run/iu.test(contract);
}

function recoverySupported(row) {
  const contract = nonEmptyString(row.recoveryBehavior, `${row.capabilityId}.recoveryBehavior`);
  return !/^not applicable\.?$/iu.test(contract);
}

function recoveryScenarioKind(row) {
  const contract = nonEmptyString(row.recoveryBehavior, `${row.capabilityId}.recoveryBehavior`);
  if (/^not applicable\.?$/iu.test(contract)) return "NOT_APPLICABLE";
  if (/^refresh reconnects by session\/run id and bounded event cursor\.?$/iu.test(contract)) {
    return "REFRESH_RECONNECT";
  }
  if (row.category === "agency-persona" || row.category === "first-party-persona") {
    return "SOURCE_SELECTION_FAIL_CLOSED";
  }
  if (row.category === "registry") return "REGISTRY_INTEGRITY";
  if (row.category === "attachment") return "BLOB_INTEGRITY";
  if (row.category === "artifact-type") return "ATOMIC_ARTIFACT_ROLLBACK";
  if (row.category === "approval") return "DURABLE_APPROVAL_STATE";
  if (row.category === "model-selection") return "STORED_SELECTION_RESTART";
  if (row.category === "provider" || row.category === "connection" || row.category === "connection-catalog") {
    return "EXTERNAL_DEPENDENCY_NO_FALLBACK";
  }
  if (row.category === "runtime-agent") return "DURABLE_RUN_IDENTITY";
  if (row.category === "default-prompt" || row.category === "first-party-skill" || row.category === "installed-reviewed-skill") {
    return "CONVERSATION_RUN_RECONCILIATION";
  }
  if (row.capabilityId === "recovery:research-ephemeral" || row.capabilityId === "workflow:research") {
    return "INTENTIONAL_EPHEMERAL_LOSS";
  }
  if (/\b(?:atomic|rollback|prior public tree|last valid|expected-version|version\/source history)\b/iu.test(contract)) {
    return "ATOMIC_STATE_ROLLBACK";
  }
  if (/\b(?:unavailable|missing|failed|failure|error|fallback|stopped service)\b/iu.test(contract)) {
    return "DEPENDENCY_FAILURE_NO_FALLBACK";
  }
  if (/\b(?:retry|interrupted|uncertain|reconcil|resume|requeue|persist|survive|durable|checkpoint|terminal)\w*\b/iu.test(contract)) {
    return "DURABLE_JOB_RECONCILIATION";
  }
  if (row.category === "tool-family") return "TOOL_EVENT_REPLAY";
  return "CAPABILITY_SPECIFIC_STATE";
}

function recoveryDriver(row, scenarioKind) {
  if (scenarioKind === "NOT_APPLICABLE") {
    return Object.freeze({ driverKind: null, selectionIdentity: null });
  }
  if (scenarioKind === "REFRESH_RECONNECT") {
    return Object.freeze({ driverKind: "REFRESH", selectionIdentity: null });
  }
  if (scenarioKind === "SOURCE_SELECTION_FAIL_CLOSED") {
    const slashCommand = nonEmptyString(row.slashCommand, `${row.capabilityId}.slashCommand`);
    const prefix = row.category === "agency-persona"
      ? "/agents:agency-agents:"
      : row.category === "first-party-persona"
        ? "/agent:"
        : null;
    if (prefix === null || !slashCommand.startsWith(prefix)) {
      fail(`${row.capabilityId} source-selection recovery lacks its exact normal-UI persona command.`);
    }
    const selectionIdentity = slashCommand.slice(prefix.length);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(selectionIdentity)) {
      fail(`${row.capabilityId} source-selection recovery has an invalid persona identity.`);
    }
    return Object.freeze({
      driverKind: IMPLEMENTED_RECOVERY_DRIVER_KINDS.has("SOURCE_SELECTION_FAIL_CLOSED")
        ? "SOURCE_SELECTION_FAIL_CLOSED"
        : null,
      selectionIdentity,
    });
  }
  if (scenarioKind === "STORED_SELECTION_RESTART") {
    const prefix = "model:";
    if (!row.capabilityId.startsWith(prefix)) {
      fail(`${row.capabilityId} stored-selection recovery lacks a canonical model capability ID.`);
    }
    const selectionIdentity = row.capabilityId.slice(prefix.length);
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(selectionIdentity)) {
      fail(`${row.capabilityId} stored-selection recovery has an invalid model identity.`);
    }
    return Object.freeze({
      driverKind: IMPLEMENTED_RECOVERY_DRIVER_KINDS.has("STORED_SELECTION_APP_RESTART")
        ? "STORED_SELECTION_APP_RESTART"
        : null,
      selectionIdentity,
    });
  }
  if (scenarioKind === "CONVERSATION_RUN_RECONCILIATION") {
    const capabilityPrefix = row.category === "default-prompt"
      ? "prompt:default:"
      : row.category === "first-party-skill"
        ? "skill:first-party:"
        : row.category === "installed-reviewed-skill"
          ? "skill:installed:"
          : null;
    const slashCommand = nonEmptyString(row.slashCommand, `${row.capabilityId}.slashCommand`);
    if (capabilityPrefix === null || !/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slashCommand)) {
      fail(`${row.capabilityId} conversation-run recovery lacks its exact normal-UI slash selection.`);
    }
    const selectionIdentity = slashCommand.slice(1);
    if (row.capabilityId !== `${capabilityPrefix}${selectionIdentity}`) {
      fail(`${row.capabilityId} conversation-run recovery slash selection does not match its frozen capability identity.`);
    }
    return Object.freeze({
      driverKind: IMPLEMENTED_RECOVERY_DRIVER_KINDS.has("CONVERSATION_RUN_RELOAD")
        ? "CONVERSATION_RUN_RELOAD"
        : null,
      selectionIdentity,
    });
  }
  return Object.freeze({ driverKind: null, selectionIdentity: null });
}

function recoveryNotApplicableAuthority(row) {
  if (recoverySupported(row)) return null;
  const authority = RECOVERY_NOT_APPLICABLE_AUTHORITIES[row.capabilityId];
  if (!authority) {
    fail(`${row.capabilityId} declares recovery Not applicable without a reviewed source-backed authority.`);
  }
  if (
    !record(row.contractCorrection) ||
    row.contractCorrection.reasonCode !== authority.correctionReasonCode ||
    !Array.isArray(row.contractCorrection.authoritativeSourceRefs)
  ) {
    fail(`${row.capabilityId} recovery Not applicable lacks an authenticated contract-correction overlay.`);
  }
  const evidence = stringArray(
    row.contractCorrection.authoritativeSourceRefs,
    `${row.capabilityId}.contractCorrection.authoritativeSourceRefs`,
  );
  for (const prefix of authority.requiredEvidencePrefixes) {
    if (!evidence.some((reference) => reference.startsWith(prefix))) {
      fail(`${row.capabilityId} recovery Not applicable lacks source authority from ${prefix}`);
    }
  }
  return Object.freeze({
    reasonCode: authority.reasonCode,
    sourceProvenPreMigrationSemantics: true,
    evidence: Object.freeze(evidence.filter((reference) =>
      authority.requiredEvidencePrefixes.some((prefix) => reference.startsWith(prefix)))),
  });
}

function followUpSupported(row) {
  const contract = nonEmptyString(row.followUpContextBehavior, `${row.capabilityId}.followUpContextBehavior`);
  return !/^not applicable\.?$/iu.test(contract);
}

/**
 * Compile the frozen inventory and native manifests into a complete execution
 * plan. Runtime evidence is associated only through exact manifest
 * capabilityIds; prose dependency names are never fuzzily promoted into a
 * managed-service or worker claim.
 */
export function buildPackagedParityPlan({ inventory, serviceManifest, workerManifest }) {
  if (!record(inventory) || inventory.schemaVersion !== 2 || !Array.isArray(inventory.capabilities)) {
    fail("feature-parity inventory must be schema version 2.");
  }
  if (inventory.capabilityCount !== inventory.capabilities.length) {
    fail("feature-parity capabilityCount does not match capabilities.length.");
  }
  const effectiveInventory = applyParityContractCorrections(inventory);
  const services = manifestEntries(serviceManifest, "services", "services");
  const workers = manifestEntries(workerManifest, "workers", "workers");
  const seen = new Set();
  const plans = effectiveInventory.capabilities.map((row, index) => {
    if (!record(row)) fail(`capabilities[${index}] must be an object.`);
    const capabilityId = nonEmptyString(row.capabilityId, `capabilities[${index}].capabilityId`);
    if (!ID_PATTERN.test(capabilityId)) fail(`${capabilityId} is not a canonical capability ID.`);
    if (seen.has(capabilityId)) fail(`feature-parity inventory duplicates ${capabilityId}.`);
    seen.add(capabilityId);
    const category = nonEmptyString(row.category, `${capabilityId}.category`);
    const directServices = services
      .filter((service) => service.capabilityIds.includes(capabilityId))
      .map((service) => Object.freeze({
        serviceId: service.id,
        requirement: service.requirement,
        startupPolicy: service.startupPolicy,
        associationAuthority: "manifest-capability-id",
      }));
    const aliasedServiceIds = PACKAGED_PARITY_RUNTIME_ALIASES.services[capabilityId] ?? [];
    const mappedServices = [...directServices];
    for (const serviceId of aliasedServiceIds) {
      if (mappedServices.some((service) => service.serviceId === serviceId)) continue;
      const service = services.find(({ id }) => id === serviceId);
      if (!service) fail(`${capabilityId} aliases missing service ${serviceId}.`);
      mappedServices.push(Object.freeze({
        serviceId,
        requirement: service.requirement,
        startupPolicy: service.startupPolicy,
        associationAuthority: "explicit-frozen-alias",
      }));
    }
    const directWorkers = workers
      .filter((worker) => worker.capabilityIds.includes(capabilityId))
      .map((worker) => Object.freeze({
        workerKind: worker.id,
        jobTypes: worker.jobTypes,
        gracefulCancellationMs: worker.gracefulCancellationMs,
        associationAuthority: "manifest-capability-id",
      }));
    const aliasedWorkerIds = PACKAGED_PARITY_RUNTIME_ALIASES.workers[capabilityId] ?? [];
    const mappedWorkers = [...directWorkers];
    for (const workerKind of aliasedWorkerIds) {
      if (mappedWorkers.some((worker) => worker.workerKind === workerKind)) continue;
      const worker = workers.find(({ id }) => id === workerKind);
      if (!worker) fail(`${capabilityId} aliases missing worker ${workerKind}.`);
      mappedWorkers.push(Object.freeze({
        workerKind,
        jobTypes: worker.jobTypes,
        gracefulCancellationMs: worker.gracefulCancellationMs,
        associationAuthority: "explicit-frozen-alias",
      }));
    }
    const declaredRuntimeRequirements = stringArray(
      row.requiredServiceOrWorker,
      `${capabilityId}.requiredServiceOrWorker`,
    );
    if (
      declaredRuntimeRequirements.length > 0 &&
      mappedServices.length === 0 &&
      mappedWorkers.length === 0 &&
      declaredRuntimeRequirements.some((requirement) => !EXPLICIT_NON_NATIVE_RUNTIME_REQUIREMENTS.has(requirement))
    ) {
      fail(`${capabilityId} has an unclassified frozen runtime requirement.`);
    }
    const recoveryScenario = recoveryScenarioKind(row);
    const plannedRecoveryDriver = recoveryDriver(row, recoveryScenario);
    return Object.freeze({
      capabilityId,
      displayName: nonEmptyString(row.displayName, `${capabilityId}.displayName`),
      category,
      visibleEntryPoint: nonEmptyString(row.visibleEntryPoint, `${capabilityId}.visibleEntryPoint`),
      driver: driverFor(row),
      services: Object.freeze(mappedServices),
      workers: Object.freeze(mappedWorkers),
      declaredRuntimeRequirements: Object.freeze(declaredRuntimeRequirements),
      prerequisites: prerequisitesFor(row),
      output: outputContract(row),
      cancellation: Object.freeze({
        supported: cancellationSupported(row),
        contract: row.cancellationBehavior,
      }),
      followUp: Object.freeze({
        supported: followUpSupported(row),
        contract: row.followUpContextBehavior,
      }),
      recovery: Object.freeze({
        supported: recoverySupported(row),
        scenarioKind: recoveryScenario,
        driverKind: plannedRecoveryDriver.driverKind,
        selectionIdentity: plannedRecoveryDriver.selectionIdentity,
        notApplicable: recoveryNotApplicableAuthority(row),
        contract: row.recoveryBehavior,
      }),
      baseline: Object.freeze({
        status: nonEmptyString(row.preMigrationStatus, `${capabilityId}.preMigrationStatus`),
        evidence: Object.freeze(stringArray(row.preMigrationEvidence, `${capabilityId}.preMigrationEvidence`)),
      }),
      contractCorrection: row.contractCorrection ?? null,
    });
  });
  plans.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  if (plans.length !== effectiveInventory.capabilityCount || seen.size !== effectiveInventory.capabilityCount) {
    fail("the execution plan does not cover every inventory capability exactly once.");
  }
  return Object.freeze(plans);
}

export function assertCompletePackagedParityOutcomes(plans, outcomes) {
  if (!Array.isArray(plans) || !Array.isArray(outcomes)) fail("plans and outcomes must be arrays.");
  const expected = plans.map(({ capabilityId }) => capabilityId).sort();
  const actual = outcomes.map((outcome) => outcome?.capabilityId).sort();
  if (actual.some((id) => typeof id !== "string") || new Set(actual).size !== actual.length) {
    fail("workflow outcomes contain a missing or duplicate capabilityId.");
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const missing = expected.filter((id) => !actual.includes(id));
    const unexpected = actual.filter((id) => !expected.includes(id));
    fail(`workflow outcome coverage differs (missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}).`);
  }
  return true;
}

export function packagedParityAcceptanceGaps(plans) {
  if (!Array.isArray(plans)) fail("plans must be an array.");
  const gaps = [];
  for (const plan of plans) {
    if (!record(plan) || typeof plan.capabilityId !== "string") fail("plans contain a malformed capability.");
    if (plan.capabilityId === "surface:quartz-ai") {
      gaps.push(Object.freeze({
        capabilityId: plan.capabilityId,
        code: "VISIBLE_UI_ENTRY_POINT_MISSING",
        summary: "Quartz BreadboardAI is not mounted in the published Quartz layout; direct route dispatch is not normal-UI evidence.",
      }));
    }
    if (plan.recovery?.supported === true && plan.recovery?.driverKind === null) {
      gaps.push(Object.freeze({
        capabilityId: plan.capabilityId,
        code: `RECOVERY_${plan.recovery.scenarioKind}_DRIVER_INCOMPLETE`,
        summary: `The producer has no real packaged scenario for this frozen recovery contract: ${plan.recovery.contract}`,
      }));
    }
    if (plan.category === "registry") {
      gaps.push(Object.freeze({
        capabilityId: plan.capabilityId,
        code: "REGISTRY_BEHAVIOR_DRIVER_INCOMPLETE",
        summary: "The producer has no capability-specific visible registry workflow that exercises every frozen registry behavior.",
      }));
    }
    if (plan.output?.driverKind === null) {
      gaps.push(Object.freeze({
        capabilityId: plan.capabilityId,
        code: `OUTPUT_${plan.output.contractKind}_DRIVER_INCOMPLETE`,
        summary: `The producer has no packaged ${plan.output.contractKind} driver for all required identities: ${plan.output.requiredOutputIdentities.join(", ")}.`,
      }));
    }
  }
  return Object.freeze(gaps.sort((left, right) =>
    left.capabilityId.localeCompare(right.capabilityId) || left.code.localeCompare(right.code)));
}

export function assertNoPackagedParityAcceptanceGaps(plans) {
  const gaps = packagedParityAcceptanceGaps(plans);
  if (gaps.length > 0) {
    const grouped = new Map();
    for (const gap of gaps) {
      const group = grouped.get(gap.code) ?? [];
      group.push(gap.capabilityId);
      grouped.set(gap.code, group);
    }
    const details = [...grouped]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, capabilityIds]) =>
        `${code}=${capabilityIds.length}[${capabilityIds.slice(0, 3).join(",")}${capabilityIds.length > 3 ? ",..." : ""}]`)
      .join("; ");
    fail(`packaged parity has ${gaps.length} explicit acceptance gap(s); no Electron run or PASS receipt is authorized (${details}).`);
  }
  return true;
}

/**
 * There is deliberately no inference from credential-looking UI text to a
 * publishable blocker. A BLOCKED receipt requires an already authenticated,
 * frozen pre-migration BLOCKED authority for the same prerequisite.
 */
export function assertPublishableBlockedOutcome(plan, outcome) {
  if (outcome?.result !== "BLOCKED") fail("blocked outcome authority was requested for a non-BLOCKED result.");
  if (plan.baseline.status !== "BLOCKED") {
    fail(`${plan.capabilityId} was operational/present before migration; missing prerequisites are missing baseline evidence, not a publishable BLOCKED result.`);
  }
  if (!record(outcome.blocker)) fail(`${plan.capabilityId} BLOCKED outcome has no exact blocker.`);
  const frozen = plan.prerequisites.find((candidate) =>
    candidate.prerequisiteType === outcome.blocker.prerequisiteType &&
    candidate.prerequisiteId === outcome.blocker.prerequisiteId);
  if (!frozen) fail(`${plan.capabilityId} blocker is not an exact frozen prerequisite.`);
  if (outcome.baselineBlockerAuthority !== "authenticated-installed-electron") {
    fail(`${plan.capabilityId} lacks authenticated pre-migration installed-Electron blocker authority.`);
  }
  return frozen;
}
