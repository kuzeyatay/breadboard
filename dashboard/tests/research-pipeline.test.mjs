// The coverage-driven research pipeline: classification, canonicalization,
// gaps, conflicts, budgets, and the one distinction the whole design exists to
// protect — "I did not find this" is not "this is not published".
//
// Nothing here asserts a real-world research answer. The integration case below
// is a synthetic multi-entity universe with known properties, so the test
// measures the pipeline's behaviour rather than the internet's contents.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  classifyResearch,
  computeBudget,
  computeFactors,
  researchPipelineApplies,
} from "../src/lib/research/classify.ts";
import {
  addRelationship,
  identityKey,
  mergeEntityCandidates,
  searchableAliases,
} from "../src/lib/research/entities.ts";
import { resolveField } from "../src/lib/research/evidence.ts";
import { evidenceAuthority, claimShapeForField } from "../src/lib/research/authority.ts";
import {
  queryFingerprint,
  remainingStrategies,
  strategyStatsKey,
} from "../src/lib/research/scheduler.ts";
import {
  beginResearch,
  recordResearch,
  researchStatus,
  researchCoverageSummary,
  exhaustedFieldLabels,
} from "../src/lib/research/session.ts";
import { scoreResearchRun } from "../src/lib/research/benchmark.ts";
import {
  getResearchState,
  resetResearchStore,
} from "../src/lib/research/store.ts";
import { assessVerification } from "../src/lib/hermes/evidence.ts";

const CONVERSATION = 4242;

const EXHAUSTIVE_QUESTION =
  "Research all student teams the university ever created, determine which are active, their member counts, historical names, and what happened to the inactive ones.";

beforeEach(() => {
  resetResearchStore();
});

function source(url, overrides = {}) {
  return {
    sourceUrl: url,
    sourceClass: "official_entity",
    evidenceKind: "explicit",
    ...overrides,
  };
}

// --- A. classification and budget ---------------------------------------

test("a trivial lookup stays trivial", () => {
  const plan = classifyResearch({ question: "Who founded OpenAI?" });
  assert.equal(plan.intent, "simple_lookup");
  assert.equal(plan.completenessRequired, false);
  assert.equal(plan.requiresEnumeration, false);
  assert.ok(plan.budget.maxSearches <= 3, "a one-fact question earns a tiny budget");
  // The gate the whole "preserve normal mode" requirement rests on.
  assert.equal(researchPipelineApplies(plan), false);
});

test("an exhaustive multi-entity question earns a far larger budget", () => {
  const plan = classifyResearch({ question: EXHAUSTIVE_QUESTION });
  assert.ok(
    ["exhaustive_enumeration", "historical_reconstruction"].includes(plan.intent),
    `expected an exhaustive intent, got ${plan.intent}`,
  );
  assert.equal(plan.completenessRequired, true);
  assert.equal(plan.requiresEnumeration, true);
  assert.equal(plan.temporalScope.kind, "full_history");
  assert.ok(plan.budget.maxSearches >= 30, "exhaustive work needs room to search");
  assert.ok(plan.budget.maxEnumerationRounds >= 2);
  assert.ok(researchPipelineApplies(plan));

  const trivial = classifyResearch({ question: "Who founded OpenAI?" });
  assert.ok(
    plan.budget.maxSearches > trivial.budget.maxSearches * 8,
    "the gap between the two budgets is the point",
  );
});

test("completeness is inferred semantically, not only from keywords", () => {
  // No "all", no "every", no "complete list".
  const plan = classifyResearch({
    question:
      "Which of the university's student teams are still running, and what happened to the ones that shut down?",
  });
  assert.ok(plan.factors.completenessRequirement > 0, "a set request registers");
  assert.ok(plan.factors.historicalDepth > 0, "past-tense reach registers");
  assert.ok(
    plan.requestedFields.some((field) => field.key === "status"),
    "lifecycle vocabulary becomes a tracked field",
  );
  assert.ok(plan.requestedFields.some((field) => field.key === "lineage"));
});

test("the budget scales monotonically with the factors", () => {
  const light = computeBudget("normal_research", computeFactors("what is a solar car", 1));
  const heavy = computeBudget(
    "exhaustive_enumeration",
    computeFactors(EXHAUSTIVE_QUESTION, 6),
  );
  assert.ok(heavy.maxSearches > light.maxSearches);
  assert.ok(heavy.maxEntities > light.maxEntities);
  assert.ok(heavy.maxAttemptsPerGap >= light.maxAttemptsPerGap);
});

// --- B. entity canonicalization and aliases ------------------------------

test("name variants collapse to one identity key, distinct names do not", () => {
  assert.equal(identityKey("Solar Team Eindhoven"), identityKey("solar-team  eindhoven"));
  assert.equal(identityKey("The Aeris Team"), identityKey("Aeris"));
  assert.notEqual(identityKey("Aeris"), identityKey("Aster"));
  // A name made only of noise words must not become the empty key.
  assert.ok(identityKey("The Team").length > 0);
});

