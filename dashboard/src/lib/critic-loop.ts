// Breadboard end-stage LLM critic loop.
//
// Deterministic validation + `FinalGardenState` catch structural drift and the
// semantic classes we can encode as rules. This module adds a *final* semantic
// auditor: a ChatMock (OpenAI-compatible) critic that reviews a compact packet
// built from the FINAL exported garden, returns structured JSON issues, and
// drives targeted repair rounds until no blocking issues remain or the repair
// budget is exhausted.
//
// It never fails garden generation. A garden is always a draft if it exists; it
// is only `publishReady` when deterministic validation AND the critic find no
// blocking issues. Zero runtime deps beyond fs/path so it runs under
// `node --experimental-strip-types`.

import fs from "node:fs";
import path from "node:path";
import {
  applyAnchorCriticDecision,
  auditFinalGardenState,
  buildAnchorConfirmationPackets,
  buildAnchorEvidenceCriticIssues,
  buildFinalGardenState,
  reconcileFinalGardenState,
  unresolvedLowConfidenceAnchorIds,
  type AnchorConfirmationPacket,
  type AnchorCriticDecision,
  type AppliedAnchorDecision,
  type FinalAuditResult,
  type FinalGardenState,
} from "./final-garden-state.ts";
import { finalizeGardenExport } from "./garden-finalize.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CriticSeverity = "blocking" | "warning" | "cosmetic";

export type CriticIssueType =
  | "formula_anchor_mismatch"
  | "source_anchor_mismatch"
  | "source_coverage_contradiction"
  | "stale_caveat"
  | "section_index_template_prose"
  | "template_zettelkasten_handle"
  | "repeated_opening"
  | "visual_grounding_mismatch"
  | "worked_example_misclassified"
  | "repair_provenance_error"
  | "debug_artifact_leak"
  | "other";

export type CriticRepairTarget =
  | "unit_page"
  | "section_index"
  | "learning_unit_contract"
  | "source_anchor_ledger"
  | "source_coverage"
  | "planning_doc"
  | "visual_spec"
  | "repair_log"
  | "global";

export interface CriticIssue {
  id: string;
  severity: CriticSeverity;
  type: CriticIssueType;
  pagePath?: string;
  sectionPath?: string;
  visualId?: string;
  sourceAnchorIds?: string[];
  problem: string;
  evidence: string;
  expected: string;
  repairTarget: CriticRepairTarget;
  suggestedRepair: string;
}

export interface ArtifactRepairRequest {
  id: string;
  issueIds: string[];
  targetKind: CriticRepairTarget;
  targetPath?: string;
  affectedUnitIds?: string[];
  affectedAnchorIds?: string[];
  instructions: string[];
  evidence: string[];
}

export interface CriticReviewPacket {
  gardenTitle: string;
  sections: Array<{
    title: string;
    indexExcerpt: string;
    pages: Array<{
      path: string;
      title: string;
      openingExcerpt: string;
      frontmatterSummary: {
        sourceAnchors: string[];
        sourceFormulaAnchors: string[];
        formulas: unknown[];
        tags: string[];
        visuals: string[];
      };
      bodyExcerpts: string[];
    }>;
  }>;
  sourceAnchors: Array<{
    id: string;
    kind: string;
    title: string;
    semanticSummary: string;
    exactText?: string;
    formulaFamily?: string;
  }>;
  visualSummaries: Array<{
    id: string;
    pagePath: string;
    title: string;
    type: string;
    sourceAnchors: string[];
    anchorRoles?: unknown[];
  }>;
  sourceCoverageSummary: string;
  deterministicValidationSummary: string;
}

export interface CriticLoopOptions {
  enabled: boolean;
  maxRounds: number;
  maxIssuesPerRound: number;
  maxTotalRepairAttempts: number;
  criticModel: string;
  repairModel?: string;
  strictPublish: boolean;
}

export const DEFAULT_CRITIC_LOOP_OPTIONS: CriticLoopOptions = {
  enabled: true,
  maxRounds: 3,
  maxIssuesPerRound: 12,
  maxTotalRepairAttempts: 25,
  criticModel: "chatmock",
  repairModel: "chatmock",
  strictPublish: true,
};

export type CriticAvailabilityStatus = "available" | "unavailable" | "errored" | "disabled";

export type GardenLifecycleStatus =
  | "draft_generated"
  | "repairing"
  | "needs_review"
  | "publish_ready"
  | "publish_failed_structural";

export interface GardenAcceptanceStatus {
  draftGenerated: boolean;
  accepted: boolean;
  publishReady: boolean;
  lifecycleStatus: GardenLifecycleStatus;

  deterministicPass: boolean;
  criticRequired: boolean;
  criticAvailable: boolean;
  criticRan: boolean;
  criticPass: boolean;

  criticAvailabilityStatus: CriticAvailabilityStatus;
  criticUnavailableReason?: string;

  unresolvedBlockingIssues: CriticIssue[];
  warnings: CriticIssue[];
  repairRoundsUsed: number;
  reason?: string;
}

export type CriticIssueResolutionStatus =
  | "resolved"
  | "still_present"
  | "replaced_by_new_issue"
  | "unrepairable"
  | "not_attempted";

export interface CriticIssueResolution {
  issueId: string;
  originalIssue: CriticIssue;
  repairRequestId?: string;
  status: CriticIssueResolutionStatus;
  evidence?: string;
}

export interface RepairProvenanceRecord {
  requestId: string;
  targetKind: CriticRepairTarget;
  targetPath?: string;
  executorAttempted: Array<"model" | "deterministic">;
  executorUsed: "model" | "deterministic" | "none";
  modelFailureReason?: string;
  changed: boolean;
}

export interface CriticRoundRecord {
  round: number;
  blockingIssues: number;
  warnings: number;
  repairsAttempted: number;
  repairsResolved: number;
  issueTypes: string[];
  resolutions: CriticIssueResolution[];
  provenance: RepairProvenanceRecord[];
  anchorDecisions?: AppliedAnchorDecision[];
}

/** Stable id prefix marking a deterministic low-confidence anchor issue, so it
 *  routes to the anchor-confirmation critic rather than the generic repair. */
export const ANCHOR_EVIDENCE_ISSUE_PREFIX = "anchor-evidence-";

/** Convert deterministic anchor-evidence issues into CriticIssues for the loop. */
export function anchorEvidenceCriticIssues(state: FinalGardenState): CriticIssue[] {
  return buildAnchorEvidenceCriticIssues(state).map((issue) => ({
    id: `${ANCHOR_EVIDENCE_ISSUE_PREFIX}${issue.sourceAnchorIds[0]}`,
    severity: "blocking" as CriticSeverity,
    type: "source_anchor_mismatch" as CriticIssueType,
    pagePath: issue.pagePath,
    sourceAnchorIds: issue.sourceAnchorIds,
    problem: issue.problem,
    evidence: issue.evidence,
    expected: "Confirm with exact source text, replace with a stronger anchor, or remove/repair the grounding.",
    repairTarget: "source_anchor_ledger" as CriticRepairTarget,
    suggestedRepair: issue.suggestedRepair,
  }));
}

export interface CriticLoopResult {
  status: GardenAcceptanceStatus;
  rounds: CriticRoundRecord[];
  finalBlockingIssues: CriticIssue[];
  finalWarnings: CriticIssue[];
}

/** The critic: reviews a packet, returns structured issues. ChatMock in prod. */
export type CriticFn = (packet: CriticReviewPacket) => Promise<CriticIssue[]> | CriticIssue[];

