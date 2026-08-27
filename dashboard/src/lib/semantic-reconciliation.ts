// Post-structure semantic reconciliation.
//
// The final learner-page filesystem and the final Learning Unit Contract are
// authoritative. Everything else in the semantic layer — page primaryConcepts /
// supportingConcepts / tags / claimIds, the canonical claim registry, the
// canonical concept registry, and the health metrics derived from them — is a
// disposable projection that this module REBUILDS from the final state in one
// atomic transaction.
//
// Required direction:
//   final filesystem + final contract → rebuild projections → rebuild active
//   registries → audit → write reports
// Forbidden direction:
//   old registries + new pages → merge and preserve unmatched old records
//
// Everything here is deterministic and filesystem-only. Genuine semantic
// ambiguity (duplicate unit IDs, a unit with no derivable primary concept) is
// surfaced as an issue for the ChatMock critic stage — it is never "repaired"
// here by guessing, and ChatMock is never called from this transaction.
//
// This transaction must run strictly AFTER section/page renames are complete
// (post structural freeze), so every path it records is a final path.

import crypto from 'node:crypto';
import { externalRuntimeFilesystem as fs } from './external-runtime-filesystem.ts';
import { externalRuntimePath as path } from './external-runtime-path.ts';
import {
  SEMANTIC_SCHEMA_VERSION,
  mergeConcept,
  normalizeClaimRecord,
  normalizeConceptSlug,
  normalizePageConceptAssignment,
  reconcileConceptRegistryAliases,
  resolveConcept,
  sortConceptRegistry,
  stableClaimId,
  type ClaimRecord,
  type ClaimStore,
  type ConceptRecord,
  type ConceptRegistry,
} from './semantic-core.ts';
import {
  CLAIM_STORE_REL_PATH,
  CONCEPT_REGISTRY_REL_PATH,
  LEARNING_UNIT_CONTRACT_REL_PATH,
  isLearnerPage,
  parseSemanticMarkdown,
  performWritesWithBackup,
  readGardenSemanticArtifacts,
  readJson,
  renderSemanticMarkdown,
  semanticFrontmatterArray,
  stableJson,
  walkMarkdown,
  type Frontmatter,
  type PendingWrite,
} from './garden-semantics.ts';
import {
  knowledgeClaimsForUnit,
  normalizeLearningUnits,
  semanticConceptsForUnit,
  type LearningUnitContract,
} from './learning-unit-contract.ts';

export const CLAIM_HISTORY_REL_PATH = '.breadboard/claims-history.json';
export const CONCEPT_HISTORY_REL_PATH = '.breadboard/concept-registry-history.json';

// ---------------------------------------------------------------------------
// Fix 6: one canonical concept normalization function.
// Every writer (page frontmatter, contract, claims, registry, validators) must
// route concept handles through this single normalizer.
// ---------------------------------------------------------------------------

export function normalizeSemanticConceptHandle(value: string): string {
  return normalizeConceptSlug(value);
}

// ---------------------------------------------------------------------------
// Fix 1: canonical final page index
// ---------------------------------------------------------------------------

