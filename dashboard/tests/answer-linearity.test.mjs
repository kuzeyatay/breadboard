import test from "node:test";
import assert from "node:assert/strict";
import {
  answerLinearityFindings,
  linearityRepairInstruction,
} from "../src/lib/hermes/answer-linearity.ts";
import { EXPLANATION_TURN_CONTRACT } from "../src/lib/hermes/explanation-turn.ts";

// The explanation that landed (EM1, 2026-09-17): one spine, no asides.
const LINEAR = [
  "An electric field exerts a direct push on an electric charge. A positive charge accelerates along the field, a negative charge against it, whether the charge moves or sits still.",
  "Consider a long straight wire on a bench. Positive nuclei stay locked in the lattice while conduction electrons drift through it.",
  "Place a positive test charge at rest beside the neutral wire and nothing happens. Give it a velocity along the wire and it is pushed straight away from the wire.",
  "In the laboratory frame the wire is neutral, and a neutral wire cannot push anything electrostatically. So where does the push come from?",
  "Ride alongside the charge. The ions now rush backwards, their spacing contracts, and the wire carries a net positive charge density in this frame: ordinary repulsion.",
  "Because the push depends on the velocity and acts at right angles to it, we call this velocity-dependent interaction the magnetic force.",
].join("\n\n");

// The merge that failed: written to the task, with editor notes and a link
// closing nearly every paragraph.
const INTERRUPTED = [
  "The drafts need two corrections before being used as textbook text: observers do not measure identical accelerations, and electron spin is not literal rotation.",
  "We have seen how an electric field inside a metal produces a slow drift of its electrons. This current also produces a magnetic field around the wire. [OpenStax](https://openstax.org/books/university-physics-volume-2/pages/12-2-magnetic-field-due-to-a-thin-straight-wire)",
  "For this experiment we use an idealised, infinitely long wire whose charge distributions cancel exactly in its rest frame, setting aside the battery and surface charges. [arXiv](https://arxiv.org/abs/1201.0918)",
  "(Visual: Show the same wire and positive test charge in two reference frames, exaggerating the spacing differences and labelling them not to scale.)",
  "Place a small positive test charge beside this wire, initially at rest relative to it, and treat it as having no magnetic properties of its own. [OpenStax](https://openstax.org/books/university-physics-volume-2/pages/11-2-magnetic-fields-and-lines)",
  "A uniformly positive, infinitely long wire produces an electric field pointing outward, so our positive test charge is repelled. [Feynman Lectures](https://www.feynmanlectures.caltech.edu/II_13.html)",
].join("\n\n");

test("an answer that keeps one line of reasoning has nothing to repair", () => {
  assert.deepEqual(answerLinearityFindings(LINEAR), []);
  assert.equal(linearityRepairInstruction([]), "");
});

test("task talk, illustrator notes and a link after every paragraph are found with their exact text", () => {
  const findings = answerLinearityFindings(INTERRUPTED);
  const codes = new Set(findings.map((finding) => finding.code));
  assert.ok(codes.has("process-talk"), JSON.stringify(findings));
  assert.ok(codes.has("stage-direction"));
  assert.ok(codes.has("citation-interruption"));
  const processTalk = findings.find((finding) => finding.code === "process-talk");
  assert.match(processTalk.quote, /The drafts need two corrections/);
  assert.ok(INTERRUPTED.includes(processTalk.quote), "the quote must be copied from the answer");
  const direction = findings.find((finding) => finding.code === "stage-direction");
  assert.match(direction.quote, /^\(Visual: Show the same wire/);
  const instruction = linearityRepairInstruction(findings);
  assert.match(instruction, /addresses the drafting task rather than the reader/);
  assert.match(instruction, /Offending text:/);
  assert.match(instruction, /never replace an offending line with a note about why it was removed/);
});

test("a single cited paragraph is not an interruption, and findings are bounded", () => {
  const oneCitation = `${LINEAR}\n\nThe standard treatment of this argument is Feynman's. [Feynman Lectures](https://www.feynmanlectures.caltech.edu/II_13.html)`;
  assert.deepEqual(answerLinearityFindings(oneCitation).filter((f) => f.code === "citation-interruption"), []);
  const repeated = Array.from({ length: 40 }, () => "The drafts need corrections here.").join("\n\n");
  assert.ok(answerLinearityFindings(repeated).length <= 12);
});

test("the writing contract states the spine rules the reviewer cannot enforce", () => {
  for (const rule of [
    /Fix one governing question before writing/,
    /one step per paragraph/,
    /Earn every name/,
    /Keep the line clear of interruptions/,
    /Write to the reader, never to the task/,
    /one spine that absorbs what serves it, never the union/,
    /Depth is reaching the last step, not length/,
  ]) {
    assert.match(EXPLANATION_TURN_CONTRACT, rule);
  }
});
