import os from "node:os";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { auditFinalGardenState, buildFinalGardenState } from "./final-garden-state.ts";
import {
  auditGardenForFinalization,
  sourceFormulaReviewFinalizationContextFromGarden,
  type SourceFormulaReviewFinalizationContext,
} from "./garden-finalize.ts";
import { issuesFromFinalGardenAudit } from "./garden-build/issue-adapters.ts";
import { mergeGardenIssues } from "./garden-build/issue-identity.ts";
import type { GardenIssue } from "./garden-build/issues.ts";
import { importLegacyGardenBuildState } from "./garden-build/legacy-import.ts";
import type { GardenBuildOperation } from "./garden-build/operations.ts";
import {
  buildLearnRepairScope,
  DEFAULT_SCOPED_REPAIR_LOOP_OPTIONS,
  scopedRepairHandlerForIssue,
  type LearnRepairScope,
  type LearnScopedRepairTransaction,
  type ScopedRepairLoopOptions,
} from "./garden-build/repair-scope.ts";
import {
  buildScopedFileMutationPolicy,
  fingerprintGardenFiles,
  verifyPageByteIdentity,
  verifyScopedFileMutationPolicy,
  type ScopedFileMutationPolicy,
  type ScopedFileMutationVerification,
} from "./garden-build/scoped-files.ts";
import { applyGardenBuildTransaction } from "./garden-build/transactions.ts";
import type { GardenBuildState } from "./garden-build/types.ts";
import { promoteStagingGarden, type AtomicPromotionResult } from "./learn-atomic-promotion.ts";
import type { StartLearnOperationRequest } from "./learn-operation-mode.ts";

export type ScopedModelRepairExecutor = (packet: unknown, issue: GardenIssue) => Promise<unknown>;

export interface ScopedModelRepairExactRawResponse {
  kind: "learn_scoped_repair_exact_raw_v1";
  content: string;
}

export function exactScopedModelRepairResponse(
  content: string,
): ScopedModelRepairExactRawResponse {
  return { kind: "learn_scoped_repair_exact_raw_v1", content };
}

function scopedModelRepairJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

/** Invoke one logical scoped-repair model request. Provider rejections escape
 * with exact identity. Only a fulfilled, nonempty response becomes validation
 * evidence that may allow the bounded loop to inspect another issue. */
export async function requestScopedModelRepairCandidate(
  executor: ScopedModelRepairExecutor,
  packet: unknown,
  issue: GardenIssue,
): Promise<unknown> {
  const response = await executor(packet, issue);
  if (response === undefined || response === null) {
    throw new Error(
      "Scoped repair provider returned no candidate; no further model request was authorized.",
    );
  }
  if (
    typeof response === "object" &&
    Object.keys(response).length === 2 &&
    (response as Record<string, unknown>).kind === "learn_scoped_repair_exact_raw_v1" &&
    typeof (response as Record<string, unknown>).content === "string"
  ) {
    const raw = (response as ScopedModelRepairExactRawResponse).content;
    const candidateText = scopedModelRepairJsonCandidate(raw);
    if (candidateText.length === 0) {
      throw new Error(
        "Scoped repair provider returned an empty response; no further model request was authorized.",
      );
    }
    if (candidateText === "null") {
      throw new Error(
        "Scoped repair provider returned literal JSON null; no further model request was authorized.",
      );
    }
    try {
      return JSON.parse(candidateText) as unknown;
    } catch {
      // Nonempty malformed text is a concrete returned candidate. The typed
      // verifier rejects it deterministically; it is not a provider failure.
      return null;
    }
  }
  if (typeof response === "string") {
    const candidateText = scopedModelRepairJsonCandidate(response);
    if (candidateText.length === 0) {
      throw new Error(
        "Scoped repair provider returned an empty response; no further model request was authorized.",
      );
    }
    if (candidateText === "null") {
      throw new Error(
        "Scoped repair provider returned literal JSON null; no further model request was authorized.",
      );
    }
  }
  return response;
}

export interface LearnScopedRepairProgress {
  step: string;
  issue?: GardenIssue;
  scope?: LearnRepairScope;
}

