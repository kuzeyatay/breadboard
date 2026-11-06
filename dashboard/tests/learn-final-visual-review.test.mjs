import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-final-visual-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
await import("../scripts/learn-worker-import-hook.mjs");
const { proseWithoutGeneratedVisuals, generatedVisualsAsReviewNotes } = await import("../src/lib/learn.ts");

test("an inserted interactive visual leaves the reviewed prose unchanged", (t) => {
  // Live 2026-10-02 (gpt-6-sol, lesson 1.1): inserting the visual forced a
  // fresh full review that also judged the raw id/version embed.
  t.after(() => { try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch {} });
  const drafted = [
    "Compare the waveforms.",
    "```breadboard-visual\n{\"kind\":\"switch\"}\n```",
    "The Manchester curve starts at zero.",
  ].join("\n\n") + "\n";
  const visualized = [
    "Compare the waveforms.",
    "<!-- learning-unit:U1:interactive-visual -->",
    "```breadboard-generated-visual\nid: visual-u1-1\nversion: 1\n```",
    "The Manchester curve starts at zero.",
  ].join("\n\n") + "\n";
  // The writer's spec swapped for the generated embed is not a prose change.
  assert.equal(proseWithoutGeneratedVisuals(visualized), proseWithoutGeneratedVisuals(drafted));
  assert.notEqual(proseWithoutGeneratedVisuals(`${visualized}A new sentence.`), proseWithoutGeneratedVisuals(drafted));
  // A reviewer sees the spec it already accepted, never the id/version source.
  const review = generatedVisualsAsReviewNotes(visualized, drafted);
  assert.doesNotMatch(review, /version: 1|breadboard-generated-visual|learning-unit:/);
  assert.ok(review.includes("```breadboard-visual\n{\"kind\":\"switch\"}\n```"));
});

test("a required formula the prose cites but does not display is a recorded erratum", async () => {
  // Live 2026-10-02 (gpt-6-sol, lesson 1.2): flawed course transcriptions were
  // refused by the writer and flagged as incorrect when copied verbatim.
  const { citedSourceFormulaErrataIds } = await import("../src/lib/learn.ts");
  const body = [
    "Intro.",
    "Only $R[0]$ survives, so the sum equals $A^2$ (S14.P22.E4).",
    "$$\nx = 1 \\quad S9.P1.E1\n$$",
  ].join("\n\n");
  assert.deepEqual(citedSourceFormulaErrataIds(body, ["S14.P22.E4", "S9.P1.E1", "S2.P3.E4"]), ["S14.P22.E4"]);
});

test("a reader-progression constraint cannot keep a server-assigned figure unused", async () => {
  // Live 2026-10-03 (telecom-1 lesson 1.2): the plan said to keep S20.P250.G2
  // unused while the assignment required it, so six repairs alternated.
  const { withoutAssignedVisualExclusions } = await import("../src/lib/learn.ts");
  const plan = { constraints: [
    "Keep S20.P250.G2 unused in this page because the allocation reserves Molisch.",
    "Discuss S13.P20.G1 beside the sinc nulls.",
    "Keep S99.P1.G1 unused here.",
  ] };
  assert.deepEqual(
    withoutAssignedVisualExclusions(plan, ["S20.P250.G2", "S13.P20.G1"]).constraints,
    ["Discuss S13.P20.G1 beside the sinc nulls.", "Keep S99.P1.G1 unused here."],
  );
  assert.equal(withoutAssignedVisualExclusions(plan, ["S1.P1.G1"]), plan);
});

test("review findings cannot remove a server-assigned figure or required source question", async () => {
  // Live 2026-10-03 (telecom-1 lessons 1.2 and 1.4): the term reviewer asked to
  // remove S20.P250.G2 and the assigned PPM Example 10.4; repairs oscillated.
  const { excludesAssignedVisual, removesRequiredSourceQuestion } = await import("../src/lib/learn.ts");
  assert.equal(excludesAssignedVisual("S20.P250.G2 is outside the supplied authority; remove the extra figure.", ["S20.P250.G2"]), true);
  assert.equal(excludesAssignedVisual("Discuss S20.P250.G2 beside the formula.", ["S20.P250.G2"]), false);
  const prompts = ["Consider a PPM system with g(t). What is the correlation coefficient rho and the correlation coefficient of the envelopes when T_d is (i) T, (ii) 5T?"];
  assert.equal(removesRequiredSourceQuestion({ message: "Remove this out-of-scope PPM exercise.",
    evidence: ["What is the correlation coefficient rho and the correlation coefficient of the envelopes when T_d is (i) T, (ii) 5T?"] }, prompts), true);
  assert.equal(removesRequiredSourceQuestion({ message: "Remove the out-of-scope exercise.",
    evidence: ["The pulse-energy integral equals pi."] }, prompts), false);
  assert.equal(removesRequiredSourceQuestion({ message: "Explain the correlation coefficient first.",
    evidence: ["What is the correlation coefficient rho and the correlation coefficient of the envelopes"] }, prompts), false);
});

