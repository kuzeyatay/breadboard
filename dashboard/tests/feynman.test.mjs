import assert from "node:assert/strict";
import test from "node:test";
import { researchFeynman, feynmanEvidenceText, validateFeynmanInput } from "../src/lib/feynman/service.ts";
import { planMaxResearch, participantWaves, RETRIEVAL_PARTICIPANTS } from "../src/lib/max-research/plan.ts";
import { participantRuntime } from "../src/lib/max-research/participants.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { maxResearchSynthesisPrompt } from "../src/lib/max-research/synthesis.ts";
import { brokerCapabilities } from "../src/lib/hermes/capability-broker.ts";
import { planTask } from "../src/lib/hermes/task-plan.ts";
import { evidenceKindForTool, extractWebsitesFromPayload, reportWebGrounding } from "../src/lib/hermes/evidence.ts";

const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
  <id>http://arxiv.org/abs/2401.12345v1</id><title>CRISPR reproducibility benchmark</title>
  <summary>A benchmark with experiments, baselines and uncertainty analysis. Code and data are available.</summary>
  <published>2024-01-01T00:00:00Z</published><author><name>A. Researcher</name></author>
  <link href="https://arxiv.org/abs/2401.12345" rel="alternate"/></entry></feed>`;
const crossref = { message: { items: [
  { DOI: "10.1000/crispr", title: ["CRISPR gene editing benchmark"], abstract: "<p>A controlled experiment compares CRISPR baselines with statistical confidence intervals, limitations, code and data.</p>",
    issued: { "date-parts": [[2022]] }, "is-referenced-by-count": 100, URL: "https://doi.org/10.1000/crispr", reference: [{ DOI: "10.1000/foundation" }] },
  { DOI: "10.1000/foundation", title: ["CRISPR foundations"], issued: { "date-parts": [[2020]] }, "is-referenced-by-count": 50, URL: "https://doi.org/10.1000/foundation" },
] } };
const epmc = { resultList: { result: [{ id: "1234", source: "MED", doi: "10.1000/crispr", pmcid: "PMC1234", title: "CRISPR gene editing benchmark", pubYear: "2022", citedByCount: 75, isOpenAccess: "Y", abstractText: "A controlled experiment compares CRISPR baselines with statistical confidence intervals and limitations. Data and code are available." }] } };
const xml = `<article><front><article-meta><title-group><article-title>CRISPR gene editing benchmark</article-title></title-group></article-meta></front><body>
  <sec><title>Methods</title><p>We compared CRISPR against three baselines using a public dataset and five random seeds. The code is available at https://github.com/example/research.</p></sec>
  <sec><title>Results</title><p>We report accuracy and confidence intervals. An ablation experiment tests the method.</p></sec>
  <sec><title>Limitations</title><p>The small sample size limits generalizability.</p></sec></body></article>`;

function transport(overrides = {}) {
  const calls = [];
  return { calls, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).has("authorization"), false);
    assert.equal(new Headers(init.headers).has("cookie"), false);
    assert.equal(url.searchParams.has("api_key"), false);
    assert.equal(url.searchParams.has("mailto"), false);
    const source = url.hostname.includes("arxiv") ? "arxiv" : url.hostname.includes("crossref") ? "crossref" : "europepmc";
    if (overrides[source]) return overrides[source](url, init);
    if (source === "arxiv") return new Response(atom);
    if (source === "crossref") return Response.json(crossref);
    return url.pathname.endsWith("fullTextXML") ? new Response(xml) : Response.json(epmc);
  } };
}

test("public retrieval merges provenance, builds real citation edges and inspects full text", async () => {
  const network = transport();
  const result = await researchFeynman({ query: "CRISPR gene editing benchmark", limit: 5, fullTextTop: 3 }, network);
  assert.equal(result.status, "completed");
  assert.equal(result.papers.length, 3);
  assert.equal(result.graph.edges, 1);
  const paper = result.papers.find((item) => item.doi === "10.1000/crispr");
  assert.equal(paper.fullText.status, "available");
  assert.ok(paper.fullText.characters > 200);
  assert.ok(paper.provenance.some((item) => item.source === "Crossref"));
  assert.ok(paper.provenance.some((item) => item.source === "Europe PMC"));
  assert.ok(paper.score.signals.graphPrestige.available);
  assert.ok(paper.critique);
  assert.ok(network.calls.some(({ url }) => url.pathname.endsWith("fullTextXML")));
  assert.ok(network.calls.find(({ url }) => url.hostname.includes("crossref")).url.searchParams.get("select").includes("reference"));
  const text = feynmanEvidenceText(result);
  assert.match(text, /https:\/\/doi.org\/10.1000\/crispr/);
  assert.match(text, /not probabilities of correctness/);
  assert.match(text, /Source excerpt.*full_text/);
  assert.ok(extractWebsitesFromPayload(result).some((site) => site.url === "https://doi.org/10.1000/crispr"));
  assert.doesNotMatch(JSON.stringify(result), /OpenAlex (Works API|work object|marks)/);
});

test("missing citation counts are excluded rather than asserted to be zero", async () => {
  const result = await researchFeynman({ query: "CRISPR", limit: 5, fullTextTop: 0 }, transport());
  const paper = result.papers.find((item) => item.title === "CRISPR reproducibility benchmark");
  assert.equal(paper.citationCount, null);
  assert.equal(paper.score.signals.citationImpact.available, false);
  assert.equal(paper.score.signals.citationVelocity.available, false);
  assert.equal(paper.fullText.status, "not_requested");
});

test("one unavailable catalog preserves results and reports the coverage loss", async () => {
  const result = await researchFeynman({ query: "CRISPR", fullTextTop: 0 }, transport({ arxiv: () => new Response("", { status: 429 }) }));
  assert.ok(result.papers.length);
  assert.equal(result.sources[0].status, "error");
  assert.match(result.limitations.join(" "), /arXiv.*429/);
});

test("no records is distinct from total source failure", async () => {
  const empty = transport({ arxiv: () => new Response("<feed/>"), crossref: () => Response.json({}), europepmc: () => Response.json({}) });
  assert.equal((await researchFeynman({ query: "CRISPR" }, empty)).status, "empty");
  const down = transport(Object.fromEntries(["arxiv", "crossref", "europepmc"].map((id) => [id, () => new Response("", { status: 503 })])));
  await assert.rejects(researchFeynman({ query: "CRISPR" }, down), { code: "sources_unavailable" });
});

test("cancellation reaches every in-flight catalog and never returns partial success", async () => {
  const controller = new AbortController();
  let active = 0;
  const result = researchFeynman({ query: "CRISPR" }, { signal: controller.signal, fetchImpl: async (_input, init) => {
    active++;
    await new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    return new Response();
  } });
  assert.equal(active, 3);
  controller.abort();
  await assert.rejects(result, { code: "aborted" });
  let called = false;
  await assert.rejects(researchFeynman({ query: "CRISPR" }, { signal: controller.signal, fetchImpl: async () => { called = true; return new Response(); } }), { code: "aborted" });
  assert.equal(called, false);
});

test("oversized source bodies are bounded and do not discard other catalogs", async () => {
  const result = await researchFeynman({ query: "CRISPR", fullTextTop: 0 }, transport({ arxiv: () => new Response(new Uint8Array(8 * 1024 * 1024 + 1)) }));
  assert.equal(result.sources[0].status, "error");
  assert.match(result.sources[0].reason, /size limit/);
  assert.ok(result.papers.length);
});

test("invalid input cannot start network work", async () => {
  for (const input of [{}, { query: " " }, { query: "a".repeat(601) }, { query: "x", limit: 1.5 }, { query: "x", limit: 21 }, { query: "x", fullTextTop: 4 }]) {
    assert.throws(() => validateFeynmanInput(input), { code: "invalid_arguments" });
  }
});

test("Feynman is available in private chats and Max Research's retrieval wave", async () => {
  assert.ok(allowedToolsForSurface("dashboard_terminal").includes("feynman_research"));
  assert.ok(allowedToolsForSurface("garden_chat").includes("feynman_research"));
  assert.ok(!allowedToolsForSurface("quartz_ai").includes("feynman_research"));
  const plan = planMaxResearch({ question: "CRISPR evidence" });
  assert.ok(participantWaves(plan)[0].some((item) => item.participant === "feynman"));
  assert.ok(RETRIEVAL_PARTICIPANTS.includes("feynman"));
  assert.deepEqual(await participantRuntime("feynman").available(), { available: true });
  const result = await participantRuntime("feynman").run({ question: "CRISPR", guidance: "", brief: "CRISPR" }, { signal: AbortSignal.abort() });
  assert.equal(result.status, "aborted");
  const prompt = maxResearchSynthesisPrompt({ plan, results: [{ participant: "feynman", status: "completed", output: "A source abstract with evidence." }] });
  assert.match(prompt, /Feynman PaperRank/);
});

test("the capability broker grants Feynman only on authenticated private surfaces", () => {
  for (const [surface, userId, isolated, expected] of [
    ["dashboard_terminal", 1, false, true], ["garden_chat", 1, false, true],
    ["quartz_ai", 1, false, false], ["dashboard_terminal", null, false, false],
    ["garden_chat", 1, true, false],
  ]) {
    const grant = brokerCapabilities({
      plan: planTask({ request: "Use Feynman to find papers", authenticated: userId !== null, isolated }),
      surface, userId, isolated, grants: [], workspaceRoot: "/runtime/feynman-test",
    });
    assert.equal(grant.allowedTools.feynman_research, expected, `${surface}/${userId}/${isolated}`);
  }
});

test("Feynman's public retrieval counts as web evidence in the final answer", () => {
  const kind = evidenceKindForTool("feynman_research");
  assert.equal(kind, "web_search");
  const report = reportWebGrounding("The paper reports an experiment.", [{ id: "feynman", kind, success: true, title: "Feynman", timestamp: new Date().toISOString(), details: {} }], true);
  assert.equal(report.satisfied, true);
});
