// The Socials Manager is wired into the same seams every other runtime agent
// uses. These are
// source-level assertions on purpose: the wiring is spread across the composer,
// both chat surfaces and the restore path, and a break in any one of them is
// invisible to the unit tests.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const desktopSource = (relativePath) =>
  fs.readFileSync(new URL(`../../desktop/${relativePath}`, import.meta.url), "utf8");

const identity = await import("../src/lib/socials-manager/identity.ts");
const { runtimeAgentByToken } = await import(
  "../src/lib/hermes/capability-combinations.ts"
);
const { findConfigurableAgent, normalizeAgentSettings } = await import(
  "../src/lib/agent-settings/catalog.ts"
);
const { socialsManagerDefaults } = await import("../src/lib/agent-settings/defaults.ts");

test("the slash command is canonical and case-insensitive", () => {
  assert.equal(identity.SOCIALS_MANAGER_COMMAND, "/agents:socials-manager");
  assert.equal(
    identity.taskFromSocialsManagerCommand("/agents:socials-manager announce the calendar"),
    "announce the calendar",
  );
  assert.equal(
    identity.taskFromSocialsManagerCommand("  /AGENTS:SOCIALS-MANAGER   ship it  "),
    "ship it",
  );
  // The agent was called Postiz until it was renamed. Its old command is still
  // sitting in saved chats, so it has to keep resolving to this agent.
  assert.equal(identity.LEGACY_SOCIALS_MANAGER_COMMAND, "/agents:postiz");
  assert.equal(
    identity.taskFromSocialsManagerCommand("/agents:postiz ship it"),
    "ship it",
  );
});

test("Socials Manager runs are a durable external-agent kind", () => {
  const runs = source("src/lib/conversations/external-agent-runs.ts");
  const chatSessions = source("src/app/api/chat-sessions/[sessionId]/route.ts");

  assert.match(runs, /EXTERNAL_AGENT_RUN_KINDS = \[[^\]]*"socials_manager",[^\]]*\] as const/s);
  assert.match(runs, /candidate\.kind === "socials_manager"/);
  assert.match(runs, /socialsManagerRun: \{ runId: run\.runId, brief: run\.brief \}/);
  // The Garden save path walks the registry rather than naming agents one
  // by one, so restorability is now "the registry maps this kind to a field".
  assert.match(runs, /socials_manager: "socialsManagerRun"/);
  assert.match(chatSessions, /EXTERNAL_AGENT_RUN_FIELD_BY_KIND\[kind\]/);
});

test("a brief is required for the run to be restorable", async () => {
  const { parseExternalAgentRun } = await import(
    "../src/lib/conversations/external-agent-runs.ts"
  );
  assert.deepEqual(
    parseExternalAgentRun({ kind: "socials_manager", runId: "r1", brief: "hi" }),
    { kind: "socials_manager", runId: "r1", brief: "hi" },
  );
  // Turns saved before the rename carry the old kind and must still resolve,
  // or their run card silently disappears from the transcript.
  assert.deepEqual(parseExternalAgentRun({ kind: "postiz", runId: "r1", brief: "hi" }), {
    kind: "socials_manager",
    runId: "r1",
    brief: "hi",
  });
  assert.equal(parseExternalAgentRun({ kind: "socials_manager", runId: "r1" }), null);
  assert.equal(parseExternalAgentRun({ kind: "socials_manager", brief: "hi" }), null);
});

test("the command resolver routes the token to its own runner", () => {
  // The resolver recognizes the token through the shared runtime-agent table
  // rather than a literal list, so it can name the agent when a turn reaches it
  // unhandled. capability-combinations.test.mjs covers that rejection.
  const agent = runtimeAgentByToken("agents:socials-manager");
  assert.equal(agent?.id, "socials-manager");
  assert.equal(agent?.name, "Socials Manager");
  // It drafts from the brief verbatim, so a stacked skill or prompt is a
  // refusable conflict rather than something the run can carry.
  assert.equal(agent?.stacksCapabilities, false);
  assert.equal(agent?.acceptsAttachments, false);
  assert.match(
    source("src/app/api/socials-manager/runs/route.ts"),
    /findCapabilityConflict\(/,
  );
});

test("the Socials Manager appears in the Agents tab and inserts its command", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  const composer = source("src/app/components/assistant-composer.tsx");

  assert.match(hub, /const showSocialsManager =/);
  assert.match(hub, /id="socials-manager-entry"/);
  assert.match(hub, /showSocialsManager \|\|/);
  assert.match(composer, /onSelectSocialsManager \? \(\) => insertCommandToken\(SOCIALS_MANAGER_COMMAND\)/);
});

