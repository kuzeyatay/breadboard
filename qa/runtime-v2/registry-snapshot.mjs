import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { preserveHistoricalParityEvidence } from "./parity-drift.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const dashboardRoot = path.join(repoRoot, "dashboard");
const apiRoot = path.join(dashboardRoot, "src", "app", "api");

const dashboardModule = (relative) =>
  import(pathToFileURL(path.join(dashboardRoot, relative)).href);

const { RUNTIME_AGENT_PROFILES } = await dashboardModule(
  "src/lib/hermes/capability-combinations.ts",
);
const { RUNTIME_AGENT_BRIEFS, RUNTIME_AGENT_GROUPS } = await dashboardModule(
  "src/lib/hermes/runtime-agent-briefs.ts",
);
const {
  EXTERNAL_AGENT_RUN_FIELD_BY_KIND,
  EXTERNAL_AGENT_RUN_KINDS,
  externalAgentDisplayName,
} = await dashboardModule("src/lib/conversations/external-agent-runs.ts");
const {
  loadAgencyAgentsCatalog,
} = await dashboardModule("src/lib/hermes/agency-agents.ts");
const { loadArisAgentDefinition } = await dashboardModule("src/lib/aris/agent.ts");
const { loadSpotifyAgentDefinition } = await dashboardModule(
  "src/lib/spotify-agent/agent.ts",
);
const toolScopes = await dashboardModule("src/lib/hermes/tool-scopes.ts");
const documentAttachments = await dashboardModule("src/lib/document-attachments.ts");
const audioAttachments = await dashboardModule("src/lib/audio-attachments.ts");
const videoAttachments = await dashboardModule("src/lib/video-attachments.ts");
const modelAttachments = await dashboardModule("src/lib/model-attachments.ts");
const artifactTypes = await dashboardModule("src/lib/hermes/artifact-types.ts");
const aiModels = await dashboardModule("src/lib/ai-models.ts");

// This mirrors the existing source-level contract test in
// dashboard/tests/capability-combinations.test.mjs. Keeping the mapping here is
// intentional: the Runtime V2 parity snapshot must fail if that active registry
// changes after the pre-migration baseline has been frozen.
const RUN_ROUTES = {
  codex: ["codex", "runs"],
  opencode: ["opencode", "runs"],
  ruflo: ["ruflo", "runs"],
  "deep-research": ["deep-research", "runs"],
  "max-research": ["max-research", "runs"],
  openplanter: ["openplanter", "runs"],
  openwork: ["openwork", "runs"],
  openscience: ["openscience", "runs"],
  "inbox-zero": ["inbox-zero", "runs"],
  "agent-reach": ["agent-reach", "runs"],
  "get-doc": ["get-doc", "runs"],
  "meeting-notes": ["meeting-notes", "runs"],
  "deep-tutor": ["deep-tutor", "runs"],
  "career-ops": ["career-ops", "runs"],
  "open-gym": ["open-gym", "runs"],
  "trading-agent": ["tradingagents", "runs"],
  "vibe-trading": ["vibe-trading", "runs"],
  "stock-analyst": ["stock-analyst", "runs"],
  "deer-flow": ["deer-flow", "runs"],
  "socials-manager": ["socials-manager", "runs"],
  "hardware-blueprint": ["hardware-blueprint", "runs"],
  "parametric-cad": ["cad", "runs"],
  hyperframes: ["hyperframes", "runs"],
  resource2skill: ["resource2skill", "runs"],
  matraix: ["matraix", "runs"],
  "bolt-slides": ["bolt-slides", "runs"],
  openmontage: ["openmontage", "runs"],
  vimax: ["vimax", "runs"],
  "vox-director": ["vox-director", "runs"],
  shorts: ["shorts", "runs"],
  formsmith: ["shaper", "runs"],
  "money-printer": ["money-printer", "runs"],
  legal: ["legal", "runs"],
  wardrobe: ["wardrobe", "runs"],
  "video-use": ["video-use", "runs"],
  "agent-browser": ["agent-browser", "agents", "[agentId]", "runs"],
  "agent-tars": ["ui-tars", "agents", "[agentId]", "runs"],
};

const RUN_KIND_BY_AGENT_ID = {
  codex: "codex",
  opencode: "opencode",
  ruflo: "ruflo",
  "deep-research": "deep_research",
  "max-research": "max_research",
  openplanter: "openplanter",
  openwork: "openwork",
  openscience: "openscience",
  "inbox-zero": "inbox_zero",
  "agent-reach": "agent_reach",
  "get-doc": "get_doc",
  "meeting-notes": "meeting_notes",
  "deep-tutor": "deep_tutor",
  "career-ops": "career_ops",
  "open-gym": "open_gym",
  "trading-agent": "trading_agents",
  "vibe-trading": "vibe_trading",
  "stock-analyst": "stock_analyst",
  "deer-flow": "deer_flow",
  "socials-manager": "socials_manager",
  "hardware-blueprint": "hardware_blueprint",
  "parametric-cad": "parametric_cad",
  hyperframes: "hyperframes",
  resource2skill: "resource2skill",
  matraix: "matraix",
  "bolt-slides": "bolt_slides",
  openmontage: "openmontage",
  vimax: "vimax",
  "vox-director": "vox_director",
  shorts: "shorts",
  formsmith: "formsmith",
  "money-printer": "money_printer",
  legal: "legal_agent",
  wardrobe: "wardrobe",
  "video-use": "video_use",
  "agent-browser": "agent_browser",
  "agent-tars": "agent_tars",
};

function fail(message) {
  throw new Error(`[runtime-v2-registry] ${message}`);
}

function posix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function routePath(segments, suffix = []) {
  return `/api/${[...segments, ...suffix].join("/")}`;
}

function routeSourcePath(segments, suffix = []) {
  return path.join(apiRoot, ...segments, ...suffix, "route.ts");
}

function relativeToRepo(absolutePath) {
  return posix(path.relative(repoRoot, absolutePath));
}

function sha256Files(files) {
  const digest = crypto.createHash("sha256");
  for (const file of [...files].sort()) {
    digest.update(relativeToRepo(file));
    digest.update("\0");
    digest.update(fs.readFileSync(file));
    digest.update("\0");
  }
  return digest.digest("hex");
}

const profileIds = RUNTIME_AGENT_PROFILES.map((agent) => agent.id);
const routeIds = Object.keys(RUN_ROUTES);
const runKindIds = Object.keys(RUN_KIND_BY_AGENT_ID);
for (const [label, values] of [
  ["run-route", routeIds],
  ["run-kind", runKindIds],
]) {
  const missing = profileIds.filter((id) => !values.includes(id));
  const extra = values.filter((id) => !profileIds.includes(id));
  if (missing.length || extra.length) {
    fail(`${label} mapping drift; missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`);
  }
}

const runKinds = new Set(EXTERNAL_AGENT_RUN_KINDS);
const sourceFiles = new Set([
  path.join(dashboardRoot, "src", "lib", "hermes", "capability-combinations.ts"),
  path.join(dashboardRoot, "src", "lib", "hermes", "runtime-agent-briefs.ts"),
  path.join(dashboardRoot, "src", "lib", "conversations", "external-agent-runs.ts"),
  path.join(dashboardRoot, "src", "lib", "conversations", "external-agent-cancel.ts"),
  path.join(dashboardRoot, "tests", "capability-combinations.test.mjs"),
]);

const runtimeAgents = RUNTIME_AGENT_PROFILES.map((agent, order) => {
  const route = RUN_ROUTES[agent.id];
  const runKind = RUN_KIND_BY_AGENT_ID[agent.id];
  const brief = RUNTIME_AGENT_BRIEFS[agent.id];
  if (!brief) fail(`agent ${agent.id} has no selection brief`);
  if (!runKinds.has(runKind)) fail(`agent ${agent.id} maps to unknown run kind ${runKind}`);
  if (!(runKind in EXTERNAL_AGENT_RUN_FIELD_BY_KIND)) {
    fail(`run kind ${runKind} has no durable transcript field`);
  }

  const runSource = routeSourcePath(route);
  const eventsSource = routeSourcePath(route, ["[runId]", "events"]);
  const abortSource = routeSourcePath(route, ["[runId]", "abort"]);
  for (const source of [runSource, eventsSource, abortSource]) {
    if (!fs.existsSync(source)) fail(`missing route source ${relativeToRepo(source)}`);
    sourceFiles.add(source);
  }

  return {
    id: agent.id,
    displayName: agent.name,
    order,
    group: brief.group,
    command: agent.command,
    token: agent.token,
    surfaces: [...agent.surfaces],
    selectionBrief: {
      does: brief.does,
      choose: brief.choose ?? null,
    },
    selectionSemantics: {
      stacksCapabilities: agent.stacksCapabilities,
      acceptsAttachments: agent.acceptsAttachments,
      launchableByModel: agent.launchableByModel,
      requiresLaunchApproval: agent.requiresLaunchApproval,
    },
    routes: {
      submit: routePath(route),
      events: routePath(route, ["[runId]", "events"]),
      cancel: routePath(route, ["[runId]", "abort"]),
    },
    durableRun: {
      kind: runKind,
      transcriptField: EXTERNAL_AGENT_RUN_FIELD_BY_KIND[runKind],
      displayName: externalAgentDisplayName(runKind),
    },
  };
});

const duplicate = (values) => {
  const seen = new Set();
  return values.find((value) => (seen.has(value) ? true : !seen.add(value)));
};
for (const [label, values] of [
  ["agent id", runtimeAgents.map((item) => item.id)],
  ["agent command", runtimeAgents.map((item) => item.command)],
  ["durable run kind", runtimeAgents.map((item) => item.durableRun.kind)],
  ["durable transcript field", runtimeAgents.map((item) => item.durableRun.transcriptField)],
]) {
  const value = duplicate(values);
  if (value) fail(`duplicate ${label}: ${value}`);
}

const REQUIRED_CAPABILITY_FIELDS = [
  "capabilityId",
  "sourceIdentity",
  "displayName",
  "category",
  "visibleEntryPoint",
  "slashCommand",
  "implicitTrigger",
  "selectionSemantics",
  "routeOrIpcContract",
  "requiredServiceOrWorker",
  "providerRequirements",
  "credentialRequirements",
  "externalSoftwareRequirements",
  "inputTypes",
  "outputTypes",
  "artifactTypes",
  "progressEventContract",
  "streamingContract",
  "cancellationBehavior",
  "approvalBehavior",
  "followUpContextBehavior",
  "restartBehavior",
  "recoveryBehavior",
  "preMigrationStatus",
  "preMigrationEvidence",
  "postMigrationStatus",
  "postMigrationEvidence",
  "uiEntryPoint",
  "selectionEvidence",
  "runtimePath",
  "serviceWorkerEvidence",
  "outputArtifactEvidence",
  "cancellationEvidence",
  "recoveryEvidence",
  "result",
  "stoppedServiceBehavior",
  "mockOrFallbackDeclarations",
  "sourceRefs",
  "sourceSha256",
  "baselineContractSha256",
];

const CONTRACT_FIELDS = [
  "sourceIdentity",
  "displayName",
  "category",
  "visibleEntryPoint",
  "slashCommand",
  "implicitTrigger",
  "selectionSemantics",
  "routeOrIpcContract",
  "requiredServiceOrWorker",
  "providerRequirements",
  "credentialRequirements",
  "externalSoftwareRequirements",
  "inputTypes",
  "outputTypes",
  "artifactTypes",
  "progressEventContract",
  "streamingContract",
  "cancellationBehavior",
  "approvalBehavior",
  "followUpContextBehavior",
  "restartBehavior",
  "recoveryBehavior",
  "uiEntryPoint",
  "runtimePath",
  "stoppedServiceBehavior",
  "mockOrFallbackDeclarations",
  "sourceRefs",
  "sourceSha256",
];

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function sourceAnchor(relativePath, matcher) {
  const lines = readSource(relativePath).split(/\r?\n/);
  const index = lines.findIndex((line) =>
    matcher instanceof RegExp ? matcher.test(line) : line.includes(matcher),
  );
  return `${posix(relativePath)}:${index < 0 ? 1 : index + 1}`;
}

function sourcePathFromRef(reference) {
  return reference.replace(/:\d+$/, "");
}

function existingSourceFiles(references) {
  return [...new Set(references.map(sourcePathFromRef))]
    .map((relativePath) => path.join(repoRoot, relativePath))
    .filter((absolutePath) => fs.existsSync(absolutePath));
}

function filesUnder(root, predicate = () => true) {
  if (!fs.existsSync(root)) return [];
  const output = [];
  const visit = (directory) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && predicate(absolutePath)) output.push(absolutePath);
    }
  };
  visit(root);
  return output;
}

function mockFallbackDeclarations(files) {
  const declarations = [];
  for (const file of files) {
    const relativePath = relativeToRepo(file);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/\b(mock|canned|fallback|degraded)\b/i.test(line)) return;
      declarations.push(`${relativePath}:${index + 1}:${line.trim().slice(0, 180)}`);
    });
  }
  return {
    count: declarations.length,
    sha256: sha256Text(declarations.join("\n")),
    evidence: declarations.slice(0, 24),
    truncated: declarations.length > 24,
  };
}

function evidence(preMigration = [], postMigration = []) {
  return { preMigration, postMigration };
}

function capabilityRow(input) {
  const refs = [...new Set(input.sourceRefs ?? [])].sort();
  const files = existingSourceFiles(refs);
  for (const file of files) sourceFiles.add(file);
  const services = input.requiredServiceOrWorker ?? [];
  const preEvidence = input.preMigrationEvidence ?? refs;
  const row = {
    capabilityId: input.capabilityId,
    sourceIdentity: input.sourceIdentity ?? input.capabilityId,
    displayName: input.displayName,
    category: input.category,
    visibleEntryPoint: input.visibleEntryPoint ?? "No standalone UI; reached through chat intent.",
    slashCommand: input.slashCommand ?? null,
    implicitTrigger: input.implicitTrigger ?? null,
    selectionSemantics: input.selectionSemantics ?? "Explicit user selection only.",
    routeOrIpcContract: input.routeOrIpcContract ?? "Hermes conversation turn contract.",
    requiredServiceOrWorker: services,
    providerRequirements: input.providerRequirements ?? [],
    credentialRequirements: input.credentialRequirements ?? [],
    externalSoftwareRequirements: input.externalSoftwareRequirements ?? [],
    inputTypes: input.inputTypes ?? ["text"],
    outputTypes: input.outputTypes ?? ["chat-message"],
    artifactTypes: input.artifactTypes ?? [],
    progressEventContract:
      input.progressEventContract ?? "Standard Hermes turn lifecycle events.",
    streamingContract: input.streamingContract ?? "Conversation SSE with bounded replay.",
    cancellationBehavior:
      input.cancellationBehavior ?? "Conversation Abort stops the active turn and revokes its grant.",
    approvalBehavior: input.approvalBehavior ?? "No capability-specific approval beyond the submitted user action.",
    followUpContextBehavior:
      input.followUpContextBehavior ?? "Conversation-bound transcript and selected capability context.",
    restartBehavior:
      input.restartBehavior ?? "Durable conversation state is restored; no execution result is claimed without evidence.",
    recoveryBehavior:
      input.recoveryBehavior ?? "Hermes run recovery reconciles durable events or terminates the pending turn honestly.",
    preMigrationStatus: input.preMigrationStatus ?? "SOURCE_PRESENT",
    preMigrationEvidence: preEvidence,
    postMigrationStatus: "NOT RUN",
    postMigrationEvidence: [],
    uiEntryPoint: input.uiEntryPoint ?? input.visibleEntryPoint ?? "Chat composer",
    selectionEvidence: evidence(input.selectionEvidence ?? refs),
    runtimePath: input.runtimePath ?? "Authenticated compatibility surface -> capability-specific current owner; installed integration evidence NOT RUN",
    serviceWorkerEvidence: evidence(input.serviceWorkerEvidence ?? refs),
    outputArtifactEvidence: evidence(input.outputArtifactEvidence ?? refs),
    cancellationEvidence: evidence(input.cancellationEvidence ?? refs),
    recoveryEvidence: evidence(input.recoveryEvidence ?? refs),
    result: "NOT RUN",
    stoppedServiceBehavior:
      input.stoppedServiceBehavior ??
      (services.length
        ? "Must remain visible while stopped; the original action cold-starts the dependency without another user action."
        : "Not applicable: no managed service is required."),
    mockOrFallbackDeclarations:
      input.mockOrFallbackDeclarations ?? mockFallbackDeclarations(files),
    sourceRefs: refs,
    sourceSha256: files.length ? sha256Files(files) : sha256Text(""),
  };
  const contract = Object.fromEntries(CONTRACT_FIELDS.map((field) => [field, row[field]]));
  row.baselineContractSha256 = sha256Text(JSON.stringify(contract));
  return row;
}

const capabilityRows = [];
const add = (row) => capabilityRows.push(capabilityRow(row));

