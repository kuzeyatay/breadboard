// The workflows every account starts with. They are written once, as ordinary
// rows in the user's own workflow table, so from then on they are the user's to
// edit, run, rename or delete like any workflow they built themselves. A
// workflow the user deletes is not put back: the seed is recorded per user.
//
// Each one is a Start block (which carries the run's input as <start.input>)
// followed by Agent blocks whose last output is the finished document.

import { randomUUID } from "node:crypto";

import db from "@/lib/db";

type Message = { role: "system" | "user"; content: string };
type AgentStep = { name: string; messages: Message[]; temperature?: number };
type StarterWorkflow = { name: string; description: string; steps: AgentStep[] };

const MODEL = "claude-sonnet-5";

const STARTER_WORKFLOWS: StarterWorkflow[] = [
  {
    name: "Meeting notes to minutes and action items",
    description:
      "Paste raw meeting notes or a transcript. Returns clean minutes: a summary, the decisions made, every action item with its owner and due date, and the open questions.",
    steps: [
      {
        name: "Minutes",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: [
              "You turn raw meeting notes or transcripts into minutes people can act on.",
              "",
              "Write Markdown with exactly these sections:",
              "# <Meeting title, inferred from the notes>",
              "**Date:** <if stated, otherwise omit the line> · **Attendees:** <names mentioned as present, otherwise omit the line>",
              "## Summary",
              "Three to five sentences on what the meeting was for and where it landed.",
              "## Decisions",
              "A numbered list of decisions that were actually made. Not proposals, not discussion.",
              "## Action items",
              "A table with columns: Action | Owner | Due | Notes. One row per concrete task. Start each action with a verb.",
              "If no owner or date was stated, write \"Unassigned\" or \"No date\"; never invent one.",
              "## Open questions",
              "Things raised but not resolved, each with who raised it if known.",
              "",
              "Rules: use only what is in the notes. Keep names exactly as written. Drop small talk.",
              "If a section has nothing, write \"None recorded.\"",
            ].join("\n"),
          },
          { role: "user", content: "<start.input>" },
        ],
      },
    ],
  },
  {
    name: "Lecture notes to study guide",
    description:
      "Paste lecture notes, slides text or a chapter. Returns a study guide with key concepts, definitions, worked reasoning, common mistakes and practice questions with answers.",
    steps: [
      {
        name: "Study guide",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: [
              "You are a tutor who turns course material into a study guide a student can revise from the night before an exam.",
              "",
              "Write Markdown with these sections:",
              "# <Topic>",
              "## The big picture",
              "One paragraph: what this material is about and why it matters in the course.",
              "## Key concepts",
              "For each concept: a bold name, a plain-language explanation in two to four sentences, and the formula or rule if there is one (use LaTeX between $ $ for maths).",
              "## Definitions",
              "A table: Term | Definition.",
              "## How to reason about it",
              "Step-by-step method for the typical problem type in this material, with one short worked example.",
              "## Common mistakes",
              "Bullets: the mistake, and why it is wrong.",
              "## Practice questions",
              "Eight questions from recall to application, numbered. Mix short answer and problem questions.",
              "## Answers",
              "Worked answers to every practice question, numbered to match.",
              "",
              "Stay faithful to the material. Where the notes are incomplete or ambiguous, say so in a short \"Check with the lecturer\" note rather than guessing.",
            ].join("\n"),
          },
          { role: "user", content: "<start.input>" },
        ],
      },
    ],
  },
  {
    name: "Draft an email reply",
    description:
      "Paste the email you received, then a line starting with \"Reply:\" saying what you want to answer. Returns a ready-to-send reply in a matching tone, with a subject line.",
    steps: [
      {
        name: "Reply",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: [
              "You write email replies on the user's behalf.",
              "",
              "The input is an email the user received, usually followed by the user's intent (often after \"Reply:\"). If no intent is given, write a helpful, polite reply that answers every question asked.",
              "",
              "Rules:",
              "- Match the sender's register: formal stays formal, casual stays casual. Mirror their language (reply in Dutch to Dutch, and so on).",
              "- Answer every direct question in the email, in the order asked.",
              "- Keep it short: most replies are under 150 words. No filler such as \"I hope this email finds you well\".",
              "- Never invent facts, dates, prices or commitments. Where the user must fill something in, write it as [square brackets].",
              "- Sign off with [Your name].",
              "",
              "Output exactly:",
              "Subject: Re: <original subject, or a short fitting subject>",
              "",
              "<the reply body>",
            ].join("\n"),
          },
          { role: "user", content: "<start.input>" },
        ],
      },
    ],
  },
  {
    name: "Research brief",
    description:
      "Give a topic or question. Plans the angles worth covering, then writes a structured brief with findings, open debates, what to read next and what to verify.",
    steps: [
      {
        name: "Plan",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: [
              "You plan research briefs. Given a topic or question, produce a plan, not the brief.",
              "",
              "Output Markdown:",
              "## Question",
              "The question restated precisely, with scope (time period, field, region) made explicit.",
              "## Angles",
              "Four to six angles the brief must cover, each with one line on why it matters.",
              "## Key terms",
              "Terms a reader must understand, comma separated.",
              "## Search queries",
              "Six specific queries someone would type into a library database or search engine.",
              "## Pitfalls",
              "Where this topic is commonly misunderstood or where sources disagree.",
            ].join("\n"),
          },
          { role: "user", content: "<start.input>" },
        ],
      },
      {
        name: "Brief",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: [
              "You write research briefs from a plan. Be accurate and calibrated: separate established findings from contested ones, and say when you are unsure.",
              "",
              "Write Markdown:",
              "# <Title>",
              "## Executive summary",
              "Three to five sentences a busy reader can act on.",
              "## Background",
              "## Findings",
              "One subsection per angle in the plan, each with the strongest evidence you know of and how confident the field is.",
              "## Open debates",
              "## What to read next",
              "Five foundational works, reviews or sources by name, with one line each on why. Only name works you are confident exist.",
              "## Verify before relying on this",
              "Specific claims in this brief that should be checked against primary sources.",
            ].join("\n"),
          },
          {
            role: "user",
            content: "Topic: <start.input>\n\nPlan:\n<plan.content>",
          },
        ],
      },
    ],
  },
  {
    name: "Proofread and tighten",
    description:
      "Paste any draft: an essay, report section, cover letter or post. Returns the corrected, tighter version followed by a short list of what changed and why.",
    steps: [
      {
        name: "Edit",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: [
              "You are a careful copy editor.",
              "",
              "Edit the user's text for correctness and clarity:",
              "- Fix spelling, grammar, punctuation and agreement.",
              "- Cut redundancy and filler; prefer active voice and concrete words.",
              "- Keep the author's meaning, voice, language and formatting (headings, lists, citations).",
              "- Do not add new claims or content. Do not change technical terms, names, numbers or quotes.",
              "",
              "Output Markdown:",
              "## Edited text",
              "<the full edited text>",
              "## What changed",
              "Up to ten bullets, most important first, each naming the change and the reason. Group repeated fixes (\"Fixed 6 comma splices\").",
            ].join("\n"),
          },
          { role: "user", content: "<start.input>" },
        ],
      },
    ],
  },
];