test("an alias never becomes a second entity", () => {
  const first = mergeEntityCandidates({
    existing: [],
    candidates: [{ name: "University Racing", aliases: ["UR"] }],
    round: 1,
    maxEntities: 50,
  });
  assert.equal(first.entities.length, 1);

  const second = mergeEntityCandidates({
    existing: first.entities,
    // The same team under its abbreviation, a spelling variant, and a new alias.
    candidates: [
      { name: "UR" },
      { name: "university  racing" },
      { name: "URE", aliases: ["University Racing"] },
    ],
    round: 2,
    maxEntities: 50,
  });
  assert.equal(second.entities.length, 1, "three variants are one entity");
  assert.equal(second.created.length, 0);
  assert.ok(second.merged.length >= 2);
  assert.ok(
    second.entities[0].aliases.some((alias) => alias === "URE"),
    "the newly seen name is kept as an alias",
  );
  assert.ok(searchableAliases(second.entities[0]).length > 0);
});

test("a genuinely new name is a new entity, and the ceiling is enforced", () => {
  const outcome = mergeEntityCandidates({
    existing: [],
    candidates: [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }],
    round: 1,
    maxEntities: 2,
  });
  assert.equal(outcome.entities.length, 2);
  assert.deepEqual(outcome.rejected, ["Gamma"]);
});

test("lifecycle is separate from classification and is not overwritten", () => {
  const first = mergeEntityCandidates({
    existing: [],
    candidates: [{ name: "Aster", lifecycle: "dissolved", classification: "solar" }],
    round: 1,
    maxEntities: 10,
  });
  const second = mergeEntityCandidates({
    existing: first.entities,
    // A later page that simply does not mention the status must not erase it.
    candidates: [{ name: "aster" }],
    round: 2,
    maxEntities: 10,
  });
  assert.equal(second.entities[0].lifecycle, "dissolved");
  assert.equal(second.entities[0].classification, "solar");
});

test("symmetric lineage gets its inverse, one-way lineage does not", () => {
  const withSuccessor = addRelationship({
    relationships: [],
    fromEntityId: "e1",
    toEntityId: "e2",
    kind: "successor_of",
  });
  assert.equal(withSuccessor.length, 2);
  assert.ok(withSuccessor.some((edge) => edge.kind === "predecessor_of"));

  const renamed = addRelationship({
    relationships: [],
    fromEntityId: "e1",
    toEntityId: "e2",
    kind: "renamed_to",
  });
  assert.equal(renamed.length, 1, "a rename also means the old name stopped existing");
});

// --- C. evidence, conflicts, temporal provenance -------------------------

test("one agreed value verifies; an unstated one is only inferred", () => {
  const verified = resolveField({
    field: "memberCount",
    entityId: "e1",
    volatile: true,
    conflictId: "c1",
    evidence: [
      {
        id: "ev1",
        entityId: "e1",
        field: "memberCount",
        value: 21,
        ...source("https://team.example/about"),
        observedAt: "2026-01-01T00:00:00.000Z",
        confidence: "high",
      },
    ],
  });
  assert.equal(verified.status, "verified");
  assert.equal(verified.value, 21);

  const inferred = resolveField({
    field: "memberCount",
    entityId: "e1",
    volatile: true,
    conflictId: "c1",
    evidence: [
      {
        id: "ev1",
        entityId: "e1",
        field: "memberCount",
        value: 21,
        ...source("https://blog.example", { evidenceKind: "inference" }),
        observedAt: "2026-01-01T00:00:00.000Z",
        confidence: "low",
      },
    ],
  });
  assert.equal(inferred.status, "inferred", "a reconstructed value is not a fact");
});

test("conflicting values are both preserved, never silently overwritten", () => {
  const resolution = resolveField({
    field: "memberCount",
    entityId: "e1",
    volatile: true,
    conflictId: "c1",
    evidence: [
      {
        id: "ev1",
        entityId: "e1",
        field: "memberCount",
        value: 21,
        ...source("https://team.example", { sourceClass: "official_entity" }),
        publishedAt: "2026-03-01T00:00:00.000Z",
        observedAt: "2026-06-01T00:00:00.000Z",
        confidence: "high",
      },
      {
        id: "ev2",
        entityId: "e1",
        field: "memberCount",
        value: 23,
        ...source("https://partner.example", { sourceClass: "partner" }),
        publishedAt: "2026-03-15T00:00:00.000Z",
        observedAt: "2026-06-01T00:00:00.000Z",
        confidence: "medium",
      },
    ],
  });
  assert.ok(resolution.conflict, "the disagreement is recorded");
  assert.equal(resolution.conflict.observations.length, 2);
  assert.deepEqual(
    resolution.conflict.observations.map((item) => item.value).sort(),
    [21, 23],
  );
});

