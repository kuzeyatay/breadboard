// The runtime-agent catalogue a super-agent turn reads before it delegates.
//
// The prompt used to list agents by name alone, which gave the model two ways to
// choose and no way to reason: launch on topic match, or never launch at all.
// `runtime-agent-briefs.ts` is what replaced that, so the promises worth pinning
// down here are the ones that quietly rot.
//
// Drift is the first. A runtime agent is added by appending one `profile(...)`
// line, and nothing about that line forces a brief to exist. An agent with no
// brief is not visibly broken — it renders as a bare name, exactly the failure
// this module was written to remove — so the coverage check runs in both
// directions, because a mistyped key is as silent as a missing one.
//
// The second is the framing. A catalogue this detailed is also an invitation to
// delegate, and the text that makes "none of them" the default is the only thing
// standing against that. It is prose, so it is deletable without breaking a
// build; these assertions are what make deleting it fail.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  RUNTIME_AGENT_BRIEFS,
  RUNTIME_AGENT_GROUPS,
  runtimeAgentBrief,
} from "../src/lib/hermes/runtime-agent-briefs.ts";
import { RUNTIME_AGENT_PROFILES } from "../src/lib/hermes/capability-combinations.ts";

const superAgent = fs.readFileSync(
  new URL("../src/lib/hermes/super-agent.ts", import.meta.url),
  "utf8",
);

test("every runtime agent has a brief, and every brief a runtime agent", () => {
  const ids = new Set(RUNTIME_AGENT_PROFILES.map((agent) => agent.id));

  const missing = [...ids].filter((id) => !RUNTIME_AGENT_BRIEFS[id]);
  assert.deepEqual(
    missing,
    [],
    `runtime agents with no brief, so they reach the model as a bare name: ${missing.join(", ")}`,
  );

  // The other direction catches the typo that a one-directional check misses:
  // a key of `deepresearch` leaves the real agent undescribed while the map
  // still looks complete.
  const orphans = Object.keys(RUNTIME_AGENT_BRIEFS).filter((id) => !ids.has(id));
  assert.deepEqual(
    orphans,
    [],
    `briefs describing no real agent: ${orphans.join(", ")}`,
  );

  const groups = new Set(RUNTIME_AGENT_GROUPS.map((group) => group.key));
  for (const [id, brief] of Object.entries(RUNTIME_AGENT_BRIEFS)) {
    assert.ok(groups.has(brief.group), `${id} sits in no rendered group`);
    // An entry only renders inside its group heading, so a brief in an unknown
    // group would silently vanish from the catalogue.
    assert.ok(brief.does.trim().length > 40, `${id} says too little to choose on`);
  }
});

test("launchable agents say when to choose them; form-driven ones do not", () => {
  for (const agent of RUNTIME_AGENT_PROFILES) {
    const brief = runtimeAgentBrief(agent.id);
    if (agent.launchableByModel) {
      // Without this the entry describes an agent but never says when it wins,
      // which is the half the decision actually turns on.
      assert.ok(
        brief.choose,
        `${agent.id} can be launched but never says when it is the right choice`,
      );
    } else {
      // These cannot be launched at all, so "choose it when" would be advice
      // toward a tool call that is refused. They get what they are, and stop.
      assert.equal(
        brief.choose,
        undefined,
        `${agent.id} is form-driven, so it must not be offered as a choice`,
      );
    }
  }
});

test("agents that share a domain are separated by input shape, not topic", () => {
  // The catalogue's whole reason for existing. Each of these pairs is one topic
  // with two agents, and a description that only names the topic cannot tell
  // them apart — so each entry has to point at its neighbour and say how it
  // differs. Asserted as data rather than prose: these are the distinctions,
  // and losing one puts the pair back to being picked by list order.
  const pairs = [
    ["vimax", /MoneyPrinter/],
    ["money-printer", /ViMax/],
    ["stock-analyst", /Vibe Trading/],
    ["vibe-trading", /Stock Analyst/],
    ["get-doc", /Deep Research/],
    ["openscience", /Get Doc|Deep Research/],
    ["opencode", /Codex/],
    ["ruflo", /Codex/],
  ];
  for (const [id, expected] of pairs) {
    const brief = runtimeAgentBrief(id);
    assert.match(
      `${brief.does} ${brief.choose ?? ""}`,
      expected,
      `${id} never distinguishes itself from the agent it is confused with`,
    );
  }

  // Paper Trader is the one in its domain that acts and keeps acting, and that
  // is the fact a chooser needs most.
  assert.match(runtimeAgentBrief("paper-trader").choose, /standing commitment/);
  // The three read-only market agents must each say they cannot trade, or the
  // model can offer to place an order through one.
  for (const id of ["vibe-trading", "stock-analyst"]) {
    assert.match(runtimeAgentBrief(id).does, /cannot place a trade/);
  }
});

