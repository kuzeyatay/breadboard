import crypto from "node:crypto";
import { IMPLEMENTED_VISUAL_TYPES, validateVisualSpec } from "../visual-spec.ts";
import type { StartLearnOperationRequest } from "../learn-operation-mode.ts";
import type { GardenIssue } from "./issues.ts";
import { validateGardenBuildOperation } from "./operation-validation.ts";
import type { GardenBuildOperation } from "./operations.ts";
import type { GardenBuildState } from "./types.ts";

export type LearnProjectionRebuild =
  | "page_frontmatter"
  | "contract"
  | "claims"
  | "concepts"
  | "visual_index"
  | "source_coverage"
  | "navigation"
  | "validation_reports"
  | "acceptance_status";

export interface LearnRepairScope {
  repairId: string;
  gardenId: string;
  sourceBuildId: string;
  sourceStateFingerprint: string;
  issueIds: string[];
  unitIds: string[];
  pageIds: string[];
  sectionIds: string[];
  anchorIds: string[];
  formulaAssignmentIds: string[];
  visualIds: string[];
  requiredProjectionRebuilds: LearnProjectionRebuild[];
  allowedSemanticOperations: GardenBuildOperation[];
  allowPageBodyRewrite: boolean;
  allowSectionMove: boolean;
  allowContractMutation: boolean;
  explicitlyExcludedPageIds: string[];
}

export interface LearnScopedRepairTransaction {
  repairId: string;
  scope: LearnRepairScope;
  fingerprintBefore: string;
  fingerprintAfter?: string;
  fileFingerprintsBefore: Record<string, string>;
  fileFingerprintsAfter?: Record<string, string>;
  operations: GardenBuildOperation[];
  modelCalls: number;
  verifiedModelDecisions: number;
  rejectedModelDecisions: number;
  blockersBefore: string[];
  blockersAfter: string[];
  committed: boolean;
  rolledBack: boolean;
  reason: string;
}

export interface ScopedRepairLoopOptions {
  maxRounds: number;
  maxIssuesPerRound: number;
  maxModelCalls: number;
  autoExpandDirectDependencies: boolean;
}

export const DEFAULT_SCOPED_REPAIR_LOOP_OPTIONS: ScopedRepairLoopOptions = {
  maxRounds: 3,
  maxIssuesPerRound: 12,
  maxModelCalls: 6,
  autoExpandDirectDependencies: true,
};

export interface VerifiedScopedRepairDecision {
  valid: boolean;
  operations: GardenBuildOperation[];
  reason: string;
}

export interface VisualTypeCapability {
  type: string;
  implemented: boolean;
}

export interface ScopedVisualRepairPacket {
  issueId: string;
  unit: { id: string; title: string; learningQuestion: string };
  currentVisualIntent: { id: string; type: string; pageId?: string; unitId?: string };
  currentSpec?: unknown;
  validationProblems: string[];
  supportedCapabilities: VisualTypeCapability[];
  relevantSourceAnchors: unknown[];
  reservedVisualSignatures: string[];
  allowedActions: ("reattach_visual" | "replace_visual_spec" | "generate_visual_module" | "remove_optional_visual")[];
}

export interface ScopedRepairHandler<TIssue extends GardenIssue = GardenIssue> {
  issueType: TIssue["type"];
  expandScope(issue: TIssue, state: GardenBuildState): Partial<LearnRepairScope>;
  proposeDeterministicOperations(issue: TIssue, state: GardenBuildState): GardenBuildOperation[];
  buildModelPacket?(issue: TIssue, state: GardenBuildState, scope: LearnRepairScope): unknown;
  verifyModelDecision?(
    issue: TIssue,
    decision: unknown,
    state: GardenBuildState,
    scope: LearnRepairScope,
  ): VerifiedScopedRepairDecision;
}