test("the Socials Manager has Breadboard-native account settings in the Agents tab", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  const dialog = source("src/app/components/hermes/socials-manager-settings-dialog.tsx");
  const route = source("src/app/api/socials-manager/settings/route.ts");

  // One settings button per agent row, right after the entry itself; accounts
  // and run defaults both live behind it.
  const socialsManagerEntry = hub.indexOf('id="socials-manager-entry"');
  const settingsButton = hub.indexOf('name="Socials Manager"', socialsManagerEntry);
  assert.ok(socialsManagerEntry > 0 && settingsButton > socialsManagerEntry);
  assert.match(hub.slice(settingsButton, settingsButton + 200), /setSocialsManagerSettingsOpen\(true\)/);
  assert.match(hub, /<SocialsManagerSettingsDialog/);
  assert.match(dialog, /bb-modal-panel neu-dialog/);
  assert.match(dialog, /Instagram, LinkedIn, Threads/);
  assert.match(dialog, /action: "authorize"/);
  assert.match(dialog, /action: "credentials"/);
  assert.match(dialog, /action: "disconnect"/);
  assert.match(route, /listProviderConnections\(\)/);
  assert.match(route, /createConnectionUrl\(providerId\)/);
  assert.match(route, /completeConnection\(\{/);
  assert.match(route, /deleteIntegration\(integrationId\)/);
});

test("a persistent checkbox per network decides where every post is written", () => {
  const dialog = source("src/app/components/hermes/socials-manager-settings-dialog.tsx");
  const route = source("src/app/api/socials-manager/settings/route.ts");
  const manager = source("src/lib/socials-manager/run-manager.ts");

  // A checkbox per network, saved the moment it is ticked rather than on close.
  assert.match(dialog, /type="checkbox"/);
  assert.match(dialog, /action: "networks"/);
  assert.match(dialog, /aria-label=\{`Write every post for \$\{provider\.name\}`\}/);
  assert.match(dialog, /announceAgentSettingsChanged\("socials-manager"\)/);

  // Stored as the Socials Manager's own setting, so this dialog and the agent's
  // settings page are one switch and the run already reads it.
  assert.match(route, /writeAgentSettings\(userId, agent, \{ \.\.\.current, networks: raw \}\)/);
  assert.match(route, /socialsManagerDefaults\(readAgentSettings\(userId, agent\)\.values\)\.providerIds/);
  assert.match(manager, /socialsManagerDefaults\(agentSettingsFor\(run\.userId, "socials-manager"\)\)/);

  // Ticking works with the stack down: it is a drafting choice, not a connection.
  assert.ok(
    route.indexOf('action === "networks"') < route.indexOf("const settings = await liveSettings()"),
    "the network choice must be answered before the stack is consulted",
  );
});

test("every network Breadboard drafts for is offered, connectable or not", () => {
  const route = source("src/app/api/socials-manager/settings/route.ts");
  const providers = source("src/lib/socials-manager/providers.ts");

  // A provider missing from the running stack's catalog used to be dropped from
  // the dialog entirely, which hid it from the choice as well as the connection.
  assert.doesNotMatch(route, /if \(!connection\) return \[\];/);
  assert.match(route, /connectionMode: "unavailable"/);

  for (const id of ["discord", "youtube", "reddit", "tiktok", "pinterest"]) {
    assert.match(providers, new RegExp(`id: "${id}"`), `${id} is not a known network`);
  }
});

test("the chosen networks are what a run drafts for, and nonsense is dropped", () => {
  const agent = findConfigurableAgent("socials-manager");
  const settings = normalizeAgentSettings(agent, {
    networks: ["discord", "youtube", "reddit", "tiktok", "pinterest", "myspace"],
    images: true,
  });
  const defaults = socialsManagerDefaults(settings);

  assert.deepEqual(defaults.providerIds, [
    "discord",
    "youtube",
    "reddit",
    "tiktok",
    "pinterest",
  ]);
  assert.deepEqual(
    identity.parseSocialsManagerRequest("announce the launch", defaults).providerIds,
    defaults.providerIds,
  );
});

test("an unqualified Socials Manager run prefers connected accounts and still drafts offline", () => {
  const identity = source("src/lib/socials-manager/identity.ts");
  const manager = source("src/lib/socials-manager/run-manager.ts");
  const providers = source("src/lib/socials-manager/providers.ts");

  assert.doesNotMatch(identity, /DEFAULT_PROVIDER_IDS/);
  assert.match(manager, /const connectedProviderIds =/);
  assert.match(
    manager,
    /connectedProviderIds\.length\s*\? connectedProviderIds\s*:\s*\[\.\.\.OFFLINE_DRAFT_PROVIDER_IDS\]/,
  );
  assert.match(
    manager,
    /request\.providerIds\.length\s*\? request\.providerIds\s*:\s*automaticProviderIds/,
  );
  assert.match(providers, /OFFLINE_DRAFT_PROVIDER_IDS/);
  assert.match(providers, /"instagram"/);
  assert.doesNotMatch(manager, /No social accounts are connected/);
});

test("Bluesky and Mastodon are not networks this agent writes for", () => {
  // Removed on purpose: the registry is the single source of truth, so dropping
  // them here takes them out of drafting, the settings dialog and the stack env.
  for (const file of [
    "src/lib/socials-manager/providers.ts",
    "src/lib/socials-manager/stack.ts",
    "src/app/components/hermes/socials-manager-settings-dialog.tsx",
    "src/app/components/hermes/command-hub.tsx",
  ]) {
    assert.doesNotMatch(
      source(file),
      /bluesky|mastodon/i,
      `${file} still offers a removed network`,
    );
  }
});

test("a Socials Manager run counts the tokens it spends and keeps the count", () => {
  const client = source("src/lib/socials-manager/client.ts");
  const manager = source("src/lib/socials-manager/run-manager.ts");
  const artifacts = source("src/lib/socials-manager/artifacts.ts");
  const imageService = source("src/lib/hermes/artifact-image-service.ts");
  const inlineRun = source("src/app/components/hermes/inline-socials-manager-run.tsx");
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");

  // Both model calls a run can make report what they spent.
  assert.match(client, /onUsage\?: \(usage: unknown\) => void/);
  assert.match(client, /if \(data\.usage\) request\.onUsage\?\.\(data\.usage\)/);
  assert.match(imageService, /event\.type === "response\.completed" && event\.response\.usage/);
  assert.match(artifacts, /if \(generated\.usage\) input\.onUsage\?\.\(generated\.usage\)/);

  // The run accumulates them and streams the running total.
  assert.match(manager, /emit\(run, "run\.usage", \{ \.\.\.sumChatTokenUsage\(run\.spent\) \}\)/);
  assert.match(manager, /onUsage: \(usage\) => recordUsage\(run, usage\)/);
  assert.match(
    manager,
    /usage: \{ \.\.\.sumChatTokenUsage\(run\.spent\), responseDurationMs: elapsedMs \}/,
  );

  // The card shows the count live, saves it with the turn, and restores it.
  assert.match(inlineRun, /"run\.usage",/);
  assert.match(inlineRun, /<AssistantResponseMeta[\s\S]*?usage=\{usage\}/);
  assert.doesNotMatch(inlineRun, /showTokenUsage=\{false\}/);
  assert.match(inlineRun, /persistedUsage\?: ChatTokenUsage/);
  assert.match(inlineRun, /\.\.\.\(usageRef\.current \? \{ usage: usageRef\.current \} : \{\}\)/);
  for (const [host, name] of [
    [panel, "Terminal"],
    [garden, "Garden workspace"],
  ]) {
    const card = host.slice(host.indexOf("<InlineSocialsManagerRun"), host.indexOf("<InlineSocialsManagerRun") + 600);
    assert.match(card, /persistedUsage=\{(?:msg|message)\.usage\}/, `${name} drops the saved count`);
  }

  assert.match(inlineRun, /running: "Postiz is connected"/);
  assert.doesNotMatch(inlineRun, /running: "Postiz is running"/);
});

test("both chat surfaces launch the run and render it inline", () => {
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");

  // Terminal: launcher, routing, and the conversation the artifacts hang off.
  assert.match(terminal, /fetch\("\/api\/socials-manager\/runs"/);
  assert.match(terminal, /const conversationPublicId = await session\.ensureConversation\(\)/);
  assert.match(terminal, /conversationPublicId,/);
  assert.match(terminal, /taskFromSocialsManagerCommand\(text\)/);

  // Garden chat runs on legacy numeric sessions, so it sends that instead.
  assert.match(garden, /fetch\("\/api\/socials-manager\/runs"/);
  assert.match(garden, /chatSessionId: prepared\.session\.id/);
  assert.match(garden, /taskFromSocialsManagerCommand\(text\)/);
  assert.match(garden, /<InlineSocialsManagerRun/);

  assert.match(panel, /message\.socialsManagerRun \?/);
  assert.match(panel, /<InlineSocialsManagerRun/);
});

test("both chat surfaces show the Socials Manager message before run creation finishes", () => {
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");

  const terminalLaunch = terminal.indexOf("const launchSocialsManagerRun");
  const terminalPreview = terminal.indexOf(
    "session.previewExternalAgentTurn({",
    terminalLaunch,
  );
  const terminalFetch = terminal.indexOf('fetch("/api/socials-manager/runs"', terminalLaunch);
  assert.ok(terminalPreview > terminalLaunch && terminalPreview < terminalFetch);

  const gardenLaunch = garden.indexOf("async function launchSocialsManager");
  const gardenPreview = garden.indexOf("id: `socials-manager-pending-", gardenLaunch);
  const gardenFetch = garden.indexOf('fetch("/api/socials-manager/runs"', gardenLaunch);
  assert.ok(gardenPreview > gardenLaunch && gardenPreview < gardenFetch);
});

test("retries and alternate submit paths stay with the Socials Manager runner", () => {
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const session = source("src/app/components/hermes/use-agent-session.ts");

  assert.match(terminal, /const socialsManagerDispatchingRef = useRef\(false\)/);
  assert.match(terminal, /const routeSocialsManagerCommand = useCallback/);
  assert.match(terminal, /branchGroupId: options\.branchGroupId/);
  assert.match(
    terminal,
    /const sendQueued = useCallback[\s\S]*?routeSocialsManagerCommand\(trimmed\)/,
  );
  assert.match(
    terminal,
    /const editMessage = useCallback[\s\S]*?routeSocialsManagerCommand\(text, \{ branchGroupId \}\)/,
  );
  assert.match(
    terminal,
    /const retryMessage = useCallback[\s\S]*?routeSocialsManagerCommand\(previousUser\.content, \{ branchGroupId \}\)/,
  );
  assert.match(
    session,
    /const previewExternalAgentTurn = useCallback[\s\S]*?setError\(null\);[\s\S]*?setSteerError\(null\);/,
  );
});

test("a running Socials Manager turn counts as an active external agent", () => {
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const runs = source("src/lib/conversations/external-agent-runs.ts");
  assert.match(garden, /message\.socialsManagerRun \|\|/);
  // A finished Socials Manager run is claimed through the shared assistant-only matcher.
  assert.match(garden, /assistantExternalAgentRunId\(message\) === runId/);
  assert.match(runs, /"socialsManagerRun",/);
});

test("the inline card is the only Socials Manager surface", () => {
  // No standalone route may exist: the UI appears for the run and nowhere else.
  const routes = new URL("../src/app/postiz", import.meta.url);
  assert.equal(fs.existsSync(routes), false);
});

test("new drafts stay off the calendar until the user opts in", () => {
  const bridge = source("src/lib/socials-manager/calendar-bridge.ts");
  const runManager = source("src/lib/socials-manager/run-manager.ts");
  const card = source("src/app/components/hermes/inline-socials-manager-run.tsx");

  // Opted-in posts still use Breadboard's calendar, never a private table.
  assert.match(bridge, /from "\.\.\/calendar\/store\.ts"/);
  assert.match(bridge, /createEvent\(userId, \{/);
  assert.match(
    runManager,
    /if \(request\.scheduleAt && stores\) \{[\s\S]*?schedulePost\(stores, run\.userId, post\.id, request\.scheduleAt\)/,
  );
  assert.doesNotMatch(
    runManager,
    /schedulePost\(stores, run\.userId, post\.id, remoteDate\)/,
  );
  assert.match(runManager, /type: request\.scheduleAt \? "schedule" : "draft"/);

  // The normal path is an explicit, confirmed action in the inline result UI.
  assert.match(card, />\s*Add to calendar\s*</);
  assert.match(card, /scheduledAt: draftScheduleAt/);
  assert.match(card, />\s*Remove from calendar\s*</);
  assert.match(card, /Not on your calendar/);
});

test("the posts table references the calendar's own events table", () => {
  const schema = source("src/lib/socials-manager/schema.ts");
  const db = source("src/lib/db.ts");

  assert.match(
    schema,
    /calendar_event_id INTEGER REFERENCES calendar_events\(id\) ON DELETE SET NULL/,
  );
  // Ordering matters: the referenced table has to exist first.
  const calendarAt = db.indexOf("ensureCalendarSchema(db)");
  const socialsManagerAt = db.indexOf("ensureSocialsManagerSchema(db)");
  assert.ok(calendarAt > 0 && socialsManagerAt > calendarAt);
});

test("every drafted post is emitted as a durable artifact", () => {
  const artifacts = source("src/lib/socials-manager/artifacts.ts");
  const runManager = source("src/lib/socials-manager/run-manager.ts");
  const card = source("src/app/components/hermes/inline-socials-manager-run.tsx");
  const studio = source("src/app/components/hermes/socials-manager-post-studio.tsx");
  const inlineArtifacts = source(
    "src/app/components/hermes/inline-artifact-cards.tsx",
  );

  assert.match(artifacts, /createArtifact\(\{/);
  assert.match(artifacts, /renderArtifact\(\{/);
  assert.match(artifacts, /sourceHermesTool: SOCIALS_MANAGER_POST_TOOL/);
  // The artifact carries the post, not a rendering of its copy, so it is
  // written from the stored row rather than from the model's draft.
  assert.match(artifacts, /rendererId: SOCIALS_MANAGER_POST_RENDERER/);
  assert.match(runManager, /createPostArtifact\(artifactContext, post\)/);
  assert.match(runManager, /post\.artifact_ready/);
  assert.match(inlineArtifacts, /export function useInlineArtifactViewer/);
  assert.match(inlineArtifacts, /openArtifact: openArtifactById/);
  assert.match(inlineArtifacts, /await refresh\(\)/);
  assert.match(card, /const openArtifact = useInlineArtifactViewer\(\)/);
  // The draft artifact is reached from the post studio, through the same
  // in-transcript viewer — never as a link out of the chat.
  assert.match(card, /onOpenArtifact=\{\s*openArtifact \? \(artifactId\) => void openArtifact\(artifactId\) : null\s*\}/);
  assert.match(studio, /onOpenArtifact\(post\.artifactId as string\)/);
  assert.match(studio, />\s*Open draft artifact\s*</);
  assert.doesNotMatch(card, /href=\{`\/artifacts\/\$\{post\.artifactId\}`\}/);
});

test("a post artifact opens as the studio and follows the post it belongs to", () => {
  const artifacts = source("src/lib/socials-manager/artifacts.ts");
  const runManager = source("src/lib/socials-manager/run-manager.ts");
  const route = source("src/app/api/socials-manager/posts/[postId]/route.ts");
  const viewer = source("src/app/components/hermes/artifact-viewer.tsx");
  const studio = source("src/app/components/hermes/socials-manager-post-studio.tsx");
  const artifactView = source(
    "src/app/components/hermes/socials-manager-post-artifact.tsx",
  );

  // Clicking the artifact opens the editor, not the caption as text.
  assert.match(viewer, /artifact\?\.renderer === "socials-manager-post"/);
  assert.match(viewer, /<SocialsManagerPostArtifact stored=\{post\.stored\} artifact=\{artifact\}/);
  assert.match(viewer, /parseStoredSocialsPost/);
  assert.match(studio, /variant = "modal"/);
  assert.match(artifactView, /variant="inline"/);

  // The studio edits the live row, so the viewer reaches it by id.
  assert.match(route, /export async function GET\(/);
  assert.match(artifactView, /\/api\/socials-manager\/posts\/\$\{encodeURIComponent\(String\(postId\)\)\}/);
  assert.match(artifactView, /method: "PATCH"/);

  // And every write to a post rewrites the artifact that shows it — including
  // the run's own later steps, which land after the artifact was created.
  assert.match(artifacts, /export async function syncPostArtifact\(/);
  assert.match(
    artifacts,
    /artifact\.renderer_id !== SOCIALS_MANAGER_POST_RENDERER\) return null/,
  );
  assert.match(runManager, /await syncPostArtifact\(run\.userId, post\)/);
  assert.match(route, /await syncPostArtifact\(userId, post\)/);
});

test("the inline Socials Manager card restores every durable post after chat remounts", () => {
  const card = source("src/app/components/hermes/inline-socials-manager-run.tsx");
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const session = source("src/app/components/hermes/use-agent-session.ts");

  assert.match(card, /\/api\/socials-manager\/posts\?runId=\$\{encodeURIComponent\(runId\)\}/);
  assert.match(card, /presentStoredPost\(post, providers\)/);
  assert.match(card, /post\.artifactId/);
  assert.match(card, /post\.calendarEventId/);
  assert.match(card, /post\.remoteId/);
  assert.match(card, /Restoring saved posts…/);
  assert.match(session, /ensureConversation: \(\) => Promise<string>/);
  assert.match(terminal, /const conversationPublicId = await session\.ensureConversation\(\)/);
  assert.match(terminal, /conversationPublicId,/);
});

test("desktop owns optional background publishing-stack startup and Next instrumentation does not", () => {
  const instrumentation = source("src/instrumentation-node.ts");
  const definitions = desktopSource("src/main/service-definitions.ts");
  const launcher = fs.readFileSync(
    new URL("../../scripts/start-postiz-supervisor.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(instrumentation, /autostartPostizStack|postiz\/autostart/);
  assert.match(definitions, /id: "postiz"/);
  assert.match(definitions, /required: false,[\s\S]*startInBackground: true/);
  assert.match(definitions, /SOCIALS_MANAGER_SUPPRESS_DOCKER_UI: "true"/);
  assert.match(definitions, /dependsOn: \["chatmock", "quartz"\]/);
  assert.match(launcher, /ensureApiKey\(config\)/);
  assert.match(launcher, /listIntegrations\(\)/);
  assert.match(launcher, /server\.listen\(healthPort, host/);
});

test("the inline card is styled with the shared neumorphic material", () => {
  const card = source("src/app/components/hermes/inline-socials-manager-run.tsx");

  for (const className of [
    "bb-agent-run-card",
    "bb-agent-run-header",
    "bb-agent-run-icon",
    "bb-agent-run-pill",
    "bb-agent-run-inset",
    "bb-agent-run-panel",
    "neu-button",
    "neu-inset",
  ]) {
    assert.ok(card.includes(className), `${className} is missing from the card`);
  }
  // No brand colours: the card has to read as part of the chat.
  assert.doesNotMatch(card, /#[0-9a-f]{6}/i);
});