test("review findings cannot ask to omit, reformat, or strip the hint of a verbatim source question", async () => {
  // Live 2026-10-15 (em1 lesson 12.2): Q32 parked after the reviewer asked to
  // drop its exam-admin line, render its ```latex block as $$, and remove its
  // misprinted hint, while the question gate required all three verbatim.
  const { removesRequiredSourceQuestion } = await import("../src/lib/learn.ts");
  const q32 = ["Remember to start your answers to this problem on a new page, and to put your name and student Id on every page.\n\nThe vector potential and the magnetic field are given by\n\n```latex\n\\vec{A}=\\mu_{0}J_{b}\\,\\vec{a}_{z}\\times\\vec{r}\n```\n\n(Hint: you may use the integral of sin^(2n) over (0, pi).)"];
  assert.equal(removesRequiredSourceQuestion({ message: "This is examination administration, which the user explicitly required omitting.",
    evidence: ["Remember to start your answers to this problem on a new page, and to put your name and student Id on every page."] }, q32), true);
  assert.equal(removesRequiredSourceQuestion({ message: "The prescribed potential is supplied as a fenced code block rather than rendered display mathematics. Use $$ display delimiters.",
    evidence: ["```latex\n\\vec{A}=\\mu_{0}J_{b}\\,\\vec{a}_{z}\\times\\vec{r}\n```"] }, q32), true);
  assert.equal(removesRequiredSourceQuestion({ message: "Remove the faulty source hint and its diagnosis; the running energy calculation needs the correct ordinary integral.",
    evidence: ["The even-power hint fails at n=0."] }, q32), true);
  // Teaching around the question stays actionable.
  assert.equal(removesRequiredSourceQuestion({ message: "Explain the vector potential before this question uses it.",
    evidence: ["The vector potential and the magnetic field are given by"] }, q32), false);
});

test("a duplicate transcription of a reproduced source question is already on the page", async () => {
  // Live 2026-10-03 (telecom-1 lesson 2.2): Q1 and Q18 are both Couch 5-53.
  const { unreproducedSourceQuestions } = await import("../src/lib/learn.ts");
  const q1 = { id: "Q1", prompt: "A digital baseband signal consisting of rectangular binary pulses occurring at a rate of 24 kbits/s is to be transmitted over a bandpass channel. (a) Evaluate the magnitude spectrum for OOK signaling. Assume a carrier frequency of 150 MHz." };
  const q18 = { id: "Q18", prompt: "5-53 A digital baseband signal consisting of rectangular binary pulses occurring at a rate of 24kbit/s is to be transmitted over a bandpass channel. (a) Evaluate the magnitude spectrum for OOK signaling. Assume a carrier frequency of 150MHz." };
  const other = { id: "Q9", prompt: "Find the bit error rate of coherent BPSK at Eb/N0 of 10 dB and compare it with noncoherent FSK." };
  const body = q1.prompt.replace(/\s+/g, "");
  assert.deepEqual(unreproducedSourceQuestions([q1, q18, other], body).map((q) => q.id), ["Q9"]);
  assert.deepEqual(unreproducedSourceQuestions([q1, q18], "").map((q) => q.id), ["Q1", "Q18"]);
});

test("a lesson keeps one transcription of each assigned textbook problem", async () => {
  // Live 2026-10-03 (telecom-1 lesson 2.3): 5-55 was assigned four times.
  const { withoutDuplicateSourceQuestions } = await import("../src/lib/learn.ts");
  const q = (id, prompt) => ({ id, prompt });
  const kept = withoutDuplicateSourceQuestions([
    q("A", "Repeat Prob. 5-53 for the case of BPSK signaling."),
    q("B", "5-55 Repeat 5-53 for the case of BPSK signaling."),
    q("C", "5-55 Repeat Problem 5-53 for the case of BPSK signaling."),
    q("D", "5-57 Repeat Prob. 5-53 for the case of FSK signaling."),
    q("E", "Referring to Prob. 5-53 for the case of a random data pattern with BPSK signaling, find the PSD and plot the result."),
    q("F", "5-56 Referring to problem 5-54 for the case of a random data pattern with BPSK signaling, find the PSD and plot the result."),
  ]).map((question) => question.id);
  assert.deepEqual(kept, ["B", "D", "E"]);
});

test("a required formula the lesson plan calls malformed is a recorded erratum", async () => {
  // Live 2026-10-04 (telecom-1 lesson 2.1): the plan forbade reproducing
  // S13.P13.E1 while the formula gate demanded it verbatim.
  const { planFlaggedFormulaIds } = await import("../src/lib/learn.ts");
  const plan = { constraints: ["Keep units consistent."], steps: [],
    requiredCoverage: ["Explain modulation without reproducing the malformed time-varying carrier expression in S13.P13.E1.", "Derive S13.P14.E2 step by step."] };
  assert.deepEqual([...planFlaggedFormulaIds(plan, ["S13.P13.E1", "S13.P14.E2"])], ["S13.P13.E1"]);
});