export interface CriticRepairOutcome {
  attempted: number;
  resolved: number;
  provenance?: RepairProvenanceRecord[];
}

/** Applies one round's repairs. The default (below) runs model-first for
 *  semantic targets then deterministic finalization; tests can inject their own. */
export type ArtifactRepairFn = (
  gardenDir: string,
  gardenSlug: string,
  requests: ArtifactRepairRequest[],
  ctx: { round: number; issuesById?: Map<string, CriticIssue> },
) => Promise<CriticRepairOutcome> | CriticRepairOutcome;

// Model repair (ChatMock) for semantic page/section rewrites.
export interface ModelRepairInput {
  issue: CriticIssue;
  repairRequest: ArtifactRepairRequest;
  finalGardenStateExcerpt: unknown;
  currentMarkdown?: string;
  learningUnitContract?: unknown;
  sourceAnchors?: unknown[];
  previousPageSummary?: string;
  nextPageSummary?: string;
}

export interface ModelRepairOutput {
  targetPath: string;
  revisedMarkdown?: string;
  revisedJson?: unknown;
  notes?: string[];
}

export type ModelRepairFn = (input: ModelRepairInput) => Promise<ModelRepairOutput | null> | ModelRepairOutput | null;

// ---------------------------------------------------------------------------
// Review packet
// ---------------------------------------------------------------------------

function firstProseParagraphs(body: string, count: number): string[] {
  const prose = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^\s*\*\*(?:Question|Answer)\.?\*\*.*$/gim, " ");
  return prose
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 40)
    .slice(0, count);
}

function frontmatterFormulaSummaries(state: FinalGardenState, pageRel: string): unknown[] {
  return state.formulas
    .filter((f) => f.pageRel === pageRel)
    .map((f) => ({ kind: f.declaredKind || f.structuralKind, text: f.text.slice(0, 80), sourceAnchor: f.sourceAnchor, basedOnFormula: f.basedOnFormula }));
}

function summarizeAudit(audit: FinalAuditResult): string {
  if (audit.ok) return "deterministic FinalGardenState audit: PASS (no blocking issues).";
  const byRule = Object.entries(audit.byRule).map(([rule, ps]) => `${rule}: ${ps.length}`).join(", ");
  return `deterministic FinalGardenState audit: FAIL (${audit.problems.length} problems — ${byRule}).`;
}

/** Compact review packet built ONLY from the final exported state. */
export function buildCriticReviewPacket(state: FinalGardenState, deterministicValidationSummary?: string): CriticReviewPacket {
  const audit = auditFinalGardenState(state);
  const pagesBySection = new Map<string, FinalGardenState["pages"]>();
  const sectionDir = (rel: string): string => rel.split("/").slice(0, 2).join("/");
  for (const page of state.pages) {
    const key = sectionDir(page.rel);
    (pagesBySection.get(key) ?? pagesBySection.set(key, []).get(key)!).push(page);
  }
  const sectionByDir = new Map(state.sections.map((s) => [s.rel.replace(/\/_index\.md$/i, ""), s]));

  const sections = [...pagesBySection.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, pages]) => {
      const section = sectionByDir.get(dir);
      const sortedPages = [...pages].sort((a, b) => a.subsectionNumber.localeCompare(b.subsectionNumber, undefined, { numeric: true }));
      return {
        title: section?.title ?? dir.split("/").pop() ?? dir,
        indexExcerpt: (section?.body ?? "").replace(/```[\s\S]*?```/g, " ").replace(/^#.*$/gm, " ").replace(/\s+/g, " ").trim().slice(0, 320),
        pages: sortedPages.map((page) => ({
          path: page.rel,
          title: page.title,
          openingExcerpt: firstProseParagraphs(page.body, 1).join(" ").slice(0, 400),
          frontmatterSummary: {
            sourceAnchors: page.sourceAnchors,
            sourceFormulaAnchors: page.sourceFormulaAnchors,
            formulas: frontmatterFormulaSummaries(state, page.rel),
            tags: page.tags,
            visuals: page.visualIds,
          },
          bodyExcerpts: firstProseParagraphs(page.body, 3).map((p) => p.slice(0, 300)),
        })),
      };
    });

  const sourceAnchors = Object.values(state.sourceAnchors).map((a) => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    semanticSummary: a.semanticSummary ?? a.title,
    exactText: a.exactText ? a.exactText.slice(0, 240) : undefined,
    formulaFamily: a.formulaFamily,
  }));

  const visualSummaries = state.visuals.map((v) => ({
    id: v.id,
    pagePath: v.pageRel ?? "",
    title: v.type,
    type: v.type,
    sourceAnchors: [...v.anchorIds, ...v.textAnchorIds],
    anchorRoles: v.anchorRoles,
  }));

  return {
    gardenTitle: state.slug,
    sections,
    sourceAnchors,
    visualSummaries,
    sourceCoverageSummary: (state.planningDocs.sourceCoverage ?? "").replace(/^---[\s\S]*?---/, "").replace(/\s+/g, " ").trim().slice(0, 1200),
    deterministicValidationSummary: deterministicValidationSummary ?? summarizeAudit(audit),
  };
}

// ---------------------------------------------------------------------------
// Critic prompt + response parsing (ChatMock)
// ---------------------------------------------------------------------------

export const CRITIC_SYSTEM_PROMPT = `You are Breadboard's final semantic critic. You review the FINAL exported state of a generated learning garden and report only genuine semantic errors that deterministic validators cannot reliably judge.

Deterministic validators already ran; do not re-report anything unless the final state truly contradicts itself or the source. Focus on MEANING, not field agreement:
- Fields agreeing on a WRONG value is still an error (a page and its contract both citing the wrong source formula anchor is wrong).
- A formula's math must match the metric family of the source formula anchor it claims (a surrogate-gradient or accuracy formula grounded to the normalized-energy-efficiency anchor is wrong).
- A numeric worked example labeled as a symbolic source definition is wrong.
- Source Coverage must match the final pages and visual JSON.
- Caveats claiming source material is unavailable when anchors/exact text exist are stale.
- Section index prose that reuses generic templates ("introduces the core idea", "so the pieces connect into one picture") is wrong.
- Zettelkasten handles that describe a tag's function instead of a durable claim are template-like.
- Two pages opening with the same paraphrased scenario is a repeated opening.
- A text anchor with no exact source text when the source clearly explains the concept is too generic.
- A visual grounded to anchors that do not match its title/purpose is mismatched.
- Debug repair files shipped in the export must be flagged.
- Repair-log entries attributing a change to the wrong target are provenance errors.

Return ONLY a JSON object: {"issues": CriticIssue[]}. Each issue:
{
  "id": "kebab-unique",
  "severity": "blocking" | "warning" | "cosmetic",
  "type": one of formula_anchor_mismatch|source_anchor_mismatch|source_coverage_contradiction|stale_caveat|section_index_template_prose|template_zettelkasten_handle|repeated_opening|visual_grounding_mismatch|worked_example_misclassified|repair_provenance_error|debug_artifact_leak|other,
  "pagePath"?, "sectionPath"?, "visualId"?, "sourceAnchorIds"?: string[],
  "problem": one sentence,
  "evidence": the exact text/field proving it,
  "expected": what a correct artifact would show,
  "repairTarget": unit_page|section_index|learning_unit_contract|source_anchor_ledger|source_coverage|planning_doc|visual_spec|repair_log|global,
  "suggestedRepair": one actionable instruction
}
Use "blocking" only for genuine semantic errors; "warning"/"cosmetic" for polish. If the garden is clean, return {"issues": []}. Output JSON only, no prose.`;