export interface FinalLearnerPageRecord {
  unitId: string;
  pagePath: string;
  sectionPath: string;
  title: string;
  sectionTitle: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface FinalLearnerPageIndex {
  byUnitId: Record<string, FinalLearnerPageRecord>;
  byPagePath: Record<string, FinalLearnerPageRecord>;
  duplicateUnitIds: string[];
  orphanPages: string[];
  contractUnitsWithoutPages: string[];
  valid: boolean;
  problems: string[];
}

function fmString(data: Frontmatter, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Discover the final learner pages from the actual filesystem and map each to
 * its contract unit by `learningUnitId`. Historical registry paths never enter
 * this index; section `_index.md` files are never learner pages.
 */
export function buildFinalLearnerPageIndex(
  gardenDir: string,
  contractUnits: readonly LearningUnitContract[],
): FinalLearnerPageIndex {
  const byUnitId: Record<string, FinalLearnerPageRecord> = {};
  const byPagePath: Record<string, FinalLearnerPageRecord> = {};
  const duplicateUnitIds: string[] = [];
  const orphanPages: string[] = [];
  const problems: string[] = [];
  const unitIds = new Set(contractUnits.map((unit) => unit.id));

  for (const file of walkMarkdown(gardenDir)) {
    const parsed = parseSemanticMarkdown(fs.readFileSync(file.absPath, 'utf8'));
    if (!isLearnerPage(file.relPath, parsed.data)) continue;
    const unitId =
      fmString(parsed.data, 'learningUnitId') || fmString(parsed.data, 'generatedFromUnitId');
    const segments = file.relPath.split('/');
    const record: FinalLearnerPageRecord = {
      unitId,
      pagePath: file.relPath,
      sectionPath: segments.slice(0, -1).join('/'),
      title: fmString(parsed.data, 'title') || path.basename(file.relPath, '.md'),
      sectionTitle: segments.length > 2 ? segments[segments.length - 2] : '',
      frontmatter: parsed.data,
      body: parsed.body,
    };
    byPagePath[record.pagePath] = record;
    if (!unitId || !unitIds.has(unitId)) {
      orphanPages.push(file.relPath);
      problems.push(
        `${file.relPath}: learner page has ${unitId ? `unknown learningUnitId "${unitId}"` : 'no learningUnitId'}`,
      );
      continue;
    }
    if (byUnitId[unitId]) {
      if (!duplicateUnitIds.includes(unitId)) duplicateUnitIds.push(unitId);
      problems.push(
        `unit ${unitId}: mapped by more than one final page (${byUnitId[unitId].pagePath}, ${record.pagePath})`,
      );
      continue;
    }
    byUnitId[unitId] = record;
  }

  const contractUnitsWithoutPages = contractUnits
    .map((unit) => unit.id)
    .filter((unitId) => !byUnitId[unitId]);
  for (const unitId of contractUnitsWithoutPages) {
    problems.push(`unit ${unitId}: contract unit has no final learner page`);
  }

  return {
    byUnitId,
    byPagePath,
    duplicateUnitIds: duplicateUnitIds.sort(),
    orphanPages: orphanPages.sort(),
    contractUnitsWithoutPages: contractUnitsWithoutPages.sort(),
    valid: duplicateUnitIds.length === 0,
    problems: [...new Set(problems)].sort(),
  };
}

// ---------------------------------------------------------------------------
// Fix 2/3: active-claim rebuild + historical archive
// ---------------------------------------------------------------------------

export type CanonicalClaim = ClaimRecord;

export interface HistoricalClaimRecord {
  claim: CanonicalClaim;
  status: 'superseded' | 'page_removed' | 'unit_removed' | 'semantic_identity_changed';
  supersededByClaimId?: string;
  archivedAt: string;
  reason: string;
}

export interface CanonicalClaimStore {
  schemaVersion: number;
  gardenId: string;
  records: HistoricalClaimRecord[];
}

export interface ActiveClaimRebuildResult {
  activeClaims: CanonicalClaim[];
  generatedClaimIds: string[];
  reusedStableClaimIds: string[];
  archivedClaims: HistoricalClaimRecord[];
  removedStaleClaimIds: string[];
  unresolvedUnits: { unitId: string; reason: string }[];
  problems: string[];
}

/**
 * Rebuild the active claim registry from the CURRENT contract and the CURRENT
 * page index. A previous claim is reused only when its stable semantic
 * identity (`stableClaimId(unitId, text)`) is regenerated by the current
 * contract; its page path is then reassigned from the page index. Every
 * previous claim that is not regenerated is archived — never carried forward
 * as an active claim pointing at an obsolete page.
 */
export function rebuildActiveClaimsFromFinalState(
  contractUnits: readonly LearningUnitContract[],
  pageIndex: FinalLearnerPageIndex,
  previousClaims: readonly CanonicalClaim[],
  registry: ConceptRegistry,
): ActiveClaimRebuildResult {
  const previousById = new Map(previousClaims.map((claim) => [claim.id, claim]));
  const activeById = new Map<string, CanonicalClaim>();
  const generatedClaimIds: string[] = [];
  const reusedStableClaimIds: string[] = [];
  const unresolvedUnits: { unitId: string; reason: string }[] = [];
  const problems: string[] = [];
  const newClaimIdsByUnit = new Map<string, string[]>();
  const unitIds = new Set(contractUnits.map((unit) => unit.id));

  for (const unit of contractUnits) {
    const page = pageIndex.byUnitId[unit.id];
    if (!page) {
      unresolvedUnits.push({ unitId: unit.id, reason: 'no final learner page for unit' });
      continue;
    }
    const plans = knowledgeClaimsForUnit(unit);
    for (const plan of plans) {
      const id = stableClaimId(unit.id, plan.text);
      const previous = previousById.get(id);
      // Only a status the current evidence still supports may be preserved.
      const status =
        previous &&
        (previous.status !== 'source-verified' || (plan.evidenceAnchors ?? []).length > 0) &&
        (previous.status !== 'synthesized' || (plan.derivationAnchors ?? []).length > 0)
          ? previous.status
          : 'unverified';
      try {
        const record = normalizeClaimRecord({
          text: plan.text,
          subject: plan.subject,
          predicate: plan.predicate,
          ...(plan.object ? { object: plan.object } : {}),
          conceptIds: plan.conceptIds ?? [],
          learningUnitId: unit.id,
          pageRelPath: page.pagePath,
          evidenceAnchors: plan.evidenceAnchors ?? [],
          derivationAnchors: plan.derivationAnchors ?? [],
          connectedClaimIds: [
            ...(plan.connectedClaimIds ?? []),
            ...(previous?.connectedClaimIds ?? []),
          ],
          status,
          registry,
        });
        activeById.set(record.id, record);
        (previous ? reusedStableClaimIds : generatedClaimIds).push(record.id);
        const list = newClaimIdsByUnit.get(unit.id) ?? [];
        list.push(record.id);
        newClaimIdsByUnit.set(unit.id, list);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        problems.push(`unit ${unit.id}: ${reason}`);
        unresolvedUnits.push({ unitId: unit.id, reason });
      }
    }
  }

  // Active claims may only connect to active claims.
  for (const [id, claim] of activeById) {
    const connected = claim.connectedClaimIds.filter(
      (target) => target !== id && activeById.has(target),
    );
    if (connected.length !== claim.connectedClaimIds.length) {
      activeById.set(id, { ...claim, connectedClaimIds: connected });
    }
  }

  const archivedAt = new Date().toISOString();
  const archivedClaims: HistoricalClaimRecord[] = [];
  for (const previous of previousClaims) {
    if (activeById.has(previous.id)) continue;
    let status: HistoricalClaimRecord['status'];
    let reason: string;
    if (!unitIds.has(previous.learningUnitId)) {
      status = 'unit_removed';
      reason = `unit ${previous.learningUnitId} is not in the current Learning Unit Contract`;
    } else if (!pageIndex.byUnitId[previous.learningUnitId]) {
      status = 'page_removed';
      reason = `unit ${previous.learningUnitId} has no final learner page`;
    } else {
      status = 'superseded';
      reason = 'claim was not regenerated from the current contract unit';
    }
    const replacements = newClaimIdsByUnit.get(previous.learningUnitId) ?? [];
    archivedClaims.push({
      claim: previous,
      status,
      ...(status === 'superseded' && replacements.length === 1
        ? { supersededByClaimId: replacements[0] }
        : {}),
      archivedAt,
      reason,
    });
  }

  return {
    activeClaims: [...activeById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    generatedClaimIds: generatedClaimIds.sort(),
    reusedStableClaimIds: reusedStableClaimIds.sort(),
    archivedClaims,
    removedStaleClaimIds: archivedClaims.map((record) => record.claim.id).sort(),
    unresolvedUnits,
    problems: [...new Set(problems)].sort(),
  };
}

// ---------------------------------------------------------------------------
// Fix 4: canonical page semantic projection
// ---------------------------------------------------------------------------

export interface PageSemanticProjection {
  unitId: string;
  pagePath: string;
  primaryConcepts: string[];
  supportingConcepts: string[];
  tags: string[];
  claimIds: string[];
  source: 'contract' | 'reconciled_contract_and_page' | 'semantic_repair';
  problems: string[];
}

/**
 * Project one unit's canonical concept assignment onto its final page.
 * `tags` is computed as exactly `unique([...primary, ...supporting])` — no
 * unrelated existing tags survive, no model-generated extras are appended.
 */
export function buildPageSemanticProjection(
  unit: LearningUnitContract,
  page: FinalLearnerPageRecord,
  activeClaims: readonly CanonicalClaim[],
  registry: ConceptRegistry,
): PageSemanticProjection {
  const plans = semanticConceptsForUnit(unit);
  const normalized = normalizePageConceptAssignment({
    primaryConcepts: plans.filter((plan) => plan.role === 'primary').map((plan) => plan.slug),
    supportingConcepts: plans.filter((plan) => plan.role === 'supporting').map((plan) => plan.slug),
    claimIds: activeClaims
      .filter((claim) => claim.learningUnitId === unit.id && claim.pageRelPath === page.pagePath)
      .map((claim) => claim.id),
    registry,
  });
  return {
    unitId: unit.id,
    pagePath: page.pagePath,
    primaryConcepts: normalized.assignment.primaryConcepts,
    supportingConcepts: normalized.assignment.supportingConcepts,
    tags: normalized.assignment.tags,
    claimIds: normalized.assignment.claimIds,
    source: 'contract',
    problems: normalized.problems.map((problem) => `${page.pagePath}: ${problem}`),
  };
}

// ---------------------------------------------------------------------------
// Fix 7: active concept registry rebuild
// ---------------------------------------------------------------------------

export type CanonicalSemanticConcept = ConceptRecord;

export interface ActiveConceptRegistryRebuildResult {
  concepts: CanonicalSemanticConcept[];
  reusedConceptIds: string[];
  newConceptIds: string[];
  archivedConceptIds: string[];
  unresolvedReferences: string[];
  problems: string[];
}

/**
 * A concept stays active only while something current references it: a page
 * semantic projection, a contract unit, or an active claim. Everything else is
 * archived. Kept concepts are scrubbed of relation/broader/narrower/related
 * references to archived concepts so no active record points at a removed one.
 */
export function rebuildActiveConceptRegistry(
  contractUnits: readonly LearningUnitContract[],
  projections: readonly PageSemanticProjection[],
  activeClaims: readonly CanonicalClaim[],
  registry: ConceptRegistry,
  previousConceptIds: ReadonlySet<string>,
  extraActiveConceptSlugs: ReadonlySet<string> = new Set(),
): ActiveConceptRegistryRebuildResult {
  const activeSlugs = new Set<string>(extraActiveConceptSlugs);
  const activeIds = new Set<string>();
  const unresolvedReferences: string[] = [];

  for (const projection of projections) {
    for (const slug of projection.tags) activeSlugs.add(normalizeSemanticConceptHandle(slug));
  }
  for (const unit of contractUnits) {
    for (const plan of semanticConceptsForUnit(unit)) {
      activeSlugs.add(normalizeSemanticConceptHandle(plan.slug));
    }
  }
  for (const claim of activeClaims) {
    activeIds.add(claim.subject);
    if (claim.object) activeIds.add(claim.object);
    for (const id of claim.conceptIds) activeIds.add(id);
  }
  for (const slug of activeSlugs) {
    if (!resolveConcept(slug, registry)) unresolvedReferences.push(`concept "${slug}" is not registered`);
  }

  const kept = registry.concepts.filter(
    (concept) => activeSlugs.has(concept.slug) || activeIds.has(concept.id),
  );
  const keptIds = new Set(kept.map((concept) => concept.id));
  const scrubbed = kept.map((concept) => ({
    ...concept,
    broader: concept.broader.filter((target) => keptIds.has(target)),
    narrower: concept.narrower.filter((target) => keptIds.has(target)),
    related: concept.related.filter((target) => keptIds.has(target)),
    relations: concept.relations.filter((relation) => keptIds.has(relation.target)),
  }));

  return {
    concepts: scrubbed,
    reusedConceptIds: scrubbed
      .map((concept) => concept.id)
      .filter((id) => previousConceptIds.has(id))
      .sort(),
    newConceptIds: scrubbed
      .map((concept) => concept.id)
      .filter((id) => !previousConceptIds.has(id))
      .sort(),
    archivedConceptIds: registry.concepts
      .map((concept) => concept.id)
      .filter((id) => !keptIds.has(id))
      .sort(),
    unresolvedReferences: [...new Set(unresolvedReferences)].sort(),
    problems: [],
  };
}

// ---------------------------------------------------------------------------
// Fix 12/13: stable semantic issue identities + deduplication
// ---------------------------------------------------------------------------

export type SemanticIssueType =
  | 'tag_projection_mismatch'
  | 'stale_claim_page_mapping'
  | 'missing_active_claim'
  | 'orphan_active_claim'
  | 'claim_page_bidirectional_mismatch'
  | 'concept_registry_stale_reference'
  | 'contract_page_mapping_mismatch'
  | 'report_serialization_failure';

export interface SemanticIssue {
  issueId: string;
  type: SemanticIssueType;
  pagePath?: string;
  unitId?: string;
  claimId?: string;
  conceptId?: string;
  message: string;
  evidence: Record<string, unknown>;
  detectedBy: string[];
}

/** Merge issue sets by stable ID: combine detectedBy and evidence claim lists,
 * never repeating the same underlying defect once per validator prefix. */
export function mergeSemanticIssues(issueSets: SemanticIssue[][]): SemanticIssue[] {
  const merged = new Map<string, SemanticIssue>();
  for (const issues of issueSets) {
    for (const issue of issues) {
      const existing = merged.get(issue.issueId);
      if (!existing) {
        merged.set(issue.issueId, {
          ...issue,
          detectedBy: [...new Set(issue.detectedBy)].sort(),
          evidence: { ...issue.evidence },
        });
        continue;
      }
      existing.detectedBy = [...new Set([...existing.detectedBy, ...issue.detectedBy])].sort();
      const mergedClaimIds = [
        ...new Set([
          ...((existing.evidence.affectedClaimIds as string[] | undefined) ?? []),
          ...((issue.evidence.affectedClaimIds as string[] | undefined) ?? []),
        ]),
      ].sort();
      if (mergedClaimIds.length > 0) existing.evidence.affectedClaimIds = mergedClaimIds;
    }
  }
  return [...merged.values()].sort((left, right) => left.issueId.localeCompare(right.issueId));
}

/**
 * Classify a validator problem line into a stable semantic issue, or null when
 * the line is not one of the known cross-validator semantic families. Used to
 * merge the same defect reported under several validator prefixes into one
 * blocker with a combined `detectedBy` list.
 */
export function semanticIssueFromValidatorProblem(
  detectedBy: string,
  problem: string,
): SemanticIssue | null {
  const stalePage = problem.match(/referenced page does not exist: (.+)$/);
  if (stalePage) {
    const claimId = problem.match(/^(claim:[^\s:]+):/)?.[1];
    return {
      issueId: `stale_claim_page_mapping:${stalePage[1].trim()}`,
      type: 'stale_claim_page_mapping',
      pagePath: stalePage[1].trim(),
      ...(claimId ? { claimId } : {}),
      message: `active claim(s) reference a page that no longer exists: ${stalePage[1].trim()}`,
      evidence: { stalePagePath: stalePage[1].trim(), ...(claimId ? { affectedClaimIds: [claimId] } : {}) },
      detectedBy: [detectedBy],
    };
  }
  const tagMismatch = problem.match(/^(.+?\.md): tags must equal (?:primaryConcepts \+ supportingConcepts|contract concepts\b.*)$/);
  if (tagMismatch) {
    return {
      issueId: `tag_projection_mismatch:${tagMismatch[1].trim()}`,
      type: 'tag_projection_mismatch',
      pagePath: tagMismatch[1].trim(),
      message: `${tagMismatch[1].trim()}: tags do not equal the canonical concept projection`,
      evidence: { problem },
      detectedBy: [detectedBy],
    };
  }
  const unitWithoutPage = problem.match(/^(?:learning )?unit (\S+?):? has no (?:generated |final )?learner page/);
  if (unitWithoutPage) {
    return {
      issueId: `contract_page_mapping_mismatch:${unitWithoutPage[1]}`,
      type: 'contract_page_mapping_mismatch',
      unitId: unitWithoutPage[1],
      message: `unit ${unitWithoutPage[1]} has no final learner page`,
      evidence: { problem },
      detectedBy: [detectedBy],
    };
  }
  const missingSection = problem.match(/^(?:validation report )?missing section "(.+)"$/);
  if (missingSection) {
    return {
      issueId: `report_serialization_failure:${missingSection[1]}`,
      type: 'report_serialization_failure',
      message: `validation report is missing section "${missingSection[1]}"`,
      evidence: { section: missingSection[1] },
      detectedBy: [detectedBy],
    };
  }
  return null;
}

/**
 * Deduplicate flattened `check: problem` blocker lines. Lines from the known
 * semantic families collapse into one line per stable issue (annotated with
 * every validator that detected it); everything else passes through unchanged.
 * The underlying checks still FAIL individually — only the flattened blocker
 * list stops multiple-counting one defect.
 */
export function dedupeSemanticBlockerLines(
  entries: readonly { check: string; problem: string }[],
): string[] {
  const passthrough: string[] = [];
  const issues: SemanticIssue[] = [];
  for (const entry of entries) {
    const issue = semanticIssueFromValidatorProblem(entry.check, entry.problem);
    if (issue) issues.push(issue);
    else passthrough.push(`${entry.check}: ${entry.problem}`);
  }
  const merged = mergeSemanticIssues([issues]).map((issue) => {
    const claimCount = (issue.evidence.affectedClaimIds as string[] | undefined)?.length ?? 0;
    const suffix = claimCount > 1 ? ` (${claimCount} claims affected)` : '';
    return `${issue.message}${suffix} [detected by: ${issue.detectedBy.join(', ')}]`;
  });
  return [...new Set([...passthrough, ...merged])];
}

// ---------------------------------------------------------------------------
// Deterministic issue collection over the CURRENT on-disk semantic state
// ---------------------------------------------------------------------------

function collectSemanticIssues(input: {
  pageIndex: FinalLearnerPageIndex;
  claims: readonly CanonicalClaim[];
  registry: ConceptRegistry;
  detectedBy: string;
}): SemanticIssue[] {
  const { pageIndex, claims, registry, detectedBy } = input;
  const issues: SemanticIssue[] = [];

  // Stale claim → page mappings, grouped per missing page path.
  const staleByPath = new Map<string, string[]>();
  for (const claim of claims) {
    if (!claim.pageRelPath || !pageIndex.byPagePath[claim.pageRelPath]) {
      const key = claim.pageRelPath || '(missing pageRelPath)';
      const list = staleByPath.get(key) ?? [];
      list.push(claim.id);
      staleByPath.set(key, list);
    }
  }
  for (const [stalePagePath, affectedClaimIds] of staleByPath) {
    issues.push({
      issueId: `stale_claim_page_mapping:${stalePagePath}`,
      type: 'stale_claim_page_mapping',
      pagePath: stalePagePath,
      message: `active claim(s) reference a page that no longer exists: ${stalePagePath}`,
      evidence: { stalePagePath, affectedClaimIds: affectedClaimIds.sort() },
      detectedBy: [detectedBy],
    });
  }

  // Page-side projection and bidirectional claim consistency.
  const activeClaimIds = new Set(claims.map((claim) => claim.id));
  const claimIdsByPage = new Map<string, Set<string>>();
  for (const claim of claims) {
    const set = claimIdsByPage.get(claim.pageRelPath) ?? new Set();
    set.add(claim.id);
    claimIdsByPage.set(claim.pageRelPath, set);
  }
  for (const page of Object.values(pageIndex.byPagePath)) {
    const data = page.frontmatter as Frontmatter;
    const tags = semanticFrontmatterArray(data, 'tags');
    const primary = semanticFrontmatterArray(data, 'primaryConcepts');
    const supporting = semanticFrontmatterArray(data, 'supportingConcepts');
    const union = [...new Set([...primary, ...supporting])];
    if (JSON.stringify(tags) !== JSON.stringify(union)) {
      issues.push({
        issueId: `tag_projection_mismatch:${page.pagePath}`,
        type: 'tag_projection_mismatch',
        pagePath: page.pagePath,
        ...(page.unitId ? { unitId: page.unitId } : {}),
        message: `${page.pagePath}: tags do not equal the canonical concept projection`,
        evidence: { tags, primaryConcepts: primary, supportingConcepts: supporting },
        detectedBy: [detectedBy],
      });
    }
    const pageClaimIds = semanticFrontmatterArray(data, 'claimIds');
    const expected = claimIdsByPage.get(page.pagePath) ?? new Set();
    const missing = [...expected].filter((id) => !pageClaimIds.includes(id)).sort();
    const dangling = pageClaimIds.filter((id) => !activeClaimIds.has(id)).sort();
    const misassigned = pageClaimIds
      .filter((id) => activeClaimIds.has(id) && !expected.has(id))
      .sort();
    if (missing.length > 0 || dangling.length > 0 || misassigned.length > 0) {
      issues.push({
        issueId: `claim_page_bidirectional_mismatch:${page.pagePath}`,
        type: 'claim_page_bidirectional_mismatch',
        pagePath: page.pagePath,
        message: `${page.pagePath}: page claimIds and the active claim registry disagree`,
        evidence: { missing, dangling, misassigned },
        detectedBy: [detectedBy],
      });
    }
  }

  // Contract/page mapping problems (duplicates, units without pages).
  for (const unitId of pageIndex.duplicateUnitIds) {
    issues.push({
      issueId: `contract_page_mapping_mismatch:${unitId}`,
      type: 'contract_page_mapping_mismatch',
      unitId,
      message: `unit ${unitId} is claimed by more than one final learner page`,
      evidence: { duplicate: true },
      detectedBy: [detectedBy],
    });
  }
  for (const unitId of pageIndex.contractUnitsWithoutPages) {
    issues.push({
      issueId: `contract_page_mapping_mismatch:${unitId}`,
      type: 'contract_page_mapping_mismatch',
      unitId,
      message: `unit ${unitId} has no final learner page`,
      evidence: { missingPage: true },
      detectedBy: [detectedBy],
    });
  }

  // Registry-side stale references: claim endpoints that no longer resolve.
  const registryIds = new Set(registry.concepts.map((concept) => concept.id));
  for (const claim of claims) {
    const missingEndpoints = [claim.subject, ...(claim.object ? [claim.object] : []), ...claim.conceptIds]
      .filter((id) => !registryIds.has(id))
      .sort();
    if (missingEndpoints.length > 0) {
      issues.push({
        issueId: `concept_registry_stale_reference:${claim.id}`,
        type: 'concept_registry_stale_reference',
        claimId: claim.id,
        message: `${claim.id}: references unregistered concept(s) ${missingEndpoints.join(', ')}`,
        evidence: { missingEndpoints },
        detectedBy: [detectedBy],
      });
    }
  }

  return mergeSemanticIssues([issues]);
}

// ---------------------------------------------------------------------------
// Final-state fingerprint
// ---------------------------------------------------------------------------

/**
 * Content fingerprint of the authoritative final state plus its active
 * semantic projections: learner pages, the Learning Unit Contract, and the
 * active registries. Reports embed this so a stale report is detectable.
 */
export function finalGardenStateFingerprint(gardenDir: string): string {
  const hash = crypto.createHash('sha1');
  const parts: string[] = [];
  for (const file of walkMarkdown(gardenDir)) {
    if (!file.relPath.startsWith('learning/')) continue;
    parts.push(`${file.relPath}:${crypto.createHash('sha1').update(fs.readFileSync(file.absPath)).digest('hex')}`);
  }
  for (const rel of [LEARNING_UNIT_CONTRACT_REL_PATH, CLAIM_STORE_REL_PATH, CONCEPT_REGISTRY_REL_PATH]) {
    const abs = path.join(gardenDir, ...rel.split('/'));
    if (fs.existsSync(abs)) {
      parts.push(`${rel}:${crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex')}`);
    }
  }
  for (const part of parts.sort()) hash.update(`${part}\n`);
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// Fix 10: report serialization verification (serializer test, not a gate on
// artifacts — an OLD report can never block a current, healthy garden).
// ---------------------------------------------------------------------------

export function verifyValidationReportSerialization(
  reportPath: string,
  requiredSections: readonly string[],
): { valid: boolean; missingSections: string[]; problems: string[] } {
  if (!fs.existsSync(reportPath)) {
    return { valid: false, missingSections: [...requiredSections], problems: ['report file missing'] };
  }
  const report = fs.readFileSync(reportPath, 'utf-8');
  const missingSections = requiredSections.filter(
    (section) =>
      !new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(report),
  );
  const problems = missingSections.map((section) => `missing section "${section}"`);
  if (!/^Accepted:\s+(?:yes|no)$/im.test(report)) problems.push('missing Accepted: yes/no line');
  return { valid: problems.length === 0, missingSections, problems };
}

// ---------------------------------------------------------------------------
// Part 6: the post-structure semantic reconciliation transaction
// ---------------------------------------------------------------------------

export interface SemanticReconciliationOptions {
  archiveHistoricalClaims: boolean;
  archiveUnusedConcepts: boolean;
  strictMode: boolean;
}

export interface SemanticReconciliationResult {
  passed: boolean;
  pageIndex: FinalLearnerPageIndex;
  projectionsBuilt: number;
  pagesUpdated: string[];
  contractUnitsUpdated: string[];
  activeClaims: number;
  archivedClaims: number;
  staleClaimsRemoved: number;
  claimsRemappedToNewPaths: number;
  activeConcepts: number;
  archivedConcepts: number;
  issuesBefore: SemanticIssue[];
  issuesAfter: SemanticIssue[];
  stateFingerprintBefore: string;
  stateFingerprintAfter: string;
  changed: boolean;
  stoppedReason:
    | 'reconciled'
    | 'no_changes_needed'
    | 'ambiguous_unit_page_mapping'
    | 'transaction_failed'
    | 'unresolved_semantic_issue';
}

function readRawContract(gardenDir: string): {
  raw: Record<string, unknown>;
  relPath: string;
  units: LearningUnitContract[];
} {
  const candidates = [
    LEARNING_UNIT_CONTRACT_REL_PATH,
    '.breadboard/planning/learning-unit-contract.json',
  ];
  for (const relPath of candidates) {
    const raw = readJson<Record<string, unknown>>(path.join(gardenDir, ...relPath.split('/')), {});
    const units = normalizeLearningUnits(raw);
    if (units.length > 0) return { raw, relPath, units };
  }
  return { raw: {}, relPath: LEARNING_UNIT_CONTRACT_REL_PATH, units: [] };
}

function readClaimHistory(gardenDir: string, gardenId: string): CanonicalClaimStore {
  const store = readJson<CanonicalClaimStore>(
    path.join(gardenDir, ...CLAIM_HISTORY_REL_PATH.split('/')),
    { schemaVersion: SEMANTIC_SCHEMA_VERSION, gardenId, records: [] },
  );
  return { ...store, records: Array.isArray(store.records) ? store.records : [] };
}

/**
 * Rebuild every derived semantic artifact from the final filesystem and the
 * final Learning Unit Contract, in one staged, rollback-backed transaction:
 *
 *   1. read final contract  2. discover final pages  3. unit→page index
 *   4. rebuild concept assignments  5. page projections  6. active claims
 *   7. active concept registry  8-10. stage page/contract/registry writes
 *   11. validate staged state  12. commit atomically  (13-15 happen in the
 *   caller: FinalGardenState rebuild, audit, canonical reports)
 *
 * Deterministic by design: ChatMock is never called here (Fix 14). Genuine
 * ambiguity — duplicate unit→page mappings — aborts the transaction with no
 * partial writes and is left for the critic stage.
 */
export function reconcileFinalGardenSemantics(
  gardenDir: string,
  gardenSlug: string,
  options: SemanticReconciliationOptions,
): SemanticReconciliationResult {
  const stateFingerprintBefore = finalGardenStateFingerprint(gardenDir);
  const contract = readRawContract(gardenDir);
  const artifacts = readGardenSemanticArtifacts(gardenDir, gardenSlug);
  const previousClaims = artifacts.claims.claims;
  const previousConceptIds = new Set(artifacts.registry.concepts.map((concept) => concept.id));

  // 2-3. Final page index from the filesystem.
  const pageIndex = buildFinalLearnerPageIndex(gardenDir, contract.units);

  // Pre-transaction issue snapshot over the CURRENT on-disk state.
  const issuesBefore = collectSemanticIssues({
    pageIndex,
    claims: previousClaims,
    registry: artifacts.registry,
    detectedBy: 'semantic-reconciliation (before)',
  });

  const emptyResult = (
    stoppedReason: SemanticReconciliationResult['stoppedReason'],
  ): SemanticReconciliationResult => ({
    passed: false,
    pageIndex,
    projectionsBuilt: 0,
    pagesUpdated: [],
    contractUnitsUpdated: [],
    activeClaims: previousClaims.length,
    archivedClaims: 0,
    staleClaimsRemoved: 0,
    claimsRemappedToNewPaths: 0,
    activeConcepts: artifacts.registry.concepts.length,
    archivedConcepts: 0,
    issuesBefore,
    issuesAfter: issuesBefore,
    stateFingerprintBefore,
    stateFingerprintAfter: stateFingerprintBefore,
    changed: false,
    stoppedReason,
  });

  // Genuine ambiguity: two pages claim one unit. No partial writes (test 21).
  if (!pageIndex.valid) return emptyResult('ambiguous_unit_page_mapping');
  if (contract.units.length === 0) return emptyResult('no_changes_needed');

  // 4. The registry must hold every contract-planned concept before claims and
  // projections resolve against it.
  let registry = artifacts.registry;
  const initialReconciliation = reconcileConceptRegistryAliases(registry);
  registry = initialReconciliation.registry;
  const suppressedAmbiguousAliases = new Set(
    initialReconciliation.repairs
      .filter((repair) => repair.reason === 'ambiguous-alias-removed')
      .map((repair) => repair.normalizedAlias),
  );
  for (const unit of contract.units) {
    for (const plan of semanticConceptsForUnit(unit)) {
      registry = mergeConcept(
        registry,
        {
          slug: plan.slug,
          preferredLabel: plan.preferredLabel,
          aliases: plan.aliases,
          evidenceAnchors: plan.evidenceAnchors,
          status: 'unverified',
        },
        { aliasCollisionPolicy: 'repair', suppressedAmbiguousAliases },
      );
    }
  }

  // 6. Active claims from the current contract + final page index.
  const claimRebuild = rebuildActiveClaimsFromFinalState(
    contract.units,
    pageIndex,
    previousClaims,
    registry,
  );
  const previousById = new Map(previousClaims.map((claim) => [claim.id, claim]));
  const claimsRemappedToNewPaths = claimRebuild.activeClaims.filter((claim) => {
    const previous = previousById.get(claim.id);
    return previous !== undefined && previous.pageRelPath !== claim.pageRelPath;
  }).length;

  // 5. Page projections (claim IDs come from the rebuilt active set).
  const projections: PageSemanticProjection[] = [];
  for (const unit of contract.units) {
    const page = pageIndex.byUnitId[unit.id];
    if (!page) continue;
    projections.push(buildPageSemanticProjection(unit, page, claimRebuild.activeClaims, registry));
  }

  // 7. Prune the registry to what the final state actually references.
  const registryRebuild = rebuildActiveConceptRegistry(
    contract.units,
    projections,
    claimRebuild.activeClaims,
    registry,
    previousConceptIds,
  );
  const activeRegistry: ConceptRegistry = sortConceptRegistry({
    ...registry,
    gardenId: registry.gardenId || gardenSlug,
    concepts: registryRebuild.concepts,
  });

  // 8-10. Stage all writes.
  const writes: PendingWrite[] = [];
  const pagesUpdated: string[] = [];
  for (const projection of projections) {
    const page = pageIndex.byPagePath[projection.pagePath];
    if (!page) continue;
    const abs = path.join(gardenDir, ...projection.pagePath.split('/'));
    const current = fs.readFileSync(abs, 'utf8');
    const next = renderSemanticMarkdown(parseSemanticMarkdown(current), {
      primaryConcepts: projection.primaryConcepts,
      supportingConcepts: projection.supportingConcepts,
      tags: projection.tags,
      claimIds: projection.claimIds,
    });
    if (next !== current) {
      writes.push({ relPath: projection.pagePath, content: next });
      pagesUpdated.push(projection.pagePath);
    }
  }

  const nextClaims: ClaimStore = {
    ...artifacts.claims,
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    gardenId: artifacts.claims.gardenId || gardenSlug,
    claims: claimRebuild.activeClaims,
  };
  writes.push({ relPath: CLAIM_STORE_REL_PATH, content: stableJson(nextClaims) });
  writes.push({ relPath: CONCEPT_REGISTRY_REL_PATH, content: stableJson(activeRegistry) });

  if (options.archiveHistoricalClaims && claimRebuild.archivedClaims.length > 0) {
    const history = readClaimHistory(gardenDir, gardenSlug);
    const known = new Set(history.records.map((record) => record.claim.id));
    const appended = [
      ...history.records,
      ...claimRebuild.archivedClaims.filter((record) => !known.has(record.claim.id)),
    ];
    writes.push({
      relPath: CLAIM_HISTORY_REL_PATH,
      content: stableJson({ ...history, gardenId: history.gardenId || gardenSlug, records: appended }),
    });
  }
  if (options.archiveUnusedConcepts && registryRebuild.archivedConceptIds.length > 0) {
    const historyPath = path.join(gardenDir, ...CONCEPT_HISTORY_REL_PATH.split('/'));
    const history = readJson<{ schemaVersion: number; gardenId: string; concepts: ConceptRecord[] }>(
      historyPath,
      { schemaVersion: SEMANTIC_SCHEMA_VERSION, gardenId: gardenSlug, concepts: [] },
    );
    const known = new Set((history.concepts ?? []).map((concept) => concept.id));
    const archived = artifacts.registry.concepts.filter(
      (concept) => registryRebuild.archivedConceptIds.includes(concept.id) && !known.has(concept.id),
    );
    writes.push({
      relPath: CONCEPT_HISTORY_REL_PATH,
      content: stableJson({ ...history, concepts: [...(history.concepts ?? []), ...archived] }),
    });
  }

  // Contract semanticConcepts write-back: patch ONLY that field, in place, so
  // page projections and contract projections cannot drift (Fix 5). All other
  // raw unit fields are preserved untouched.
  //
  // Critically, the contract is written from the SAME projection the page gets
  // — the registry-RESOLVED concepts, not the unit's raw planned slugs. A raw
  // slug can be an alias of a different canonical concept, or fall outside the
  // public-concept cap, so writing raw slugs here while the page carries
  // resolved slugs is precisely how `tags != contract concepts` drift is born.
  const contractUnitsUpdated: string[] = [];
  if (Object.keys(contract.raw).length > 0) {
    const projectionByUnitId = new Map(projections.map((projection) => [projection.unitId, projection]));
    const planByUnitSlug = new Map(
      contract.units.flatMap((unit) =>
        semanticConceptsForUnit(unit).map((plan) => [`${unit.id}::${plan.slug}`, plan] as const),
      ),
    );
    const patchUnits = (value: unknown): unknown => {
      if (!Array.isArray(value)) return value;
      return value.map((rawUnit) => {
        if (!rawUnit || typeof rawUnit !== 'object') return rawUnit;
        const record = rawUnit as Record<string, unknown>;
        const unitId = typeof record.id === 'string' ? record.id.trim() : '';
        const projection = projectionByUnitId.get(unitId);
        if (!projection || !pageIndex.byUnitId[unitId]) return rawUnit;
        const conceptEntry = (slug: string, role: 'primary' | 'supporting') => {
          const concept = resolveConcept(slug, activeRegistry);
          const plan = planByUnitSlug.get(`${unitId}::${slug}`);
          return {
            slug: concept?.slug ?? normalizeSemanticConceptHandle(slug),
            preferredLabel: concept?.preferredLabel ?? plan?.preferredLabel ?? slug,
            role,
            aliases: concept?.aliases ?? plan?.aliases ?? [],
            evidenceAnchors: plan?.evidenceAnchors ?? concept?.evidenceAnchors ?? [],
          };
        };
        const next = [
          ...projection.primaryConcepts.map((slug) => conceptEntry(slug, 'primary')),
          ...projection.supportingConcepts.map((slug) => conceptEntry(slug, 'supporting')),
        ];
        if (JSON.stringify(record.semanticConcepts ?? null) === JSON.stringify(next)) return rawUnit;
        contractUnitsUpdated.push(unitId);
        return { ...record, semanticConcepts: next };
      });
    };
    const nextRaw = {
      ...contract.raw,
      ...(Array.isArray(contract.raw.learningUnits)
        ? { learningUnits: patchUnits(contract.raw.learningUnits) }
        : {}),
      ...(Array.isArray(contract.raw.units) ? { units: patchUnits(contract.raw.units) } : {}),
    };
    if (contractUnitsUpdated.length > 0) {
      writes.push({ relPath: contract.relPath, content: stableJson(nextRaw) });
    }
  }

  // 11-12. Validate + commit atomically (performWritesWithBackup rolls back
  // every staged file if any single write fails).
  let changedFiles: string[];
  try {
    changedFiles = performWritesWithBackup(gardenDir, writes, 'semantic-reconciliation').changedFiles;
  } catch {
    return emptyResult('transaction_failed');
  }

  // Post-commit issue snapshot from the re-read state.
  const finalArtifacts = readGardenSemanticArtifacts(gardenDir, gardenSlug);
  const finalIndex = buildFinalLearnerPageIndex(gardenDir, contract.units);
  const issuesAfter = collectSemanticIssues({
    pageIndex: finalIndex,
    claims: finalArtifacts.claims.claims,
    registry: finalArtifacts.registry,
    detectedBy: 'semantic-reconciliation (after)',
  });

  const stateFingerprintAfter = finalGardenStateFingerprint(gardenDir);
  const changed = changedFiles.length > 0;
  const unresolved = issuesAfter.length > 0;
  return {
    passed: !unresolved || !options.strictMode,
    pageIndex: finalIndex,
    projectionsBuilt: projections.length,
    pagesUpdated: pagesUpdated.sort(),
    contractUnitsUpdated: [...new Set(contractUnitsUpdated)].sort(),
    activeClaims: claimRebuild.activeClaims.length,
    archivedClaims: claimRebuild.archivedClaims.length,
    staleClaimsRemoved: claimRebuild.removedStaleClaimIds.length,
    claimsRemappedToNewPaths,
    activeConcepts: activeRegistry.concepts.length,
    archivedConcepts: registryRebuild.archivedConceptIds.length,
    issuesBefore,
    issuesAfter,
    stateFingerprintBefore,
    stateFingerprintAfter,
    changed,
    stoppedReason: unresolved && options.strictMode
      ? 'unresolved_semantic_issue'
      : changed
        ? 'reconciled'
        : 'no_changes_needed',
  };
}