const VISUAL_ISSUES = new Set<GardenIssue["type"]>([
  "missing_planned_visual", "visual_type_mismatch", "duplicate_visual_signature",
  "visual_grounding_mismatch", "visual_grounding",
]);
const FORMULA_ISSUES = new Set<GardenIssue["type"]>([
  "formula_assignment_family_mismatch", "formula_lineage_missing", "formula_lineage", "formula_usage_projection",
]);
const SECTION_ISSUES = new Set<GardenIssue["type"]>(["section_semantic_mismatch", "section_semantic"]);
const PROSE_ISSUES = new Set<GardenIssue["type"]>(["scaffold_prose", "repeated_opening", "critic_semantic"]);
const TAG_ISSUES = new Set<GardenIssue["type"]>(["tag_projection_mismatch", "tag_projection"]);

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))]
    : [];
}

function sourceFingerprint(state: GardenBuildState): string {
  const sources = Object.values(state.sources).sort((a, b) => a.id.localeCompare(b.id));
  const anchors = Object.values(state.sourceAnchors).sort((a, b) => a.id.localeCompare(b.id));
  return crypto.createHash("sha256").update(JSON.stringify({ sourceSetHash: state.sourceSetHash, sources, anchors })).digest("hex");
}

function projectionsForIssue(issue: GardenIssue): LearnProjectionRebuild[] {
  if (VISUAL_ISSUES.has(issue.type)) return ["page_frontmatter", "visual_index", "source_coverage", "validation_reports", "acceptance_status"];
  if (FORMULA_ISSUES.has(issue.type)) return ["page_frontmatter", "contract", "source_coverage", "validation_reports", "acceptance_status"];
  if (SECTION_ISSUES.has(issue.type)) return ["contract", "navigation", "validation_reports", "acceptance_status"];
  if (TAG_ISSUES.has(issue.type)) return ["page_frontmatter", "concepts", "validation_reports", "acceptance_status"];
  if (issue.type === "claim_page_mapping") return ["claims", "validation_reports", "acceptance_status"];
  if (issue.type === "weak_source_anchor" || issue.type === "contract_page_anchor_mismatch") return ["page_frontmatter", "contract", "claims", "visual_index", "source_coverage", "validation_reports", "acceptance_status"];
  return ["validation_reports", "acceptance_status"];
}

function issueVisualIds(issue: GardenIssue): string[] {
  return [...new Set([
    ...(issue.target.visualId ? [issue.target.visualId] : []),
    ...(issue.target.visualIntentId ? [issue.target.visualIntentId] : []),
    ...strings(issue.evidence.visualIds),
    ...strings(issue.evidence.duplicateVisualIds),
  ])];
}

function issueUnitIds(issue: GardenIssue): string[] {
  return [...new Set([...(issue.target.unitId ? [issue.target.unitId] : []), ...strings(issue.evidence.unitIds)])];
}

function issuePageIds(issue: GardenIssue): string[] {
  return [...new Set([...(issue.target.pageId ? [issue.target.pageId] : []), ...strings(issue.evidence.pageIds)])];
}

function issueSectionIds(issue: GardenIssue): string[] {
  return [...new Set([...(issue.target.sectionId ? [issue.target.sectionId] : []), ...strings(issue.evidence.sectionIds)])];
}

function issueAnchorIds(issue: GardenIssue): string[] {
  return [...new Set([
    ...(issue.target.anchorId ? [issue.target.anchorId] : []),
    ...(issue.target.formulaAnchorId ? [issue.target.formulaAnchorId] : []),
    ...strings(issue.evidence.anchorIds),
    ...strings(issue.evidence.sourceAnchorIds),
  ])];
}