export function buildCriticUserPrompt(packet: CriticReviewPacket): string {
  return `Review this final garden. Report only genuine semantic errors as JSON {"issues":[...]}.\n\n${JSON.stringify(packet, null, 1)}`;
}

const VALID_TYPES = new Set<CriticIssueType>([
  "formula_anchor_mismatch", "source_anchor_mismatch", "source_coverage_contradiction", "stale_caveat",
  "section_index_template_prose", "template_zettelkasten_handle", "repeated_opening", "visual_grounding_mismatch",
  "worked_example_misclassified", "repair_provenance_error", "debug_artifact_leak", "other",
]);
const VALID_TARGETS = new Set<CriticRepairTarget>([
  "unit_page", "section_index", "learning_unit_contract", "source_anchor_ledger", "source_coverage",
  "planning_doc", "visual_spec", "repair_log", "global",
]);

/** Parse a critic model response into validated issues. Tolerant of fences and
 *  either a bare array or {issues:[...]}. Invalid issues are dropped. */
export function parseCriticIssues(text: string): CriticIssue[] {
  const stripped = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return [];
    try { parsed = JSON.parse(match[0]); } catch { return []; }
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.issues)
      ? (parsed as Record<string, unknown>).issues as unknown[]
      : [];
  const issues: CriticIssue[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const severity = String(r.severity ?? "").toLowerCase();
    if (severity !== "blocking" && severity !== "warning" && severity !== "cosmetic") continue;
    const type = (VALID_TYPES.has(r.type as CriticIssueType) ? r.type : "other") as CriticIssueType;
    const repairTarget = (VALID_TARGETS.has(r.repairTarget as CriticRepairTarget) ? r.repairTarget : "global") as CriticRepairTarget;
    const problem = String(r.problem ?? "").trim();
    if (!problem) continue;
    issues.push({
      id: String(r.id ?? `critic-${i + 1}`),
      severity: severity as CriticSeverity,
      type,
      pagePath: r.pagePath ? String(r.pagePath) : undefined,
      sectionPath: r.sectionPath ? String(r.sectionPath) : undefined,
      visualId: r.visualId ? String(r.visualId) : undefined,
      sourceAnchorIds: Array.isArray(r.sourceAnchorIds) ? r.sourceAnchorIds.map(String) : undefined,
      problem,
      evidence: String(r.evidence ?? "").trim(),
      expected: String(r.expected ?? "").trim(),
      repairTarget,
      suggestedRepair: String(r.suggestedRepair ?? "").trim(),
    });
  }
  return issues;
}

/** Minimal shape of an OpenAI-compatible chat client (ChatMock or the SDK). The
 *  `create` signature is intentionally permissive so the overloaded OpenAI SDK
 *  method and a test double both satisfy it. */
export interface ChatCompletionClientLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chat: { completions: { create: (...args: any[]) => Promise<any> } };
}

/** ChatMock-backed critic (OpenAI-compatible chat completion). */
export function createChatMockCritic(opts: {
  client: ChatCompletionClientLike;
  model: string;
  timeoutMs?: number;
}): CriticFn {
  return async (packet: CriticReviewPacket): Promise<CriticIssue[]> => {
    const response = await opts.client.chat.completions.create(
      {
        model: opts.model,
        messages: [
          { role: "system", content: CRITIC_SYSTEM_PROMPT },
          { role: "user", content: buildCriticUserPrompt(packet) },
        ],
        response_format: { type: "json_object" },
      },
      opts.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 0 } : undefined,
    );
    return parseCriticIssues(response.choices?.[0]?.message?.content ?? "");
  };
}

// ---------------------------------------------------------------------------
// ChatMock anchor confirmation (low-confidence source anchors)
// ---------------------------------------------------------------------------

/** Judges one low-confidence anchor packet, returns a structured decision. */
export type AnchorCriticFn = (packet: AnchorConfirmationPacket) => Promise<AnchorCriticDecision | null> | AnchorCriticDecision | null;

export const ANCHOR_CRITIC_SYSTEM_PROMPT = `You are Breadboard's source-anchor confirmation critic. A deterministic scorer flagged a GENERATED semantic source anchor as weakly grounded (low confidence). Using ONLY the source passages provided, decide whether the anchor is genuinely supported.

Return ONLY a JSON object with this exact shape:
{
  "anchorId": string,
  "decision": "confirm" | "replace" | "create_better_anchor" | "reject",
  "confidence": "high" | "medium" | "low",
  "reason": one sentence citing the source,
  "confirmedExactText": string,           // REQUIRED for confirm; verbatim source sentence that supports the anchor
  "replacementAnchorId": string,          // REQUIRED for replace; must be one of existingAlternativeAnchors
  "betterAnchor": {                        // REQUIRED for create_better_anchor
    "id": string, "kind": "text"|"abstract"|"intro"|"guidance", "sourceId": string, "page": number,
    "title": string, "exactText": string, "semanticSummary": string, "conceptKeywords": string[]
  },
  "requiredRepairs": [ { "targetKind": "unit_page"|"learning_unit_contract"|"source_anchor_ledger"|"source_coverage", "targetPath"?: string, "instructions": string[] } ]
}

Rules:
- confirm ONLY if a candidate/nearby passage clearly supports the anchor's title and semantic summary; set confidence high|medium and quote the exact supporting sentence in confirmedExactText. Do not confirm on one weak keyword.
- replace when an existing alternative anchor covers the concept better; set replacementAnchorId to its id.
- create_better_anchor when a NEARBY passage supports the concept better than the candidate; provide betterAnchor with a verbatim exactText.
- reject when no passage supports the anchor; provide requiredRepairs describing how to fix the page/contract grounding.
Output JSON only, no prose.`;

export function buildAnchorCriticPrompt(packet: AnchorConfirmationPacket): string {
  return `Judge this low-confidence source anchor. Return one JSON decision object.\n\n${JSON.stringify(packet, null, 1)}`;
}

/** Parse a ChatMock anchor decision. Tolerant of fences / {decision:...} wraps. */
export function parseAnchorCriticDecision(text: string): AnchorCriticDecision | null {
  const stripped = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(stripped); }
  catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { parsed = JSON.parse(match[0]); } catch { return null; }
  }
  const r = parsed as Record<string, unknown>;
  if (!r || typeof r !== "object") return null;
  const decision = String(r.decision ?? "");
  if (!["confirm", "replace", "create_better_anchor", "reject"].includes(decision)) return null;
  const anchorId = String(r.anchorId ?? "").trim();
  if (!anchorId) return null;
  const confidence = ["high", "medium", "low"].includes(String(r.confidence)) ? String(r.confidence) as AnchorCriticDecision["confidence"] : "low";
  return {
    anchorId,
    decision: decision as AnchorCriticDecision["decision"],
    confidence,
    reason: String(r.reason ?? "").trim(),
    confirmedExactText: r.confirmedExactText ? String(r.confirmedExactText) : undefined,
    replacementAnchorId: r.replacementAnchorId ? String(r.replacementAnchorId) : undefined,
    betterAnchor: r.betterAnchor && typeof r.betterAnchor === "object" ? r.betterAnchor as AnchorCriticDecision["betterAnchor"] : undefined,
    requiredRepairs: Array.isArray(r.requiredRepairs) ? r.requiredRepairs as AnchorCriticDecision["requiredRepairs"] : undefined,
  };
}

