import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

import {
  buildGeneratedVisualBlock,
  createGeneratedVisualization,
  findGeneratedVisualBlockById,
  generateVisualizationCandidate,
  replaceGeneratedVisualBlock,
} from "../src/lib/generated-visuals.ts";
import { compileGeneratedVisualization } from "../src/lib/generated-visual-compiler.ts";
import { runGeneratedVisualBrowserTestsLocally } from "../src/lib/generated-visual-browser-tests.ts";

const dashboardDir = path.resolve(import.meta.dirname, "..");
const gardenDir = path.resolve(dashboardDir, "../quartz/content/generated-visual-demo");
const pageRel = "learning/1. Epidemic Feedback/1.1 Contact Reduction and Feedback Threshold.md";
const pagePath = path.join(gardenDir, ...pageRel.split("/"));
const visualId = "visual-contact-threshold-feedback";
const insertionAnchor = "learning-unit:U1:after-introduction";

const opportunity = {
  id: visualId,
  gardenId: "generated-visual-demo",
  learningUnitId: "U1",
  targetPage: pageRel,
  targetHeading: "Contact Reduction and Feedback Threshold",
  insertionAnchor,
  conceptIds: ["infection-feedback", "control-threshold"],
  sourceAnchorIds: ["S1.P1.E1"],
  sourceVisualIds: [],
  sourceVisualRelationships: [],
  learningObjective:
    "Explain how baseline reproduction and contact reduction combine to cross the growth-or-decline threshold.",
  learnerQuestion:
    "How much contact reduction is needed to move the effective reproduction factor below one?",
  pedagogicalReason:
    "The learner needs to coordinate a threshold curve with the causal path from contact reduction to feedback direction; no trusted renderer combines those representations.",
  interactionGoal: "test_prediction",
  requiredInputs: [
    { id: "baseR", label: "Baseline reproduction factor", type: "slider", min: 0.8, max: 3.5, step: 0.1, defaultValue: 2.4 },
    { id: "reduction", label: "Contact reduction", type: "slider", unit: "%", min: 0, max: 80, step: 5, defaultValue: 35 },
  ],
  requiredOutputs: [
    { id: "effectiveR", label: "Effective reproduction factor", representation: "value" },
    { id: "thresholdCurve", label: "Contact-reduction threshold curve", representation: "chart" },
    { id: "feedback", label: "Transmission feedback", representation: "diagram" },
  ],
  preferredRenderer: undefined,
  requiresGeneratedModule: true,
  priority: "critical",
  confidence: 0.94,
  similarityFingerprint: "infection-feedback|control-threshold|test-prediction|effective-r-threshold",
};

if (!fs.existsSync(pagePath)) {
  throw new Error(`Demo lesson is missing: ${pagePath}`);
}

