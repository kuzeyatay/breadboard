import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  RUNTIME_AGENT_PROFILES,
  attachmentRuntimeAgents,
  findCapabilityConflict,
  leadingCapabilityTokens,
  runtimeAgentById,
  runtimeAgentByToken,
  stackingRuntimeAgents,
} from "../src/lib/hermes/capability-combinations.ts";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";
import { taskFromCodexCommand } from "../src/lib/codex/identity.ts";
import { taskFromOpenCodeCommand } from "../src/lib/opencode/identity.ts";
import { taskFromRufloCommand } from "../src/lib/ruflo/identity.ts";
import { taskFromSocialsManagerCommand } from "../src/lib/socials-manager/identity.ts";
import { taskFromHardwareBlueprintCommand } from "../src/lib/hardware/identity.ts";
import { taskFromParametricCadCommand } from "../src/lib/cad/identity.ts";

const root = path.resolve(".");
const api = path.join(root, "src", "app", "api");

function routeSource(...segments) {
  return fs.readFileSync(path.join(api, ...segments, "route.ts"), "utf8");
}

/** Every runtime agent's run route, so the declared traits stay checkable. */
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

test("the runtime agent table covers every agent and every agent has a run route", () => {
  assert.deepEqual(
    RUNTIME_AGENT_PROFILES.map((agent) => agent.id).sort(),
    Object.keys(RUN_ROUTES).sort(),
  );
  for (const agent of RUNTIME_AGENT_PROFILES) {
    assert.equal(runtimeAgentById(agent.id), agent);
    assert.equal(runtimeAgentByToken(agent.token), agent);
    assert.equal(runtimeAgentByToken(agent.command), agent);
    assert.equal(agent.command, `/${agent.token}`);
    assert.ok(agent.surfaces.length > 0, `${agent.id} runs nowhere`);
    assert.ok(!agent.surfaces.includes("quartz_ai"), `${agent.id} claims Quartz`);
  }
});