/** ChatMock-backed anchor confirmation critic (OpenAI-compatible). */
export function createChatMockAnchorCritic(opts: {
  client: ChatCompletionClientLike;
  model: string;
  timeoutMs?: number;
}): AnchorCriticFn {
  return async (packet: AnchorConfirmationPacket): Promise<AnchorCriticDecision | null> => {
    const response = await opts.client.chat.completions.create(
      {
        model: opts.model,
        messages: [
          { role: "system", content: ANCHOR_CRITIC_SYSTEM_PROMPT },
          { role: "user", content: buildAnchorCriticPrompt(packet) },
        ],
        response_format: { type: "json_object" },
      },
      opts.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 0 } : undefined,
    );
    return parseAnchorCriticDecision(response.choices?.[0]?.message?.content ?? "");
  };
}

// ---------------------------------------------------------------------------
// Issue -> repair request mapping
// ---------------------------------------------------------------------------

function repairTargetPath(issue: CriticIssue): string | undefined {
  switch (issue.repairTarget) {
    case "unit_page": return issue.pagePath;
    case "section_index": return issue.sectionPath ?? (issue.pagePath ? `${issue.pagePath.split("/").slice(0, 2).join("/")}/_index.md` : undefined);
    case "visual_spec": return issue.visualId ? `.breadboard/visuals/${issue.visualId}.json` : undefined;
    case "learning_unit_contract": return ".breadboard/learning-unit-contract.json";
    case "source_anchor_ledger": return ".breadboard/source-anchors.json";
    case "source_coverage": return ".breadboard/planning/Source Coverage.md";
    case "repair_log": return ".breadboard/repair-log.json";
    default: return undefined;
  }
}

/** Group blocking issues into targeted repair requests (one per target+path). */
export function criticIssuesToRepairRequests(issues: CriticIssue[]): ArtifactRepairRequest[] {
  const groups = new Map<string, ArtifactRepairRequest>();
  for (const issue of issues) {
    const targetPath = repairTargetPath(issue);
    const key = `${issue.repairTarget}::${targetPath ?? ""}`;
    let req = groups.get(key);
    if (!req) {
      req = {
        id: `repair-${issue.repairTarget}-${groups.size + 1}`,
        issueIds: [],
        targetKind: issue.repairTarget,
        targetPath,
        affectedUnitIds: [],
        affectedAnchorIds: [],
        instructions: [],
        evidence: [],
      };
      groups.set(key, req);
    }
    req.issueIds.push(issue.id);
    if (issue.suggestedRepair) req.instructions.push(issue.suggestedRepair);
    if (issue.evidence) req.evidence.push(issue.evidence);
    for (const id of issue.sourceAnchorIds ?? []) if (!req.affectedAnchorIds!.includes(id)) req.affectedAnchorIds!.push(id);
  }
  return [...groups.values()].map((req) => ({
    ...req,
    affectedUnitIds: req.affectedUnitIds!.length ? req.affectedUnitIds : undefined,
    affectedAnchorIds: req.affectedAnchorIds!.length ? req.affectedAnchorIds : undefined,
  }));
}

// ---------------------------------------------------------------------------
// ChatMock model repair (semantic page/section rewrites)
// ---------------------------------------------------------------------------

/** Semantic critic issue types that a MODEL page/section rewrite handles first;
 *  the deterministic layer only fixes the mechanical classes. */
const MODEL_FIRST_ISSUE_TYPES = new Set<CriticIssueType>([
  "section_index_template_prose",
  "template_zettelkasten_handle",
  "repeated_opening",
  "formula_anchor_mismatch",
  "source_anchor_mismatch",
  "worked_example_misclassified",
  "visual_grounding_mismatch",
]);
const MODEL_FIRST_TARGETS = new Set<CriticRepairTarget>(["unit_page", "section_index"]);

function requestIsModelFirst(req: ArtifactRepairRequest, issuesById?: Map<string, CriticIssue>): boolean {
  if (!MODEL_FIRST_TARGETS.has(req.targetKind)) return false;
  const issues = req.issueIds.map((id) => issuesById?.get(id)).filter(Boolean) as CriticIssue[];
  return issues.length === 0 || issues.some((i) => MODEL_FIRST_ISSUE_TYPES.has(i.type));
}

export const MODEL_REPAIR_SYSTEM_PROMPT = `You repair one file of a Breadboard learning garden to remove a specific semantic issue a critic found. Return ONLY the full revised content of the target file — no commentary, no code fences.

Hard requirements:
- Return the ENTIRE target file, not a diff.
- Preserve the YAML frontmatter block and every required key (title, knowledge_type/breadboardType, learningUnitId, generated_by, tags, sourceAnchors, sourceFormulaAnchors, formulas, visualIds). Change only what the issue requires.
- Preserve source anchors and formula anchors UNLESS the issue is a source/formula anchor mismatch, in which case ground to the correct one named in the issue.
- Preserve every \`\`\`breadboard-visual\`\`\` block verbatim.
- Preserve contract-backed Zettelkasten tags, unless the issue is a template handle — then replace only the flagged handle with a concrete durable claim.
- Remove exactly the flagged issue; do not introduce generic scaffold prose ("introduces the core idea", "so the pieces connect into one picture", "one step at a time").
- Keep the learner-facing voice; never mention "the paper", "the source", or "this document".
Output the revised file content only.`;

export function buildModelRepairPrompt(input: ModelRepairInput): { system: string; user: string } {
  const { issue, repairRequest } = input;
  const user = [
    `Target file: ${repairRequest.targetPath ?? "(unknown)"}`,
    `Issue type: ${issue.type}`,
    `Problem: ${issue.problem}`,
    `Evidence: ${issue.evidence}`,
    `Expected: ${issue.expected}`,
    `Instructions: ${repairRequest.instructions.join(" ") || issue.suggestedRepair}`,
    input.sourceAnchors ? `Relevant source anchors: ${JSON.stringify(input.sourceAnchors).slice(0, 1200)}` : "",
    input.previousPageSummary ? `Previous page: ${input.previousPageSummary}` : "",
    input.nextPageSummary ? `Next page: ${input.nextPageSummary}` : "",
    "",
    "Current file content:",
    "-----",
    input.currentMarkdown ?? "(none)",
    "-----",
    "Return the full revised file content only.",
  ].filter(Boolean).join("\n");
  return { system: MODEL_REPAIR_SYSTEM_PROMPT, user };
}

/** Parse a model repair response into structured output for the target file. */
export function parseModelRepairOutput(text: string, targetPath: string): ModelRepairOutput | null {
  const stripped = String(text ?? "").trim().replace(/^```(?:json|markdown|md)?\s*/i, "").replace(/```$/i, "").trim();
  if (!stripped) return null;
  if (/\.json$/i.test(targetPath)) {
    try {
      return { targetPath, revisedJson: JSON.parse(stripped) };
    } catch {
      return null;
    }
  }
  return { targetPath, revisedMarkdown: stripped };
}

/** ChatMock-backed model repair (OpenAI-compatible chat completion). */
export function createChatMockModelRepair(opts: {
  client: ChatCompletionClientLike;
  model: string;
  timeoutMs?: number;
}): ModelRepairFn {
  return async (input: ModelRepairInput): Promise<ModelRepairOutput | null> => {
    if (!input.repairRequest.targetPath) return null;
    const { system, user } = buildModelRepairPrompt(input);
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
    return parseModelRepairOutput(response.choices?.[0]?.message?.content ?? "", input.repairRequest.targetPath);
  };
}