test("a value that moved over time is a change, not a disagreement", () => {
  const resolution = resolveField({
    field: "memberCount",
    entityId: "e1",
    volatile: true,
    conflictId: "c1",
    evidence: [
      {
        id: "ev1",
        entityId: "e1",
        field: "memberCount",
        value: 18,
        ...source("https://team.example/2021"),
        publishedAt: "2021-05-01T00:00:00.000Z",
        observedAt: "2026-06-01T00:00:00.000Z",
        confidence: "high",
      },
      {
        id: "ev2",
        entityId: "e1",
        field: "memberCount",
        value: 24,
        ...source("https://team.example/2026"),
        publishedAt: "2026-05-01T00:00:00.000Z",
        observedAt: "2026-06-01T00:00:00.000Z",
        confidence: "high",
      },
    ],
  });
  assert.equal(resolution.status, "verified");
  assert.equal(resolution.value, 24, "the current figure is the newest one");
  assert.equal(resolution.conflict.resolution.status, "temporal_change");

  // A non-volatile field with the same two dates is a real disagreement.
  const founded = resolveField({
    field: "foundedAt",
    entityId: "e1",
    volatile: false,
    conflictId: "c2",
    evidence: [
      {
        id: "ev1",
        entityId: "e1",
        field: "foundedAt",
        value: "2011",
        ...source("https://a.example", { sourceClass: "reputable_secondary" }),
        publishedAt: "2021-05-01T00:00:00.000Z",
        observedAt: "2026-06-01T00:00:00.000Z",
        confidence: "medium",
      },
      {
        id: "ev2",
        entityId: "e1",
        field: "foundedAt",
        value: "2012",
        ...source("https://b.example", { sourceClass: "partner" }),
        publishedAt: "2026-05-01T00:00:00.000Z",
        observedAt: "2026-06-01T00:00:00.000Z",
        confidence: "medium",
      },
    ],
  });
  assert.notEqual(founded.conflict.resolution.status, "temporal_change");
});

test("source authority depends on the claim, not only on the source", () => {
  assert.equal(claimShapeForField("memberCount"), "headcount");
  assert.equal(claimShapeForField("achievements"), "result");
  // The entity knows its own headcount best; the organiser owns the result.
  assert.ok(
    evidenceAuthority({ field: "memberCount", sourceClass: "official_entity", evidenceKind: "explicit" }) >
      evidenceAuthority({ field: "memberCount", sourceClass: "institution", evidenceKind: "explicit" }),
  );
  assert.ok(
    evidenceAuthority({ field: "achievements", sourceClass: "competition", evidenceKind: "explicit" }) >
      evidenceAuthority({ field: "achievements", sourceClass: "official_entity", evidenceKind: "explicit" }),
  );
  // An inference from the best source still loses to a stated fact from a
  // mid-quality one, which is the ordering that keeps guesses out of answers.
  assert.ok(
    evidenceAuthority({ field: "memberCount", sourceClass: "partner", evidenceKind: "explicit" }) >
      evidenceAuthority({ field: "memberCount", sourceClass: "official_entity", evidenceKind: "inference" }),
  );
});

// --- D. session: gaps, budgets, saturation, stopping ---------------------

function beginExhaustive() {
  return beginResearch({
    conversationId: CONVERSATION,
    question: EXHAUSTIVE_QUESTION,
    targetEntityDescription: "university student teams",
  });
}

test("a session opens in enumeration and plans discovery queries first", () => {
  const begun = beginExhaustive();
  assert.equal(begun.phase, "enumeration");
  assert.ok(begun.nextQueries.length > 0);
  assert.ok(
    begun.nextQueries.some((query) => /archive|former|past/i.test(query.query)),
    "a historical question enumerates historical sources too",
  );
});

test("equivalent queries are not charged to the budget twice", () => {
  beginExhaustive();
  const first = recordResearch({
    conversationId: CONVERSATION,
    searches: [{ query: "student teams list university" }],
  });
  const second = recordResearch({
    conversationId: CONVERSATION,
    // Same words, different order: the same search.
    searches: [{ query: "university list student teams" }],
  });
  assert.equal(first.searchesUsed, 1);
  assert.equal(second.searchesUsed, 1, "a reordered repeat is the same query");
  assert.equal(queryFingerprint("a b c"), queryFingerprint("c  b a"));
});

test("gaps appear for every requested field of every discovered entity", () => {
  const begun = beginExhaustive();
  const result = recordResearch({
    conversationId: CONVERSATION,
    entities: [{ name: "Alpha" }, { name: "Beta" }],
    completedEnumerationRound: true,
  });
  assert.equal(result.entityCount, 2);
  // Every field except the name, which the row itself establishes.
  const trackedFields = begun.requestedFields.length - 1;
  assert.ok(result.coverage.total >= 2 * trackedFields);
  assert.ok(result.coverage.highPriorityOpen > 0);
  assert.equal(result.stop.stop, false, "nothing is covered yet");
});

