import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { reviewExplanation, EXPLANATION_PLAN_PROMPT, EXPLANATION_REVIEW_PROMPT, EXPLANATION_REPAIR_PROMPT, EXPLANATION_VERIFY_PROMPT } from "../src/lib/hermes/explanation-review.ts";
import { explanationReviewModel } from "../src/lib/hermes/explanation-review-provider.ts";

// Run explicitly against the configured provider; never part of offline tests.
// This is a fixture smoke evaluation, not a measured comparison with a baseline.
// A returned "repaired" status is not the quality verdict: inspect the answer
// for the target omission, factual regressions, and unnecessary expansions.
const model = process.argv[2] || "gpt-5.6-sol";
const reviewContractSha256 = createHash("sha256").update(JSON.stringify([
  EXPLANATION_PLAN_PROMPT, EXPLANATION_REVIEW_PROMPT, EXPLANATION_REPAIR_PROMPT, EXPLANATION_VERIFY_PROMPT,
])).digest("hex");
const cases = [
  {
    id: "battery-omission", expected: "repaired",
    contentChecks: ["The battery's separated charge creates the initial field that affects local wire electrons.", "Electromagnetic change propagates; drift of terminal electrons does not initiate distant current.", "The battery and wire surface-charge fields combine and adjust through feedback.", "Any stated field direction is opposite electron drift in the resistive wire."],
    userRequest: "explain this more like what happens on the side of the negative of the battery and the positive of the battery",
    context: "The discussion concerns how surface charges and the electric field establish current in a battery connected to a resistive wire. Explain the two terminals in that context.",
    answer: "Near the negative terminal, battery chemistry releases electrons into connected metal, creating a small negative surface charge. Near the positive terminal, chemistry accepts electrons, leaving a small positive surface charge. When the circuit closes, the excess at the negative end repels nearby electrons. Those electrons shift and affect the next region. At the positive end the electron shortage attracts electrons. Redistribution continues until the surface charge at every location produces the needed electric field.",
  },
  {
    id: "dns-complete", expected: "reviewed",
    userRequest: "How does DNS turn a website name into an IP address? Keep it introductory.",
    context: "Explain ordinary recursive DNS resolution, not DNS security or server implementation.",
    answer: "Your device asks a DNS resolver for the address associated with the website name. A cached answer can be returned immediately while it is still valid. If the resolver has no usable cached answer, it follows referrals through DNS: a root server points toward the relevant top-level domain, and that domain points toward an authoritative server for the website's domain. The authoritative server supplies the address record, or a name alias that must also be resolved. The resolver returns the result to your device and can cache it for the record's time-to-live. Your browser can then use that address to connect to the server; DNS itself does not download the webpage.",
  },
  {
    id: "timer-omission", expected: "repaired",
    userRequest: "Why can a JavaScript setTimeout callback run later than the requested delay?",
    context: "Explain browser timers and event-loop scheduling at an introductory level.",
    answer: "setTimeout takes a callback and a delay in milliseconds. The browser tracks the timer. When the timer expires, the callback runs. The requested delay controls the timer.",
  },
];
const results = [];
cases.splice(1, 0, {
  ...cases[0], id: "battery-source-grounded",
  sourcePassages: "Source notes, paraphrased from Chabay and Sherwood, American Journal of Physics 87, 341 (2019), https://doi.org/10.1119/1.5095939: Charges in and on the battery produce an electric field that polarizes the conductors even before the final connection. Closing the gap changes the field conditions; the disturbance reaches other parts electromagnetically. Local transient currents modify surface charges, whose field combines with the battery's field. Only tiny local electron displacements are needed. The redistribution and electric field adjust together toward steady current.",
});
const outDir = path.resolve("artifacts/explanation-review");
cases.push(...JSON.parse(await fs.readFile(new URL("../tests/fixtures/explanation-comprehension.json", import.meta.url), "utf8")));
await fs.mkdir(outDir, { recursive: true });
for (const fixture of cases) {
  if (process.argv[3] && process.argv[3] !== fixture.id) continue;
  console.log(`Evaluating ${fixture.id}`);
  const responses = [];
  const complete = explanationReviewModel(model);
  const result = await reviewExplanation({ ...fixture, model, complete: async request => {
    const response = await complete(request);
    responses.push({ stage: request.stage, ...response });
    return response;
  } });
  const expectedStatusMatched = result.report.status === fixture.expected;
  results.push({ fixture, expectedStatusMatched, ...result, responses });
  console.log(JSON.stringify({ id: fixture.id, status: result.report.status, expectedStatusMatched, calls: result.report.calls, durationMs: result.report.durationMs, tokens: result.usage?.totalTokens, reason: result.report.reason }));
  const at = new Date().toISOString();
  const report = JSON.stringify({ model, at, reviewContractSha256, kind: "fixture_smoke_not_baseline_comparison", requiresHumanContentReview: true, results }, null, 2);
  await fs.writeFile(path.join(outDir, "latest.json"), report);
  const caseReport = JSON.stringify({ model, at, reviewContractSha256, fixture, expectedStatusMatched, ...result, responses }, null, 2);
  await fs.writeFile(path.join(outDir, `${fixture.id}.json`), caseReport);
  await fs.writeFile(path.join(outDir, `${fixture.id}-${at.replace(/[:.]/g, "-")}.json`), caseReport);
}
if (results.some(result => !result.expectedStatusMatched)) process.exitCode = 1;