// ---------------------------------------------------------------------------
// Repair application (model-first for semantics, deterministic for mechanics)
// ---------------------------------------------------------------------------

function pageSummary(state: FinalGardenState, rel: string): string | undefined {
  const page = state.pages.find((p) => p.rel === rel);
  if (!page) return undefined;
  return `${page.title}: ${firstProseParagraphs(page.body, 1).join(" ").slice(0, 160)}`;
}

function adjacentPageSummaries(state: FinalGardenState, rel: string): { previous?: string; next?: string } {
  const ordered = [...state.pages].sort((a, b) => a.rel.localeCompare(b.rel));
  const idx = ordered.findIndex((p) => p.rel === rel);
  if (idx < 0) return {};
  return {
    previous: idx > 0 ? pageSummary(state, ordered[idx - 1].rel) : undefined,
    next: idx < ordered.length - 1 ? pageSummary(state, ordered[idx + 1].rel) : undefined,
  };
}

function buildModelRepairInput(state: FinalGardenState, gardenDir: string, request: ArtifactRepairRequest, issue: CriticIssue): ModelRepairInput {
  const abs = request.targetPath ? path.join(gardenDir, request.targetPath) : undefined;
  const currentMarkdown = abs && fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : undefined;
  const anchorIds = new Set(issue.sourceAnchorIds ?? request.affectedAnchorIds ?? []);
  const relevantAnchors = Object.values(state.sourceAnchors).filter((a) => anchorIds.has(a.id)).slice(0, 8);
  const adj = request.targetPath ? adjacentPageSummaries(state, request.targetPath) : {};
  return {
    issue,
    repairRequest: request,
    finalGardenStateExcerpt: { pages: state.pages.length, anchors: Object.keys(state.sourceAnchors).length },
    currentMarkdown,
    learningUnitContract: undefined,
    sourceAnchors: relevantAnchors.length ? relevantAnchors : undefined,
    previousPageSummary: adj.previous,
    nextPageSummary: adj.next,
  };
}

/** Write and validate a model repair candidate; reverts if it breaks the state. */
function applyModelRepairOutput(gardenDir: string, gardenSlug: string, out: ModelRepairOutput): boolean {
  const abs = path.join(gardenDir, out.targetPath);
  if (!fs.existsSync(path.dirname(abs))) return false;
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : null;
  if (out.revisedMarkdown !== undefined) {
    if (!/^---\r?\n[\s\S]*?\r?\n---/.test(out.revisedMarkdown)) return false; // must keep frontmatter
    if (before !== null && out.revisedMarkdown.trim() === before.trim()) return false;
    fs.writeFileSync(abs, out.revisedMarkdown.endsWith("\n") ? out.revisedMarkdown : `${out.revisedMarkdown}\n`, "utf-8");
  } else if (out.revisedJson !== undefined) {
    fs.writeFileSync(abs, `${JSON.stringify(out.revisedJson, null, 2)}\n`, "utf-8");
  } else {
    return false;
  }
  try {
    buildFinalGardenState(gardenDir, gardenSlug); // sanity: still parses
    return true;
  } catch {
    if (before !== null) fs.writeFileSync(abs, before, "utf-8");
    return false;
  }
}

/** Production repair: MODEL-first for semantic page/section issues, then the
 *  FULL deterministic finalization for mechanical fixes and as a fallback. */
export function makeCriticArtifactRepair(opts: {
  modelRepair?: ModelRepairFn;
  deterministicFinalize?: (gardenDir: string, gardenSlug: string) => void;
} = {}): ArtifactRepairFn {
  const finalize = opts.deterministicFinalize ?? ((gardenDir: string, gardenSlug: string) => {
    try { finalizeGardenExport({ gardenDir, gardenSlug }); }
    catch { try { reconcileFinalGardenState(gardenDir, gardenSlug); } catch { /* best effort */ } }
  });
  return async (gardenDir, gardenSlug, requests, ctx) => {
    const provenance: RepairProvenanceRecord[] = [];
    const handledByModel = new Set<string>();
    if (opts.modelRepair) {
      for (const req of requests) {
        if (!requestIsModelFirst(req, ctx.issuesById)) continue;
        const issue = ctx.issuesById?.get(req.issueIds[0]);
        if (!issue) continue;
        const state = buildFinalGardenState(gardenDir, gardenSlug);
        const attempted: Array<"model" | "deterministic"> = ["model"];
        let used: RepairProvenanceRecord["executorUsed"] = "none";
        let modelFailureReason: string | undefined;
        let changed = false;
        try {
          const out = await Promise.resolve(opts.modelRepair(buildModelRepairInput(state, gardenDir, req, issue)));
          if (out && applyModelRepairOutput(gardenDir, gardenSlug, out)) { used = "model"; changed = true; }
          else modelFailureReason = "model returned no valid candidate";
        } catch (error) {
          modelFailureReason = error instanceof Error ? error.message : String(error);
        }
        if (!changed) attempted.push("deterministic"); // deterministic finalize below is the fallback
        provenance.push({ requestId: req.id, targetKind: req.targetKind, targetPath: req.targetPath, executorAttempted: attempted, executorUsed: used, modelFailureReason, changed });
        handledByModel.add(req.id);
      }
    }
    // Deterministic finalization: mechanical fixes + fallback for failed model repairs.
    finalize(gardenDir, gardenSlug);
    for (const p of provenance) {
      if (p.executorUsed === "none") p.executorUsed = "deterministic"; // finalize was the fallback
    }
    for (const req of requests) {
      if (handledByModel.has(req.id)) continue;
      provenance.push({ requestId: req.id, targetKind: req.targetKind, targetPath: req.targetPath, executorAttempted: ["deterministic"], executorUsed: "deterministic", changed: true });
    }
    return { attempted: requests.length, resolved: 0, provenance };
  };
}

/** Backward-compatible default: deterministic finalization only (no model). */
export function makeDefaultArtifactRepair(): ArtifactRepairFn {
  return makeCriticArtifactRepair();
}

// ---------------------------------------------------------------------------
// Issue-resolution tracking (direct, not inferred from count drops)
// ---------------------------------------------------------------------------

function issueTargetKey(i: CriticIssue): string {
  return `${i.repairTarget}::${i.pagePath ?? i.sectionPath ?? i.visualId ?? ""}`;
}

/** Match previous-round issues against the next round's issues to classify each
 *  as resolved / still_present / replaced_by_new_issue. */
export function computeIssueResolutions(
  previous: CriticIssue[],
  next: CriticIssue[],
  requestsByIssueId?: Map<string, string>,
): CriticIssueResolution[] {
  const nextByTarget = new Map<string, CriticIssue[]>();
  for (const c of next) {
    const key = issueTargetKey(c);
    (nextByTarget.get(key) ?? nextByTarget.set(key, []).get(key)!).push(c);
  }
  return previous.map((p) => {
    const base = { issueId: p.id, originalIssue: p, repairRequestId: requestsByIssueId?.get(p.id) };
    if (next.some((c) => c.id === p.id)) return { ...base, status: "still_present", evidence: p.evidence };
    const sameTypeTarget = next.find((c) => c.type === p.type && issueTargetKey(c) === issueTargetKey(p));
    if (sameTypeTarget) return { ...base, status: "still_present", evidence: sameTypeTarget.evidence };
    const sameTargetDiffType = (nextByTarget.get(issueTargetKey(p)) ?? []).find((c) => c.type !== p.type);
    if (sameTargetDiffType) return { ...base, status: "replaced_by_new_issue", evidence: sameTargetDiffType.problem };
    return { ...base, status: "resolved" };
  });
}