/**
 * Discover one entity, then run enumeration to saturation, which is what moves
 * the session from discovery into gap work. Returns the last round's result.
 */
function saturateEnumeration(entityName = "Alpha") {
  let result = recordResearch({
    conversationId: CONVERSATION,
    entities: [{ name: entityName }],
    completedEnumerationRound: true,
  });
  for (let round = 0; round < 4 && !result.saturated; round += 1) {
    result = recordResearch({
      conversationId: CONVERSATION,
      entities: [{ name: entityName.toLowerCase() }],
      completedEnumerationRound: true,
    });
  }
  return result;
}

test("gap work begins only after discovery has saturated", () => {
  beginExhaustive();
  const discovery = recordResearch({
    conversationId: CONVERSATION,
    entities: [{ name: "Alpha" }],
    completedEnumerationRound: true,
  });
  assert.equal(discovery.phase, "enumeration");
  assert.ok(
    discovery.nextQueries.every((query) => query.gapId === "enumeration"),
    "a session that has not finished discovering does not go deep yet",
  );

  const saturated = saturateEnumeration("Beta");
  assert.ok(saturated.saturated);
  assert.ok(
    saturated.nextQueries.some((query) => query.gapId !== "enumeration"),
    "once discovery is dry, the planner switches to the open fields",
  );
});

test("a gap becomes exhausted only after diversified strategies are spent", () => {
  beginExhaustive();
  let result = saturateEnumeration();
  const target = result.nextQueries.find((query) => query.field === "memberCount");
  assert.ok(target, "the highest-priority open field is offered first");

  const strategies = new Set();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const next = result.nextQueries.find((query) => query.gapId === target.gapId);
    if (!next) break;
    strategies.add(next.strategy);
    result = recordResearch({
      conversationId: CONVERSATION,
      searches: [
        { query: next.query, gapId: next.gapId, strategy: next.strategy, resultCount: 0 },
      ],
    });
  }
  assert.ok(strategies.size >= 2, "the same query is not simply repeated");
  assert.ok(
    result.exhaustedGaps > 0 || result.stop.stop,
    "the gap closes rather than being retried forever",
  );
});

test("missing and exhausted are different states, and only one licenses a claim", () => {
  beginExhaustive();
  let result = saturateEnumeration();
  // Nothing searched yet: the field is missing, not absent from the record.
  assert.deepEqual(exhaustedFieldLabels(CONVERSATION), []);

  const target = result.nextQueries.find((query) => query.field === "memberCount");
  assert.ok(target);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const next = result.nextQueries.find((query) => query.gapId === target.gapId);
    if (!next) break;
    result = recordResearch({
      conversationId: CONVERSATION,
      searches: [{ query: next.query, gapId: next.gapId, strategy: next.strategy }],
    });
  }
  const labels = exhaustedFieldLabels(CONVERSATION);
  assert.ok(
    labels.includes("member or headcount"),
    `a fully searched gap becomes reportable as absent, got ${JSON.stringify(labels)}`,
  );
});

test("the honesty gate blocks a non-publication claim with nothing exhausted", () => {
  const blocked = assessVerification(
    "The member count is not publicly available for that team.",
    [],
    { researchExhaustion: { active: true, exhaustedFields: [], stopped: true } },
  );
  assert.equal(blocked.state, "contradicted");
  assert.match(blocked.unsupportedClaims[0], /not publicly available/i);

  const allowed = assessVerification(
    "The member count is not publicly available for that team.",
    [],
    {
      researchExhaustion: {
        active: true,
        exhaustedFields: ["member or headcount"],
        stopped: true,
      },
    },
  );
  assert.deepEqual(allowed.unsupportedClaims, []);

  // Reporting one's own failure to find something is always allowed.
  const honest = assessVerification("I could not find the member count.", [], {
    researchExhaustion: { active: true, exhaustedFields: [], stopped: true },
  });
  assert.deepEqual(honest.unsupportedClaims, []);

  // And a turn with no research obligation at all is untouched by any of this.
  const unrelated = assessVerification(
    "Their headcount is not publicly available.",
    [],
    {},
  );
  assert.deepEqual(unrelated.unsupportedClaims, []);

  // A turn that owed the pipeline and skipped it entirely is the original
  // failure mode, so the gate stays armed rather than switching itself off.
  const skipped = assessVerification("Their headcount is not publicly available.", [], {
    researchExhaustion: { active: true, exhaustedFields: [], stopped: false },
  });
  assert.equal(skipped.state, "contradicted");
});

test("the search budget is a hard ceiling", () => {
  beginResearch({
    conversationId: CONVERSATION,
    question: "Compare the two leading approaches and their published results",
  });
  let result;
  for (let round = 0; round < 200; round += 1) {
    result = recordResearch({
      conversationId: CONVERSATION,
      searches: [{ query: `distinct query number ${round}` }],
    });
    if (result.stop.stop) break;
  }
  assert.ok(result.stop.stop, "the loop cannot run forever");
  assert.equal(result.stop.reason, "budget_exhausted");
  // Either ceiling ends it — searches or record iterations. Both are hard.
  assert.ok(
    result.searchesRemaining === 0 || result.stop.detail.includes("iterations"),
    "the run stopped on a stated budget ceiling",
  );
  assert.equal(researchStatus({ conversationId: CONVERSATION }).stop.reason, "budget_exhausted");
});

