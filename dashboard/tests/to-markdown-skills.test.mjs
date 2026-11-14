import assert from "node:assert/strict";
import test from "node:test";

import { HermesRuntimeAdapter } from "../src/lib/agent-runtime/adapters/hermes.ts";
import { brokerCapabilities } from "../src/lib/hermes/capability-broker.ts";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import { planTask } from "../src/lib/hermes/task-plan.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { cuesToMarkdown, TO_MARKDOWN_SKILLS, TO_MARKDOWN_TOOL } from "../src/lib/to-markdown.ts";

test("every *-to-markdown skill is ready on both chat surfaces and needs only to_markdown", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    for (const slug of TO_MARKDOWN_SKILLS) {
      const skill = listFirstPartySkills(surface).find((candidate) => candidate.slug === slug);
      assert.ok(skill, `expected ${slug} on ${surface}`);
      assert.equal(skill.availability, "ready", `${slug} on ${surface}`);
      assert.deepEqual(skill.capabilityContract?.requiredTools, [TO_MARKDOWN_TOOL]);
    }
    assert.ok(allowedToolsForSurface(surface).includes(TO_MARKDOWN_TOOL));
  }
  assert.ok(!allowedToolsForSurface("quartz_ai").includes(TO_MARKDOWN_TOOL));
});

test("the slash command selects the skill and the broker grants the tool", async () => {
  const resolved = await resolveCommandMessage(
    1,
    "/link-to-markdown https://example.com",
    process.cwd(),
    { mode: "knowledge", surface: "dashboard_terminal" },
  );
  assert.deepEqual(resolved.invocations.map((invocation) => invocation.slug), ["link-to-markdown"]);

  const plan = planTask({ request: "Convert this page to markdown", authenticated: true });
  const grant = brokerCapabilities({ plan, surface: "garden_chat", userId: 1, grants: [], workspaceRoot: "C:/runtime/session" });
  assert.equal(grant.allowedTools[TO_MARKDOWN_TOOL], true);

  const adapter = new HermesRuntimeAdapter({
    baseUrl: "http://127.0.0.1:9119",
    chatmockBaseUrl: "http://127.0.0.1:8765/v1",
    sessionToken: "test",
    requestTimeoutMs: 5_000,
  });
  assert.ok((await adapter.listCapabilities()).tools.includes(TO_MARKDOWN_TOOL));
});

test("transcript cues become minute paragraphs led by their timestamp", () => {
  const markdown = cuesToMarkdown([
    { start: 0, text: "Hello" },
    { start: 30, text: "world." },
    { start: 61, text: "Next minute." },
    { start: 3700, text: "Past an hour." },
  ]);
  assert.equal(markdown, "**[0:00]** Hello world.\n\n**[1:01]** Next minute.\n\n**[1:01:40]** Past an hour.");
});
