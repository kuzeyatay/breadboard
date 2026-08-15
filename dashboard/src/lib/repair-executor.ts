// Model-backed single-page repair executor.
//
// This module turns a `UnitRepairRequest` (produced by the deterministic repair
// loop in garden-finalize.ts) into an LLM prompt that asks for ONE corrected
// page, and parses the model's reply back into a `RepairCandidate`. The
// orchestration, candidate validation, deterministic fallback, and provenance
// all live in garden-finalize.ts; this module only owns the prompt/parse/call
// boundary so garden-finalize.ts stays LLM-free.
//
// The executor is injected into `repairLearningUnitsFromContract`. Tests inject
// a fake executor; production injects `createOpenAIRepairExecutor(...)`.

import type OpenAI from "openai";
import { breadSystemPrompt } from "./assistant-identity.ts";
import { zettelHandlesForUnit, type LearningUnitContract } from "./learning-unit-contract.ts";
import type { ModelRepairExecutor, RepairCandidate, UnitRepairRequest } from "./garden-finalize.ts";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const RESPONSE_CONTRACT = `Return the corrected page and nothing else, using these exact delimiters:

===PAGE===
<the full revised Markdown page, including the --- YAML frontmatter --- block and the body>
===END PAGE===

Only if you changed an embedded interactive visual, also append:
===VISUAL_SPECS===
[{ "id": "<existing visual id>", "spec": { ...the full revised visual spec JSON... } }]
===END VISUAL_SPECS===

Only if the failure requires changing the Zettelkasten notes for THIS unit, also append the COMPLETE replacement records (never handles alone):
===CONTRACT_ZETTEL_PATCH===
{ "unitId": "<this unit id>", "zettelNotes": [{ "handle": "kebab-case-handle", "claim": "Complete learner-facing claim authored by you.", "connectedTo": ["exact-related-handle"] }] }
===END CONTRACT_ZETTEL_PATCH===`;

function formatContract(contract: LearningUnitContract): string {
  const lines: string[] = [
    `id: ${contract.id}`,
    `title: ${contract.title}`,
    `role: ${contract.role}`,
    `learningQuestion: ${contract.learningQuestion}`,
    `prerequisiteConcepts: ${contract.prerequisiteConcepts.join(", ") || "(none)"}`,
    `newConcepts: ${contract.newConcepts.join(", ") || "(none)"}`,
    `sourceAnchors: ${contract.sourceAnchors.join(", ") || "(none)"}`,
    `expectedWordRange: ${contract.expectedWordRange.join("-")}`,
    `zettelNotes: ${JSON.stringify(contract.zettelNotes)}`,
    `semanticConcepts: ${JSON.stringify(contract.semanticConcepts ?? [])}`,
    `knowledgeClaims: ${JSON.stringify(contract.knowledgeClaims ?? [])}`,
  ];
  if (contract.mustNotRepeat.length) lines.push(`mustNotRepeat: ${contract.mustNotRepeat.join(" | ")}`);
  if (contract.sourceFigures.length) {
    lines.push("requiredSourceFigures:");
    for (const figure of contract.sourceFigures) {
      lines.push(`  - ${figure.id} (${figure.placement}) — ${figure.interpretationGoal}`);
    }
  }
  if (contract.sourceFormulas.length) {
    lines.push("requiredSourceFormulas:");
    for (const formula of contract.sourceFormulas) {
      lines.push(`  - ${formula.id} (${formula.placement}) — teach: ${formula.teachingGoal}; define terms: ${formula.termsToDefine.join(", ")}`);
    }
  }
  if (contract.sourceTables.length) {
    lines.push("requiredSourceTables:");
    for (const table of contract.sourceTables) {
      lines.push(`  - ${table.id} (${table.placement}) — explain: ${table.rowsOrColumnsToExplain.join(", ")}; goal: ${table.teachingGoal}`);
    }
  }
  if (contract.interactiveVisual) {
    const visual = contract.interactiveVisual;
    lines.push(
      "requiredInteractiveVisual:",
      `  type: ${visual.visualType}`,
      `  uniqueConcept: ${visual.uniqueConcept}`,
      `  learnerManipulates: ${visual.learnerManipulates.join(", ")}`,
      `  expectedInsight: ${visual.expectedInsight}`,
      `  sourceAnchors: ${visual.sourceAnchors.join(", ") || "(none)"}`,
    );
  }
  return lines.join("\n");
}