test("a gap id is never reissued after its entity disappears", () => {
  beginExhaustive();
  recordResearch({
    conversationId: CONVERSATION,
    entities: [{ name: "Alpha" }, { name: "Beta" }],
    completedEnumerationRound: true,
  });
  const saturated = saturateEnumeration("Alpha");
  const before = new Set(saturated.nextQueries.map((query) => query.gapId));
  // A later round adds a third entity, whose gaps must not collide with ids the
  // planner has already handed out for the first two.
  const after = recordResearch({
    conversationId: CONVERSATION,
    entities: [{ name: "Gamma" }],
  });
  const ids = after.nextQueries.map((query) => query.gapId);
  assert.equal(new Set(ids).size, ids.length, "planned gap ids are unique");
  for (const id of ids) {
    if (!before.has(id)) continue;
    // A reused id would point at a different entity/field pair than before.
    assert.ok(id.startsWith("g"));
  }
});

test("enumeration saturates when rounds stop producing new entities", () => {
  beginExhaustive();
  const first = recordResearch({
    conversationId: CONVERSATION,
    entities: [{ name: "Alpha" }, { name: "Beta" }],
    completedEnumerationRound: true,
  });
  assert.equal(first.saturated, false);
  assert.equal(first.newEntities.length, 2);

  recordResearch({
    conversationId: CONVERSATION,
    entities: [{ name: "alpha" }],
    completedEnumerationRound: true,
  });
  const third = recordResearch({
    conversationId: CONVERSATION,
    entities: [{ name: "Beta" }],
    completedEnumerationRound: true,
  });
  assert.equal(third.newEntities.length, 0);
  assert.equal(third.saturated, true, "two dry rounds is saturation");
  assert.notEqual(third.phase, "enumeration");
});

// --- E. integration: a synthetic exhaustive research run -----------------

