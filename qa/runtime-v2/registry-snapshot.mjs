import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
    runtimePath: input.runtimePath ?? "Next.js compatibility route -> legacy execution owner",
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
  ];
  add({
    capabilityId: `runtime-agent:${agent.id}`,
    sourceIdentity: agent.id,
    displayName: agent.displayName,
    category: "runtime-agent",
    visibleEntryPoint: `Agents tab and ${agent.command}`,
    slashCommand: agent.command,
    selectionSemantics: JSON.stringify(agent.selectionSemantics),
    routeOrIpcContract: `${agent.routes.submit}; SSE ${agent.routes.events}; POST ${agent.routes.cancel}`,
    requiredServiceOrWorker: [`runtime-agent:${agent.id}`],
    inputTypes: agent.selectionSemantics.acceptsAttachments ? ["text", "chat-attachments"] : ["text"],
    outputTypes: ["chat-message", "external-agent-run-card", "durable-transcript-field"],
    artifactTypes: ["agent-specific"],
    progressEventContract: `Replayable events from ${agent.routes.events}.`,
    cancellationBehavior: `POST ${agent.routes.cancel}; shared external-agent cancellation mapping.`,
    approvalBehavior: agent.selectionSemantics.requiresLaunchApproval
      ? "Model launch requires explicit approval; direct user selection is the launch authority."
      : "Direct user selection authorizes launch.",
    followUpContextBehavior: `Conversation-bound ${agent.durableRun.transcriptField} descriptor restores the run card and follow-up context.`,
    restartBehavior: "Durable transcript descriptor survives restart; live worker recovery remains adapter-specific until Runtime V2 evidence exists.",
    recoveryBehavior: `External run kind ${agent.durableRun.kind} maps to ${agent.durableRun.transcriptField}.`,
    runtimePath: `${agent.routes.submit} -> legacy worker/run manager -> ${agent.routes.events}`,
    sourceRefs: refs,
  });
}

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
    sources: [
      ["dashboard/src/app/api/hermes/sessions/route.ts", /temporary/],
      ["dashboard/src/lib/conversations/memory.ts", /temporary/],
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
    followUpContextBehavior: "Same conversation preserves exact transcript, selected branch, source and artifact context.",
    restartBehavior: surface.id === "legacy-garden-chat"
      ? "Legacy session rows persist; intent and attachment semantics are separately implemented and must remain parity-checked."
      : "Durable conversation/run rows are resumed or terminally reconciled on restart.",
    recoveryBehavior: "Refresh reconnects by session/run id and bounded event cursor.",
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
  if (!Array.isArray(tools) || tools.length === 0) fail(`tool family ${exportName} is empty or missing`);
  add({
    capabilityId: `tool-family:${id}`,
    sourceIdentity: exportName,
    displayName: name,
    category: "tool-family",
    visibleEntryPoint: "Selected automatically or by its reviewed skill/feature entry point in authenticated chat.",
    implicitTrigger: SKILL_INTENTS[id] ?? null,
    selectionSemantics: `Exact tool IDs: ${tools.join(", ")}. Surface composition is enforced by allowedToolsForSurface.`,
    routeOrIpcContract: "Signed capability token and server-side task decision are revalidated by the internal tool route.",
    requiredServiceOrWorker: TOOL_SERVICE_REQUIREMENTS[id] ?? [],
    inputTypes: ["bounded-tool-arguments"],
    outputTypes: ["typed-tool-result", "audit-event"],
    artifactTypes: id === "artifacts" ? [...artifactTypes.ARTIFACT_KINDS] : [],
    progressEventContract: "Tool start/completion/failure events are correlated to the conversation run.",
    cancellationBehavior: "Owning conversation abort propagates to cancellable tool work; finite tools return a terminal result.",
    approvalBehavior: id === "gadgets"
      ? "Gadget writes are queued as durable user-approved actions."
      : id === "recall"
      ? "Recall control may require explicit per-action approval; reads honor the current agentAccess setting."
      : "Capability broker and tool route enforce the per-turn grant; write families retain their documented proposal/reversibility policy.",
    followUpContextBehavior: "Tool evidence and artifacts are stored against the owning conversation/run.",
    restartBehavior: "Tool availability is recomputed from registry and service state; stopped services must not hide the capability.",
    recoveryBehavior: "Durable tool/artifact events replay where supported; an unavailable dependency remains truthful rather than silently falling back.",
    runtimePath: `Hermes turn -> capability broker -> ${exportName} internal route(s)`,
    sourceRefs: [
      sourceAnchor("dashboard/src/lib/hermes/tool-scopes.ts", new RegExp(`export const ${exportName}`)),
      sourceAnchor("dashboard/src/lib/hermes/capability-broker.ts", /export async function|export function/),
      sourceAnchor("dashboard/src/lib/hermes/capability-token.ts", /export function/),
    ],
  });
}

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
    id: "ingestion",
    name: "Garden source ingestion",
    entry: "Garden Add source/upload controls",
    route: "POST /api/ingest SSE",
    services: ["document extractors", "optional Anydoc/VLM/Quartz parser"],
    input: ["PDF", "CSV", "DOCX", "PPTX", "XLSX", "ZIP", "text", "supported Anydoc formats"],
    output: ["Garden source Markdown", "figures", "source PDF", "semantic index"],
    artifacts: ["garden-source"],
    progress: "SSE progress, usage, result, error and DONE frames.",
    cancel: "Client disconnect stops streaming; staged upload cleanup is bounded; long parser ownership must migrate to a finite Runtime V2 job.",
    approval: "Authenticated Garden ownership and explicit upload action.",
    restart: "Original/staged source and indexed Garden data persist; incomplete in-process extraction is not yet a Runtime V2 recovery claim.",
    recovery: "Duplicate filename/content and partial extraction paths are explicit; no successful post-migration evidence exists.",
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
    restart: "Result remains in the transcript; active analysis needs finite-job recovery after migration.",
    recovery: "Unavailable/timeout/file errors remain typed and never become a fabricated analysis.",
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
    restart: "Completed artifacts persist; active work requires Runtime V2 interrupted/uncertain classification.",
    recovery: "Unavailable runtime/ffmpeg preserves the ordinary-turn fallback without claiming video analysis.",
    sources: [
      ["dashboard/src/app/api/hermes/tools/watch/route.ts", /export async function POST/],
      ["dashboard/src/lib/hermes/watch-intent.ts", /export function watchCommandText/],
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
    progress: "Replayable in-memory CAD run events plus durable revision/artifact events.",
    cancel: "POST CAD abort stops the active run.",
    approval: "User/garden ownership and validated parameter/file tuple; backend selection is registry-bound.",
    restart: "Projects/revisions/artifacts persist, but active run/events are currently ephemeral.",
    recovery: "Last validated revision survives; process restart loses the live run and must become interrupted under Runtime V2.",
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
    progress: "SSE/JSON event replay with cursor and awaiting_approval state.",
    cancel: "Explicit run abort terminates the live browser execution.",
    approval: "Sensitive browser actions pause in awaiting_approval for approve/reject.",
    restart: "Only browser agent configuration persists; runs/events/screenshots/approvals are currently in memory.",
    recovery: "Refresh within the same process replays events; process restart loses live state and requires Runtime V2 interruption handling.",
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
    sources: [["dashboard/src/lib/colpali/retrieval.ts", /export async function/]],
  },
  {
    id: "quartz-publishing",
    name: "Quartz Garden publishing",
    entry: "Garden/document/artifact mutations that publish the static Garden",
    route: "publishQuartzAfterMutation queue and Quartz build lease",
    services: ["Quartz compiler"],
    input: ["Garden mutation reason", "Quartz content tree"],
    output: ["published static Garden"],
    artifacts: ["published-garden"],
    progress: "Server log/awaited promise only; no durable user-facing job stream yet.",
    cancel: "Current spawned build has timeout/SIGTERM but no user cancellation route.",
    approval: "The originating authenticated mutation is the publish authority.",
    restart: "Queue is in memory; an active compiler build has no durable Runtime V2 job recovery yet.",
    recovery: "Serialized/coalesced queue retries only within process; failures are logged/returned according to requireSuccess.",
    sources: [["dashboard/src/lib/quartz-publish.ts", /export async function publishQuartzAfterMutation/]],
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
    services: ["Voicebox", "ffmpeg"],
    input: ["recorded audio"],
    output: ["transcript text"],
    artifacts: [],
    progress: "Segment/model-download/transcription progress; Voicebox may return 202 while loading a model.",
    cancel: "Upload/transcription request cancellation is propagated.",
    approval: "Explicit recording/upload action.",
    restart: "No durable generic speech job is claimed yet.",
    recovery: "Partial segment work is not presented as a completed transcript.",
    sources: [
      ["dashboard/src/lib/speech/recording-transcription.ts", /export async function/],
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
    restart: "External run descriptor persists; underlying engine recovery depends on Scriberr versus Voicebox path.",
    recovery: "Engine fallback is declared and must remain visible in evidence; fallback output cannot be counted as the preferred-engine pass.",
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
    restart: "Garden/database/files persist; publish queue is currently in memory.",
    recovery: "Version/source history and transfer validation protect stored content.",
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
    sources: [
      ["dashboard/src/lib/hermes/gadget-types.ts", /export type GadgetActionStatus/],
      ["dashboard/src/lib/hermes/gadget-schema.ts", /CREATE TABLE/],
      ["dashboard/src/app/api/hermes/gadgets/[artifactId]/actions/[actionId]/route.ts", /export async function POST/],
    ],
  },
];

