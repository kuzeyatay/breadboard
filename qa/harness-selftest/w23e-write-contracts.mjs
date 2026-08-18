#!/usr/bin/env node

/**
 * W2-3E Phases 1–3: the target inventory, the behavioural split, and the
 * intended contract for each sub-root — written down before the production
 * paths are executed.
 *
 * Honesty note recorded in the evidence itself: static diagnosis (reading the
 * tests, the product and the registry) preceded this file. The mitigation is
 * that every FORBIDDEN clause below is taken from the test's own stated intent
 * or from a consumer's requirement, never from observed behaviour — so a
 * contract cannot be quietly rewritten to match whatever the product does.
 *
 * Run from the repository root.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const runDir = process.argv[2];
if (!runDir) throw new Error("usage: w23e-write-contracts.mjs <run-dir>");

const EXECUTION_SNAPSHOT_ID = JSON.parse(
  fs.readFileSync(path.join(runDir, "execution-snapshot.json"), "utf8"),
).executionSnapshotId;

/** What each test says it is protecting, in the test's own terms. */
const BEHAVIOUR_CLAIMED = {
  "tests/factcheck-integration.test.mjs :: Bullshit Detector is a ready installed skill on authenticated chat surfaces":
    "A reviewed, integrity-pinned skill is offered and usable on both authenticated chat surfaces, and never on the anonymous public surface.",
  "tests/factcheck-integration.test.mjs :: the shipped SKILL.md is the clone's procedure plus a Breadboard preamble":
    "Rebuilding the shipped skill from the vendored clone reproduces the shipped file, so upstream drift is detected rather than absorbed.",
  "tests/factcheck-integration.test.mjs :: the reviewed registry pins the shipped SKILL.md by hash":
    "The reviewed registry's pinned hash is the hash of the shipped file, so unreviewed edits disable the skill instead of shipping quietly.",
  "tests/premortem-integration.test.mjs :: Premortem is a ready installed skill on authenticated chat surfaces":
    "The same readiness contract for the Premortem install.",
  "tests/premortem-integration.test.mjs :: Premortem intent starts explicitly and stays selected across approval turns":
    "An explicit premortem ask resolves to the premortem skill and its reviewed guidance is attached to the turn.",
  "tests/assistant-models-refresh.test.mjs :: provider changes in settings announce the new catalog":
    "Both funnels that change which models exist — a provider mutation and a subscription catalog sync — announce, so no picker keeps showing the old list.",
  "tests/neumorphic-workspaces.test.mjs :: workspace neumorphism is built from shared visual-only materials":
    "The shared workspace material utilities are visual only: they must not override a panel's motion, sizing, overflow or positioning.",
  "tests/socials-manager-integration.test.mjs :: the inline card is styled with the shared neumorphic material":
    "The inline agent-run card is rendered with the shared agent-run material classes rather than bespoke styling, and carries no brand colours.",
  "tests/vimax-chat-ownership.test.mjs :: a Garden film binds to the turn that asked for it":
    "A film published from a Garden chat binds to the assistant turn that asked for it, and the Garden's legacy transcript can address that turn.",
  "tests/visual-decision-policy.test.mjs :: 11. Only a model-authored visual contract reaches implementation dispatch":
    "Routing refuses a plan whose learner control contract the model never authored, rather than inferring controls for it.",
  "tests/visual-decision-policy.test.mjs :: a comparison unit acquires an interactive intent after routing":
    "A routed comparison unit carries a concrete interactive intent afterwards.",
};