function isScopedRepairControlGateError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return name === "LearnCancelledError" || name === "LearnPipelineConflictError";
}

/** Progress persistence is an observer, except where the active Learn caller
 * uses the callback as a cancellation/conflict gate or as the publication
 * compare-and-set boundary. A failed observer must not turn an already
 * fulfilled model decision into a failed logical request that an outer caller
 * could replay. The stable error-name check avoids importing learn.ts here and
 * creating a cycle with the active Learn entry point. */
export function reportLearnScopedRepairProgress(
  onProgress: ((progress: LearnScopedRepairProgress) => void) | undefined,
  progress: LearnScopedRepairProgress,
  options?: { publicationGate?: boolean },
): void {
  try {
    onProgress?.(progress);
  } catch (error) {
    if (options?.publicationGate || isScopedRepairControlGateError(error)) {
      throw error;
    }
    // Pure progress/telemetry failures are non-authoritative.
  }
}

export interface LearnScopedRepairResult {
  scope: LearnRepairScope;
  policy: ScopedFileMutationPolicy;
  transaction: LearnScopedRepairTransaction;
  selectedIssues: GardenIssue[];
  finalIssues: GardenIssue[];
  files: ScopedFileMutationVerification;
  pageIdentity: ReturnType<typeof verifyPageByteIdentity>;
  accepted: boolean;
  publishReady: boolean;
  promotion: AtomicPromotionResult;
  reportJsonPath: string;
  reportMarkdownPath: string;
}

function copyTree(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function identicalFingerprints(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && left[key] === right[key],
    )
  );
}

const VOLATILE_REPAIR_PATHS = new Set([".breadboard/events.jsonl"]);

function stableRepairFingerprints(
  fingerprints: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fingerprints).filter(
      ([relativePath]) => !VOLATILE_REPAIR_PATHS.has(relativePath.replace(/\\/g, "/")),
    ),
  );
}

