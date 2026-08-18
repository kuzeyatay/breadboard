import path from "node:path";
import { pathToFileURL } from "node:url";
const load = (r) => import(pathToFileURL(path.join(process.cwd(), r)).href);
const { planGardenVisualNecessity } = await load("src/lib/visual-necessity.ts");
const unit = {
  id: "U1", role: "comparison",
  title: "Rate, latency, and delta encoding trade-offs",
  learningQuestion: "How do rate, latency, and delta encoding trade off under a fixed spike budget?",
  prerequisiteConcepts: [], newConcepts: ["encoding trade-offs"],
  sourceAnchors: ["S1.P1.T1"], sourceFigures: [], sourceFormulas: [], sourceTables: [],
  zettelNotes: [], semanticConcepts: [], knowledgeClaims: [], mustNotRepeat: [],
  expectedWordRange: [700, 1100],
};
const plan = planGardenVisualNecessity({ gardenId: "g", learningUnits: [unit] });
console.log(JSON.stringify(plan.decisions[0], null, 1).slice(0, 2500));
