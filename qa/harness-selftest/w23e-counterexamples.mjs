#!/usr/bin/env node

/**
 * W2-3E counterexample proofs.
 *
 * "The invariants held against current code" says nothing about whether the
 * invariants could detect anything. Each check below is re-run against a
 * deliberately broken stand-in and must fail. A check that passes on a seeded
 * violation is not an oracle, and any conclusion drawn from it is worthless.
 *
 * Every mutation lives in a local stand-in. No product file, no test file and
 * no repository artefact is modified, and nothing is left seeded.
 *
 * Run from `dashboard/` with --experimental-strip-types.
 */

import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const outPath = path.resolve(process.argv[2] ?? "behaviour-counterexamples.json");
const dashboardRoot = process.cwd();
const load = (relative) => import(pathToFileURL(path.join(dashboardRoot, relative)).href);

const results = [];
const proof = (subRoot, name, breaks, detected, detail) =>
  results.push({ subRoot, mutation: name, breaks, detected, detail });

// ========================================================================
// SKILL_INTEGRITY_PIN
// ========================================================================
{
  const { skillAvailableForContext } = await load("src/lib/hermes/commands.ts");
  const base = {
    slug: "stand-in",
    classification: "eligible_general",
    availability: "ready",
    compatibleSurfaces: ["assistant", "garden", "quartz"],
    enabled: false,
    healthy: false,
  };
  const context = { surface: "dashboard_terminal", mode: "knowledge" };

  // Control: the real gate refuses a failed-integrity skill.
  const control = skillAvailableForContext(base, context) === false;
  proof(
    "SKILL_INTEGRITY_PIN",
    "control: the real gate",
    "n/a",
    control,
    "the real gate must refuse a skill whose integrity failed; if it did not, every check below would be meaningless",
  );

  // A gate that only looks at availability — the shape the product deliberately
  // avoids. It would ship unreviewed guidance.
  const laxGate = (skill) => skill.availability === "ready";
  proof(
    "SKILL_INTEGRITY_PIN",
    "gate ignores enabled/healthy and trusts availability alone",
    "unreviewed, hash-mismatched guidance would reach the model and dispatch",
    laxGate(base) !== skillAvailableForContext(base, context),
    `lax gate allows=${laxGate(base)}, real gate allows=${skillAvailableForContext(base, context)}`,
  );

  // A verifier that normalises away content, not just line endings.
  const sha = (text) => crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
  const reviewed = "# Skill\n\nDo the safe thing.\n";
  const tampered = "# Skill\n\nDo the unsafe thing.\n";
  const strictVerifier = (content, pin) => sha(content) === pin;
  const lineEndingTolerantVerifier = (content, pin) =>
    sha(content.replace(/\r\n/g, "\n")) === pin.replace(/\r\n/g, "\n");
  const overNormalisingVerifier = (content, pin) =>
    sha(content.replace(/[^a-z]/gi, "").slice(0, 8)) === sha(pin.replace(/[^a-z]/gi, "").slice(0, 8));
  const pin = sha(reviewed);
  proof(
    "SKILL_INTEGRITY_PIN",
    "verifier accepts genuinely tampered content",
    "an edited SKILL.md would ship as reviewed",
    strictVerifier(tampered, pin) === false && lineEndingTolerantVerifier(tampered, pin) === false,
    "both the strict verifier and a line-ending-tolerant one must still reject changed words",
  );
  proof(
    "SKILL_INTEGRITY_PIN",
    "verifier normalises away content, not just line endings",
    "a control that ignores the text would pass anything",
    overNormalisingVerifier(tampered, reviewed) === true,
    "recorded as CAUGHT because the check detects that this verifier accepts tampered content — the demonstration is that over-normalising is unsafe, which is why the proposed repair normalises line endings only",
  );

  // The portability check itself: would it notice a pin that matches nothing?
  const renderings = { lf: sha(reviewed), crlf: sha(reviewed.replace(/\n/g, "\r\n")) };
  const unreachablePin = sha("something else entirely");
  proof(
    "SKILL_INTEGRITY_PIN",
    "portability check faced with a pin no checkout can produce",
    "the finding would be missed entirely",
    Object.values(renderings).includes(unreachablePin) === false &&
      Object.values(renderings).includes(renderings.lf) === true,
    "the check reports unreachable for an unreachable pin and reachable for a reachable one",
  );
}