function formatSourceAnchors(request: UnitRepairRequest): string {
  if (request.sourceAnchors.length === 0) return "(none)";
  return request.sourceAnchors
    .map((anchor) => {
      const id = anchor.figureId ?? anchor.tableId ?? anchor.equationId ?? anchor.questionId ?? anchor.textAnchorId ?? "(no id)";
      const parts = [id];
      if (typeof anchor.page === "number") parts.push(`p.${anchor.page}`);
      if (anchor.role) parts.push(`role=${anchor.role}`);
      if (anchor.description) parts.push(anchor.description);
      return `  - ${parts.join(" — ")}`;
    })
    .join("\n");
}

/** Build the model prompt for a single-page repair. `sourceText` is the exact
 * extracted source prose/formula text for this unit's anchors, supplied by the
 * caller (production reads it from the garden's source markdown). */
export function buildModelRepairPrompt(
  request: UnitRepairRequest,
  opts: { sourceText?: string } = {},
): { system: string; user: string } {
  const contract = request.learningUnitContract;
  const requiredHandles = zettelHandlesForUnit(contract);

  const system = breadSystemPrompt([
    "You are Breadboard's single-page repair model.",
    "You revise exactly ONE failed learning page so it satisfies its Learning Unit Contract and passes semantic validation.",
    "Hard constraints:",
    "- Preserve the canonical file path and the frontmatter schema; keep every existing frontmatter key that is still valid.",
    "- Keep the same learningUnitId. Do not invent unrelated source assignments.",
    "- Keep all required source figures/tables embedded and all required source formulas grounded to their exact source anchor ids.",
    "- Keep required embedded interactive visual blocks (```breadboard-visual fenced JSON) and their minimal, correctly-roled source anchors.",
    "- Page tags must equal the contract's Zettelkasten handles exactly; do not add generic fallback tags.",
    "- Use Quartz-flavored Markdown. Math must be valid KaTeX: inline `$...$`, display `$$...$$`. Do not escape KaTeX into prose.",
    "- Only change what the validation errors require; preserve correct existing content and flow from the previous/next unit.",
    "",
    RESPONSE_CONTRACT,
  ].join("\n"));

  const user = [
    `# Repair request for unit ${request.unitId} — ${request.pagePath}`,
    `Canonical section path: ${request.sectionPath}`,
    "",
    "## Failure types",
    request.failureTypes.join(", ") || "(none)",
    "",
    "## Validation errors to fix",
    ...request.validationErrors.map((error) => `- ${error}`),
    "",
    "## Required changes",
    ...request.requiredChanges.map((change) => `- ${change}`),
    "",
    "## Learning Unit Contract",
    formatContract(contract),
    "",
    "## Required Zettelkasten handles (page tags must equal these exactly)",
    requiredHandles.length ? requiredHandles.map((handle) => `- ${handle}`).join("\n") : "(none)",
    "",
    "## Source anchors",
    formatSourceAnchors(request),
    ...(opts.sourceText
      ? ["", "## Exact source text for these anchors", "```text", opts.sourceText.trim(), "```"]
      : []),
    "",
    "## Previous unit (for continuity, do not restart the global motivation)",
    request.previousUnitSummary ?? "(this is the first unit)",
    "",
    "## Next unit (do not pre-empt it)",
    request.nextUnitSummary ?? "(this is the last unit)",
    "",
    "## Current page markdown (revise this)",
    "````markdown",
    request.currentPageMarkdown,
    "````",
  ].join("\n");

  return { system, user };
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function extractBetween(text: string, startMarker: string, endMarker: string): string | null {
  const start = text.indexOf(startMarker);
  if (start < 0) return null;
  const from = start + startMarker.length;
  const end = text.indexOf(endMarker, from);
  const slice = end >= 0 ? text.slice(from, end) : text.slice(from);
  return slice.trim();
}

function stripCodeFence(value: string): string {
  const fence = value.match(/^```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n```$/);
  return fence ? (fence[1] ?? "").trim() : value.trim();
}

/** Parse a model reply into a RepairCandidate. Tolerant of a model that returns
 * just the page (with or without a ```markdown fence) and no side outputs. */
export function parseModelRepairResponse(text: string): RepairCandidate | null {
  if (!text || !text.trim()) return null;

  let markdown = extractBetween(text, "===PAGE===", "===END PAGE===");
  if (!markdown) {
    const fenced = text.match(/```markdown\r?\n([\s\S]*?)\r?\n```/);
    if (fenced) markdown = (fenced[1] ?? "").trim();
    else if (text.trim().startsWith("---")) markdown = text.trim();
  }
  if (!markdown) return null;
  markdown = stripCodeFence(markdown);
  if (!markdown.startsWith("---")) return null; // must be a real page with frontmatter

  const candidate: RepairCandidate = { markdown };

  const visualsRaw = extractBetween(text, "===VISUAL_SPECS===", "===END VISUAL_SPECS===");
  if (visualsRaw) {
    try {
      const parsed = JSON.parse(stripCodeFence(visualsRaw));
      if (
        !Array.isArray(parsed) ||
        parsed.some(
          (entry) =>
            !entry ||
            typeof entry !== "object" ||
            typeof entry.id !== "string" ||
            entry.id.trim() !== entry.id ||
            !entry.id ||
            !entry.spec ||
            typeof entry.spec !== "object" ||
            Array.isArray(entry.spec),
        )
      ) return null;
      candidate.visualSpecs = parsed.map((entry) => ({
        id: entry.id,
        spec: entry.spec as Record<string, unknown>,
      }));
    } catch {
      return null;
    }
  }

  const patchRaw = extractBetween(text, "===CONTRACT_ZETTEL_PATCH===", "===END CONTRACT_ZETTEL_PATCH===");
  if (patchRaw) {
    try {
      const parsed = JSON.parse(stripCodeFence(patchRaw));
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.unitId !== "string" ||
        parsed.unitId.trim() !== parsed.unitId ||
        !parsed.unitId ||
        !Array.isArray(parsed.zettelNotes) ||
        parsed.zettelNotes.length === 0 ||
        parsed.zettelNotes.some(
          (note: unknown) => {
            if (!note || typeof note !== "object") return true;
            const record = note as Record<string, unknown>;
            return (
              typeof record.handle !== "string" ||
              record.handle.trim() !== record.handle ||
              !record.handle ||
              typeof record.claim !== "string" ||
              record.claim.trim() !== record.claim ||
              !record.claim ||
              !Array.isArray(record.connectedTo) ||
              record.connectedTo.some(
                (value) => typeof value !== "string" || value.trim() !== value || !value,
              )
            );
          },
        )
      ) return null;
      candidate.contractZettelPatch = {
        unitId: parsed.unitId,
        zettelNotes: parsed.zettelNotes.map((note: Record<string, unknown>) => ({
          handle: note.handle as string,
          claim: note.claim as string,
          connectedTo: [...(note.connectedTo as string[])],
        })),
      };
    } catch {
      return null;
    }
  }

  return candidate;
}

// ---------------------------------------------------------------------------
// Production executor
// ---------------------------------------------------------------------------

/** Build a production model executor backed by the OpenAI-compatible client the
 * Learn pipeline already uses. Any error (timeout, network, empty reply,
 * unparseable output) surfaces as a thrown/rejected value so the repair loop
 * records it as a model failure and falls back to deterministic repair. */
export function createOpenAIRepairExecutor(opts: {
  client: OpenAI;
  model: string;
  gardenId: string;
  timeoutMs?: number;
  sourceTextForRequest?: (request: UnitRepairRequest) => string | undefined;
}): ModelRepairExecutor {
  return async (request: UnitRepairRequest): Promise<RepairCandidate | null> => {
    const { system, user } = buildModelRepairPrompt(request, {
      sourceText: opts.sourceTextForRequest?.(request),
    });
    const response = await opts.client.chat.completions.create(
      {
        model: opts.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      opts.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 0 } : undefined,
    );
    const content = response.choices[0]?.message?.content?.trim() ?? "";
    return parseModelRepairResponse(content);
  };
}