function commonExpansion(issue: GardenIssue, state: GardenBuildState): Partial<LearnRepairScope> {
  const unitIds = new Set(issueUnitIds(issue));
  const pageIds = new Set(issuePageIds(issue));
  const sectionIds = new Set(issueSectionIds(issue));
  const visualIds = new Set(issueVisualIds(issue));
  const anchorIds = new Set(issueAnchorIds(issue));
  const formulaAssignmentIds = new Set<string>([
    ...(issue.target.formulaAssignmentId ? [issue.target.formulaAssignmentId] : []),
    ...strings(issue.evidence.formulaAssignmentIds),
  ]);

  for (const visualId of visualIds) {
    const visual = state.visuals[visualId];
    if (!visual) continue;
    if (visual.unitId) unitIds.add(visual.unitId);
    if (visual.pageId) pageIds.add(visual.pageId);
    for (const anchorId of [...visual.sourceAnchorIds, ...visual.textAnchorIds]) anchorIds.add(anchorId);
  }
  for (const assignmentId of formulaAssignmentIds) {
    const assignment = state.formulaAssignments[assignmentId];
    if (!assignment) continue;
    unitIds.add(assignment.unitId); pageIds.add(assignment.pageId); anchorIds.add(assignment.formulaAnchorId);
  }

  // Resolve stable ownership IDs. Section-only issues deliberately stop before
  // adding page IDs: section repair may change navigation, never page bodies.
  for (const pageId of pageIds) {
    const page = state.pages[pageId];
    if (!page) continue;
    unitIds.add(page.unitId); sectionIds.add(page.sectionId);
  }
  for (const unitId of unitIds) {
    const unit = state.units[unitId];
    if (!unit) continue;
    sectionIds.add(unit.sectionId);
    if (!SECTION_ISSUES.has(issue.type)) pageIds.add(unit.pageId);
  }
  if (SECTION_ISSUES.has(issue.type)) {
    for (const sectionId of sectionIds) {
      const section = state.sections[sectionId];
      if (!section) continue;
      for (const unitId of section.unitIds) unitIds.add(unitId);
    }
  }

  // An anchor repair includes only canonical entities that directly reference it.
  if (anchorIds.size > 0 && (issue.type === "weak_source_anchor" || issue.type === "contract_page_anchor_mismatch")) {
    for (const unit of Object.values(state.units)) {
      if ([...unit.sourceAnchorIds, ...unit.sourceVisualAnchorIds].some((id) => anchorIds.has(id))) {
        unitIds.add(unit.id); pageIds.add(unit.pageId); sectionIds.add(unit.sectionId);
      }
    }
    for (const visual of Object.values(state.visuals)) {
      if ([...visual.sourceAnchorIds, ...visual.textAnchorIds].some((id) => anchorIds.has(id))) {
        visualIds.add(visual.id);
        if (visual.pageId) pageIds.add(visual.pageId);
        if (visual.unitId) unitIds.add(visual.unitId);
      }
    }
  }

  return {
    unitIds: [...unitIds], pageIds: [...pageIds], sectionIds: [...sectionIds],
    anchorIds: [...anchorIds], formulaAssignmentIds: [...formulaAssignmentIds], visualIds: [...visualIds],
    requiredProjectionRebuilds: projectionsForIssue(issue),
    allowPageBodyRewrite: PROSE_ISSUES.has(issue.type),
    allowSectionMove: SECTION_ISSUES.has(issue.type),
    allowContractMutation: FORMULA_ISSUES.has(issue.type) || SECTION_ISSUES.has(issue.type)
      || issue.type === "contract_page_anchor_mismatch" || issue.type === "weak_source_anchor",
  };
}

function formulaOperations(issue: GardenIssue, state: GardenBuildState): GardenBuildOperation[] {
  if (!["formula_lineage", "formula_lineage_missing"].includes(issue.type) || !issue.target.pageId) return [];
  const page = state.pages[issue.target.pageId];
  const unit = page ? state.units[page.unitId] : undefined;
  const assignments = unit?.formulaAssignmentIds.map((id) => state.formulaAssignments[id]).filter((entry) => entry?.status === "verified") ?? [];
  const entryIndex = page?.formulaEntries.findIndex((entry) => entry.kind === "worked_example" && !entry.basedOnFormulaAnchorId) ?? -1;
  return assignments.length === 1 && entryIndex >= 0
    ? [{ type: "set_formula_lineage", pageId: page!.id, entryIndex, basedOnFormulaAnchorId: assignments[0].formulaAnchorId, formulaFamily: String(assignments[0].identity.family), justification: "the only verified on-unit formula is the deterministic lineage candidate" }]
    : [];
}