// ---------------------------------------------------------------------------
// The critic loop
// ---------------------------------------------------------------------------

export interface RunCriticLoopArgs {
  gardenDir: string;
  gardenSlug: string;
  critic: CriticFn;
  /** ChatMock anchor-confirmation critic for low-confidence source anchors. When
   *  absent, low-confidence anchors remain blocking (still surfaced as issues). */
  anchorConfirm?: AnchorCriticFn;
  options?: Partial<CriticLoopOptions>;
  repair?: ArtifactRepairFn;
  deterministicPass?: boolean;
  /** True when finalize reported a structural/critical problem (draft may be
   *  unusable); drives the publish_failed_structural lifecycle. */
  structuralFailure?: boolean;
  writeReports?: boolean;
}

function finalizeStatus(args: {
  draftGenerated: boolean;
  deterministicPass: boolean;
  structuralFailure: boolean;
  strictPublish: boolean;
  criticEnabled: boolean;
  criticRan: boolean;
  criticErrored: boolean;
  criticErrorMessage?: string;
  blocking: CriticIssue[];
  warnings: CriticIssue[];
  roundsUsed: number;
  unresolvedLowConfidenceAnchors: number;
}): GardenAcceptanceStatus {
  const availability: CriticAvailabilityStatus = !args.criticEnabled
    ? "disabled"
    : args.criticErrored
      ? (args.criticRan ? "errored" : "unavailable")
      : "available";
  const criticAvailable = availability === "available";
  // In strict mode the critic is REQUIRED for publish-readiness, whether it is
  // disabled, unreachable, or errored.
  const criticRequired = args.strictPublish;
  const criticPass = args.criticRan && !args.criticErrored && args.blocking.length === 0;

  const publishReady = args.structuralFailure
    ? false
    : args.strictPublish
      ? args.deterministicPass && args.criticRan && criticPass && args.blocking.length === 0
      : args.deterministicPass;

  const lifecycleStatus: GardenLifecycleStatus = args.structuralFailure
    ? "publish_failed_structural"
    : publishReady
      ? "publish_ready"
      : "needs_review";

  const reason = args.structuralFailure
    ? "publish_failed_structural"
    : args.unresolvedLowConfidenceAnchors > 0 && !criticAvailable
      ? "critic_unavailable_with_unresolved_anchor"
      : !args.deterministicPass
        ? (args.unresolvedLowConfidenceAnchors > 0 ? "unresolved_low_confidence_anchor" : "deterministic_validation_failed")
        : publishReady
          ? undefined
          : !criticAvailable
            ? "critic_unavailable"
            : args.unresolvedLowConfidenceAnchors > 0
              ? "unresolved_low_confidence_anchor"
              : "unresolved_critic_issues";

  return {
    draftGenerated: args.draftGenerated,
    accepted: publishReady,
    publishReady,
    lifecycleStatus,
    deterministicPass: args.deterministicPass,
    criticRequired,
    criticAvailable,
    criticRan: args.criticRan,
    criticPass,
    criticAvailabilityStatus: availability,
    criticUnavailableReason: criticAvailable || !args.criticEnabled ? undefined : (args.criticErrorMessage ?? "critic did not run"),
    unresolvedBlockingIssues: args.blocking,
    warnings: args.warnings,
    repairRoundsUsed: args.roundsUsed,
    reason,
  };
}

