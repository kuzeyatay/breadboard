import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as pedagogy from "../src/lib/learn-pedagogy.ts";
import { buildFinalGardenState } from "../src/lib/final-garden-state.ts";
import {
  buildCriticReviewPacket,
  criticIssuesToRepairRequests,
  makeCriticArtifactRepair,
  verifyCriticIssueAgainstFinalState,
} from "../src/lib/critic-loop.ts";
import { createLearnFinalCriticProviders } from "../src/lib/learn-final-critic.ts";

/** Evaluate the actual prompt declarations without booting Learn's database or
 * provider runtime. This catches a missing interpolation in a page variant. */
function evaluateLearnPrompts() {
  const source = fs.readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("learn.ts", source, ts.ScriptTarget.Latest, true);
  const names = [
    "LEARNER_VOICE_RULES", "TITLE_RULES", "SCOPE_CONTRACT_PROMPT", "TOPIC_MAP_PROMPT",
    "OVERVIEW_PROMPT", "DEPTH_RULES", "ANTI_AIISM_RULES", "PLACEHOLDER_FREE_PROSE_RULES",
    "SUBSECTION_PROMPT", "SUBSECTION_REPAIR_PROMPT",
  ];
  const declarations = ast.statements.filter((node) => ts.isVariableStatement(node)
    && node.declarationList.declarations.some((declaration) => names.includes(declaration.name.getText(ast))));
  return vm.runInNewContext(
    declarations.map((node) => node.getText(ast)).join("\n") + `\n({${names.join(",")}})`,
    { ...pedagogy },
  );
}

test("every Learn authoring prompt receives the shared teaching requirements, including the overview", () => {
  const prompts = evaluateLearnPrompts();
  for (const name of ["OVERVIEW_PROMPT", "SUBSECTION_PROMPT", "SUBSECTION_REPAIR_PROMPT"]) {
    assert.ok(prompts[name].includes(pedagogy.LEARN_FOUNDATION_RULES), name);
    assert.match(prompts[name], /Any expectedWordRange, including one from an existing plan, is advisory/, name);
    assert.doesNotMatch(prompts[name], /under.*1100/, name);
  }
  for (const name of ["SUBSECTION_PROMPT", "SUBSECTION_REPAIR_PROMPT"]) {
    assert.match(prompts[name], /at least 1400 words of real explanatory prose, with no upper word limit/, name);
  }
  for (const name of ["SCOPE_CONTRACT_PROMPT", "TOPIC_MAP_PROMPT"]) {
    assert.ok(prompts[name].includes(pedagogy.LEARN_FOUNDATION_PLANNING_RULES), name);
    assert.ok(prompts[name].includes(pedagogy.LEARN_LENGTH_PLANNING_RULES), name);
    assert.doesNotMatch(prompts[name], /"expectedWordRange":\s*\[700,\s*1100\]/, name);
  }
  assert.doesNotMatch(prompts.OVERVIEW_PROMPT, /at least.*1400 words/);
});

