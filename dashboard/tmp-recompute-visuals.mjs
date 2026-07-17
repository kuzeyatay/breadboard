import fs from "node:fs";
import {
  planGardenVisualNecessity,
} from "./src/lib/visual-necessity.ts";
import {
  buildVisualizationPlan,
  applyVisualizationRoutesToLearningUnits,
} from "./src/lib/visualization-opportunities.ts";

const contractPath = process.argv[2];
const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
const learningUnits = contract.learningUnits;

const plan = planGardenVisualNecessity({ gardenId: "test2", learningUnits });

const tally = {};
for (const d of plan.decisions) tally[d.necessity] = (tally[d.necessity] ?? 0) + 1;

console.log("=== NECESSITY DECISIONS (deterministic) ===");
console.log("budget:", JSON.stringify(plan.budget));
console.log("tally:", JSON.stringify(tally));
console.log("");
for (const d of plan.decisions) {
  console.log(
    `${d.unitId.padEnd(4)} ${String(d.necessity).padEnd(22)} med=${String(d.preferredMedium).padEnd(24)}` +
      ` manip=${d.manipulationValue} dyn=${d.dynamicBehaviorValue} cmp=${d.comparisonValue} sp=${d.spatialValue}` +
      ` par=${d.parameterSensitivityValue} figSuf=${d.sourceFigureSufficiency} cog=${d.cognitiveLoadRisk} dup=${d.duplicationRisk}`,
  );
}

const learningMap = {
  gardenId: "test2",
  sections: [
    { title: "S1", subsections: plan.learningUnits.map((u) => ({ title: u.title, learningUnitId: u.id })) },
  ],
};

const vplan = buildVisualizationPlan({ gardenId: "test2", learningMap, learningUnits: plan.learningUnits });
console.log("");
console.log("=== VISUALIZATION PLAN ===");
console.log("opportunities:", vplan.opportunities.length);
const routeTally = {};
for (const dec of vplan.decisions) routeTally[dec.route] = (routeTally[dec.route] ?? 0) + 1;
console.log("routes:", JSON.stringify(routeTally));
for (const dec of vplan.decisions) {
  const opp = vplan.opportunities.find((o) => o.id === dec.opportunityId);
  console.log(`  ${String(opp?.learningUnitId).padEnd(4)} ${dec.route.padEnd(20)} renderer=${dec.selectedRenderer ?? "-"} score=${dec.compatibilityScore ?? "-"}`);
}

const routed = applyVisualizationRoutesToLearningUnits(plan.learningUnits, vplan);
const withIntent = routed.filter((u) => u.interactiveVisual);
console.log("");
console.log("=== UNITS WITH INTERACTIVE INTENT AFTER ROUTING ===", withIntent.length);
for (const u of withIntent) {
  console.log(`  ${u.id} type=${u.interactiveVisual.visualType} concept=${String(u.interactiveVisual.uniqueConcept).slice(0, 60)}`);
}

console.log("");
console.log("=== ZERO-VISUAL SAFEGUARD ===", JSON.stringify(plan.zeroVisualSafeguard));
console.log("");
console.log("=== DECISION RECORDS (observability) ===");
const recTally = {};
for (const r of plan.decisionRecords) recTally[r.decision] = (recTally[r.decision] ?? 0) + 1;
console.log("record tally:", JSON.stringify(recTally));
for (const r of plan.decisionRecords.slice(0, 6)) {
  console.log(`  ${r.unitId} ${r.decision} type=${r.candidateType} conf=${r.confidence} +[${r.positiveSignals.join("|")}] -[${r.negativeSignals.join("|")}] src=${r.decisionSource}`);
}

// Prove trusted-route embedding is deterministic (no ChatMock).
const { buildDeterministicVisual, buildVisualBlock } = await import("./src/lib/visual-spec.ts");
const trustedRoutes = vplan.decisions.filter((d) => d.route === "trusted_renderer");
console.log("");
console.log("=== DETERMINISTIC TRUSTED EMBEDDING PROOF ===");
for (const dec of trustedRoutes) {
  const opp = vplan.opportunities.find((o) => o.id === dec.opportunityId);
  const spec = buildDeterministicVisual(dec.selectedRenderer, { gardenId: "test2", pageSlug: `learning/${opp.learningUnitId}` });
  const block = spec ? buildVisualBlock(spec) : null;
  console.log(`  ${opp.learningUnitId} -> ${dec.selectedRenderer}: spec=${spec ? "VALID id=" + spec.id + " type=" + spec.type + " controls=" + (spec.controls?.length ?? 0) : "NULL"}`);
  if (block) console.log(`     block starts: ${block.split("\n")[0]}  (len ${block.length})`);
}
