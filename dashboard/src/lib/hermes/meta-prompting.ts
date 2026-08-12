// Meta Prompting, made innate to every Hermes turn.
//
// Meta Prompting (Zhang & Parkes, arXiv:2311.11482, ICLR 2024 BGPT workshop;
// cloned at <repo>/meta-prompting) replaces content-rich few-shot examples with
// a single example-agnostic scaffold: the *shape* a correct answer for a task
// category must have. The paper models it as a functor from a category of tasks
// to a category of prompts, which is the formal way of saying the structure is
// chosen by task type and composes when a task decomposes.
//
// Two halves make it innate here:
//   1. `hermes-config/system/meta-prompting.md` is a permanent system section on
//      every surface (see `composeHermesSystemPrompt`). It teaches the discipline
//      and the recursion: derive or repair the structure, then answer under it.
//   2. This module picks the structure per turn. `classifyMetaTask` reads the
//      user's newest message plus the surface and the server capability decision,
//      and `metaPromptSection` renders the matching scaffold as a `meta_prompt`
//      system section. No match means no section, so trivial turns stay cheap.
//
// The clone is a live dependency, not a citation. The four categories the paper
// actually supplies prompts for (quantitative reasoning, prompt design, and the
// two prompt-refinement operators) are parsed out of `meta-prompting/prompts/`
// and `meta-prompting/Math/prompts/` at request time and rendered into the
// scaffold, so editing the clone changes what Hermes does. Embedded fallbacks
// keep turns working if the clone is missing; `metaPromptingDiagnostics()`
// reports which source was actually used.
//
// The scaffolds for the categories the paper does not cover are first-party,
// written to the same signature/procedure/verification discipline.

import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import type { HermesSurface } from "./config.ts";
import type { CapabilityDecision } from "./capability-policy.ts";

export type MetaTaskCategory =
  | "quantitative_reasoning"
  | "technical_diagnosis"
  | "implementation"
  | "research_synthesis"
  | "prompt_design"
  | "decision_analysis"
  | "planning"
  | "explanation"
  | "extraction"
  | "authoring"
  | "general";

/** Ties break toward the more specific category, so order matters. */
export const META_TASK_PRIORITY: readonly MetaTaskCategory[] = [
  "prompt_design",
  "quantitative_reasoning",
  "technical_diagnosis",
  "implementation",
  "extraction",
  "decision_analysis",
  "planning",
  "research_synthesis",
  "authoring",
  "explanation",
  "general",
] as const;

export interface MetaTaskClassification {
  category: MetaTaskCategory;
  score: number;
  signals: string[];
}

export interface MetaPromptInput {
  userText: string | undefined | null;
  surface: HermesSurface;
  decision?: Pick<CapabilityDecision, "mode" | "allowedOperations"> | null;
}

export function metaPromptingEnabled(): boolean {
  const raw = process.env.ENABLE_META_PROMPTING?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

// --- the clone --------------------------------------------------------------

export function metaPromptingRoot(): string {
  const configured = process.env.META_PROMPTING_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(repositoryRoot(), "meta-prompting");
}

const CLONE_FILES = {
  crAgent: ["prompts", "cr-agent-assistant-v0.1.md"],
  icpd: ["prompts", "mp-icpd-v0.2.md"],
  refineReasoning: ["prompts", "mp-pt-reasoning-v0.1.md"],
  refineConcise: ["prompts", "mp-pt-concise-v0.1.md"],
  mathStructure: ["Math", "prompts", "mp", "math.md"],
} as const;

type CloneAsset = keyof typeof CLONE_FILES;

interface CachedAsset {
  mtimeMs: number;
  text: string;
}

// Keyed by resolved path, not by asset name, so pointing META_PROMPTING_DIR at
// a different checkout cannot be served a stale read.
const assetCache = new Map<string, CachedAsset>();

/**
 * Reads a clone asset, re-reading whenever the file's mtime changes so a
 * `git pull` of the clone takes effect without restarting the dashboard.
 * Returns null when the clone is absent, which is the fallback path.
 */
function readCloneAsset(asset: CloneAsset): string | null {
  const file = path.join(metaPromptingRoot(), ...CLONE_FILES[asset]);
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    assetCache.delete(file);
    return null;
  }
  const cached = assetCache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.text;
  try {
    const text = fs.readFileSync(file, "utf8");
    assetCache.set(file, { mtimeMs, text });
    return text;
  } catch {
    assetCache.delete(file);
    return null;
  }
}