const runtimeV2AgentContracts = {
  "deep-research": {
    refs: [
      ["dashboard/src/lib/deep-research/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/deep-research/runtime-worker-run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/scripts/runtime-v2-deep-research-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: ["outer-deep-research-node disposable worker", "service:deep-research"],
    artifacts: ["research report or answer", "bounded source and evidence record"],
    cancel: "the worker gets 60 seconds to abort the sealed upstream run before Rust termination and Deep Research lease release",
    restart: "Durable run mapping, fenced Runtime events, and Deep Research snapshots survive Dashboard restart; interrupted work is never blindly resumed and retry creates a fresh worker.",
    path: "authenticated durable Runtime submit -> outer-deep-research-node -> sealed Deep Research service lease and loopback RPC",
    stopped: "Must remain visible while stopped: submitting a run cold-starts the Runtime-owned Deep Research service, whose own ChatMock dependency remains transitive.",
  },
  openscience: {
    refs: [
      ["dashboard/src/lib/openscience/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/openscience/run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/scripts/runtime-v2-openscience-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: ["outer-openscience-node disposable worker", "service:openscience"],
    artifacts: ["research answer", "verified managed-workspace deliverables"],
    cancel: "the worker gets 60 seconds for sealed upstream abort and deliverable cleanup before Rust termination and OpenScience lease release",
    restart: "Durable run mapping, fenced Runtime events, the managed workspace, and verified deliverables survive Dashboard restart; retry creates a fresh leased worker.",
    path: "trusted provider preparation -> authenticated durable Runtime submit -> outer-openscience-node -> sealed OpenScience service lease and endpoint-only RPC",
    stopped: "Must remain visible while stopped: submitting a run cold-starts the Runtime-owned OpenScience service, whose ChatMock dependency remains transitive.",
  },
  openwork: {
    refs: [
      ["dashboard/src/lib/openwork/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/openwork/run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/src/lib/openwork/runtime-worker-service.ts", /export async function preparedOpenworkService/],
      ["dashboard/src/lib/openwork/runtime-artifact.ts", /export async function stageOpenworkRuntimeArtifact/],
      ["dashboard/scripts/runtime-v2-openwork-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: [
      "outer-openwork-node disposable worker",
      "service:openwork",
      "pinned immutable OpenWork setup source",
    ],
    artifacts: ["OpenWork answer and event projection", "up to 128 verified artifacts totaling 2 GiB"],
    cancel: "the worker gets 60 seconds to await sealed upstream session cancellation before Rust terminates its tree and releases the OpenWork lease",
    restart: "The durable exact-job mapping, fenced event projection, managed workspace state, and verified artifact references survive Dashboard restart; retry creates a fresh leased worker.",
    path: "authenticated private-profile preparation -> durable Runtime submit -> outer-openwork-node -> sealed OpenWork service lease and endpoint-only RPC -> contained artifact download",
    stopped: "Must remain visible while stopped: submitting a run cold-starts the Runtime-owned OpenWork service; its OpenCode engine and ChatMock dependency remain transitive and never enter the worker environment.",
  },
  "hardware-blueprint": {
    refs: [
      ["dashboard/src/lib/hardware/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/hardware/run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/scripts/runtime-v2-hardware-blueprint-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: [
      "outer-hardware-blueprint-node disposable worker",
      "service:chatmock",
      "service:cad only when an enclosure is requested",
      "service:solidworks-mcp only when the resolved backend is SolidWorks",
    ],
    artifacts: ["compiled hardware blueprint", "optional parametric CAD enclosure"],
    cancel: "the worker gets 60 seconds for cooperative model/CAD cleanup before Rust tree termination and lease release",
    restart: "The durable exact-job mapping, fenced event projection and verified artifact references survive Dashboard restart; a retry is a fresh worker.",
    path: "authenticated durable Runtime submit -> outer-hardware-blueprint-node -> optional hardcoded CAD/SolidWorks service lease",
    stopped: "Must remain visible while stopped: the submitted run cold-starts ChatMock, while CAD/SolidWorks start only if the resolved request needs them.",
  },
  "agent-tars": {
    refs: [
      ["dashboard/src/lib/ui-tars/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/ui-tars/runtime-worker-run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/src/lib/ui-tars/runtime-worker-client.ts", /export class UITarsRuntimeWorkerClient/],
      ["dashboard/src/lib/ui-tars/run-profile.ts", /export function prepareUITarsRunProfile/],
      ["dashboard/scripts/runtime-v2-agent-tars-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: [
      "outer-agent-tars-node disposable worker",
      "service:ui-tars",
      "private data-root run profile",
    ],
    artifacts: ["durable UI-TARS run and event ledger", "bounded screenshots and exact approval decisions"],
    cancel: "the worker gets 60 seconds to abort the sealed adapter run before Rust terminates its tree and releases the UI-TARS lease",
    restart: "The durable exact-job mapping and UI-TARS run, event, approval, and screenshot ledgers survive Dashboard restart; adapter loss becomes runtime_lost and retry creates a fresh worker.",
    path: "authenticated private-profile preparation -> durable Runtime submit -> outer-agent-tars-node -> sealed UI-TARS service lease and loopback adapter RPC",
    stopped: "Must remain visible while stopped: submitting the run cold-starts the Runtime-owned UI-TARS service and its Chromium descendants, while approval and screenshot state remain authenticated and bounded.",
  },
  "get-doc": {
    refs: [
      ["dashboard/src/lib/get-doc/run-manager.ts", /export function startRun/],
      ["dashboard/src/lib/get-doc/download-run-manager.ts", /export async function startDownloadRun/],
      ["dashboard/scripts/runtime-v2-get-doc-worker.mjs", /runRuntimeV2OuterAgentWorker/],
      ["dashboard/scripts/runtime-v2-get-doc-download-worker.mjs", /runFiniteMcpWorker/],
    ],
    required: ["outer-get-doc-node disposable worker", "get-doc-download-node disposable worker", "service:chatmock"],
    artifacts: ["bounded research result", "verified PDF artifact"],
    cancel: "Runtime applies the exact 60-second main-worker or 30-second download-worker grace before final tree termination",
    restart: "Durable run mapping, fenced terminal results, and verified PDF artifact references survive Dashboard restart; retry is a fresh worker.",
    path: "authenticated durable Runtime submit -> outer-get-doc-node or get-doc-download-node",
    stopped: "Must remain visible while stopped: a Get Doc run cold-starts ChatMock; public PDF downloads need no managed service.",
  },
  "meeting-notes": {
    refs: [
      ["dashboard/src/lib/meeting-notes/runtime-worker-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/meeting-notes/runtime-transcribe.ts", /export async function transcribeRuntimeMeeting/],
      ["dashboard/scripts/runtime-v2-meeting-notes-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: [
      "outer-meeting-notes-node disposable worker",
      "service:scriberr only for audio engine scriberr",
      "service:voicebox only for audio engine voicebox",
      "service:chatmock only when a summary is requested",
    ],
    artifacts: ["meeting transcript", "meeting notes report"],
    cancel: "the worker gets 60 seconds to cancel bounded media work before Rust tree termination and dependency release",
    restart: "The durable exact-job mapping, authenticated input, fenced event projection, transcript and report references survive Dashboard restart.",
    path: "authenticated one-blob Runtime submit -> outer-meeting-notes-node -> request-derived Scriberr, Voicebox, or ChatMock lease",
    stopped: "Must remain visible while stopped: only the services selected by the canonical source/engine/transcriptOnly request are cold-started.",
  },
  "video-use": {
    refs: [
      ["dashboard/src/lib/video-use/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/video-use/run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/src/lib/runtime-v2/speech-media-job.ts", /export async function renderVideoProgramViaRuntime/],
      ["dashboard/src/lib/runtime-v2/subsai-transcription-job.ts", /export async function transcribeWithSubsAiViaRuntime/],
      ["dashboard/scripts/runtime-v2-video-use-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: [
      "outer-video-use-node disposable coordinator",
      "service:chatmock",
      "service:scriberr when managed and enabled",
      "nested speech-media and subsai-transcription Runtime jobs",
      "pinned staged Video Use source and fixed media toolchain",
    ],
    artifacts: ["versioned edited MP4", "immutable edit program and transcript metadata"],
    cancel: "the coordinator gets 120 seconds to cancel exact nested speech-media or SubsAI jobs before Rust termination and service-lease release",
    restart: "The durable exact-job mapping, fenced event projection, versioned MP4, program, and transcript receipts survive Dashboard restart; retry creates a fresh coordinator.",
    path: "authenticated durable Runtime submit -> admission-held ChatMock and managed Scriberr services -> outer-video-use-node -> fixed nested speech-media or SubsAI Runtime jobs -> verified artifact",
    stopped: "Must remain visible while stopped: admission cold-starts ChatMock and managed Scriberr when enabled; external or disabled Scriberr is not leased, and heavy nested jobs start only when the sealed plan needs them.",
  },
  "max-research": {
    refs: [
      ["dashboard/src/lib/max-research/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/max-research/run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/src/lib/max-research/participants.ts", /export function participantRuntime/],
      ["dashboard/scripts/runtime-v2-max-research-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: [
      "outer-max-research-node disposable coordinator",
      "service:chatmock",
      "service:deep-research admission lease",
      "service:openscience admission lease",
      "fixed nested Agent Reach and Get Doc Runtime jobs",
    ],
    artifacts: ["multi-participant research answer", "participant evidence and document artifacts"],
    cancel: "the coordinator gets 60 seconds to cancel active participants before Rust terminates its remaining Job tree and releases service authority",
    restart: "The durable exact-job mapping, fenced event projection, participant evidence, and verified artifact references survive Dashboard restart; retry is a fresh coordinator.",
    path: "authenticated durable Runtime submit -> admission-held ChatMock, Deep Research, and OpenScience services -> outer-max-research-node -> fixed nested Agent Reach and Get Doc jobs",
    stopped: "Must remain visible while stopped: admission cold-starts ChatMock, Deep Research, and OpenScience before the participant plan runs; the worker receives only their sealed endpoints and cannot acquire services itself.",
  },
  "parametric-cad": {
    refs: [
      ["dashboard/src/lib/cad/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/cad/runtime-worker-adapter.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/scripts/runtime-v2-parametric-cad-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: [
      "outer-parametric-cad-node disposable worker",
      "service:chatmock",
      "service:cad",
    ],
    artifacts: ["validated immutable CAD revision", "CAD exports and report"],
    cancel: "the worker gets 60 seconds for cooperative model/CAD cleanup before Rust tree termination and both service leases are released",
    restart: "Durable run mapping, fenced Runtime events, revisioned CAD artifacts, and parameter updates survive Dashboard restart; retry is a fresh worker.",
    path: "authenticated durable Runtime submit -> outer-parametric-cad-node -> sealed ChatMock and CAD service leases",
    stopped: "Must remain visible while stopped: submitting the run cold-starts ChatMock and the Runtime-owned CAD service; SolidWorks is not selected by this request contract.",
  },
  wardrobe: {
    refs: [
      ["dashboard/src/lib/wardrobe/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/wardrobe/run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/scripts/runtime-v2-wardrobe-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: ["outer-wardrobe-node disposable worker", "service:wardrobe"],
    artifacts: ["garment library", "generated wardrobe artifact"],
    cancel: "the worker gets 30 seconds for cooperative service cleanup before Rust tree termination and Wardrobe lease release",
    restart: "Durable run mapping, fenced Runtime events, garment state, and verified artifact references survive Dashboard restart; retry is a fresh worker.",
    path: "authenticated one-to-ten-image Runtime submit -> outer-wardrobe-node -> sealed Wardrobe service lease",
    stopped: "Must remain visible while stopped: submitting the run cold-starts the Runtime-owned Wardrobe service, which owns its own ChatMock dependency.",
  },
  "stock-analyst": {
    refs: [
      ["dashboard/src/lib/stock-analyst/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/stock-analyst/run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/scripts/runtime-v2-stock-analyst-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: ["outer-stock-analyst-node disposable worker", "service:stock-analyst"],
    artifacts: ["stock analysis answer", "bounded tool-call and market evidence"],
    cancel: "the worker gets 30 seconds for cooperative upstream cancellation before Rust tree termination and Stock Analyst lease release",
    restart: "Durable run mapping, fenced Runtime events, and persisted Stock Analyst service state survive Dashboard restart; retry is a fresh worker.",
    path: "authenticated durable Runtime submit -> outer-stock-analyst-node -> sealed Stock Analyst service lease",
    stopped: "Must remain visible while stopped: submitting the run cold-starts the Runtime-owned Stock Analyst service, which owns its own ChatMock dependency.",
  },
  "vibe-trading": {
    refs: [
      ["dashboard/src/lib/vibe-trading/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/vibe-trading/run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/scripts/runtime-v2-vibe-trading-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: ["outer-vibe-trading-node disposable worker", "service:vibe-trading"],
    artifacts: ["trading analysis answer", "bounded market evidence and reasoning events"],
    cancel: "the worker gets 60 seconds for the upstream cancel acknowledgement before Rust tree termination and Vibe Trading lease release",
    restart: "Durable run mapping and fenced Runtime events survive Dashboard restart; retry is a fresh worker against persisted service state.",
    path: "authenticated durable Runtime submit -> outer-vibe-trading-node -> sealed Vibe Trading service lease",
    stopped: "Must remain visible while stopped: submitting the run cold-starts the Runtime-owned Vibe Trading service, which owns its own ChatMock dependency.",
  },
  "deer-flow": {
    refs: [
      ["dashboard/src/lib/deer-flow/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/deer-flow/run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/scripts/runtime-v2-deer-flow-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: [
      "outer-deer-flow-node disposable worker",
      "service:chatmock",
      "service:deer-flow",
    ],
    artifacts: ["DeerFlow research answer", "thread checkpoints and verified artifacts"],
    cancel: "the worker gets 60 seconds for cooperative upstream cleanup before Rust tree termination and both dependency leases are released",
    restart: "Upstream thread/checkpoint artifacts, durable run mapping, and fenced Runtime events survive Dashboard restart; retry is a fresh worker.",
    path: "authenticated durable Runtime submit -> outer-deer-flow-node -> sealed ChatMock and DeerFlow service leases",
    stopped: "Must remain visible while stopped: submitting the run cold-starts the Runtime-owned ChatMock and DeerFlow services in dependency order.",
  },
  "money-printer": {
    refs: [
      ["dashboard/src/lib/money-printer/runtime-run-manager.ts", /export function startRun/],
      ["dashboard/src/lib/money-printer/run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/scripts/runtime-v2-money-printer-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: ["outer-money-printer-node disposable worker", "service:money-printer"],
    artifacts: ["rendered video", "narration and bounded production metadata"],
    cancel: "the worker gets 60 seconds for the sealed service stop acknowledgement before Rust termination and MoneyPrinter lease release",
    restart: "Durable run mapping, fenced Runtime events, task state, and verified video artifacts survive Dashboard restart; retry creates a fresh leased worker.",
    path: "authenticated durable Runtime submit -> outer-money-printer-node -> sealed MoneyPrinter service lease and loopback RPC",
    stopped: "Must remain visible while stopped: submitting the run cold-starts the Runtime-owned MoneyPrinter service, which owns its own ChatMock dependency and heavyweight media reservation.",
  },
  "inbox-zero": {
    refs: [
      ["dashboard/src/lib/inbox-zero/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/inbox-zero/run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/scripts/runtime-v2-inbox-zero-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: ["outer-inbox-zero-node disposable worker", "service:inbox-zero-stack"],
    artifacts: ["mailbox assistant transcript", "mailbox operation result"],
    cancel: "the worker gets 30 seconds for cooperative service cancellation before Rust tree termination and stack-lease release",
    restart: "Durable transcript and fenced Runtime events survive Dashboard restart; a retry is a fresh leased worker.",
    path: "authenticated durable Runtime submit -> outer-inbox-zero-node -> sealed inbox-zero-stack service RPC",
    stopped: "Must remain visible while stopped: submitting the run cold-starts the Runtime-owned Inbox Zero stack coordinator.",
  },
  "socials-manager": {
    refs: [
      ["dashboard/src/lib/socials-manager/runtime-run-manager.ts", /export async function startRun/],
      ["dashboard/src/lib/socials-manager/run-manager.ts", /export function startRuntimeWorkerRun/],
      ["dashboard/scripts/runtime-v2-socials-manager-worker.mjs", /runRuntimeV2OuterAgentWorker/],
    ],
    required: ["outer-socials-manager-node disposable worker", "service:postiz-coordinator", "service:chatmock"],
    artifacts: ["social draft", "publishing result", "calendar artifact"],
    cancel: "the worker gets 60 seconds for cooperative cleanup before Rust tree termination and both service leases are released",
    restart: "Durable run mapping, draft/publishing artifacts, and fenced Runtime events survive Dashboard restart; retry is a fresh worker.",
    path: "authenticated durable Runtime submit -> outer-socials-manager-node -> sealed Postiz coordinator and ChatMock leases",
    stopped: "Must remain visible while stopped: submitting the run cold-starts ChatMock and the Runtime-owned Postiz coordinator.",
  },
};

for (const agent of runtimeAgents) {
  const routeSources = [
    routeSourcePath(RUN_ROUTES[agent.id]),
    routeSourcePath(RUN_ROUTES[agent.id], ["[runId]", "events"]),
    routeSourcePath(RUN_ROUTES[agent.id], ["[runId]", "abort"]),
  ].map(relativeToRepo);
  const refs = [
    sourceAnchor("dashboard/src/lib/hermes/capability-combinations.ts", `id: "${agent.id}"`),
    sourceAnchor("dashboard/src/lib/hermes/runtime-agent-briefs.ts", `"${agent.id}":`),
    ...routeSources.map((relativePath) => sourceAnchor(relativePath, /export async function/)),
    sourceAnchor("dashboard/src/lib/conversations/external-agent-runs.ts", `"${agent.durableRun.kind}"`),
    ...(runtimeV2AgentContracts[agent.id]?.refs ?? []).map(([file, pattern]) =>
      sourceAnchor(file, pattern),
    ),
  ];
  const runtimeV2Contract = runtimeV2AgentContracts[agent.id];
  add({
    capabilityId: `runtime-agent:${agent.id}`,
    sourceIdentity: agent.id,
    displayName: agent.displayName,
    category: "runtime-agent",
    visibleEntryPoint: `Agents tab and ${agent.command}`,
    slashCommand: agent.command,
    selectionSemantics: JSON.stringify(agent.selectionSemantics),
    routeOrIpcContract: `${agent.routes.submit}; SSE ${agent.routes.events}; POST ${agent.routes.cancel}`,
    requiredServiceOrWorker: runtimeV2Contract
      ? runtimeV2Contract.required
      : [`registered Runtime V2 ${agent.id} disposable worker`],
    inputTypes: agent.selectionSemantics.acceptsAttachments ? ["text", "chat-attachments"] : ["text"],
    outputTypes: ["chat-message", "external-agent-run-card", "durable-transcript-field"],
    artifactTypes: runtimeV2Contract
      ? runtimeV2Contract.artifacts
      : ["agent-specific"],
    progressEventContract: runtimeV2Contract
      ? `Fenced Runtime worker events are durably projected and replayed from ${agent.routes.events}.`
      : `Fenced Runtime worker events are durably projected and replayed from ${agent.routes.events}.`,
    cancellationBehavior: runtimeV2Contract
      ? `POST ${agent.routes.cancel} cancels the exact Runtime job; ${runtimeV2Contract.cancel}.`
      : `POST ${agent.routes.cancel} cancels the exact Runtime job; the native owner applies the registered graceful window and complete-tree termination.`,
    approvalBehavior: agent.selectionSemantics.requiresLaunchApproval
      ? "Model launch requires explicit approval; direct user selection is the launch authority."
      : "Direct user selection authorizes launch.",
    followUpContextBehavior: `Conversation-bound ${agent.durableRun.transcriptField} descriptor restores the run card and follow-up context.`,
    restartBehavior: runtimeV2Contract
      ? runtimeV2Contract.restart
      : "The durable exact-job mapping, fenced event projection, and transcript descriptor survive Dashboard restart; installed restart evidence remains NOT RUN.",
    recoveryBehavior: runtimeV2Contract
      ? `External run kind ${agent.durableRun.kind} maps to ${agent.durableRun.transcriptField}; missing or mismatched Runtime identity fails closed without a Next fallback.`
      : `External run kind ${agent.durableRun.kind} maps to ${agent.durableRun.transcriptField}; missing or mismatched Runtime identity fails closed without a Next fallback.`,
    runtimePath: runtimeV2Contract
      ? `${agent.routes.submit} -> ${runtimeV2Contract.path} -> fenced replay at ${agent.routes.events}`
      : `${agent.routes.submit} -> authenticated durable Runtime submit -> registered ${agent.id} disposable worker${agent.id === "ruflo" ? " (immutable Ruflo package closure unavailable; package evidence NOT RUN)" : ""} -> fenced replay at ${agent.routes.events}`,
    stoppedServiceBehavior: runtimeV2Contract
      ? runtimeV2Contract.stopped
      : undefined,
    sourceRefs: refs,
  });
}

add({
  capabilityId: "workflow:runtime-setup",
  sourceIdentity: "runtime-setup",
  displayName: "Managed runtime setup",
  category: "workflow",
  visibleEntryPoint: "Settings and agent setup actions",
  selectionSemantics: "An explicit authenticated setup/install/remove action selects one closed operation; no tokenless product fallback is allowed.",
  routeOrIpcContract: "Authenticated setup routes submit a user-global Runtime V2 job and observe its fenced status/result.",
  requiredServiceOrWorker: ["managed-setup-node and closed agent-specific setup workers"],
  inputTypes: ["closed setup operation", "optional explicitly sealed credential blob"],
  outputTypes: ["bounded setup status", "managed data-root toolchain receipt"],
  artifactTypes: ["managed toolchain", "managed service venv", "bounded installation receipt"],
  progressEventContract: "Fenced ready, heartbeat, progress, terminal, and cancellation events from a finite Runtime worker.",
  streamingContract: "Routes poll or replay bounded Runtime state; installer stdout, paths, and credentials are never renderer payloads.",
  cancellationBehavior: "Authenticated exact-job cancellation gets the profile's bounded cooperative grace before Rust reaps the complete attached installer tree.",
  approvalBehavior: "The explicit authenticated setup action is the launch authority.",
  followUpContextBehavior: "Subsequent status and launch checks derive the same fixed data-root outputs; no request-provided executable or output path is retained.",
  restartBehavior: "Managed outputs and bounded receipts survive Dashboard restart; an interrupted operation is retried as a fresh idempotent job.",
  recoveryBehavior: "Partial setup never becomes availability evidence; fixed probes must pass before the related service or worker is selectable.",
  runtimePath: "authenticated setup route -> closed Runtime V2 setup profile -> fixed worker/executor -> attached installer descendants -> fenced result",
  stoppedServiceBehavior: "Must remain visible while stopped: setup is observationally separate from service start, and completing setup does not cold-start the installed service.",
  sourceRefs: [
    sourceAnchor("desktop/runtime-v2/manifests/workers.json", /"kind": "managed-setup-node"/),
    sourceAnchor("dashboard/scripts/runtime-v2-managed-setup-worker.mjs", /start\.json/),
    sourceAnchor("dashboard/scripts/runtime-v2-managed-setup-executor.mjs", /protocolVersion/),
    sourceAnchor("dashboard/src/app/api/comfyui/route.ts", /export async function POST/),
    sourceAnchor("dashboard/src/lib/comfyui/server.ts", /managed-setup/),
  ],
});

add({
  capabilityId: "profile:device-location",
  sourceIdentity: "device-location",
  displayName: "Device location profile",
  category: "profile",
  visibleEntryPoint: "Profile settings -> Device location",
  selectionSemantics: "Explicit signed-in user request from the profile surface.",
  routeOrIpcContract: "POST /api/profile/device-location with authenticated user-global Runtime authority.",
  requiredServiceOrWorker: ["system-location-node"],
  inputTypes: ["authenticated empty request"],
  outputTypes: ["bounded normalized device-location profile"],
  progressEventContract: "Finite Runtime worker lifecycle with a single fenced result artifact.",
  streamingContract: "No renderer stream; the route awaits the bounded disposable job result.",
  cancellationBehavior: "Caller abort cancels the exact Runtime job and its complete process tree.",
  approvalBehavior: "The explicit authenticated profile action is the launch authority.",
  followUpContextBehavior: "The returned normalized location can be saved through the existing profile contract.",
  restartBehavior: "The durable Runtime job is owner-scoped and can be reconciled after Dashboard restart.",
  recoveryBehavior: "Missing terminal output fails closed; no alternate Next or shell fallback is used.",
  runtimePath: "Profile route -> authenticated Runtime V2 job -> fresh system-location worker -> fixed Windows PowerShell",
  sourceRefs: [
    sourceAnchor("dashboard/src/app/api/profile/device-location/route.ts", /export async function POST/),
    sourceAnchor("dashboard/src/lib/runtime-v2/system-location-job.ts", /export async function readSystemLocationViaRuntime/),
    sourceAnchor("dashboard/scripts/runtime-v2-system-location-worker.mjs", /startFiniteMcpWorker/),
    sourceAnchor("dashboard/scripts/runtime-v2-system-location-executor.mjs", /read-device-location/),
  ],
});

add({
  capabilityId: "provider:chatmock",
  sourceIdentity: "chatmock-account",
  displayName: "ChatMock account provider",
  category: "provider",
  visibleEntryPoint: "Settings -> Models -> ChatMock account",
  selectionSemantics: "Explicit authenticated sign-in, status, cancellation, or logout action from the ChatMock account surface.",
  routeOrIpcContract: "GET/POST/DELETE /api/chatmock/account/login plus GET/DELETE /api/chatmock/account.",
  requiredServiceOrWorker: ["chatmock", "chatmock-login-node"],
  inputTypes: ["authenticated account action"],
  outputTypes: ["sanitized account status", "authorization URL", "bounded login state"],
  progressEventContract: "Fenced Runtime checkpoint updates expose only bounded status and the authorization URL.",
  streamingContract: "No raw child stream crosses the control protocol; the route reads the owner-scoped checkpoint.",
  cancellationBehavior: "DELETE cancels the exact user-owned Runtime job and its attached login child.",
  approvalBehavior: "The explicit signed-in account action is the sole launch authority.",
  followUpContextBehavior: "Successful credentials remain under the sealed ChatMock CODEX_HOME and are never copied into conversation state.",
  restartBehavior: "The user-scoped current pointer and fenced job checkpoint survive Dashboard restart.",
  recoveryBehavior: "Interrupted login is reported truthfully and can be retried; there is no Next-owned child-process fallback.",
  runtimePath: "ChatMock account route -> authenticated Runtime V2 job -> fresh login worker -> fixed ChatMock Python login command",
  sourceRefs: [
    sourceAnchor("dashboard/src/app/api/chatmock/account/route.ts", /export async function GET/),
    sourceAnchor("dashboard/src/app/api/chatmock/account/login/route.ts", /export async function POST/),
    sourceAnchor("dashboard/scripts/runtime-v2-chatmock-login-worker.mjs", /runRuntimeV2ChatmockLoginWorker/),
    sourceAnchor("dashboard/scripts/runtime-v2-chatmock-login-executor.mjs", /executeChatmockLogin/),
    sourceAnchor("chatmock/chatmock.py", /def main|if __name__/),
  ],
});

const agentEditsSources = [
  sourceAnchor("dashboard/src/app/api/agent-edits/route.ts", /export async function GET/),
  sourceAnchor("dashboard/src/app/api/agent-edits/route.ts", /export async function POST/),
  sourceAnchor("dashboard/src/lib/agent-edits/runtime-client.ts", /export async function runAgentEditsOperation/),
  sourceAnchor("dashboard/scripts/runtime-v2-agent-edits-worker.mjs", /startFiniteMcpWorker/),
  sourceAnchor("dashboard/scripts/runtime-v2-agent-edits-executor.mjs", /executeAgentEditsOperation/),
];

add({
  capabilityId: "repository:snapshot-inspection",
  sourceIdentity: "agent-edits-snapshot-inspection",
  displayName: "Agent edit snapshot inspection",
  category: "repository",
  visibleEntryPoint: "Completed coding-agent run card -> Files changed",
  selectionSemantics: "Explicit authenticated inspection of the immutable before/after snapshot pair attached to a completed coding-agent run.",
  routeOrIpcContract: "GET /api/agent-edits with an owner-scoped before/after snapshot pair and optional file path.",
  requiredServiceOrWorker: ["agent-edits-node"],
  inputTypes: ["authenticated repository path", "immutable snapshot pair", "optional repository-relative file path"],
  outputTypes: ["bounded edit summary", "verified patch artifact"],
  artifactTypes: ["identity-bound JSON result", "streamed patch artifact"],
  progressEventContract: "Finite Runtime worker lifecycle with a fenced result descriptor.",
  streamingContract: "Large JSON stays in the identity-bound worker workspace and is streamed only after descriptor verification.",
  cancellationBehavior: "Caller abort cancels the exact Runtime job and its complete Git process tree.",
  approvalBehavior: "The authenticated inspection action is the launch authority; no command or executable comes from the renderer.",
  followUpContextBehavior: "The durable run card retains only the immutable snapshot identifiers required for later inspection.",
  restartBehavior: "Owner-scoped Runtime job state and immutable Git objects permit idempotent inspection after Dashboard restart.",
  recoveryBehavior: "Missing or mismatched fenced output fails closed with no in-process Git fallback.",
  runtimePath: "Agent run card -> agent-edits route -> authenticated Runtime V2 job -> fresh fixed-Git worker",
  sourceRefs: agentEditsSources,
});

add({
  capabilityId: "repository:agent-edits",
  sourceIdentity: "agent-edits-artifact",
  displayName: "Agent edit artifact",
  category: "repository",
  visibleEntryPoint: "Completed Codex, Ruflo, or OpenCode run card",
  selectionSemantics: "A coding-agent worker captures immutable before/after snapshots and attaches their bounded descriptor to its terminal event.",
  routeOrIpcContract: "Outer coding worker terminal event plus authenticated GET/POST /api/agent-edits operations.",
  requiredServiceOrWorker: ["agent-edits-node", "outer-codex-node", "outer-ruflo-node", "outer-opencode-node"],
  inputTypes: ["authenticated repository path", "coding-agent terminal event"],
  outputTypes: ["durable before/after snapshot descriptor", "edit summary", "per-file patch"],
  artifactTypes: ["identity-bound JSON result", "streamed patch artifact"],
  progressEventContract: "The outer worker withholds terminal completion until the post-run snapshot is captured and fenced.",
  streamingContract: "The compatibility route streams only the verified Runtime artifact; large bytes never cross the control JSON protocol.",
  cancellationBehavior: "Outer-agent cancellation and inspection cancellation each terminate their exact Runtime-owned process tree.",
  approvalBehavior: "The original authenticated coding-agent launch authorizes snapshot capture; later inspection is owner-scoped.",
  followUpContextBehavior: "The run descriptor preserves edit identity without retaining a live Git process or in-memory cache.",
  restartBehavior: "Durable terminal events restore the edit descriptor after Dashboard restart.",
  recoveryBehavior: "Incomplete outer runs do not publish an unfenced edit pair; inspection never falls back to Next-owned Git.",
  runtimePath: "Disposable coding worker -> fixed-Git snapshot executor -> durable terminal descriptor -> disposable inspection worker",
  sourceRefs: agentEditsSources,
});

add({
  capabilityId: "recovery:agent-undo",
  sourceIdentity: "agent-edits-undo",
  displayName: "Agent edit undo",
  category: "recovery",
  visibleEntryPoint: "Completed coding-agent run card -> Undo",
  selectionSemantics: "Explicit authenticated undo for the exact immutable before/after snapshot pair owned by the requester.",
  routeOrIpcContract: "POST /api/agent-edits with action undo and the owner-scoped snapshot pair.",
  requiredServiceOrWorker: ["agent-edits-node"],
  inputTypes: ["authenticated repository path", "immutable snapshot pair"],
  outputTypes: ["bounded undo result"],
  artifactTypes: ["identity-bound JSON result"],
  progressEventContract: "Finite Runtime worker lifecycle with idempotent request identity and fenced completion.",
  streamingContract: "The bounded undo result is read from the verified worker artifact.",
  cancellationBehavior: "Caller abort cancels the exact Runtime job and its complete Git process tree.",
  approvalBehavior: "Undo requires an explicit authenticated user action; no renderer-provided executable or environment is accepted.",
  followUpContextBehavior: "The completed run card remains the source of the exact undo snapshot pair.",
  restartBehavior: "The once-stable request identity and durable Runtime ledger prevent duplicate concurrent undo after restart.",
  recoveryBehavior: "A missing terminal result is reconciled from the exact Runtime job; no direct Git fallback is used.",
  runtimePath: "Undo action -> authenticated agent-edits route -> fresh fixed-Git Runtime worker -> fenced result",
  sourceRefs: agentEditsSources,
});

const agencyRoot = path.join(repoRoot, "agency-agents");
const agencyCatalog = loadAgencyAgentsCatalog({ rootPath: agencyRoot, cacheTtlMs: 0 });
const aris = loadArisAgentDefinition();
const spotifyPersona = loadSpotifyAgentDefinition();
const specialPersonaSlugs = new Set([aris?.slug, spotifyPersona?.slug].filter(Boolean));

for (const persona of agencyCatalog.agents.filter((item) => !specialPersonaSlugs.has(item.slug))) {
  const personaSource = posix(path.join("agency-agents", persona.sourceRelativePath));
  add({
    capabilityId: `persona:agency:${persona.slug}`,
    sourceIdentity: persona.id,
    displayName: persona.name,
    category: "agency-persona",
    visibleEntryPoint: `Agents tab -> Agency Agents -> ${persona.divisionLabel}`,
    slashCommand: `/agents:agency-agents:${persona.slug}`,
    selectionSemantics: `Persistent conversation persona in division ${persona.division}; never stacks with a runtime agent.`,
    routeOrIpcContract: "Slash resolution through registryItemsForUser/findAgencyAgent into the current Hermes conversation.",
    requiredServiceOrWorker: persona.services.map((service) => service.name),
    credentialRequirements: persona.services.map((service) => service.name),
    outputTypes: ["persona-guided-chat-message"],
    progressEventContract: "Standard Hermes conversation lifecycle events.",
    approvalBehavior: "Explicit Agents-tab or slash selection; imported persona guidance cannot widen capabilities.",
    followUpContextBehavior: "Active persona slug is persisted per conversation until cleared or changed.",
    restartBehavior: "Conversation persona selection is durable; catalog is reloaded and revalidated from disk.",
    recoveryBehavior: "Missing/invalid persona source is diagnosed and never replaced with another persona.",
    runtimePath: "Command registry -> bounded persona rendering -> Hermes conversation runtime",
    sourceRefs: [
      sourceAnchor(personaSource, /^---\s*$/),
      sourceAnchor("dashboard/src/lib/hermes/agency-agents.ts", /export function loadAgencyAgentsCatalog/),
      sourceAnchor("dashboard/src/lib/hermes/commands.ts", /loadAgencyAgentsCatalog\(\)\.agents/),
    ],
  });
}

for (const [kind, persona, source] of [
  ["aris", aris, "dashboard/src/lib/aris/agent.ts"],
  ["spotify", spotifyPersona, "dashboard/src/lib/spotify-agent/agent.ts"],
]) {
  if (!persona) fail(`${kind} persona failed to load`);
  add({
    capabilityId: `persona:${kind}`,
    sourceIdentity: persona.id,
    displayName: persona.name,
    category: "first-party-persona",
    visibleEntryPoint: `Agents tab -> ${persona.name}`,
    slashCommand: `/agent:${persona.slug}`,
    selectionSemantics: "Persistent first-party persona; never stacks with a runtime agent.",
    routeOrIpcContract: "Command registry resolves the persona into the current Hermes conversation.",
    requiredServiceOrWorker: kind === "spotify" ? ["Spotify Web Playback / connection"] : [],
    credentialRequirements: kind === "spotify" ? ["Spotify OAuth for playback"] : [],
    outputTypes: kind === "spotify" ? ["persona-guided-chat-message", "playback-card"] : ["persona-guided-chat-message"],
    followUpContextBehavior: "Active persona slug is persisted per conversation.",
    restartBehavior: "Definition reloads from checked-in source; conversation selection remains durable.",
    recoveryBehavior: "Failure to load is surfaced; no unrelated persona fallback is permitted.",
    runtimePath: "Command registry -> first-party persona loader -> Hermes conversation runtime",
    sourceRefs: [
      sourceAnchor(source, /export function load/),
      sourceAnchor("dashboard/src/lib/hermes/agency-agents.ts", kind === "aris" ? /loadArisAgentDefinition/ : /loadSpotifyAgentDefinition/),
      sourceAnchor("dashboard/src/lib/hermes/commands.ts", kind === "aris" ? /loadArisAgentDefinition\(\)/ : /loadSpotifyAgentDefinition\(\)/),
    ],
  });
}

const SKILL_INTENTS = {
  "audio-analysis": "An attached or recently attached audio file selects waveform analysis unless playback/file-handling intent wins.",
  "diagram-design": "Natural-language requests to draw or diagram select the skill.",
  "github-explorer": "A GitHub repository inspection request selects the skill after diagram routing.",
  goal: "A goal/commitment request selects Goal only when no earlier intent claimed the turn.",
  humanize: "A request to humanize or rewrite prose selects the local humanizer.",
  "image-to-3d": "A 3D reconstruction request plus an attached/recent image selects the skill.",
  "interactive-visualizer": "A simulator, explorable, or interactive-visualization request selects the skill.",
  spotify: "Playback/catalog intent, including an attached track, selects Spotify before audio analysis.",
  "send-to-my-phone": "A send-to-WhatsApp/Telegram request selects the messaging skill last.",
  watch: "A video attachment or video URL selects Watch in Terminal.",
  premortem: "A premortem/risk-analysis request selects the installed workflow.",
  "bullshit-detector": "A fact-check/claim-verification request selects the installed workflow.",
  "agent-loop-engineering": "An agent-loop design/audit request selects the installed workflow.",
};

const SKILL_RUNTIME = {
  "audio-analysis": ["audio-analyzer"],
  humanize: ["humanizer-service"],
  "image-to-3d": ["Stable Fast 3D"],
  manim: ["network-disabled Manim container"],
  office: ["OfficeCLI"],
  spotify: ["Spotify Web Playback / connection"],
  watch: ["Watch video runtime", "ffmpeg"],
  "interactive-visualizer": ["sandboxed browser renderer"],
  "interactive-visualizer-in-chat": ["sandboxed browser renderer"],
};

const SKILL_ARTIFACTS = {
  "diagram-design": ["diagram", "svg"],
  "generate-gadget": ["gadget"],
  "image-to-3d": ["model"],
  "interactive-visualizer": ["interactive-visualizer"],
  "interactive-visualizer-in-chat": ["interactive-visualizer"],
  manim: ["video"],
  office: ["document", "presentation", "spreadsheet", "pdf"],
  "resource2skill": ["markdown", "skill-package"],
};

const SKILL_EXTRA_SOURCE = {
  "audio-analysis": "dashboard/src/lib/hermes/audio-intent.ts",
  "diagram-design": "dashboard/src/lib/hermes/diagram-intent.ts",
  "github-explorer": "dashboard/src/lib/hermes/github-explorer-intent.ts",
  goal: "dashboard/src/lib/hermes/goal-intent.ts",
  humanize: "dashboard/src/lib/hermes/humanize-intent.ts",
  "image-to-3d": "dashboard/src/lib/hermes/image-3d-intent.ts",
  "interactive-visualizer": "dashboard/src/lib/hermes/interactive-visualizer-intent.ts",
  spotify: "dashboard/src/lib/hermes/spotify-intent.ts",
  "send-to-my-phone": "dashboard/src/lib/hermes/messaging-intent.ts",
  watch: "dashboard/src/lib/hermes/watch-intent.ts",
  premortem: "dashboard/src/lib/hermes/premortem-intent.ts",
  "bullshit-detector": "dashboard/src/lib/hermes/factcheck-intent.ts",
  "agent-loop-engineering": "dashboard/src/lib/hermes/agent-loop-intent.ts",
};

function frontmatterValue(markdown, key) {
  return markdown.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "mi"))?.[1]?.trim() ?? null;
}

const firstPartySkillRoot = path.join(repoRoot, "hermes-skills", "prebuilt");
const firstPartySkills = fs
  .readdirSync(firstPartySkillRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(firstPartySkillRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

if (firstPartySkills.length !== 26) {
  fail(`expected 26 first-party SKILL.md entries, found ${firstPartySkills.length}`);
}

const installedRegistryPath = path.join(repoRoot, ".agents", "skills", "registry.json");
const installedSkillRegistry = JSON.parse(fs.readFileSync(installedRegistryPath, "utf8"));
const installedSkills = Object.values(installedSkillRegistry.skills ?? {}).sort((left, right) =>
  left.slug.localeCompare(right.slug),
);
if (installedSkills.length !== 3) {
  fail(`expected 3 reviewed installed skills, found ${installedSkills.length}`);
}

function addSkillRow(kind, slug, displayName, skillPath, metadata = {}) {
  const markdown = readSource(skillPath);
  const extraSource = SKILL_EXTRA_SOURCE[slug];
  const refs = [
    sourceAnchor(skillPath, /^name:/i),
    sourceAnchor("dashboard/src/lib/hermes/skills.ts", kind === "first-party" ? /export function listFirstPartySkills/ : /export function listInstalledLocalSkills/),
    sourceAnchor("dashboard/src/lib/hermes/commands.ts", /const skills:/),
  ];
  if (extraSource && fs.existsSync(path.join(repoRoot, extraSource))) {
    refs.push(sourceAnchor(extraSource, /CommandText|commandText|export const/));
  }
  add({
    capabilityId: `skill:${kind}:${slug}`,
    sourceIdentity: metadata.upstreamId ?? `breadboard:${kind}/${slug}`,
    displayName: displayName || frontmatterValue(markdown, "name") || slug,
    category: kind === "first-party" ? "first-party-skill" : "installed-reviewed-skill",
    visibleEntryPoint: `Skills manager and /${metadata.slashCommand ?? slug}`,
    slashCommand: `/${metadata.slashCommand ?? slug}`,
    implicitTrigger: SKILL_INTENTS[slug] ?? null,
    selectionSemantics: SKILL_INTENTS[slug]
      ? "Explicit slash selection or the documented ordered implicit-intent chain; at most one skill per turn."
      : "Explicit slash selection; classification and surface compatibility gates apply.",
    routeOrIpcContract: "registryItemsForUser -> resolveCommandMessage -> reviewed guidance and bounded tool scopes.",
    requiredServiceOrWorker: SKILL_RUNTIME[slug] ?? [],
    credentialRequirements: slug === "spotify" ? ["Spotify OAuth for account playback"] : [],
    inputTypes: ["text", ...(slug.includes("audio") ? ["audio-attachment"] : []), ...(slug === "watch" ? ["video-attachment", "video-url"] : [])],
    outputTypes: ["chat-message", ...(SKILL_ARTIFACTS[slug]?.length ? ["artifact"] : [])],
    artifactTypes: SKILL_ARTIFACTS[slug] ?? [],
    progressEventContract: "Standard Hermes lifecycle plus tool-specific events when the skill invokes a bounded tool.",
    approvalBehavior: "Reviewed skill guidance cannot widen the turn's tool, path, network, credential, or connection grants.",
    followUpContextBehavior: "Selected skill and any produced artifact remain conversation-bound; learned corrections are separately scoped.",
    restartBehavior: "Skill is re-hashed/revalidated from its reviewed source before exposure.",
    recoveryBehavior: "The conversation run restores durable output; an unavailable dependency produces truthful setup/unavailable behavior.",
    runtimePath: "Slash/intent resolver -> Hermes turn -> reviewed skill tool contract",
    sourceRefs: refs,
  });
}

for (const slug of firstPartySkills) {
  const skillPath = posix(path.join("hermes-skills", "prebuilt", slug, "SKILL.md"));
  const markdown = readSource(skillPath);
  addSkillRow("first-party", slug, frontmatterValue(markdown, "name") ?? slug, skillPath);
}
for (const skill of installedSkills) {
  const skillPath = posix(path.join(".agents", "skills", skill.slug, "SKILL.md"));
  addSkillRow("installed", skill.slug, skill.name, skillPath, skill);
}

const promptSourcePath = "dashboard/src/lib/hermes/prompts.ts";
const defaultPrompts = [...readSource(promptSourcePath).matchAll(
  /^\s*\["([^"]+)",\s*"([^"]+)",\s*"([^"]+)"/gm,
)].map((match) => ({ id: match[1], slug: match[2], title: match[3] }));
if (defaultPrompts.length !== 10) fail(`expected 10 default prompts, found ${defaultPrompts.length}`);
for (const prompt of defaultPrompts) {
  add({
    capabilityId: `prompt:default:${prompt.slug}`,
    sourceIdentity: prompt.id,
    displayName: prompt.title,
    category: "default-prompt",
    visibleEntryPoint: `Prompt manager and /${prompt.slug}`,
    slashCommand: `/${prompt.slug}`,
    selectionSemantics: "One server-resolved prompt may be selected and cannot be combined with another capability.",
    routeOrIpcContract: "/api/hermes/prompts inventory; resolvePrompt injects the exact built-in prompt into the turn.",
    inputTypes: ["text", "garden-context"],
    outputTypes: ["chat-message"],
    sourceRefs: [
      sourceAnchor(promptSourcePath, `"${prompt.slug}"`),
      sourceAnchor("dashboard/src/app/api/hermes/prompts/route.ts", /export async function GET/),
      sourceAnchor("dashboard/src/lib/hermes/commands.ts", /const prompts:/),
    ],
  });
}

function parseProviderSpecs() {
  const relativePath = "chatmock/chatmock/providers/catalog.py";
  const lines = readSource(relativePath).split(/\r?\n/);
  const specs = [];
  let block = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s{4}ProviderSpec\($/.test(line)) block = { start: index + 1, lines: [] };
    if (!block) continue;
    block.lines.push(line);
    if (!/^\s{4}\),$/.test(line)) continue;
    const text = block.lines.join("\n");
    const idValue = text.match(/\bid=(?:CHATGPT_PROVIDER_ID|"([^"]+)")/)?.[1] ?? "chatgpt";
    const label = text.match(/\blabel="([^"]+)"/)?.[1];
    if (idValue && label) {
      specs.push({
        id: idValue,
        label,
        line: block.start,
        requiresApiKey: !/requires_api_key=False/.test(text),
        baseUrlEditable: /base_url_editable=True/.test(text),
      });
    }
    block = null;
  }
  return specs;
}

const providerSpecs = parseProviderSpecs();
if (providerSpecs.length !== 12) fail(`expected 12 ChatMock providers, found ${providerSpecs.length}`);
for (const provider of providerSpecs) {
  add({
    capabilityId: `provider:${provider.id}`,
    sourceIdentity: provider.id,
    displayName: provider.label,
    category: "provider",
    visibleEntryPoint: "Settings -> Accounts -> Model providers",
    selectionSemantics: "Provider-backed models appear through the authenticated ChatMock model catalog.",
    routeOrIpcContract: "GET/PUT/DELETE /api/chatmock/providers; GET /api/models.",
    requiredServiceOrWorker: ["ChatMock"],
    credentialRequirements: provider.requiresApiKey
      ? [`${provider.label} API key or supported environment fallback`]
      : provider.id === "chatgpt"
      ? ["ChatGPT OAuth"]
      : [],
    externalSoftwareRequirements: provider.id === "cliproxy" ? ["CLIProxyAPI for subscription-backed models"] : [],
    inputTypes: ["provider-settings", "model-request"],
    outputTypes: ["provider-status", "model-catalog", "model-response"],
    streamingContract: "ChatMock preserves the selected provider/model streaming response contract.",
    cancellationBehavior: "Cancellation propagates from the owning conversation request.",
    approvalBehavior: "Credential changes require an authenticated Settings action; stored keys are never returned to the browser.",
    restartBehavior: "Provider configuration remains in ChatMock storage and is re-read after restart.",
    recoveryBehavior: "Unavailable providers return truthful setup/upstream errors; no unrelated provider fallback is a pass.",
    runtimePath: "Dashboard provider API -> ChatMock -> selected upstream provider",
    sourceRefs: [
      `chatmock/chatmock/providers/catalog.py:${provider.line}`,
      sourceAnchor("dashboard/src/lib/chatmock-providers.ts", /export interface PublicChatMockProvider/),
      sourceAnchor("dashboard/src/app/api/chatmock/providers/route.ts", /export async function GET/),
      sourceAnchor("dashboard/src/app/api/models/route.ts", /export async function GET/),
    ],
  });
}

const modelIds = [aiModels.GLOBAL_MODEL_SENTINEL, ...aiModels.DEFAULT_ASSISTANT_MODELS];
for (const modelId of [...new Set(modelIds)]) {
  add({
    capabilityId: `model:${modelId}`,
    sourceIdentity: modelId,
    displayName: modelId === aiModels.GLOBAL_MODEL_SENTINEL ? "Provider default" : modelId,
    category: "model-selection",
    visibleEntryPoint: "Chat intelligence/model picker",
    selectionSemantics: modelId === aiModels.GLOBAL_MODEL_SENTINEL
      ? "Global sentinel resolves server-side to the user's selected provider model."
      : "Fallback picker entry retained when the live provider model catalog is unavailable.",
    routeOrIpcContract: "GET /api/models; per-turn model id in the Hermes messages contract.",
    requiredServiceOrWorker: ["ChatMock"],
    providerRequirements: modelId === aiModels.GLOBAL_MODEL_SENTINEL ? ["selected provider"] : ["ChatGPT runtime fallback catalog"],
    inputTypes: ["model-selection"],
    outputTypes: ["selected-model-id"],
    cancellationBehavior: "Model changes do not create a run; active run cancellation remains conversation-scoped.",
    recoveryBehavior: "Stored selection resolves again after restart; provider failures remain visible.",
    runtimePath: "Model picker -> /api/models -> ChatMock model normalization",
    sourceRefs: [
      sourceAnchor("dashboard/src/lib/ai-models.ts", modelId === aiModels.GLOBAL_MODEL_SENTINEL ? /GLOBAL_MODEL_SENTINEL/ : `"${modelId}"`),
      sourceAnchor("dashboard/src/lib/hermes/model-selection.ts", /export function/),
      sourceAnchor("dashboard/src/app/api/models/route.ts", /export async function GET/),
    ],
  });
}

const surfaceSpecs = [
  {
    id: "dashboard-terminal",
    name: "Dashboard Terminal",
    entry: "Dashboard bottom dock -> Terminal",
    route: "POST /api/hermes/sessions/[sessionId]/messages; GET events; POST abort",
    runtime: "Dashboard composer -> conversation turn service -> Hermes runtime",
    sources: [
      ["dashboard/src/lib/hermes/config.ts", /dashboard_terminal/],
      ["dashboard/src/app/components/hermes/dashboard-agent-terminal.tsx", /useConversationSession/],
      ["dashboard/src/app/api/hermes/sessions/[sessionId]/messages/route.ts", /export async function POST/],
      ["dashboard/src/app/api/hermes/sessions/[sessionId]/abort/route.ts", /export async function POST/],
    ],
  },
  {
    id: "garden-chat",
    name: "Garden Chat",
    entry: "Garden workspace -> Chat panel",
    route: "Surface-bound Hermes session/messages/events/abort with garden ownership",
    runtime: "Garden workspace -> conversation turn service -> Hermes runtime + Garden tools",
    sources: [
      ["dashboard/src/lib/hermes/config.ts", /garden_chat/],
      ["dashboard/src/app/gardens/[clusterSlug]/workspace-client.tsx", /garden_chat/],
      ["dashboard/src/lib/hermes/tool-scopes.ts", /surface === "garden_chat"/],
    ],
  },
  {
    id: "legacy-garden-chat",
    name: "Legacy Garden Chat compatibility path",
    entry: "Legacy embedded Garden assistant",
    route: "POST /api/chat with /api/chat-sessions history compatibility",
    runtime: "Garden assistant -> garden-chat-adapter -> Hermes runtime",
    sources: [
      ["dashboard/src/app/garden/garden-assistant.tsx", /\/api\/chat/],
      ["dashboard/src/lib/hermes/garden-chat-adapter.ts", /const premortemSelection/],
      ["dashboard/src/app/api/chat/route.ts", /export async function POST/],
    ],
  },
  {
    id: "quartz-ai",
    name: "Quartz AI",
    entry: "Published Garden page -> Ask AI",
    route: "POST /api/quartz-ai/chat; session/event/abort/model/command CORS contracts",
    runtime: "Published Quartz iframe bridge -> Quartz AI route -> read/proposal-only Hermes runtime",
    sources: [
      ["dashboard/src/lib/hermes/config.ts", /quartz_ai/],
      ["dashboard/src/app/api/quartz-ai/chat/route.ts", /export async function POST/],
      ["dashboard/src/app/api/quartz-ai/events/route.ts", /export async function GET/],
      ["dashboard/src/lib/hermes/tool-scopes.ts", /surface === "quartz_ai"/],
    ],
  },
  {
    id: "temporary-chat",
    name: "Temporary chat",
    entry: "Chat composer temporary-mode control",
    route: "Hermes session created with temporary flag; transcript remains conversation-local",
    runtime: "Conversation store -> Hermes runtime without cross-chat durable memory",
    followUp:
      "The live temporary conversation preserves its own exact transcript and selected context for a real second turn until the user leaves temporary mode or reloads.",
    restart:
      "Temporary conversations are intentionally excluded from history, browser restore pointers, drafts, titles, search and restart recovery.",
    recovery: "Not applicable.",
    sources: [
      ["dashboard/src/app/api/hermes/sessions/route.ts", /temporary/],
      ["dashboard/src/app/components/hermes/dashboard-agent-terminal.tsx", /const \[temporaryChat/],
      ["dashboard/src/app/components/hermes/use-agent-session.ts", /is a temporary chat, which is deliberately not somewhere you can come back/],
      ["dashboard/src/lib/conversations/memory.ts", /A temporary chat keeps its own thread of context/],
      ["dashboard/src/lib/conversations/store.ts", /WHERE user_id = \? AND temporary = 0/],
      ["dashboard/tests/temporary-chat.test.mjs", /a temporary chat keeps its own thread of context/],
    ],
  },
];

for (const surface of surfaceSpecs) {
  const refs = surface.sources.map(([relativePath, matcher]) => sourceAnchor(relativePath, matcher));
  add({
    capabilityId: `surface:${surface.id}`,
    displayName: surface.name,
    category: "chat-surface",
    visibleEntryPoint: surface.entry,
    selectionSemantics: "The visible surface fixes its Hermes surface identifier and corresponding tool/capability boundary.",
    routeOrIpcContract: surface.route,
    requiredServiceOrWorker: surface.id === "quartz-ai" ? ["dashboard", "Quartz static site when published"] : ["dashboard", "Hermes"],
    inputTypes: ["text", "supported-chat-attachments", "conversation-options"],
    outputTypes: ["streamed-chat-message", "tool-events", "artifacts"],
    artifactTypes: ["all surface-authorized artifact kinds"],
    progressEventContract: "Conversation SSE replays ordered lifecycle/tool/artifact events.",
    streamingContract: "Server-owned event pump survives request disconnect; Quartz supports authenticated or client-token isolation.",
    cancellationBehavior: "Abort route stops runtime and active child/tool work and revokes the capability grant.",
    approvalBehavior: "Per-turn capability decision and permission prompts; Quartz is read/proposal-only.",
    followUpContextBehavior:
      surface.followUp ?? "Same conversation preserves exact transcript, selected branch, source and artifact context.",
    restartBehavior: surface.restart ?? (surface.id === "legacy-garden-chat"
      ? "Legacy session rows persist; intent and attachment semantics are separately implemented and must remain parity-checked."
      : "Durable conversation/run rows are resumed or terminally reconciled on restart."),
    recoveryBehavior: surface.recovery ?? "Refresh reconnects by session/run id and bounded event cursor.",
    runtimePath: surface.runtime,
    sourceRefs: refs,
  });
}

const TOOL_FAMILY_EXPORTS = [
  ["garden", "Garden tools", "GARDEN_TOOLS"],
  ["quartz", "Quartz tools", "QUARTZ_TOOLS"],
  ["gbrain", "GBrain retrieval", "GBRAIN_TOOLS"],
  ["artifacts", "Artifact tools", "ARTIFACT_TOOLS"],
  ["gadgets", "Gadget tools", "GADGET_TOOLS"],
  ["memory", "Memory tools", "MEMORY_TOOLS"],
  ["workflow-proposal", "Workflow proposal", "WORKFLOW_PROPOSAL_TOOLS"],
  ["skill-lesson", "Skill lessons", "SKILL_LESSON_TOOLS"],
  ["premortem", "Premortem", "PREMORTEM_TOOLS"],
  ["watch", "Watch video analysis", "WATCH_TOOLS"],
  ["factcheck", "Fact checking", "FACTCHECK_TOOLS"],
  ["image-to-3d", "Image to 3D", "IMAGE_TO_3D_TOOLS"],
  ["audio-analysis", "Audio analysis", "AUDIO_ANALYSIS_TOOLS"],
  ["manim", "Manim rendering", "MANIM_TOOLS"],
  ["agent-loop", "Agent-loop engineering", "AGENT_LOOP_TOOLS"],
  ["omh", "Oh My Hermes workflows", "OMH_TOOLS"],
  ["messaging", "Self messaging", "MESSAGING_TOOLS"],
  ["recall", "Recall", "RECALL_TOOLS"],
  ["world-monitor", "World Monitor", "WORLDMONITOR_TOOLS"],
  ["image-search", "Image search", "IMAGE_SEARCH_TOOLS"],
  ["map", "Map", "MAP_TOOLS"],
  ["spotify", "Spotify", "SPOTIFY_TOOLS"],
  ["calendar", "Calendar", "CALENDAR_TOOLS"],
  ["plan", "Plan board", "PLAN_TOOLS"],
  ["office", "Office authoring", "OFFICE_TOOLS"],
  ["document", "Document editing", "DOCUMENT_TOOLS"],
  ["watermark", "Watermark inspection/removal", "WATERMARK_TOOLS"],
  ["humanizer", "Humanizer", "HUMANIZER_TOOLS"],
  ["workspace", "Scoped workspace", "WORKSPACE_TOOLS"],
  ["research", "Coverage-driven research", "RESEARCH_TOOLS"],
  ["super-agent", "Super Agent orchestration", "SUPER_AGENT_TOOLS"],
  ["document-skill", "Document skill reading", "DOCUMENT_SKILL_TOOLS"],
];

const TOOL_SERVICE_REQUIREMENTS = {
  gbrain: ["GBrain"],
  watch: ["Watch runtime", "ffmpeg"],
  "image-to-3d": ["Stable Fast 3D"],
  "audio-analysis": ["audio-analyzer"],
  manim: ["network-disabled Manim container"],
  recall: ["Recall capture service"],
  spotify: ["Spotify Web Playback / OAuth connection"],
  office: ["OfficeCLI"],
  humanizer: ["humanizer-service"],
};

for (const [id, name, exportName] of TOOL_FAMILY_EXPORTS) {
  const tools = toolScopes[exportName];
  const runtimeV2Watermark = id === "watermark";
  if (!Array.isArray(tools) || tools.length === 0) fail(`tool family ${exportName} is empty or missing`);
  add({
    capabilityId: `tool-family:${id}`,
    sourceIdentity: exportName,
    displayName: name,
    category: "tool-family",
    visibleEntryPoint: "Selected automatically or by its reviewed skill/feature entry point in authenticated chat.",
    implicitTrigger: SKILL_INTENTS[id] ?? null,
    selectionSemantics: `Exact tool IDs: ${tools.join(", ")}. Surface composition is enforced by allowedToolsForSurface.`,
    routeOrIpcContract: runtimeV2Watermark
      ? "Authenticated Watermark tool and automatic artifact-scrub callers submit one exact conversation-scoped Runtime job and accept only its fenced hashed result."
      : "Signed capability token and server-side task decision are revalidated by the internal tool route.",
    requiredServiceOrWorker: runtimeV2Watermark
      ? ["Runtime V2 watermark-operation disposable worker"]
      : TOOL_SERVICE_REQUIREMENTS[id] ?? [],
    inputTypes: runtimeV2Watermark
      ? ["one sealed owned file, or one bounded streamed audit bundle"]
      : ["bounded-tool-arguments"],
    outputTypes: runtimeV2Watermark
      ? ["typed inspection/clean/audit result", "hashed fenced output receipt", "audit-event"]
      : ["typed-tool-result", "audit-event"],
    artifactTypes: runtimeV2Watermark
      ? ["cleaned document or media artifact", "watermark audit report"]
      : id === "artifacts" ? [...artifactTypes.ARTIFACT_KINDS] : [],
    progressEventContract: runtimeV2Watermark
      ? "The exact Runtime job reaches one fenced terminal result; no hidden Next-owned Python progress or fallback exists."
      : "Tool start/completion/failure events are correlated to the conversation run.",
    cancellationBehavior: runtimeV2Watermark
      ? "Request or conversation abort cancels the exact Runtime job; the fixed Python child receives a graceful stop before native Job-tree reaping."
      : "Owning conversation abort propagates to cancellable tool work; finite tools return a terminal result.",
    approvalBehavior: id === "gadgets"
      ? "Gadget writes are queued as durable user-approved actions."
      : id === "recall"
      ? "Recall control may require explicit per-action approval; reads honor the current agentAccess setting."
      : runtimeV2Watermark
      ? "Authenticated conversation ownership and the granted Watermark tool or automatic artifact-scrub policy authorize exactly one sealed input."
      : "Capability broker and tool route enforce the per-turn grant; write families retain their documented proposal/reversibility policy.",
    followUpContextBehavior: "Tool evidence and artifacts are stored against the owning conversation/run.",
    restartBehavior: runtimeV2Watermark
      ? "A completed fenced receipt remains Runtime-owned; an interrupted synchronous operation retries as a fresh exact conversation-scoped job."
      : "Tool availability is recomputed from registry and service state; stopped services must not hide the capability.",
    recoveryBehavior: runtimeV2Watermark
      ? "Only a verified hashed terminal receipt is promoted; uncertain submission is cancelled by idempotency identity and partial outputs are discarded."
      : "Durable tool/artifact events replay where supported; an unavailable dependency remains truthful rather than silently falling back.",
    stoppedServiceBehavior: runtimeV2Watermark
      ? "The capability must remain visible while stopped or resource-blocked; no managed service is required and resource denial remains a typed Runtime-unavailable result."
      : undefined,
    runtimePath: runtimeV2Watermark
      ? "Watermark tool or automatic artifact scrub -> Runtime V2 watermark-operation-node -> fixed staged Python script -> fenced hashed result"
      : `Hermes turn -> capability broker -> ${exportName} internal route(s)`,
    sourceRefs: runtimeV2Watermark
      ? [
          sourceAnchor("dashboard/src/lib/hermes/tool-scopes.ts", new RegExp(`export const ${exportName}`)),
          sourceAnchor("dashboard/src/app/api/hermes/tools/watermarks/route.ts", /export async function POST/),
          sourceAnchor("dashboard/src/lib/runtime-v2/watermark-job.ts", /export async function runWatermarkOperationViaRuntime/),
          sourceAnchor("dashboard/src/lib/watermarks/scrub-file.ts", /watermark-job/),
          sourceAnchor("dashboard/scripts/runtime-v2-watermark-worker.mjs", /export async function executeRuntimeV2WatermarkOperation/),
        ]
      : [
          sourceAnchor("dashboard/src/lib/hermes/tool-scopes.ts", new RegExp(`export const ${exportName}`)),
          sourceAnchor("dashboard/src/lib/hermes/capability-broker.ts", /export async function|export function/),
          sourceAnchor("dashboard/src/lib/hermes/capability-token.ts", /export function/),
        ],
  });
}

// Runtime-owned service capabilities that are not members of the Hermes
// tool-scope exports still need stable parity identities. Post-migration
// execution remains NOT RUN until the normal Electron path is inspected.
const RUNTIME_SERVICE_TOOL_FAMILIES = [
  {
    id: "model-gateway",
    sourceIdentity: "cliproxy-model-gateway",
    name: "Subscription model gateway",
    entry: "Settings -> Providers -> CLIProxy login/account controls and model selection",
    route: "Authenticated CLIProxy status/login/accounts routes and OpenAI-compatible model traffic",
    service: "Runtime V2 cliproxy service",
    input: ["provider login action", "OpenAI-compatible model request"],
    output: ["provider account state", "model response stream"],
    progress: "Login polling and model-stream lifecycle remain bounded and user-visible.",
    cancel: "Login leases release on completion/abort; model cancellation closes the owning request.",
    approval: "The authenticated user explicitly starts provider login; ordinary model use follows the selected provider configuration.",
    restart: "Provider credentials/configuration persist outside the process; the on-demand service is reacquired after restart.",
    recovery: "Stopped or failed service state stays visible and the original action reacquires it without a hidden direct-spawn fallback.",
    sources: [
      ["dashboard/src/lib/cliproxy/runtime-lease.ts", /export async function withCliproxyLease/],
      ["desktop/runtime-v2/manifests/services.json", /"id": "cliproxy"/],
    ],
  },
  {
    id: "document-page-retrieval",
    sourceIdentity: "colpali-document-page-retrieval",
    name: "Document page retrieval",
    entry: "Document question when a visual-page index is available",
    route: "ColPali health/index/search/forget client contract",
    service: "Runtime V2 colpali service",
    input: ["owned document", "bounded page-query request"],
    output: ["ranked page text", "page image references"],
    progress: "Bounded index and retrieval lifecycle remains tied to the owning document action.",
    cancel: "Owning request cancellation releases the service lease and stops cancellable work.",
    approval: "Only the authenticated owner may index or query the document.",
    restart: "Indexes and model cache persist under the sealed data root; the service is reacquired on demand.",
    recovery: "Unavailable visual retrieval leaves the original document path intact and never fabricates page evidence.",
    sources: [
      ["dashboard/src/lib/colpali/service.ts", /export async function colpaliSearch/],
      ["desktop/runtime-v2/manifests/services.json", /"id": "colpali"/],
    ],
  },
  {
    id: "local-rewriting",
    sourceIdentity: "humanizer-local-rewriting",
    name: "Local rewriting",
    entry: "Humanize skill, implicit humanize intent, and authenticated rewrite controls",
    route: "Humanizer rewrite/cancel/status contract",
    service: "Runtime V2 humanizer service",
    input: ["bounded source text", "rewrite settings"],
    output: ["rewritten text", "version/status metadata"],
    progress: "Rewrite progress and terminal failure remain visible to the owning action.",
    cancel: "The authenticated cancel path aborts active rewriting and releases the service lease.",
    approval: "Capability-token and authenticated-user scope gate each rewrite.",
    restart: "Checkpoint/cache state persists under the sealed data root; service process state is disposable.",
    recovery: "A missing checkpoint or failed local model is reported truthfully; no remote or canned rewrite counts as parity.",
    sources: [
      ["dashboard/src/lib/humanizer/service.ts", /export async function humanizerRewrite/],
      ["desktop/runtime-v2/manifests/services.json", /"id": "humanizer"/],
    ],
  },
  {
    id: "speech-synthesis",
    sourceIdentity: "voicebox-speech-synthesis",
    name: "Speech synthesis",
    entry: "Read-aloud and speech synthesis/profile controls",
    route: "POST /api/speech/synthesize and /api/speech/synthesize/mp3",
    service: "Runtime V2 voicebox service plus speech-media-node for fixed MP3 encoding",
    input: ["bounded text", "voice/profile selection"],
    output: ["audio response", "MP3 artifact"],
    progress: "Model loading and synthesis status remain explicit, including the existing 202 loading response.",
    cancel: "Owning HTTP/turn cancellation closes synthesis and releases the service lease.",
    approval: "Authenticated explicit read-aloud/synthesis action selects the configured voice profile.",
    restart: "Profiles/models persist under the sealed data root; Voicebox is reacquired on demand and every MP3 conversion is a fresh durable Runtime job.",
    recovery: "Partial audio is never presented as completed synthesis; the fenced MP3 result survives Dashboard restart and an interrupted caller retries a fresh exact operation.",
    sources: [
      ["dashboard/src/lib/speech/synthesis.ts", /export async function synthesizeSpeech/],
      ["dashboard/src/lib/runtime-v2/speech-media-job.ts", /export async function encodeSpeechMp3ViaRuntime/],
      ["dashboard/scripts/runtime-v2-speech-media-worker.mjs", /loadRuntimeV2SpeechMediaLaunch/],
      ["dashboard/scripts/runtime-v2-speech-media-executor.mjs", /export async function executeSpeechMedia/],
      ["desktop/runtime-v2/manifests/workers.json", /"kind": "speech-media-node"/],
      ["desktop/runtime-v2/manifests/services.json", /"id": "voicebox"/],
    ],
  },
  {
    id: "video-transcription",
    sourceIdentity: "scriberr-video-transcription",
    name: "Video transcription",
    entry: "Garden video upload/YouTube transcription and Meeting Notes",
    route: "Garden video-transcription create/detail/retry/cancel/inspect APIs",
    service: "Runtime V2 scriberr service or explicit external Scriberr endpoint plus speech-media-node for fixed media preparation",
    input: ["owned video upload", "validated YouTube URL"],
    output: ["speaker-aware transcript", "indexed Garden source"],
    progress: "Durable SQLite state, heartbeat and checkpoint transitions remain observable.",
    cancel: "Dedicated authenticated cancel persists intent and stops the active transcription stage.",
    approval: "The authenticated Garden owner explicitly queues or retries transcription.",
    restart: "Queued jobs and checkpoint paths persist; the local service is reacquired on demand and each media preparation operation is a fresh durable Runtime job.",
    recovery: "Retry resumes from a valid checkpoint or source and preserves terminal states; fenced speech/media outputs cannot escape their private attempt stage and external mode remains explicit.",
    sources: [
      ["dashboard/src/lib/scriberr/job-runner.ts", /recoverStaleJobs/],
      ["dashboard/src/lib/runtime-v2/speech-media-job.ts", /export async function downloadVideoSourceViaRuntime/],
      ["dashboard/scripts/runtime-v2-speech-media-worker.mjs", /loadRuntimeV2SpeechMediaLaunch/],
      ["dashboard/scripts/runtime-v2-speech-media-executor.mjs", /export async function executeSpeechMedia/],
      ["desktop/runtime-v2/manifests/workers.json", /"kind": "speech-media-node"/],
      ["desktop/runtime-v2/manifests/services.json", /"id": "scriberr"/],
    ],
  },
];

for (const capability of RUNTIME_SERVICE_TOOL_FAMILIES) {
  add({
    capabilityId: `tool-family:${capability.id}`,
    sourceIdentity: capability.sourceIdentity,
    displayName: capability.name,
    category: "tool-family",
    visibleEntryPoint: capability.entry,
    selectionSemantics: `The existing visible action selects ${capability.name}; a stopped managed service is cold-started by that same action.`,
    routeOrIpcContract: capability.route,
    requiredServiceOrWorker: [capability.service],
    inputTypes: capability.input,
    outputTypes: capability.output,
    progressEventContract: capability.progress,
    cancellationBehavior: capability.cancel,
    approvalBehavior: capability.approval,
    restartBehavior: capability.restart,
    recoveryBehavior: capability.recovery,
    runtimePath: `${capability.entry} -> authenticated dashboard adapter -> ${capability.service}`,
    sourceRefs: capability.sources.map(([relativePath, matcher]) => sourceAnchor(relativePath, matcher)),
  });
}

// Generated Garden visuals use a fresh private Runtime V2 browser job for the
// screenshot/render phase. These two stable tool-family identities are not
// exported through Hermes tool-scopes, so keep their parity contract beside
// the other explicit Runtime-owned tool families.
const GENERATED_VISUAL_BROWSER_TOOL_FAMILIES = [
  {
    id: "artifact-render",
    sourceIdentity: "generated-visual-artifact-render",
    name: "Generated visual artifact rendering",
  },
  {
    id: "image-generation",
    sourceIdentity: "generated-visual-image-generation",
    name: "Generated visual image rendering",
  },
];

for (const capability of GENERATED_VISUAL_BROWSER_TOOL_FAMILIES) {
  add({
    capabilityId: `tool-family:${capability.id}`,
    sourceIdentity: capability.sourceIdentity,
    displayName: capability.name,
    category: "tool-family",
    visibleEntryPoint: "Garden generated-visual regenerate action",
    selectionSemantics:
      "The authenticated Garden visualization action submits one fixed Runtime V2 browser job for the exact owned visual and accepts only its fenced screenshot result.",
    routeOrIpcContract:
      "POST /api/gardens/[gardenId]/visualizations/[visualId]/regenerate -> exact user/Garden job authority -> generated-visual-browser result fence.",
    requiredServiceOrWorker: ["Runtime V2 generated-visual-browser disposable worker"],
    inputTypes: ["one owned generated-visual HTML blob, at most 12 MiB"],
    outputTypes: ["bounded fenced screenshot result"],
    artifactTypes: ["image", "generated-visual"],
    progressEventContract:
      "Runtime job state and the existing regenerate response expose completion or a typed failure without a hidden Next-owned browser.",
    streamingContract:
      "No long-lived browser stream is exposed; the bounded regenerate request accepts only the exact terminal fenced screenshot result.",
    cancellationBehavior:
      "Request abort cancels the exact Runtime job; graceful browser cleanup is followed by the native Job-tree reap.",
    approvalBehavior:
      "Authenticated Garden ownership and the explicit regenerate action authorize the one sealed visual input.",
    followUpContextBehavior:
      "The accepted screenshot remains attached to the same owned visualization and Garden publication state.",
    restartBehavior:
      "A completed fenced result remains Runtime-owned; an interrupted regenerate action submits a fresh exact scoped job rather than reconnecting to an unproven browser process.",
    recoveryBehavior:
      "Uncertain submission is cancelled by its idempotency identity; foreign, stale, malformed, or tampered result fences are rejected.",
    runtimePath:
      "Garden regenerate route -> Runtime V2 generated-visual-browser-node -> private Chromium descendant -> fenced screenshot",
    sourceRefs: [
      sourceAnchor(
        "dashboard/src/app/api/gardens/[gardenId]/visualizations/[visualId]/regenerate/route.ts",
        /export async function POST/,
      ),
      sourceAnchor(
        "dashboard/src/lib/runtime-v2/generated-visual-browser-job.ts",
        /export async function runGeneratedVisualBrowserInvocationViaRuntime/,
      ),
      sourceAnchor(
        "dashboard/scripts/runtime-v2-generated-visual-browser-executor.mjs",
        /export async function executeGeneratedVisualBrowserOperation/,
      ),
    ],
  });
}

// Graft is not part of the Hermes tool-scope exports above: it is a
// repository-scoped MCP server attached to coding-agent runs. It still has a
// visible Garden setting and a finite index-build boundary, so it needs its own
// stable capability row instead of remaining an inventory-only ID.
const GRAFT_PRE_MIGRATION_EVIDENCE = [
  "dashboard/src/app/actions/clusters.ts:747",
  "dashboard/src/app/dashboard/dashboard-client.tsx:3246",
  "dashboard/src/lib/code-index/garden.ts:22",
  "dashboard/src/lib/code-index/index-service.ts:141",
  "dashboard/tests/graft-code-index.test.mjs:199",
];
add({
  capabilityId: "tool-family:code-index",
  sourceIdentity: "graft-code-index",
  displayName: "Graft code index",
  category: "tool-family",
  visibleEntryPoint: "Edit garden -> Graft code index; connected-repository coding-agent runs",
  implicitTrigger: "A coding-agent run against an enabled Garden repository requests the existing graph or starts its background build.",
  selectionSemantics:
    "Enabled by default per Garden with an explicit opt-out. A ready graph is attached as the graft MCP server; a missing CLI or in-progress graph leaves the same coding-agent run on direct repository search and is reported truthfully.",
  routeOrIpcContract:
    "Authenticated Garden server actions persist the setting; Codex, OpenCode and Ruflo run routes resolve the owned repository and attach a repository-scoped graft MCP definition when ready.",
  requiredServiceOrWorker: ["finite Graft index build", "per-run Graft MCP server"],
  externalSoftwareRequirements: ["@nanonets/graft CLI"],
  inputTypes: ["owned connected Git repository", "Garden code-index setting"],
  outputTypes: ["persistent code graph", "repository-scoped MCP tools"],
  progressEventContract:
    "Repository connection reports ready, building or unavailable; the legacy background build has no durable progress stream.",
  streamingContract: "Each eligible coding-agent run receives graft over its scoped MCP stdio transport.",
  cancellationBehavior:
    "The legacy build has only its bounded timeout and child kill; it has no user cancellation route and must become a Runtime V2 finite job.",
  approvalBehavior:
    "Only the authenticated Garden owner can connect the repository or change the setting; agent access remains scoped to that connected repository.",
  followUpContextBehavior:
    "The Garden setting and external graph directory are reused by later coding-agent runs for the same repository.",
  restartBehavior:
    "A completed graph persists outside the connected repository; an in-flight legacy build record is process-local and must be reconciled after migration.",
  recoveryBehavior:
    "A missing or failed graph starts or retries a bounded build, while the requested coding-agent run continues without claiming indexed results.",
  preMigrationEvidence: GRAFT_PRE_MIGRATION_EVIDENCE,
  selectionEvidence: GRAFT_PRE_MIGRATION_EVIDENCE,
  serviceWorkerEvidence: GRAFT_PRE_MIGRATION_EVIDENCE,
  outputArtifactEvidence: GRAFT_PRE_MIGRATION_EVIDENCE,
  cancellationEvidence: GRAFT_PRE_MIGRATION_EVIDENCE,
  recoveryEvidence: GRAFT_PRE_MIGRATION_EVIDENCE,
  runtimePath:
    "Garden repository setting -> finite graft build -> repository-scoped graft MCP on Codex/OpenCode/Ruflo runs",
  stoppedServiceBehavior:
    "Must remain visible while stopped or the CLI is unavailable; the coding-agent action proceeds without indexed tools and reports the unavailable/building state instead of requiring resubmission.",
  sourceRefs: [
    sourceAnchor("dashboard/src/app/dashboard/dashboard-client.tsx", /Graft code index/),
    sourceAnchor("dashboard/src/app/actions/clusters.ts", /export async function setClusterGraftEnabled/),
    sourceAnchor("dashboard/src/lib/code-index/garden.ts", /export function graftEnabledForGarden/),
    sourceAnchor("dashboard/src/lib/code-index/index-service.ts", /export function ensureGraftIndex/),
    sourceAnchor("dashboard/tests/graft-code-index.test.mjs", /every coding agent that resolves a connected repository/),
  ],
});

const attachmentSpecs = [
  {
    id: "text",
    name: "Text attachment",
    formats: ["txt", "md", "csv", "json"],
    max: "2 MiB inline text",
    route: "Parsed in the chat attachment request; plain text may be extracted client-side.",
    sources: [["dashboard/src/lib/chat-attachments-request.ts", /MAX_ATTACHMENT_TEXT_LENGTH/]],
  },
  {
    id: "image",
    name: "Image attachment",
    formats: ["jpg", "jpeg", "png", "webp"],
    max: "12 MiB data URL request bound; artifact image upload has a separate 25 MiB bound",
    route: "Image data is retained safely in the durable message attachment contract.",
    sources: [["dashboard/src/lib/chat-attachments.ts", /CHAT_ATTACHMENT_ACCEPT/]],
  },
  {
    id: "document",
    name: "Document attachment",
    formats: [...documentAttachments.DOCUMENT_ATTACHMENT_EXTENSIONS],
    max: `${documentAttachments.MAX_DOCUMENT_ATTACHMENT_BYTES} bytes`,
    route: "POST/GET/DELETE /api/chat-attachments/documents; extraction/index status is blob-id scoped.",
    sources: [
      ["dashboard/src/lib/document-attachments.ts", /DOCUMENT_ATTACHMENT_FORMATS/],
      ["dashboard/src/app/api/chat-attachments/documents/route.ts", /export async function POST/],
    ],
  },
  {
    id: "audio",
    name: "Audio attachment",
    formats: [...audioAttachments.AUDIO_ATTACHMENT_EXTENSIONS],
    max: `${audioAttachments.MAX_AUDIO_ATTACHMENT_BYTES} bytes`,
    route: "POST/GET /api/chat-attachments/audio; referenced by owned blob id from audio tools.",
    sources: [
      ["dashboard/src/lib/audio-attachments.ts", /AUDIO_ATTACHMENT_FORMATS/],
      ["dashboard/src/app/api/chat-attachments/audio/route.ts", /export async function POST/],
    ],
  },
  {
    id: "video",
    name: "Video attachment",
    formats: [...videoAttachments.VIDEO_ATTACHMENT_EXTENSIONS],
    max: `${videoAttachments.MAX_VIDEO_ATTACHMENT_BYTES} bytes`,
    route: "Terminal-only POST/GET /api/chat-attachments/videos; Watch resolves the owned blob.",
    sources: [
      ["dashboard/src/lib/video-attachments.ts", /VIDEO_ATTACHMENT_FORMATS/],
      ["dashboard/src/app/api/chat-attachments/videos/route.ts", /export async function POST/],
    ],
  },
  {
    id: "model",
    name: "3D/CAD model attachment",
    formats: [...modelAttachments.MODEL_ATTACHMENT_EXTENSIONS],
    max: `${modelAttachments.MAX_MODEL_ATTACHMENT_BYTES} bytes`,
    route: "Multipart POST/GET /api/chat-attachments/models; kernel formats receive a contained preview conversion.",
    sources: [
      ["dashboard/src/lib/model-attachments.ts", /MODEL_ATTACHMENT_FORMATS/],
      ["dashboard/src/app/api/chat-attachments/models/route.ts", /export async function POST/],
    ],
  },
];

for (const attachment of attachmentSpecs) {
  add({
    capabilityId: `attachment:${attachment.id}`,
    displayName: attachment.name,
    category: "attachment",
    visibleEntryPoint: attachment.id === "video" ? "Terminal attachment picker/paste/drop" : "Terminal and Garden Chat attachment picker/paste/drop",
    implicitTrigger: ["audio", "video", "model", "image"].includes(attachment.id)
      ? `Attachment metadata participates in the ordered implicit ${attachment.id} intent rules.`
      : null,
    selectionSemantics: `Accepted formats: ${attachment.formats.join(", ")}; limit: ${attachment.max}.`,
    routeOrIpcContract: attachment.route,
    requiredServiceOrWorker: [],
    inputTypes: attachment.formats.map((format) => `.${format}`),
    outputTypes: ["durable-message-attachment", "reusable-blob-reference"],
    artifactTypes: attachment.id === "model" ? ["model"] : attachment.id === "image" ? ["image"] : [],
    progressEventContract: "Upload/extraction progress where the format requires server processing.",
    streamingContract: "Large blobs stream to bounded storage; conversation requests carry references rather than whole media.",
    cancellationBehavior: "Client upload abort stops transfer; conversation abort stops consuming tool work.",
    approvalBehavior: "The user's attach action authorizes only the owned conversation blob; model-written paths/URLs are not accepted.",
    followUpContextBehavior: "Durable attachment metadata supports regeneration and recent-attachment follow-ups.",
    restartBehavior: "Stored blobs and durable message pointers survive restart.",
    recoveryBehavior: "Missing/invalid blobs fail explicitly; unsupported formats do not silently coerce.",
    runtimePath: "Composer -> bounded blob route/request parser -> durable chat attachment",
    sourceRefs: [
      sourceAnchor("dashboard/src/lib/chat-attachments.ts", /export type ChatAttachment|export interface Chat/),
      sourceAnchor("dashboard/src/lib/chat-attachments-request.ts", /MAX_ATTACHMENTS/),
      ...attachment.sources.map(([relativePath, matcher]) => sourceAnchor(relativePath, matcher)),
    ],
  });
}

const artifactRendererSource = readSource("dashboard/src/lib/hermes/artifact-types.ts");
const rendererSection = artifactRendererSource.slice(
  artifactRendererSource.indexOf("export type ArtifactRendererId"),
  artifactRendererSource.indexOf("export const ARTIFACT_EVENT_TYPES"),
);
const artifactRendererIds = [...rendererSection.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);

for (const kind of artifactTypes.ARTIFACT_KINDS) {
  add({
    capabilityId: `artifact:${kind}`,
    sourceIdentity: kind,
    displayName: `${kind[0].toUpperCase()}${kind.slice(1)} artifact`,
    category: "artifact-type",
    visibleEntryPoint: "Conversation artifact card and Artifacts archive",
    selectionSemantics: `Typed artifact kind ${kind}; renderer selection remains registry-bound.`,
    routeOrIpcContract: "Scoped /api/hermes/artifacts CRUD, versions, preview, download and edit routes.",
    requiredServiceOrWorker: [],
    inputTypes: ["artifact-create/update/render event"],
    outputTypes: ["versioned-artifact", "preview", "download"],
    artifactTypes: [kind],
    progressEventContract: "artifact.created/rendering/ready/failed/version events are durable and replayable.",
    streamingContract: "Artifact events travel over the owning conversation stream; blob downloads are separate bounded responses.",
    cancellationBehavior: "Owning generation can be aborted; completed artifacts can be explicitly deleted/unpublished.",
    approvalBehavior: "Artifact writes require the owning conversation capability; gadget-bound writes queue approval separately.",
    followUpContextBehavior: "Artifact id, version, provenance and conversation/garden ownership persist across follow-ups.",
    restartBehavior: "SQLite artifact/version/event state survives restart.",
    recoveryBehavior: "Atomic publish/rollback preserves the last valid version; failed renders remain explicit.",
    runtimePath: "Hermes artifact tool -> artifact store -> renderer/preview route",
    sourceRefs: [
      sourceAnchor("dashboard/src/lib/hermes/artifact-types.ts", `"${kind}"`),
      sourceAnchor("dashboard/src/lib/hermes/artifact-store.ts", /export function createArtifact|export async function createArtifact/),
      sourceAnchor("dashboard/src/app/api/hermes/artifacts/route.ts", /export async function GET/),
    ],
  });
}

add({
  capabilityId: "registry:artifact-renderers",
  displayName: "Artifact renderer registry",
  category: "registry",
  visibleEntryPoint: "Artifact preview/open dispatch",
  selectionSemantics: `${artifactRendererIds.length} exact renderer IDs: ${artifactRendererIds.join(", ")}.`,
  routeOrIpcContract: "Renderer id resolves through the authoritative artifact renderer registry.",
  inputTypes: ["artifact-kind", "renderer-id"],
  outputTypes: ["renderer-contract"],
  artifactTypes: [...artifactTypes.ARTIFACT_KINDS],
  cancellationBehavior: "Renderer-specific generation follows owning run cancellation.",
  recoveryBehavior: "Unknown renderer ids fail rather than falling back to an unrelated renderer.",
  runtimePath: "artifact type -> artifact renderer registry -> preview",
  sourceRefs: [
    sourceAnchor("dashboard/src/lib/hermes/artifact-types.ts", /export type ArtifactRendererId/),
    sourceAnchor("dashboard/src/lib/hermes/artifact-renderers.ts", /export function availableArtifactRenderers/),
  ],
});

add({
  capabilityId: "service:quartz",
  sourceIdentity: "quartz-static-site-service",
  displayName: "Quartz prebuilt Garden server",
  category: "registry",
  visibleEntryPoint: "Published Garden page and its hidden view heartbeat",
  selectionSemantics:
    "Opening a published Garden acquires the on-demand prebuilt-output server; publishing itself remains a separate fresh disposable job.",
  routeOrIpcContract:
    "Authenticated Quartz view lease plus loopback static server over the atomically published data-root output.",
  requiredServiceOrWorker: ["Runtime V2 quartz service", "quartz-publish-node worker"],
  inputTypes: ["published Garden navigation", "bounded view heartbeat"],
  outputTypes: ["prebuilt static Garden assets"],
  artifactTypes: ["published-garden"],
  progressEventContract:
    "Serving has an observational service snapshot; compiler progress belongs only to the disposable publisher job.",
  streamingContract: "Static HTTP asset responses; no compiler or watch stream is resident in the serving process.",
  cancellationBehavior:
    "Page hide/navigation releases the view hold; Runtime stops the server after the final lease and bounded idle TTL.",
  approvalBehavior: "Only authenticated Garden publication/view contracts can hold the internal service.",
  followUpContextBehavior: "Published URLs and Quartz AI surface identity remain stable across service restarts.",
  restartBehavior: "The service restarts against the last atomically published output and never rebuilds on startup.",
  recoveryBehavior: "A failed publish preserves the prior public tree; a stopped server is reacquired by the original view.",
  runtimePath: "Published Garden view -> authenticated view lease -> Runtime V2 quartz static service",
  sourceRefs: [
    sourceAnchor("dashboard/scripts/runtime-v2-quartz-static-service.mjs", /startRuntimeV2QuartzStaticService/),
    sourceAnchor("dashboard/src/lib/quartz-view-lease.ts", /export async function renewQuartzViewLease/),
    sourceAnchor("desktop/runtime-v2/manifests/services.json", /"id": "quartz"/),
  ],
});

const composioSourcePath = "dashboard/src/lib/composio/catalog.ts";
const composioSourceText = readSource(composioSourcePath);
const composioFeaturedStart = composioSourceText.indexOf(
  "= [",
  composioSourceText.indexOf("const FEATURED"),
);
const composioFeaturedText = composioSourceText.slice(
  composioFeaturedStart,
  composioSourceText.indexOf("] as const;") + 11,
);
const composioFeatured = [...composioFeaturedText.matchAll(/\{[^{}]+\}/g)]
  .map((match) => ({
    slug: match[0].match(/slug:\s*"([^"]+)"/)?.[1],
    name: match[0].match(/name:\s*"([^"]+)"/)?.[1],
    provider: match[0].match(/legacyProvider:\s*"([^"]+)"/)?.[1],
  }))
  .filter((item) => item.slug && item.name && item.provider);
if (composioFeatured.length !== 8) fail(`expected 8 featured Composio connections, found ${composioFeatured.length}`);

for (const connection of composioFeatured) {
  add({
    capabilityId: `connection:${connection.slug}`,
    sourceIdentity: `composio:${connection.slug}`,
    displayName: connection.name,
    category: "connection",
    visibleEntryPoint: `Settings -> Connections -> ${connection.name}`,
    selectionSemantics: "Connected account capabilities are exposed through the connection broker and selected MCP/tool namespace.",
    routeOrIpcContract: "GET/POST/DELETE /api/hermes/composio plus OAuth callback and integrations catalog.",
    requiredServiceOrWorker: ["connected-apps broker"],
    credentialRequirements: [`${connection.name} OAuth or broker-supported credentials`],
    inputTypes: ["OAuth/connect action", "connection-backed tool request"],
    outputTypes: ["connection-status", "connection-backed tool result"],
    progressEventContract: "Connection setup returns bounded status/errors; tool execution uses the owning turn lifecycle.",
    cancellationBehavior: "OAuth/setup can be abandoned; tool calls follow owning conversation cancellation.",
    approvalBehavior: "Authenticated user initiates OAuth; connection-backed actions retain broker/tool approval semantics.",
    followUpContextBehavior: "Connection identity is user-scoped and reusable across conversations.",
    restartBehavior: "Connected-account records persist; stopped broker state must not hide the connection card.",
    recoveryBehavior: "Missing credentials or broker outage remains a truthful setup/BLOCKED condition.",
    runtimePath: "Connections UI -> Composio API -> connected-apps runtime -> provider",
    sourceRefs: [
      sourceAnchor(composioSourcePath, `slug: "${connection.slug}"`),
      sourceAnchor("dashboard/src/lib/composio/service.ts", /COMPOSIO_RUNTIME_NAME/),
      sourceAnchor("dashboard/src/app/api/hermes/composio/route.ts", /export async function GET/),
    ],
  });
}

for (const connection of [
  {
    id: "spotify-native",
    name: "Spotify native playback connection",
    path: "dashboard/src/lib/spotify-agent/agent.ts",
    route: "Spotify OAuth/Web Playback APIs and first-party playback tools.",
  },
  {
    id: "whatsapp-self",
    name: "WhatsApp self-messaging",
    path: "dashboard/src/lib/whatsapp/service.ts",
    route: "/api/whatsapp/connection and bounded messaging_send to the linked owner account.",
  },
  {
    id: "telegram-self",
    name: "Telegram self-messaging",
    path: "dashboard/src/lib/telegram/service.ts",
    route: "/api/telegram/connection and bounded messaging_send to the linked owner account.",
  },
]) {
  add({
    capabilityId: `connection:${connection.id}`,
    displayName: connection.name,
    category: "connection",
    visibleEntryPoint: "Settings -> Connections and natural-language chat action",
    selectionSemantics: "Only the authenticated owner's linked account/destination is reachable.",
    routeOrIpcContract: connection.route,
    requiredServiceOrWorker: [connection.name],
    credentialRequirements: ["Explicit linked-account credentials"],
    inputTypes: ["connection setup", "bounded action"],
    outputTypes: ["connection status", "action result"],
    cancellationBehavior: "Owning turn cancellation stops pending work where the provider permits it.",
    approvalBehavior: "Account linking is explicit; outbound messaging cannot name an arbitrary recipient.",
    restartBehavior: "Connection state persists; stopped services remain visible and cold-start on use.",
    recoveryBehavior: "Unavailable credentials/service are surfaced and never replaced with another channel.",
    runtimePath: "Connections UI/chat intent -> authenticated service -> linked provider",
    sourceRefs: [
      sourceAnchor(connection.path, /export |function |class /),
      sourceAnchor("dashboard/src/app/api/hermes/tools/messaging/route.ts", /export async function POST/),
    ],
  });
}

const nangoSourcePath = "dashboard/src/lib/nango/catalog.ts";
const nangoSourceText = readSource(nangoSourcePath);
const nangoFeaturedText = nangoSourceText.slice(
  nangoSourceText.indexOf("const FEATURED"),
  nangoSourceText.indexOf("const SCOPES"),
);
const nangoFeaturedCount = [...nangoFeaturedText.matchAll(/\{\s*slug:/g)].length;

for (const catalog of [
  {
    id: "composio",
    name: "Composio dynamic connection catalog",
    count: composioFeatured.length,
    limit: 500,
    path: composioSourcePath,
    matcher: /export async function composioIntegrationCatalog/,
  },
  {
    id: "nango",
    name: "Retained direct-OAuth/Nango catalog",
    count: nangoFeaturedCount,
    limit: null,
    path: nangoSourcePath,
    matcher: /export function nangoIntegrationCatalog/,
  },
  {
    id: "mcp",
    name: "User MCP connection catalog",
    count: null,
    limit: null,
    path: "dashboard/src/lib/hermes/mcp-connections.ts",
    matcher: /export function listMcpConnections/,
  },
]) {
  add({
    capabilityId: `connection-catalog:${catalog.id}`,
    displayName: catalog.name,
    category: "connection-catalog",
    visibleEntryPoint: "Settings -> Connections and slash capability manager",
    selectionSemantics: catalog.count === null
      ? "Dynamic user-scoped entries are represented by their exact schema/source digest, not by reading the real user database."
      : `${catalog.count} featured entries plus a dynamic provider expansion${catalog.limit ? ` capped at ${catalog.limit}` : ""}; source hash is the parity boundary.`,
    routeOrIpcContract: catalog.id === "mcp"
      ? "Local/remote MCP create, enable, reload, OAuth and delete APIs."
      : "Authenticated catalog/connect/callback/remove APIs.",
    requiredServiceOrWorker: catalog.id === "composio" ? ["connected-apps broker"] : [],
    credentialRequirements: ["Per-entry credentials when required"],
    inputTypes: ["catalog query", "connection configuration"],
    outputTypes: ["redacted connection metadata", "tool namespace"],
    cancellationBehavior: "Connection setup may be abandoned; active tool cancellation is conversation-scoped.",
    approvalBehavior: catalog.id === "mcp"
      ? "Local executable connections require explicit approval; remote URLs and secrets are validated/redacted."
      : "OAuth/credential setup requires an authenticated user action.",
    restartBehavior: "Stored connection state reloads after restart; stopped backing services do not remove catalog identity.",
    recoveryBehavior: "Disconnected/unhealthy entries remain visible with truthful status and cannot silently route elsewhere.",
    runtimePath: `${catalog.name} source/store -> authenticated connection API -> selected tool namespace`,
    sourceRefs: [sourceAnchor(catalog.path, catalog.matcher)],
  });
}

const workflowSpecs = [
  {
    id: "learn",
    name: "Garden Learn planning and generation",
    entry: "Garden Learn setup, syllabus, progress and lesson controls",
    route: "Authenticated /api/gardens/[gardenId]/learn plan/generate/confirm/rebuild/status/events/cancel routes",
    services: ["Runtime V2 learn-node disposable worker", "selected model provider"],
    input: ["Garden sources", "optional syllabus", "model and Learn settings"],
    output: ["learning map", "generated lessons", "progress and validation report"],
    artifacts: ["Garden Learn lessons", "learning-map checkpoint"],
    progress: "Existing Learn status DTO and replayable SSE events bridge the Runtime V2 job and its causally bound durable Learn job.",
    cancel: "Authenticated Garden cancellation persists Runtime V2 intent, cancels the exact causally bound Learn job, and removes the disposable worker tree.",
    approval: "Authenticated Garden ownership plus the existing explicit plan/generate/confirm action.",
    restart: "Runtime job receipt, event replay and explicit Runtime-to-Learn binding reconnect the same job after renderer/dashboard restart.",
    recovery: "The fixed internal recovery sweep reconciles abandoned durable Learn checkpoints without inferring ownership from timestamps or repeating uncertain provider work.",
    runtimePath: "Authenticated Learn routes -> causally bound Runtime V2 learn-node job -> fresh sealed Learn worker -> durable checkpoints/events/result; installed Electron and memory evidence NOT RUN",
    sources: [
      ["dashboard/src/app/api/gardens/[gardenId]/learn/plan/route.ts", /executeLearnOperationForRoute/],
      ["dashboard/src/app/api/gardens/[gardenId]/learn/status/route.ts", /export async function GET/],
      ["dashboard/src/app/api/gardens/[gardenId]/learn/events/route.ts", /getRuntimeV2LearnEventCompatibility/],
      ["dashboard/src/app/api/gardens/[gardenId]/learn/cancel/route.ts", /cancelRuntimeV2LearnOperation/],
      ["dashboard/src/lib/learn-operation-runtime-v2.ts", /export async function executeLearnOperationForRoute/],
    ],
  },
  {
    id: "ingestion",
    name: "Garden source ingestion",
    entry: "Garden Add source/upload controls",
    route: "POST /api/ingest SSE",
    services: ["document extractors", "optional Anydoc/VLM/Quartz parser"],
    input: ["PDF", "CSV", "DOCX", "PPTX", "XLSX", "ZIP", "text", "supported Anydoc formats"],
    output: ["Garden source Markdown", "figures", "source PDF", "semantic index"],
    artifacts: ["garden-source"],
    progress: "SSE progress, usage, result, error and DONE frames bridge the causally bound Runtime job.",
    cancel: "Client disconnect cancels the exact Runtime job; private staging cleanup, lease release, and owned-tree reaping are bounded.",
    approval: "Authenticated Garden ownership and explicit upload action.",
    restart: "Original staging, Runtime events, and committed Garden/index data persist; incomplete work is reconciled through the exact fenced job.",
    recovery: "Duplicate filename/content and partial extraction paths are explicit; fenced staged promotion prevents a partial Garden commit.",
    runtimePath: "POST /api/ingest -> authenticated Runtime V2 document-ingestion-node job -> private bounded staging -> fenced Garden/index promotion; installed Electron and memory evidence NOT RUN",
    sources: [
      ["dashboard/src/app/api/ingest/route.ts", /export async function POST/],
      ["dashboard/src/lib/ingest-upload.ts", /DEFAULT_MAX_UPLOAD_BYTES/],
      ["dashboard/src/lib/anydoc/formats.ts", /export type AnydocFormat/],
    ],
  },
  {
    id: "document-skills",
    name: "Document-to-skill build and reading",
    entry: "Document attachment/Garden document -> Build skill; slash command and document_skill_read",
    route: "POST /api/document-skills/build; GET/DELETE /api/document-skills; internal document-skill tool",
    services: ["selected model", "document extraction"],
    input: ["document attachment", "Garden document"],
    output: ["versioned document skill", "chapter/index reads"],
    artifacts: ["document-skill"],
    progress: "Streaming build stages continue server-side if the browser disconnects.",
    cancel: "No destructive implicit cancel; explicit retry/delete is user-scoped.",
    approval: "Explicit build action; reads are user/session scoped.",
    restart: "Hash-keyed building/ready/failed state and contained files persist.",
    recovery: "Failed builds can retry; completed hashes are reused without claiming a missing result.",
    runtimePath: "Document-skill routes -> authenticated Runtime V2 office-artifact-node job -> fresh sealed document bridge/validator tree -> versioned skill result; installed OfficeCLI tree and memory evidence NOT RUN",
    sources: [
      ["dashboard/src/lib/document-skills/store.ts", /export function claimDocumentSkillBuild/],
      ["dashboard/src/app/api/document-skills/build/route.ts", /export async function POST/],
      ["dashboard/src/app/api/hermes/tools/document-skill/route.ts", /export async function POST/],
    ],
  },
  {
    id: "document-editing",
    name: "Document editing and PDF conversion",
    entry: "Attached/open document and document artifact editor",
    route: "Internal document_edit/pdf_to_docx tool plus artifact edit/version routes",
    services: ["document processing runtime"],
    input: ["DOCX", "XLSX", "PPTX", "PDF", "anchored patches"],
    output: ["edited OOXML", "converted DOCX", "artifact version"],
    artifacts: ["document", "pdf", "presentation", "spreadsheet"],
    progress: "Tool lifecycle plus artifact version/render events.",
    cancel: "Owning conversation abort stops active processing; committed versions remain immutable.",
    approval: "User-owned attachment/workspace and capability token; edits cannot escape the authorized file tuple.",
    restart: "Artifact versions and source history persist.",
    recovery: "Expected-version checks prevent lost updates; rollback restores a prior valid version.",
    runtimePath: "Document tool/edit routes -> authenticated Runtime V2 office-artifact-node job -> no-auto-resident OfficeCLI tree -> atomic artifact version; installed OfficeCLI tree and memory evidence NOT RUN",
    sources: [
      ["dashboard/src/app/api/hermes/tools/document/route.ts", /const TOOLS/],
      ["dashboard/src/lib/hermes/artifact-store.ts", /rollback/],
      ["dashboard/src/app/api/hermes/artifacts/[artifactId]/edit/route.ts", /export async function PUT/],
    ],
  },
  {
    id: "image-generation",
    name: "Image generation, editing and upload",
    entry: "Artifact image studio and chat image-generation tool",
    route: "POST /api/hermes/artifacts/images operations generate/edit/upload/comfyui",
    services: ["selected image provider or ComfyUI"],
    input: ["prompt", "PNG/JPEG/WebP reference", "ComfyUI request"],
    output: ["image artifact", "provider item metadata"],
    artifacts: ["image"],
    progress: "Provider streaming item events and artifact lifecycle events.",
    cancel: "Owning request/run abort; provider cancellation where supported.",
    approval: "Authenticated artifact ownership and explicit operation.",
    restart: "Completed image artifact/version persists; in-flight provider calls require honest interruption classification.",
    recovery: "Partial provider output may be captured explicitly; no deterministic substitute may count as parity.",
    runtimePath: "Image operations -> provider HTTP branch or leased Runtime V2 ComfyUI service; browser regeneration -> generated-visual-browser-node disposable job; installed Electron/provider/browser memory evidence NOT RUN",
    sources: [
      ["dashboard/src/app/api/hermes/artifacts/images/route.ts", /export async function POST/],
      ["dashboard/src/lib/hermes/artifact-image-service.ts", /export async function generateArtifactImage/],
    ],
  },
  {
    id: "image-search",
    name: "Public image search",
    entry: "Natural-language image request in authenticated chat",
    route: "Internal POST /api/hermes/tools/image-search",
    services: ["vendored Google image-search MCP/runtime"],
    input: ["query", "bounded count"],
    output: ["image links and display metadata"],
    artifacts: [],
    progress: "imageSearch.tool_completed/tool_failed events.",
    cancel: "Finite tool follows conversation abort.",
    approval: "Read-only public index query authorized by the turn capability.",
    restart: "No durable private state; result evidence remains in the transcript.",
    recovery: "Unavailable/unconfigured/launch/upstream failures retain distinct truthful errors.",
    runtimePath: "Image-search tool route -> authenticated Runtime V2 image-search-node job -> fixed vendored search runtime -> bounded links/result; installed Electron and memory evidence NOT RUN",
    sources: [
      ["dashboard/src/app/api/hermes/tools/image-search/route.ts", /export async function POST/],
      ["dashboard/src/lib/hermes/image-search-service.ts", /MAX_COUNT/],
    ],
  },
  {
    id: "image-to-3d",
    name: "Image-to-3D reconstruction",
    entry: "Image attachment plus 3D reconstruction request or /image-to-3d",
    route: "Internal POST /api/hermes/tools/image-to-3d",
    services: ["Stable Fast 3D"],
    input: ["owned image attachment"],
    output: ["GLB/model artifact"],
    artifacts: ["model"],
    progress: "image_to_3d reconstruction_started/completed/failed events.",
    cancel: "Conversation abort propagates to reconstruction work.",
    approval: "Tool can name only an image already attached to the owned conversation.",
    restart: "Completed model artifact persists; active reconstruction needs Runtime V2 interruption evidence.",
    recovery: "Missing image/runtime fails explicitly and automatic selection falls back only to an ordinary answer, never a fake model.",
    runtimePath: "Image-to-3D route -> authenticated Runtime V2 sf3d-node job -> one sealed owned image -> bounded GLB artifact; installed GPU/Electron and memory evidence NOT RUN",
    sources: [
      ["dashboard/src/app/api/hermes/tools/image-to-3d/route.ts", /export async function POST/],
      ["dashboard/src/lib/sf3d/artifact.ts", /IMAGE_TO_3D_TOOL/],
    ],
  },
  {
    id: "audio-analysis",
    name: "Audio analysis and comparison",
    entry: "Audio attachment and natural-language analysis request",
    route: "Internal POST /api/hermes/tools/audio",
    services: ["local Rust audio-analyzer"],
    input: ["owned audio attachment", "bounded analysis options"],
    output: ["waveform/music analysis", "comparison result"],
    artifacts: [],
    progress: "audio analysis/comparison started/completed/failed events.",
    cancel: "Conversation abort stops the local analysis process.",
    approval: "Only owned attachment names resolve; model-written paths are rejected.",
    restart: "Result remains in the transcript; the fenced Runtime job result reconnects after Dashboard restart.",
    recovery: "Unavailable/timeout/file errors remain typed and never become a fabricated analysis.",
    runtimePath: "Audio tool route -> authenticated Runtime V2 audio-analyzer-node job -> fixed finite MCP/analyzer tree -> bounded result; installed Electron and memory evidence NOT RUN",
    sources: [
      ["dashboard/src/app/api/hermes/tools/audio/route.ts", /export async function POST/],
      ["dashboard/src/lib/audio-analyzer/service.ts", /MAX_TIME_SECONDS/],
    ],
  },
  {
    id: "watch-video",
    name: "Watch video analysis",
    entry: "Terminal video attachment/URL or /watch",
    route: "Internal POST /api/hermes/tools/watch",
    services: ["Watch runtime", "ffmpeg"],
    input: ["owned video attachment", "validated video URL", "bounded options"],
    output: ["video analysis", "screenshots/derived media when requested"],
    artifacts: ["image", "video", "markdown"],
    progress: "Watch tool lifecycle/progress events on the conversation stream.",
    cancel: "Conversation abort stops Watch and its process tree.",
    approval: "Terminal-only capability; URL and workspace containment are server-owned.",
    restart: "Completed artifacts persist; the exact Runtime job is replayed or classified interrupted/uncertain after restart.",
    recovery: "Unavailable runtime/ffmpeg preserves the ordinary-turn fallback without claiming video analysis.",
    runtimePath: "Watch tool route -> authenticated Runtime V2 watch-node job -> fixed sealed Watch/ffmpeg tree -> bounded artifacts/result; installed Electron and memory evidence NOT RUN",
    sources: [
      ["dashboard/src/app/api/hermes/tools/watch/route.ts", /export async function POST/],
      ["dashboard/src/lib/hermes/watch-intent.ts", /export function watchCommandText/],
    ],
  },
  {
    id: "loopx",
    name: "LoopX post-turn continuation planning",
    entry: "Automatic post-turn hook for an opted-in conversation with a LoopX goal",
    route: "Persisted Hermes turn hook -> conversation-scoped Runtime V2 loopx-tick job",
    services: ["Runtime V2 loopx-node disposable worker"],
    input: ["persisted conversation turn", "conversation-scoped LoopX goal and snapshot"],
    output: ["durable LoopX goal state", "bounded continuation snapshot"],
    artifacts: ["LoopX conversation snapshot"],
    progress: "Durable Runtime job events and loopx.tick_failed audit events; no detached Next timer owns the work.",
    cancel: "Authenticated exact-job cancellation propagates through every attached LoopX Python child before Rust reaps the job tree.",
    approval: "ENABLE_LOOPX opt-in and authenticated conversation ownership are required; no renderer-selected executable or path is accepted.",
    restart: "The deterministic conversation-and-turn idempotency key reconnects or replays the same durable Runtime job after Dashboard restart.",
    recovery: "Durable goal and snapshot files remain conversation-scoped; an uncertain active tick is reconciled by Runtime without a Next-owned fallback.",
    runtimePath: "Persisted Hermes turn -> scheduleLoopxTickForConversation -> deterministic loopx-tick Runtime job -> fresh loopx-node worker -> bounded durable snapshot",
    sources: [
      ["dashboard/src/lib/loopx/conversation-tick.ts", /export function scheduleLoopxTickForConversation/],
      ["dashboard/src/lib/loopx/tick.ts", /export async function runLoopxTick/],
      ["dashboard/src/lib/runtime-v2/loopx-tick-job.ts", /export async function runLoopxTickViaRuntime/],
    ],
  },
  {
    id: "parametric-cad",
    name: "Parametric CAD",
    entry: "Agents tab /agents:parametric-cad and CAD artifact controls",
    route: "POST /api/cad/runs; SSE events; abort; parameter rebuild; tuple-scoped file reads",
    services: ["CadQuery or SolidWorks backend"],
    input: ["CAD brief", "parameters", "board/enclosure data"],
    output: ["validated immutable CAD revision", "exports", "report"],
    artifacts: ["model", "parametric-cad"],
    progress: "Replayable Runtime job/CAD run events plus durable revision/artifact events.",
    cancel: "POST CAD abort cancels the exact Runtime V2 worker and releases only the dependencies selected by the canonical request.",
    approval: "User/garden ownership and validated parameter/file tuple; backend selection is registry-bound.",
    restart: "Projects, revisions, artifacts, Runtime descriptors, and fenced events reconnect after Dashboard restart.",
    recovery: "The last validated revision survives; an interrupted or uncertain worker is classified without blindly applying a parameter update twice.",
    runtimePath: "CAD routes -> authenticated Runtime V2 outer-parametric-cad-node job -> request-derived ChatMock/CAD leases -> fresh sealed CAD worker -> immutable revision; installed CAD/Electron and memory evidence NOT RUN",
    sources: [
      ["dashboard/src/lib/cad/types.ts", /export type CadExportFormat/],
      ["dashboard/src/lib/cad/run-manager.ts", /Runs are ephemeral/],
      ["dashboard/src/app/api/cad/runs/route.ts", /export async function POST/],
    ],
  },
  {
    id: "agent-browser",
    name: "Browser automation",
    entry: "Agents tab /agents:agent-browser",
    route: "Agent Browser agent/run/events/approval/abort APIs",
    services: ["Chrome or Edge", "agent-browser/OpenCLI runtime"],
    input: ["browser task", "shared signed-in profile", "approval decisions"],
    output: ["browser run card", "screenshots", "action/result transcript"],
    artifacts: ["image"],
    progress: "SSE/JSON event replay with cursor and awaiting_approval state bridges the causally bound Runtime worker.",
    cancel: "Explicit run abort cancels the exact Runtime worker and terminates its owned browser/action tree.",
    approval: "Sensitive browser actions pause in awaiting_approval for approve/reject.",
    restart: "Runtime descriptors/events and browser profile artifacts persist; interrupted work is fenced rather than resumed blindly.",
    recovery: "Ordinary run trees and the separate profile sign-in window are Runtime-owned and fenced; neither is resumed blindly after interruption.",
    runtimePath: "Agent Browser run routes -> authenticated Runtime V2 outer-agent-browser-node job -> fresh contained Chromium/action tree; explicit profile actions -> separate agent-browser-profile-node job -> attached sign-in Chromium tree; installed memory evidence NOT RUN",
    sources: [
      ["dashboard/src/lib/agent-browser/schema.ts", /runs\/events\/screenshots/],
      ["dashboard/src/lib/agent-browser/run-manager.ts", /Runs are ephemeral/],
      ["dashboard/src/app/api/agent-browser/agents/[agentId]/runs/route.ts", /export async function POST/],
    ],
  },
  {
    id: "research",
    name: "Coverage-driven research",
    entry: "Super Agent exhaustive research intent",
    route: "Internal research_begin/research_record/research_status tools",
    services: ["selected model", "web retrieval"],
    input: ["research intent", "fields", "budgets", "evidence records"],
    output: ["coverage matrix", "cited synthesis", "gaps/conflicts"],
    artifacts: ["markdown", "data"],
    progress: "Explicit research phase, budget, coverage, gap and stopping-state updates.",
    cancel: "Owning conversation cancellation stops orchestration.",
    approval: "Super Agent capability decision is required; external actions retain their own gates.",
    restart: "Research state is deliberately globalThis/in-memory today and is lost on process restart.",
    recovery: "Current loss-on-restart policy is recorded as a known parity gap; no stale ledger is synthesized.",
    runtimePath: "Authenticated research tools -> bounded in-process coverage ledger and selected model/web providers; intentionally no child process launch, while durable restart parity remains pending",
    sources: [
      ["dashboard/src/lib/research/types.ts", /export interface ResearchSessionState/],
      ["dashboard/src/lib/research/store.ts", /Deliberately not in SQLite/],
      ["dashboard/src/app/api/hermes/tools/research/route.ts", /export async function POST/],
    ],
  },
  {
    id: "semantic-retrieval",
    name: "Garden semantic/GraphRAG retrieval",
    entry: "Garden search/context tools and grounded chat",
    route: "garden_search and retrieval helpers over FTS/embeddings/graph",
    services: ["optional local ChatMock embeddings"],
    input: ["query", "garden/page scope", "retrieval limits"],
    output: ["ranked chunks", "source citations", "graph neighbors"],
    artifacts: [],
    progress: "Finite retrieval tool lifecycle.",
    cancel: "Finite reads stop with the owning turn.",
    approval: "Read-only and garden ownership/capability-token scoped.",
    restart: "FTS/vector indexes and source records persist/rebuild incrementally.",
    recovery: "Embedding failure falls back to lexical retrieval explicitly; source/citation identity is preserved.",
    runtimePath: "Garden retrieval helpers -> bounded Dashboard query -> leased mandatory GBrain and optional Runtime V2 Mem0/ChatMock dependencies -> ranked grounded result; installed model-memory evidence NOT RUN",
    sources: [
      ["dashboard/src/lib/semantic-retrieval.ts", /export async function retrieveGraphRag/],
      ["dashboard/src/lib/hermes/garden-tools.ts", /garden_search/],
    ],
  },
  {
    id: "colpali-visual-retrieval",
    name: "ColPali visual-page retrieval",
    entry: "Document question where a usable visual index exists",
    route: "Document attachment rewrite to selected text plus relevant page images",
    services: ["ColPali"],
    input: ["indexed document", "query"],
    output: ["selected page text", "page images"],
    artifacts: ["image"],
    progress: "Bounded retrieval lifecycle.",
    cancel: "Owning turn cancellation stops retrieval.",
    approval: "User-owned document only.",
    restart: "Usable visual index persists; stopped ColPali must not hide document capability.",
    recovery: "No usable index leaves the original document path intact; no fabricated visual result.",
    runtimePath: "Document retrieval -> leased Runtime V2 ColPali service plus registered office-artifact page rendering when needed -> bounded page evidence; installed model/Office memory evidence NOT RUN",
    sources: [["dashboard/src/lib/colpali/retrieval.ts", /export async function/]],
  },
  {
    id: "quartz-publishing",
    name: "Quartz Garden publishing",
    entry: "Garden/document/artifact mutations that publish the static Garden",
    route: "publishQuartzAfterMutation to authenticated user-global Runtime V2 job",
    services: ["Runtime V2 quartz-publish-node worker", "Quartz compiler"],
    input: ["Garden mutation reason", "Quartz content tree"],
    output: ["published static Garden"],
    artifacts: ["published-garden"],
    progress: "The compatibility caller preserves awaited/background behavior while the durable Runtime job records bounded progress.",
    cancel: "Runtime V2 stop/shutdown aborts the compiler and reaps its complete owned tree without publishing a partial stage.",
    approval: "The originating authenticated mutation submits exact user-global authority; garden identifiers are non-authoritative payload only.",
    restart: "Every attempt is a fresh disposable worker; active state and terminal output are durable Runtime V2 records.",
    recovery: "A fenced stage/public/previous transaction either promotes a complete build or restores the prior public tree; ingestion retries publication only after its garden/result commit is sealed.",
    runtimePath: "Garden mutation -> authenticated user-global Runtime V2 quartz-publish-node job -> fresh contained Quartz/esbuild tree -> fenced stage/public/previous promotion; installed compiler memory evidence NOT RUN",
    sources: [
      ["dashboard/src/lib/quartz-publish.ts", /export async function publishQuartzAfterMutation/],
      ["dashboard/scripts/runtime-v2-quartz-publish-worker.mjs", /runRuntimeV2QuartzPublishWorker/],
      ["dashboard/scripts/runtime-v2-quartz-publish-executor.mjs", /createSealedRuntimeV2QuartzPublishExecutor/],
    ],
  },
  {
    id: "scriberr-transcription",
    name: "Garden video transcription",
    entry: "Garden video transcription upload/YouTube controls",
    route: "Video transcription list/create/detail/retry/cancel/inspect APIs",
    services: ["Scriberr", "ffmpeg/ffprobe", "yt-dlp for YouTube"],
    input: ["video upload", "YouTube URL"],
    output: ["speaker-aware transcript Markdown", "indexed Garden source"],
    artifacts: ["markdown", "garden-source"],
    progress: "13 durable SQLite states with heartbeat and checkpoint metadata.",
    cancel: "Dedicated cancel route persists cancellation and stops active stage work.",
    approval: "Authenticated Garden owner explicitly queues transcription.",
    restart: "Stale jobs recover from Scriberr/checkpoint state after server restart.",
    recovery: "Retry resumes from the last valid checkpoint or requeues from source; terminal states remain terminal.",
    runtimePath: "Garden transcription routes -> authenticated Runtime V2 scriberr-node job -> leased Scriberr plus fixed yt-dlp/ffmpeg leaves -> fenced transcript and ingestion; installed media-tree memory evidence NOT RUN",
    sources: [
      ["dashboard/src/lib/scriberr/types.ts", /export type VideoTranscriptionJobStatus/],
      ["dashboard/src/lib/scriberr/job-runner.ts", /recoverStaleJobs/],
      ["dashboard/src/app/api/gardens/[gardenId]/video-transcriptions/route.ts", /export async function POST/],
    ],
  },
  {
    id: "speech-transcription",
    name: "Recording speech transcription",
    entry: "Voice/recording upload in chat",
    route: "POST /api/speech/transcribe and streamed /api/speech/transcribe-upload",
    services: ["Voicebox", "Runtime V2 speech-media-node with fixed ffmpeg"],
    input: ["recorded audio"],
    output: ["transcript text"],
    artifacts: [],
    progress: "Segment/model-download/transcription progress; Voicebox may return 202 while loading a model.",
    cancel: "Upload/transcription request cancellation is propagated.",
    approval: "Explicit recording/upload action.",
    restart: "Every recording segmentation is a fresh durable Runtime job with a fenced checkpoint/result; Voicebox is reacquired separately on demand.",
    recovery: "Partial segment work is not presented as a completed transcript; an interrupted caller retries a fresh exact scoped media job.",
    runtimePath: "Speech upload -> authenticated Runtime V2 speech-media-node job for fixed segmentation/ffmpeg leaves plus separately leased Voicebox transcription -> fenced transcript; installed media/model memory evidence NOT RUN",
    sources: [
      ["dashboard/src/lib/speech/recording-transcription.ts", /export async function/],
      ["dashboard/src/lib/runtime-v2/speech-media-job.ts", /export async function segmentRecordingViaRuntime/],
      ["dashboard/scripts/runtime-v2-speech-media-worker.mjs", /loadRuntimeV2SpeechMediaLaunch/],
      ["dashboard/scripts/runtime-v2-speech-media-executor.mjs", /export async function executeSpeechMedia/],
      ["desktop/runtime-v2/manifests/workers.json", /"kind": "speech-media-node"/],
      ["dashboard/src/app/api/speech/transcribe/route.ts", /export async function POST/],
      ["dashboard/src/app/api/speech/transcribe-upload/route.ts", /export async function POST/],
    ],
  },
  {
    id: "meeting-notes-transcription",
    name: "Meeting Notes transcription",
    entry: "Agents tab /agents:meeting-notes and meeting upload",
    route: "Meeting Notes upload/run APIs with Scriberr preferred and Voicebox fallback",
    services: ["Scriberr or Voicebox", "ffmpeg"],
    input: ["meeting audio/video"],
    output: ["speaker-aware meeting notes", "transcript"],
    artifacts: ["markdown", "document"],
    progress: "Upload/transcription/formatting run events.",
    cancel: "Run cancellation and scratch Scriberr job cleanup.",
    approval: "Explicit agent launch/upload action.",
    restart: "Runtime descriptor/events and the output artifact persist; request-derived Scriberr or Voicebox leases are reacquired only for the exact attempt.",
    recovery: "Engine fallback is declared and must remain visible in evidence; fallback output cannot be counted as the preferred-engine pass.",
    runtimePath: "Meeting Notes routes -> authenticated Runtime V2 outer-meeting-notes-node job -> request-derived Scriberr/Voicebox/ChatMock leases plus contained ffmpeg -> durable notes artifact; installed Electron/model memory evidence NOT RUN",
    sources: [
      ["dashboard/src/lib/meeting-notes/transcribe.ts", /Scriberr/],
      ["dashboard/src/app/api/meeting-notes/uploads/route.ts", /export async function POST/],
    ],
  },
  {
    id: "memory",
    name: "Conversation and durable memory",
    entry: "Automatic conversation context, explicit remember/forget, Settings -> Memory",
    route: "Conversation memory bundle plus profile/durable/tree APIs and memory tools",
    services: ["optional Mem0 embeddings"],
    input: ["user-authored conversation evidence", "explicit memory instruction"],
    output: ["working state", "candidate/confirmed memory", "profile", "memory tree"],
    artifacts: ["memory-export"],
    progress: "Profile/tree generation status and ordinary tool lifecycle.",
    cancel: "Generation can end with explicit error; user can clear conversation state/profile/durable rows.",
    approval: "save_memory only on authenticated conversational surfaces; secrets/opt-out/temporary chats are excluded.",
    restart: "Durable rows/profile/tree persist; derived indexes are rebuildable.",
    recovery: "State/policy is rechecked after hybrid retrieval; changed keys supersede rather than duplicate.",
    runtimePath: "Conversation memory APIs -> durable Dashboard stores plus leased Runtime V2 Mem0 semantic engine and mandatory GBrain/ChatMock dependencies as selected -> bounded context; installed model memory evidence NOT RUN",
    sources: [
      ["dashboard/src/lib/conversations/memory.ts", /export type DurableMemoryState/],
      ["dashboard/src/lib/conversations/memory-profile.ts", /export type MemoryProfileStatus/],
      ["dashboard/src/lib/mem0/retrieval.ts", /export function|export async function/],
    ],
  },
  {
    id: "artifact-lifecycle",
    name: "Artifact lifecycle and revisions",
    entry: "Inline artifact cards, artifact panel/archive and editor",
    route: "Scoped artifacts CRUD/version/preview/download/edit/image APIs",
    services: ["renderer-specific workers when needed"],
    input: ["artifact create/update/import/render/finalize/fork/delete"],
    output: ["durable artifact", "versions", "preview", "download", "Garden publication"],
    artifacts: [...artifactTypes.ARTIFACT_KINDS],
    progress: "Durable artifact and specialized visualizer/gadget lifecycle events.",
    cancel: "Generation cancellation; explicit delete/unpublish; rollback for versions.",
    approval: "Conversation/garden ownership and capability token; gadget actions add separate approval.",
    restart: "Artifact/version/event/provenance tables survive restart.",
    recovery: "Atomic validated publish and rollback preserve prior valid state.",
    runtimePath: "Artifact CRUD/version routes -> durable artifact store -> exact registered Runtime V2 renderer leaf (Office, visual browser, Manim, watermark, or interactive visualizer) only when required; installed renderer memory evidence NOT RUN",
    sources: [
      ["dashboard/src/lib/hermes/artifact-store.ts", /export function|export async function/],
      ["dashboard/src/lib/hermes/artifact-schema.ts", /CREATE TABLE IF NOT EXISTS hermes_artifacts/],
      ["dashboard/src/app/api/hermes/artifacts/route.ts", /export async function GET/],
    ],
  },
  {
    id: "garden-mutations",
    name: "Garden read, proposal, structure and publishing workflow",
    entry: "Garden workspace/chat/documents/settings/import/export",
    route: "Garden tools and authenticated document/settings/transfer APIs",
    services: ["dashboard", "optional Quartz publisher"],
    input: ["Garden read", "note proposal", "page revision", "folder move/create/rename/delete", "archive import/export"],
    output: ["Garden pages", "proposals", "published site", "transfer archive"],
    artifacts: ["garden-page", "published-garden", "garden-archive"],
    progress: "Proposal validation and publish/transfer lifecycle.",
    cancel: "Owning turn abort; destructive folder deletion requires explicit user intent.",
    approval: "Ownership is mandatory; Quartz only proposes, Garden may perform documented direct/reversible structure writes.",
    restart: "Garden/database/files persist; Quartz publication is a durable user-global Runtime job with replayable terminal state.",
    recovery: "Version/source history and transfer validation protect stored content.",
    runtimePath: "Authenticated Garden mutation -> durable Dashboard commit -> registered Runtime V2 quartz-publish-node job when publication is required; installed Electron/compiler memory evidence NOT RUN",
    sources: [
      ["dashboard/src/lib/hermes/garden-tools.ts", /export async function|export function/],
      ["dashboard/src/app/api/gardens/[gardenId]/settings/route.ts", /export async function PATCH/],
      ["dashboard/src/app/api/transfer/garden/[gardenSlug]/route.ts", /export async function GET/],
    ],
  },
  {
    id: "gadget-actions",
    name: "Generated gadgets and approved actions",
    entry: "Chat-generated gadget artifact and gadget host UI",
    route: "Gadget generate/revise tools; host/action approval/revert/retry APIs",
    services: ["sandboxed gadget renderer"],
    input: ["gadget request", "manifest/package", "binding action"],
    output: ["gadget artifact", "durable action", "observation"],
    artifacts: ["gadget"],
    progress: "Gadget build and action pending/approved/applied/rejected/failed/reverted events.",
    cancel: "Owning generation abort; pending actions can be rejected; applied reversible actions can be reverted.",
    approval: "Every binding mutation is queued and requires approval unless a narrowly stored auto-approval applies.",
    restart: "Gadgets/actions/observations/storage persist in SQLite.",
    recovery: "Retry/revert operates on durable action state with reauthorization on every host call.",
    runtimePath: "Gadget tool/host APIs -> durable approval/action store -> exact registered renderer or provider path when needed; no generic artifact process owner; installed renderer memory evidence NOT RUN",
    sources: [
      ["dashboard/src/lib/hermes/gadget-types.ts", /export type GadgetActionStatus/],
      ["dashboard/src/lib/hermes/gadget-schema.ts", /CREATE TABLE/],
      ["dashboard/src/app/api/hermes/gadgets/[artifactId]/actions/[actionId]/route.ts", /export async function POST/],
    ],
  },
];

for (const workflow of workflowSpecs) {
  if (!workflow.runtimePath) {
    throw new Error(`Workflow ${workflow.id} must declare an explicit current runtimePath.`);
  }
  add({
    capabilityId: `workflow:${workflow.id}`,
    displayName: workflow.name,
    category: "workflow",
    visibleEntryPoint: workflow.entry,
    selectionSemantics: `The same visible action/intent must continue to select ${workflow.name}; no unrelated fallback may count as success.`,
    routeOrIpcContract: workflow.route,
    requiredServiceOrWorker: workflow.services,
    inputTypes: workflow.input,
    outputTypes: workflow.output,
    artifactTypes: workflow.artifacts,
    progressEventContract: workflow.progress,
    streamingContract: workflow.progress.toLowerCase().includes("sse") || workflow.progress.toLowerCase().includes("stream")
      ? "Existing streaming/event order is part of the parity contract."
      : "Finite result or owning conversation event stream as documented.",
    cancellationBehavior: workflow.cancel,
    approvalBehavior: workflow.approval,
    followUpContextBehavior: "Conversation, Garden, source, job and artifact identifiers remain bound across follow-ups.",
    restartBehavior: workflow.restart,
    recoveryBehavior: workflow.recovery,
    runtimePath: workflow.runtimePath,
    sourceRefs: workflow.sources.map(([relativePath, matcher]) => sourceAnchor(relativePath, matcher)),
  });
}

const approvalSpecs = [
  {
    id: "filesystem-grants",
    name: "Filesystem path grants",
    behavior: "Canonical-directory grants cover read/create/modify/move/delete/execute with remembered or one-time scope; symlink escape is denied.",
    route: "GET/POST/DELETE /api/hermes/filesystem-grants",
    sources: [
      ["dashboard/src/lib/hermes/filesystem-paths.ts", /export type FilesystemOperation/],
      ["dashboard/src/lib/hermes/filesystem-grants.ts", /export function authorizeFilesystemPath/],
      ["dashboard/src/app/api/hermes/filesystem-grants/route.ts", /export async function POST/],
    ],
  },
  {
    id: "runtime-permission",
    name: "Runtime permission prompt",
    behavior: "A pending runtime request accepts once, always, or reject exactly once and remains user/session owned.",
    route: "POST /api/hermes/permissions/[requestId]",
    sources: [["dashboard/src/app/api/hermes/permissions/[requestId]/route.ts", /const DECISIONS/]],
  },
  {
    id: "capability-token",
    name: "Signed capability-token boundary",
    behavior: "Signed expiring token binds session/user/surface/garden/tool scope; tool routes revalidate it at the data boundary.",
    route: "Internal bearer capability token on Hermes tool routes",
    sources: [
      ["dashboard/src/lib/hermes/capability-token.ts", /export interface CapabilityTokenScope/],
      ["dashboard/src/lib/hermes/capability-broker.ts", /export interface CapabilityBrokerInput/],
    ],
  },
  {
    id: "agent-launch",
    name: "Model-initiated agent launch approval",
    behavior: "Only launchable registry profiles may be queued, one per turn; profiles marked requiresLaunchApproval require explicit approval.",
    route: "POST /api/hermes/tools/agent-launch",
    sources: [
      ["dashboard/src/app/api/hermes/tools/agent-launch/route.ts", /export async function POST/],
      ["dashboard/src/lib/hermes/capability-combinations.ts", /requiresLaunchApproval/],
    ],
  },
  {
    id: "gadget-action",
    name: "Gadget action approval/revert",
    behavior: "Pending gadget actions support approve/reject/revert/retry with durable status and per-host reauthorization.",
    route: "POST gadget action decision and host bridge routes",
    sources: [
      ["dashboard/src/lib/hermes/gadget-types.ts", /export type GadgetActionStatus/],
      ["dashboard/src/app/api/hermes/gadgets/[artifactId]/actions/[actionId]/route.ts", /export async function POST/],
    ],
  },
  {
    id: "browser-action",
    name: "Browser sensitive-action approval",
    behavior: "The run pauses in awaiting_approval and continues only after approve/reject for the same user-owned run.",
    route: "Agent Browser approval route and SSE approval event",
    sources: [["dashboard/src/lib/agent-browser/run-manager.ts", /awaiting_approval/]],
  },
  {
    id: "agent-tars-action",
    name: "Agent TARS sensitive-action approval",
    behavior: "A user-owned UI-TARS run pauses for the exact action id and only the matching authenticated approve/reject route may resume it.",
    route: "POST /api/ui-tars/agents/[agentId]/runs/[runId]/{approve,reject}",
    sources: [
      ["dashboard/src/lib/ui-tars/service.ts", /decision: "approve" \| "reject"/],
      ["ui-tars-adapter/src/server.ts", /POST \/runs\/:id\/\{approve,reject,abort\}/],
    ],
  },
  {
    id: "recall-control",
    name: "Recall capture control approval",
    behavior: "Recall reads honor agentAccess immediately; start/stop capture asks unless the user stored always-allow.",
    route: "Internal recall_control tool",
    sources: [["dashboard/src/lib/hermes/tool-scopes.ts", /export const RECALL_TOOLS/]],
  },
];

for (const approval of approvalSpecs) {
  add({
    capabilityId: `approval:${approval.id}`,
    displayName: approval.name,
    category: "approval",
    visibleEntryPoint: "Contextual approval prompt or Settings permission control",
    selectionSemantics: approval.behavior,
    routeOrIpcContract: approval.route,
    inputTypes: ["pending request", "approve/reject decision"],
    outputTypes: ["bounded grant or rejection", "audit state"],
    progressEventContract: "Pending/decision/applied or rejected lifecycle remains visible to the owning UI.",
    cancellationBehavior: "Reject/cancel leaves no widened grant; one-time grants expire after use/turn.",
    approvalBehavior: approval.behavior,
    followUpContextBehavior: "Remembered grants remain scoped to their canonical subject; one-time grants do not leak to later turns.",
    restartBehavior: approval.id === "browser-action"
      ? "Browser approval state is currently in-memory and is a documented recovery gap."
      : "Durable approval/grant records reload with ownership and expiry checks.",
    recoveryBehavior: "Lost live frames are recovered only from durable pending state; otherwise the operation ends without implied approval.",
    runtimePath: approval.route,
    sourceRefs: approval.sources.map(([relativePath, matcher]) => sourceAnchor(relativePath, matcher)),
  });
}

const recoverySpecs = [
  {
    id: "durable-runtime-jobs",
    name: "Runtime V2 durable job lifecycle",
    behavior: "The native JobStore persists identity, authority, attempts, fencing, events, cancellation intent, terminal classification, and verified completion before an owned tree is released.",
    status: "DURABLE_SOURCE_CONTRACT",
    sources: [
      ["native/runtime-core/src/store.rs", /pub struct JobStore/],
      ["native/runtime-core/src/process_owner.rs", /WorkerCompletionProof/],
    ],
  },
  {
    id: "learn-checkpoints",
    name: "Learn checkpoint and abandoned-job recovery",
    behavior: "Runtime V2 persists the owning job and explicit durable Learn binding; a fixed internal disposable recovery job reconciles abandoned checkpoints without timestamp correlation or blind provider retry.",
    status: "DURABLE_SOURCE_CONTRACT",
    sources: [
      ["dashboard/src/lib/learn-operation-runtime-v2.ts", /readRuntimeV2LearnBinding/],
      ["dashboard/src/lib/runtime-v2/learn-binding.ts", /export function writeRuntimeV2LearnBinding/],
      ["dashboard/src/lib/learn-recovery-background.ts", /launchAbandonedLearnRecoveryWorker/],
      ["dashboard/scripts/runtime-v2-learn-worker.mjs", /request.operation === "recovery"/],
    ],
  },
  {
    id: "hermes-run",
    name: "Hermes durable run and event-pump recovery",
    behavior: "Server-owned pump persists events beyond browser disconnect; stale runs resume from durable runtime state or close terminally.",
    status: "DURABLE_SOURCE_CONTRACT",
    sources: [
      ["dashboard/src/lib/hermes/run-store.ts", /export type RuntimeRunStatus/],
      ["dashboard/src/lib/hermes/event-stream.ts", /export function startSessionEventPump/],
      ["dashboard/src/lib/hermes/run-recovery.ts", /export async function recover/],
    ],
  },
  {
    id: "external-agent-transcript",
    name: "External-agent transcript restoration",
    behavior: "Every external run kind maps to a durable transcript field, display name, reconnect descriptor and cancellation resolver.",
    status: "DURABLE_DESCRIPTOR_ADAPTER_SPECIFIC_WORKER",
    sources: [
      ["dashboard/src/lib/conversations/external-agent-runs.ts", /export const EXTERNAL_AGENT_RUN_KINDS/],
      ["dashboard/src/lib/conversations/external-agent-cancel.ts", /export async function/],
    ],
  },
  {
    id: "scriberr-jobs",
    name: "Scriberr checkpoint/restart recovery",
    behavior: "SQLite jobs, heartbeat staleness and stage checkpoints survive restart and resume/requeue without duplicating completed stages.",
    status: "DURABLE_SOURCE_CONTRACT",
    sources: [
      ["dashboard/src/lib/scriberr/job-store.ts", /SQLite-backed persistence/],
      ["dashboard/src/lib/scriberr/job-runner.ts", /recoverStaleJobs/],
    ],
  },
  {
    id: "turn-delete-branch",
    name: "Turn deletion and branch recovery",
    behavior: "Deleting a turn cancels its external run, removes branch variants/artifacts and recreates runtime context from the remaining selected transcript.",
    status: "DURABLE_SOURCE_CONTRACT",
    sources: [["dashboard/src/app/api/hermes/sessions/[sessionId]/messages/[clientMessageId]/route.ts", /export async function DELETE/]],
  },
  {
    id: "browser-ephemeral",
    name: "Agent Browser fenced run recovery",
    behavior: "Runtime V2 persists the exact run fence and terminal event projection; profile artifacts survive while interrupted live browser work is classified rather than resumed blindly.",
    status: "DURABLE_SOURCE_CONTRACT_LIVE_RESTART_PENDING",
    sources: [
      ["dashboard/src/lib/agent-browser/schema.ts", /runs\/events\/screenshots/],
      ["dashboard/src/lib/agent-browser/run-manager.ts", /runtime/],
      ["dashboard/src/lib/runtime-v2/agent-browser-profile-job.ts", /cancelRuntimeJob/],
    ],
  },
  {
    id: "cad-hybrid",
    name: "CAD durable project and fenced run recovery",
    behavior: "Validated revisions and artifacts persist with the exact Runtime job mapping and fenced event projection; interrupted work is classified without blindly replaying parameter side effects.",
    status: "DURABLE_SOURCE_CONTRACT_LIVE_RESTART_PENDING",
    sources: [
      ["dashboard/src/lib/cad/project-store.ts", /export function|export async function/],
      ["dashboard/src/lib/cad/runtime-run-manager.ts", /export async function/],
    ],
  },
  {
    id: "research-ephemeral",
    name: "Research in-memory session boundary",
    behavior: "Coverage state intentionally disappears on restart today; Runtime V2 must not call this recovered or synthesize a stale ledger.",
    status: "KNOWN_GAP",
    sources: [["dashboard/src/lib/research/store.ts", /Deliberately not in SQLite/]],
  },
];

for (const recovery of recoverySpecs) {
  add({
    capabilityId: `recovery:${recovery.id}`,
    displayName: recovery.name,
    category: "recovery",
    visibleEntryPoint: "Refresh/reconnect/restart behavior of the owning workflow",
    selectionSemantics: recovery.behavior,
    routeOrIpcContract: "Owning workflow event/reconnect/cancel contract",
    inputTypes: ["active or stale run/job state"],
    outputTypes: ["replayed events", "resumed or honest terminal classification"],
    progressEventContract: "Event sequence/cursor and terminal classification are part of parity.",
    cancellationBehavior: "Cancellation intent must be persisted before complete process-tree termination is reported.",
    approvalBehavior: "Recovery cannot invent or replay an approval; pending authority must be durably proven.",
    followUpContextBehavior: "Recovered state remains bound to the original user/conversation/garden/job tuple.",
    restartBehavior: recovery.behavior,
    recoveryBehavior: recovery.behavior,
    preMigrationStatus: recovery.status,
    runtimePath: "Capability-specific durable persistence/replay owner -> installed restart and reconciliation evidence NOT RUN",
    sourceRefs: recovery.sources.map(([relativePath, matcher]) => sourceAnchor(relativePath, matcher)),
  });
}

const registrySpecs = [
  {
    id: "runtime-v2-execution-inventory",
    name: "Runtime V2 execution inventory",
    contract: "Every managed, finite, scheduled, core, or external process boundary has one stable lifecycle disposition; migrated capability references fail closed when they do not join this parity registry.",
    sources: [
      ["qa/runtime-v2/validate-execution-inventory.mjs", /const inventory = readJson/],
      ["qa/runtime-v2/process-source-validation.mjs", /export function validateProcessSources/],
    ],
  },
  {
    id: "slash-commands",
    name: "Slash command registry",
    contract: "Dynamic reviewed skills, document skills, MCP, prompts, ARIS/Spotify/Agency personas plus runtime-agent profiles; deterministic collision namespaces.",
    sources: [
      ["dashboard/src/lib/hermes/commands.ts", /export function registryItemsForUser/],
      ["dashboard/src/lib/hermes/direct-slash-commands.ts", /export function directSlashCommandItems/],
      ["dashboard/src/app/api/hermes/commands/route.ts", /export async function GET/],
    ],
  },
  {
    id: "implicit-routing",
    name: "Implicit intent/attachment routing order",
    contract: "V2 order is premortem, factcheck, visualizer, agent-loop, Watch, image-to-3D, Spotify, audio, diagram, GitHub, humanize, messaging, Goal; legacy Garden is separately hashed and currently lacks Watch/Goal/recent attachments.",
    sources: [
      ["dashboard/src/lib/conversations/turn-service.ts", /const premortemSelection/],
      ["dashboard/src/lib/hermes/garden-chat-adapter.ts", /const premortemSelection/],
    ],
  },
  {
    id: "agents-page",
    name: "Agents page visibility/order",
    contract: `${runtimeAgents.length} source runtime profiles plus the successfully loaded Agency catalog and first-party personas; hand-authored UI rows remain a drift risk.`,
    sources: [
      ["dashboard/src/lib/hermes/capability-combinations.ts", /export const RUNTIME_AGENT_PROFILES/],
      ["dashboard/src/app/components/hermes/command-hub.tsx", /value="agents"/],
      ["dashboard/src/lib/hermes/agency-agents.ts", /export function loadAgencyAgentsCatalog/],
    ],
  },
  {
    id: "surface-tool-scopes",
    name: "Surface tool-scope registry",
    contract: "Exact Garden/Quartz/Terminal tool family composition, capability-token defense and authenticated optional GBrain/Recall gates.",
    sources: [["dashboard/src/lib/hermes/tool-scopes.ts", /export function allowedToolsForSurface/]],
  },
  {
    id: "stopped-service-visibility",
    name: "Stopped-service visibility policy",
    contract: "A stopped internal service is available-but-stopped: it must remain visible and the original action must cold-start it without another click.",
    sources: [
      ["dashboard/src/lib/hermes/direct-slash-commands.ts", /availableRuntimeAgentIds/],
      ["dashboard/src/lib/hermes/capability-combinations.ts", /launchableByModel/],
    ],
  },
  {
    id: "no-silent-fallback",
    name: "No silent mock/canned/lower-capability fallback policy",
    contract: "Source-declared fallback/mock signals are frozen per row; post evidence must name the real path and cannot count a fallback as a pass.",
    sources: [
      ["dashboard/src/lib/conversations/turn-service.ts", /automatic selection must never cost/],
      ["dashboard/src/lib/meeting-notes/transcribe.ts", /fallback/i],
    ],
  },
];

for (const registry of registrySpecs) {
  add({
    capabilityId: `registry:${registry.id}`,
    displayName: registry.name,
    category: "registry",
    visibleEntryPoint: "Cross-surface product contract",
    selectionSemantics: registry.contract,
    routeOrIpcContract: registry.contract,
    inputTypes: ["registry/source state"],
    outputTypes: ["deterministic parity snapshot"],
    progressEventContract: "Not a runnable operation; registry changes are detected before Electron evidence is considered.",
    streamingContract: "Not applicable.",
    cancellationBehavior: "Not applicable.",
    approvalBehavior: "Registry changes require reviewed source/baseline updates; they do not grant runtime authority.",
    followUpContextBehavior: "Stable IDs and ordering remain unchanged across sessions and migration stages.",
    restartBehavior: "Registry identity is source/package-defined, not service-process state.",
    recoveryBehavior: "Missing/renamed entries fail parity instead of being hidden by runtime availability.",
    runtimePath: "Source registry -> parity snapshot -> Electron post-evidence gate",
    sourceRefs: registry.sources.map(([relativePath, matcher]) => sourceAnchor(relativePath, matcher)),
  });
}

const apiRouteFiles = filesUnder(apiRoot, (absolutePath) => path.basename(absolutePath) === "route.ts");
const desktopIpcFiles = filesUnder(path.join(repoRoot, "desktop", "src"), (absolutePath) => {
  if (!/\.(?:cjs|js|mjs|ts|tsx)$/.test(absolutePath)) return false;
  const source = fs.readFileSync(absolutePath, "utf8");
  return /ipcMain\.(?:handle|on)|ipcRenderer\.(?:invoke|send)|contextBridge\.exposeInMainWorld/.test(source);
});
const agencySourceFiles = agencyCatalog.agents
  .map((agent) => path.join(agencyRoot, agent.sourceRelativePath))
  .filter((absolutePath) => fs.existsSync(absolutePath));
const firstPartySkillFiles = firstPartySkills.map((slug) =>
  path.join(firstPartySkillRoot, slug, "SKILL.md"),
);
const installedSkillFiles = installedSkills.map((skill) =>
  path.join(repoRoot, ".agents", "skills", skill.slug, "SKILL.md"),
);

const sourceCatalogs = {
  nextApiRoutes: {
    count: apiRouteFiles.length,
    sha256: sha256Files(apiRouteFiles),
  },
  desktopIpcSources: {
    count: desktopIpcFiles.length,
    sha256: sha256Files(desktopIpcFiles),
    files: desktopIpcFiles.map(relativeToRepo).sort(),
  },
  agencyAgents: {
    status: agencyCatalog.status,
    source: agencyCatalog.source,
    successfulCount: agencyCatalog.agents.length,
    sourceSha256: agencySourceFiles.length ? sha256Files(agencySourceFiles) : sha256Text(""),
    diagnostics: agencyCatalog.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  },
  skills: {
    firstPartySkillMdCount: firstPartySkills.length,
    firstPartySourceSha256: sha256Files(firstPartySkillFiles),
    installedReviewedCount: installedSkills.length,
    installedSourceSha256: sha256Files([installedRegistryPath, ...installedSkillFiles]),
  },
  connections: {
    composioFeaturedCount: composioFeatured.length,
    composioDynamicLimit: 500,
    composioSourceSha256: sha256Files([path.join(repoRoot, composioSourcePath)]),
    nangoFeaturedCount,
    nangoSourceSha256: sha256Files([path.join(repoRoot, nangoSourcePath)]),
    mcpObservedUserRows: null,
    mcpObservation: "Real user data is intentionally not read; schema/source digest is the dynamic parity boundary.",
    mcpSourceSha256: sha256Files([path.join(repoRoot, "dashboard/src/lib/hermes/mcp-connections.ts")]),
  },
};

const duplicateCapabilityId = duplicate(capabilityRows.map((row) => row.capabilityId));
if (duplicateCapabilityId) fail(`duplicate capability id: ${duplicateCapabilityId}`);
for (const row of capabilityRows) {
  for (const field of REQUIRED_CAPABILITY_FIELDS) {
    if (!(field in row)) fail(`capability ${row.capabilityId} is missing ${field}`);
  }
}

capabilityRows.sort((left, right) =>
  left.category.localeCompare(right.category) || left.capabilityId.localeCompare(right.capabilityId),
);

const countsByCategory = Object.fromEntries(
  [...new Set(capabilityRows.map((row) => row.category))]
    .sort()
    .map((category) => [category, capabilityRows.filter((row) => row.category === category).length]),
);

const evidenceReceipts = filesUnder(path.join(repoRoot, "qa", "runtime-v2", "evidence"), (absolutePath) =>
  path.basename(absolutePath) === "receipt.json",
).map((absolutePath) => {
  try {
    const receipt = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    return {
      path: relativeToRepo(absolutePath),
      classification: receipt.classification ?? "UNKNOWN",
      runId: receipt.runId ?? null,
    };
  } catch (error) {
    return {
      path: relativeToRepo(absolutePath),
      classification: "INVALID",
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

const featureParity = {
  schemaVersion: 2,
  contractVersion: "runtime-v2-feature-parity-v1",
  classification: "SOURCE_INVENTORY_POST_ELECTRON_NOT_RUN",
  source: "Deterministic source-only pre-migration capability inventory",
  evidencePolicy: {
    inventoryOnly:
      "May pass structural and source-registry checks without starting Electron, services, workers, builds, or compilers.",
    default:
      "Fails closed until every row has inspected post-migration Electron evidence and a PASS or truthful BLOCKED result.",
    pass:
      "PASS requires the normal user entry point, real service/worker path, expected output/artifact, cancellation and restart/recovery evidence. Mocks, canned output and lower-capability fallback do not qualify.",
    blocked:
      "BLOCKED requires the same external prerequisite to be established against the pre-migration contract and preserves selection, route, lifecycle, security and error behavior.",
  },
  requiredCapabilityFields: REQUIRED_CAPABILITY_FIELDS,
  contractFieldsComparedToSource: CONTRACT_FIELDS,
  capabilityCount: capabilityRows.length,
  countsByCategory,
  sourceCatalogs,
  baselineEvidenceReceipts: evidenceReceipts,
  inventoryDiagnostics: {
    agencyAgents: sourceCatalogs.agencyAgents,
    knownSourceGaps: [
      {
        code: "legacy_implicit_router_drift",
        evidence: [
          sourceAnchor("dashboard/src/lib/conversations/turn-service.ts", /const watchSelection/),
          sourceAnchor("dashboard/src/lib/hermes/garden-chat-adapter.ts", /const imageTo3dSelection/),
        ],
        message: "Legacy Garden routing omits Watch, Goal and recent attachment recovery present in the V2 turn service.",
      },
      {
        code: "garden_humanizer_duplicate",
        evidence: [sourceAnchor("dashboard/src/lib/hermes/tool-scopes.ts", /\.\.\.HUMANIZER_TOOLS/)],
        message: "Garden tool composition currently contains HUMANIZER_TOOLS twice; inventory preserves unique tool identity and records the source drift.",
      },
      {
        code: "research_session_ephemeral",
        evidence: [
          sourceAnchor("dashboard/src/lib/research/store.ts", /Deliberately not in SQLite/),
        ],
        message: "Research coverage state is intentionally process-local and does not yet meet durable restart recovery; Browser and CAD now have separately fenced Runtime job projections.",
      },
    ],
  },
  capabilities: capabilityRows,
};

const snapshot = {
  schemaVersion: 2,
  source: "active pre-migration registries",
  runtimeAgentCount: runtimeAgents.length,
  runtimeAgentGroups: RUNTIME_AGENT_GROUPS.map((group, order) => ({ ...group, order })),
  runtimeAgents,
  externalAgentRunKinds: [...EXTERNAL_AGENT_RUN_KINDS],
  sourceFiles: [...sourceFiles].map(relativeToRepo).sort(),
  sourceSha256: sha256Files(sourceFiles),
  featureParity,
};

function markdownEscape(value) {
  return String(value ?? "—").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function featureParityMarkdown(inventory) {
  const categoryRows = Object.entries(inventory.countsByCategory)
    .map(([category, count]) => `| ${markdownEscape(category)} | ${count} |`)
    .join("\n");
  const capabilityTable = inventory.capabilities
    .map((row) =>
      `| \`${markdownEscape(row.capabilityId)}\` | ${markdownEscape(row.displayName)} | ${markdownEscape(row.category)} | ${markdownEscape(row.uiEntryPoint)} | ${markdownEscape(row.slashCommand)} | ${markdownEscape(row.runtimePath)} | ${markdownEscape(row.preMigrationStatus)} | ${markdownEscape(row.postMigrationStatus)} | ${markdownEscape(row.result)} |`,
    )
    .join("\n");
  return `# Runtime V2 feature parity matrix

Status: **source inventory complete; post-migration Electron evidence NOT RUN**.

This file is generated by \`qa/runtime-v2/registry-snapshot.mjs --write-artifacts\` from the checked-in registries. The detailed contract and pre/post evidence fields for every row live in \`feature-parity.json\`.

The normal \`npm run qa:runtime-v2:parity\` command intentionally fails until real post-migration Electron evidence exists. \`npm run qa:runtime-v2:parity -- --inventory-only\` performs only lightweight structural/source checks and must not start the app, a service, worker, compiler, or build.

## Inventory counts

Total capabilities: **${inventory.capabilityCount}**

| Category | Count |
|---|---:|
${categoryRows}

Agency catalog: **${inventory.sourceCatalogs.agencyAgents.successfulCount} loaded**, **${inventory.sourceCatalogs.agencyAgents.diagnostics.length} diagnostics**. First-party skills: **${inventory.sourceCatalogs.skills.firstPartySkillMdCount} SKILL.md**. Installed reviewed skills: **${inventory.sourceCatalogs.skills.installedReviewedCount}**. Next route source catalog: **${inventory.sourceCatalogs.nextApiRoutes.count} routes**.

## Required interpretation

- \`SOURCE_PRESENT\` is source evidence, not an execution pass.
- \`KNOWN_GAP\` records a real pre-migration recovery limitation; it is not hidden or converted to PASS.
- \`BLOCKED\` is valid only for a proven external prerequisite with matching pre/post behavior.
- \`PASS\` requires inspected normal-entry-point Electron evidence, real service/worker execution, expected output/artifact, cancellation, cleanup and restart/recovery evidence.
- A mock, canned response, unrelated fallback, stopped-service hiding, or second-click cold start is a failure.

## Capability rows

| Capability ID | Display name | Category | UI entry point | Slash command | Runtime path | Pre | Post | Result |
|---|---|---|---|---|---|---|---|---|
${capabilityTable}
`;
}

if (process.argv.includes("--write-artifacts")) {
  const featurePath = path.join(import.meta.dirname, "feature-parity.json");
  const matrixPath = path.join(import.meta.dirname, "FEATURE_PARITY_MATRIX.md");
  const previous = fs.existsSync(featurePath)
    ? JSON.parse(fs.readFileSync(featurePath, "utf8"))
    : null;
  const reconciledFeatureParity = preserveHistoricalParityEvidence(featureParity, previous);
  fs.writeFileSync(
    featurePath,
    `${JSON.stringify(reconciledFeatureParity, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(matrixPath, featureParityMarkdown(reconciledFeatureParity), "utf8");
  process.stdout.write(
    `[runtime-v2-registry] wrote ${relativeToRepo(featurePath)} and ${relativeToRepo(matrixPath)} (${reconciledFeatureParity.capabilityCount} rows; historical evidence preserved)\n`,
  );
} else {
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}
