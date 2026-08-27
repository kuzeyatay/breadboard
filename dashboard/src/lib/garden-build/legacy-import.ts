import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { deriveUnitFormulaRequirement, validateFormulaAssignment, type FormulaAssignmentProvenance } from "../formula-assignment.ts";
import type { CanonicalFormulaIdentity } from "../formula-identity.ts";
import { buildFinalGardenState, classifyAnchorUsage, type CanonicalSourceAnchor } from "../final-garden-state.ts";
import type { LearningUnitContract } from "../learning-unit-contract.ts";
import { conceptId, type ClaimStore, type ConceptRegistry, type RelationPredicate } from "../semantic-core.ts";
import { contentFingerprint, fingerprintGardenBuildState } from "./fingerprint.ts";
import { buildIdFor, formulaAssignmentId, pageIdForUnit, sectionIdForUnitMembership } from "./ids.ts";
import { mergeGardenIssues, stableGardenIssueId } from "./issue-identity.ts";
import type { GardenIssue, GardenIssueBase } from "./issues.ts";
import { validateGardenBuildInvariants } from "./invariants.ts";
import { createGardenBuildState } from "./state.ts";
import type { BuildFormulaAssignment, BuildPage, BuildSourceAnchor, GardenBuildState } from "./types.ts";

export interface LegacyImportMetrics {
  sourcesImported: number;
  sourceAnchorsImported: number;
  sectionsImported: number;
  unitsImported: number;
  pagesImported: number;
  conceptsImported: number;
  claimsImported: number;
  visualsImported: number;
  formulaIdentitiesImported: number;
  formulaAssignmentsImported: number;
  contradictoryProjections: number;
  stalePathReferences: number;
}

type FormulaIdentityArtifact = { identities?: CanonicalFormulaIdentity[] };
type ContractArtifact = { sourceSetHash?: string; formulaAssignmentProvenance?: FormulaAssignmentProvenance[] };

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; }
}

function importedIssue(input: {
  type: GardenIssue["type"];
  target: GardenIssueBase["target"];
  category: string;
  evidence?: Record<string, unknown>;
  repairClass?: GardenIssueBase["repairClass"];
  severity?: GardenIssueBase["severity"];
}): GardenIssue {
  const base: Omit<GardenIssueBase, "issueId"> = {
    type: input.type, severity: input.severity ?? "blocking", repairClass: input.repairClass ?? "deterministic",
    stage: "repair", target: input.target,
    evidence: { semanticCategory: input.category, ...input.evidence }, detectedBy: ["legacy_import"],
  };
  return { ...base, issueId: stableGardenIssueId(base) } as GardenIssue;
}

function anchorKind(anchor: CanonicalSourceAnchor): BuildSourceAnchor["kind"] {
  if (["formula", "figure", "graph", "table"].includes(anchor.kind)) return anchor.kind as BuildSourceAnchor["kind"];
  if (anchor.kind === "abstract" || anchor.kind === "intro" || anchor.kind === "guidance") return "example";
  return "text_concept";
}

function anchorStatus(anchor: CanonicalSourceAnchor): BuildSourceAnchor["status"] {
  if (anchor.confidence === "unsupported") return "unsupported";
  if ((anchor.confidence === "low" && !anchor.criticConfirmed) || anchor.relevance?.decision === "irrelevant") return "needs_review";
  return "verified";
}

function conceptIdsForUnit(unit: LearningUnitContract, role: "primary" | "supporting"): string[] {
  return [...new Set((unit.semanticConcepts ?? []).filter((entry) => entry.role === role).map((entry) => conceptId(entry.slug)))];
}

function formulaUsage(page: BuildPage | undefined, anchorId: string): BuildFormulaAssignment["usage"] {
  const entry = page?.formulaEntries.find((formula) => formula.sourceAnchorId === anchorId || formula.basedOnFormulaAnchorId === anchorId);
  if (!entry) return "text_explanation";
  if (entry.kind === "source_derived_definition") return "source_derived_definition";
  if (entry.kind === "worked_example") return "worked_example_basis";
  return "source_definition";
}