/**
 * The paper's prompts are LaTeX `tcolorbox` figures. This strips the figure
 * machinery and leaves the instruction text, so the structure the authors wrote
 * survives but nothing LaTeX-shaped reaches the model.
 */
export function distillClonePrompt(raw: string): string[] {
  const lines: string[] = [];
  for (const original of raw.split(/\r?\n/)) {
    let line = original.trim();
    if (!line) continue;
    if (line.startsWith("```")) continue;
    if (/^\\(begin|end)\{/.test(line)) continue;
    if (/^\\end\{/.test(line)) continue;
    const isItem = /^\\item\b/.test(line);
    line = line.replace(/^\\item\s*/, "");
    line = line.replace(/\\text(bf|it|sf|tt)\{([^{}]*)\}/g, "$2");
    line = line.replace(/\\(?:emph|mbox)\{([^{}]*)\}/g, "$1");
    line = line.replace(/\\[a-zA-Z]+(\[[^\]]*\])?(\{[^{}]*\})?/g, "");
    line = line.replace(/[{}]/g, "").replace(/\\_/g, "_").trim();
    if (!line) continue;
    lines.push(isItem ? `- ${line}` : line);
  }
  return lines;
}

/**
 * The paper's central sequence for decomposed reasoning, written in its prompts
 * as `[Question] -> [AnswerSketch] -> [Code] -> [Output] -> [Answer]`.
 */
export function cloneReasoningChain(): string[] {
  const raw = readCloneAsset("crAgent");
  if (raw) {
    const line = raw
      .split(/\r?\n/)
      .find((candidate) => /\]\s*->\s*\[/.test(candidate));
    if (line) {
      const stages = [...line.matchAll(/\[([A-Za-z][A-Za-z ]*)\]/g)].map((match) =>
        match[1].trim(),
      );
      if (stages.length >= 3) return stages;
    }
  }
  return ["Question", "AnswerSketch", "Code", "Output", "Answer"];
}

/** The stage names of Meta Prompting for In-Context Prompt Design. */
export function cloneDesignStages(): string[] {
  const raw = readCloneAsset("icpd");
  if (raw) {
    // Stage names are the top-level labelled lines of the figure. The nested
    // `- Input:` / `- Objective:` lines are their glosses, and the figure's own
    // `Task:` header names the whole thing rather than a stage.
    const stages = distillClonePrompt(raw)
      .filter((line) => !line.startsWith("- "))
      .map((line) => /^([A-Z][A-Za-z ()\-]{2,}):/.exec(line)?.[1]?.trim() ?? "")
      .filter((name) => name.length > 3 && name.toLowerCase() !== "task");
    if (stages.length >= 3) return stages;
  }
  return [
    "Document Analysis",
    "Task Interpretation",
    "Prompt Design",
    "Optional - Direct Solution Proposal",
    "Output Prompt",
  ];
}

/**
 * Both figures are built the same way: a labelled heading introduces the
 * operator's actual instructions, and everything else around it is framing
 * ("Input Prompt: [input prompt]", "Expected Outcome:"). Only the items under
 * the heading are instructions, so only those are collected.
 */
function itemsUnderHeading(raw: string | null, heading: RegExp): string[] {
  if (!raw) return [];
  const lines = distillClonePrompt(raw);
  const start = lines.findIndex(
    (line) => heading.test(line) && /:$/.test(line.replace(/^- /, "")),
  );
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("- ")) break;
    const item = line.slice(2).trim();
    // A labelled item ("Outcome: ...", "Expected Outcome:") closes the list of
    // instructions and starts framing again.
    if (/:$/.test(item) || /^[A-Z][A-Za-z ]{2,}:\s/.test(item)) break;
    if (item.length < 12 || /^\[.*\]$/.test(item)) continue;
    items.push(item);
  }
  return items;
}

