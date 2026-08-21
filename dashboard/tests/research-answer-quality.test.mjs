// What separates a researched answer from a plausible one.
//
// The tracked pipeline already stops the model deciding for itself that it has
// searched enough. It did nothing about the other half — how a claim it is
// entitled to make gets written down. Every case here is a way of stating
// something literally true that leaves the reader believing something false: a
// seller's figure repeated as a market rate, one page mistaken for a
// consensus, last year's number given in the present tense, a ranking against
// a criterion nobody named.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evidenceAuthority,
  independentSourceCount,
  sourceIdentity,
} from "../src/lib/research/authority.ts";
import { classifyResearch, computeFactors } from "../src/lib/research/classify.ts";
import {
  normalizeEvidence,
  resolveField,
} from "../src/lib/research/evidence.ts";
import {
  researchAnswerContract,
  researchPipelineRule,
} from "../src/lib/research/directive.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (relative) => fs.readFileSync(path.join(here, "..", relative), "utf8");

const observation = (overrides) =>
  normalizeEvidence(
    {
      field: "price",
      value: 1,
      sourceUrl: "https://example.com/a",
      sourceClass: "reputable_secondary",
      evidenceKind: "explicit",
      ...overrides,
    },
    { id: overrides?.id ?? "e1", now: "2026-08-01T00:00:00.000Z" },
  );

test("a seller is authoritative about its own product and weak about its market", () => {
  // The whole reason `vendor_marketing` is not just `official_entity` with a
  // lower score. Get this backwards and the pipeline either ignores the only
  // page that lists a price, or quotes a lead-generation figure as an
  // industry benchmark.
  const ownName = { field: "name", evidenceKind: "explicit" };
  assert.ok(
    evidenceAuthority({ ...ownName, sourceClass: "vendor_marketing" }) > 0.5,
    "a vendor names its own product correctly",
  );

  const marketFigure = { field: "memberCount", evidenceKind: "explicit" };
  assert.ok(
    evidenceAuthority({ ...marketFigure, sourceClass: "vendor_marketing" }) <
      evidenceAuthority({ ...marketFigure, sourceClass: "reputable_secondary" }),
    "a disinterested secondary source outranks marketing on a market-wide number",
  );
});

test("a stake in the claim halves its weight, whoever published it", () => {
  // Orthogonal to source class on purpose: a serious outlet is disinterested
  // about a merger and interested about its own readership.
  const base = {
    field: "memberCount",
    sourceClass: "reputable_secondary",
    evidenceKind: "explicit",
  };
  const plain = evidenceAuthority(base);
  const interested = evidenceAuthority({ ...base, selfInterested: true });
  assert.ok(interested < plain);
  assert.equal(Number(interested.toFixed(4)), Number((plain * 0.5).toFixed(4)));
});

test("declaring a vendor source is enough — the interest flag follows from it", () => {
  const evidence = observation({ sourceClass: "vendor_marketing" });
  assert.equal(evidence.selfInterested, true);
});

