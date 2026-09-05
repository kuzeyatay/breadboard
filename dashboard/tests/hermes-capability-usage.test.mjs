// What a turn used, as opposed to what it had.
//
// The distinction this file exists to protect: a super-agent turn is handed the
// whole catalogue, so "available" and "used" must never collapse into each
// other. Everything reported here is either a selection Breadboard recorded
// before dispatch or a call that actually completed.

import test from "node:test";
import assert from "node:assert/strict";
import {
  capabilityForTool,
  summarizeCapabilityUse,
  turnCapabilitySelection,
} from "../src/lib/hermes/capability-usage.ts";

test("skill-owned tools are attributed to the skill that owns them", () => {
  assert.deepEqual(capabilityForTool("watch_run"), {
    kind: "skill",
    id: "watch",
    label: "Watch",
  });
  assert.equal(capabilityForTool("factcheck_run")?.id, "bullshit-detector");
  assert.equal(
    capabilityForTool("patent_disclosure_guide")?.id,
    "patent-disclosure-skill",
  );
  assert.equal(capabilityForTool("audio_compare")?.id, "audio-analysis");
  assert.equal(capabilityForTool("office_export")?.id, "office");
  assert.deepEqual(capabilityForTool("computer_use"), {
    kind: "skill",
    id: "computer-use",
    label: "Computer use",
  });
  // Breadboard's own products are named too, but never as skills: nobody
  // installed them and there is no slash command to type.
  assert.deepEqual(capabilityForTool("calendar_agenda"), {
    kind: "integration",
    id: "calendar",
    label: "Calendar",
  });
  assert.equal(capabilityForTool("map_route")?.kind, "integration");
  // A plain runtime tool belongs to nothing. Inventing an owner for `read`
  // would fill the panel with rows that mean nothing.
  assert.equal(capabilityForTool("read"), null);
  assert.equal(capabilityForTool("bash"), null);
});

test("an automatic selection is reported as automatic, with its reason", () => {
  const summary = summarizeCapabilityUse({
    selection: {
      superAgent: true,
      inventory: { skills: 118, connections: 12, workflows: 4 },
      skills: [
        {
          slug: "watch",
          selection: "automatic",
          reason: "The message linked a video.",
        },
      ],
    },
    toolCalls: [{ toolName: "watch_run", success: true }],
  });
  assert.equal(summary.superAgent, true);
  assert.deepEqual(summary.inventory, {
    skills: 118,
    connections: 12,
    workflows: 4,
  });
  assert.equal(summary.used.length, 1);
  const [watch] = summary.used;
  assert.equal(watch.id, "watch");
  assert.equal(watch.selection, "automatic");
  assert.equal(watch.reason, "The message linked a video.");
  assert.equal(watch.calls, 1);
  assert.equal(watch.failures, 0);
  assert.equal(watch.command, "/watch");
});

test("a skill with no recorded reason falls back to its selector's criterion", () => {
  const summary = summarizeCapabilityUse({
    selection: {
      skills: [{ slug: "bullshit-detector", selection: "automatic" }],
    },
    toolCalls: [{ toolName: "factcheck_run", success: false }],
  });
  assert.equal(summary.used[0].reason, "The message asked for a claim to be checked.");
  assert.equal(summary.used[0].failures, 1);

  const patent = summarizeCapabilityUse({
    selection: {
      skills: [{ slug: "patent-disclosure-skill", selection: "automatic" }],
    },
    toolCalls: [{ toolName: "patent_disclosure_guide", success: true }],
  });
  assert.equal(
    patent.used[0].reason,
    "The message asked for patent drafting, analysis, or response work.",
  );
});

test("having the catalogue is not using it", () => {
  const summary = summarizeCapabilityUse({
    selection: {
      superAgent: true,
      inventory: { skills: 118, connections: 12, workflows: 4 },
    },
    toolCalls: [
      { toolName: "read", success: true },
      { toolName: "bash", success: true },
    ],
  });
  assert.deepEqual(summary.used, []);
  assert.equal(summary.superAgent, true);
});