function deterministicOperations(issue: GardenIssue, state: GardenBuildState): GardenBuildOperation[] {
  const formula = formulaOperations(issue, state);
  if (formula.length) return formula;
  if (TAG_ISSUES.has(issue.type) && issue.target.unitId && state.units[issue.target.unitId]) {
    const unit = state.units[issue.target.unitId];
    return [{ type: "set_unit_concepts", unitId: unit.id, primaryConceptIds: unit.primaryConceptIds, supportingConceptIds: unit.supportingConceptIds, prerequisiteConceptIds: unit.prerequisiteConceptIds, justification: "reproject canonical concept assignments without touching page prose" }];
  }
  if (issue.type === "claim_page_mapping" && issue.target.unitId) {
    const claims = Object.values(state.claims).filter((claim) => claim.unitId === issue.target.unitId);
    return [{ type: "replace_claims", unitId: issue.target.unitId, claims, justification: "rebuild claim ownership from stable unit and page IDs" }];
  }
  if (issue.type === "visual_type_mismatch" && issue.target.visualId) {
    const expected = strings(issue.evidence.expectedTypes).filter((type) => IMPLEMENTED_VISUAL_TYPES.includes(type));
    if (expected.length === 1 && state.visuals[issue.target.visualId]) {
      return [{ type: "set_visual_type", visualId: issue.target.visualId, visualType: expected[0], justification: "one supported expected visual type is available" }];
    }
  }
  if ((issue.type === "visual_grounding" || issue.type === "visual_grounding_mismatch" || issue.type === "missing_planned_visual") && issue.target.visualId && issue.target.pageId) {
    const visual = state.visuals[issue.target.visualId];
    const page = state.pages[issue.target.pageId];
    if (visual && page && visual.body) {
      return [{ type: "set_visual_grounding", visualId: visual.id, pageId: page.id, unitId: page.unitId, sourceAnchorIds: visual.sourceAnchorIds, textAnchorIds: visual.textAnchorIds, status: "grounded", justification: "reattach an existing owned visual artifact by stable ID" }];
    }
  }
  if (SECTION_ISSUES.has(issue.type) && issue.target.sectionId && typeof issue.evidence.proposedTitle === "string") {
    return [{ type: "rename_section", sectionId: issue.target.sectionId, title: issue.evidence.proposedTitle.trim(), justification: "apply the validator-proposed semantic section title" }];
  }
  return [];
}

function visualPacket(issue: GardenIssue, state: GardenBuildState): ScopedVisualRepairPacket | undefined {
  const visualId = issueVisualIds(issue)[0];
  const visual = visualId ? state.visuals[visualId] : undefined;
  const page = state.pages[issue.target.pageId ?? visual?.pageId ?? ""];
  const unit = state.units[issue.target.unitId ?? visual?.unitId ?? page?.unitId ?? ""];
  if (!visual || !unit) return undefined;
  return {
    issueId: issue.issueId,
    unit: { id: unit.id, title: unit.title, learningQuestion: unit.learningQuestion },
    currentVisualIntent: { id: visual.id, type: visual.type, pageId: visual.pageId, unitId: visual.unitId },
    currentSpec: visual.body,
    validationProblems: [String(issue.evidence.originalProblem ?? issue.evidence.problem ?? issue.evidence.semanticCategory ?? issue.type)],
    supportedCapabilities: IMPLEMENTED_VISUAL_TYPES.map((type) => ({ type, implemented: true })),
    relevantSourceAnchors: [...new Set([...visual.sourceAnchorIds, ...visual.textAnchorIds])].map((id) => state.sourceAnchors[id]).filter(Boolean),
    reservedVisualSignatures: strings(issue.evidence.reservedVisualSignatures),
    allowedActions: ["reattach_visual", "replace_visual_spec", "generate_visual_module", "remove_optional_visual"],
  };
}

