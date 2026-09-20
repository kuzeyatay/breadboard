// What happens to an answer after it is given, and what may be concluded from it.
//
// The cases worth having are the ones that keep this from becoming a machine
// that invents preferences: a rating has to be attributable to a turn rather
// than to a string, a pattern has to clear a floor before it is reported, and
// nothing may reach durable memory without somebody saying so.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-answer-signals-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const signals = await import("../src/lib/hermes/answer-signals.ts");
const conditions = await import("../src/lib/hermes/answer-conditions.ts");
const analysis = await import("../src/lib/hermes/answer-signal-analysis.ts");
const proposals = await import("../src/lib/hermes/answer-signal-proposals.ts");
const scenarios = await import("../src/lib/hermes/answer-quality-scenarios.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  signals.ensureAnswerSignalSchema(db);
  proposals.ensureProposalDecisionSchema(db);
  db.exec(`
    DELETE FROM answer_signals;
    DELETE FROM answer_signal_proposal_decisions;
    DELETE FROM durable_memories;
    DELETE FROM conversations;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (2, 'bob', 'bob@example.test', 'x')",
  ).run();
});

let turnCounter = 0;

/** One completed question-and-answer pair, as the real pipeline would leave it. */
function turn(conversation, question, answer, metadata = {}) {
  turnCounter += 1;
  const clientMessageId = `client-message-${turnCounter}-${Date.now()}`;
  store.reserveConversationTurn({
    conversation,
    clientMessageId,
    surface: "dashboard_terminal",
    content: question,
  });
  return store.completeAssistantMessage({
    conversationId: conversation.id,
    clientMessageId,
    content: answer,
    metadata: { runtimeStatus: "idle", responseDurationMs: 1200, ...metadata },
  });
}

function conversation(userId = 1, title = "New chat") {
  return store.createConversation({ userId, title });
}

/** A signal as the route would record it, conditions included. */
function record(userId, assistant, kind, reason = null) {
  const prompt = store.getPrecedingUserMessage(
    assistant.conversation_id,
    assistant.order_index,
  );
  return signals.recordAnswerSignal({
    userId,
    conversationId: assistant.conversation_id,
    messageId: assistant.id,
    kind,
    reason,
    conditions: conditions.captureAnswerConditions({ assistant, prompt }),
  });
}

// ------------------------------------------------------------------- storing

test("a rating is keyed to the answer, not to its text", () => {
  const first = conversation(1, "One");
  const second = conversation(1, "Two");
  // The same answer, word for word, in two conversations. Under the old
  // content-hash key these shared a single rating.
  const a = turn(first, "What is the capital of France?", "Paris.");
  const b = turn(second, "What is the capital of France?", "Paris.");

  record(1, a, "rated_up");
  record(1, b, "rated_down");

  assert.equal(signals.getAnswerRating(1, a.id), "rated_up");
  assert.equal(signals.getAnswerRating(1, b.id), "rated_down");
});

test("an answer is rated up, rated down, or neither — never both", () => {
  const chat = conversation();
  const answer = turn(chat, "Explain TCP backoff.", "It doubles the wait each loss.");

  record(1, answer, "rated_up");
  record(1, answer, "rated_down");

  const rows = db
    .prepare("SELECT signal_kind FROM answer_signals WHERE message_id = ?")
    .all(answer.id);
  assert.deepEqual(rows, [{ signal_kind: "rated_down" }]);
  assert.equal(signals.getAnswerRating(1, answer.id), "rated_down");
});

test("a rating can be taken back, because a misclick is not evidence", () => {
  const chat = conversation();
  const answer = turn(chat, "How wide is a cache line?", "64 bytes on x86-64.");

  record(1, answer, "rated_up");
  assert.equal(signals.clearAnswerRating(1, answer.id), true);
  assert.equal(signals.getAnswerRating(1, answer.id), null);
  assert.equal(signals.clearAnswerRating(1, answer.id), false);
});

test("a repeated implicit signal is one behaviour with a count", () => {
  const chat = conversation();
  const answer = turn(chat, "Give me the curl command.", "curl -sS https://example.test");

  record(1, answer, "copied");
  record(1, answer, "copied");
  record(1, answer, "copied");

  const rows = db
    .prepare("SELECT occurrences FROM answer_signals WHERE message_id = ? AND signal_kind = 'copied'")
    .all(answer.id);
  assert.equal(rows.length, 1, "three copies must not be three rows");
  assert.equal(rows[0].occurrences, 3);
});

test("a later implicit signal cannot blank the conditions a rating captured", () => {
  const chat = conversation();
  const answer = turn(chat, "Why does this build fail?", "The worker was killed.");

  record(1, answer, "rated_down", "wrong");
  // A signal recorded without conditions, as a caller that could not build them
  // would send. The snapshot must survive it.
  signals.recordAnswerSignal({
    userId: 1,
    conversationId: chat.id,
    messageId: answer.id,
    kind: "rated_down",
    reason: "wrong",
    conditions: null,
  });

  const stored = signals.listAnswerSignals(1)[0];
  assert.equal(stored.conditions.version, conditions.CONDITIONS_VERSION);
});

test("a reason is only kept on a judgement", () => {
  const chat = conversation();
  const answer = turn(chat, "Summarize this.", "Here is the summary.");

  record(1, answer, "copied", "too_long");
  const stored = signals.listAnswerSignals(1, { kinds: ["copied"] })[0];
  assert.equal(stored.reason, null, "a copy carries no complaint to interpret");
});

test("signals never leak between users", () => {
  const chat = conversation(1);
  const answer = turn(chat, "What is the answer?", "Forty-two.");

  record(1, answer, "rated_up");
  assert.equal(signals.getAnswerRating(2, answer.id), null);
  assert.equal(signals.listAnswerSignals(2).length, 0);
  assert.equal(signals.clearAnswerRating(2, answer.id), false);
});

test("deleting the answer deletes what was said about it", () => {
  const chat = conversation();
  const answer = turn(chat, "Draft the email.", "Here is a draft.");
  record(1, answer, "rated_down", "style");

  db.prepare("DELETE FROM conversation_messages WHERE id = ?").run(answer.id);
  assert.equal(signals.listAnswerSignals(1).length, 0);
});

// ---------------------------------------------------------------- conditions

test("conditions record the contracts the turn shipped under", () => {
  const chat = conversation();
  const answer = turn(chat, "How does garbage collection work?", "Several ways.", {
    model: "cliproxy/gemini-3-flash",
  });
  const prompt = store.getPrecedingUserMessage(chat.id, answer.order_index);
  const captured = conditions.captureAnswerConditions({ assistant: answer, prompt });

  assert.equal(captured.version, conditions.CONDITIONS_VERSION);
  assert.equal(captured.model, "cliproxy/gemini-3-flash");
  assert.equal(captured.status, "complete");
  assert.equal(captured.surface, "dashboard_terminal");
  // An unscoped "how does X work" is exactly the shape the answer-depth gate
  // ships on, which is the association the whole analysis is built to test.
  assert.equal(captured.contracts.questionScope, "general");
  assert.equal(typeof captured.contracts.metaTask, "string");
  assert.equal(captured.contracts.metaTaskApproximate, true);
  assert.equal(captured.promptChars, "How does garbage collection work?".length);
});

test("capturing conditions survives a malformed sources column", () => {
  const chat = conversation();
  const answer = turn(chat, "Cite your sources.", "Here they are.");
  db.prepare("UPDATE conversation_messages SET sources = ? WHERE id = ?").run(
    "{not json",
    answer.id,
  );
  const reloaded = store.getConversationMessageById(answer.id);

  const captured = conditions.captureAnswerConditions({
    assistant: reloaded,
    prompt: null,
  });
  assert.equal(captured.sourceCount, 0, "a bad column must not fail the rating");
  assert.equal(captured.promptChars, 0);
});

// ------------------------------------------------------------------ analysis

/** A downvote carrying whatever conditions a test needs to assert about. */
function syntheticSignal(overrides = {}) {
  return {
    id: Math.floor(Math.random() * 1e9),
    conversationId: 1,
    messageId: Math.floor(Math.random() * 1e9),
    kind: "rated_down",
    reason: "too_long",
    occurrences: 1,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
    conditions: {
      version: conditions.CONDITIONS_VERSION,
      status: "complete",
      derived: false,
      surface: "dashboard_terminal",
      model: "test-model",
      contracts: { questionScope: "general", metaTask: "explanation" },
      ...(overrides.conditions ?? {}),
    },
  };
}

test("a group below the support floor is not reported at all", () => {
  const few = Array.from({ length: analysis.MIN_SUPPORT - 1 }, () => syntheticSignal());
  assert.equal(analysis.summarizeSignalsByCondition(few).length, 0);

  const enough = Array.from({ length: analysis.MIN_SUPPORT }, () => syntheticSignal());
  const groups = analysis.summarizeSignalsByCondition(enough);
  const scope = groups.find((group) => group.dimension === "questionScope");
  assert.equal(scope.value, "general");
  assert.equal(scope.ratedDown, analysis.MIN_SUPPORT);
  assert.equal(scope.net, -analysis.MIN_SUPPORT);
});

test("implicit signals shape the report but never buy a group past the floor", () => {
  const copies = Array.from({ length: 20 }, () => syntheticSignal({ kind: "copied", reason: null }));
  assert.equal(
    analysis.summarizeSignalsByCondition(copies).length,
    0,
    "twenty copies are not five ratings",
  );
});

/** A signal on a scoped question, to give a population something to vary in. */
function scopedSignal(overrides = {}) {
  return syntheticSignal({
    ...overrides,
    conditions: {
      contracts: { questionScope: "scoped", metaTask: "implementation" },
      ...(overrides.conditions ?? {}),
    },
  });
}

test("a complaint spread across conditions names none of them", () => {
  // Six "too_long" downvotes, evenly spread: the answers were bad, but nothing
  // about any one condition is implicated.
  const spread = [
    syntheticSignal(),
    scopedSignal(),
    syntheticSignal({ conditions: { contracts: { questionScope: "none", metaTask: "authoring" } } }),
    scopedSignal(),
    syntheticSignal({ conditions: { contracts: { questionScope: "none", metaTask: "extraction" } } }),
    syntheticSignal(),
  ];
  const { proposals: produced } = analysis.proposeStandingPreferences(spread);
  assert.equal(produced.length, 0);
});

test("a condition shared by every turn explains nothing, however concentrated", () => {
  // Every complaint is on dashboard_terminal at 100% concentration — because
  // every turn is. A analysis without a baseline reports this as a cause.
  const set = Array.from({ length: 8 }, () => syntheticSignal());
  const { findings, proposals: produced } = analysis.proposeStandingPreferences(set);

  assert.equal(
    findings.some((finding) => finding.dimension === "surface"),
    false,
    "the only surface in use cannot be what distinguishes the bad answers",
  );
  assert.equal(
    produced.some((proposal) => proposal.dimension === "surface"),
    false,
  );
});

test("a concentrated complaint becomes a proposal naming the condition", () => {
  // The real signature of a gate that over-ships: broad questions are half of
  // all turns, and all of the length complaints.
  const population = [
    ...Array.from({ length: 6 }, () => syntheticSignal()),
    ...Array.from({ length: 6 }, () => scopedSignal({ kind: "rated_up", reason: null })),
  ];
  const { findings, proposals: produced } = analysis.proposeStandingPreferences(population);

  const scope = produced.find((proposal) => proposal.dimension === "questionScope");
  assert.ok(scope, "the condition the complaints land on must be named");
  assert.equal(scope.kind, "preference");
  assert.match(scope.content, /broad question/);
  assert.equal(scope.concentration, 1);
  assert.equal(scope.baseline, 0.5);
  assert.ok(findings.some((finding) => finding.dimension === "questionScope"));
});

test("wrongness and style are findings, never preferences", () => {
  for (const reason of ["wrong", "style"]) {
    const population = [
      ...Array.from({ length: 8 }, () => syntheticSignal({ reason })),
      ...Array.from({ length: 8 }, () => scopedSignal({ kind: "rated_up", reason: null })),
    ];
    const { findings, proposals: produced } = analysis.proposeStandingPreferences(population);
    assert.ok(findings.length, `${reason} should still be reported`);
    assert.equal(
      produced.length,
      0,
      `${reason} has no preference that could be written from it`,
    );
  }
});

test("a model is never turned into a preference about the user", () => {
  const population = [
    ...Array.from({ length: 8 }, () => syntheticSignal()),
    ...Array.from({ length: 8 }, () =>
      scopedSignal({ kind: "rated_up", reason: null, conditions: { model: "other-model" } }),
    ),
  ];
  const { findings, proposals: produced } = analysis.proposeStandingPreferences(population);

  assert.ok(
    findings.some((finding) => finding.dimension === "model"),
    "a model that attracts the complaints is worth reporting",
  );
  assert.equal(
    produced.some((proposal) => proposal.dimension === "model"),
    false,
    "answers from one model being long is a routing fact, not a standing preference",
  );
});

test("ratings that cannot be compared are excluded, and say why", () => {
  const mixed = [
    ...Array.from({ length: 6 }, () => syntheticSignal()),
    syntheticSignal({ conditions: { version: 0 } }),
    syntheticSignal({ conditions: { status: "failed" } }),
    syntheticSignal({ conditions: { derived: true } }),
  ];
  const result = analysis.analyzeAnswerSignals(mixed);

  assert.equal(result.considered, 6);
  assert.deepEqual(result.excluded, {
    stale_conditions: 1,
    incomplete_turn: 1,
    derived_answer: 1,
  });
});

// ----------------------------------------------------------------- proposals

function concentratedProposal() {
  const population = [
    ...Array.from({ length: 6 }, () => syntheticSignal()),
    ...Array.from({ length: 6 }, () => scopedSignal({ kind: "rated_up", reason: null })),
  ];
  return analysis.proposeStandingPreferences(population).proposals.find(
    (proposal) => proposal.dimension === "questionScope",
  );
}

test("a dismissed proposal is never offered again", () => {
  const proposal = concentratedProposal();
  assert.equal(proposals.pendingProposals(1, [proposal], db).length, 1);

  proposals.dismissProposal(
    { userId: 1, proposalId: proposal.id, content: proposal.content },
    db,
  );
  assert.equal(
    proposals.pendingProposals(1, [proposal], db).length,
    0,
    "re-offering a rejected proposal every read is not consent",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM durable_memories").get().n,
    0,
    "dismissing must write nothing",
  );
});

test("accepting is the only thing that writes a memory, and writes it once", () => {
  const proposal = concentratedProposal();

  proposals.acceptProposal({ userId: 1, proposal }, db);
  proposals.acceptProposal({ userId: 1, proposal }, db);

  const rows = db
    .prepare("SELECT content, kind, scope, state FROM durable_memories WHERE user_id = 1")
    .all();
  assert.equal(rows.length, 1, "a second accept must not add a near-duplicate");
  assert.equal(rows[0].content, proposal.content);
  assert.equal(rows[0].kind, "preference");
  // Confirmed and global is what puts it in the standing set; a candidate row
  // would never be applied, so accepting would appear to do nothing.
  assert.equal(rows[0].scope, "global");
  assert.equal(rows[0].state, "confirmed");
  assert.equal(proposals.pendingProposals(1, [proposal], db).length, 0);
});

test("an inferred preference does not outrank a stated one", () => {
  const proposal = concentratedProposal();
  proposals.acceptProposal({ userId: 1, proposal }, db);
  const row = db
    .prepare("SELECT confidence FROM durable_memories WHERE user_id = 1")
    .get();
  assert.ok(row.confidence < 1, "a preference guessed from six ratings is not certain");
});

test("retracting a decision leaves the memory the user can already see", () => {
  const proposal = concentratedProposal();
  proposals.acceptProposal({ userId: 1, proposal }, db);

  assert.equal(proposals.retractProposalDecision(1, proposal.id, db), true);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM durable_memories").get().n,
    1,
    "deleting it here would be a second, invisible write",
  );
});

// ----------------------------------------------------------------- scenarios

test("only a reasoned downvote nominates a benchmark scenario", () => {
  const nominated = scenarios.nominateScenarios([
    {
      signal: syntheticSignal({ kind: "regenerated", reason: null }),
      question: "Why does the deploy keep failing?",
      answer: "Hard to say.",
    },
    {
      signal: syntheticSignal({ kind: "rated_down", reason: null }),
      question: "Why does the deploy keep failing?",
      answer: "Hard to say.",
    },
    {
      signal: syntheticSignal({ kind: "rated_down", reason: "missed_point" }),
      question: "Why does the deploy keep failing?",
      answer: "Hard to say.",
    },
  ]);

  assert.equal(nominated.length, 1);
  assert.equal(nominated[0].reason, "missed_point");
  assert.equal(nominated[0].propertiesNeedReview, false);
  assert.ok(nominated[0].must.length && nominated[0].mustNot.length);
});

test("a style complaint arrives needing a reviewer, not a fabricated rule", () => {
  const [candidate] = scenarios.nominateScenarios([
    {
      signal: syntheticSignal({ reason: "style" }),
      question: "Write the release note for this change.",
      answer: "Here is a release note.",
    },
  ]);
  assert.equal(candidate.propertiesNeedReview, true);
  assert.ok(candidate.must.every((text) => text.startsWith("REVIEW:")));
});

test("the same question rated down twice is one scenario", () => {
  const input = {
    signal: syntheticSignal({ reason: "too_long" }),
    question: "How does the retry backoff work?",
    answer: "A long answer.",
  };
  const nominated = scenarios.nominateScenarios([input, { ...input, answer: "Another." }]);
  assert.equal(nominated.length, 1);
  assert.equal(nominated[0].failingAnswer, "A long answer.");
});

test("a question too short to replay is not nominated", () => {
  assert.equal(
    scenarios.nominateScenarios([
      { signal: syntheticSignal(), question: "why?", answer: "Because." },
    ]).length,
    0,
  );
});

test("merging keeps a reviewer's edits to a candidate", () => {
  const [candidate] = scenarios.nominateScenarios([
    {
      signal: syntheticSignal({ reason: "style" }),
      question: "Write the release note for this change.",
      answer: "Here is a release note.",
    },
  ]);
  const reviewed = {
    ...candidate,
    must: ["Uses the imperative mood."],
    propertiesNeedReview: false,
  };

  const { candidates, added } = scenarios.mergeCandidates([reviewed], [candidate]);
  assert.equal(added, 0);
  assert.deepEqual(candidates[0].must, ["Uses the imperative mood."]);
});