test("a generated visual retries an upstream outage under a fresh owner, not other errors", async () => {
  // Live 2026-10-05: two server_is_overloaded replies failed a whole run.
  const { withUpstreamOverloadRetry } = await import("../src/lib/learn.ts");
  const seen = [];
  const value = await withUpstreamOverloadRetry(async (attempt) => {
    seen.push(attempt);
    if (attempt < 2) throw new Error("Generated-visual Council dispatch outcome is failed (request_failed)");
    return "ok";
  }, [0, 0, 0]);
  assert.equal(value, "ok");
  assert.deepEqual(seen, [0, 1, 2]);
  await assert.rejects(withUpstreamOverloadRetry(async () => { throw new Error("invalid visual spec"); }, [0]), /invalid visual spec/);
});

test("review findings cannot fight the verbatim source-formula rule", async () => {
  // Live 2026-10-05 (telecom-1 lesson 2.5).
  const { contradictsVerbatimFormulaRule } = await import("../src/lib/learn.ts");
  const required = [String.raw`g(t)=A_c e^{j\theta(t)}`];
  assert.equal(contradictsVerbatimFormulaRule({ code: "restated-idea", message: "same idea twice",
    evidence: ["$$\n" + String.raw`g(t)=A_c e^{j\theta(t)}` + "\n$$", "$$\n" + String.raw`g(t)=A_c e^{j\theta(t)}\qquad(5-81\mathrm{b})` + "\n$$"] }, required), true);
  assert.equal(contradictsVerbatimFormulaRule({ code: "restated-idea", message: "same idea twice",
    evidence: ["Prose one.", "Prose two."] }, required), false);
  assert.equal(contradictsVerbatimFormulaRule({ code: "broken-learning-sequence", message: "A malformed expression; remove it.",
    evidence: ["$$\n" + String.raw`g(t)=A_c e^{j\theta(t)}` + "\n$$"] }, required), true);
  assert.equal(contradictsVerbatimFormulaRule({ code: "unshown-result", message: "Show the derivation.",
    evidence: ["$$\n" + String.raw`g(t)=A_c e^{j\theta(t)}` + "\n$$"] }, required), false);
});

test("a repeated required display quoted with its lead-in prose is still the verbatim rule", async () => {
  const { contradictsVerbatimFormulaRule } = await import("../src/lib/learn.ts");
  const required = [String.raw`s(t)=x(t)\cos(w_c t)-y(t)\sin(w_c t)\tag{3}`];
  assert.equal(contradictsVerbatimFormulaRule({ code: "restated-idea", message: "same idea twice", evidence: [
    "That calculation produces\n\n$$\n" + String.raw`s(t)=x(t)\cos(w_c t)-y(t)\sin(w_c t)\tag{3}` + "\n$$",
    "Also written with spaces:\n\n$$\n" + String.raw`s(t) = x(t)\cos(w_c t) - y(t)\sin(w_c t) \tag{3}` + "\n$$",
  ] }, required), true);
});

test("a plan item preserving a formula without its transcription error flags it as an erratum", async () => {
  const { planFlaggedFormulaIds } = await import("../src/lib/learn.ts");
  const plan = { constraints: [], steps: [], requiredCoverage: ["Derive s(t). Preserve S7.P4.E5 without its transcription error."] };
  assert.deepEqual([...planFlaggedFormulaIds(plan, ["S7.P4.E5"])], ["S7.P4.E5"]);
});

test("a repetition complaint citing a required formula id is the verbatim rule, not a defect", async () => {
  // Live 2026-10-06 (telecom-1 lesson 3.3).
  const { contradictsVerbatimFormulaRule } = await import("../src/lib/learn.ts");
  assert.equal(contradictsVerbatimFormulaRule({ code: "teaching-contract",
    message: "The following display repeats the already established Cartesian/polar equality without adding a relation.",
    evidence: ["The same envelope relation appears with those settings written first (S16.P316.E3):"] }, [], ["S16.P316.E3"]), true);
  assert.equal(contradictsVerbatimFormulaRule({ code: "teaching-contract",
    message: "The following display repeats the equality.",
    evidence: ["Some unrelated sentence (S9.P1.E1):"] }, [], ["S16.P316.E3"]), false);
});

test("body beat headings become bold lead-ins outside code fences", async () => {
  const { demoteBodyBeatHeadings, bodyBeatHeadings } = await import("../src/lib/learn-utils.ts");
  const body = "Intro.\n\n### Allocate complete resource blocks\n\nText.\n\n```\n### not a heading\n```";
  const out = demoteBodyBeatHeadings(body);
  assert.deepEqual(bodyBeatHeadings(out), []);
  assert.match(out, /\*\*Allocate complete resource blocks\*\*/);
  assert.match(out, /### not a heading/);
});
