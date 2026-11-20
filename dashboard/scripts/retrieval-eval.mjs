// Does per-turn Garden retrieval hand the model the page that answers the
// question? Read-only against the live Gardens: indexes into a throwaway
// in-memory database, never brain.db.
//
//   node scripts/retrieval-eval.mjs
//
// The cases need the author's own Gardens (Data/quartz/content); a missing
// Garden is skipped, not failed.
import fs from "node:fs";

process.env.BREADBOARD_DATA_DIR ??= `${process.env.APPDATA}/breadboard-desktop/Data`;
const root = process.env.QUARTZ_CONTENT_PATH ?? `${process.env.BREADBOARD_DATA_DIR}/quartz/content`;
await import(new URL("./learn-worker-import-hook.mjs", import.meta.url).href);
const { lazyRetrievalGarden } = await import(new URL("../src/lib/hermes/garden-reader.ts", import.meta.url).href);
const { retrieveAcrossGardens } = await import(new URL("../src/lib/hermes/cross-garden-retrieval.ts", import.meta.url).href);
const { retrieveGraphRag, createEphemeralRetrievalDatabase } = await import(new URL("../src/lib/semantic-retrieval.ts", import.meta.url).href);

// [active Garden, question, expected page title, Garden that holds it]
const CASES = [
  // Title-word questions (2026-11-17 set).
  ["math-1", "What's the definition of a hyperplane", /Hyperplanes/, "math-1"],
  ["math-1", "how do I check whether vectors are linearly independent", /Linear Independence/i, "math-1"],
  ["math-1", "when does a matrix have an inverse", /Invertible Matrix Theorem|Matrix Inverses/, "math-1"],
  ["math-2", "how do you compute a double integral", /Double Integrals/, "math-2"],
  ["math-2", "what's the multivariable chain rule", /Chain Rule/, "math-2"],
  ["ec-2", "what is the threshold voltage of a mosfet", /Threshold Voltage/, "ec-2"],
  ["ec-2", "explain the cascode amplifier", /Cascode/, "ec-2"],
  ["ec-2", "how do I sketch the frequency response from poles and zeros", /Bode Plot|Frequency Response from Pole.Zero/, "ec-2"],
  ["ec-2", "what is the T model of a bipolar transistor", /T Equivalent/, "ec-2"],
  ["neuro-comp", "how does backprop work in deep nets", /Backpropagation/, "neuro-comp"],
  ["neuro-comp", "what's a subthreshold diff pair", /Subthreshold Differential Pair/, "neuro-comp"],
  ["neuro-comp", "how does the perceptron learning rule update weights", /Perceptron/, "neuro-comp"],
  ["telecom-1", "what is four wave mixing in optical fiber", /Four-Wave Mixing/, "telecom-1"],
  ["telecom-1", "how can a slope detector demodulate FM", /Slope Detection/, "telecom-1"],
  ["electromagnetism-1", "coulomb's law in vector form", /Coulomb's Law/, "electromagnetism-1"],
  ["electromagnetism-1", "how should I pick a gaussian surface", /Gaussian Surface/, "electromagnetism-1"],
  ["electromagnetism-1", "what is the flux of the electric field through a surface", /Electric Flux/, "electromagnetism-1"],
  ["signals-and-systems", "what is the convolution sum for discrete signals", /Convolution Sum/, "signals-and-systems"],
  ["physics-for-ee", "why is the sky blue", /Scattering/, "physics-for-ee"],
  ["physics-for-ee", "what's total internal reflection", /Total Internal Reflection/i, "physics-for-ee"],
  ["math-1", "how do I draw a bode plot", /Bode Plot/, "ec-2"],
  ["neuro-comp", "what is the definition of a hyperplane", /Hyperplanes/, "math-1"],
  ["telecom-1", "how do I compute a double integral", /Double Integrals/, "math-2"],
  ["ec-2", "what's coulomb's law", /Coulomb's Law/, "electromagnetism-1"],
  // Paraphrases: the question describes the idea without the title's words.
  ["ec-2", "why does the gain fall off at 20 dB per decade past the corner", /Single.Pole|Roll.?Off/i, "ec-2"],
  ["ec-2", "what condition must the loop gain meet for a circuit to keep oscillating", /Barkhausen|Loop.Gain Condition/i, "ec-2"],
  ["ec-2", "the collector current no longer equals beta times base current, why", /Saturation and Forced Beta/i, "ec-2"],
  ["ec-2", "estimate the upper -3 dB frequency by summing the RC product seen by each capacitor", /Open.Circuit Time Constants/i, "ec-2"],
  ["ec-2", "push pull output stage crossover distortion and efficiency", /Class.B/i, "ec-2"],
  ["ec-2", "a three transistor mirror that cancels the base current error", /Wilson/i, "ec-2"],
  ["telecom-1", "how much power reaches a receiving antenna in free space", /Friis/i, "telecom-1"],
  ["telecom-1", "maximum error free bit rate over a noisy band limited channel", /Shannon/i, "telecom-1"],
  ["telecom-1", "noise from optical amplifiers piling up along a long fiber link", /ASE|EDFA|Optical.Amplifier.*Noise/i, "telecom-1"],
  ["telecom-1", "transmitting only one side of the AM spectrum", /Single.Sideband/i, "telecom-1"],
  ["telecom-1", "how ADSL splits the line into many narrow subcarriers", /Discrete Multitone/i, "telecom-1"],
  ["telecom-1", "sending the same symbol again later so fading is unlikely to hit both copies", /Temporal Diversity/i, "telecom-1"],
  ["electromagnetism-1", "voltage induced in a rectangular wire loop sliding through a magnetic field", /Faraday|Moving Rectangular Loop|Electromotive/i, "electromagnetism-1"],
  ["electromagnetism-1", "how do I get E once I know D", /Flux Density to Electric Field/i, "electromagnetism-1"],
  ["electromagnetism-1", "why is the flux of a constant field through a closed sphere zero", /Zero Net Flux/i, "electromagnetism-1"],
  ["signals-and-systems", "test whether a cubic characteristic polynomial has roots in the right half plane", /Routh/i, "signals-and-systems"],
  ["signals-and-systems", "how many integrators in the loop do I need for zero steady state error to a ramp", /System Type/i, "signals-and-systems"],
  ["signals-and-systems", "simplify a block diagram that has a loop inside another loop", /Block Diagram Reduction|Nested Feedback/i, "signals-and-systems"],
  ["signals-and-systems", "what comes out of an FIR filter when the input is a single spike at n=0", /Impulse Response of an FIR/i, "signals-and-systems"],
  ["neuro-comp", "learning rule where the weight change depends on whether the pre spike came before the post spike", /Spike.Timing/i, "neuro-comp"],
  ["neuro-comp", "why do identically drawn transistors on one chip differ, and how does it shrink with area", /Mismatch|Pelgrom/i, "neuro-comp"],
  ["neuro-comp", "output rate of an integrate and fire neuron driven by white noise input", /Siegert/i, "neuro-comp"],
  ["neuro-comp", "checking that the layout matches the schematic netlist", /LVS|Netgen/i, "neuro-comp"],
  ["neuro-comp", "sodium potassium pump and the resting potential of the membrane", /Resting Membrane Potential/i, "neuro-comp"],
  ["math-2", "rate of change of a function when moving in a chosen direction", /Gradient|Directional/i, "math-2"],
  ["math-2", "work done by a force field along a curve", /Line Integrals/i, "math-2"],
  ["math-2", "when is a vector field the gradient of some potential function", /Conservative/i, "math-2"],
];

const present = (slug) => fs.existsSync(`${root}/${slug}`);
const cases = CASES.filter(([active, , , holder]) => present(active) && present(holder));
// RETRIEVAL_EVAL_DB=<file> keeps the index (and any vectors put there) between runs.
const database = process.env.RETRIEVAL_EVAL_DB
  ? new (await import("better-sqlite3")).default(process.env.RETRIEVAL_EVAL_DB)
  : createEphemeralRetrievalDatabase();
const gardens = new Map();
for (const slug of new Set(cases.flatMap(([a, , , b]) => [a, b]))) {
  gardens.set(slug, await lazyRetrievalGarden(root, { slug, name: slug }));
  await retrieveGraphRag({ query: "warm", gardens: [gardens.get(slug)], database, embeddingProvider: null, indexEmbeddings: false });
}

let hits = 0;
let reciprocal = 0;
let elapsed = 0;
for (const [active, question, expected, holder] of cases) {
  const started = Date.now();
  const result = await retrieveAcrossGardens({
    query: question,
    primary: [gardens.get(active)],
    others: [...gardens.values()].filter((g) => g.slug !== active)
      .map((g) => ({ slug: g.slug, name: g.name, rootPath: g.rootPath, resolve: async () => g })),
    database,
  });
  const ms = Date.now() - started;
  elapsed += ms;
  const rank = result.chunks.findIndex((c) => c.gardenSlug === holder && expected.test(c.pageTitle)) + 1;
  if (rank) { hits += 1; reciprocal += 1 / rank; }
  console.log(`${rank ? `hit@${rank}` : "MISS "} ${String(ms).padStart(5)}ms [${active}] ${question}${rank ? "" : `  -> ${result.chunks.slice(0, 3).map((c) => `${c.gardenSlug}:${c.pageTitle.slice(0, 40)}`).join(" | ")}`}`);
}
console.log(`\nfound ${hits}/${cases.length}  MRR ${(reciprocal / cases.length).toFixed(3)}  avg ${Math.round(elapsed / cases.length)} ms/question`);
process.exit(0);