/** The two refinement operators the paper defines over an existing prompt. */
export function cloneRefinementOperators(): { reasoning: string[]; concise: string[] } {
  const reasoning = itemsUnderHeading(
    readCloneAsset("refineReasoning"),
    /key elements/i,
  );
  const concise = itemsUnderHeading(
    readCloneAsset("refineConcise"),
    /instructions for transformation/i,
  );
  return {
    reasoning: reasoning.length
      ? reasoning
      : [
          "Integrate complex problem-solving elements.",
          "Embed multi-step reasoning processes.",
          "Incorporate scenarios challenging conventional thinking.",
        ],
    concise: concise.length
      ? concise
      : [
          "Maintain the primary purpose and objectives of the original prompt.",
          "Focus on distilling the prompt to include only key instructions and essential information.",
          "Eliminate any extraneous or non-essential details.",
        ],
  };
}

/** The paper's answer structure for a mathematical result. */
export function cloneSolutionStructure(): string[] {
  const raw = readCloneAsset("mathStructure");
  if (raw) {
    const steps = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^\d+\.\s+\S/.test(line))
      .map((line) => line.replace(/^\d+\.\s+/, ""));
    if (steps.length >= 2) return steps;
  }
  return [
    "Follow with the reasoning steps, ensuring the solution process is broken down clearly and logically.",
    "End the solution with the final answer encapsulated in a LaTeX-formatted box, $\\boxed{...}$, for clarity and emphasis.",
  ];
}

export function metaPromptingDiagnostics(): {
  root: string;
  assets: Record<CloneAsset, boolean>;
  live: boolean;
} {
  const assets = {} as Record<CloneAsset, boolean>;
  for (const asset of Object.keys(CLONE_FILES) as CloneAsset[]) {
    assets[asset] = readCloneAsset(asset) !== null;
  }
  return {
    root: metaPromptingRoot(),
    assets,
    live: Object.values(assets).every(Boolean),
  };
}

// --- classification ---------------------------------------------------------

interface CategoryRule {
  category: MetaTaskCategory;
  weight: number;
  signal: string;
  pattern: RegExp;
}

