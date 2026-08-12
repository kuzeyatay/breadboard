import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  classifyMetaTask,
  cloneDesignStages,
  cloneRefinementOperators,
  cloneReasoningChain,
  cloneSolutionStructure,
  distillClonePrompt,
  metaPromptSection,
  metaPromptingDiagnostics,
  metaPromptingEnabled,
  metaPromptingRoot,
} from "../src/lib/hermes/meta-prompting.ts";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";

// The suite must exercise the shipped default regardless of the developer's
// environment; the disable path gets its own test below.
delete process.env.ENABLE_META_PROMPTING;

const decision = (overrides = {}) => ({
  mode: "knowledge",
  requestedOutcome: "answer the question",
  implementationRequired: false,
  decisionReason: "test",
  decisionSource: "breadboard_server_policy_v1",
  authorizedRoots: [],
  authorizedPathPatterns: [],
  allowedTools: [],
  allowedOperations: ["knowledge_work"],
  allowedCommandPatterns: [],
  selectedConditionalSkills: [],
  selectedConnections: [],
  createdAt: "2026-08-05T00:00:00.000Z",
  expiresAt: null,
  revokedAt: null,
  ...overrides,
});

const withEnv = (values, run) => {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

// --- the clone is a live dependency, not a citation ------------------------

test("the meta-prompting clone resolves and every parsed asset is present", () => {
  const diagnostics = metaPromptingDiagnostics();
  assert.equal(
    path.basename(diagnostics.root),
    "meta-prompting",
    "the clone must resolve against the repository root",
  );
  assert.deepEqual(
    diagnostics.assets,
    {
      crAgent: true,
      icpd: true,
      refineReasoning: true,
      refineConcise: true,
      mathStructure: true,
    },
    "a missing asset means the scaffold silently fell back to embedded text",
  );
  assert.equal(diagnostics.live, true);
});

test("the reasoning chain is parsed out of the clone, not hardcoded", () => {
  assert.deepEqual(cloneReasoningChain(), [
    "Question",
    "AnswerSketch",
    "Code",
    "Output",
    "Answer",
  ]);
});

test("the in-context prompt design stages come from the clone's LaTeX figure", () => {
  const stages = cloneDesignStages();
  assert.ok(stages.includes("Document Analysis"));
  assert.ok(stages.includes("Task Interpretation"));
  assert.ok(stages.includes("Prompt Design"));
  assert.ok(stages.includes("Output Prompt"));
});

test("both refinement operators are parsed from the clone", () => {
  const operators = cloneRefinementOperators();
  assert.ok(
    operators.reasoning.some((item) => /multi-step reasoning/i.test(item)),
    `expected the reasoning operator, got ${JSON.stringify(operators.reasoning)}`,
  );
  assert.ok(
    operators.concise.some((item) => /extraneous or non-essential/i.test(item)),
    `expected the simplification operator, got ${JSON.stringify(operators.concise)}`,
  );
});

test("only the operators' instructions are collected, not the figure's framing", () => {
  const operators = cloneRefinementOperators();
  for (const item of [...operators.reasoning, ...operators.concise]) {
    assert.doesNotMatch(
      item,
      /^(Input Prompt|Objective|Original Prompt|Goal|Outcome|Expected Outcome|Key Elements)/,
      `"${item}" is a label from the figure, not an instruction`,
    );
    assert.doesNotMatch(item, /\[.*\]/, `"${item}" still carries a template slot`);
  }
  assert.equal(operators.reasoning.length, 3);
  assert.equal(operators.concise.length, 5);
});

test("the solution structure keeps the paper's boxed final answer", () => {
  assert.ok(cloneSolutionStructure().some((step) => /boxed/.test(step)));
});

test("distilling a tcolorbox prompt leaves instructions and no LaTeX", () => {
  const lines = distillClonePrompt(
    [
      "```tex",
      "\\begin{tcolorbox}[width=0.95\\textwidth,colback=gray!2!white]",
      "\\begin{itemize}",
      "\\item \\textbf{Goal:} Transform the original prompt.",
      "\\end{itemize}",
      "\\end{tcolorbox}",
      "```",
    ].join("\n"),
  );
  assert.deepEqual(lines, ["- Goal: Transform the original prompt."]);
});

test("a missing clone degrades to embedded structures instead of throwing", () => {
  withEnv({ META_PROMPTING_DIR: path.join(metaPromptingRoot(), "does-not-exist") }, () => {
    assert.equal(metaPromptingDiagnostics().live, false);
    assert.deepEqual(cloneReasoningChain(), [
      "Question",
      "AnswerSketch",
      "Code",
      "Output",
      "Answer",
    ]);
    const section = metaPromptSection({
      userText: "Calculate the expected value of the payout for this bet.",
      surface: "dashboard_terminal",
      decision: decision(),
    });
    assert.match(section, /# meta_prompt/);
  });
});

// --- classification ---------------------------------------------------------

test("representative turns land in the right task category", () => {
  const cases = [
    ["Calculate the probability that at least two of the twelve share a birthday.", "quantitative_reasoning"],
    ["The garden build keeps failing with a traceback about a missing anchor id.", "technical_diagnosis"],
    ["Implement a retry with backoff around the upstream fetch in the router.", "implementation"],
    ["Summarize what my sources say about spaced repetition and cite the pages.", "research_synthesis"],
    ["Rewrite this prompt so the model reasons more carefully before answering.", "prompt_design"],
    ["Should I use SQLite or Postgres for the artifact store, and why?", "decision_analysis"],
    ["Give me a roadmap for shipping the desktop build by the end of the month.", "planning"],
    ["Explain what a functor is and how it differs from a plain function.", "explanation"],
    ["List every file that still imports the old capability broker.", "extraction"],
    ["Write a short announcement post about the new calendar feature.", "authoring"],
  ];
  for (const [text, expected] of cases) {
    const classification = classifyMetaTask({
      userText: text,
      surface: "dashboard_terminal",
      decision: decision(),
    });
    assert.equal(
      classification.category,
      expected,
      `"${text}" classified as ${classification.category} (${classification.signals.join(", ")})`,
    );
  }
});

test("a prompt-writing request about maths is prompt design, not maths", () => {
  const classification = classifyMetaTask({
    userText: "Write a system prompt that makes the model solve probability problems carefully.",
    surface: "dashboard_terminal",
    decision: decision(),
  });
  assert.equal(classification.category, "prompt_design");
});

test("an authorized write turn is an implementation turn whatever the wording", () => {
  const classification = classifyMetaTask({
    userText: "Could you take care of the thing we discussed in the router file please?",
    surface: "dashboard_terminal",
    decision: decision({ mode: "scoped_implementation", implementationRequired: true }),
  });
  assert.equal(classification.category, "implementation");
  assert.ok(classification.signals.includes("scoped_implementation_decision"));
});

test("trivial turns pay nothing for the machinery", () => {
  for (const text of ["hi", "thanks!", "ok", "", "  ", "sure"]) {
    const classification = classifyMetaTask({
      userText: text,
      surface: "dashboard_terminal",
      decision: decision(),
    });
    assert.equal(classification.category, "general", `"${text}" should not be scaffolded`);
    assert.equal(
      metaPromptSection({ userText: text, surface: "dashboard_terminal", decision: decision() }),
      null,
    );
  }
});

test("an unrecognized task gets no scaffold rather than a generic one", () => {
  assert.equal(
    metaPromptSection({
      userText: "Any thoughts on the weather in Eindhoven this weekend?",
      surface: "garden_chat",
      decision: decision(),
    }),
    null,
  );
});

// --- the rendered scaffold --------------------------------------------------

test("the scaffold carries a signature, a procedure, and a check that can fail", () => {
  const section = metaPromptSection({
    userText: "Derive the closed form for the sum and compute it for n = 40.",
    surface: "dashboard_terminal",
    decision: decision(),
  });
  assert.match(section, /^# meta_prompt/m);
  assert.match(section, /Task category: quantitative_reasoning/);
  assert.match(section, /Signature: .+->.+/);
  assert.match(section, /Procedure, filled in order before you answer:/);
  assert.match(section, /Verification: /);
  assert.match(section, /Output contract: /);
  assert.match(section, /Question -> AnswerSketch -> Code -> Output -> Answer/);
});

test("the scaffold never asks a surface to run code it cannot run", () => {
  const grounded = metaPromptSection({
    userText: "Derive the closed form for the sum and compute it for n = 40.",
    surface: "garden_chat",
    decision: decision(),
  });
  assert.match(grounded, /Question -> AnswerSketch -> Answer/);
  assert.match(grounded, /You cannot execute code on this surface/);
  assert.doesNotMatch(grounded, /-> Code ->/);
});

test("the scaffold stays internal and grants nothing", () => {
  const section = metaPromptSection({
    userText: "Should I move the scheduler into the desktop supervisor or leave it in the dashboard?",
    surface: "dashboard_terminal",
    decision: decision(),
  });
  assert.match(section, /Do not print its slot names/);
  assert.match(section, /does not override `response_style`|not let it override `response_style`/);
  assert.match(section, /grants no capability/);
});

test("the recursion is innate: a misfitting frame is repaired, not reported", () => {
  const section = metaPromptSection({
    userText: "Explain how the anchor replacement graph decides which references to heal.",
    surface: "dashboard_terminal",
    decision: decision(),
  });
  assert.match(section, /repair it in one pass/);
});

// --- composition into every Hermes surface ---------------------------------

test("the meta prompting discipline ships on every surface and mode", () => {
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    for (const mode of ["knowledge", "technical_read", "scoped_implementation"]) {
      const system = composeHermesSystemPrompt({
        surface,
        decision: decision({ mode }),
        userText: "hi",
      });
      assert.match(
        system,
        /# meta_prompting/,
        `${surface}/${mode} lost the meta prompting discipline`,
      );
      assert.doesNotMatch(
        system,
        /# meta_prompt\n/,
        `${surface}/${mode} scaffolded a trivial turn`,
      );
    }
  }
});

test("the per-turn scaffold reaches the composed system prompt", () => {
  const system = composeHermesSystemPrompt({
    surface: "garden_chat",
    decision: decision(),
    userText: "Summarize what my sources say about interleaving and cite the pages.",
    additional: "# garden_context\nActive garden: study.",
  });
  assert.match(system, /# meta_prompt\nTask category: research_synthesis/);
  // The frame is read after the policy record and before the evidence.
  assert.ok(
    system.indexOf("# server_capability_decision") <
      system.indexOf("# meta_prompt\nTask category"),
  );
  assert.ok(
    system.indexOf("# meta_prompt\nTask category") < system.indexOf("# garden_context"),
  );
});

test("omitting the turn text degrades to the discipline with no scaffold", () => {
  const system = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision: decision(),
  });
  assert.match(system, /# meta_prompting/);
  assert.doesNotMatch(system, /# meta_prompt\nTask category/);
});

test("ENABLE_META_PROMPTING=0 removes both halves", () => {
  withEnv({ ENABLE_META_PROMPTING: "0" }, () => {
    assert.equal(metaPromptingEnabled(), false);
    const system = composeHermesSystemPrompt({
      surface: "dashboard_terminal",
      decision: decision(),
      userText: "Calculate the expected value of the payout for this bet.",
    });
    assert.doesNotMatch(system, /# meta_prompting/);
    assert.doesNotMatch(system, /# meta_prompt/);
  });
  assert.equal(metaPromptingEnabled(), true);
});

test("the shipped prompt text obeys the repository's own response style", () => {
  const section = metaPromptSection({
    userText: "Write a short announcement post about the new calendar feature.",
    surface: "dashboard_terminal",
    decision: decision(),
  });
  assert.doesNotMatch(section, /—/, "the em dash is banned in Breadboard prose");
  const system = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision: decision(),
    userText: "hi",
  });
  const discipline = system.slice(system.indexOf("# meta_prompting"));
  assert.doesNotMatch(
    discipline.slice(0, discipline.indexOf("\n# ") + 1 || undefined),
    /—/,
  );
});