function modelPacket(issue: GardenIssue, state: GardenBuildState, scope: LearnRepairScope): unknown {
  if (VISUAL_ISSUES.has(issue.type)) return visualPacket(issue, state);
  const page = state.pages[issue.target.pageId ?? scope.pageIds[0] ?? ""];
  const unit = state.units[issue.target.unitId ?? page?.unitId ?? scope.unitIds[0] ?? ""];
  const anchors = scope.anchorIds.map((id) => state.sourceAnchors[id]).filter(Boolean);
  return {
    issue: { issueId: issue.issueId, type: issue.type, target: issue.target, evidence: issue.evidence },
    unit: unit ? { id: unit.id, title: unit.title, role: unit.role, learningQuestion: unit.learningQuestion } : undefined,
    page: page ? { id: page.id, title: page.title, excerpt: page.body.slice(0, 6000), formulaEntries: page.formulaEntries, visualIds: page.embeddedVisualIds } : undefined,
    relevantSourceEvidence: anchors,
    contractFragment: unit,
    allowedEntityIds: { unitIds: scope.unitIds, pageIds: scope.pageIds, sectionIds: scope.sectionIds, anchorIds: scope.anchorIds, visualIds: scope.visualIds },
    allowedOperations: scope.allowedSemanticOperations.map((operation) => operation.type),
  };
}

function decisionOperations(decision: unknown): GardenBuildOperation[] {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return [];
  const record = decision as { operations?: unknown; operation?: unknown };
  const raw = Array.isArray(record.operations) ? record.operations : record.operation ? [record.operation] : [];
  return raw.filter((entry): entry is GardenBuildOperation => Boolean(entry && typeof entry === "object" && typeof (entry as { type?: unknown }).type === "string"));
}

function operationScopeProblem(operation: GardenBuildOperation, state: GardenBuildState, scope: LearnRepairScope): string | undefined {
  const pageId = "pageId" in operation ? operation.pageId : undefined;
  const unitId = "unitId" in operation ? operation.unitId : undefined;
  const sectionId = "sectionId" in operation ? operation.sectionId : undefined;
  const visualId = "visualId" in operation ? operation.visualId : undefined;
  if (pageId && !scope.pageIds.includes(pageId)) return `page ${pageId} is outside the repair scope`;
  if (unitId && !scope.unitIds.includes(unitId)) return `unit ${unitId} is outside the repair scope`;
  if (sectionId && !scope.sectionIds.includes(sectionId)) return `section ${sectionId} is outside the repair scope`;
  if (visualId && !scope.visualIds.includes(visualId)) return `visual ${visualId} is outside the repair scope`;
  if (operation.type === "set_page_body" && !scope.allowPageBodyRewrite) return "page body rewrite is forbidden for this scope";
  if (operation.type === "move_unit_to_section" && !scope.allowSectionMove) return "section moves are forbidden for this scope";
  if (["set_formula_assignment", "remove_formula_assignment"].includes(operation.type) && !scope.allowContractMutation) return "contract mutation is forbidden for this scope";
  if (operation.type === "set_visual_type" && !IMPLEMENTED_VISUAL_TYPES.includes(operation.visualType)) return `visual type ${operation.visualType} is unsupported`;
  if (operation.type === "set_visual_grounding") {
    const invented = [...operation.sourceAnchorIds, ...operation.textAnchorIds].filter((id) => !state.sourceAnchors[id]);
    if (invented.length) return `source anchor ${invented[0]} does not exist`;
  }
  if (operation.type === "replace_page_visual_block") {
    const match = operation.block.match(/^```breadboard-visual\r?\n([\s\S]*?)\r?\n```$/);
    if (!match) return "visual replacement must be one typed breadboard-visual block";
    let parsed: unknown;
    try { parsed = JSON.parse(match[1]); } catch { return "visual replacement contains invalid JSON"; }
    const checked = validateVisualSpec(parsed);
    if (!checked.spec || checked.spec.id !== operation.visualId) return `visual replacement failed schema validation: ${checked.errors.join("; ")}`;
  }
  const operationIssues = validateGardenBuildOperation(state, operation, "repair");
  if (operationIssues.some((entry) => entry.severity === "blocking")) return "typed operation failed canonical validation";
  return undefined;
}

