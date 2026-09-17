import assert from "node:assert/strict";
import test from "node:test";
import { boundedEvidence, deepResearchCommissions, previousWaveEvidence } from "../src/lib/max-research/evidence.ts";
import { startRun, isTerminal, getEventsSince } from "../src/lib/max-research/run-manager.ts";

test("long commissions preserve every requirement in bounded sections with shared context", () => {
  const brief = "First requirement and numerical constraints.\n\n" + "Detailed context. ".repeat(400) + "Final constraint.";
  const sections = deepResearchCommissions(brief);
  assert.ok(sections.length > 1);
  assert.equal(sections.map(s => s.query).join(""), brief);
  for (const section of sections) {
    assert.ok(section.query.length <= 4000);
    assert.equal(section.researchContext, "First requirement and numerical constraints.");
  }
  const short = "Compare two options within the given budget.";
  assert.deepEqual(deepResearchCommissions(short), [{ query: short }]);
});

test("Unicode and long unbroken requirements survive section boundaries", () => {
  const brief = "A".repeat(3999) + "🧪".repeat(4000) + "Final required deliverable.";
  const sections = deepResearchCommissions(brief);
  assert.equal(sections.map(s=>s.query).join(""), brief);
  assert.ok(sections.every(s=>s.query.length<=4000 && s.researchContext.length<=1800));
  assert.ok(sections.every(s=>!/[\uD800-\uDBFF]$/.test(s.query)));
});

test("evidence budgets remain bounded even with very small limits", () => {
  for (const limit of [0, 1, 48, 49, 50, 51, 100]) {
    assert.ok(boundedEvidence("evidence".repeat(100), limit).length <= limit);
  }
});

test("later waves receive useful findings and source lists; a throwing participant cannot discard sibling evidence", async () => {
  const evidence = "Observed result. " + "Evidence detail. ".repeat(4000) + "\nSources: https://example.test/primary";
  let computationalContext;
  const started = startRun({
    userId: 1, question: "Compare plans and check their arithmetic", model: "test", reasoningEffort: "medium", baseUrl: "http://test.invalid",
    runtimeFor: participant => ({
      available: async () => ({ available: true }),
      run: async (_brief, context) => {
        if (participant === "agent_reach") throw new Error("Transient participant failure");
        if (participant === "openscience") computationalContext = context;
        return { participant, status: "completed", output: participant === "deep_research" ? evidence : "A contribution from " + participant };
      },
    }),
    synthesize: async () => "A completed research answer.",
  });
  const deadline = Date.now() + 2000;
  while (!isTerminal(1, started.runId) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  const events = getEventsSince(1, started.runId);
  assert.equal(events.at(-1).type, "run.completed");
  assert.match(computationalContext.priorEvidence, /Observed result/);
  assert.match(computationalContext.priorEvidence, /https:\/\/example.test\/primary/);
  const failed = events.find(e => e.type === "participant.settled" && e.payload.participant === "agent_reach");
  assert.equal(failed.payload.status, "failed");
  const retained = events.find(e => e.type === "participant.settled" && e.payload.participant === "deep_research");
  assert.ok(retained.payload.output.length <= 24000);
  assert.match(retained.payload.output, /https:\/\/example.test\/primary/);
  assert.equal(previousWaveEvidence([{participant:"aris",status:"completed",output:"Methodology"}]), "");
});