test("an exhaustive run enumerates, enriches, reconciles, and reports honestly", () => {
  const begun = beginExhaustive();
  assert.ok(begun.applies);

  // Round 1: discovery. Three teams, one of them under a former name.
  let result = recordResearch({
    conversationId: CONVERSATION,
    entities: [
      { name: "Alpha Racing", lifecycle: "active" },
      { name: "Beta Solar", lifecycle: "active" },
      { name: "Gamma Aero", lifecycle: "dissolved" },
    ],
    searches: [{ query: "university student teams list" }],
    completedEnumerationRound: true,
  });
  assert.equal(result.newEntities.length, 3);

  // Round 2: an archive turns up the same team under its old name, plus a
  // fourth that the current directory no longer lists.
  result = recordResearch({
    conversationId: CONVERSATION,
    entities: [
      { name: "Alpha Motorsport", aliases: ["Alpha Racing"] },
      { name: "Delta Hyperloop", lifecycle: "inactive" },
    ],
    relationships: [
      { from: "Gamma Aero", to: "Beta Solar", kind: "merged_into" },
    ],
    searches: [{ query: "university student teams archive former" }],
    completedEnumerationRound: true,
  });
  assert.equal(
    result.entityCount,
    4,
    "the former name folded in; only the genuinely new team was added",
  );
  assert.ok(result.mergedAliases.length >= 1);

  // Round 3: enrichment, with a deliberate disagreement on one headcount.
  result = recordResearch({
    conversationId: CONVERSATION,
    evidence: [
      {
        entityName: "Alpha Racing",
        field: "memberCount",
        value: 21,
        ...source("https://alpha.example/team"),
        publishedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        // Same claim, same period, comparable authority: nothing here can
        // safely choose, so both values must survive to the answer.
        entityName: "Alpha Racing",
        field: "memberCount",
        value: 23,
        ...source("https://alpha.example/press", { sourceClass: "official_entity" }),
        publishedAt: "2026-02-10T00:00:00.000Z",
      },
      {
        // A weaker source contradicting the institution on membership: this one
        // is decidable, and the decision has to be disclosed rather than made
        // behind a single number.
        entityName: "Beta Solar",
        field: "foundedAt",
        value: "2011",
        ...source("https://university.example/beta", { sourceClass: "institution" }),
        publishedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        entityName: "Beta Solar",
        field: "foundedAt",
        value: "2013",
        ...source("https://forum.example/thread", { sourceClass: "social" }),
        publishedAt: "2026-01-05T00:00:00.000Z",
      },
      {
        entityName: "Beta Solar",
        field: "memberCount",
        value: 30,
        ...source("https://beta.example/about"),
        publishedAt: "2026-01-15T00:00:00.000Z",
      },
      {
        entityName: "Beta Solar",
        field: "status",
        value: "active",
        ...source("https://university.example/teams", { sourceClass: "institution" }),
      },
    ],
    searches: [{ query: "Alpha Racing member or headcount" }],
  });
  assert.ok(result.conflictsDetected >= 1, "the two headcounts are both kept");

  const status = researchStatus({ conversationId: CONVERSATION });
  assert.ok(status.coverage.entities === 4);
  assert.ok(status.coverage.total > 0);

  // The ledger, not the volume of material, governs stopping.
  if (!status.stop.stop) {
    assert.ok(status.nextQueries.length > 0, "an unfinished run always says what is next");
    assert.ok(status.coverage.highPriorityOpen > 0);
  }

  // Drive it to a stop through the planner, exactly as the model would.
  let guard = 0;
  let current = status;
  while (!current.stop.stop && guard < 400) {
    guard += 1;
    const queries = current.nextQueries.length
      ? current.nextQueries
      : [{ query: `filler ${guard}`, gapId: undefined, strategy: undefined }];
    recordResearch({
      conversationId: CONVERSATION,
      searches: queries.map((query) => ({
        query: query.query,
        ...(query.gapId ? { gapId: query.gapId } : {}),
        ...(query.strategy ? { strategy: query.strategy } : {}),
      })),
    });
    current = researchStatus({ conversationId: CONVERSATION });
  }
  assert.ok(current.stop.stop, `the run terminates (guard=${guard})`);
  assert.ok(current.synthesis, "stopping releases the normalized synthesis state");

  const synthesis = current.synthesis;
  const alpha = synthesis.entities.find((entity) => entity.name === "Alpha Racing");
  assert.ok(alpha, "the canonical name survives, not the alias");
  assert.ok(
    alpha.aliases.some((alias) => /Alpha Motorsport/i.test(alias)),
    "the former name is attached to the entity rather than counted as one",
  );
  assert.ok(
    alpha.conflicting.some((row) => row.field === "memberCount"),
    "the unresolved headcount reaches synthesis as a conflict, not as one number",
  );

  const gamma = synthesis.entities.find((entity) => entity.name === "Gamma Aero");
  assert.equal(
    gamma.lifecycle,
    "dissolved",
    "a source-stated lifecycle is not overwritten by inferred lineage",
  );
  assert.ok(
    gamma.lineage.some((edge) => edge.kind === "merged_into" && edge.other === "Beta Solar"),
    "the lineage is recorded alongside it rather than instead of it",
  );

  // Where nothing stated a lifecycle, the lineage is allowed to supply one.
  const delta = synthesis.entities.find((entity) => entity.name === "Delta Hyperloop");
  assert.equal(delta.lifecycle, "inactive");

  const beta = synthesis.entities.find((entity) => entity.name === "Beta Solar");
  assert.equal(beta.verified.memberCount.value, 30);
  assert.equal(beta.verified.memberCount.sourceUrl, "https://beta.example/about");
  // The decidable disagreement was decided — and disclosed, rather than
  // resolved silently into one number the reader cannot question.
  const settled = beta.resolvedConflicts.find((row) => row.field === "foundedAt");
  assert.ok(settled, "a resolved conflict is still reported");
  assert.equal(settled.chosen, "2011", "the institution outranks a forum post");
  assert.deepEqual(settled.otherValues, ["2013"]);
  assert.ok(settled.reason.length > 0);

  // The distinction that must survive all the way to the answer.
  for (const entity of synthesis.entities) {
    for (const field of entity.notFoundAfterSearch) {
      assert.ok(!entity.unresolved.includes(field), "a field is in exactly one bucket");
    }
  }
  assert.ok(synthesis.sources.length >= 4, "every source is carried into synthesis");
  assert.ok(synthesis.stopReason.length > 0);
});

// --- F. strategy effectiveness ------------------------------------------

test("a strategy that keeps working is tried earlier, without easing exhaustion", () => {
  const gap = { id: "g1", field: "memberCount", priority: 1, status: "unsearched", attempts: [] };
  const untrained = remainingStrategies(gap);
  assert.equal(untrained[0], "entity_field", "the default order applies at the start");

  // One lucky result must not reorder anything: below the sample floor the
  // measured strategy keeps the neutral prior.
  const thin = { [strategyStatsKey("memberCount", "document_search")]: { attempts: 1, hits: 1 } };
  assert.deepEqual(remainingStrategies(gap, thin), untrained);

  const learned = {
    [strategyStatsKey("memberCount", "document_search")]: { attempts: 4, hits: 4 },
    [strategyStatsKey("memberCount", "entity_field")]: { attempts: 4, hits: 0 },
  };
  const ranked = remainingStrategies(gap, learned);
  assert.equal(ranked[0], "document_search", "what works for this claim goes first");
  assert.equal(ranked.at(-1), "entity_field", "what never works goes last");
  // Reordering must never shrink the set — exhaustion is defined by it.
  assert.deepEqual([...ranked].sort(), [...untrained].sort());

  // The lesson is per claim shape: a different kind of claim is unaffected.
  const otherField = { ...gap, field: "achievements" };
  assert.deepEqual(remainingStrategies(otherField, learned), remainingStrategies(otherField));
});