const SUBROOT_INVARIANT = {
  SKILL_INTEGRITY_PIN:
    "A reviewed skill whose shipped content has not changed must verify against its pinned hash on any checkout of the same commit, and stay enabled; a skill whose content HAS changed must be disabled at every boundary that would ship its guidance.",
  CATALOG_CHANGE_ANNOUNCEMENT:
    "Every mutation that changes which assistant models exist must announce on the shared channel, and a mounted picker must refetch on that announcement even if it has already loaded once.",
  WORKSPACE_MATERIAL_ISOLATION:
    "The shared bb-neu-* workspace material utilities declare only visual properties; motion, sizing, overflow and positioning stay with the component classes.",
  AGENT_RUN_CARD_MATERIAL:
    "The inline agent-run card renders with the shared agent-run material classes, so every agent's card reads as one family in the transcript.",
  ARTIFACT_TURN_BINDING:
    "An artifact published by a background run binds to the assistant turn that asked for it, on both surfaces, and the surface's own transcript can address that turn.",
  VISUAL_CONTRACT_VALIDATION:
    "Implementation dispatch is reachable only for a learner control contract the model authored and that validates; an unauthored or invalid contract is refused, not defaulted.",
};

const OBSERVABLE = {
  SKILL_INTEGRITY_PIN:
    "sha256 of the shipped file bytes versus the registry pin; the enabled/healthy fields returned by listApprovedSkills; and the boolean returned by skillAvailableForContext, which is what actually decides dispatch.",
  CATALOG_CHANGE_ANNOUNCEMENT:
    "The event dispatched on the shared channel and received by a real listener registered the way the hook registers one.",
  WORKSPACE_MATERIAL_ISOLATION:
    "The declaration block of each bb-neu-* rule, parsed by selector, in the shipped stylesheet.",
  AGENT_RUN_CARD_MATERIAL: "The class attribute of the rendered DOM, from a real render of the component.",
  ARTIFACT_TURN_BINDING:
    "artifacts.originating_message_id and chat_messages.canonical_message_id in a real SQLite database after the real publish path runs.",
  VISUAL_CONTRACT_VALIDATION:
    "The value returned by, or the error thrown from, buildVisualizationPlan and applyVisualizationRoutesToLearningUnits.",
};

const REJECTED_OBSERVABLE = {
  SKILL_INTEGRITY_PIN: "Presence of the skill directory on disk; a registry entry existing. Neither implies the skill can be used.",
  CATALOG_CHANGE_ANNOUNCEMENT:
    "A count of call sites in one file. The contract is that the announcement happens, not where the call is written.",
  WORKSPACE_MATERIAL_ISOLATION:
    "A text slice of the stylesheet between two markers. The slice is not the rule set and drifts as unrelated CSS is added between the markers.",
  AGENT_RUN_CARD_MATERIAL:
    "Substring presence in the component source. A class can be applied by a shared child component and never appear as a literal in this file.",
  ARTIFACT_TURN_BINDING: "The artifact existing at all; a non-null id. Ownership is the contract, not existence.",
  VISUAL_CONTRACT_VALIDATION: "A thrown error alone. Refusing everything satisfies 'it refuses', which is not the contract.",
};

