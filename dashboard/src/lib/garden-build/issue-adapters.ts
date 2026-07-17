import type { CriticIssue, CriticLoopResult } from "../critic-loop.ts";
import type { FormulaProjectionReconciliationResult } from "../formula-usage-reconciliation.ts";
import type { FinalizeAuditResult, FinalRepairIssue } from "../garden-finalize.ts";
import type { SemanticIssue, SemanticReconciliationResult } from "../semantic-reconciliation.ts";
import type { WeakAnchorSelfHealingResult } from "../weak-anchor-self-healing.ts";
import { stableGardenIssueId } from "./issue-identity.ts";
import type { GardenIssue, GardenIssueBase, GardenIssueRepairClass, GardenIssueSeverity, GardenIssueTarget } from "./issues.ts";
import type { GardenBuildStage } from "./types.ts";
import { pageIdForUnit } from "./ids.ts";

export interface LegacyIssueAdapterContext {
  pageIdByLegacyPath?: Record<string, string>;
  unitIdByLegacyPath?: Record<string, string>;
  defaultStage?: GardenBuildStage;
}

export interface LegacyFinalizeCheck {
  name: string;
  status: string;
  problems: string[];
}

function makeIssue(input: {
  type: GardenIssue["type"];
  severity?: GardenIssueSeverity;
  repairClass?: GardenIssueRepairClass;
  stage?: GardenBuildStage;
  target?: GardenIssueTarget;
  evidence: Record<string, unknown>;
  detectedBy: string;
}): GardenIssue {
  const base: Omit<GardenIssueBase, "issueId"> = {
    type: input.type, severity: input.severity ?? "blocking", repairClass: input.repairClass ?? "deterministic",
    stage: input.stage ?? "repair", target: input.target ?? {}, evidence: input.evidence, detectedBy: [input.detectedBy],
  };
  return { ...base, issueId: stableGardenIssueId(base) } as GardenIssue;
}

function semanticType(issue: SemanticIssue): GardenIssue["type"] {
  if (issue.type === "tag_projection_mismatch") return "tag_projection";
  if (issue.type.includes("claim")) return "claim_page_mapping";
  if (issue.type === "concept_registry_stale_reference") return "concept_reference";
  if (issue.type === "report_serialization_failure") return "report_serialization";
  return "unit_page_mapping";
}

export function issuesFromSemanticReconciliation(
  input: SemanticIssue[] | SemanticReconciliationResult,
  context: LegacyIssueAdapterContext = {},
): GardenIssue[] {
  const issues = Array.isArray(input) ? input : input.issuesAfter;
  return issues.map((entry) => makeIssue({
    type: semanticType(entry), target: {
      unitId: entry.unitId, claimId: entry.claimId, conceptId: entry.conceptId,
      pageId: entry.pagePath ? context.pageIdByLegacyPath?.[entry.pagePath] : undefined,
    }, evidence: { ...entry.evidence, semanticCategory: entry.type, sourceIssueId: entry.issueId, legacyPagePath: entry.pagePath },
    detectedBy: "semantic_reconciliation",
  }));
}

function finalIssueType(entry: FinalRepairIssue): GardenIssue["type"] {
  const message = entry.message.toLowerCase();
  if (entry.type === "formula_usage_projection") return "formula_usage_projection";
  if (entry.type === "formula_kind_misclassification" || entry.type === "formula_metadata_noise") return "formula_lineage_missing";
  if (entry.type === "source_anchor_missing") return "missing_source_anchor";
  if (entry.type === "source_anchor_mismatch") return "contract_page_anchor_mismatch";
  if (entry.type === "visual_grounding") {
    if (message.includes("duplicate") && message.includes("visual signature")) return "duplicate_visual_signature";
    if (message.includes("missing planned visual") || message.includes("required visual") && message.includes("missing")) return "missing_planned_visual";
    if (message.includes("type mismatch") || message.includes("incompatible visual")) return "visual_type_mismatch";
    return "visual_grounding_mismatch";
  }
  if (entry.type === "section_semantics") return "section_semantic_mismatch";
  if (message.includes("scaffold") || message.includes("placeholder prose")) return "scaffold_prose";
  if (message.includes("repeated opening") || message.includes("repeated motivation")) return "repeated_opening";
  if (entry.type === "structural_integrity") return "unit_page_mapping";
  return "report_serialization";
}

function repairClass(entry: FinalRepairIssue): GardenIssueRepairClass {
  if (entry.repairMode === "chatmock") return "model";
  if (entry.repairMode === "deterministic_then_chatmock") return "deterministic_then_model";
  if (entry.repairMode === "non_repairable") return "non_repairable";
  return "deterministic";
}

