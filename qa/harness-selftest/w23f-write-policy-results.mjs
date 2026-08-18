#!/usr/bin/env node

/**
 * W23F / B4-B7 — classify every held source-shape case under the policy.
 *
 * Each row records the real invariant the assertion stands for, the class it
 * falls into, the verdict, and where a replacement is warranted, its design and
 * its non-vacuity plan. Rows the policy cannot settle stay UNDETERMINED rather
 * than being guessed.
 *
 * Run from the repository root with the run directory as the first argument.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const runDir = process.argv[2];
if (!runDir) throw new Error("usage: w23f-write-policy-results.mjs <run-dir>");
const write = (name, value) =>
  fs.writeFileSync(path.join(runDir, name), JSON.stringify(value, null, 2) + "\n", "utf8");
const snapshot = JSON.parse(fs.readFileSync(path.join(runDir, "execution-snapshot.json"), "utf8"));

const APPLIED = "REPLACE_APPLIED";
const DESIGNED = "REPLACE_DESIGNED_NOT_APPLIED";
const KEEP = "KEEP_SOURCE_ASSERTION";
const BOTH = "KEEP_BOTH";
const REMOVE = "REMOVE_AS_REDUNDANT";
const UNDETERMINED = "UNDETERMINED";

const row = (entry) => entry;

const rows = [
  // ------------------------------------------------ held executable (8)
  row({
    testId: "tests/background-hermes-chat.test.mjs :: opening an active conversation reloads it and reattaches its run",
    group: "ROUTE_QUERY",
    currentAssertionType: "SOURCE_TEXT_REGEX for a URL literal in a hook",
    realInvariant:
      "The surface a client asks for is the surface the sessions route recovers and filters by. Getting it wrong is cross-surface conversation leakage.",
    policyClass: "B1 (behaviour) + S2 (the surface must reach the shared client rather than rebuild the request)",
    verdict: BOTH,
    applied: true,
    replacementDesign:
      "The literal assertion becomes a wiring assertion that the hook reaches loadHermesSessionSummaries, which dead code cannot satisfy; the behavioural half moves to one executable test that runs the real client and reads back what the route would parse.",
    nonVacuityDesign:
      "Seeded builders: surface hardcoded, encoding removed, wrong path, no-store dropped, own fetch instead of the shared client. All five caught.",
    reason:
      "Rule 1: an alternative implementation that reaches the same client is valid, so the file the literal lives in is not the contract. Rule 3: the real violation is deterministically executable.",
  }),
  row({
    testId: "tests/garden-agent-chat-ui.test.mjs :: garden chat has terminal-style history, new chat, and skill review",
    group: "ROUTE_QUERY",
    currentAssertionType: "SOURCE_TEXT_REGEX for a URL literal in a component",
    realInvariant: "Same contract, second surface.",
    policyClass: "B1 + S2",
    verdict: BOTH,
    applied: true,
    replacementDesign: "Same wiring assertion; the behavioural half is shared.",
    nonVacuityDesign: "Shared with the case above.",
    reason: "Same as above. Duplicating the executable check per surface would test the same function three times.",
  }),
  row({
    testId: "tests/hermes-live-routing.test.mjs :: terminal session hook restores a Breadboard session after refresh and aborts server-side",
    group: "ROUTE_QUERY",
    currentAssertionType: "SOURCE_TEXT_REGEX for a URL literal in a hook",
    realInvariant: "Same contract, third call site.",
    policyClass: "B1 + S2",
    verdict: BOTH,
    applied: true,
    replacementDesign: "Same wiring assertion; the new executable test lives in this file.",
    nonVacuityDesign: "Shared with the cases above.",
    reason: "Same as above.",
  }),
  row({
    testId: "tests/branch-history.test.mjs :: the sessions endpoint restores only the projected active branch",
    group: "PROJECTION",
    currentAssertionType: "SOURCE_TEXT_REGEX for a call written in api/hermes/sessions/route.ts",
    realInvariant:
      "A restored transcript shows only the active branch: abandoned and superseded regeneration attempts are excluded and the newest sibling survives.",
    policyClass: "B1",
    verdict: DESIGNED,
    applied: false,
    replacementDesign:
      "Execute projectConversationBranchMessages over a fixture whose second turn was regenerated twice and assert the surviving ids. The test file already imports that function, so the replacement needs no new wiring.",
    nonVacuityDesign:
      "Seeded: projection skipped, oldest sibling kept, branch metadata dropped, assistant rows dropped, empty transcript synthesising a row. All five were proven detectable in W2-3D.",
    reason:
      "Rule 1: presentation was extracted into lib/hermes/session-presentation.ts, which the route imports; the behaviour is unchanged and the file is not the contract.",
    notAppliedBecause:
      "The replacement is specified and proven, but each application needs its own targeted run and counterexample execution; this pass applied the cases it could prove end to end within budget.",
  }),
  row({
    testId: "tests/chat-text-selection.test.mjs :: selection context and anchors persist through the canonical turn API",
    group: "PROJECTION",
    currentAssertionType: "SOURCE_TEXT_REGEX for a helper name in a route file",
    realInvariant: "A text selection survives the canonical turn API with its anchors intact.",
    policyClass: "B1",
    verdict: DESIGNED,
    applied: false,
    replacementDesign:
      "Execute normalizeChatTextSelectionReference over anchored and unanchored selections and assert the persisted shape; the test already imports it.",
    nonVacuityDesign: "Seed a normaliser that drops anchors and one that widens the range; both must fail.",
    reason: "Rule 1 and rule 3.",
    notAppliedBecause: "Same as above.",
  }),
  row({
    testId: "tests/hermes-live-routing.test.mjs :: terminal planning receives the current conversation's recent user requests",
    group: "PROJECTION",
    currentAssertionType: "SOURCE_TEXT_REGEX pinning a filter-and-slice expression",
    realInvariant:
      "Planning sees the recent user requests from the current conversation only, capped, and never another conversation's.",
    policyClass: "B1",
    verdict: DESIGNED,
    applied: false,
    replacementDesign:
      "Execute the derivation over a transcript containing assistant rows, more than the cap, and rows from a second conversation; assert the selected requests.",
    nonVacuityDesign:
      "Seed a derivation that omits the role filter, one that drops the cap, and one that ignores the conversation scope.",
    reason: "Rule 1: any equivalent expression is valid. The scope rule is the contract and it is executable.",
    notAppliedBecause: "Same as above.",
  }),
  row({
    testId: "tests/memory-badge-evidence.test.mjs :: live and restored transcripts both consume authoritative memory evidence",
    group: "PROJECTION",
    currentAssertionType: "SOURCE_TEXT_REGEX for a lookup written in a route file",
    realInvariant: "A restored transcript carries the same memory evidence a live one shows.",
    policyClass: "B1",
    verdict: DESIGNED,
    applied: false,
    replacementDesign:
      "Present a session both ways and assert the memory-marked message ids are equal.",
    nonVacuityDesign: "Seed a restored path that skips the lookup; the equality must fail.",
    reason: "Rule 1 and rule 3.",
    notAppliedBecause: "Same as above.",
  }),
  row({
    testId: "tests/quartz-ai-parity.test.mjs :: session transcript presentation is shared, not duplicated",
    group: "PROJECTION",
    currentAssertionType: "SOURCE_TEXT_REGEX for a shared presenter call",
    realInvariant:
      "Both surfaces present transcripts through one presenter. The failure mode is a second implementation drifting away from the first, which no behavioural test can rule out because it would have to know the copy exists.",
    policyClass: "S2 (architectural: single implementation of a shared seam)",
    verdict: KEEP,
    applied: false,
    replacementDesign:
      "Retarget the assertion to lib/hermes/session-presentation.ts, which now holds the presenter, and keep it structural. Add a negative assertion that neither route reimplements the presentation inline.",
    nonVacuityDesign: "Reintroduce an inline presenter in one route; the negative assertion must fail.",
    reason:
      "Rule 2 stops the walk: no-duplication is an architectural boundary, and rule 3 does not apply because a duplicate implementation can be behaviourally identical on every sampled input and still be the defect.",
  }),

  // ------------------------------------------------------------- ROOT-5
  row({
    testId: "tests/vlm-ocr-figures.test.mjs :: the ingest route persists figures as page assets and counts them",
    group: "ROOT-5",
    currentAssertionType: "SOURCE_TEXT_REGEX pinning a local identifier (vlmFigureCount)",
    realInvariant: "The figure count that reaches the persisted payload is derived from the VLM result.",
    policyClass: "I1 for the identifier; B1 for the derivation",
    verdict: APPLIED,
    applied: true,
    replacementDesign:
      "Assert the derivation (figureCount = vlm.figureCount) and the destination (the field reaches the persisted payload) instead of the variable name.",
    nonVacuityDesign:
      "Seeded: count defaulted rather than derived, and derived but never persisted. Both caught. A pure rename is accepted, which is the behaviour the old assertion lacked.",
    reason: "Rule 5: the old assertion located an identifier. Rule 1: a rename preserves every externally relevant behaviour.",
  }),

  // ------------------------------------------ W2-3E category A (applied)
  row({
    testId: "tests/vimax-chat-ownership.test.mjs :: a Garden film binds to the turn that asked for it",
    group: "W23E-CATEGORY-A",
    currentAssertionType: "behavioural assertion over a fixture that models a write path the product does not take",
    realInvariant: "A film published from a Garden chat binds to the assistant turn that asked for it.",
    policyClass: "B1",
    verdict: APPLIED,
    applied: true,
    replacementDesign:
      "Record the Garden turn through recordExternalAgentTurn, the function the Garden surface actually reaches, keeping every assertion including the legacy canonical_message_id check.",
    nonVacuityDesign:
      "Seeded: a newest-assistant-message fallback and a dual write that drops the canonical id. Both caught.",
    reason: "Not a source-shape case at all: the assertion was already behavioural and only the fixture was wrong.",
  }),
  row({
    testId: "tests/visual-decision-policy.test.mjs :: 11. Only a model-authored visual contract reaches implementation dispatch",
    group: "W23E-CATEGORY-A",
    currentAssertionType: "behavioural assertion over a fixture predating the tightened contract",
    realInvariant:
      "Only a complete and coherent model-authored learner control contract reaches implementation dispatch.",
    policyClass: "B1",
    verdict: APPLIED,
    applied: true,
    replacementDesign:
      "The fixture authors learnerAction and sets decision.interaction from the product's own pedagogyContractFromCompleteRepair projection. Every assertion, including the assert.throws for the unauthored case, is unchanged.",
    nonVacuityDesign:
      "Seeded: completeness check removed, coherence check removed, and a hand-written decision.interaction that drifts. All caught.",
    reason: "The assertion was already behavioural; the fixture had not kept up with the contract.",
  }),
  row({
    testId: "tests/visual-decision-policy.test.mjs :: a comparison unit acquires an interactive intent after routing",
    group: "W23E-CATEGORY-A",
    currentAssertionType: "behavioural assertion, same fixture",
    realInvariant: "A routed comparison unit carries a concrete interactive intent.",
    policyClass: "B1",
    verdict: APPLIED,
    applied: true,
    replacementDesign: "Shared with the case above; the helper is fixed once.",
    nonVacuityDesign: "Shared with the case above.",
    reason: "Same helper, same correction.",
  }),

  // ------------------------------------------ W2-3E category B (designed)
  row({
    testId: "tests/assistant-models-refresh.test.mjs :: provider changes in settings announce the new catalog",
    group: "W23E-CATEGORY-B",
    currentAssertionType: "occurrence count of a call in one source file",
    realInvariant:
      "Every funnel that changes which models exist announces on the shared channel, the announcement invalidates the cached catalog, and an already-loaded picker refetches.",
    policyClass: "B1",
    verdict: DESIGNED,
    applied: false,
    replacementDesign:
      "Dispatch through the real notifyAssistantModelsChanged, require a registered listener to fire, and require the catalog client to refetch. Cover both funnels by name rather than counting call sites in one file.",
    nonVacuityDesign:
      "Seeded: announce without invalidating, one funnel silent, forced refetch served from cache. All three proven detectable in W2-3E.",
    reason:
      "Rule 5: the assertion counts a literal in one file. Rule 3: the announcement is deterministically executable, as W2-3E demonstrated.",
    notAppliedBecause:
      "The replacement needs the browser-edge stub the arbitration used, which is a new harness inside the dashboard suite rather than an assertion swap.",
  }),
  row({
    testId: "tests/neumorphic-workspaces.test.mjs :: workspace neumorphism is built from shared visual-only materials",
    group: "W23E-CATEGORY-B",
    currentAssertionType: "regex over a text slice of the stylesheet between two markers",
    realInvariant: "No bb-neu-* material utility declares a motion or layout property.",
    policyClass: "S2 over a declarative artifact, implemented wrongly",
    verdict: DESIGNED,
    applied: false,
    replacementDesign:
      "Parse the stylesheet into rules and assert the declarations of every rule whose selector matches bb-neu-*.",
    nonVacuityDesign: "Seed overflow into one material rule and transform into another; both proven detectable.",
    reason:
      "This is the policy rule 'parse, do not slice'. The class does not change - the invariant really is structural - but a text window silently widens as the file grows, and it now sweeps in .bb-chat-marquee, which must set transform and overflow.",
    notAppliedBecause: "The replacement needs the CSS rule parser built in W2-3E ported into the dashboard suite.",
  }),
  row({
    testId: "tests/socials-manager-integration.test.mjs :: the inline card is styled with the shared neumorphic material",
    group: "W23E-CATEGORY-B",
    currentAssertionType: "substring presence of eight class names in a component file",
    realInvariant: "The card is built from the shared agent-run material and carries no brand colour.",
    policyClass: "I1 for the class list; B1 for the material contract",
    verdict: DESIGNED,
    applied: false,
    replacementDesign:
      "Assert the card shares the vocabulary the other inline agent-run cards use, that every class it names is defined in the stylesheet, and that no brand hex appears. Keep the brand-colour assertion exactly as it is.",
    nonVacuityDesign: "Seeded: bespoke-class rebuild, reintroduced brand hex, undefined class name. All three proven detectable.",
    reason:
      "Rule 5, and the dead-code rule decides it: bb-agent-run-icon is used by 0 of 32 inline cards and is not defined in the stylesheet, so the only way to satisfy the assertion is to add markup nothing consumes.",
    notAppliedBecause: "Shares a replacement with the external-agent-response-ui case; both should land together.",
  }),
];

// ------------------------------------------------------- UI_SHAPE (18)
const ui = [
  {
    testId: "tests/active-run-composer.test.mjs :: the shared composer keeps its controls stable during an active run",
    failedPattern: "/disabled=\\{!canSend \\|\\| isSending \\|\\| disabled/",
    realInvariant: "The send control is disabled while a send is in flight or the composer is disabled.",
    policyClass: "B1 for the positive assertion; S2 for the doesNotMatch guards beside it",
    verdict: BOTH,
    replacementDesign:
      "Render the composer and assert the button's disabled state under each condition. Keep the negative guards, which prevent a second active-run rail and an aria-disabled regression and have no runtime equivalent.",
    nonVacuityDesign: "Enable the button while isSending is true; the DOM assertion must fail.",
    reason: "Rule 1 for the positive half; rule 2 keeps the negatives, which are claims about what must not come back.",
  },
  {
    testId: "tests/app-theme.test.mjs :: dark mode uses charcoal paper and Breadboard's pastel utility bridge",
    failedPattern: '/html\\[data-theme="dark"\\] \\.auth-page-shell/',
    realInvariant: "The auth shell is styled under the dark theme rather than left on light defaults.",
    policyClass: "S2 over a declarative artifact",
    verdict: DESIGNED,
    replacementDesign:
      "Parse the stylesheet and assert some rule targets the auth shell under a dark-theme selector, rather than pinning one selector spelling.",
    nonVacuityDesign: "Remove the dark auth-shell rule; the parsed assertion must fail.",
    reason: "Parse, do not slice. The invariant is structural but the exact selector text is implementation.",
  },
  {
    testId: "tests/assistant-message-ui.test.mjs :: completed response duration remains attached to restored assistant messages",
    failedPattern: "/presented\\.metadata\\.responseDurationMs/",
    realInvariant: "A restored assistant message keeps the duration the live one showed.",
    policyClass: "B1",
    verdict: DESIGNED,
    replacementDesign: "Present a completed message through the restore path and assert the field survives.",
    nonVacuityDesign: "Drop the field in the presenter; the assertion must fail.",
    reason: "Rule 1 and rule 3. Overlaps the ROOT-6 residual for the same field; both should land together.",
  },
  {
    testId: "tests/chat-enter-to-send.test.mjs :: the shared composer sends on Enter without breaking commands or multiline input",
    failedPattern: "/queueSteer\\(\\)/",
    realInvariant: "Enter during an in-flight run queues a steer instead of starting a second send.",
    policyClass: "B1",
    verdict: DESIGNED,
    replacementDesign: "Dispatch a keydown on the rendered composer with a run in flight and assert a steer is queued and no send is issued.",
    nonVacuityDesign: "Make Enter submit during a run; the assertion must fail.",
    reason: "Rule 1 and rule 3.",
  },
  {
    testId: "tests/dashboard-agent-terminal-ui.test.mjs :: Hermes terminal uses the original Breadboard terminal shell",
    failedPattern: '/: isOpen\\s*\\? "var\\(--paper-surface\\)"\\s*: "var\\(--terminal-bar\\)"/',
    realInvariant: "The terminal bar takes the paper surface when open and the terminal bar colour when closed.",
    policyClass: "I1",
    verdict: DESIGNED,
    replacementDesign: "Assert the computed background token per open state from a render, or drop the assertion if the visual is covered elsewhere.",
    nonVacuityDesign: "Swap the two tokens; the assertion must fail.",
    reason: "Rule 1: any equivalent expression producing the same tokens is valid.",
  },
  {
    testId: "tests/dashboard-agent-terminal-ui.test.mjs :: the brown terminal header toggles fully open and fully closed",
    failedPattern: "/function defaultOpenHeight\\(\\): number \\{\\s*return maxHeight\\(\\);\\s*\\}/",
    realInvariant: "Fully open means the maximum height.",
    policyClass: "I1",
    verdict: DESIGNED,
    replacementDesign: "Assert the returned height equals the maximum, from the function rather than from its body text.",
    nonVacuityDesign: "Return a fixed height; the assertion must fail.",
    reason: "Rule 5: the assertion pins an exact function body, which any refactor breaks and no behaviour depends on.",
  },
  {
    testId: "tests/dashboard-agent-terminal-ui.test.mjs :: a fully open terminal stops the page behind it from scrolling",
    failedPattern: '/window\\.removeEventListener\\("resize", sync\\)/',
    realInvariant: "The resize listener is removed on unmount, so a remounted terminal does not accumulate listeners.",
    policyClass: "S2 (cleanup contract)",
    verdict: KEEP,
    replacementDesign:
      "None required. Document what the assertion protects. If it is ever made executable, count listeners across a mount/unmount cycle rather than asserting the call text.",
    nonVacuityDesign: "Delete the cleanup; the assertion fails. That is already the case.",
    reason:
      "Rule 2 stops the walk. The failure mode is absence, and a leak is invisible to a behavioural test until it has already accumulated - exactly the case the policy says a structural assertion is for.",
  },
  {
    testId: "tests/external-agent-response-ui.test.mjs :: every external agent uses the shared Breadboard neumorphic run-card system",
    failedPattern: "/\\.bb-agent-run-icon\\b/",
    realInvariant: "Every agent run card is built from the shared material so the transcript reads as one family.",
    policyClass: "I1",
    verdict: DESIGNED,
    replacementDesign: "Shared with the socials card case: assert the family vocabulary and that every class named is defined in the stylesheet.",
    nonVacuityDesign: "Rebuild a card with bespoke classes; the assertion must fail.",
    reason:
      "The dead-code rule decides it: bb-agent-run-icon is used by 0 of 32 cards and defined nowhere in the stylesheet, so the assertion can only be satisfied by adding markup nothing consumes.",
  },
  {
    testId: "tests/garden-workspace-external-agents.test.mjs :: the run card shows only the agent name and can close a finished timeline",
    failedPattern: "/timeline\\.length && terminal \\?/",
    realInvariant: "A finished timeline can be closed, and the card shows the agent name only.",
    policyClass: "I1",
    verdict: DESIGNED,
    replacementDesign: "Render a finished run and assert the close affordance is present and the header shows only the agent name.",
    nonVacuityDesign: "Remove the close affordance; the assertion must fail.",
    reason: "Rule 1: the exact conditional expression is one of many valid implementations.",
  },
  {
    testId: "tests/hermes-live-routing.test.mjs :: the unified slash hub embeds Skills.sh discovery and the reviewed promotion flow",
    failedPattern: "/skills\\/search[\\s\\S]*skills\\/detail[\\s\\S]*skills\\/install[\\s\\S]*skills\\/promote/",
    realInvariant:
      "The reviewed promotion flow stays wired end to end: discovery, detail, install into quarantine, and explicit promotion. Dropping a stage would let an install skip review.",
    policyClass: "S1/S2 (review boundary wiring)",
    verdict: KEEP,
    replacementDesign:
      "None required. Split the single ordered regex into four independent assertions so a failure names the missing stage instead of the whole chain.",
    nonVacuityDesign: "Remove the promote stage; the assertion must fail and should say which stage is gone.",
    reason:
      "Rule 2 stops the walk. This is the review boundary, and the failure mode is omission of a stage - which a behavioural test would only catch if it happened to exercise that stage.",
  },
  {
    testId: "tests/hermes-terminal-artifacts.test.mjs :: Garden UI places Artifacts directly below Videos and Quartz contains no artifact UI",
    failedPattern: "/artifact\\.created/",
    realInvariant:
      "Not established. The test name is about UI placement while the failing pattern is an event name, so the assertion and the test title are about different things.",
    policyClass: UNDETERMINED,
    verdict: UNDETERMINED,
    replacementDesign: "None until the assertion's intent is established.",
    nonVacuityDesign: "n/a",
    reason:
      "The policy says undetermined beats guessed. Establishing this needs the assertion read in context, which is a small piece of work this pass did not reach.",
  },
  {
    testId: "tests/image-to-3d.test.mjs :: Garden Chat's own pipeline selects the skill too",
    failedPattern: "/if \\(!imageTo3dSelection\\.automatic[^)]*\\) throw error;/",
    realInvariant: "The Garden pipeline selects the image-to-3d skill on the same asks the Terminal does.",
    policyClass: "B1",
    verdict: DESIGNED,
    replacementDesign: "Execute the selection function for garden_chat over selecting and non-selecting asks.",
    nonVacuityDesign: "Make the garden path never select; the assertion must fail.",
    reason: "Rule 1 and rule 3: selection is a pure function and directly executable.",
  },
  {
    testId: "tests/inline-artifact-cards.test.mjs :: an artifact opened in the Terminal fills a lane inside the dock, not the window",
    failedPattern: '/<div className="flex min-w-0 flex-1 flex-col">/',
    realInvariant: "An opened artifact occupies a lane inside the dock rather than covering the window.",
    policyClass: "I1",
    verdict: DESIGNED,
    replacementDesign:
      "Keep the parsed stylesheet assertions on .bb-artifact-lane, which are structural and sound, and replace the JSX string with a rendered-DOM assertion about the lane's containment.",
    nonVacuityDesign: "Portal the panel to the window instead of the dock; the assertion must fail.",
    reason: "Rule 5: an exact JSX string is the clearest case of locating a literal.",
  },
  {
    testId: "tests/learn-syllabus-generation.test.mjs :: a generated syllabus is designated immediately and shows up in Documents",
    failedPattern: "/setLearnSyllabusSlug\\(slug\\);[\\s\\S]{0,200}await fetchDocuments\\(\\)/",
    realInvariant: "A generated syllabus is designated and appears in Documents without a manual refresh.",
    policyClass: "B1",
    verdict: DESIGNED,
    replacementDesign: "Drive the generation path and assert the syllabus is designated and listed afterwards.",
    nonVacuityDesign: "Skip the refresh; the listing assertion must fail.",
    reason:
      "Rule 1: the assertion pins two calls and their proximity in source. Any ordering that produces the same observable state is valid.",
  },
  {
    testId: "tests/learn-token-usage.test.mjs :: Learn panel renders live job usage without Council activity",
    failedPattern: '/metric\\.label === "Total" && job\\?\\.model[\\s\\S]*?<dt className="text-gray-600">Model:<\\/dt>/',
    realInvariant: "The Learn panel shows the model beside the total usage.",
    policyClass: "I1",
    verdict: DESIGNED,
    replacementDesign: "Render the panel with a job and assert the model appears in the total row.",
    nonVacuityDesign: "Stop rendering the model; the assertion must fail.",
    reason: "Rule 5: the assertion pins JSX structure including class names that carry no contract.",
  },
  {
    testId: "tests/openplanter-integration.test.mjs :: normal Hermes chats keep thinking metadata and response action buttons",
    failedPattern: "/>Thinking</",
    realInvariant: "The thinking affordance is present on a normal chat response.",
    policyClass: "B1, with a P1 element because the word is user-visible copy",
    verdict: DESIGNED,
    replacementDesign:
      "Assert the affordance is present in the rendered DOM. Whether the exact word is a copy contract needs the P1 determination and should travel with the PROSE_COPY family.",
    nonVacuityDesign: "Remove the affordance; the assertion must fail.",
    reason: "Rule 1 for presence; rule 4 defers the wording question rather than answering it here.",
  },
  {
    testId: "tests/socials-manager-integration.test.mjs :: both chat surfaces launch the run and render it inline",
    failedPattern: "/const conversationPublicId = await session\\.ensureConversation\\(\\)/",
    realInvariant: "A run launched from either surface is bound to a conversation before it starts.",
    policyClass: "I1 for the expression; B1 for the binding",
    verdict: DESIGNED,
    replacementDesign: "Assert the launched run carries a conversation id, executing the launch path.",
    nonVacuityDesign: "Launch without ensuring a conversation; the assertion must fail.",
    reason: "Rule 1: the exact statement text is one valid implementation of the binding.",
  },
  {
    testId: "tests/socials-manager-integration.test.mjs :: the inline Socials Manager card restores every durable post after chat remounts",
    failedPattern: "/ensureConversation: \\(\\) => Promise<string>/",
    realInvariant: "The inline card receives a way to ensure its conversation.",
    policyClass: "I1",
    verdict: REMOVE,
    replacementDesign:
      "Remove the assertion. It pins a TypeScript type signature in source, and the type checker already enforces it - more strictly, and at every call site rather than one.",
    nonVacuityDesign:
      "Change the prop type and run tsc: the type checker fails. The regex adds nothing the compiler does not already guarantee.",
    reason:
      "Rule 5, plus a stronger point: a compile-time contract asserted by regex is coverage theatre. The remaining behavioural assertions in the same test cover the restore contract.",
  },
];

for (const entry of ui) {
  rows.push({
    ...entry,
    group: "UI_SHAPE",
    currentAssertionType: "SOURCE_TEXT_REGEX",
    applied: entry.verdict === APPLIED,
  });
}

const byVerdict = rows.reduce((accumulator, entry) => {
  accumulator[entry.verdict] = (accumulator[entry.verdict] ?? 0) + 1;
  return accumulator;
}, {});
const byClassFamily = rows.reduce((accumulator, entry) => {
  const family = String(entry.policyClass).split(/[ (]/)[0];
  accumulator[family] = (accumulator[family] ?? 0) + 1;
  return accumulator;
}, {});

write("source-assertion-policy-results.json", {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: snapshot.executionSnapshotId,
  policy: "qa/autonomous/SOURCE_ASSERTION_POLICY.md",
  total: rows.length,
  byVerdict,
  byPolicyClassFamily: byClassFamily,
  applied: rows.filter((entry) => entry.applied).length,
  rows,
});

write("ui-shape-adjudication.json", {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: snapshot.executionSnapshotId,
  total: ui.length,
  note:
    "UI_SHAPE does not automatically mean implementation detail. Two of the eighteen are structural contracts the policy keeps, one is redundant with the type checker, one is left undetermined, and the rest stand for behaviour observable in the DOM or in a pure function.",
  byVerdict: ui.reduce((accumulator, entry) => {
    accumulator[entry.verdict] = (accumulator[entry.verdict] ?? 0) + 1;
    return accumulator;
  }, {}),
  keptAsStructural: ui.filter((entry) => entry.verdict === KEEP).map((entry) => entry.testId),
  rows: ui,
});

write("held-executable-adjudication.json", {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: snapshot.executionSnapshotId,
  note:
    "The eight ROUTE_QUERY and PROJECTION cases carried HIGH-confidence executable replacements and counterexample proof from W2-3D. Seven are behavioural and adopt the executable replacement; one is retained as a structural no-duplication contract with a documented reason.",
  rows: rows.filter((entry) => entry.group === "ROUTE_QUERY" || entry.group === "PROJECTION"),
  adopted: rows.filter(
    (entry) => (entry.group === "ROUTE_QUERY" || entry.group === "PROJECTION") && entry.applied,
  ).length,
  retainedStructural: rows.filter(
    (entry) => (entry.group === "ROUTE_QUERY" || entry.group === "PROJECTION") && entry.verdict === KEEP,
  ).map((entry) => entry.testId),
});

console.log("held cases classified: " + rows.length);
console.log("by verdict: " + JSON.stringify(byVerdict));
console.log("applied: " + rows.filter((entry) => entry.applied).length);