function frontmatterScalar(raw: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = raw.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "m"))?.[1]?.trim() ?? "";
  try { const parsed = JSON.parse(value); return typeof parsed === "string" ? parsed : String(parsed ?? ""); } catch { return value.replace(/^['\"]|['\"]$/g, ""); }
}

function selectLatestLegacyPage(pages: ReturnType<typeof buildFinalGardenState>["pages"]): { selected?: ReturnType<typeof buildFinalGardenState>["pages"][number]; candidates: Array<{ rel: string; date: string; learningVersion: string }> } {
  const candidates = pages.map((page) => ({ page, rel: page.rel, date: frontmatterScalar(page.rawFrontmatter, "date"), learningVersion: frontmatterScalar(page.rawFrontmatter, "learningVersion") }));
  const ranked = [...candidates].sort((left, right) => right.date.localeCompare(left.date) || right.learningVersion.localeCompare(left.learningVersion) || left.rel.localeCompare(right.rel));
  const uniqueLatest = ranked.length > 0 && (ranked.length === 1 || ranked[0].date !== ranked[1].date || ranked[0].learningVersion !== ranked[1].learningVersion);
  return { selected: uniqueLatest ? ranked[0].page : undefined, candidates: candidates.map(({ rel, date, learningVersion }) => ({ rel, date, learningVersion })) };
}

export function importLegacyGardenBuildState(
  gardenDir: string,
  gardenSlug: string,
): { state: GardenBuildState; issues: GardenIssue[]; metrics: LegacyImportMetrics } {
  const finalState = buildFinalGardenState(gardenDir, gardenSlug);
  const breadboardDir = path.join(gardenDir, ".breadboard");
  const contractRaw = readJson<ContractArtifact>(path.join(breadboardDir, "learning-unit-contract.json"), {});
  const conceptRegistry = readJson<ConceptRegistry>(path.join(breadboardDir, "concept-registry.json"), { schemaVersion: 1, gardenId: gardenSlug, sourceSetHash: "", concepts: [] });
  const claimStore = readJson<ClaimStore>(path.join(breadboardDir, "claims.json"), { schemaVersion: 1, gardenId: gardenSlug, sourceSetHash: "", claims: [] });
  const identityArtifact = readJson<FormulaIdentityArtifact>(path.join(breadboardDir, "formula-identities.json"), {});
  const identities = Array.isArray(identityArtifact.identities) ? identityArtifact.identities : [];
  const identityByAnchor = new Map(identities.map((identity) => [identity.anchorId, identity]));
  const sourceSetHash = contractRaw.sourceSetHash ?? conceptRegistry.sourceSetHash ?? claimStore.sourceSetHash ?? "";
  const buildId = buildIdFor(gardenSlug, sourceSetHash);
  const topicTitle = finalState.sections.find((section) => section.rel === "learning/_index.md")?.title ?? gardenSlug;
  const state = createGardenBuildState({ buildId, gardenId: gardenSlug, gardenSlug, topicTitle, sourceSetHash, stage: "repair" });
  const issues: GardenIssue[] = [];
  let contradictoryProjections = 0;
  let stalePathReferences = 0;

  for (const anchor of Object.values(finalState.sourceAnchors)) {
    const sourceId = anchor.sourceId ?? `source:unknown:${anchor.id}`;
    state.sources[sourceId] ??= { id: sourceId, title: sourceId, status: "active", provenance: { importedFrom: "source-anchor-registry" } };
    state.sourceAnchors[anchor.id] = {
      id: anchor.id, sourceId, kind: anchorKind(anchor), title: anchor.title,
      semanticSummary: anchor.semanticSummary ?? anchor.caption ?? anchor.title,
      conceptKeywords: anchor.conceptKeywords ?? [], page: anchor.page, exactText: anchor.exactText,
      conceptFamily: anchor.relevance?.anchorFamily, formulaIdentity: identityByAnchor.get(anchor.id),
      evidence: anchor.evidence,
      relevance: anchor.relevance as BuildSourceAnchor["relevance"], status: anchorStatus(anchor),
      provenance: { origin: anchor.origin, migration: anchor.migration, criticConfirmed: anchor.criticConfirmed === true },
    };
  }

  const anchorUsage = classifyAnchorUsage(finalState);
  for (const anchor of Object.values(finalState.sourceAnchors)) {
    if ((anchorStatus(anchor) === "needs_review" || anchorStatus(anchor) === "unsupported") && anchorUsage[anchor.id] === "actively_referenced") {
      const relevanceFailure = anchor.relevance?.decision === "irrelevant";
      issues.push(importedIssue({ type: relevanceFailure ? "source_anchor_relevance" : "weak_source_anchor", target: { anchorId: anchor.id, sourceId: anchor.sourceId }, category: relevanceFailure ? "irrelevant_source_text" : anchor.confidence === "unsupported" ? "unsupported_confidence_evidence" : "low_confidence_evidence", repairClass: "deterministic_then_model", evidence: { confidence: anchor.confidence, relevance: anchor.relevance, usageStatus: anchorUsage[anchor.id] } }));
    }
  }

  for (const concept of conceptRegistry.concepts ?? []) {
    state.concepts[concept.id] = {
      id: concept.id, slug: concept.slug, preferredLabel: concept.preferredLabel, aliases: [...concept.aliases],
      description: concept.description, broader: [...concept.broader], narrower: [...concept.narrower], related: [...concept.related], status: "active",
    };
  }

  const pageRecordsByUnit = new Map<string, typeof finalState.pages>();
  for (const page of finalState.pages) (pageRecordsByUnit.get(page.learningUnitId) ?? pageRecordsByUnit.set(page.learningUnitId, []).get(page.learningUnitId)!).push(page);
  const pageIdByLegacyPath: Record<string, string> = {};
  const unitIdByLegacyPath: Record<string, string> = {};
  const sectionPathByUnit = new Map<string, string>();
  const unambiguousPageByUnit = new Map<string, typeof finalState.pages[number]>();
  for (const [unitId, pages] of pageRecordsByUnit) {
    let selectedPage = pages.length === 1 ? pages[0] : undefined;
    if (pages.length !== 1) {
      contradictoryProjections += 1;
      const selection = selectLatestLegacyPage(pages);
      issues.push(importedIssue({
        type: "unit_page_mapping", target: { unitId, pageId: pageIdForUnit(unitId) },
        category: selection.selected ? "superseded_legacy_page_projection" : "duplicate_unit_page_projection",
        repairClass: selection.selected ? "deterministic" : "non_repairable", severity: selection.selected ? "warning" : "blocking",
        evidence: { candidates: selection.candidates, selectedLegacyPath: selection.selected?.rel, selectionRule: "unique latest date and learningVersion" },
      }));
      if (!selection.selected) continue;
      selectedPage = selection.selected;
    }
    const page = selectedPage!;
    unambiguousPageByUnit.set(unitId, page);
    pageIdByLegacyPath[page.rel] = pageIdForUnit(unitId);
    pageIdByLegacyPath[page.rel.replace(/\.md$/i, "")] = pageIdForUnit(unitId);
    unitIdByLegacyPath[page.rel] = unitId;
    unitIdByLegacyPath[page.rel.replace(/\.md$/i, "")] = unitId;
    sectionPathByUnit.set(unitId, page.rel.split("/").slice(0, -1).join("/"));
  }

  const orderedUnits = finalState.learningUnitContract.units;
  const sectionMembership = new Map<string, string[]>();
  for (const unit of orderedUnits) {
    const key = sectionPathByUnit.get(unit.id) ?? `unmapped:${unit.id}`;
    (sectionMembership.get(key) ?? sectionMembership.set(key, []).get(key)!).push(unit.id);
  }
  const sectionIdByLegacyPath = new Map<string, string>();
  for (const [legacySectionPath, unitIds] of sectionMembership) {
    const sectionId = sectionIdForUnitMembership(unitIds);
    sectionIdByLegacyPath.set(legacySectionPath, sectionId);
    const legacySection = finalState.sections.find((section) => section.rel.replace(/\/_index\.md$/i, "") === legacySectionPath);
    state.sections[sectionId] = {
      id: sectionId, order: Math.min(...unitIds.map((unitId) => orderedUnits.findIndex((unit) => unit.id === unitId))),
      title: legacySection?.title ?? unambiguousPageByUnit.get(unitIds[0])?.title ?? unitIds[0], unitIds: [...unitIds], summary: legacySection?.body,
    };
  }

  for (let order = 0; order < orderedUnits.length; order += 1) {
    const unit = orderedUnits[order];
    const pageId = pageIdForUnit(unit.id);
    const legacyPage = unambiguousPageByUnit.get(unit.id);
    const sectionId = sectionIdByLegacyPath.get(sectionPathByUnit.get(unit.id) ?? `unmapped:${unit.id}`)!;
    const primaryConceptIds = conceptIdsForUnit(unit, "primary");
    const supportingConceptIds = conceptIdsForUnit(unit, "supporting");
    const formulaAssignmentIds = unit.sourceFormulas.map((formula) => formulaAssignmentId(formula.id, unit.id));
    state.units[unit.id] = {
      id: unit.id, sectionId, pageId, order, title: unit.title, role: unit.role, learningQuestion: unit.learningQuestion,
      prerequisiteConceptIds: unit.prerequisiteConcepts.map(conceptId).filter((id) => Boolean(state.concepts[id])), primaryConceptIds, supportingConceptIds,
      sourceAnchorIds: [...new Set(unit.sourceAnchors)], sourceVisualAnchorIds: [...new Set(unit.sourceFigures.map((figure) => figure.id))],
      formulaAssignmentIds, claimIds: [], visualIds: [],
      zettelNotes: unit.zettelNotes.map((note) => ({ handle: note.handle, claim: note.claim, connectedConceptIds: note.connectedTo.map(conceptId).filter((id) => Boolean(state.concepts[id])) })),
      status: legacyPage ? "generated" : "planned",
    };
    if (!legacyPage) continue;
    const formulaEntries = legacyPage.formulas.map((formula) => ({
      kind: formula.declaredKind || formula.structuralKind, text: formula.text,
      sourceAnchorId: formula.sourceAnchor, basedOnFormulaAnchorId: formula.basedOnFormula,
      formulaFamily: formula.formulaFamily, exampleGroupId: formula.exampleGroupId,
    }));
    state.pages[pageId] = {
      id: pageId, unitId: unit.id, sectionId, order, title: legacyPage.title, body: legacyPage.body,
      formulaEntries, embeddedVisualIds: [...legacyPage.visualIds], contentFingerprint: contentFingerprint(legacyPage.body), legacyPath: legacyPage.rel,
    };
    const expectedTags = new Set([...primaryConceptIds, ...supportingConceptIds].map((id) => state.concepts[id]?.slug).filter(Boolean));
    const actualTags = new Set(legacyPage.tags);
    if (expectedTags.size !== actualTags.size || [...expectedTags].some((tag) => !actualTags.has(tag!))) {
      contradictoryProjections += 1;
      issues.push(importedIssue({ type: "tag_projection", target: { unitId: unit.id, pageId }, category: "contract_page_tag_drift", evidence: { expectedTags: [...expectedTags], actualTags: [...actualTags], legacyPath: legacyPage.rel } }));
    }
  }

  for (const claim of claimStore.claims ?? []) {
    const expectedPageId = pageIdForUnit(claim.learningUnitId);
    const pageId = pageIdByLegacyPath[claim.pageRelPath];
    if (!pageId || pageId !== expectedPageId || !state.units[claim.learningUnitId] || !state.pages[expectedPageId]) {
      stalePathReferences += 1;
      issues.push(importedIssue({ type: "claim_page_mapping", target: { claimId: claim.id, unitId: claim.learningUnitId, pageId: expectedPageId }, category: "stale_claim_path", evidence: { legacyPagePath: claim.pageRelPath, resolvedPageId: pageId } }));
      continue;
    }
    state.claims[claim.id] = {
      id: claim.id, unitId: claim.learningUnitId, pageId, text: claim.text, subjectConceptId: claim.subject,
      objectConceptId: claim.object, predicate: claim.predicate as RelationPredicate, conceptIds: [...claim.conceptIds],
      evidenceAnchorIds: [...claim.evidenceAnchors], derivationAnchorIds: [...claim.derivationAnchors], status: "active",
    };
    state.units[claim.learningUnitId]?.claimIds.push(claim.id);
  }

  for (const visual of finalState.visuals) {
    const pageId = visual.pageRel ? pageIdByLegacyPath[visual.pageRel] ?? pageIdByLegacyPath[`${visual.pageRel}.md`] : undefined;
    const unitId = pageId ? state.pages[pageId]?.unitId : undefined;
    const status = visual.pageRel && !pageId ? "unresolved" : visual.anchorIds.length + visual.textAnchorIds.length > 0 ? "grounded" : "omitted";
    state.visuals[visual.id] = {
      id: visual.id, pageId, unitId, type: visual.type, sourceAnchorIds: [...visual.anchorIds], textAnchorIds: [...visual.textAnchorIds],
      status, provenance: { fromFile: visual.fromFile, fromBody: visual.fromBody, legacyPagePath: visual.pageRel },
    };
    if (pageId && state.pages[pageId] && !state.pages[pageId].embeddedVisualIds.includes(visual.id)) state.pages[pageId].embeddedVisualIds.push(visual.id);
    if (unitId && !state.units[unitId].visualIds.includes(visual.id)) state.units[unitId].visualIds.push(visual.id);
    if (status === "unresolved") {
      stalePathReferences += 1;
      issues.push(importedIssue({ type: "visual_grounding", target: { visualId: visual.id }, category: "stale_visual_page_path", evidence: { legacyPagePath: visual.pageRel } }));
    }
  }

  const provenanceByPair = new Map((contractRaw.formulaAssignmentProvenance ?? []).map((entry) => [`${entry.formulaAnchorId}\u0000${entry.unitId}`, entry]));
  for (const unit of orderedUnits) {
    const pageId = pageIdForUnit(unit.id);
    for (const formula of unit.sourceFormulas) {
      const identity = identityByAnchor.get(formula.id);
      if (!identity) {
        issues.push(importedIssue({ type: "formula_identity", target: { formulaAnchorId: formula.id, unitId: unit.id, pageId }, category: "missing_imported_formula_identity", repairClass: "deterministic_then_model" }));
        continue;
      }
      const requirement = deriveUnitFormulaRequirement(unit);
      const compatibility = validateFormulaAssignment(identity, requirement, unit);
      const id = formulaAssignmentId(formula.id, unit.id);
      const provenance = provenanceByPair.get(`${formula.id}\u0000${unit.id}`) ?? {
        formulaAnchorId: formula.id, unitId: unit.id, verifiedFamily: identity.family,
        compatibilityScore: compatibility.totalScore, status: compatibility.hardRejectionReasons.length ? "removed_incompatible" : "verified",
        reason: "imported from current Learning Unit Contract without recomputing formula identity",
      } satisfies FormulaAssignmentProvenance;
      state.formulaAssignments[id] = {
        id, formulaAnchorId: formula.id, unitId: unit.id, pageId, identity, requirement, compatibility,
        usage: formulaUsage(state.pages[pageId], formula.id), status: compatibility.hardRejectionReasons.length ? "rejected" : "verified", provenance,
      };
      if (compatibility.hardRejectionReasons.length) {
        contradictoryProjections += 1;
        issues.push(importedIssue({
          type: "formula_assignment_family_mismatch", target: { formulaAssignmentId: id, formulaAnchorId: formula.id, unitId: unit.id, pageId },
          category: "formula_assignment_incompatible", repairClass: "deterministic_then_model",
          evidence: { verifiedFormulaFamily: identity.family, requiredFamilies: requirement.requiredFamilies, acceptedRelatedFamilies: requirement.acceptedRelatedFamilies, compatibilityScore: compatibility.totalScore, hardRejectionReasons: compatibility.hardRejectionReasons },
        }));
      }
    }
  }

  state.sourceCoverage.usages = finalState.sourceUsages.map((usage) => ({
    anchorId: usage.anchorId, pageId: pageIdByLegacyPath[usage.pageRel] ?? pageIdByLegacyPath[`${usage.pageRel}.md`],
    unitId: unitIdByLegacyPath[usage.pageRel] ?? unitIdByLegacyPath[`${usage.pageRel}.md`], mode: usage.kind,
  }));
  const visualLedger = readJson<Array<Record<string, unknown>>>(path.join(breadboardDir, "source-visuals.json"), []);
  state.sourceCoverage.intentionalOmissions = visualLedger
    .filter((entry) => String(entry.usageStatus ?? "") === "intentionally_omitted" || Boolean(entry.omissionReason))
    .map((entry) => ({ anchorId: String(entry.sourceVisualId ?? ""), reason: String(entry.omissionReason ?? "intentionally omitted by legacy plan") }))
    .filter((entry) => entry.anchorId);

  state.issueState.active = mergeGardenIssues([issues, validateGardenBuildInvariants(state)]).filter((entry) => entry.severity === "blocking");
  state.issueState.warnings = mergeGardenIssues([issues]).filter((entry) => entry.severity !== "blocking");
  state.fingerprint = fingerprintGardenBuildState(state);
  state.acceptance.stateFingerprint = state.fingerprint;

  const allIssues = mergeGardenIssues([issues, validateGardenBuildInvariants(state)]);
  return {
    state,
    issues: allIssues,
    metrics: {
      sourcesImported: Object.keys(state.sources).length, sourceAnchorsImported: Object.keys(state.sourceAnchors).length,
      sectionsImported: Object.keys(state.sections).length, unitsImported: Object.keys(state.units).length, pagesImported: Object.keys(state.pages).length,
      conceptsImported: Object.keys(state.concepts).length, claimsImported: Object.keys(state.claims).length, visualsImported: Object.keys(state.visuals).length,
      formulaIdentitiesImported: identities.length, formulaAssignmentsImported: Object.keys(state.formulaAssignments).length,
      contradictoryProjections, stalePathReferences,
    },
  };
}