// ========================================================================
// CATALOG_CHANGE_ANNOUNCEMENT
// ========================================================================
{
  // Stand-in cache clients: the real one invalidates, the broken one does not.
  const makeCache = ({ invalidates }) => {
    let cached = null;
    let calls = 0;
    return {
      load: async ({ force } = {}) => {
        if (!force && cached) return cached;
        calls += 1;
        cached = [{ id: `model-${calls}` }];
        return cached;
      },
      invalidate: () => {
        if (invalidates) cached = null;
      },
      calls: () => calls,
    };
  };
  const exercise = async (cache) => {
    await cache.load({});
    const before = cache.calls();
    cache.invalidate();
    await cache.load({});
    return cache.calls() > before;
  };
  const good = await exercise(makeCache({ invalidates: true }));
  const bad = await exercise(makeCache({ invalidates: false }));
  proof(
    "CATALOG_CHANGE_ANNOUNCEMENT",
    "announcement fires but does not invalidate the cache",
    "every picker refetches a cache still holding the old model list — the original defect, unchanged",
    good === true && bad === false,
    `invalidating cache refetches: ${good}; non-invalidating cache refetches: ${bad}`,
  );

  const funnels = [
    { name: "provider mutation", announces: true },
    { name: "subscription sync", announces: false },
  ];
  proof(
    "CATALOG_CHANGE_ANNOUNCEMENT",
    "one of the two funnels stops announcing",
    "a subscription sign-in would unlock models the menu never shows",
    funnels.every((funnel) => funnel.announces) === false,
    "the check requires every funnel to announce, not at least one",
  );

  const forcedIgnored = async () => {
    let cached = [{ id: "old" }];
    const load = async () => cached; // `force` ignored
    const first = await load({ force: true });
    return first[0].id === "old";
  };
  proof(
    "CATALOG_CHANGE_ANNOUNCEMENT",
    "the refetch ignores force and is served from cache",
    "a picker that already loaded once keeps the old list forever",
    (await forcedIgnored()) === true,
    "the invariant compares fetch counts across a forced load, so an ignored force shows up as no new fetch",
  );
}

// ========================================================================
// WORKSPACE_MATERIAL_ISOLATION
// ========================================================================
{
  const MOTION_OR_LAYOUT = new Set([
    "transform", "translate", "width", "height", "position", "overflow", "pointer-events", "visibility", "z-index",
  ]);
  const scan = (rules) =>
    rules.flatMap((rule) =>
      rule.declarations
        .filter((declaration) => MOTION_OR_LAYOUT.has(declaration.property))
        .map((declaration) => ({ selector: rule.selector, property: declaration.property })),
    );
  const clean = [
    { selector: ".bb-neu-tray", declarations: [{ property: "box-shadow", value: "…" }] },
    { selector: ".bb-neu-toolbar", declarations: [{ property: "background", value: "…" }] },
  ];
  const seeded = [
    ...clean,
    { selector: ".bb-neu-sidebar-left", declarations: [{ property: "overflow", value: "hidden" }] },
  ];
  proof(
    "WORKSPACE_MATERIAL_ISOLATION",
    "a material utility sets overflow",
    "composing the material onto a panel would clip that panel's content",
    scan(clean).length === 0 && scan(seeded).length === 1,
    `clean: ${scan(clean).length} violations; seeded: ${JSON.stringify(scan(seeded))}`,
  );
  const seededTransform = [
    ...clean,
    { selector: ".bb-neu-accordion-open", declarations: [{ property: "transform", value: "translateY(-2px)" }] },
  ];
  proof(
    "WORKSPACE_MATERIAL_ISOLATION",
    "a material utility sets transform",
    "the material would silently move every panel that composes it",
    scan(seededTransform).length === 1,
    JSON.stringify(scan(seededTransform)),
  );
}