test("stacksCapabilities matches which run routes actually resolve capability tokens", () => {
  for (const agent of RUNTIME_AGENT_PROFILES) {
    const source = routeSource(...RUN_ROUTES[agent.id]);
    const resolves = /resolveCommandMessage\(/.test(source);
    assert.equal(
      resolves,
      agent.stacksCapabilities,
      `${agent.id}: route ${resolves ? "resolves" : "does not resolve"} capability tokens but the profile says stacksCapabilities=${agent.stacksCapabilities}`,
    );
    if (agent.stacksCapabilities) {
      assert.match(
        source,
        new RegExp(`executionTarget:\\s*"${agent.id}"`),
        `${agent.id}: route must name itself as the execution target`,
      );
    }
  }
  assert.deepEqual(
    stackingRuntimeAgents().map((agent) => agent.id),
    ["codex", "opencode", "ruflo"],
  );
});

test("acceptsAttachments matches which run routes actually take files", () => {
  for (const agent of RUNTIME_AGENT_PROFILES) {
    const source = routeSource(...RUN_ROUTES[agent.id]);
    // Two shapes count as taking a file. A coding agent forwards the whole
    // attachment list; Video Use consumes exactly one — the video the composer
    // already stored — and addresses it by its blob id, because a path from a
    // page is a path the server must not open.
    const takesFiles = /\battachments\b|\bblobId\b/.test(source);
    assert.equal(
      takesFiles,
      agent.acceptsAttachments,
      `${agent.id}: route ${takesFiles ? "takes" : "ignores"} attachments but the profile says acceptsAttachments=${agent.acceptsAttachments}`,
    );
  }
  // Codex, OpenCode, and Ruflo take whatever is attached; Video Use takes exactly one
  // kind, a video, and that video is its entire input rather than context for a
  // message. The Legal Agent is the fourth shape: the attachments are the
  // documents it works on, written into its workspace before the run starts.
  // Meeting Notes is the fifth, and the only one that does not require the
  // attachment: a recording is the usual input, but a run with none falls back
  // to the newest recording on the conversation, which is what lets a model
  // launch it with nothing but a sentence.
  assert.deepEqual(
    attachmentRuntimeAgents().map((agent) => agent.id),
    ["codex", "opencode", "ruflo", "meeting-notes", "video-use", "legal", "wardrobe"],
  );
});

test("the leading token grammar separates agents, personas, and capabilities", () => {
  const parsed = leadingCapabilityTokens(
    "/study-guide /agents:agency-agents:ux-researcher /agents:codex /agents:nope fix the parser",
  );
  assert.deepEqual(
    parsed.tokens.map((item) => [item.token, item.kind]),
    [
      ["study-guide", "capability"],
      ["agents:agency-agents:ux-researcher", "persona"],
      ["agents:codex", "runtime_agent"],
      ["agents:nope", "unknown_runtime_agent"],
    ],
  );
  assert.equal(parsed.rest, "fix the parser");

  // Prose, code, and paths are not capability tokens.
  for (const text of [
    "Please document `/agent:frontend-developer` without selecting it.",
    "```\n/agents:codex\n```",
    "/usr/bin/env matters here",
    "compare /agents:codex and /agents:ruflo in a sentence",
  ]) {
    assert.deepEqual(leadingCapabilityTokens(text).tokens, [], text);
    assert.equal(findCapabilityConflict({ text, surface: "dashboard_terminal" }), null);
  }
});

test("two runtime agents in one message are refused by name", () => {
  const conflict = findCapabilityConflict({
    text: "/agents:codex /agents:deep-research compare the batteries",
    surface: "dashboard_terminal",
  });
  assert.equal(conflict?.code, "conflicting_runtime_agents");
  assert.match(conflict.message, /Codex and Deep Research/);
  assert.match(conflict.message, /\/agents:codex/);
  assert.match(conflict.message, /\/agents:deep-research/);

  // The same agent named twice is a typo, not a conflict.
  assert.equal(
    findCapabilityConflict({
      text: "/agents:codex /agents:codex fix it",
      surface: "dashboard_terminal",
    }),
    null,
  );
});

test("a stacked skill is allowed only for the agents whose route resolves it", () => {
  for (const agent of RUNTIME_AGENT_PROFILES) {
    if (!agent.surfaces.includes("dashboard_terminal")) continue;
    const conflict = findCapabilityConflict({
      text: `/study-guide ${agent.command} do the work`,
      surface: "dashboard_terminal",
    });
    if (agent.stacksCapabilities) {
      assert.equal(conflict, null, `${agent.id} should carry a stacked skill`);
      continue;
    }
    assert.equal(
      conflict?.code,
      "runtime_agent_capability_conflict",
      `${agent.id} must refuse a stacked skill`,
    );
    assert.match(conflict.message, new RegExp(agent.name));
    assert.match(conflict.message, /\/study-guide/);
    // The message points at the agents that can do it.
    assert.match(conflict.message, /Codex, OpenCode, and Ruflo/);
  }
});

test("attachments are allowed only for the agents whose route forwards them", () => {
  for (const agent of RUNTIME_AGENT_PROFILES) {
    if (!agent.surfaces.includes("dashboard_terminal")) continue;
    const conflict = findCapabilityConflict({
      text: `${agent.command} review this`,
      surface: "dashboard_terminal",
      attachmentCount: 2,
    });
    if (agent.acceptsAttachments) {
      assert.equal(conflict, null, `${agent.id} should accept attachments`);
      continue;
    }
    assert.equal(
      conflict?.code,
      "runtime_agent_attachment_conflict",
      `${agent.id} must refuse attachments`,
    );
    assert.match(conflict.message, /Remove the 2 attached files/);
    assert.match(
      conflict.message,
      /Codex, OpenCode, Ruflo, Meeting Notes, Video Use, Legal Agent, and Wardrobe/,
    );
  }
});

test("an agent selected in the palette is held to the same rules as a typed token", () => {
  const stacked = findCapabilityConflict({
    text: "/study-guide summarize the sources",
    surface: "dashboard_terminal",
    activeRuntimeAgentId: "deep-research",
  });
  assert.equal(stacked?.code, "runtime_agent_capability_conflict");
  assert.match(stacked.message, /clear Deep Research first/);

  const attached = findCapabilityConflict({
    text: "read this",
    surface: "dashboard_terminal",
    attachmentCount: 1,
    activeRuntimeAgentId: "agent-reach",
  });
  assert.equal(attached?.code, "runtime_agent_attachment_conflict");
  assert.match(attached.message, /Remove the 1 attached file\b/);

  // Codex is selected and carries both.
  assert.equal(
    findCapabilityConflict({
      text: "/study-guide fix the parser",
      surface: "dashboard_terminal",
      attachmentCount: 3,
      activeRuntimeAgentId: "codex",
    }),
    null,
  );
});

test("an Agency persona never rides along with a runtime agent", () => {
  for (const activeRuntimeAgentId of ["codex", "deep-research"]) {
    const conflict = findCapabilityConflict({
      text: "/agents:agency-agents:ux-researcher review the flow",
      surface: "dashboard_terminal",
      activeRuntimeAgentId,
    });
    assert.equal(conflict?.code, "runtime_agent_persona_conflict");
    assert.match(conflict.message, /\/agents:agency-agents:ux-researcher/);
  }
  // Without a runtime agent a persona is ordinary.
  assert.equal(
    findCapabilityConflict({
      text: "/agent:ux-researcher review the flow",
      surface: "dashboard_terminal",
    }),
    null,
  );
});

test("an agent is refused on a surface that has no runner for it", () => {
  const conflict = findCapabilityConflict({
    text: "/agents:agent-tars open the dashboard",
    surface: "garden_chat",
  });
  assert.equal(conflict?.code, "runtime_agent_surface_unavailable");
  assert.match(conflict.message, /Agent TARS runs in the Terminal, not Garden Chat/);
  assert.equal(
    findCapabilityConflict({
      text: "/agents:agent-tars open the dashboard",
      surface: "dashboard_terminal",
    }),
    null,
  );
  for (const agent of RUNTIME_AGENT_PROFILES) {
    assert.equal(
      findCapabilityConflict({ text: agent.command, surface: "quartz_ai" })?.code,
      "runtime_agent_surface_unavailable",
      `${agent.id} must be refused on Quartz`,
    );
  }
});

test("a misspelled runtime agent says so instead of falling through", () => {
  const conflict = findCapabilityConflict({
    text: "/agents:deepresearch compare the batteries",
    surface: "dashboard_terminal",
  });
  assert.equal(conflict?.code, "unknown_runtime_agent");
  assert.match(conflict.message, /\/agents:deepresearch/);
});

test("the stacking parsers hand the preserved token to a route that resolves it", () => {
  assert.equal(
    taskFromCodexCommand("/study-guide /agents:codex fix the parser"),
    "/study-guide fix the parser",
  );
  assert.equal(
    taskFromOpenCodeCommand("/study-guide /agents:opencode fix the parser"),
    "/study-guide fix the parser",
  );
  assert.equal(
    taskFromRufloCommand("/study-guide /agents:ruflo fix the parser"),
    "/study-guide fix the parser",
  );
  // Socials Manager, Hardware Blueprint and Parametric CAD preserve the token too, but
  // none of their runs resolve it — so the combination is refused before it can
  // become prose.
  for (const [parse, id] of [
    [taskFromSocialsManagerCommand, "socials-manager"],
    [taskFromHardwareBlueprintCommand, "hardware-blueprint"],
    [taskFromParametricCadCommand, "parametric-cad"],
  ]) {
    const agent = runtimeAgentById(id);
    const brief = parse(`/study-guide ${agent.command} draft it`);
    assert.equal(brief, "/study-guide draft it");
    assert.equal(
      findCapabilityConflict({
        text: brief,
        surface: "dashboard_terminal",
        activeRuntimeAgentId: id,
      })?.code,
      "runtime_agent_capability_conflict",
    );
  }
});

test("both chat surfaces check the combination before any runtime is dispatched", () => {
  const surfaces = [
    {
      label: "terminal",
      file: "src/app/components/hermes/dashboard-agent-terminal.tsx",
      entry: "const submit = useCallback(",
      surface: '"dashboard_terminal"',
      attachments: "chatAttachments.length",
      report: "setAttachmentStatus(conflict.message)",
    },
    {
      label: "garden chat",
      file: "src/app/gardens/[clusterSlug]/workspace-client.tsx",
      entry: "async function handleSubmit(",
      surface: '"garden_chat"',
      attachments: "pendingAttachments.length",
      report: "setExternalAgentStatus(conflict.message)",
    },
  ];
  for (const surface of surfaces) {
    const code = fs.readFileSync(path.join(root, surface.file), "utf8");
    const entry = code.indexOf(surface.entry);
    assert.ok(entry > 0, `${surface.label}: no submit handler`);
    const check = code.indexOf("findCapabilityConflict({", entry);
    // The first runtime the cascade can claim. The check has to precede it, or
    // the winner is picked before the combination is ever examined.
    const dispatch = code.indexOf("taskFromCodexCommand(text)", entry);
    assert.ok(check > entry, `${surface.label}: submit never checks the combination`);
    assert.ok(
      check < dispatch,
      `${surface.label}: the combination is checked after dispatch has begun`,
    );
    const body = code.slice(check, dispatch);
    assert.ok(body.includes(`surface: ${surface.surface}`), surface.label);
    assert.ok(
      body.includes(`attachmentCount: ${surface.attachments}`),
      `${surface.label}: attachments are not counted`,
    );
    assert.ok(body.includes("activeRuntimeAgentId"), surface.label);
    assert.ok(
      body.includes(surface.report),
      `${surface.label}: the conflict is not shown to the user`,
    );
    assert.ok(body.includes("return;"), `${surface.label}: the send is not stopped`);
  }
});

test("the server refuses the same combinations the composer does", async () => {
  await assert.rejects(
    () =>
      resolveCommandMessage(1, "/agents:codex /agents:deep-research compare", root, {
        mode: "knowledge",
        surface: "dashboard_terminal",
      }),
    (error) => error?.code === "conflicting_runtime_agents",
  );
  await assert.rejects(
    () =>
      resolveCommandMessage(1, "/agents:agent-tars open the dashboard", root, {
        mode: "knowledge",
        surface: "garden_chat",
      }),
    (error) => error?.code === "runtime_agent_surface_unavailable",
  );
  await assert.rejects(
    () =>
      resolveCommandMessage(1, "/agent:ux-researcher fix the parser", root, {
        mode: "scoped_implementation",
        surface: "dashboard_terminal",
        executionTarget: "codex",
      }),
    (error) => error?.code === "runtime_agent_persona_conflict",
  );
});

test("every runtime agent reaching the resolver is named, including Ruflo", async () => {
  for (const agent of RUNTIME_AGENT_PROFILES) {
    if (!agent.surfaces.includes("dashboard_terminal")) continue;
    await assert.rejects(
      () =>
        resolveCommandMessage(1, `${agent.command} do the work`, root, {
          mode: "knowledge",
          surface: "dashboard_terminal",
        }),
      (error) =>
        error?.code === "external_agent_dispatch_required" &&
        error.message.includes(agent.name) &&
        /chat runner/.test(error.message),
      `${agent.id} degraded into a generic capability error`,
    );
  }
});