const CONTRACTS = [
  {
    subRoot: "SKILL_INTEGRITY_PIN",
    precondition:
      "The repository is at a reviewed commit. .agents/skills/<slug>/SKILL.md is exactly the reviewed content, and registry.json holds its pinned hash. The checkout applies the repository's own line-ending policy (core.autocrlf=true on this machine, no .gitattributes).",
    action:
      "List approved skills for dashboard_terminal and garden_chat, and resolve an explicit /premortem command through the real command resolver.",
    expected:
      "The skill verifies, is enabled and healthy, is offered on both authenticated surfaces, is absent from quartz_ai, and the command resolves with the reviewed guidance attached.",
    authoritativeObservable: OBSERVABLE.SKILL_INTEGRITY_PIN,
    forbidden: [
      "A skill whose content is unchanged since review is disabled because the checkout wrote different bytes.",
      "A skill whose content HAS changed is enabled, or its guidance is served, or its command dispatches.",
      "The anonymous public surface is offered a skill that fetches arbitrary URLs.",
    ],
  },
  {
    subRoot: "CATALOG_CHANGE_ANNOUNCEMENT",
    precondition:
      "A model picker is mounted and has already loaded the catalog once, so its first-load guard is set.",
    action:
      "Perform a provider mutation, and separately a subscription account sync, each of which changes which models exist.",
    expected: "Both announce on the shared channel, and the mounted picker refetches on each.",
    authoritativeObservable: OBSERVABLE.CATALOG_CHANGE_ANNOUNCEMENT,
    forbidden: [
      "A catalog-changing mutation completes without announcing, leaving a mounted picker showing the old list until restart.",
      "The announcement is suppressed by the hook's first-load guard.",
    ],
  },
  {
    subRoot: "WORKSPACE_MATERIAL_ISOLATION",
    precondition: "The shipped stylesheet defines the bb-neu-* workspace material utilities.",
    action: "Parse the stylesheet into rules and read the declarations of every bb-neu-* material rule.",
    expected:
      "No bb-neu-* material rule declares transform, translate, width, height, position, overflow, pointer-events, visibility or z-index.",
    authoritativeObservable: OBSERVABLE.WORKSPACE_MATERIAL_ISOLATION,
    forbidden: [
      "A material utility sets a motion or layout property, so composing it onto a panel silently moves or resizes that panel.",
    ],
  },
  {
    subRoot: "AGENT_RUN_CARD_MATERIAL",
    precondition: "An inline Socials Manager run exists in a transcript, in each of its states.",
    action: "Render the inline card component.",
    expected:
      "The rendered DOM carries the shared agent-run material classes, and no brand hex colour is emitted.",
    authoritativeObservable: OBSERVABLE.AGENT_RUN_CARD_MATERIAL,
    forbidden: [
      "The card renders with bespoke styling that does not participate in the shared agent-run material, so it reads as a foreign element in the transcript.",
      "A brand hex colour is emitted.",
    ],
  },
  {
    subRoot: "ARTIFACT_TURN_BINDING",
    precondition:
      "A Garden chat with a runtime session launches a ViMax run. The artifact context is opened at dispatch, before the turn exists, so the message cannot be resolved at open time.",
    action:
      "Record the external agent turn the way the Garden surface actually records it, then publish the production.",
    expected:
      "artifact.conversation_id is the launching conversation, artifact.originating_message_id is the assistant message of that turn, and the Garden's legacy transcript row carries the same canonical id.",
    authoritativeObservable: OBSERVABLE.ARTIFACT_TURN_BINDING,
    forbidden: [
      "The film is published with originating_message_id null, so its card floats free of the reply that produced it.",
      "The film binds to a turn in another chat, or is visible from another chat or another user.",
    ],
  },
  {
    subRoot: "VISUAL_CONTRACT_VALIDATION",
    precondition:
      "A comparison learning unit is selected as needing an interactive visual, and a model-authored plan is supplied for it.",
    action: "Build the visualization plan and apply its routes to the learning units.",
    expected:
      "A plan whose learner control contract the model authored and that satisfies the current schema routes to generated_module and yields a concrete interactive intent; a plan with no model-authored contract is refused.",
    authoritativeObservable: OBSERVABLE.VISUAL_CONTRACT_VALIDATION,
    forbidden: [
      "A plan with no model-authored learner control contract reaches implementation dispatch.",
      "A plan the model DID author is refused for a field the schema does not actually require of the model.",
    ],
  },
];

/** The 11 rows assigned to ROOT-4B-BEHAVIOURAL by the W2-3C adjudication. */
const source = JSON.parse(
  fs.readFileSync(
    ".qa-results/week2-dashboard-contract-resolution/w23c-20260817T194135Z/root4b-adjudication.json",
    "utf8",
  ),
);
const rows = source.rows.filter((row) => row.subRoot === "ROOT-4B-BEHAVIOURAL");
if (rows.length !== 11) {
  throw new Error(`expected 11 behavioural targets, found ${rows.length}`);
}

/**
 * Sub-root assignment, by what the assertion actually protects rather than by
 * the file it lives in. Two tests in the same file land in different sub-roots
 * where they protect different invariants.
 */