const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL || "http://127.0.0.1:8765/v1",
  apiKey: process.env.OPENAI_API_KEY || "local",
  timeout: 120_000,
  maxRetries: 0,
});
const model = process.env.BREADBOARD_DEMO_MODEL || "gpt-5.6-sol";
const events = [];
const pageMarkdown = fs.readFileSync(pagePath, "utf-8");
const attemptsDir = path.join(gardenDir, ".breadboard", "visuals", visualId, "attempts");
let priorRepairContext = null;
if (fs.existsSync(attemptsDir)) {
  const attemptDirs = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(dir, entry.name);
      if (fs.existsSync(path.join(child, "source.tsx"))) attemptDirs.push(child);
      visit(child);
    }
  };
  visit(attemptsDir);
  attemptDirs.sort((a, b) => fs.statSync(path.join(b, "source.tsx")).mtimeMs - fs.statSync(path.join(a, "source.tsx")).mtimeMs);
  const repairErrors = [];
  for (const attemptDir of attemptDirs.slice(0, 5)) {
    const rejectionPath = path.join(attemptDir, "rejection.json");
    if (!fs.existsSync(rejectionPath)) continue;
    const rejection = JSON.parse(fs.readFileSync(rejectionPath, "utf-8"));
    for (const error of Array.isArray(rejection.errors) ? rejection.errors.map(String) : []) {
      if (!/aborted|timed out|all candidate models failed/i.test(error) && !repairErrors.includes(error)) repairErrors.push(error);
    }
  }
  for (const attemptDir of attemptDirs) {
    const sourcePath = path.join(attemptDir, "source.tsx");
    const rejectionPath = path.join(attemptDir, "rejection.json");
    if (!fs.existsSync(sourcePath) || !fs.existsSync(rejectionPath)) continue;
    priorRepairContext = {
      sourceCode: fs.readFileSync(sourcePath, "utf-8"),
      errors: repairErrors.length
        ? repairErrors.slice(0, 12)
        : ["Recalculate every test-case expected value from the declared output expressions; preserve the validated module structure and source-backed relationships."],
    };
    break;
  }
}
const result = await createGeneratedVisualization({
  compilerRunner: async (sourceCode, compilerOpportunity) =>
    compileGeneratedVisualization(sourceCode, compilerOpportunity),
  browserTestRunner: runGeneratedVisualBrowserTestsLocally,
  client,
  model,
  gardenDir,
  opportunity,
  pageMarkdown,
  sourceContext: {
    source: "A compact teaching source derived from the discrete early-growth approximation.",
    excerpt:
      "Before susceptible depletion becomes important, infection pressure grows when the effective reproduction factor exceeds one and shrinks when it is below one. A contact-reduction fraction c changes the illustrative factor to R_eff = R_0(1-c). Intervention timing determines how long pre-intervention growth continues. This reconstruction is illustrative, not a calibrated forecast.",
  },
  formulaDefinitions: [
    {
      id: "S1.P1.E1",
      formula: "R_eff = R_0(1-c)",
      variables: {
        R_eff: "effective reproduction factor (dimensionless)",
        R_0: "baseline reproduction factor (dimensionless)",
        c: "contact-reduction fraction between 0 and 1",
      },
    },
  ],
  availableSourceAnchorIds: new Set(["S1.P1.E1"]),
  candidateProvider: (request) => generateVisualizationCandidate({
    ...request,
    previousSourceCode: request.previousSourceCode || priorRepairContext?.sourceCode,
    errors: request.errors?.length ? request.errors : priorRepairContext?.errors,
  }),
  onEvent: (event) => events.push({ at: new Date().toISOString(), ...event }),
});

if (!result.manifest) {
  throw new Error(`Generated visualization was rejected: ${result.errors.join("; ")}`);
}

const currentMarkdown = fs.readFileSync(pagePath, "utf-8");
const existing = findGeneratedVisualBlockById(currentMarkdown, visualId);
const block = buildGeneratedVisualBlock(visualId, result.manifest.version);
const nextMarkdown = existing
  ? replaceGeneratedVisualBlock(currentMarkdown, existing, visualId, result.manifest.version)
  : currentMarkdown.replace(`<!-- ${insertionAnchor} -->`, `<!-- ${insertionAnchor} -->\n\n${block}`);
fs.writeFileSync(pagePath, nextMarkdown, "utf-8");

const breadboardDir = path.join(gardenDir, ".breadboard");
fs.mkdirSync(breadboardDir, { recursive: true });
fs.writeFileSync(
  path.join(breadboardDir, "visualization-plan.json"),
  `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), opportunities: [opportunity], decisions: [{ opportunityId: visualId, route: "generated_module", compatibilityScore: 0.31, reason: "No trusted renderer combines the threshold curve, derived value, and causal feedback path." }] }, null, 2)}\n`,
  "utf-8",
);
const coverage = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  opportunitiesDetected: 1,
  criticalOpportunities: 1,
  highPriorityOpportunities: 0,
  trustedVisualsPublished: 0,
  generatedVisualsPublished: 1,
  omittedAsPedagogicallyUnhelpful: 0,
  failedValidation: 0,
  failedCompilation: 0,
  failedRuntimeTests: 0,
  failedCritic: 0,
  uncoveredCriticalOpportunityIds: [],
  uncoveredHighPriorityOpportunityIds: [],
  coverageScore: 1,
  status: "pass",
};
fs.writeFileSync(path.join(breadboardDir, "visualization-coverage.json"), `${JSON.stringify(coverage, null, 2)}\n`, "utf-8");
fs.writeFileSync(path.join(breadboardDir, "visualization-events.json"), `${JSON.stringify(events, null, 2)}\n`, "utf-8");

process.stdout.write(`${JSON.stringify({ gardenDir, pageRel, model, manifest: result.manifest, events: events.map((event) => event.type) }, null, 2)}\n`);