test("writers, planners, and the critic all hold the course to one line of reasoning with how, why, and where-from", () => {
  // Writer-side: the shared foundation rules carry the depth requirements, so
  // every page prompt and the critic inherit them through the interpolation
  // checked above.
  const prompts = evaluateLearnPrompts();
  const rules = pedagogy.LEARN_FOUNDATION_RULES;
  assert.match(rules, /Teach one line of reasoning/);
  assert.match(rules, /before "electromagnetism" the reader meets charge/);
  assert.match(rules, /If a page cannot afford to explain a term, it cannot afford to use it/);
  assert.match(rules, /how it works .*why it is so or why it was needed .*where it comes from/);
  assert.match(rules, /Use origins when they carry meaning/);
  assert.match(rules, /no invented dates, attributions, or anecdotes/);
  assert.match(rules, /Depth before breadth/);
  assert.match(rules, /The assigned material is the floor, not the ceiling/);
  assert.match(rules, /`> \[!info\]` callout marked as beyond this course's material/);
  assert.match(rules, /never a formula, number, or derivation the sources do not carry/);
  // Source grounding is narrowed to what the lesson asserts, not abolished.
  assert.match(rules, /Stay within the supported source scope for everything the lesson asserts/);

  const planning = pedagogy.LEARN_FOUNDATION_PLANNING_RULES;
  assert.match(planning, /Plan one line of reasoning, not a table of contents/);
  assert.match(planning, /"Work, Potential, Energy, and Current"/);
  assert.match(planning, /starts from the most elementary observable thing/);
  assert.match(planning, /one assigned section as roughly one conceptual move/);

  const review = pedagogy.LEARN_FOUNDATION_REVIEW_RULES;
  assert.match(review, /never given its mechanism, its reason .*, or its origin/);
  assert.match(review, /"electromagnetism" before charge, electric effect, and magnetic effect/);
  assert.match(review, /are permitted orientation, not source gaps/);
  // Length is governed by substance in both directions: no padding to a
  // target, and restatement is flagged for removal rather than tolerated.
  assert.match(review, /Report restatement as a warning-severity "other" issue/);
  assert.match(review, /asking for its removal, not its rewording/);
  assert.match(rules, /never compress to meet a word count or reading-time target/);
  // Intuition and logic precede mathematics; Feynman-style explanation is the
  // endorsed mode, and the critic reports an equation that arrives first.
  assert.match(rules, /Intuition and logic come before mathematics, every time/);
  assert.match(rules, /they could guess its form/);
  assert.match(rules, /Explain the way Feynman explained/);
  assert.match(review, /a formula that introduces an idea rather than confirming one/);
  assert.match(review, /Report contrastive-negation teaching/);
  // Every prompt that produces learner-facing prose carries the banned-pattern
  // block, including the overview and the planner's section purposes.
  for (const name of ["OVERVIEW_PROMPT", "TOPIC_MAP_PROMPT", "SUBSECTION_PROMPT", "SUBSECTION_REPAIR_PROMPT"]) {
    assert.ok(prompts[name].includes(prompts.ANTI_AIISM_RULES), `${name} carries ANTI_AIISM_RULES`);
  }
  assert.match(prompts.ANTI_AIISM_RULES, /"merely", "simply put"/);
  assert.match(prompts.ANTI_AIISM_RULES, /a person would say to a student across a table/);

  const source = fs.readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");
  assert.match(source, /\\`> \[!info\]\\` for one connection beyond this course's material/);
  assert.match(source, /Three or more comma-separated topics in a title is a planning error/);
  assert.doesNotMatch(source, /Good: [^\n]*"Accuracy, Latency, Energy, and Spike Count"/);
});

test("a topic-list title is sent back to the planner as a unit to split", async () => {
  const { topicListTitleProblem } = await import("../src/lib/learn-utils.ts");
  const source = fs.readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");
  assert.match(source, /modelAuthoredUnitTitleProblems\(learningUnits, publishedLearningUnitIds\)/);
  assert.match(source, /if \(publishedUnitIds\.has\(unit\.id\)\) continue;/);
  assert.match(topicListTitleProblem("Work, Potential, Energy, and Current"), /lists 4 topics/);
  assert.match(topicListTitleProblem("4. Gradient, Divergence, Curl, and Integral Theorems"), /split it into the units it hides/);
  assert.match(topicListTitleProblem("Materials, Interfaces, and Capacitors"), /lists 3 topics/);
  assert.equal(topicListTitleProblem("The Leaky Integrate-and-Fire Neuron"), null);
  assert.equal(topicListTitleProblem("Charge, and What It Does at a Distance"), null);
  assert.equal(topicListTitleProblem("How Accuracy, Latency, and Energy Trade Off"), null);
  assert.equal(topicListTitleProblem("Why Gauss's Law Needs Symmetry"), null);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-learn-foundations-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("bb-learn-foundations-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(dir, ".breadboard"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Foundations"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), "{}");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]");
  const write = (rel, body, lesson = false) => {
    const markdown = `---\ntitle: "Foundations"\nknowledge_type: "${lesson ? "learning-page" : "topic-overview"}"\ngenerated_by: "learn_button"\n${lesson ? 'learningUnitId: "U1"\nsourceAnchors: []\nsourceFormulaAnchors: []\ntags: []\n' : ""}---\n\n${body}\n`;
    fs.writeFileSync(path.join(dir, rel), markdown);
    return markdown;
  };
  return { dir, write };
}

test("the final critic sees complete overview, map, root index, section and lesson prose", (t) => {
  const { dir, write } = fixture(t);
  fs.mkdirSync(path.join(dir, ".breadboard", "planning"));
  const scope = "Entry level: the learner explicitly states they can differentiate polynomials.\n";
  fs.writeFileSync(path.join(dir, ".breadboard", "planning", "Scope Contract.md"), scope);
  const longBody = "A reader can follow an explanation only from what has already been established. ".repeat(40)
    + "A term introduced at the end still needs its meaning explained.";
  for (const rel of ["learning/Topic Overview.md", "learning/Learning Map.md", "learning/_index.md", "learning/1. Foundations/_index.md"]) {
    write(rel, longBody);
  }
  const pagePath = "learning/1. Foundations/1.1 Concepts.md";
  write(pagePath, longBody, true);
  const packet = buildCriticReviewPacket(buildFinalGardenState(dir, "foundations"));
  assert.equal(packet.scopeContract.text, scope);
  assert.equal(packet.scopeContract.packetTruncated, false);
  assert.deepEqual(packet.orientationPages.map((page) => page.path).sort(), [
    "learning/Learning Map.md", "learning/Topic Overview.md", "learning/_index.md",
  ].sort());
  for (const page of packet.orientationPages) {
    assert.equal(page.bodyText.text.trim(), longBody);
    assert.equal(page.bodyText.packetTruncated, false);
  }
  const section = packet.sections.find((entry) => entry.pages.some((page) => page.path === pagePath));
  assert.equal(section.indexExcerpt.packetTruncated, true);
  assert.equal(section.indexBodyText.text.trim(), longBody);
  assert.equal(section.indexBodyText.packetTruncated, false);
  assert.equal(section.pages[0].bodyText.text.trim(), longBody);
});

// These are scripted semantic verdicts, not an evaluation of a live model's
// teaching quality. They prove each generic failure can reach a model repair
// and that the next review receives the repaired artifact, including overviews.
for (const example of [
  {
    path: "learning/Topic Overview.md", target: "unit_page",
    bad: "Bayesian updating converts a prior into a posterior.",
    good: "Start with an estimate before seeing new evidence. Revise that estimate using what the evidence tells you. The starting estimate is called a prior; the revised estimate is called a posterior. This process is Bayesian updating.",
  },
  {
    path: "learning/1. Foundations/_index.md", target: "section_index",
    bad: "An enzyme catalyses a reaction through catalysis.",
    good: "Some changes between substances happen very slowly. An enzyme is a molecule that helps a particular change happen faster without being used up by it. Speeding up a reaction this way is called catalysis.",
  },
  {
    path: "learning/1. Foundations/1.1 Concepts.md", target: "unit_page", lesson: true,
    bad: "Doubling the side simply quadruples the area.",
    good: "Picture a square made of tiles. Doubling its side doubles the number of tiles in each row and also doubles the number of rows. There are twice as many rows with twice as many tiles in each, so the area is four times as large.",
  },
]) {
  test(`explanation gaps receive focused model repair and re-review: ${example.path}`, async (t) => {
    const { dir, write } = fixture(t);
    const original = write(example.path, example.bad, example.lesson);
    const otherPath = "learning/Learning Map.md";
    const untouched = write(otherPath, "Read the introduction, then the first lesson.");
    const issue = {
      id: "missing-foundation", type: "explanation_gap", severity: "blocking",
      ...(example.target === "section_index" ? { sectionPath: example.path } : { pagePath: example.path }),
      repairTarget: example.target, problem: "The claim relies on a meaning or reasoning step that has not been taught.",
      evidence: example.bad, expected: "Explain the missing foundation before relying on it.",
      suggestedRepair: "Add a concrete plain-language explanation of the missing step.",
    };
    const calls = [];
    const providers = createLearnFinalCriticProviders({
      execute: async (request) => {
        calls.push(request);
        assert.ok(request.system.includes(pedagogy.LEARN_FOUNDATION_RULES));
        if (request.kind === "critic") {
          assert.ok(request.system.includes(pedagogy.LEARN_FOUNDATION_REVIEW_RULES));
          return { content: JSON.stringify({ issues: request.user.includes(example.bad) ? [issue] : [] }) };
        }
        assert.equal(request.kind, "model_repair");
        assert.ok(request.user.includes(example.bad));
        return { content: original.replace(example.bad, example.good) };
      },
    });
    const before = buildFinalGardenState(dir, "foundations");
    const issues = await providers.critic(buildCriticReviewPacket(before));
    assert.equal(issues.length, 1);
    assert.equal(verifyCriticIssueAgainstFinalState(issues[0], before).severity, "confirmed_blocking");
    const repair = makeCriticArtifactRepair({ modelRepair: providers.modelRepair, deterministicFinalize: () => {} });
    const result = await repair(dir, "foundations", criticIssuesToRepairRequests(issues), {
      round: 1, issuesById: new Map(issues.map((entry) => [entry.id, entry])),
    });
    assert.ok(result.provenance.some((entry) => entry.executorUsed === "model" && entry.changed));
    assert.equal(fs.readFileSync(path.join(dir, example.path), "utf8"), original.replace(example.bad, example.good));
    assert.equal(fs.readFileSync(path.join(dir, otherPath), "utf8"), untouched);
    assert.deepEqual(await providers.critic(buildCriticReviewPacket(buildFinalGardenState(dir, "foundations"))), []);
    assert.deepEqual(calls.map((call) => call.kind), ["critic", "model_repair", "critic"]);
  });
}
