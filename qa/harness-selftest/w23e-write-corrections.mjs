#!/usr/bin/env node

/**
 * W2-3E Phase 16 — test corrections: designed, categorised, and not applied.
 *
 * A classification is not a licence to edit an oracle. Each correction below
 * records what the test currently asserts, what the contract actually is, the
 * evidence for that, the replacement, and how the replacement would be proven
 * non-vacuous — so the change can be made in one reviewed step rather than
 * inferred later from a verdict.
 *
 * Run from the repository root with the run directory as the first argument.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const runDir = process.argv[2];
if (!runDir) throw new Error("usage: w23e-write-corrections.mjs <run-dir>");
const snapshot = JSON.parse(fs.readFileSync(path.join(runDir, "execution-snapshot.json"), "utf8"));

const corrections = [
  {
    testId: "tests/vimax-chat-ownership.test.mjs :: a Garden film binds to the turn that asked for it",
    subRoot: "ARTIFACT_TURN_BINDING",
    classification: "FIXTURE_BUG",
    category: "A",
    categoryReason:
      "The assertion is already behavioural — it reads originating_message_id and canonical_message_id out of a real database. Only the fixture is wrong, so correcting it establishes no repository-wide policy.",
    oldContract:
      "The Garden writes external agent turns as a raw legacy chat_messages insert with canonical_message_id NULL, and the product must bind the film anyway.",
    actualContract:
      "The Garden agent chat records external agent turns through the canonical store, exactly as the Terminal does, and the dual write carries the canonical id onto the legacy row so the Garden transcript can address the turn.",
    evidence: [
      "garden-agent-chat.tsx calls useAgentSession(\"garden_chat\"), which POSTs to /api/hermes/sessions/<id>/external-turns.",
      "That route calls recordExternalAgentTurn — the same function the passing Terminal case calls; the surface is a parameter, not a separate path.",
      "Neither legacy garden chat that PATCHes /api/chat-sessions launches an external agent.",
      "Executed: a film launched on garden_chat bound to its asking turn, and the legacy row carried the same canonical id.",
    ],
    replacementTestDesign:
      "Replace saveLegacyGardenTurn with recordExternalAgentTurn for the garden_chat conversation, keeping every existing assertion unchanged — including the legacy canonical_message_id assertion, which is what proves the dual write reaches the Garden's own projection. Keep the launch ordering (context opened before the turn exists), since that is what makes late resolution the thing under test.",
    nonVacuityPlan:
      "Seed each of these into a local stand-in resolver and require the corrected test to fail: drop the conversation scope from the lookup; fall back to the newest assistant message; skip the legacy dual write. All three were already proven detectable in behaviour-counterexamples.json.",
    doNotDo:
      "Do not assert only that originating_message_id is non-null. Existence is not ownership, and a newest-turn resolver would satisfy it.",
  },
  {
    testId: "tests/visual-decision-policy.test.mjs :: 11. Only a model-authored visual contract reaches implementation dispatch",
    subRoot: "VISUAL_CONTRACT_VALIDATION",
    classification: "FIXTURE_BUG",
    category: "A",
    categoryReason: "The assertions are behavioural; the suite's local helper predates the tightened contract.",
    oldContract:
      "A model-authored plan is interactionGoal + visualIntent + controlContract + observable + expectedInsightEvidence.",
    actualContract:
      "A model-authored plan is those fields plus a non-empty learnerAction, and the decision's own interaction contract must equal the projection of the plan exactly, so no later stage can re-author the model's intent.",
    evidence: [
      "The repair prompt instructs the model to author the complete non-empty learnerAction sequence.",
      "The necessity batch carries decision.interaction.learnerAction; implementation consumes opportunity.learnerAction.",
      "Executed: omitting any one of the four required fields is refused with that field named; a blank learnerAction is refused; a decision diverging by one field is refused.",
      "Executed: a contract assembled the way the pipeline assembles one routes to generated_module and yields a concrete interactive intent.",
    ],
    replacementTestDesign:
      "Extend withModelAuthoredPlan to author learnerAction and to set decision.interaction from pedagogyContractFromCompleteRepair over the plan it just built — the same projection the product uses. Every existing assertion stays as written, including the assert.throws for the unauthored case, which is the half of the contract that keeps unvalidated model output out of dispatch.",
    nonVacuityPlan:
      "Require the corrected test to fail when the completeness check is removed, when the coherence check is removed, and when whitespace is accepted as an authored action. All three were proven detectable in behaviour-counterexamples.json.",
    doNotDo:
      "Do not relax the validator, and do not delete the assert.throws. The refusal is the contract, not an obstacle to it.",
  },
  {
    testId: "tests/visual-decision-policy.test.mjs :: a comparison unit acquires an interactive intent after routing",
    subRoot: "VISUAL_CONTRACT_VALIDATION",
    classification: "FIXTURE_BUG",
    category: "A",
    categoryReason: "Same helper, same correction.",
    oldContract: "Routing a comparison unit yields an interactive intent from a plan lacking learnerAction.",
    actualContract:
      "Routing yields the intent once the contract is complete and coherent; W2-3C's reading that this test pointed at ordering rather than absence is refuted, because supplying the contract makes the routing succeed with no ordering change.",
    evidence: [
      "Executed: with a complete, coherent contract the routed unit carries a concrete interactive intent with a visualType.",
    ],
    replacementTestDesign: "Shared with the correction above — the helper is fixed once and both tests follow.",
    nonVacuityPlan: "Shared with the correction above.",
    doNotDo: "Do not assert merely that some unit survives routing; assert that it carries the intent.",
  },
  {
    testId: "tests/assistant-models-refresh.test.mjs :: provider changes in settings announce the new catalog",
    subRoot: "CATALOG_CHANGE_ANNOUNCEMENT",
    classification: "STALE_TEST",
    category: "B",
    categoryReason:
      "The assertion counts occurrences of a call in one source file. Replacing it with an executable check is exactly the source-shape-to-executable policy question this pass must not settle by accident.",
    oldContract: "settings-providers.tsx contains at least two notifyAssistantModelsChanged() calls.",
    actualContract:
      "Every funnel that changes which models exist announces on the shared channel; the announcement invalidates the cached catalog; and an already-loaded picker refetches because the handler forces the load.",
    evidence: [
      "The subscription catalog sync moved to settings-accounts.tsx :: syncSubscriptionModels, because the account list became the only place a sign-in starts.",
      "The provider funnel announces from the shared mutate() helper, so no provider mutation can bypass it.",
      "Executed: an announcement reached a real listener; the cache went 1 -> 1 -> 2 fetches across a repeat load and an announcement; a forced load always hit the network.",
    ],
    replacementTestDesign:
      "Assert the behaviour at the shared channel: dispatch through the real notifyAssistantModelsChanged, require a registered listener to fire, and require the catalog client to refetch afterwards. Cover both funnels by name rather than by counting call sites in one file.",
    nonVacuityPlan:
      "Require failure when the announcement does not invalidate the cache, when one funnel stops announcing, and when the forced refetch is served from cache. All three were proven detectable.",
    doNotDo: "Do not lower the count from 2 to 1. That would delete the contract instead of relocating the measurement.",
  },
  {
    testId: "tests/neumorphic-workspaces.test.mjs :: workspace neumorphism is built from shared visual-only materials",
    subRoot: "WORKSPACE_MATERIAL_ISOLATION",
    classification: "TEST_EXPECTATION_BUG",
    category: "B",
    categoryReason: "The replacement swaps a source-text slice for a parsed rule set — the same policy question.",
    oldContract:
      "No line between the comment 'Breadboard workspace materials' and the marker '.neu-progress-track' begins with a motion or layout property.",
    actualContract: "No bb-neu-* material rule declares a motion or layout property.",
    evidence: [
      "All 21 bb-neu-* rules were parsed and none declares one, so the intended invariant holds.",
      "The text window now also contains .bb-chat-marquee and .bb-garden-card-action:active. A marquee must set transform and overflow, so the assertion as written expects something that was never intended to be true.",
    ],
    replacementTestDesign:
      "Parse the stylesheet into rules and assert the property set of every rule whose selector matches .bb-neu-*. The check then stays correct however the file is reordered or extended.",
    nonVacuityPlan:
      "Seed overflow into one material rule and transform into another; each must be caught. Both were proven detectable.",
    doNotDo:
      "Do not move the end marker further up. That trades one accidental window for another and will drift again.",
  },
  {
    testId: "tests/socials-manager-integration.test.mjs :: the inline card is styled with the shared neumorphic material",
    subRoot: "AGENT_RUN_CARD_MATERIAL",
    classification: "STALE_TEST",
    category: "B",
    categoryReason: "Replacing substring presence with a rendered or family-relative check is the same policy question.",
    oldContract: "The card's source contains eight named class strings.",
    actualContract:
      "The card is built from the shared agent-run material vocabulary, every class it uses is defined in the stylesheet, and it carries no brand colour.",
    evidence: [
      "The card uses 12 shared agent-run classes, all defined in the stylesheet, and no brand hex colour.",
      "bb-agent-run-icon is used by 0 of 32 inline agent-run cards and is not defined in the stylesheet at all; neu-button and neu-inset by 0 of 32; bb-agent-run-pill by 2 of 32.",
      "Satisfying the assertion as written would mean adding markup for a class that does not exist.",
    ],
    replacementTestDesign:
      "Assert against the family: the card shares the vocabulary the other inline agent-run cards use, every class it names is defined in the stylesheet, and no brand hex appears. Keep the brand-colour assertion exactly as it is — it already tests the right thing.",
    nonVacuityPlan:
      "Seed a bespoke-class rebuild, a reintroduced brand hex, and an undefined class name; each must be caught. All three were proven detectable.",
    doNotDo:
      "Do not add a bb-agent-run-icon element to satisfy the assertion. That is dead markup for a class the stylesheet does not define.",
  },
];

const noCorrection = [
  {
    subRoot: "SKILL_INTEGRITY_PIN",
    tests: 5,
    decision: "NO_CORRECTION",
    why:
      "All five tests assert the intended behaviour correctly. They fail because the product is wrong, and they must stay red until finding W23E-001 is repaired. Correcting them would be the exact failure mode this whole Week-2 sequence exists to prevent.",
  },
];

const record = {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: snapshot.executionSnapshotId,
  applied: 0,
  appliedReason:
    "None applied. The three category-B corrections would each replace a source-shape assertion with an executable one, which is the unresolved repository-wide policy question this pass was told not to settle by accident. The three category-A corrections are eligible, and are held only because the user's own ordering places 'apply approved test corrections' after the policy pass — applying half the set now would split one reviewable change into two.",
  designed: corrections.length,
  byCategory: {
    A: corrections.filter((entry) => entry.category === "A").length,
    B: corrections.filter((entry) => entry.category === "B").length,
  },
  corrections,
  noCorrectionNeeded: noCorrection,
};

fs.writeFileSync(path.join(runDir, "test-corrections.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");

fs.mkdirSync(path.join(runDir, "repair-receipts"), { recursive: true });
fs.writeFileSync(
  path.join(runDir, "repair-receipts", "README.md"),
  `# No repair receipts

One \`PRODUCT_BUG\` was confirmed and independently reproduced this pass
(\`W23E-001\`, P1, see \`../product-findings.json\`). No SH1 repair was opened, so
this directory is deliberately empty rather than incomplete.

Every viable repair crosses a fence set for this work:

- normalising line endings before hashing changes how an integrity control
  reaches its verdict, and "do not change security boundaries" is a standing
  Week-1 constraint;
- adding \`.gitattributes\` so git stops rewriting these files is a
  repository-wide checkout-policy change the W2-3C instructions discouraged;
- regenerating the pins is forbidden by the W2-3B instruction that the pin
  exists to stop unreviewed generated guidance shipping — and would not hold,
  because the next checkout under the other policy breaks it again.

The finding carries a full causal chain, an independent reproduction from two
fresh checkouts, three candidate repairs with their risks, and a regression test
for each. It needs a human decision, not a QA pass quietly rewriting a trust
control.
`,
  "utf8",
);

console.log(`[w23e] corrections designed: ${record.designed} (A: ${record.byCategory.A}, B: ${record.byCategory.B}), applied: ${record.applied}`);