const ASSIGNMENT = {
  "tests/factcheck-integration.test.mjs :: Bullshit Detector is a ready installed skill on authenticated chat surfaces":
    "SKILL_INTEGRITY_PIN",
  "tests/factcheck-integration.test.mjs :: the shipped SKILL.md is the clone's procedure plus a Breadboard preamble":
    "SKILL_INTEGRITY_PIN",
  "tests/factcheck-integration.test.mjs :: the reviewed registry pins the shipped SKILL.md by hash":
    "SKILL_INTEGRITY_PIN",
  "tests/premortem-integration.test.mjs :: Premortem is a ready installed skill on authenticated chat surfaces":
    "SKILL_INTEGRITY_PIN",
  "tests/premortem-integration.test.mjs :: Premortem intent starts explicitly and stays selected across approval turns":
    "SKILL_INTEGRITY_PIN",
  "tests/assistant-models-refresh.test.mjs :: provider changes in settings announce the new catalog":
    "CATALOG_CHANGE_ANNOUNCEMENT",
  "tests/neumorphic-workspaces.test.mjs :: workspace neumorphism is built from shared visual-only materials":
    "WORKSPACE_MATERIAL_ISOLATION",
  "tests/socials-manager-integration.test.mjs :: the inline card is styled with the shared neumorphic material":
    "AGENT_RUN_CARD_MATERIAL",
  "tests/vimax-chat-ownership.test.mjs :: a Garden film binds to the turn that asked for it":
    "ARTIFACT_TURN_BINDING",
  "tests/visual-decision-policy.test.mjs :: 11. Only a model-authored visual contract reaches implementation dispatch":
    "VISUAL_CONTRACT_VALIDATION",
  "tests/visual-decision-policy.test.mjs :: a comparison unit acquires an interactive intent after routing":
    "VISUAL_CONTRACT_VALIDATION",
};

const ENTRY_POINT = {
  SKILL_INTEGRITY_PIN: {
    productionEntryPoint:
      "dashboard/src/lib/hermes/skills.ts :: listApprovedSkillsAtRoot (integrity verification) + commands.ts :: skillAvailableForContext",
    sourceFiles: [
      "dashboard/src/lib/hermes/skills.ts",
      "dashboard/src/lib/hermes/commands.ts",
      ".agents/skills/registry.json",
      ".agents/skills/bullshit-detector/SKILL.md",
      ".agents/skills/premortem/SKILL.md",
      "scripts/build-bullshit-detector-skill.mjs",
    ],
    consumer:
      "super-agent.ts :: skillEntries (what the model is told it can use), commands.ts :: resolveCommandMessage (whether /premortem runs), api/hermes/tools/skill/route.ts (whether guidance is served)",
  },
  CATALOG_CHANGE_ANNOUNCEMENT: {
    productionEntryPoint:
      "dashboard/src/app/components/use-assistant-models.ts :: notifyAssistantModelsChanged / useAssistantModels",
    sourceFiles: [
      "dashboard/src/app/components/use-assistant-models.ts",
      "dashboard/src/app/components/settings-providers.tsx",
      "dashboard/src/app/components/settings-accounts.tsx",
    ],
    consumer: "every model picker mounted through useAssistantModels",
  },
  WORKSPACE_MATERIAL_ISOLATION: {
    productionEntryPoint: "dashboard/src/app/globals.css :: the .bb-neu-* utility rules",
    sourceFiles: ["dashboard/src/app/globals.css"],
    consumer: "every panel that composes a bb-neu-* class alongside its own layout classes",
  },
  AGENT_RUN_CARD_MATERIAL: {
    productionEntryPoint:
      "dashboard/src/app/components/hermes/inline-socials-manager-run.tsx :: the rendered card",
    sourceFiles: ["dashboard/src/app/components/hermes/inline-socials-manager-run.tsx"],
    consumer: "the chat transcript, which styles agent run cards from the shared bb-agent-run-* classes",
  },
  ARTIFACT_TURN_BINDING: {
    productionEntryPoint:
      "dashboard/src/lib/vimax/artifact.ts :: publishProduction -> assistantMessageFor -> findExternalAgentAssistantMessage",
    sourceFiles: [
      "dashboard/src/lib/vimax/artifact.ts",
      "dashboard/src/lib/conversations/external-agent-turns.ts",
      "dashboard/src/app/components/hermes/use-agent-session.ts",
      "dashboard/src/app/api/hermes/sessions/[sessionId]/external-turns/route.ts",
    ],
    consumer:
      "the Garden transcript, which matches an artifact to a turn by originating_message_id / canonical_message_id",
  },
  VISUAL_CONTRACT_VALIDATION: {
    productionEntryPoint:
      "dashboard/src/lib/visualization-opportunities.ts :: buildVisualizationPlan (learner control contract validation)",
    sourceFiles: [
      "dashboard/src/lib/visualization-opportunities.ts",
      "dashboard/src/lib/visual-necessity.ts",
    ],
    consumer: "Learn's implementation dispatch, which builds a generated module from the routed plan",
  },
};