const STEP_X = 330;

function starterState(workflow: StarterWorkflow) {
  const startId = randomUUID();
  const blocks: Record<string, unknown> = {
    [startId]: {
      id: startId,
      type: "starter",
      name: "Start",
      position: { x: 80, y: 120 },
      subBlocks: {
        startWorkflow: { id: "startWorkflow", type: "dropdown", value: "manual" },
        inputFormat: { id: "inputFormat", type: "input-format", value: [] },
      },
      outputs: {},
      enabled: true,
      horizontalHandles: true,
    },
  };
  const edges: Array<Record<string, unknown>> = [];
  let previous = startId;
  workflow.steps.forEach((step, index) => {
    const id = randomUUID();
    blocks[id] = {
      id,
      type: "agent",
      name: step.name,
      position: { x: 80 + (index + 1) * STEP_X, y: 120 },
      subBlocks: {
        messages: { id: "messages", type: "messages-input", value: step.messages },
        model: { id: "model", type: "combobox", value: MODEL },
        temperature: { id: "temperature", type: "slider", value: step.temperature ?? 0.3 },
        tools: { id: "tools", type: "tool-input", value: [] },
        skills: { id: "skills", type: "skill-input", value: [] },
        memoryType: { id: "memoryType", type: "dropdown", value: "none" },
      },
      outputs: {},
      enabled: true,
      horizontalHandles: true,
    };
    edges.push({
      id: randomUUID(),
      source: previous,
      target: id,
      sourceHandle: "source",
      targetHandle: "target",
      type: "workflowEdge",
    });
    previous = id;
  });
  return { blocks, edges, loops: {}, parallels: {} };
}

let tableReady = false;

/** Gives a user the starter workflows the first time their workflow list is read. */
export function ensureStarterWorkflows(userId: number): void {
  if (!Number.isFinite(userId) || userId <= 0) return;
  if (!tableReady) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS workflow_starter_seeds (user_id INTEGER PRIMARY KEY, seeded_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    tableReady = true;
  }
  const seeded = db.prepare("SELECT 1 FROM workflow_starter_seeds WHERE user_id = ?").get(userId);
  if (seeded) return;
  const insert = db.prepare(
    "INSERT INTO workflows (id, user_id, name, description, state) VALUES (?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    // Recorded first inside the transaction: two tabs opening at once seed once.
    const claimed = db
      .prepare("INSERT OR IGNORE INTO workflow_starter_seeds (user_id) VALUES (?)")
      .run(userId);
    if (claimed.changes === 0) return;
    for (const workflow of [...STARTER_WORKFLOWS].reverse()) {
      insert.run(randomUUID(), userId, workflow.name, workflow.description, JSON.stringify(starterState(workflow)));
    }
  })();
}