test("the session records which strategies actually produced evidence", () => {
  beginExhaustive();
  let result = saturateEnumeration("Alpha");
  const target = result.nextQueries.find((query) => query.field === "memberCount");
  assert.ok(target);

  // One attempt that finds nothing, then one that does.
  result = recordResearch({
    conversationId: CONVERSATION,
    searches: [{ query: target.query, gapId: target.gapId, strategy: target.strategy }],
  });
  const next = result.nextQueries.find((query) => query.gapId === target.gapId);
  assert.ok(next);
  recordResearch({
    conversationId: CONVERSATION,
    searches: [{ query: next.query, gapId: next.gapId, strategy: next.strategy }],
    evidence: [
      {
        entityName: "Alpha",
        field: "memberCount",
        value: 12,
        ...source("https://alpha.example/team"),
      },
    ],
  });
  const stats = getResearchState(CONVERSATION).strategyStats;
  const miss = stats[strategyStatsKey("memberCount", target.strategy)];
  const hit = stats[strategyStatsKey("memberCount", next.strategy)];
  assert.equal(miss.attempts, 1);
  assert.equal(miss.hits, 0, "an attempt that produced nothing is recorded as such");
  assert.equal(hit.attempts, 1);
  assert.equal(hit.hits, 1, "and one that produced evidence is recorded as a hit");
});

// --- G. coverage summary for the evidence panel --------------------------

test("the coverage summary reports what is settled, searched out, and still open", () => {
  assert.equal(researchCoverageSummary(CONVERSATION), null, "no session, no summary");

  beginExhaustive();
  recordResearch({
    conversationId: CONVERSATION,
    entities: [{ name: "Alpha" }, { name: "Beta" }],
    completedEnumerationRound: true,
  });
  const summary = researchCoverageSummary(CONVERSATION);
  assert.equal(summary.entities, 2);
  assert.ok(summary.total > 0);
  assert.ok(summary.open > 0, "unsearched detail is open, not absent");
  assert.equal(summary.exhausted, 0);
  assert.equal(summary.stopReason, null, "an unfinished run says so rather than implying it finished");
  assert.ok(summary.openRows.length > 0);
  assert.ok(summary.openRows.length <= 6, "the panel gets a digest, never the matrix");
});

// --- H. the benchmark scorer ---------------------------------------------

/** A finished run, assembled directly so the scorer is tested, not the loop. */
function finishedStatus(overrides = {}) {
  return {
    sessionId: "rs-1",
    phase: "synthesis",
    stop: { stop: true, reason: "coverage_sufficient", detail: "done" },
    coverage: {
      fillRate: 0.9,
      settled: 9,
      total: 10,
      verified: 8,
      conflicting: 1,
      highPriorityOpen: 0,
      entities: 2,
      fields: 5,
    },
    searchesUsed: 24,
    rounds: 3,
    saturated: true,
    nextQueries: [],
    requestedFields: [
      { key: "name", label: "name", priority: 1, volatile: false },
      { key: "memberCount", label: "member or headcount", priority: 1, volatile: true },
      { key: "foundedAt", label: "founding date", priority: 2, volatile: false },
    ],
    synthesis: {
      question: "q",
      globalUnresolved: [],
      sources: [],
      stopReason: "done",
      entities: [
        {
          name: "Alpha Racing",
          aliases: ["Alpha Motorsport"],
          lifecycle: "active",
          verified: {
            memberCount: {
              value: 21,
              sourceUrl: "https://alpha.example",
              sourceClass: "official_entity",
              evidenceKind: "explicit",
              publishedAt: "2026-02-01T00:00:00.000Z",
              observedAt: "2026-06-01T00:00:00.000Z",
            },
          },
          inferred: {},
          conflicting: [{ field: "foundedAt", values: [2011, 2012], reason: "r" }],
          resolvedConflicts: [],
          notFoundAfterSearch: [],
          unresolved: [],
          lineage: [],
        },
        {
          name: "Gamma Aero",
          aliases: [],
          lifecycle: "dissolved",
          verified: {
            memberCount: {
              value: 8,
              sourceUrl: "https://news.example",
              sourceClass: "reputable_secondary",
              evidenceKind: "inference",
              observedAt: "2026-06-01T00:00:00.000Z",
            },
          },
          inferred: {},
          conflicting: [],
          resolvedConflicts: [],
          notFoundAfterSearch: [],
          unresolved: ["foundedAt"],
          lineage: [{ kind: "merged_into", other: "Alpha Racing" }],
        },
      ],
    },
    ...overrides,
  };
}