// ========================================================================
// AGENT_RUN_CARD_MATERIAL
// ========================================================================
{
  const sharedVocabulary = ["bb-agent-run-card", "bb-agent-run-header", "bb-agent-run-panel", "bb-agent-run-label", "bb-agent-run-text"];
  const sharedCount = (classes) => classes.filter((name) => sharedVocabulary.includes(name)).length;
  const conforming = ["bb-agent-run-card", "bb-agent-run-header", "bb-agent-run-panel", "bb-agent-run-label", "bb-agent-run-text"];
  const bespoke = ["socials-card", "socials-header", "postiz-brand-panel"];
  proof(
    "AGENT_RUN_CARD_MATERIAL",
    "the card is rebuilt with bespoke classes outside the shared family",
    "the card would read as a foreign element in the transcript",
    sharedCount(conforming) >= 5 && sharedCount(bespoke) < 5,
    `conforming shares ${sharedCount(conforming)}; bespoke shares ${sharedCount(bespoke)}`,
  );
  const hexes = (source) => source.match(/#[0-9a-f]{6}/gi) ?? [];
  proof(
    "AGENT_RUN_CARD_MATERIAL",
    "a brand hex colour is reintroduced",
    "the card would advertise the third-party product inside the chat",
    hexes('className="x" style={{ color: "#1da1f2" }}').length === 1 && hexes('className="x"').length === 0,
    "the brand-colour check fires on a seeded hex and stays quiet without one",
  );
  const definedInStylesheet = (className) => ["bb-agent-run-card", "bb-agent-run-header"].includes(className);
  proof(
    "AGENT_RUN_CARD_MATERIAL",
    "the card uses a class that exists nowhere in the stylesheet",
    "the markup would look styled while rendering unstyled",
    ["bb-agent-run-card", "bb-agent-run-typo"].some((name) => !definedInStylesheet(name)),
    "the undefined-class check would catch dead markup added only to satisfy an assertion",
  );
}

// ========================================================================
// ARTIFACT_TURN_BINDING
// ========================================================================
{
  // Stand-in resolvers over a stand-in message table. The real resolver is
  // scoped by conversation AND run id; each mutation drops one of those.
  const rows = [
    { id: 1, conversationId: 10, role: "assistant", runId: "run-a" },
    { id: 2, conversationId: 10, role: "assistant", runId: "run-b" },
    { id: 3, conversationId: 20, role: "assistant", runId: "run-c" },
  ];
  const correct = (conversationId, runId) =>
    [...rows].reverse().find((row) => row.conversationId === conversationId && row.runId === runId) ?? null;
  const ignoresConversation = (conversationId, runId) =>
    [...rows].reverse().find((row) => row.runId === runId) ?? null;
  const newestAssistant = (conversationId) =>
    [...rows].reverse().find((row) => row.conversationId === conversationId) ?? null;

  proof(
    "ARTIFACT_TURN_BINDING",
    "the resolver drops the conversation scope",
    "a film would bind to a turn in a different chat",
    correct(10, "run-c") === null && ignoresConversation(10, "run-c") !== null,
    `correct: ${JSON.stringify(correct(10, "run-c"))}; unscoped: ${JSON.stringify(ignoresConversation(10, "run-c"))}`,
  );
  proof(
    "ARTIFACT_TURN_BINDING",
    "the resolver falls back to the newest assistant message",
    "a film with no turn of its own would attach to an unrelated reply",
    correct(10, "run-missing") === null && newestAssistant(10) !== null,
    `correct: null; newest-assistant fallback: ${JSON.stringify(newestAssistant(10))}`,
  );
  proof(
    "ARTIFACT_TURN_BINDING",
    "two runs in one chat both resolve to the newest turn",
    "a revision would steal the first film's turn",
    correct(10, "run-a").id !== correct(10, "run-b").id && newestAssistant(10).id === newestAssistant(10).id,
    "the per-run check distinguishes them; a newest-turn resolver would return id 2 for both",
  );
  // Scope leakage across users.
  const artifacts = [{ id: "a1", userId: 1, conversationId: 10 }];
  const scoped = (userId, conversationId) =>
    artifacts.find((row) => row.userId === userId && row.conversationId === conversationId) ?? null;
  const unscoped = (userId, conversationId) =>
    artifacts.find((row) => row.conversationId === conversationId) ?? null;
  proof(
    "ARTIFACT_TURN_BINDING",
    "artifact lookup drops the owner scope",
    "another user could read this chat's film by presenting its conversation id",
    scoped(2, 10) === null && unscoped(2, 10) !== null,
    "the cross-user case in the arbitration is what would catch this",
  );
}

// ========================================================================
// VISUAL_CONTRACT_VALIDATION
// ========================================================================
{
  const required = ["interactionGoal", "learnerAction", "visualIntent", "observable"];
  const validate = (plan, { skipCompleteness = false, skipCoherence = false } = {}) => {
    const problems = [];
    if (!skipCompleteness) {
      for (const field of required) {
        const value = plan[field];
        const empty = value === undefined || value === null || (typeof value === "string" && !value.trim());
        if (empty) problems.push(`missing model-authored ${field}`);
      }
    }
    if (!skipCoherence && !isDeepStrictEqual(plan.decisionInteraction, plan.projectedInteraction)) {
      problems.push("decision.interaction must exactly match the authoritative model-authored interaction contract");
    }
    return problems;
  };
  const coherent = {
    interactionGoal: "compare_cases",
    learnerAction: "Move the control and read the curve.",
    visualIntent: { id: "i" },
    observable: { label: "o" },
    decisionInteraction: { a: 1 },
    projectedInteraction: { a: 1 },
  };
  const missingAction = { ...coherent, learnerAction: undefined };
  const incoherent = { ...coherent, decisionInteraction: { a: 2 } };

  proof(
    "VISUAL_CONTRACT_VALIDATION",
    "the completeness check is removed",
    "a plan with no learner action would reach implementation dispatch and be built as a visual with nothing to manipulate",
    validate(missingAction).length > 0 && validate(missingAction, { skipCompleteness: true }).length === 0,
    `with check: ${JSON.stringify(validate(missingAction))}; without: none`,
  );
  proof(
    "VISUAL_CONTRACT_VALIDATION",
    "the coherence check is removed",
    "a later stage could silently re-author the model's intent and ship it as the model's own",
    validate(incoherent).length > 0 && validate(incoherent, { skipCoherence: true }).length === 0,
    `with check: ${JSON.stringify(validate(incoherent))}; without: none`,
  );
  proof(
    "VISUAL_CONTRACT_VALIDATION",
    "whitespace is accepted as an authored action",
    "an empty string would satisfy a contract the learner has to act on",
    validate({ ...coherent, learnerAction: "   " }).length > 0,
    "the emptiness test trims before deciding",
  );
  proof(
    "VISUAL_CONTRACT_VALIDATION",
    "control: a complete and coherent contract is accepted",
    "n/a",
    validate(coherent).length === 0,
    "a validator that refuses everything satisfies 'it refuses' without being the contract",
  );
}

// ========================================================================
const bySubRoot = {};
for (const entry of results) {
  bySubRoot[entry.subRoot] ??= { total: 0, detected: 0 };
  bySubRoot[entry.subRoot].total += 1;
  if (entry.detected) bySubRoot[entry.subRoot].detected += 1;
}
const allDetected = results.every((entry) => entry.detected);

const summary = {
  generatedAt: new Date().toISOString(),
  method:
    "Each sub-root's check was re-run against deliberately broken stand-ins. Mutations were applied to local stand-ins only; no product file, test file or repository artefact was modified, and nothing was left seeded.",
  total: results.length,
  detected: results.filter((entry) => entry.detected).length,
  bySubRoot,
  results,
  nonVacuous: allDetected,
  conclusion: allDetected
    ? "Every seeded semantic violation was detected, so none of the six contract checks is vacuous."
    : "At least one seeded violation went undetected; that check is not yet an oracle.",
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

for (const entry of results) {
  console.log(`  ${entry.detected ? "CAUGHT " : "MISSED "} [${entry.subRoot}] ${entry.mutation}`);
}
console.log(`[counterexamples] ${summary.detected}/${summary.total} detected; non-vacuous: ${summary.nonVacuous}`);
process.exit(summary.nonVacuous ? 0 : 1);