export function verifyScopedRepairDecision(
  issue: GardenIssue,
  decision: unknown,
  state: GardenBuildState,
  scope: LearnRepairScope,
): VerifiedScopedRepairDecision {
  const operations = decisionOperations(decision);
  if (operations.length === 0) return { valid: false, operations: [], reason: "model returned no typed operations" };
  for (const operation of operations) {
    const problem = operationScopeProblem(operation, state, scope);
    if (problem) return { valid: false, operations: [], reason: problem };
    if (VISUAL_ISSUES.has(issue.type) && ["set_page_body", "rename_section", "move_unit_to_section"].includes(operation.type)) {
      return { valid: false, operations: [], reason: "visual issues cannot authorize prose or section rewrites" };
    }
    if (FORMULA_ISSUES.has(issue.type) && ["set_page_body", "set_visual_body", "replace_page_visual_block"].includes(operation.type)) {
      return { valid: false, operations: [], reason: "formula metadata issues cannot authorize prose or visual rewrites" };
    }
  }
  return { valid: true, operations, reason: `verified ${operations.length} scoped typed operation(s)` };
}

function makeHandler(issueType: GardenIssue["type"]): ScopedRepairHandler {
  return {
    issueType,
    expandScope: (issue, state) => commonExpansion(issue, state),
    proposeDeterministicOperations: (issue, state) => deterministicOperations(issue, state),
    buildModelPacket: (issue, state, scope) => modelPacket(issue, state, scope),
    verifyModelDecision: (issue, decision, state, scope) => verifyScopedRepairDecision(issue, decision, state, scope),
  };
}

const HANDLER_TYPES: GardenIssue["type"][] = [
  "missing_planned_visual", "visual_type_mismatch", "duplicate_visual_signature", "visual_grounding_mismatch",
  "formula_assignment_family_mismatch", "formula_lineage_missing", "weak_source_anchor", "contract_page_anchor_mismatch",
  "tag_projection_mismatch", "claim_page_mapping", "section_semantic_mismatch", "scaffold_prose", "repeated_opening",
  // Canonical names accepted during migration.
  "visual_grounding", "formula_lineage", "formula_usage_projection", "tag_projection", "section_semantic", "critic_semantic",
];

export const SCOPED_REPAIR_HANDLERS: ReadonlyMap<GardenIssue["type"], ScopedRepairHandler> = new Map(
  HANDLER_TYPES.map((type) => [type, makeHandler(type)]),
);

export function scopedRepairHandlerForIssue(issue: GardenIssue): ScopedRepairHandler | undefined {
  return SCOPED_REPAIR_HANDLERS.get(issue.type);
}