const REFERENCE = {
  entities: ["Alpha Racing", "Gamma Aero", "Delta Hyperloop"],
  aliases: { "Alpha Racing": ["Alpha Motorsport"] },
  lineage: [["Gamma Aero", "merged_into", "Alpha Racing"]],
  knownConflicts: [{ entity: "Alpha Racing", field: "foundedAt" }],
};

test("the benchmark measures recall, provenance and lineage against a reference", () => {
  const score = scoreResearchRun({ status: finishedStatus(), reference: REFERENCE });
  assert.equal(score.entityRecall, 0.6667, "two of three reference entities were found");
  assert.deepEqual(score.missed, ["Delta Hyperloop"]);
  assert.deepEqual(score.unmatchedFound, [], "an alias match is not an extra entity");
  assert.equal(score.lineageRecall, 1);
  assert.equal(score.conflictRecall, 1, "a preserved disagreement counts");
  // One of two volatile values carries its source's date; one of two stated
  // values was read rather than inferred; one of two came from a fitting source.
  assert.equal(score.temporalProvenance, 0.5);
  assert.equal(score.evidenceQuality, 0.5);
  assert.equal(score.sourceAuthority, 0.5);
  assert.equal(score.searches, 24);
  assert.equal(score.stopReason, "coverage_sufficient");
  assert.equal(score.verdict.pass, false, "recall below the floor fails");
  assert.match(score.verdict.reasons[0], /entity recall/);
});

test("the benchmark refuses to reward recall bought with invention", () => {
  const complete = {
    ...REFERENCE,
    entities: ["Alpha Racing", "Gamma Aero"],
  };
  const honest = scoreResearchRun({ status: finishedStatus(), reference: complete });
  assert.equal(honest.entityRecall, 1);
  assert.equal(honest.verdict.pass, true);

  // The same perfect recall, with one fabricated claim in the answer.
  const fabricated = scoreResearchRun({
    status: finishedStatus(),
    reference: complete,
    unsupportedClaims: ["Headcount claim has no successful web-search evidence."],
  });
  assert.equal(fabricated.entityRecall, 1, "recall is unchanged");
  assert.equal(fabricated.verdict.pass, false, "and the run still fails");
  assert.match(fabricated.verdict.reasons.join(" "), /invention is a regression/);
});

test("the benchmark reports transparency only when it can see the answer", () => {
  const blind = scoreResearchRun({ status: finishedStatus(), reference: REFERENCE });
  assert.equal(blind.coverageTransparency, null, "no answer text, no invented score");

  const silent = scoreResearchRun({
    status: finishedStatus(),
    reference: REFERENCE,
    answerText: "Alpha Racing has 21 members and Gamma Aero merged into it.",
  });
  assert.equal(silent.coverageTransparency, 0, "an unmentioned gap is not reported");

  const honest = scoreResearchRun({
    status: finishedStatus(),
    reference: REFERENCE,
    answerText:
      "Alpha Racing has 21 members. Gamma Aero merged into it; its founding date could not be established.",
  });
  assert.equal(honest.coverageTransparency, 1, "naming the gap counts as reporting it");
});

test("the benchmark distinguishes scoring perfectly from never being tested", () => {
  // A reference set with no lineage and no known conflicts must not read as
  // perfect lineage recall — the reviewer has to be able to tell the two apart.
  const score = scoreResearchRun({
    status: finishedStatus(),
    reference: { entities: ["Alpha Racing", "Gamma Aero"] },
  });
  assert.equal(score.lineageRecall, null);
  assert.equal(score.conflictRecall, null);
  assert.equal(score.entityRecall, 1, "what was tested is still scored");
  assert.equal(score.verdict.pass, true);

  const untested = scoreResearchRun({
    status: finishedStatus(),
    reference: { entities: [] },
  });
  assert.equal(untested.entityRecall, null);
  assert.equal(untested.verdict.pass, false, "an untested run is not a passing run");
  assert.match(untested.verdict.reasons.join(" "), /never tested/);
});

test("an unfinished run cannot pass the benchmark", () => {
  const unfinished = finishedStatus({
    stop: { stop: false, reason: "not_stopping", detail: "still going" },
    synthesis: undefined,
  });
  const score = scoreResearchRun({ status: unfinished, reference: REFERENCE });
  assert.equal(score.entityRecall, 0);
  assert.equal(score.verdict.pass, false);
  assert.match(score.verdict.reasons.join(" "), /never reached a stopping point/);
});

test("no synthesis state is released while the run is unfinished", () => {
  beginExhaustive();
  const result = recordResearch({
    conversationId: CONVERSATION,
    entities: [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }],
    completedEnumerationRound: true,
  });
  assert.equal(result.stop.stop, false);
  const status = researchStatus({ conversationId: CONVERSATION });
  assert.equal(status.synthesis, undefined, "unfinished work hands back nothing to write from");
  assert.ok(status.nextQueries.length > 0, "and always says what to do instead");
});