for (const workflow of workflowSpecs) {
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
    runtimePath: `${workflow.route} -> current legacy service/worker path; Runtime V2 post path NOT RUN`,
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
    name: "Agent Browser ephemeral-run boundary",
    behavior: "Same-process replay exists, but restart loses active run/events/screenshots/approval. Runtime V2 must persist interrupted/uncertain state before parity can pass.",
    status: "KNOWN_GAP",
    sources: [
      ["dashboard/src/lib/agent-browser/schema.ts", /runs\/events\/screenshots/],
      ["dashboard/src/lib/agent-browser/run-manager.ts", /Runs are ephemeral/],
    ],
  },
  {
    id: "cad-hybrid",
    name: "CAD durable-project/ephemeral-run boundary",
    behavior: "Validated revisions/artifacts persist, while live CAD run events are in-memory and must become interrupted on runtime restart.",
    status: "KNOWN_GAP",
    sources: [
      ["dashboard/src/lib/cad/project-store.ts", /export function|export async function/],
      ["dashboard/src/lib/cad/run-manager.ts", /Runs are ephemeral/],
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
    runtimePath: "Current persistence/replay owner -> Runtime V2 post path NOT RUN",
    sourceRefs: recovery.sources.map(([relativePath, matcher]) => sourceAnchor(relativePath, matcher)),
  });
}

const registrySpecs = [
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
        code: "ephemeral_run_managers",
        evidence: [
          sourceAnchor("dashboard/src/lib/agent-browser/run-manager.ts", /Runs are ephemeral/),
          sourceAnchor("dashboard/src/lib/cad/run-manager.ts", /Runs are ephemeral/),
          sourceAnchor("dashboard/src/lib/research/store.ts", /Deliberately not in SQLite/),
        ],
        message: "Browser and CAD live runs and research coverage state do not yet meet Runtime V2 restart recovery.",
      },
      {
        code: "quartz_publish_compiler",
        evidence: [sourceAnchor("dashboard/src/lib/quartz-publish.ts", /"build"/)],
        message: "Quartz publication still spawns a compiler build from the mutation path; post-migration evidence is required after disposable-job cutover.",
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
  fs.writeFileSync(featurePath, `${JSON.stringify(featureParity, null, 2)}\n`, "utf8");
  fs.writeFileSync(matrixPath, featureParityMarkdown(featureParity), "utf8");
  process.stdout.write(
    `[runtime-v2-registry] wrote ${relativeToRepo(featurePath)} and ${relativeToRepo(matrixPath)} (${featureParity.capabilityCount} rows)\n`,
  );
} else {
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}