function mergePartialScope(target: {
  unitIds: Set<string>; pageIds: Set<string>; sectionIds: Set<string>; anchorIds: Set<string>;
  formulaAssignmentIds: Set<string>; visualIds: Set<string>; projections: Set<LearnProjectionRebuild>;
  allowPageBodyRewrite: boolean; allowSectionMove: boolean; allowContractMutation: boolean;
}, partial: Partial<LearnRepairScope>): void {
  for (const id of partial.unitIds ?? []) target.unitIds.add(id);
  for (const id of partial.pageIds ?? []) target.pageIds.add(id);
  for (const id of partial.sectionIds ?? []) target.sectionIds.add(id);
  for (const id of partial.anchorIds ?? []) target.anchorIds.add(id);
  for (const id of partial.formulaAssignmentIds ?? []) target.formulaAssignmentIds.add(id);
  for (const id of partial.visualIds ?? []) target.visualIds.add(id);
  for (const projection of partial.requiredProjectionRebuilds ?? []) target.projections.add(projection);
  target.allowPageBodyRewrite ||= partial.allowPageBodyRewrite === true;
  target.allowSectionMove ||= partial.allowSectionMove === true;
  target.allowContractMutation ||= partial.allowContractMutation === true;
}

export function buildLearnRepairScope(
  state: GardenBuildState,
  issues: GardenIssue[],
  request: StartLearnOperationRequest,
): LearnRepairScope {
  if (request.mode !== "repair") throw new Error(`Repair scope requires mode=repair, received ${request.mode}.`);
  const requestedIds = request.issueIds ? new Set(request.issueIds) : null;
  const selected = issues.filter((issue) => !requestedIds || requestedIds.has(issue.issueId));
  const aggregate = {
    unitIds: new Set(request.unitIds ?? []), pageIds: new Set(request.pageIds ?? []), sectionIds: new Set<string>(),
    anchorIds: new Set<string>(), formulaAssignmentIds: new Set<string>(), visualIds: new Set<string>(),
    projections: new Set<LearnProjectionRebuild>(["validation_reports", "acceptance_status"]),
    allowPageBodyRewrite: false, allowSectionMove: false, allowContractMutation: false,
  };
  const operations: GardenBuildOperation[] = [];
  for (const issue of selected) {
    const handler = scopedRepairHandlerForIssue(issue);
    mergePartialScope(aggregate, handler?.expandScope(issue, state) ?? commonExpansion(issue, state));
    operations.push(...(handler?.proposeDeterministicOperations(issue, state) ?? []));
  }
  for (const pageId of [...aggregate.pageIds]) {
    const page = state.pages[pageId];
    if (!page) continue;
    aggregate.unitIds.add(page.unitId); aggregate.sectionIds.add(page.sectionId);
  }
  for (const unitId of [...aggregate.unitIds]) {
    const unit = state.units[unitId];
    if (unit) aggregate.sectionIds.add(unit.sectionId);
  }
  const sort = (values: Iterable<string>) => [...new Set(values)].sort();
  const operationMap = new Map(operations.map((operation) => [JSON.stringify(operation), operation]));
  const issueIds = sort(selected.map((issue) => issue.issueId));
  const seed = JSON.stringify({ gardenId: request.gardenId, buildId: state.buildId, issueIds, unitIds: sort(aggregate.unitIds), pageIds: sort(aggregate.pageIds) });
  return {
    repairId: `repair:${crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16)}`,
    gardenId: request.gardenId,
    sourceBuildId: state.buildId,
    sourceStateFingerprint: sourceFingerprint(state),
    issueIds,
    unitIds: sort(aggregate.unitIds), pageIds: sort(aggregate.pageIds), sectionIds: sort(aggregate.sectionIds),
    anchorIds: sort(aggregate.anchorIds), formulaAssignmentIds: sort(aggregate.formulaAssignmentIds), visualIds: sort(aggregate.visualIds),
    requiredProjectionRebuilds: [...aggregate.projections].sort(),
    allowedSemanticOperations: [...operationMap.values()],
    allowPageBodyRewrite: aggregate.allowPageBodyRewrite,
    allowSectionMove: aggregate.allowSectionMove,
    allowContractMutation: aggregate.allowContractMutation,
    explicitlyExcludedPageIds: sort(Object.keys(state.pages).filter((pageId) => !aggregate.pageIds.has(pageId))),
  };
}
