import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const fixture = { run: null, calls: [], audits: [], saved: 0, failSave: false, failAudit: false, onRetrieve: null, complete: null };
globalThis.explanationRuntimeFixture = fixture;
const stubs = {
  "./explanation-review-context.ts": `export const explanationSourceContext = async () => {
    globalThis.explanationRuntimeFixture.onRetrieve?.(); return 'A retrieved source passage.';
  };`,
  "../db.ts": `export default {prepare: () => ({run: (json) => {
    const f = globalThis.explanationRuntimeFixture;
    if (f.failSave) throw new Error('database unavailable');
    if (f.run.status !== 'active') return {changes: 0};
    f.run.dispatch_json=json; f.saved++; return {changes: 1};
  }})};`,
  "./run-store.ts": `export const getRuntimeRun = () => globalThis.explanationRuntimeFixture.run;
    export const parseRuntimeRunDispatch = run => JSON.parse(run.dispatch_json);`,
  "./runtime-store.ts": `export const recordAuditEvent = event => {
    const f = globalThis.explanationRuntimeFixture;
    if (f.failAudit) throw new Error('audit unavailable'); f.audits.push(event);
  };`,
  "../ai-models.ts": `export const normalizeAssistantModelId = value => typeof value === 'string' ? value : null;`,
  "./explanation-review-provider.ts": `export const explanationReviewModel = model => async request => {
    const f = globalThis.explanationRuntimeFixture; f.calls.push({model, ...request});
    return f.complete(request);
  };`,
};
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/hermes/explanation-review-runtime.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "review-runtime-fixture", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: "fixture" } : null);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js" }));
  } }],
});
const { reviewRuntimeExplanation } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
function reset() {
  Object.assign(fixture, { calls: [], audits: [], saved: 0, failSave: false, failAudit: false, onRetrieve: null,
    run: { id: "r1", runtime_session_id: 1, status: "active", instruction: "Explain how DNS works", dispatch_json: JSON.stringify({ modelIdentity: { modelID: "gpt-5.6-sol" }, runtimeText: "Explain how DNS works", system: "Keep it concise." }) },
    complete: async request => ({ content: JSON.stringify(request.stage === "plan"
      ? { applicable: true, reason: "Name resolution", mechanisms: [{ mechanism: "Cache", sourceQuotes: ['A retrieved source passage.'] }, { mechanism: "Lookup", sourceQuotes: [] }] }
      : { concerns: [], coverage: [{ id: "m1", status: "covered", quotes: ["Check cache."], reason: "", consequence: "" }, { id: "m2", status: "covered", quotes: ["Then look up."], reason: "", consequence: "" }] }), usage: { input_tokens: 2, output_tokens: 3 } }),
  });
}
const input = { runId: "r1", answer: "Check cache. Then look up.", evidence: [] };

test("a reconnect reuses the durable answer and its original usage without new calls", async () => {
  reset();
  const result = await reviewRuntimeExplanation(input);
  assert.equal(result.report.status, "reviewed");
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.saved, 1);
  const reconnect = await reviewRuntimeExplanation(input);
  assert.deepEqual(reconnect, result);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[0].model, "gpt-5.6-sol");
  assert.equal(fixture.audits.length, 1);
});

test("a changed draft cannot reuse the old approval", async () => {
  reset();
  await reviewRuntimeExplanation(input);
  const result = await reviewRuntimeExplanation({ ...input, answer: "Different answer." });
  assert.equal(result.report.status, "unavailable");
  assert.equal(result.answer, "Different answer.");
  assert.equal(fixture.calls.length, 4);
});

test("a selected fragment keeps its admission through the runtime reviewer", async () => {
  reset();
  fixture.run.instruction = "Two real little balls next to each other?";
  fixture.run.dispatch_json = JSON.stringify({ modelIdentity: { modelID: "fixture" },
    explanationContext: { repair: true, hasSelection: true, context: "The selected pairing claim.", sourcePassages: "A retrieved source passage." } });
  assert.equal((await reviewRuntimeExplanation(input)).report.status, "reviewed");
  assert.equal(fixture.calls.length, 2);
});

test("a stop during retrieval cannot republish a cached answer", async () => {
  reset();
  await reviewRuntimeExplanation(input);
  fixture.onRetrieve = () => { fixture.run.status = "cancelled"; };
  assert.equal(await reviewRuntimeExplanation(input), null);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.saved, 1);
});

test("stop during review prevents both a saved receipt and publication", async () => {
  reset();
  fixture.complete = async () => {
    fixture.run.status = "cancelled";
    return new Promise(() => {});
  };
  const result = await reviewRuntimeExplanation(input);
  assert.equal(result, null);
  assert.equal(fixture.saved, 0);
  assert.equal(fixture.audits.length, 0);
});

test("a receipt write failure retains the draft with an unavailable result", async () => {
  reset(); fixture.failSave = true;
  const result = await reviewRuntimeExplanation(input);
  assert.equal(result.answer, input.answer);
  assert.equal(result.report.status, "unavailable");
  assert.equal(result.usage.totalTokens, 10);
});

test("an audit failure does not discard a durably saved answer", async () => {
  reset(); fixture.failAudit = true;
  assert.equal((await reviewRuntimeExplanation(input)).report.status, "reviewed");
  assert.equal(fixture.saved, 1);
});

test("a stopped run and artifact/delegated turns do not call the reviewer", async () => {
  reset(); fixture.run.status = "cancelled";
  assert.equal(await reviewRuntimeExplanation(input), null);
  for (const extras of [{ requiredArtifacts: [{ kind: "html" }] }, { delegatedAgents: [{ agentId: "research" }] }]) {
    reset(); fixture.run.dispatch_json = JSON.stringify({ ...JSON.parse(fixture.run.dispatch_json), ...extras });
    assert.equal((await reviewRuntimeExplanation(input)).report.status, "not_applicable");
    assert.equal(fixture.calls.length, 0);
  }
});


test("review uses the generation packet instead of unrelated system policy and keeps later tool evidence", async () => {
  reset();
  const dispatch = JSON.parse(fixture.run.dispatch_json);
  dispatch.system = "UNRELATED WEATHER POLICY ".repeat(20_000);
  dispatch.explanationContext = { repair: true, context: "The precise unresolved question and its selected parent.", sourcePassages: "The same source that generation read." };
  fixture.run.instruction = "what adjustment bro you cant just say the adjustment before like telling what happens";
  fixture.run.dispatch_json = JSON.stringify(dispatch);
  fixture.onRetrieve = () => { throw new Error("Must reuse already retrieved passages"); };
  fixture.complete = async request => {
    assert.match(request.data.context, /precise unresolved question/);
    assert.match(request.data.context, /New tool observation/);
    assert.doesNotMatch(request.data.context, /UNRELATED WEATHER POLICY/);
    assert.equal(request.data.sourcePassages, "The same source that generation read.");
    return { content: JSON.stringify({ applicable: false, reason: "Fixture checks the supplied packet", mechanisms: [] }) };
  };
  const result = await reviewRuntimeExplanation({ ...input, evidence: [{ title: "New tool observation" }] });
  assert.equal(result.report.status, "not_applicable");
  assert.equal(fixture.calls.length, 1);
});
