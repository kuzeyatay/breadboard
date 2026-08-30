// How a Max Research turn is entered, and what the transcript keeps of it.
//
// Typing "…do max research" used to rewrite the person's message into
// `/agents:max-research …` in front of them. Nothing was broken by it — the run
// was correct — but the chat visibly edited what they had said, which reads as
// the software correcting them. Deep Research has always passed the original
// wording through, and this is Max Research being held to the same rule.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAX_RESEARCH_COMMAND,
  maxResearchInvocation,
  maxResearchUserMessage,
} from "../src/lib/max-research/identity.ts";

const source = (relativePath) =>
  fs
    .readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");

test("the slash command and plain language are told apart", () => {
  const typed = "if i want to go into robotics, what niche would be the highest roi, do max research";
  const spoken = maxResearchInvocation(typed);
  assert.equal(spoken.selectAgent, false, "plain language must not claim the composer agent");
  assert.equal(
    spoken.question,
    "if i want to go into robotics, what niche would be the highest roi",
  );

  const command = maxResearchInvocation(`${MAX_RESEARCH_COMMAND} how do tariffs work`);
  assert.equal(command.selectAgent, true);
  assert.equal(command.question, "how do tariffs work");
});

test("both chat surfaces keep the words the person used", () => {
  for (const file of [
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
    "src/app/components/hermes/garden-agent-chat.tsx",
  ]) {
    const text = source(file);
    const route = text.slice(text.indexOf("routeMaxResearchCommand"));
    assert.match(
      route,
      /invocation\.selectAgent \? \{\} : \{ userContent: text \}/,
      `${file} should record the original message unless the command itself was typed`,
    );
  }

  // The launcher has to honour it rather than rebuild the canonical form.
  assert.match(
    source("src/app/components/hermes/launch-max-research.ts"),
    /input\.userContent\?\.trim\(\) \|\| maxResearchUserMessage\(question\)/,
  );
});

test("the canonical message is still what a typed command produces", () => {
  // Unchanged behaviour, and worth keeping: a person who typed the command sees
  // the command, because that is literally what they wrote.
  assert.equal(
    maxResearchUserMessage("how do tariffs work"),
    `${MAX_RESEARCH_COMMAND} how do tariffs work`,
  );
});

test("asking about the feature is not asking for it", () => {
  for (const value of ["what is max research?", "how does max research work?"]) {
    assert.equal(maxResearchInvocation(value), null, value);
  }
});

test("stopping is offered from the moment a run is asked for", () => {
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  assert.match(
    panel,
    /const canStop = activeRun \|\| externalStops\.length > 0 \|\| externalRunActive;/,
    "the dispatch window is exactly when the square used to be missing",
  );
  // A button that appears and does nothing would be worse than none, so a stop
  // asked for during dispatch is held and spent once the run registers.
  assert.match(panel, /awaitingStopRef\.current = true;/);
  assert.match(
    panel,
    /if \(!awaitingStopRef\.current \|\| externalStops\.length === 0\) return;/,
  );
  assert.match(panel, /void abortExternalRuns\(externalStops\)/);
});

test("under Super Agent, plain language delegates privately through the model", () => {
  const typed = "which robotics niche has the highest roi, do max research";

  assert.equal(maxResearchInvocation(typed, false).selectAgent, false);
  assert.equal(maxResearchInvocation(typed, true), null);
  assert.equal(
    maxResearchInvocation(`${MAX_RESEARCH_COMMAND} same question`, true).selectAgent,
    true,
  );
});

test("both surfaces ask whether Super Agent owns the Max Research request", () => {
  for (const file of [
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
    "src/app/components/hermes/garden-agent-chat.tsx",
  ]) {
    assert.match(
      source(file),
      /maxResearchInvocation\(text, isSuperAgentEnabled\(\)\)/,
      `${file} must not launch a visible run behind Super Agent`,
    );
  }
});

test("the Super Agent is told to launch it, and the rule is reachable", async () => {
  const combinations = await import("../src/lib/hermes/capability-combinations.ts");
  const prompt = source("src/lib/hermes/super-agent.ts");

  // The rule sits behind `available.has("max-research")`, where `available` is
  // the model-launchable agents for the surface. Asserting the sentence exists
  // proves nothing if that gate can never open, so both halves are checked.
  assert.match(prompt, /available\.has\("max-research"\)/);
  assert.match(
    prompt,
    /launch `max-research` with `agent_launch`/,
    "without this the model substitutes its own web_search — which is exactly what a live turn did",
  );
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    assert.ok(
      combinations
        .modelLaunchableRuntimeAgents(surface)
        .some((agent) => agent.id === "max-research"),
      `max-research must be model-launchable on ${surface} for the rule to render`,
    );
  }
});

test("a direct non-Super-Agent launch is durable before a page callback can be lost", () => {
  const launcher = source("src/app/components/hermes/launch-max-research.ts");
  assert.match(
    launcher,
    /const conversationId = await session\.ensureConversation\(clientMessageId\);/,
  );
  assert.match(launcher, /keepalive: true,/);
  for (const field of [
    "conversationId",
    "clientMessageId",
    "userContent",
  ]) {
    assert.match(launcher, new RegExp(`\\b${field},`));
  }

  const route = source("src/app/api/max-research/runs/route.ts");
  assert.match(route, /getConversationForUser\(durableTurn\.conversationId, userId\)/);
  assert.match(route, /recordExternalAgentTurn\(\{/);
  assert.match(route, /requestId: durableTurn\.clientMessageId/);
  assert.match(route, /kind: "max_research",/);
  assert.match(route, /await abortRun\(userId, run\.runId\)/);
});