test("a disinterested source beats an interested one that would otherwise win", () => {
  // The concrete failure: a supplier's ROI page and an industry body disagree,
  // and the supplier's page is nominally the "entity's own" source.
  const evidence = [
    observation({
      id: "vendor",
      field: "payback",
      value: "6 months",
      sourceUrl: "https://cobots.example/roi-calculator",
      sourceClass: "vendor_marketing",
    }),
    observation({
      id: "body",
      field: "payback",
      value: "18 months",
      sourceUrl: "https://industry-body.example/report",
      sourceClass: "official_database",
    }),
  ];
  const resolved = resolveField({
    field: "payback",
    evidence,
    volatile: false,
    conflictId: "c1",
    now: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(resolved.value, "18 months");
  assert.equal(resolved.corroboration, "contested");
});

test("three pages of one site are one source, not three", () => {
  // Counting URLs instead of publishers is the arithmetic that makes a press
  // release look like a consensus.
  assert.equal(sourceIdentity("https://www.acme.com/a"), "acme.com");
  assert.equal(
    independentSourceCount([
      { sourceUrl: "https://acme.com/guide" },
      { sourceUrl: "https://www.acme.com/blog/post" },
      { sourceUrl: "https://acme.com/pdf/report.pdf" },
    ]),
    1,
  );
});

test("a lone source is reported as one, and two publishers as agreement", () => {
  const single = resolveField({
    field: "price",
    evidence: [observation({ id: "a", value: 100 })],
    volatile: false,
    conflictId: "c1",
    now: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(single.status, "verified");
  assert.equal(single.corroboration, "single_source");

  const both = resolveField({
    field: "price",
    evidence: [
      observation({ id: "a", value: 100, sourceUrl: "https://one.example/x" }),
      observation({ id: "b", value: 100, sourceUrl: "https://two.example/y" }),
    ],
    volatile: false,
    conflictId: "c1",
    now: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(both.corroboration, "corroborated");
});

test("a value everyone behind it stands to gain from is flagged as exactly that", () => {
  const resolved = resolveField({
    field: "payback",
    evidence: [
      observation({
        id: "a",
        field: "payback",
        value: "6 months",
        sourceUrl: "https://seller-one.example/roi",
        sourceClass: "vendor_marketing",
      }),
      observation({
        id: "b",
        field: "payback",
        value: "6 months",
        sourceUrl: "https://seller-two.example/roi",
        sourceClass: "vendor_marketing",
      }),
    ],
    volatile: false,
    conflictId: "c1",
    now: "2026-08-01T00:00:00.000Z",
  });
  // Two independent publishers, so it is corroborated — and still worth
  // disclosing, because both of them sell the thing.
  assert.equal(resolved.corroboration, "corroborated");
  assert.equal(resolved.selfInterestedOnly, true);
});

test("an old figure for a changing quantity is marked stale and dated", () => {
  const resolved = resolveField({
    field: "memberCount",
    evidence: [
      observation({
        id: "a",
        field: "memberCount",
        value: 542_076,
        publishedAt: "2024-09-01",
      }),
    ],
    volatile: true,
    conflictId: "c1",
    now: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(resolved.stale, true);
  assert.match(resolved.asOf, /^2024-09-01/);
});

test("a recent figure is not stale, and an undated one is not called fresh", () => {
  const recent = resolveField({
    field: "memberCount",
    evidence: [observation({ id: "a", field: "memberCount", value: 5, publishedAt: "2026-06-01" })],
    volatile: true,
    conflictId: "c1",
    now: "2026-08-01T00:00:00.000Z",
  });
  assert.notEqual(recent.stale, true);

  // `observedAt` is today by construction — letting it stand in for a
  // publication date would mark every source fresh, which is the opposite of
  // the mistake this catches.
  const undated = resolveField({
    field: "memberCount",
    evidence: [observation({ id: "a", field: "memberCount", value: 5 })],
    volatile: true,
    conflictId: "c1",
    now: "2026-08-01T00:00:00.000Z",
  });
  assert.notEqual(undated.stale, true);
  assert.equal(undated.asOf, undefined);
});

test("a superlative with no stated basis is recognized as under-specified", () => {
  const plan = classifyResearch({
    question: "if I want to go into robotics, what niche would be the highest ROI?",
  });
  assert.equal(plan.criterionUnstated, true);
  assert.ok(plan.factors.criterionAmbiguity >= 0.5);
});

test("saying what the basis is answers the question rather than raising it", () => {
  // A stated criterion cancels the superlative rather than merely offsetting
  // it: there is nothing left to disambiguate.
  const stated = computeFactors(
    "which database is fastest in terms of p99 write latency",
    2,
  );
  assert.equal(stated.criterionAmbiguity, 0);

  const unstated = computeFactors("which database is fastest", 2);
  assert.ok(unstated.criterionAmbiguity > 0);
});

test("a plain factual question is not treated as a judgement call", () => {
  const factual = computeFactors("when was the Eiffel Tower completed", 1);
  assert.equal(factual.criterionAmbiguity, 0);
});

test("the contract demands attribution, dating and honest sourcing", () => {
  const plan = classifyResearch({
    question: "compare the leading options and tell me which to pick",
  });
  const contract = researchAnswerContract(plan);
  assert.match(contract, /names where it came from, at the point it is used/);
  assert.match(contract, /Not a bibliography at the end/);
  assert.match(contract, /One source is not a consensus/);
  assert.match(contract, /not a benchmark/);
  assert.match(contract, /I did not find it.*not published/s);
  assert.match(contract, /Do not merge things that behave differently/);
});

test("Breadboard says when it has detected the unstated-criterion case", () => {
  // The shared standard always carries the rule — the Deep Research service
  // reads the same file and has no classifier. What a classified request adds
  // is that the case has already been checked for and found, so the model
  // spends no judgement deciding whether the rule is in play.
  const both = [
    "which robotics niche has the highest return",
    "which robotics niche has the highest return measured by starting salary for a graduate",
  ].map((question) => researchAnswerContract(classifyResearch({ question })));

  for (const contract of both) {
    assert.match(contract, /Name the basis you are judging on/);
  }
  assert.match(both[0], /not optional on this turn/);
  assert.doesNotMatch(both[1], /not optional on this turn/);
});

test("the standard has one author, shared with the out-of-process service", () => {
  // Two copies phrased slightly differently is how two consumers drift apart,
  // and then an answer's standards depend on which runtime produced it.
  const canonical = source("../hermes-config/system/research-answer-contract.md").trim();
  assert.ok(researchAnswerContract(classifyResearch({ question: "compare these" }))
    .startsWith(canonical));
  assert.equal(
    source("../deep-research/src/research-answer-contract.md").trim(),
    canonical,
  );
  const prompt = source("../deep-research/src/prompt.ts");
  assert.match(prompt, /research-answer-contract\.md/);
  assert.match(prompt, /options\.writing \? researchAnswerContractPrompt\(\) : ''/);
});

test("the writing standard is not gated on Super agent, unlike the search protocol", () => {
  // The two are deliberately scoped differently. The tracked pipeline is heavy
  // machinery that only earns its cost on a broad question; how a figure is
  // attributed and dated has nothing to do with how the search was run.
  const prompts = source("src/lib/hermes/system-prompts.ts");
  assert.match(prompts, /researchAnswerContract\(researchPlan\)/);
  assert.match(prompts, /intent !== "simple_lookup"/);
  // It travels with web grounding — the gate for "is this turn answering from
  // sources at all" — rather than with the super-agent inventory.
  const websearch = prompts.indexOf('allowedTools.includes("websearch")');
  const contract = prompts.indexOf("researchAnswerContract(researchPlan)");
  const imageSearch = prompts.indexOf('allowedTools.includes("image_search")');
  assert.ok(websearch > 0 && contract > websearch);
  assert.ok(contract < imageSearch, "still inside the websearch branch");
  assert.doesNotMatch(prompts, /superAgent/);
});

test("a one-fact lookup pays nothing for either", () => {
  const plan = classifyResearch({ question: "who founded OpenAI?" });
  assert.equal(plan.intent, "simple_lookup");
  // The system prompt gates on exactly this, so a cheap turn stays cheap.
  assert.match(source("src/lib/hermes/system-prompts.ts"), /simple_lookup/);
});

test("the tracked pipeline opens on a broad question, not on a switch", () => {
  const turnService = source("src/lib/conversations/turn-service.ts");
  assert.match(turnService, /researchToolsWarranted/);
  assert.match(turnService, /researchPipeline: researchToolsWarranted/);
  // And the directive travels with the tools even with no super-agent
  // inventory to carry it, or the tools arrive with no contract governing them.
  assert.match(turnService, /researchPipelineRule\(researchPipeline\)/);

  const broker = source("src/lib/hermes/capability-broker.ts");
  assert.match(broker, /options\.researchPipeline === true && map\.websearch === true/);
  // Still the same two surfaces, and still authenticated only.
  assert.match(
    broker,
    /researchPipeline === true[\s\S]{0,400}dashboard_terminal" \|\| surface === "garden_chat"/,
  );
});

test("the protocol and the writing standard stay separate documents", () => {
  // Merging them would put a multi-round tool protocol in front of every
  // web-answered turn, which is the cost the gating exists to avoid.
  const plan = classifyResearch({
    question: "list every student team the university has ever had and what happened to each",
  });
  assert.match(researchPipelineRule(plan), /research_begin/);
  assert.doesNotMatch(researchAnswerContract(plan), /research_begin/);
});

test("a regenerated turn starts from an empty research ledger", () => {
  // The session is keyed by conversation and lives in process, so a retry lands
  // on the same key. Without an explicit clear, a re-rolled answer inherits the
  // previous attempt's coverage, its spent search budget and its stop decision
  // — and `research_status` can tell it to stop writing before it has searched
  // anything. Re-rolling an answer has to re-roll the work behind it.
  const turnService = source("src/lib/conversations/turn-service.ts");
  assert.match(
    turnService,
    /if \(input\.branchHistory !== undefined\) \{\s*\r?\n\s*clearResearchState\(input\.conversation\.id\);/,
  );
  assert.match(turnService, /import \{ clearResearchState \}/);
});

test("resending the first message carries no history, the way a new chat has none", () => {
  // The client sends the transcript before the retried message as branch
  // history; for the first message that is the empty list. The server must
  // treat an empty list as "no history" rather than falling back to the
  // conversation's own recent messages, which still hold the attempt being
  // replaced.
  const turnService = source("src/lib/conversations/turn-service.ts");
  assert.match(turnService, /input\.branchHistory \?\?\s*\r?\n?\s*memory\.recentMessages/);
  // Nullish coalescing, not `||`: `[]` is a real answer and must survive.
  assert.doesNotMatch(turnService, /input\.branchHistory \|\|/);
  // And the conversation's rolling summary and working state come off the turn
  // with it, or the replaced attempt reaches the model as remembered state.
  assert.match(turnService, /includeConversationState: false/);
});