const targets = rows.map((row) => {
  const subRoot = ASSIGNMENT[row.testId];
  if (!subRoot) throw new Error(`unassigned target: ${row.testId}`);
  return {
    testId: row.testId,
    testFile: row.testFile,
    assertion: row.assertion,
    failureType: row.failureType,
    behaviourClaimed: BEHAVIOUR_CLAIMED[row.testId],
    subRoot,
    ...ENTRY_POINT[subRoot],
    verificationEligibility: "ELIGIBLE",
    verificationEligibilityReason:
      "Reproduces in the developer tree and in the reconstruction; no external service, no missing optional dependency.",
    currentClassification: row.classification,
    currentConfidence: row.confidence,
    previousRootCauseId: row.previousRootCauseId,
    executionSnapshotId: EXECUTION_SNAPSHOT_ID,
  };
});

fs.writeFileSync(
  path.join(runDir, "behavioural-contract-targets.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      executionSnapshotId: EXECUTION_SNAPSHOT_ID,
      sourceOfTruth:
        ".qa-results/week2-dashboard-contract-resolution/w23c-20260817T194135Z/root4b-adjudication.json (rows where subRoot === ROOT-4B-BEHAVIOURAL)",
      note: "The target list was read from the W2-3C evidence file, not inferred from test names. The W2-3C final contract map counts only 4 of these under the ROOT-4B-BEHAVIOURAL cluster label because 5 retain previousRootCauseId ROOT-1 and 2 retain ROOT-2; the adjudication file is authoritative for family membership.",
      total: targets.length,
      targets,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const subRoots = Object.entries(
  targets.reduce((accumulator, target) => {
    (accumulator[target.subRoot] ??= []).push(target.testId);
    return accumulator;
  }, {}),
).map(([subRoot, testIds]) => ({
  subRoot,
  tests: testIds.length,
  testIds,
  invariant: SUBROOT_INVARIANT[subRoot],
  authoritativeObservable: OBSERVABLE[subRoot],
  rejectedObservable: REJECTED_OBSERVABLE[subRoot],
}));

fs.writeFileSync(
  path.join(runDir, "behavioural-subroots.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      executionSnapshotId: EXECUTION_SNAPSHOT_ID,
      method:
        "Split by the invariant each assertion protects, not by the file it lives in. Two tests in the same file land in different sub-roots where they protect different invariants; five tests across two files share one sub-root because they protect the same one.",
      subRoots,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

fs.writeFileSync(
  path.join(runDir, "behaviour-contracts-before-execution.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      executionSnapshotId: EXECUTION_SNAPSHOT_ID,
      authoringDiscipline:
        "Static diagnosis preceded this file. Every FORBIDDEN clause is taken from the test's own stated intent or from a consumer's requirement, never from observed behaviour, so a contract cannot be rewritten to match whatever the product happens to do. The contracts were committed to disk before any production path was executed for arbitration.",
      contracts: CONTRACTS,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`[w23e] targets: ${targets.length}`);
for (const entry of subRoots) console.log(`  ${entry.subRoot}: ${entry.tests}`);