test("a skill the model chose itself is reported as the agent's choice", () => {
  const summary = summarizeCapabilityUse({
    selection: { superAgent: true },
    toolCalls: [{ toolName: "omh_run", success: true }],
    skillOpens: [{ slug: "apple-design" }],
  });
  const byId = Object.fromEntries(summary.used.map((use) => [use.id, use]));
  assert.equal(byId["oh-my-hermes"].selection, "agent");
  assert.equal(byId["apple-design"].selection, "agent");
  assert.deepEqual(byId["apple-design"].actions, ["opened"]);
});

test("a recorded selection outranks the fallback assumed for a bare call", () => {
  const summary = summarizeCapabilityUse({
    selection: { skills: [{ slug: "watch", selection: "requested" }] },
    toolCalls: [{ toolName: "watch_run", success: true }],
  });
  assert.equal(summary.used.length, 1);
  assert.equal(summary.used[0].selection, "requested");
  assert.equal(summary.used[0].calls, 1);
});

test("a selected skill that never ran is reported as selected, not as used", () => {
  const summary = summarizeCapabilityUse({
    selection: { skills: [{ slug: "premortem", selection: "requested" }] },
    toolCalls: [],
  });
  assert.equal(summary.used[0].calls, 0);
});

test("connections and automations are named by what they actually did", () => {
  const summary = summarizeCapabilityUse({
    selection: { workflows: [{ id: "wf-7", name: "Daily digest" }] },
    connectionCalls: [
      { slug: "gmail", tool: "GMAIL_SEND_EMAIL", success: true },
      { slug: "gmail", tool: "GMAIL_FETCH_EMAILS", success: false },
    ],
    workflowRuns: [{ workflowId: "wf-7", success: true }],
  });
  const gmail = summary.used.find((use) => use.kind === "connection");
  assert.equal(gmail.calls, 2);
  assert.equal(gmail.failures, 1);
  assert.deepEqual(gmail.actions, ["GMAIL_SEND_EMAIL", "GMAIL_FETCH_EMAILS"]);
  const workflow = summary.used.find((use) => use.kind === "workflow");
  assert.equal(workflow.label, "Daily digest");
  assert.equal(workflow.calls, 1);
});

test("what ran is listed before what was merely selected", () => {
  const summary = summarizeCapabilityUse({
    selection: {
      skills: [
        { slug: "premortem", selection: "requested" },
        { slug: "watch", selection: "automatic" },
      ],
    },
    toolCalls: [{ toolName: "watch_run", success: true }],
  });
  assert.deepEqual(
    summary.used.map((use) => use.id),
    ["watch", "premortem"],
  );
});

test("only a selection the resolver kept becomes automatic", () => {
  // Watch selected automatically and survived; Image to 3D was dropped by the
  // availability fallback, so it is not in the invocation list and must not
  // appear at all — it never ran.
  const selection = turnCapabilitySelection({
    invocations: [
      { kind: "skill", slug: "watch" },
      { kind: "mcp", slug: "notion" },
    ],
    automaticSkills: [{ slug: "watch" }, { slug: "image-to-3d" }],
    superAgent: true,
    inventory: { skills: 3, connections: 1, workflows: 0 },
  });
  assert.deepEqual(selection.skills, [{ slug: "watch", selection: "automatic" }]);
  assert.deepEqual(selection.connections, [{ slug: "notion" }]);
  assert.equal(selection.superAgent, true);
});

test("a skill the user typed is not reported as an automatic selection", () => {
  const selection = turnCapabilitySelection({
    invocations: [{ kind: "skill", slug: "premortem" }],
    automaticSkills: [],
  });
  assert.equal(selection.skills[0].selection, "requested");
  assert.equal(selection.superAgent, undefined);
});