export async function runCriticLoop(args: RunCriticLoopArgs): Promise<CriticLoopResult> {
  const options: CriticLoopOptions = { ...DEFAULT_CRITIC_LOOP_OPTIONS, ...(args.options ?? {}) };
  const repair = args.repair ?? makeDefaultArtifactRepair();
  const rounds: CriticRoundRecord[] = [];
  const draftGenerated = fs.existsSync(path.join(args.gardenDir, "learning"));
  const detPass = () => args.deterministicPass ?? auditFinalGardenState(buildFinalGardenState(args.gardenDir, args.gardenSlug)).ok;

  const anchorCountNow = (): number => {
    try { return unresolvedLowConfidenceAnchorIds(buildFinalGardenState(args.gardenDir, args.gardenSlug)).length; }
    catch { return 0; }
  };

  const finish = (blocking: CriticIssue[], warnings: CriticIssue[], criticRan: boolean, criticErrored: boolean, criticErrorMessage?: string): CriticLoopResult => {
    const status = finalizeStatus({
      draftGenerated,
      deterministicPass: detPass(),
      structuralFailure: Boolean(args.structuralFailure),
      strictPublish: options.strictPublish,
      criticEnabled: options.enabled,
      criticRan,
      criticErrored,
      criticErrorMessage,
      blocking,
      warnings,
      roundsUsed: rounds.length,
      unresolvedLowConfidenceAnchors: anchorCountNow(),
    });
    const result: CriticLoopResult = { status, rounds, finalBlockingIssues: blocking, finalWarnings: warnings };
    if (args.writeReports !== false) writeCriticReports(args.gardenDir, result);
    return result;
  };

  if (!options.enabled) return finish([], [], false, false);

  // Merge deterministic low-confidence anchor issues with the ChatMock critic's
  // issues for a round; anchor issues sort first and win id collisions.
  const reviewIssues = (state: FinalGardenState, criticIssues: CriticIssue[]): CriticIssue[] => {
    const merged = [...anchorEvidenceCriticIssues(state), ...criticIssues];
    const seen = new Set<string>();
    const out: CriticIssue[] = [];
    for (const issue of merged) { if (seen.has(issue.id)) continue; seen.add(issue.id); out.push(issue); }
    return out;
  };

  let totalAttempts = 0;
  let prevBlocking: CriticIssue[] | null = null;
  let prevRequestsByIssue = new Map<string, string>();
  let prevRoundIdx = -1;
  let endedClean = false;
  let lastBlocking: CriticIssue[] = [];
  let lastWarnings: CriticIssue[] = [];

  for (let round = 1; round <= options.maxRounds; round += 1) {
    const state = buildFinalGardenState(args.gardenDir, args.gardenSlug);
    const anchorIssues = anchorEvidenceCriticIssues(state);
    const packet = buildCriticReviewPacket(state);
    let criticIssues: CriticIssue[];
    try {
      criticIssues = (await Promise.resolve(args.critic(packet))).slice(0, options.maxIssuesPerRound);
    } catch (error) {
      // Prose critic unavailable — low-confidence anchors still block.
      return finish([...(prevBlocking ?? []), ...anchorIssues.filter((a) => !(prevBlocking ?? []).some((p) => p.id === a.id))], lastWarnings, round > 1, true, error instanceof Error ? error.message : String(error));
    }
    const issues = reviewIssues(state, criticIssues);
    const blocking = issues.filter((i) => i.severity === "blocking");
    const warnings = issues.filter((i) => i.severity === "warning");
    lastBlocking = blocking;
    lastWarnings = warnings;

    // Directly classify the previous round's issues against this fresh review.
    if (prevBlocking && prevRoundIdx >= 0) {
      const resolutions = computeIssueResolutions(prevBlocking, blocking, prevRequestsByIssue);
      rounds[prevRoundIdx].resolutions = resolutions;
      rounds[prevRoundIdx].repairsResolved = resolutions.filter((r) => r.status === "resolved").length;
    }

    if (blocking.length === 0) {
      rounds.push({ round, blockingIssues: 0, warnings: warnings.length, repairsAttempted: 0, repairsResolved: 0, issueTypes: [], resolutions: [], provenance: [] });
      endedClean = true;
      break;
    }
    if (totalAttempts >= options.maxTotalRepairAttempts) {
      rounds.push({ round, blockingIssues: blocking.length, warnings: warnings.length, repairsAttempted: 0, repairsResolved: 0, issueTypes: [...new Set(blocking.map((i) => i.type))], resolutions: [], provenance: [] });
      break;
    }

    // Route low-confidence anchor issues to the anchor-confirmation critic; the
    // rest go to the generic (model-first) repair.
    const anchorBlocking = blocking.filter((i) => i.id.startsWith(ANCHOR_EVIDENCE_ISSUE_PREFIX));
    const genericBlocking = blocking.filter((i) => !i.id.startsWith(ANCHOR_EVIDENCE_ISSUE_PREFIX));

    let anchorDecisions: AppliedAnchorDecision[] = [];
    if (anchorBlocking.length > 0 && args.anchorConfirm) {
      try {
        anchorDecisions = await applyAnchorDecisions(args.gardenDir, args.gardenSlug, args.anchorConfirm, state);
      } catch (error) {
        // Anchor critic unavailable — keep the anchors blocking.
        return finish(blocking, warnings, true, true, error instanceof Error ? error.message : String(error));
      }
      // Rebuild derived artifacts + evidence report after applying decisions.
      try { reconcileFinalGardenState(args.gardenDir, args.gardenSlug); } catch { /* best effort */ }
    }

    // Fix 6: rejected (unsupported) anchors become targeted page-repair requests
    // so model repair can reground/revise the page. If model repair is
    // unavailable they simply do not resolve and the anchor stays blocking.
    const rejectedRequests: ArtifactRepairRequest[] = anchorDecisions
      .filter((d) => d.decision === "reject")
      .flatMap((d) => (d.rejectedRepairRequests ?? [])
        .filter((rr) => rr.targetKind === "unit_page")
        .flatMap((rr) => rr.affectedPages.map((pagePath, idx) => ({
          id: `reject-${rr.rejectedAnchorId}-${idx}`,
          issueIds: [`${ANCHOR_EVIDENCE_ISSUE_PREFIX}${rr.rejectedAnchorId}`],
          targetKind: "unit_page" as CriticRepairTarget,
          targetPath: pagePath,
          affectedAnchorIds: [rr.rejectedAnchorId],
          instructions: rr.instructions,
          evidence: [`Rejected unsupported anchor ${rr.rejectedAnchorId}; reground or revise this page.`],
        }))));

    const requestsByIssue = new Map<string, string>();
    let outcome: CriticRepairOutcome = { attempted: 0, resolved: 0, provenance: [] };
    const genericRequests = genericBlocking.length > 0 ? criticIssuesToRepairRequests(genericBlocking) : [];
    const allRequests = [...genericRequests, ...rejectedRequests].slice(0, options.maxTotalRepairAttempts - totalAttempts);
    if (allRequests.length > 0) {
      const issuesById = new Map(blocking.map((i) => [i.id, i]));
      for (const r of allRequests) for (const iid of r.issueIds) requestsByIssue.set(iid, r.id);
      outcome = await Promise.resolve(repair(args.gardenDir, args.gardenSlug, allRequests, { round, issuesById }));
    }
    const anchorAttempts = anchorDecisions.filter((d) => d.applied).length;
    totalAttempts += outcome.attempted + anchorAttempts;
    rounds.push({
      round, blockingIssues: blocking.length, warnings: warnings.length,
      repairsAttempted: outcome.attempted + anchorAttempts, repairsResolved: 0,
      issueTypes: [...new Set(blocking.map((i) => i.type))],
      resolutions: [], provenance: outcome.provenance ?? [],
      ...(anchorDecisions.length ? { anchorDecisions } : {}),
    });
    prevBlocking = blocking;
    prevRequestsByIssue = requestsByIssue;
    prevRoundIdx = rounds.length - 1;
  }

  // If the loop repaired in its final iteration but never re-reviewed, do ONE
  // measurement review so finalBlockingIssues reflects the post-repair state and
  // the last repair round gets accurate resolution accounting.
  if (!endedClean && prevBlocking && prevRoundIdx >= 0 && rounds[prevRoundIdx].resolutions.length === 0) {
    try {
      const state = buildFinalGardenState(args.gardenDir, args.gardenSlug);
      const finalIssues = reviewIssues(state, (await Promise.resolve(args.critic(buildCriticReviewPacket(state)))).slice(0, options.maxIssuesPerRound));
      lastBlocking = finalIssues.filter((i) => i.severity === "blocking");
      lastWarnings = finalIssues.filter((i) => i.severity === "warning");
      const resolutions = computeIssueResolutions(prevBlocking, lastBlocking, prevRequestsByIssue);
      rounds[prevRoundIdx].resolutions = resolutions;
      rounds[prevRoundIdx].repairsResolved = resolutions.filter((r) => r.status === "resolved").length;
    } catch (error) {
      return finish(lastBlocking, lastWarnings, true, true, error instanceof Error ? error.message : String(error));
    }
  }

  return finish(lastBlocking, lastWarnings, true, false);
}

/** Build a decision packet per unresolved low-confidence anchor, ask the critic,
 *  and apply each structured decision. Throws if the critic itself is
 *  unavailable so the loop can mark the run critic-errored. */