const RULES: readonly CategoryRule[] = [
  // Prompt design is checked first because a request to write a prompt about
  // maths is a prompt-design task, not a maths task.
  {
    category: "prompt_design",
    weight: 5,
    signal: "prompt_rewrite",
    pattern: /\b(rewrite|revise|improve|tighten|shorten|sharpen|refine)\b[^.?!]{0,40}\bprompt\b/,
  },
  {
    category: "prompt_design",
    weight: 4,
    signal: "prompt_authoring",
    pattern: /\b(system prompt|meta.?prompt|prompt template|write (me )?a prompt|prompt for (the |a |an )?(model|agent|llm)|skill\.md|instructions for (the |a |an )?(model|agent|llm))\b/,
  },
  {
    category: "quantitative_reasoning",
    weight: 4,
    signal: "math_notation",
    pattern: /(\\frac|\\sqrt|\\int|\\sum|\\boxed|\$\$)/,
  },
  {
    category: "quantitative_reasoning",
    weight: 3,
    signal: "quantitative_verb",
    pattern: /\b(calculate|compute|derive|integrate|differentiate|prove|solve for|how many|how much|what percentage|probability|expected value|variance|standard deviation|eigenvalue|factorial|modulo)\b/,
  },
  {
    category: "quantitative_reasoning",
    weight: 2,
    signal: "arithmetic",
    pattern: /\b\d+(\.\d+)?\s*[+\-*/^]\s*\d/,
  },
  {
    category: "quantitative_reasoning",
    weight: 2,
    signal: "measurement",
    pattern: /\b(units?|dimensional analysis|significant figures|order of magnitude|estimate the)\b/,
  },
  {
    category: "technical_diagnosis",
    weight: 4,
    signal: "failure_report",
    pattern: /\b(traceback|stack ?trace|exception|segfault|500 error|error message|does ?n['’]?t work|not working|keeps failing|is failing|is broken|crashes|regression|flaky)\b/,
  },
  {
    category: "technical_diagnosis",
    weight: 3,
    signal: "diagnosis_verb",
    pattern: /\b(debug|diagnose|root cause|why (is|are|does|do|did|isn['’]?t|doesn['’]?t|won['’]?t)|reproduce the|track down)\b/,
  },
  {
    category: "implementation",
    weight: 3,
    signal: "implementation_verb",
    pattern: /\b(implement|refactor|patch|migrate|wire (it|this|them) up|add (a |an |the )?(feature|endpoint|function|component|test|migration)|write (the |a |an )?(code|function|component|script|test))\b/,
  },
  {
    category: "research_synthesis",
    weight: 3,
    signal: "synthesis_verb",
    pattern: /\b(summari[sz]e|synthesi[sz]e|literature|state of the art|what do (my|the) (sources|documents|papers)|across (my|the|these) (documents|sources|notes|pages)|cite|according to (my|the) (sources|documents))\b/,
  },
  {
    category: "decision_analysis",
    weight: 3,
    signal: "decision_frame",
    pattern: /\b(should (i|we)|which (one|option|approach|library|tool|is better)|trade.?offs?|pros and cons|worth it|choose between|better to|recommend (a|an|which)|or should)\b/,
  },
  {
    category: "planning",
    weight: 3,
    signal: "planning_frame",
    pattern: /\b(roadmap|milestones|make a plan|plan for|plan out|how (should|do|would) (i|we) (approach|start|go about|structure)|steps to|sequence of steps|break (this|it) down into)\b/,
  },
  {
    category: "extraction",
    weight: 3,
    signal: "extraction_verb",
    pattern: /\b(list (all|every|the)|extract|enumerate|tabulate|make a table|inventory of|find every|which files|all the (functions|files|references|occurrences))\b/,
  },
  {
    category: "authoring",
    weight: 3,
    signal: "authoring_verb",
    // Adjectives get between the verb and the noun far more often than not:
    // "write a short announcement post" is the same task as "write a post".
    pattern: /\b(write (a|an|the) (\w+ ){0,3}(essay|post|email|report|summary|announcement|readme|article|abstract|caption|newsletter)|draft (a|an|the)|compose (a|an|the)|blog post|cover letter)\b/,
  },
  {
    category: "explanation",
    weight: 3,
    signal: "explanation_frame",
    pattern: /\b(explain|teach me|help me understand|walk me through|intuition (behind|for)|difference between|what (is|are|does) (a |an |the )?[a-z]|how (does|do) .{3,} work)\b/,
  },
];

const TRIVIAL = /^(hi|hey|hello|yo|thanks|thank you|ok|okay|sure|cool|nice|got it|yes|no|nope|yep|good morning|good evening)[\s!.?]*$/i;

/**
 * Picks the task category for this turn. Deliberately conservative: a message
 * that matches nothing above the threshold gets `general` and no scaffold, so
 * "hi" and "what time is it" pay nothing for the machinery.
 */
export function classifyMetaTask(input: MetaPromptInput): MetaTaskClassification {
  const raw = (input.userText ?? "").trim();
  const empty: MetaTaskClassification = { category: "general", score: 0, signals: [] };
  if (!raw || TRIVIAL.test(raw)) return empty;
  if (raw.length < 24 && !/[?]/.test(raw)) return empty;

  const text = raw.toLowerCase();
  const scores = new Map<MetaTaskCategory, number>();
  const signals: string[] = [];
  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;
    scores.set(rule.category, (scores.get(rule.category) ?? 0) + rule.weight);
    signals.push(rule.signal);
  }

  // The server decision is stronger evidence than any wording: a turn that was
  // actually authorized to write code is an implementation turn.
  const decision = input.decision;
  if (decision?.mode === "scoped_implementation") {
    scores.set("implementation", (scores.get("implementation") ?? 0) + 4);
    signals.push("scoped_implementation_decision");
  } else if (decision?.allowedOperations?.includes("code_write")) {
    scores.set("implementation", (scores.get("implementation") ?? 0) + 2);
    signals.push("code_write_operation");
  }
  if (input.surface === "garden_chat" || input.surface === "quartz_ai") {
    if (scores.has("research_synthesis")) {
      scores.set("research_synthesis", (scores.get("research_synthesis") ?? 0) + 1);
      signals.push("grounded_surface");
    }
  }

  let best: MetaTaskCategory = "general";
  let bestScore = 0;
  for (const category of META_TASK_PRIORITY) {
    const score = scores.get(category) ?? 0;
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  if (bestScore < 3) return empty;
  return { category: best, score: bestScore, signals };
}

// --- scaffolds --------------------------------------------------------------

interface MetaScaffold {
  signature: string;
  /** One rule that governs the whole procedure, rendered above it. */
  principle?: string;
  procedure: string[];
  verification: string;
  outputContract: string;
}

/**
 * Whether this turn can verify a claim by running something. The authenticated
 * Terminal always carries the server-audited command executor; Garden and Quartz
 * never do, so their scaffolds must not ask for execution they cannot have.
 */
function executionAvailable(input: MetaPromptInput): boolean {
  if (input.surface !== "dashboard_terminal") return false;
  const operations = input.decision?.allowedOperations ?? [];
  return (
    input.decision?.mode !== "technical_read" ||
    operations.includes("focused_test") ||
    operations.includes("typecheck")
  );
}

function quantitativeScaffold(input: MetaPromptInput): MetaScaffold {
  const chain = cloneReasoningChain();
  const canRun = executionAvailable(input);
  const stages = canRun
    ? chain
    : chain.filter((stage) => !/^(code|output)$/i.test(stage));
  const structure = cloneSolutionStructure();
  const boxed = structure.find((step) => /boxed/.test(step));
  return {
    signature: "given quantities and constraints -> the asked-for quantity, with the derivation that produces it",
    procedure: [
      "Preliminaries: name the quantities you are given, the quantity asked for, and the definition, identity, or law that connects them.",
      "Hints: state the one relation or transformation the solution turns on, before doing any of it.",
      `Decompose into the smallest self-contained sub-questions, and take each one through ${stages.join(" -> ")} before starting the next.`,
      canRun
        ? "Where a sub-answer is checkable by running something, run it and use the observed output rather than an assumed one."
        : "You cannot execute code on this surface. Carry each sub-answer symbolically and never present an unrun calculation as an executed one.",
      "Recompose: answer the original question from the sub-answers, not from a fresh guess at the end.",
    ],
    verification:
      "Before answering, re-derive the result by a second route, or check it against a limiting case, the units, and the order of magnitude. If the checks disagree, resolve the disagreement first and say which route was wrong.",
    outputContract: boxed
      ? "State the final answer explicitly and separately at the end. When the answer is a mathematical expression, present it in a LaTeX box, $\\boxed{...}$, without units inside the box."
      : "State the final answer explicitly and separately at the end.",
  };
}

function promptDesignScaffold(): MetaScaffold {
  const stages = cloneDesignStages();
  const gloss: Record<string, string> = {
    "document analysis": "read the supplied material for its key concepts, methods, constraints, and objectives",
    "task interpretation": "state the core task the prompt must serve, with its constraints, goals, and success condition",
    "prompt design": "build the structure: instructions, the ordered procedure, and the background the reader will not have",
    "optional - direct solution proposal": "if it helps, sketch the solution the prompt should be capable of producing, and check the structure can reach it",
    "output prompt": "emit the finished prompt as a coherent, self-contained artifact",
  };
  const operators = cloneRefinementOperators();
  return {
    signature: "a task plus the material describing it -> a structured, example-agnostic prompt that solves the whole task category",
    principle:
      "Write the structure, not the examples. A prompt built from worked examples only covers the instances that look like them.",
    procedure: stages.map((stage, index) => {
      const key = stage.toLowerCase();
      const hint = gloss[key];
      return `${index + 1}. ${stage}${hint ? `: ${hint}` : ""}.`;
    }),
    verification: `Apply one refinement pass over the draft. Strengthen it: ${operators.reasoning
      .map((item) => item.replace(/\.$/, ""))
      .join("; ")}. Then cut it back: ${operators.concise
      .map((item) => item.replace(/\.$/, ""))
      .join("; ")}. Keep the version that survives both.`,
    outputContract:
      "Deliver the prompt itself as a single block the user can copy, and keep any commentary about it short and outside the block.",
  };
}

function firstPartyScaffolds(input: MetaPromptInput): Record<string, MetaScaffold> {
  const canRun = executionAvailable(input);
  return {
    technical_diagnosis: {
      signature: "an observed symptom plus the system it appeared in -> the mechanism that produces it, and the evidence that pins it there",
      procedure: [
        "Separate the symptom from the story about it: what was observed, where, and what was expected instead.",
        "State the shortest chain of components the request actually crosses, and mark which links you have evidence for.",
        "List the candidate mechanisms that would produce exactly this symptom, including the boring ones: stale state, wrong path, wrong environment, wrong build.",
        canRun
          ? "Pick the check that eliminates the most candidates at once and run it before reasoning further."
          : "Name the single check that would eliminate the most candidates, and reason only as far as the available evidence supports.",
        "Keep narrowing until one mechanism explains every observed detail, including the ones that seem incidental.",
      ],
      verification:
        "A cause you cannot connect to the symptom by a specific line, call, or file is a guess. Say which parts are observed and which are inferred, and never present an unverified cause as the diagnosis.",
      outputContract:
        "Lead with the mechanism, then the evidence for it, then the fix. Flag anything you could not check.",
    },
    implementation: {
      signature: "an authorized outcome plus the code that currently exists -> the smallest coherent change that reaches it",
      procedure: [
        "Restate the narrow outcome and the boundary it must stay inside: which roots, which files, which operations.",
        "Read the existing shape before proposing a new one. Match the surrounding conventions rather than importing your own.",
        "Name the change as a set of edits with a reason each, and check the set is the smallest one that reaches the outcome.",
        "Make the edits in dependency order, so the tree is coherent between steps rather than only at the end.",
        canRun
          ? "Run the focused checks the change touches, and report what they actually printed."
          : "You cannot execute here. Say plainly which checks a person still has to run.",
      ],
      verification:
        "Before reporting completion, account for every part of the requested outcome, including the parts that turned out to be harder. Unfinished is a result; finished-sounding is not.",
      outputContract:
        "Say what changed, where, and what was verified. Distinguish what ran from what was only reasoned about.",
    },
    research_synthesis: {
      signature: "a question plus a body of sources -> an answer built from what those sources actually support",
      procedure: [
        "Fix the question precisely enough that a source can be judged relevant or not.",
        "Gather what each source actually claims, keeping the claim separate from your paraphrase of it.",
        "Group the claims by what they are about, and mark where sources agree, disagree, or simply do not overlap.",
        "Build the answer from the grouped claims, attributing each load-bearing statement to where it came from.",
        "Name the gaps: the parts of the question the available material does not reach.",
      ],
      verification:
        "Every claim that carries weight must trace to a specific page, anchor, or source. If it traces only to your own background knowledge, say so in the sentence that uses it.",
      outputContract:
        "Cite the Garden page or source anchor for grounded claims, and state plainly what the sources do not settle.",
    },
    decision_analysis: {
      signature: "options plus the situation choosing between them -> one recommendation, with the condition that would change it",
      procedure: [
        "State the decision as it actually stands, including the option of doing nothing when that is real.",
        "Name the criteria that decide it and which of them dominate for this person, rather than a general list of considerations.",
        "Evaluate each option against the dominant criteria, including its failure mode and what it costs to reverse.",
        "Commit to one recommendation and say why it beats the closest runner-up.",
        "Name the condition or piece of evidence that would flip the recommendation.",
      ],
      verification:
        "Check that the recommendation follows from the criteria you named, and that you have not smuggled in a preference that the criteria do not support.",
      outputContract:
        "Give the recommendation first. A survey of options with no recommendation is an unfinished answer.",
    },
    planning: {
      signature: "a goal plus its real constraints -> an ordered sequence of steps whose dependencies hold",
      procedure: [
        "State the finished condition: what is true when this is done, in terms someone could check.",
        "Work backwards from it to the steps that must precede it, and stop at what already exists.",
        "Order by dependency, not by comfort, and mark which steps can run in parallel.",
        "Attach to each step what it needs to start and what it produces, so a stall is diagnosable.",
        "Identify the step most likely to fail and what the plan does when it does.",
      ],
      verification:
        "Walk the sequence once forward and confirm each step's inputs are produced by an earlier one or already exist. A plan whose first step cannot start is not a plan.",
      outputContract:
        "Ordered steps are genuinely a list, so a numbered sequence is right here. The reasoning around it stays prose.",
    },
    explanation: {
      signature: "a concept plus what the reader already has -> an account that reaches understanding without a gap",
      procedure: [
        "State what the concept is for: the problem that made it necessary. That, not the definition, is the anchor.",
        "Establish the prerequisites the explanation will rest on, briefly, in the order they are needed.",
        "Give the mechanism, moving from the part the reader can already see to the part they cannot.",
        "Ground it in one concrete case worked through, so the abstraction has something to hold onto.",
        "Mark the boundary: where the idea stops applying, and the nearby thing it is commonly confused with.",
      ],
      verification:
        "Trace the explanation as someone who does not know the answer. Any step that requires the conclusion to understand is a gap and has to be reordered.",
      outputContract:
        "Prose, no headings on a short answer, and every term defined the first time it appears.",
    },
    extraction: {
      signature: "a corpus plus a selection criterion -> the complete set of items meeting it, with where each came from",
      procedure: [
        "State the criterion precisely enough to be applied uniformly, including the edge cases it must include or exclude.",
        "Name the search surface: which files, pages, or sources are in scope, and confirm you can actually reach them.",
        "Sweep the surface by more than one route when one route would miss a class of item, for example a different naming convention.",
        "Record each item with its location, so the set is checkable rather than trusted.",
        "State the completeness boundary: what was searched, and what was not.",
      ],
      verification:
        "An extraction that silently truncates reads as complete. If a cap, sample, or unreachable source limited the sweep, say so beside the result.",
      outputContract:
        "A set of found items is genuinely a list, so present it as one, with locations. Keep the surrounding explanation in prose.",
    },
    authoring: {
      signature: "a purpose, a reader, and the material -> a piece of writing that lands with that reader",
      procedure: [
        "Name the reader and what they should be able to do or believe after reading. Every later choice answers to that.",
        "Choose the single controlling idea, and cut what does not serve it however good it is.",
        "Order the material so each paragraph earns the next, opening with the thing that makes the reader continue.",
        "Draft in full sentences at the length the purpose needs, not the length that looks thorough.",
        "Revise once against the purpose: remove restatement, hedging, and any sentence that only announces what the next one says.",
      ],
      verification:
        "Read the draft as the named reader. If a sentence would not survive their attention, cut or rewrite it.",
      outputContract:
        "Deliver the piece itself. Keep notes about your choices short and clearly separate from it.",
    },
  };
}

function scaffoldFor(
  category: MetaTaskCategory,
  input: MetaPromptInput,
): MetaScaffold | null {
  if (category === "quantitative_reasoning") return quantitativeScaffold(input);
  if (category === "prompt_design") return promptDesignScaffold();
  return firstPartyScaffolds(input)[category] ?? null;
}

const SCAFFOLD_FOOTER =
  "This structure is the frame for your reasoning, not a template for your reply. Do not print its slot names, stage numbers, or the fact that you used it, and do not let it override `response_style`. If it does not fit what was actually asked, repair it in one pass and answer under the repaired version. It grants no capability, no tool, and no authority you were not already given.";

export function renderMetaPrompt(
  category: MetaTaskCategory,
  scaffold: MetaScaffold,
): string {
  return [
    "# meta_prompt",
    `Task category: ${category}`,
    `Signature: ${scaffold.signature}`,
    ...(scaffold.principle ? [`Governing rule: ${scaffold.principle}`] : []),
    "",
    "Procedure, filled in order before you answer:",
    ...scaffold.procedure.map((step) =>
      /^\d+\./.test(step) ? step : `- ${step}`,
    ),
    "",
    `Verification: ${scaffold.verification}`,
    `Output contract: ${scaffold.outputContract}`,
    "",
    SCAFFOLD_FOOTER,
  ].join("\n");
}

/**
 * The per-turn half of the integration. Returns the `meta_prompt` system section
 * for this turn, or null when the turn does not warrant one.
 */
export function metaPromptSection(input: MetaPromptInput): string | null {
  if (!metaPromptingEnabled()) return null;
  const classification = classifyMetaTask(input);
  if (classification.category === "general") return null;
  const scaffold = scaffoldFor(classification.category, input);
  if (!scaffold) return null;
  return renderMetaPrompt(classification.category, scaffold);
}