export function issuesFromFormulaReconciliation(
  result: FormulaProjectionReconciliationResult,
  context: LegacyIssueAdapterContext = {},
): GardenIssue[] {
  return result.unresolvedIssues.map((entry) => makeIssue({
    type: finalIssueType(entry), severity: entry.severity, repairClass: repairClass(entry),
    target: { formulaAnchorId: entry.anchorId, anchorId: entry.anchorId, unitId: entry.unitId, pageId: entry.pagePath ? context.pageIdByLegacyPath?.[entry.pagePath] : undefined },
    evidence: { ...entry.evidence, semanticCategory: entry.type, sourceIssueId: entry.id, legacyPagePath: entry.pagePath },
    detectedBy: "formula_usage_reconciliation",
  }));
}

export function issuesFromWeakAnchorHealing(result: WeakAnchorSelfHealingResult): GardenIssue[] {
  return result.unresolvedActiveAnchorIds.map((anchorId) => makeIssue({
    type: "weak_source_anchor", repairClass: result.criticAvailable ? "deterministic_then_model" : "model",
    target: { anchorId }, evidence: { failureReason: "unresolved_active_anchor", semanticCategory: "unresolved_active_anchor", criticAvailable: result.criticAvailable },
    detectedBy: "weak_anchor_self_healing",
  }));
}

export function issuesFromFinalGardenAudit(audit: FinalizeAuditResult, context: LegacyIssueAdapterContext = {}): GardenIssue[] {
  return [...audit.repairableIssues, ...audit.nonRepairableIssues].map((entry) => makeIssue({
    type: finalIssueType(entry), severity: entry.severity, repairClass: repairClass(entry),
    target: {
      anchorId: entry.anchorId,
      formulaAnchorId: entry.anchorId,
      unitId: entry.unitId,
      pageId: (entry.pagePath ? context.pageIdByLegacyPath?.[entry.pagePath] : undefined) ?? (entry.unitId ? pageIdForUnit(entry.unitId) : undefined),
      visualId: entry.message.match(/(?:^|[: ,])(vis[-_][A-Za-z0-9_-]+)/)?.[1],
    },
    evidence: {
      ...entry.evidence, semanticCategory: entry.type, sourceIssueId: entry.id, legacyPagePath: entry.pagePath,
      legacyStringAdapter: true, originalProblem: entry.message,
      visualIds: [...entry.message.matchAll(/(?:^|[: ,])(vis[-_][A-Za-z0-9_-]+)/g)].map((match) => match[1]),
    }, detectedBy: "final_garden_audit",
  }));
}

function criticIssue(entry: CriticIssue, severity: GardenIssueSeverity, context: LegacyIssueAdapterContext): GardenIssue {
  const legacyPath = entry.pagePath ?? entry.sectionPath;
  return makeIssue({
    type: "critic_semantic", severity, repairClass: "model",
    target: { anchorId: entry.sourceAnchorIds?.[0], visualId: entry.visualId, pageId: legacyPath ? context.pageIdByLegacyPath?.[legacyPath] : undefined },
    evidence: { semanticCategory: entry.type, sourceIssueId: entry.id, legacyPath, problem: entry.problem, expected: entry.expected },
    detectedBy: "critic_loop",
  });
}

export function issuesFromCriticLoop(result: CriticLoopResult, context: LegacyIssueAdapterContext = {}): GardenIssue[] {
  return [
    ...result.finalBlockingIssues.map((entry) => criticIssue(entry, "blocking", context)),
    ...result.finalWarnings.map((entry) => criticIssue(entry, "warning", context)),
  ];
}

export function legacyFinalizeProblemsToIssues(
  checks: LegacyFinalizeCheck[],
  context: LegacyIssueAdapterContext = {},
): GardenIssue[] {
  const issues: GardenIssue[] = [];
  for (const check of checks) {
    if (check.status !== "FAIL") continue;
    for (const problem of check.problems) {
      const legacyPath = problem.match(/learning\/[^:]+?\.md/)?.[0];
      const formulaAnchorId = problem.match(/\bS\d+\.P\d+\.E\d+\b/i)?.[0];
      const anchorId = formulaAnchorId ?? problem.match(/\b(?:text|source)-[a-z0-9-]+\b/i)?.[0];
      const lower = check.name.toLowerCase();
      const type: GardenIssue["type"] = formulaAnchorId ? "formula_usage_projection"
        : lower.includes("visual") ? "visual_grounding"
          : lower.includes("section") ? "section_semantic"
            : anchorId ? "missing_source_anchor"
              : "unit_page_mapping";
      issues.push(makeIssue({
        type, repairClass: "non_repairable", stage: context.defaultStage ?? "repair",
        target: { anchorId, formulaAnchorId, pageId: legacyPath ? context.pageIdByLegacyPath?.[legacyPath] : undefined, unitId: legacyPath ? context.unitIdByLegacyPath?.[legacyPath] : undefined },
        evidence: { legacyStringAdapter: true, originalCheckName: check.name, originalProblem: problem, legacyPath, semanticCategory: type },
        detectedBy: "legacy_finalize_adapter",
      }));
    }
  }
  return issues;
}