test("the catalogue makes launching nothing the default", () => {
  // The request this was built for was explicit that selecting no agent has to
  // stay a real outcome, so the default is stated before any agent is listed.
  assert.match(superAgent, /Choosing well starts with choosing whether/);
  assert.match(superAgent, /the honest default is none of them/);
  assert.match(superAgent, /launch nothing and answer/);

  // The test that replaces topic matching: name the capability this turn lacks.
  assert.match(superAgent, /what does this agent reach that I cannot\?/);
  assert.match(superAgent, /is \*about\* an agent's topic is not one of them/);

  // One at a time, reconsidering on the way back — and a second agent only for
  // a different job, because "more agents" otherwise reads as thoroughness.
  assert.match(superAgent, /Then decide how many/);
  assert.match(superAgent, /one job done twice/);

  // Outward actions are called out as a higher bar than reads.
  assert.match(superAgent, /what starting one commits the user to/);
});

test("the catalogue renders grouped, described, and by id only where launchable", () => {
  assert.match(superAgent, /function runtimeAgentCatalogue/);
  assert.match(superAgent, /sections\.push\(runtimeAgentCatalogue\(inventory\)\)/);
  // Grouped by domain, from the shared group order rather than a second list.
  assert.match(superAgent, /RUNTIME_AGENT_GROUPS\.flatMap/);
  assert.match(superAgent, /### \$\{group\.label\}/);

  // A newly added agent with no brief still has to reach the model, so the
  // renderer keeps an undescribed bucket instead of dropping it.
  assert.match(superAgent, /### Also installed/);

  // Form-driven agents are named by command only. Printing an id beside one
  // invites `agent_launch` to be called with it and refused by the route.
  assert.match(superAgent, /const describeUserOnly/);
  assert.match(superAgent, /\.\.\.userOnly\.map\(describeUserOnly\)/);
  const userOnlyRenderer = superAgent.slice(
    superAgent.indexOf("const describeUserOnly"),
    superAgent.indexOf("const grouped"),
  );
  assert.doesNotMatch(userOnlyRenderer, /agent\.id\}/);
  assert.match(superAgent, /`agent_launch` will refuse/);

  // The three delegation mechanics that predate this catalogue are still stated
  // with it: nothing has run yet, the brief is all the agent gets, and its
  // outcome comes back as an internal turn.
  assert.match(superAgent, /It has not run when the tool returns/);
  assert.match(superAgent, /The agent cannot see this conversation/);
  assert.match(superAgent, /Its outcome always returns to you as an internal turn/);
});

test("briefs stay short enough to list every agent in one prompt", () => {
  // The roster was cut to divisions plus example slugs once before, after the
  // full 264-agent index cost about 7.9k tokens a turn and made plain questions
  // answer generically. This catalogue is far smaller, but it is on every
  // super-agent turn, so a cap keeps one enthusiastic entry from reopening that.
  for (const [id, brief] of Object.entries(RUNTIME_AGENT_BRIEFS)) {
    const words = `${brief.does} ${brief.choose ?? ""}`.trim().split(/\s+/).length;
    assert.ok(words <= 90, `${id} brief is ${words} words, over the 90-word cap`);
  }
  const total = Object.values(RUNTIME_AGENT_BRIEFS).reduce(
    (sum, brief) =>
      sum + `${brief.does} ${brief.choose ?? ""}`.trim().split(/\s+/).length,
    0,
  );
  assert.ok(total <= 2400, `catalogue is ${total} words, over the 2400-word budget`);
});