function mergeRepairEventLedgers(currentGarden: string, incomingGarden: string): void {
  const relativePath = path.join(".breadboard", "events.jsonl");
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const gardenDir of [currentGarden, incomingGarden]) {
    let raw = "";
    try {
      raw = fs.readFileSync(path.join(gardenDir, relativePath), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      if (!line || seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  if (lines.length === 0) return;
  const destination = path.join(incomingGarden, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${lines.join("\n")}\n`, "utf8");
}

function pageLookup(state: GardenBuildState): { pageIdByLegacyPath: Record<string, string>; unitIdByLegacyPath: Record<string, string> } {
  const pageIdByLegacyPath: Record<string, string> = {};
  const unitIdByLegacyPath: Record<string, string> = {};
  for (const page of Object.values(state.pages)) {
    if (!page.legacyPath) continue;
    const rel = page.legacyPath.replace(/\\/g, "/");
    pageIdByLegacyPath[rel] = page.id;
    pageIdByLegacyPath[rel.replace(/\.md$/i, "")] = page.id;
    unitIdByLegacyPath[rel] = page.unitId;
    unitIdByLegacyPath[rel.replace(/\.md$/i, "")] = page.unitId;
  }
  return { pageIdByLegacyPath, unitIdByLegacyPath };
}

export function loadCurrentTypedGardenIssues(
  gardenDir: string,
  gardenId: string,
  state?: GardenBuildState,
  expectedSourceFormulaReviewContext?: SourceFormulaReviewFinalizationContext,
): { state: GardenBuildState; issues: GardenIssue[] } {
  const imported = state ? { state, issues: [] as GardenIssue[] } : importLegacyGardenBuildState(gardenDir, gardenId);
  const audit = auditGardenForFinalization(gardenDir, gardenId, {
    expectedSourceFormulaReviewContext,
  });
  const context = pageLookup(imported.state);
  const issues = mergeGardenIssues([
    imported.issues,
    imported.state.issueState.active,
    imported.state.issueState.warnings,
    issuesFromFinalGardenAudit(audit, context),
  ]);
  return { state: imported.state, issues };
}

function markdownParts(markdown: string): { frontmatter: string; body: string } {
  const match = markdown.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/);
  return match ? { frontmatter: match[1], body: match[2] } : { frontmatter: "", body: markdown };
}

function replaceMarkdownBody(markdown: string, body: string): string {
  const parts = markdownParts(markdown);
  return `${parts.frontmatter}${body.replace(/^\s+/, "").replace(/\s*$/, "")}\n`;
}

function setFrontmatterValue(markdown: string, key: string, value: unknown): string {
  const parts = markdownParts(markdown);
  if (!parts.frontmatter) return markdown;
  const raw = parts.frontmatter.replace(/^---\r?\n/, "").replace(/\r?\n---\r?\n?$/, "");
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && /^\s+/.test(lines[end])) end += 1;
    lines.splice(start, end - start, `${key}: ${JSON.stringify(value)}`);
  } else {
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  return `---\n${lines.join("\n")}\n---\n${parts.body}`;
}

function writeIfChanged(file: string, content: string): void {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  if (current === content) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function absolute(root: string, relative: string): string {
  return path.join(root, ...relative.replace(/\\/g, "/").split("/"));
}

function visualFile(root: string, visualId: string): string {
  const base = absolute(root, `.breadboard/visuals/${visualId}`);
  return fs.existsSync(base) && fs.statSync(base).isDirectory() ? path.join(base, "spec.json") : `${base}.json`;
}

function renderVisual(visualId: string, state: GardenBuildState, root: string): void {
  const visual = state.visuals[visualId];
  if (!visual) return;
  const file = visualFile(root, visualId);
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>; } catch { /* create it */ }
  let body: unknown = visual.body;
  if (typeof visual.body === "string") {
    try { body = JSON.parse(visual.body); } catch { /* keep literal module/body */ }
  }
  const content = {
    ...existing,
    id: visual.id,
    type: visual.type,
    canonicalPageId: visual.pageId,
    learningUnitId: visual.unitId,
    sourceAnchors: visual.sourceAnchorIds,
    textAnchors: visual.textAnchorIds,
    status: visual.status,
    ...(body !== undefined ? { body } : {}),
  };
  writeIfChanged(file, `${JSON.stringify(content, null, 2)}\n`);
}

function patchContract(root: string, before: GardenBuildState, after: GardenBuildState, scope: LearnRepairScope): void {
  const candidates = [".breadboard/learning-unit-contract.json", ".breadboard/planning/learning-unit-contract.json"];
  const relative = candidates.find((file) => fs.existsSync(absolute(root, file)));
  if (!relative) return;
  const file = absolute(root, relative);
  let contract: Record<string, unknown>;
  try { contract = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>; } catch { return; }
  const unitKey = Array.isArray(contract.learningUnits) ? "learningUnits" : Array.isArray(contract.units) ? "units" : undefined;
  if (unitKey) {
    const units = contract[unitKey] as Array<Record<string, unknown>>;
    for (const raw of units) {
      const id = String(raw.id ?? raw.learningUnitId ?? "");
      if (!scope.unitIds.includes(id) || !after.units[id]) continue;
      const unit = after.units[id];
      if (before.units[id]?.title !== unit.title) raw.title = unit.title;
      if (before.units[id]?.sourceAnchorIds.join("\0") !== unit.sourceAnchorIds.join("\0")) raw.sourceAnchors = unit.sourceAnchorIds;
    }
  }
  if (Array.isArray(contract.formulaAssignments)) {
    const assignments = contract.formulaAssignments as Array<Record<string, unknown>>;
    for (const id of scope.formulaAssignmentIds) {
      const replacement = after.formulaAssignments[id];
      const index = assignments.findIndex((entry) => String(entry.id ?? "") === id);
      if (replacement && index >= 0) assignments[index] = replacement as unknown as Record<string, unknown>;
      else if (!replacement && index >= 0) assignments.splice(index, 1);
    }
  }
  writeIfChanged(file, `${JSON.stringify(contract, null, 2)}\n`);
}

function renderSourceCoverage(root: string, state: GardenBuildState): void {
  const lines = ["# Source Coverage", "", "## Active Usage", ""];
  for (const usage of [...state.sourceCoverage.usages].sort((a, b) => `${a.anchorId}:${a.pageId ?? ""}`.localeCompare(`${b.anchorId}:${b.pageId ?? ""}`))) {
    lines.push(`- ${usage.anchorId} — ${usage.mode}${usage.pageId ? ` — ${state.pages[usage.pageId]?.legacyPath ?? usage.pageId}` : ""}`);
  }
  lines.push("", "## Intentionally Omitted", "");
  for (const omission of [...state.sourceCoverage.intentionalOmissions].sort((a, b) => a.anchorId.localeCompare(b.anchorId))) lines.push(`- ${omission.anchorId} — ${omission.reason}`);
  lines.push("");
  writeIfChanged(absolute(root, ".breadboard/planning/Source Coverage.md"), lines.join("\n"));
}

function renderVisualIndex(root: string, state: GardenBuildState): void {
  const visuals = Object.values(state.visuals).filter((visual) => visual.status !== "historical").sort((a, b) => a.id.localeCompare(b.id));
  writeIfChanged(absolute(root, ".breadboard/visual-index.json"), `${JSON.stringify({ schemaVersion: 1, visuals }, null, 2)}\n`);
}

function renderClaims(root: string, state: GardenBuildState): void {
  const file = absolute(root, ".breadboard/claims.json");
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>; } catch { /* create */ }
  writeIfChanged(file, `${JSON.stringify({ ...existing, claims: Object.values(state.claims).filter((claim) => claim.status === "active") }, null, 2)}\n`);
}

function renderConcepts(root: string, state: GardenBuildState): void {
  const file = absolute(root, ".breadboard/concept-registry.json");
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>; } catch { /* create */ }
  writeIfChanged(file, `${JSON.stringify({ ...existing, concepts: Object.values(state.concepts).filter((concept) => concept.status === "active") }, null, 2)}\n`);
}

function renderNavigation(root: string, before: GardenBuildState, after: GardenBuildState, scope: LearnRepairScope): void {
  for (const sectionId of scope.sectionIds) {
    const oldTitle = before.sections[sectionId]?.title;
    const newTitle = after.sections[sectionId]?.title;
    if (!oldTitle || !newTitle || oldTitle === newTitle) continue;
    const firstPage = after.sections[sectionId]?.unitIds.map((id) => after.pages[after.units[id]?.pageId ?? ""]).find((page) => page?.legacyPath);
    const sectionIndex = firstPage?.legacyPath ? `${firstPage.legacyPath.split("/").slice(0, -1).join("/")}/_index.md` : undefined;
    for (const relative of [sectionIndex, "learning/_index.md", "learning/Learning Map.md"].filter((entry): entry is string => Boolean(entry))) {
      const file = absolute(root, relative);
      if (!fs.existsSync(file)) continue;
      const current = fs.readFileSync(file, "utf8");
      writeIfChanged(file, current.split(oldTitle).join(newTitle));
    }
  }
}

function renderScopedState(
  root: string,
  before: GardenBuildState,
  after: GardenBuildState,
  scope: LearnRepairScope,
  operations: GardenBuildOperation[],
): void {
  const operationTypesByPage = new Map<string, Set<GardenBuildOperation["type"]>>();
  for (const operation of operations) {
    if (!("pageId" in operation) || typeof operation.pageId !== "string") continue;
    const types = operationTypesByPage.get(operation.pageId) ?? new Set<GardenBuildOperation["type"]>();
    types.add(operation.type); operationTypesByPage.set(operation.pageId, types);
  }
  for (const pageId of scope.pageIds) {
    const oldPage = before.pages[pageId];
    const page = after.pages[pageId];
    const relative = oldPage?.legacyPath ?? page?.legacyPath;
    if (!page || !relative) continue;
    const file = absolute(root, relative);
    if (!fs.existsSync(file)) continue;
    let markdown = fs.readFileSync(file, "utf8");
    const operationTypes = operationTypesByPage.get(pageId) ?? new Set();
    if (oldPage?.body !== page.body && (scope.allowPageBodyRewrite || operationTypes.has("replace_page_visual_block") || operationTypes.has("remove_page_visual"))) {
      markdown = replaceMarkdownBody(markdown, page.body);
    }
    if ([...operationTypes].some((type) => ["set_formula_lineage", "reclassify_formula_entry", "set_page_formula_entries"].includes(type))) {
      markdown = setFrontmatterValue(markdown, "formulas", page.formulaEntries.map((entry) => ({
        kind: entry.kind, text: entry.text, ...(entry.sourceAnchorId ? { sourceAnchor: entry.sourceAnchorId } : {}),
        ...(entry.basedOnFormulaAnchorId ? { basedOnFormula: entry.basedOnFormulaAnchorId } : {}),
        ...(entry.formulaFamily ? { formulaFamily: entry.formulaFamily } : {}),
        ...(entry.exampleGroupId ? { exampleGroupId: entry.exampleGroupId } : {}),
      })));
    }
    if ([...operationTypes].some((type) => ["set_visual_grounding", "replace_page_visual_block", "remove_page_visual"].includes(type))) {
      markdown = setFrontmatterValue(markdown, "visualIds", page.embeddedVisualIds);
      markdown = setFrontmatterValue(markdown, "visuals", page.embeddedVisualIds);
    }
    const unit = after.units[page.unitId];
    if (unit && [...operations].some((operation) => operation.type === "set_unit_concepts" && operation.unitId === unit.id)) {
      const primary = unit.primaryConceptIds.map((id) => after.concepts[id]?.slug).filter(Boolean);
      const supporting = unit.supportingConceptIds.map((id) => after.concepts[id]?.slug).filter(Boolean);
      markdown = setFrontmatterValue(markdown, "primaryConcepts", primary);
      markdown = setFrontmatterValue(markdown, "supportingConcepts", supporting);
      markdown = setFrontmatterValue(markdown, "tags", [...new Set([...primary, ...supporting])]);
    }
    writeIfChanged(file, markdown);
  }
  const touchedVisualIds = new Set(
    operations.flatMap((operation) => "visualId" in operation ? [operation.visualId] : []),
  );
  for (const visualId of touchedVisualIds) renderVisual(visualId, after, root);
  if (scope.requiredProjectionRebuilds.includes("contract") && scope.allowContractMutation) patchContract(root, before, after, scope);
  if (scope.requiredProjectionRebuilds.includes("claims")) renderClaims(root, after);
  if (scope.requiredProjectionRebuilds.includes("concepts")) renderConcepts(root, after);
  if (scope.requiredProjectionRebuilds.includes("visual_index")) renderVisualIndex(root, after);
  if (scope.requiredProjectionRebuilds.includes("source_coverage")) renderSourceCoverage(root, after);
  if (scope.requiredProjectionRebuilds.includes("navigation")) renderNavigation(root, before, after, scope);
}

function reportMarkdown(result: {
  scope: LearnRepairScope; policy: ScopedFileMutationPolicy; changedFiles: string[]; operations: GardenBuildOperation[];
  modelCalls: number; verified: number; rejected: number; blockersBefore: string[]; blockersAfter: string[];
  pageIdentityPassed: boolean; committed: boolean; reason: string; accepted: boolean; publishReady: boolean;
}): string {
  const list = (items: string[]) => items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
  return [
    "# Scoped Repair", "", `Repair: ${result.scope.repairId}`, `Garden: ${result.scope.gardenId}`,
    `Committed: ${result.committed ? "yes" : "no"}`, `Reason: ${result.reason}`, `Accepted: ${result.accepted ? "yes" : "no"}`,
    `Publish ready: ${result.publishReady ? "yes" : "no"}`, "", "## Issues selected", "", list(result.scope.issueIds),
    "", "## Scope", "", `- Units: ${result.scope.unitIds.join(", ") || "none"}`, `- Pages: ${result.scope.pageIds.join(", ") || "none"}`,
    `- Sections: ${result.scope.sectionIds.join(", ") || "none"}`, `- Visuals: ${result.scope.visualIds.join(", ") || "none"}`,
    `- Unaffected pages verified: ${result.pageIdentityPassed ? "yes" : "no"}`, "", "## Files permitted to change", "", list(result.policy.allowedFiles),
    "", "## Files actually changed", "", list(result.changedFiles), "", "## Typed operations", "",
    result.operations.length ? result.operations.map((operation) => `- ${operation.type}: ${operation.justification}`).join("\n") : "- None",
    "", "## ChatMock", "", `- Calls: ${result.modelCalls}`, `- Verified decisions: ${result.verified}`, `- Rejected decisions: ${result.rejected}`,
    "", "## Blockers before", "", list(result.blockersBefore), "", "## Blockers after", "", list(result.blockersAfter), "",
  ].join("\n");
}

export async function executeLearnScopedRepair(input: {
  gardenDir: string;
  gardenId: string;
  request: StartLearnOperationRequest;
  recoveryOwnerId?: string;
  modelRepair?: ScopedModelRepairExecutor;
  loopOptions?: Partial<ScopedRepairLoopOptions>;
  onProgress?: (progress: LearnScopedRepairProgress) => void;
  /** Fenced ownership check required immediately before atomic publication. */
  verifyLease?: () => boolean;
}): Promise<LearnScopedRepairResult> {
  if (input.request.mode !== "repair") throw new Error("Scoped repair can run only with mode=repair.");
  reportLearnScopedRepairProgress(input.onProgress, { step: "Analyzing validation issues" });
  const expectedSourceFormulaReviewContext =
    sourceFormulaReviewFinalizationContextFromGarden(input.gardenDir);
  const current = loadCurrentTypedGardenIssues(
    input.gardenDir,
    input.gardenId,
    undefined,
    expectedSourceFormulaReviewContext,
  );
  const scope = buildLearnRepairScope(current.state, current.issues, input.request);
  const selectedIssues = current.issues.filter((issue) => scope.issueIds.includes(issue.issueId));
  if (selectedIssues.length === 0) throw new Error("No current typed validation issues matched the requested repair selection.");
  reportLearnScopedRepairProgress(input.onProgress, {
    step: `Repairing ${scope.pageIds.length} affected page projection(s)`,
    scope,
  });

  const beforeFiles = fingerprintGardenFiles(input.gardenDir);
  const policy = buildScopedFileMutationPolicy(current.state, scope, beforeFiles);
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `breadboard-${input.gardenId}-repair-`));
  const staging = path.join(workspaceRoot, "staging");
  try {
    copyTree(input.gardenDir, staging);
    if (!identicalFingerprints(beforeFiles, fingerprintGardenFiles(staging))) {
      throw new Error(
        "Garden files changed while scoped repair was creating its staging copy. No repair was published; retry the operation.",
      );
    }
    if (input.verifyLease && !input.verifyLease()) {
      throw new Error(
        "Scoped repair lost its fenced garden lease while creating its staging copy.",
      );
    }
  } catch (error) {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
  const options = { ...DEFAULT_SCOPED_REPAIR_LOOP_OPTIONS, ...input.loopOptions };
  const blockersBefore = current.issues.filter((issue) => issue.severity === "blocking").map((issue) => issue.issueId).sort();
  let state = current.state;
  const operations: GardenBuildOperation[] = [];
  let modelCalls = 0;
  let verifiedModelDecisions = 0;
  let rejectedModelDecisions = 0;

  try {
    // Deterministic operations always run before any model packet.
    if (scope.allowedSemanticOperations.length > 0) {
      const applied = applyGardenBuildTransaction(state, scope.allowedSemanticOperations, { expectedStage: "repair", validateAfter: true });
      if (applied.transaction.rolledBack) throw new Error(applied.transaction.reason);
      state = applied.state;
      operations.push(...scope.allowedSemanticOperations);
    }

    for (const issue of selectedIssues.slice(0, options.maxIssuesPerRound)) {
      if (!input.modelRepair || modelCalls >= options.maxModelCalls) break;
      const handler = scopedRepairHandlerForIssue(issue);
      const deterministic = handler?.proposeDeterministicOperations(issue, current.state) ?? [];
      if (deterministic.length > 0) continue;
      const packet = handler?.buildModelPacket?.(issue, state, scope);
      if (!packet) continue;
      reportLearnScopedRepairProgress(input.onProgress, {
        step: `Repairing ${issue.target.visualId ?? issue.target.unitId ?? issue.type}`,
        issue,
        scope,
      });
      if (input.verifyLease && !input.verifyLease()) {
        throw new Error(
          "Scoped repair lost its fenced garden lease before a model request.",
        );
      }
      modelCalls += 1;
      const decision = await requestScopedModelRepairCandidate(input.modelRepair, packet, issue);
      const verified = handler?.verifyModelDecision?.(issue, decision, state, scope);
      if (!verified?.valid) { rejectedModelDecisions += 1; continue; }
      const applied = applyGardenBuildTransaction(state, verified.operations, { expectedStage: "repair", validateAfter: true });
      if (applied.transaction.rolledBack) { rejectedModelDecisions += 1; continue; }
      verifiedModelDecisions += 1;
      state = applied.state;
      operations.push(...verified.operations);
    }

    renderScopedState(staging, current.state, state, scope, operations);
    reportLearnScopedRepairProgress(input.onProgress, {
      step: "Revalidating garden",
      scope,
    });
    const finalizationAudit = auditGardenForFinalization(staging, input.gardenId, {
      expectedSourceFormulaReviewContext,
    });
    const finalStateAudit = auditFinalGardenState(buildFinalGardenState(staging, input.gardenId));
    const afterTyped = loadCurrentTypedGardenIssues(
      staging,
      input.gardenId,
      undefined,
      expectedSourceFormulaReviewContext,
    );
    const blockersAfter = afterTyped.issues.filter((issue) => issue.severity === "blocking").map((issue) => issue.issueId).sort();
    const beforeBlockerSet = new Set(blockersBefore);
    const newBlockers = blockersAfter.filter((id) => !beforeBlockerSet.has(id));
    const targetBlockersBefore = selectedIssues.filter((issue) => issue.severity === "blocking").map((issue) => issue.issueId);
    const afterBlockerSet = new Set(blockersAfter);
    const targetBlockersAfter = targetBlockersBefore.filter((id) => afterBlockerSet.has(id));
    const blockerProgress = targetBlockersAfter.length < targetBlockersBefore.length;
    const pageIdentity = verifyPageByteIdentity({ state: current.state, scope, issues: current.issues, beforeRoot: input.gardenDir, afterRoot: staging });

    const provisionalAfterFiles = fingerprintGardenFiles(staging);
    const provisionalFileCheck = verifyScopedFileMutationPolicy(beforeFiles, provisionalAfterFiles, policy);
    const accepted = finalizationAudit.passed && finalStateAudit.ok;
    const publishReady = accepted;
    const safeToCommit = publishReady && blockerProgress && newBlockers.length === 0 && pageIdentity.passed && provisionalFileCheck.passed;
    const reason = !publishReady ? "repaired garden did not pass the final publication audit"
      : !blockerProgress ? "target blocker count did not decrease"
      : newBlockers.length ? `repair introduced ${newBlockers.length} unrelated blocker(s)`
        : !pageIdentity.passed ? "page byte-identity boundary failed"
          : !provisionalFileCheck.passed ? "allowed-file mutation boundary failed"
            : "target blockers decreased and all scoped boundaries passed";

    const report = {
      repairId: scope.repairId, scope, policy, filesActuallyChanged: provisionalFileCheck.changedFiles,
      operations, modelCalls, verifiedModelDecisions, rejectedModelDecisions,
      blockersBefore, blockersAfter, targetBlockersBefore, targetBlockersAfter,
      unaffectedPageHashesVerified: pageIdentity.passed,
      accepted, publishReady, publicationResult: safeToCommit ? "pending_atomic_promotion" : "rolled_back", reason,
    };
    writeIfChanged(absolute(staging, ".breadboard/scoped-repair.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeIfChanged(absolute(staging, ".breadboard/scoped-repair.md"), reportMarkdown({
      scope, policy, changedFiles: provisionalFileCheck.changedFiles, operations, modelCalls,
      verified: verifiedModelDecisions, rejected: rejectedModelDecisions, blockersBefore, blockersAfter,
      pageIdentityPassed: pageIdentity.passed, committed: safeToCommit, reason, accepted, publishReady,
    }));
    const afterFiles = fingerprintGardenFiles(staging);
    const files = verifyScopedFileMutationPolicy(beforeFiles, afterFiles, policy);
    const finalSafeToCommit = safeToCommit && files.passed;
    if (finalSafeToCommit) {
      reportLearnScopedRepairProgress(
        input.onProgress,
        { step: "Publishing repaired projection", scope },
        { publicationGate: true },
      );
    }
    const promotion = finalSafeToCommit
      ? await promoteStagingGarden({
          stagingGardenDir: staging,
          destinationGardenDir: input.gardenDir,
          retainPreviousUntilCallerCommit: true,
          recoveryOwnerId: input.recoveryOwnerId,
          verifyManifest: (incoming) =>
            verifyScopedFileMutationPolicy(
              beforeFiles,
              fingerprintGardenFiles(incoming),
              policy,
            ).passed &&
            auditGardenForFinalization(incoming, input.gardenId, {
              expectedSourceFormulaReviewContext,
            }).passed,
          verifyCurrentDestination: (current) =>
            (input.verifyLease?.() ?? true) &&
            identicalFingerprints(
              stableRepairFingerprints(beforeFiles),
              stableRepairFingerprints(fingerprintGardenFiles(current)),
            ),
          prepareIncomingForCommit: (incoming, current) => {
            mergeRepairEventLedgers(current, incoming);
            return true;
          },
        })
      : { promoted: false, destination: input.gardenDir, attempts: 0, reason };
    const committed = finalSafeToCommit && promotion.promoted;
    const transaction: LearnScopedRepairTransaction = {
      repairId: scope.repairId, scope, fingerprintBefore: current.state.fingerprint,
      fingerprintAfter: state.fingerprint, fileFingerprintsBefore: beforeFiles, fileFingerprintsAfter: afterFiles,
      operations, modelCalls, verifiedModelDecisions, rejectedModelDecisions, blockersBefore, blockersAfter,
      committed, rolledBack: !committed, reason: committed ? promotion.reason : promotion.reason || reason,
    };
    // Diagnostics are retained even when the staged content is rolled back, so
    // the UI can show remaining blockers without surfacing a repeated raw
    // finalizer error. Learner/source content is never written on this path.
    const finalReport = {
      ...report,
      filesActuallyChanged: files.changedFiles,
      committed,
      rolledBack: !committed,
      publicationResult: promotion,
      reason: transaction.reason,
    };
    try {
      writeIfChanged(absolute(input.gardenDir, ".breadboard/scoped-repair.json"), `${JSON.stringify(finalReport, null, 2)}\n`);
      writeIfChanged(absolute(input.gardenDir, ".breadboard/scoped-repair.md"), reportMarkdown({
        scope, policy, changedFiles: files.changedFiles, operations, modelCalls,
        verified: verifiedModelDecisions, rejected: rejectedModelDecisions, blockersBefore, blockersAfter,
        pageIdentityPassed: pageIdentity.passed, committed, reason: transaction.reason, accepted, publishReady,
      }));
    } catch {
      // The staged reports were already promoted. Enriching them with the
      // publication receipt is diagnostic-only and must not strand a retained
      // previous garden by throwing after the atomic swap.
    }
    return {
      scope, policy, transaction, selectedIssues, finalIssues: afterTyped.issues, files, pageIdentity,
      accepted, publishReady, promotion,
      reportJsonPath: ".breadboard/scoped-repair.json", reportMarkdownPath: ".breadboard/scoped-repair.md",
    };
  } finally {
    try { fs.rmSync(workspaceRoot, { recursive: true, force: true }); } catch { /* OS temp cleanup */ }
  }
}