async function applyAnchorDecisions(
  gardenDir: string,
  gardenSlug: string,
  anchorConfirm: AnchorCriticFn,
  state: FinalGardenState,
): Promise<AppliedAnchorDecision[]> {
  const packets = buildAnchorConfirmationPackets(gardenDir, state);
  const applied: AppliedAnchorDecision[] = [];
  for (const packet of packets) {
    const decision = await Promise.resolve(anchorConfirm(packet));
    if (!decision) {
      applied.push({ anchorId: packet.anchor.id, decision: "reject", applied: false, reason: "critic returned no decision", changed: [], invalidReason: "no_decision" });
      continue;
    }
    applied.push(applyAnchorCriticDecision(gardenDir, gardenSlug, decision));
  }
  return applied;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function writeCriticReports(gardenDir: string, result: CriticLoopResult): void {
  const bd = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(bd, { recursive: true });

  fs.writeFileSync(path.join(bd, "acceptance-status.json"), `${JSON.stringify(result.status, null, 2)}\n`, "utf-8");

  fs.writeFileSync(
    path.join(bd, "critic-issues.json"),
    `${JSON.stringify({ blocking: result.finalBlockingIssues, warnings: result.finalWarnings }, null, 2)}\n`,
    "utf-8",
  );

  const s = result.status;
  const loop = {
    enabled: s.criticAvailabilityStatus !== "disabled",
    criticAvailabilityStatus: s.criticAvailabilityStatus,
    criticRequired: s.criticRequired,
    lifecycleStatus: s.lifecycleStatus,
    rounds: result.rounds.map((r) => ({
      round: r.round,
      blockingIssues: r.blockingIssues,
      warnings: r.warnings,
      repairsAttempted: r.repairsAttempted,
      repairsResolved: r.repairsResolved,
      resolutions: r.resolutions.map((res) => ({ issueId: res.issueId, type: res.originalIssue.type, target: res.originalIssue.repairTarget, status: res.status, repairRequestId: res.repairRequestId })),
      provenance: r.provenance,
      ...(r.anchorDecisions && r.anchorDecisions.length
        ? { anchorDecisions: r.anchorDecisions.map((d) => ({
            anchorId: d.anchorId,
            decision: d.decision,
            applied: d.applied,
            ...(d.replacementAnchorId ? { replacementAnchorId: d.replacementAnchorId } : {}),
            ...(d.betterAnchorId ? { betterAnchorId: d.betterAnchorId } : {}),
            ...(d.createdAnchorId ? { createdAnchorId: d.createdAnchorId } : {}),
            ...(d.verification ? { verification: { matchType: d.verification.matchType, ok: d.verification.ok, similarity: d.verification.similarity, page: d.verification.page } } : {}),
            ...(d.relevance ? { relevance: { decision: d.relevance.decision, ok: d.relevance.ok, anchorFamily: d.relevance.anchorFamily, textFamily: d.relevance.textFamily, wrongFamilyPenalty: d.relevance.wrongFamilyPenalty, totalScore: d.relevance.totalScore, reason: d.relevance.reason } } : {}),
            ...(d.semanticCompatibility ? { semanticCompatibility: d.semanticCompatibility } : {}),
            ...(d.followUpIssue ? { followUpIssue: true } : {}),
            ...(d.invalidReason ? { invalidReason: d.invalidReason } : {}),
          })) }
        : {}),
    })),
    finalBlockingIssues: result.finalBlockingIssues.length,
    publishReady: s.publishReady,
    ...(result.finalBlockingIssues.length > 0 ? { unresolvedBlockingIssues: result.finalBlockingIssues } : {}),
  };
  fs.writeFileSync(path.join(bd, "critic-loop.json"), `${JSON.stringify(loop, null, 2)}\n`, "utf-8");

  const lines = [
    "# Breadboard Critic Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Lifecycle status: ${s.lifecycleStatus}`,
    `Draft generated: ${s.draftGenerated ? "yes" : "no"}`,
    `Deterministic validation: ${s.deterministicPass ? "pass" : "fail"}`,
    `Critic validation: ${s.criticPass ? "pass" : s.criticAvailabilityStatus === "available" ? "fail" : s.criticAvailabilityStatus}`,
    `Critic required (strict): ${s.criticRequired ? "yes" : "no"}`,
    `Critic availability: ${s.criticAvailabilityStatus}${s.criticUnavailableReason ? ` (${s.criticUnavailableReason})` : ""}`,
    `Blocking issues: ${result.finalBlockingIssues.length}`,
    `Warnings: ${result.finalWarnings.length}`,
    `Repair rounds used: ${s.repairRoundsUsed}`,
    `Publish-ready: ${s.publishReady ? "yes" : "no"}`,
    `Accepted: ${s.accepted ? "yes" : "no"}`,
    ...(s.reason ? [`Reason: ${s.reason}`] : []),
    "",
    "## Rounds",
    "",
    "| Round | Blocking | Warnings | Repairs attempted | Resolved | Still present | Replaced |",
    "|---|---|---|---|---|---|---|",
    ...(result.rounds.length > 0
      ? result.rounds.map((r) => {
          const still = r.resolutions.filter((x) => x.status === "still_present").length;
          const repl = r.resolutions.filter((x) => x.status === "replaced_by_new_issue").length;
          return `| ${r.round} | ${r.blockingIssues} | ${r.warnings} | ${r.repairsAttempted} | ${r.repairsResolved} | ${still} | ${repl} |`;
        })
      : ["| — | — | — | — | — | — | — |"]),
    "",
    "## Unresolved blocking issues",
    "",
    ...(result.finalBlockingIssues.length > 0
      ? result.finalBlockingIssues.flatMap((i) => [
          `- **[${i.type}]** ${i.problem}`,
          `  - Where: ${i.pagePath ?? i.sectionPath ?? i.visualId ?? "global"}`,
          ...(i.sourceAnchorIds && i.sourceAnchorIds.length ? [`  - Source anchors: ${i.sourceAnchorIds.join(", ")}`] : []),
          `  - Evidence: ${i.evidence}`,
          `  - Expected: ${i.expected}`,
          `  - Repair target: ${i.repairTarget}`,
        ])
      : ["- None."]),
    "",
    "## Warnings",
    "",
    ...(result.finalWarnings.length > 0
      ? result.finalWarnings.map((i) => `- **[${i.type}]** ${i.problem} (${i.pagePath ?? i.sectionPath ?? "global"})`)
      : ["- None."]),
    "",
    "## Anchor Confirmation Decisions",
    "",
    ...(() => {
      const decisions = result.rounds.flatMap((r) => (r.anchorDecisions ?? []).map((d) => ({ round: r.round, d })));
      if (decisions.length === 0) return ["- None."];
      return decisions.map(({ round, d }) =>
        `- Round ${round}: **${d.anchorId}** → ${d.decision}${d.applied ? "" : " (not applied)"}${d.replacementAnchorId ? ` → ${d.replacementAnchorId}` : ""}${d.betterAnchorId ? ` → ${d.betterAnchorId}` : ""}${d.verification ? ` [source: ${d.verification.matchType}]` : ""}${d.relevance ? ` [relevance: ${d.relevance.decision}]` : ""}${d.semanticCompatibility ? ` [compat: ${d.semanticCompatibility.ok ? "ok" : "incompatible"}]` : ""}${d.invalidReason ? ` [${d.invalidReason}]` : ""}${d.reason ? ` — ${d.reason}` : ""}`,
      );
    })(),
    "",
    "## Anchor Decision Verification",
    "",
    "| Anchor | Decision | Applied | Source Text Match | Relevance | Compatibility | Reason |",
    "|---|---|---:|---|---|---|---|",
    ...(() => {
      const decisions = result.rounds.flatMap((r) => r.anchorDecisions ?? []);
      if (decisions.length === 0) return ["| — | — | — | — | — | — | — |"];
      return decisions.map((d) => `| ${d.anchorId} | ${d.decision} | ${d.applied ? "yes" : "no"} | ${d.verification ? d.verification.matchType : (d.decision === "replace" ? "n/a" : "—")} | ${d.relevance ? d.relevance.decision : "—"} | ${d.semanticCompatibility ? (d.semanticCompatibility.ok ? "ok" : "incompatible") : "—"} | ${(d.invalidReason ?? d.reason ?? "").replace(/\|/g, "\\|").slice(0, 80)} |`);
    })(),
    "",
  ];
  fs.writeFileSync(path.join(bd, "critic-report.md"), `${lines.join("\n")}\n`, "utf-8");

  // Surface the publish-readiness verdict inside the deterministic validation
  // report so a critic-blocked garden is never presented as fully accepted.
  const reportPath = path.join(bd, "validation-report.md");
  if (fs.existsSync(reportPath)) {
    let report = fs.readFileSync(reportPath, "utf-8").replace(/\n## Critic Publish Readiness[\s\S]*$/m, "").replace(/\s+$/, "");
    report += [
      "",
      "",
      "## Critic Publish Readiness",
      "",
      `Lifecycle status: ${s.lifecycleStatus}`,
      `Deterministic validation: ${s.deterministicPass ? "pass" : "fail"}`,
      `Critic validation: ${s.criticPass ? "pass" : s.criticAvailabilityStatus === "available" ? "fail" : s.criticAvailabilityStatus}`,
      `Publish-ready: ${s.publishReady ? "yes" : "no"}`,
      `Blocking issues: ${result.finalBlockingIssues.length}, Warnings: ${result.finalWarnings.length}`,
      ...(s.reason ? [`Reason: ${s.reason}`] : []),
      "",
    ].join("\n");
    fs.writeFileSync(reportPath, `${report}\n`, "utf-8");
  }
}
