import { createHash } from 'node:crypto';

export const SEMANTIC_SCHEMA_VERSION = 1;
export const MAX_PUBLIC_CONCEPTS = 5;

export const SUPPORTED_RELATION_PREDICATES = [
  'prerequisite-of',
  'causes',
  'enables',
  'derived-from',
  'measured-by',
  'contrasts-with',
  'example-of',
  'part-of',
  'applies-to',
  'limits',
  'emits-when',
  'related-to',
] as const;

export type RelationPredicate = (typeof SUPPORTED_RELATION_PREDICATES)[number];
export type ConceptRole = 'primary' | 'supporting';
export type SemanticEvidenceStatus = 'source-verified' | 'synthesized' | 'unverified';

export interface ConceptRelation {
  predicate: RelationPredicate;
  target: string;
  evidenceAnchors?: string[];
}

export interface ConceptRecord {
  id: string;
  slug: string;
  preferredLabel: string;
  aliases: string[];
  description: string;
  broader: string[];
  narrower: string[];
  related: string[];
  relations: ConceptRelation[];
  evidenceAnchors: string[];
  status: SemanticEvidenceStatus;
}

export interface ConceptRegistry {
  schemaVersion: number;
  gardenId: string;
  sourceSetHash: string;
  concepts: ConceptRecord[];
  migration?: {
    fromSchema: string;
    version: number;
    migratedAt: string;
  };
}

export interface SemanticConceptPlan {
  slug: string;
  preferredLabel: string;
  role: ConceptRole;
  aliases: string[];
  evidenceAnchors: string[];
}

export interface KnowledgeClaimPlan {
  text: string;
  subject: string;
  predicate: RelationPredicate;
  object?: string;
  conceptIds?: string[];
  evidenceAnchors: string[];
  derivationAnchors?: string[];
  connectedClaimIds?: string[];
}

export interface ClaimRecord {
  id: string;
  text: string;
  subject: string;
  predicate: RelationPredicate;
  object?: string;
  conceptIds: string[];
  learningUnitId: string;
  pageRelPath: string;
  evidenceAnchors: string[];
  derivationAnchors: string[];
  status: SemanticEvidenceStatus;
  connectedClaimIds: string[];
}

export interface ClaimStore {
  schemaVersion: number;
  gardenId: string;
  sourceSetHash: string;
  claims: ClaimRecord[];
  /** Present only when active Learn projected claims verbatim from its validated
   * model-authored Learning Unit Contract. It lets the final gate enforce the
   * stricter page/contract/store bijection without changing legacy gardens. */
  projection?: {
    authority: 'model-authored-learning-unit-contract';
    contractPath: '.breadboard/learning-unit-contract.json';
  };
  migration?: {
    fromSchema: string;
    version: number;
    migratedAt: string;
  };
}

export interface PageConceptAssignment {
  primaryConcepts: string[];
  supportingConcepts: string[];
  tags: string[];
  claimIds: string[];
}

export interface AliasConflict {
  normalizedAlias: string;
  conceptIds: string[];
}

export type ConceptAliasRepairReason =
  | 'canonical-term-wins'
  | 'seeded-alias-wins'
  | 'ambiguous-alias-removed'
  | 'canonical-label-relabeled';

export interface ConceptAliasRepair {
  normalizedAlias: string;
  removedFrom: string[];
  ownerConceptId?: string;
  reason: ConceptAliasRepairReason;
}

export interface ConceptAliasReconciliation<T extends {
  slug: string;
  preferredLabel: string;
  aliases: string[];
}> {
  concepts: T[];
  repairs: ConceptAliasRepair[];
  conflicts: AliasConflict[];
}

export interface SemanticHealthMetrics {
  learnerPages: number;
  conceptAssignments: number;
  uniqueConcepts: number;
  singletonConcepts: number;
  sharedConcepts: number;
  sharedConceptPagePairs: number;
  claimsWithEvidence: number;
  claimsWithoutEvidence: number;
  orphanConcepts: number;
  aliasConflicts: number;
  invalidRelationEndpoints: number;
}

const GENERIC_CONCEPT_SLUGS = new Set([
  'answer', 'chapter', 'concept', 'content', 'definition', 'document', 'example',
  'file', 'garden', 'general', 'generated', 'index', 'introduction', 'learning',
  'lesson', 'markdown', 'note', 'overview', 'page', 'section', 'source', 'summary',
  'text', 'topic', 'unit', 'understanding',
]);

const CLAIM_VERBS = new Set([
  'adjusts', 'allows', 'bounds', 'causes', 'changes', 'controls', 'converts',
  'depends', 'emits', 'enables', 'exposes', 'follows', 'hides', 'integrates',
  'keeps', 'limits', 'makes', 'measures', 'moves', 'prevents', 'reflects',
  'requires', 'resets', 'saves', 'separates', 'trades', 'turns', 'updates',
  'uses', 'wastes',
]);

const GENERIC_CLAIM_PATTERNS = [
  /makes-the-behavior-measurable/i,
  /adjusts-weights-through-a-specific-rule/i,
  /turns-accumulated-input-into-a-discrete-event/i,
  /stays-testable-through-observable-details/i,
  /changes-which-decision-a-learner-should-make/i,
  /connects-learner-question/i,
  /anchors-the-lesson/i,
  /defines-the-lesson/i,
];

const PREDICATE_ALIASES: Record<string, RelationPredicate> = {
  'depends-on': 'prerequisite-of',
  'prerequisite': 'prerequisite-of',
  'prerequisite-for': 'prerequisite-of',
  'derives-from': 'derived-from',
  'derived-from': 'derived-from',
  'measures': 'measured-by',
  'measured-with': 'measured-by',
  'contrast-with': 'contrasts-with',
  'contrasts': 'contrasts-with',
  'example': 'example-of',
  'part': 'part-of',
  'applied-to': 'applies-to',
  'applies': 'applies-to',
  'limited-by': 'limits',
  'emits-at': 'emits-when',
  'related': 'related-to',
};

export const SEEDED_CONCEPT_ALIASES: Record<string, string[]> = {
  'ann-to-snn-conversion': ['ANN-to-SNN', 'ANN to SNN conversion'],
  'event-driven-processing': ['event-driven computation', 'event driven processing'],
  'lif-neuron': [
    'LIF',
    'LIF neuron',
    'leaky integrate-and-fire neuron',
    'leaky integrate fire model',
    'threshold neuron model',
  ],
  'membrane-potential': ['membrane voltage'],
  'spike-threshold': ['firing threshold', 'threshold crossing'],
  stdp: ['spike-timing-dependent plasticity', 'spike timing dependent plasticity'],
  'surrogate-gradient': ['surrogate gradients'],
};

export function compactSemanticText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function normalizeLookupText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeConceptSlug(value: string): string {
  const raw = value.replace(/^concept:/i, '');
  return normalizeLookupText(raw).replace(/\s+/g, '-');
}

export function conceptId(slug: string): string {
  return `concept:${normalizeConceptSlug(slug)}`;
}

export function preferredLabelFromSlug(slug: string): string {
  const normalized = normalizeConceptSlug(slug);
  const acronym = normalized.toUpperCase();
  if (normalized === 'lif-neuron') return 'Leaky integrate-and-fire neuron';
  if (normalized === 'stdp') return 'Spike-timing-dependent plasticity';
  if (normalized === 'ann-to-snn-conversion') return 'ANN-to-SNN conversion';
  if (/^[a-z]{2,5}$/.test(normalized)) return acronym;
  return normalized
    .split('-')
    .map((word, index) => (index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word))
    .join(' ');
}

export function looksLikeClaimSlug(value: string): boolean {
  const slug = normalizeConceptSlug(value);
  if (!slug) return true;
  if (slug.length > 52) return true;
  const words = slug.split('-').filter(Boolean);
  if (words.length > 5) return true;
  if (GENERIC_CLAIM_PATTERNS.some((pattern) => pattern.test(slug))) return true;
  return words.length >= 4 && words.some((word) => CLAIM_VERBS.has(word));
}

export function isValidPublicConceptSlug(value: string): boolean {
  const slug = normalizeConceptSlug(value);
  if (!slug || slug.length > 48) return false;
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{2,5}$/.test(slug)) return false;
  if (GENERIC_CONCEPT_SLUGS.has(slug)) return false;
  if (/^(?:page|slide|figure|table)-?\d+/i.test(slug)) return false;
  if (looksLikeClaimSlug(slug)) return false;
  return true;
}

export function normalizeRelationPredicate(value: unknown): RelationPredicate {
  const normalized = normalizeConceptSlug(compactSemanticText(value));
  if ((SUPPORTED_RELATION_PREDICATES as readonly string[]).includes(normalized)) {
    return normalized as RelationPredicate;
  }
  return PREDICATE_ALIASES[normalized] ?? 'related-to';
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => compactSemanticText(value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function uniqueAliasesByLookup(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return uniqueSorted(values).filter((value) => {
    const key = normalizeLookupText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createEmptyConceptRegistry(
  gardenId: string,
  sourceSetHash = '',
): ConceptRegistry {
  return {
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    gardenId,
    sourceSetHash,
    concepts: [],
  };
}

export function createEmptyClaimStore(gardenId: string, sourceSetHash = ''): ClaimStore {
  return {
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    gardenId,
    sourceSetHash,
    claims: [],
  };
}

export function normalizeConceptRecord(
  input: Partial<ConceptRecord> & { slug: string },
): ConceptRecord {
  const slug = normalizeConceptSlug(input.slug);
  const id = conceptId(slug);
  const aliases = uniqueAliasesByLookup(input.aliases ?? [])
    .filter((alias) => normalizeLookupText(alias) !== normalizeLookupText(input.preferredLabel ?? ''));
  const relations = (input.relations ?? [])
    .map((relation) => ({
      predicate: normalizeRelationPredicate(relation.predicate),
      target: conceptId(relation.target),
      evidenceAnchors: uniqueSorted(relation.evidenceAnchors ?? []),
    }))
    .filter((relation) => relation.target !== id)
    .sort((left, right) =>
      left.predicate.localeCompare(right.predicate) || left.target.localeCompare(right.target),
    );

  return {
    id,
    slug,
    preferredLabel: compactSemanticText(input.preferredLabel) || preferredLabelFromSlug(slug),
    aliases,
    description: compactSemanticText(input.description),
    broader: uniqueSorted((input.broader ?? []).map(conceptId)).filter((target) => target !== id),
    narrower: uniqueSorted((input.narrower ?? []).map(conceptId)).filter((target) => target !== id),
    related: uniqueSorted((input.related ?? []).map(conceptId)).filter((target) => target !== id),
    relations,
    evidenceAnchors: uniqueSorted(input.evidenceAnchors ?? []),
    status: input.status ?? ((input.evidenceAnchors?.length ?? 0) > 0 ? 'source-verified' : 'unverified'),
  };
}

export function sortConceptRegistry(registry: ConceptRegistry): ConceptRegistry {
  const concepts = registry.concepts
    .map(normalizeConceptRecord)
    .sort((left, right) => left.slug.localeCompare(right.slug));
  const canonicalOwners = new Map<string, Set<string>>();
  const addCanonicalOwner = (term: string, id: string) => {
    const key = normalizeLookupText(term);
    if (!key) return;
    const ids = canonicalOwners.get(key) ?? new Set<string>();
    ids.add(id);
    canonicalOwners.set(key, ids);
  };
  for (const concept of concepts) {
    for (const term of [concept.slug, concept.preferredLabel]) {
      addCanonicalOwner(term, concept.id);
    }
  }

  const seededClaimants = new Map<string, Set<string>>();
  for (const concept of concepts) {
    for (const seededAlias of SEEDED_CONCEPT_ALIASES[concept.slug] ?? []) {
      const key = normalizeLookupText(seededAlias);
      if (!key) continue;
      const ids = seededClaimants.get(key) ?? new Set<string>();
      ids.add(concept.id);
      seededClaimants.set(key, ids);
    }
  }
  const allowedSeedOwners = new Map<string, Set<string>>();
  for (const [key, claimants] of seededClaimants) {
    const canonical = canonicalOwners.get(key) ?? new Set<string>();
    allowedSeedOwners.set(
      key,
      canonical.size > 0
        ? new Set(canonical)
        : claimants.size === 1
          ? new Set(claimants)
          : new Set<string>(),
    );
  }

  const conceptsWithSafeSeeds = concepts.map((concept) => {
    const aliases = concept.aliases.filter((alias) => {
      const key = normalizeLookupText(alias);
      const allowedOwners = allowedSeedOwners.get(key);
      return !allowedOwners || allowedOwners.has(concept.id);
    });
    for (const seededAlias of SEEDED_CONCEPT_ALIASES[concept.slug] ?? []) {
      const key = normalizeLookupText(seededAlias);
      if (allowedSeedOwners.get(key)?.has(concept.id)) aliases.push(seededAlias);
    }
    return normalizeConceptRecord({ ...concept, aliases });
  });
  return {
    ...registry,
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    concepts: conceptsWithSafeSeeds,
  };
}

export function aliasConflicts(registry: ConceptRegistry): AliasConflict[] {
  const owners = new Map<string, Set<string>>();
  for (const concept of registry.concepts) {
    for (const term of [concept.slug, concept.preferredLabel, ...concept.aliases]) {
      const key = normalizeLookupText(term);
      if (!key) continue;
      const ids = owners.get(key) ?? new Set<string>();
      ids.add(concept.id);
      owners.set(key, ids);
    }
  }
  return [...owners.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([normalizedAlias, ids]) => ({
      normalizedAlias,
      conceptIds: [...ids].sort(),
    }))
    .sort((left, right) => left.normalizedAlias.localeCompare(right.normalizedAlias));
}

/**
 * Remove unsafe aliases without merging distinct concept identities.
 *
 * Canonical slugs and preferred labels always outrank aliases. A curated
 * seeded alias may own a term when no canonical concept does. If multiple
 * ordinary aliases claim the same otherwise-unowned term, none is safe, so
 * the term is removed from every claimant. Canonical-vs-canonical conflicts
 * remain in `conflicts` for the caller to reject explicitly.
 */
/**
 * Resolve a CANONICAL-vs-CANONICAL collision when — and only when — exactly one
 * of the colliding concepts owns the term through its SLUG (its canonical
 * identity). That slug owner is the rightful holder; any OTHER concept that
 * collides only because its (model-assigned) preferredLabel normalizes to the
 * same term is deterministically relabeled to its own slug-derived label. This
 * fixes a mislabeled concept (e.g. `temporal-information` labeled "Spike timing"
 * colliding with the `spike-timing` slug) without merging or dropping either
 * concept. A collision among preferredLabels of DISTINCT slugs where no slug
 * owns the term has no principled winner and is intentionally left for the caller
 * to reject.
 */
function resolveSlugOwnedLabelCollisions<T extends {
  slug: string;
  preferredLabel: string;
  aliases: string[];
}>(concepts: readonly T[], conflicts: readonly AliasConflict[]): { concepts: T[]; repairs: ConceptAliasRepair[]; changed: boolean } {
  const next = concepts.map((concept) => ({ ...concept })) as T[];
  const byId = new Map<string, T>();
  for (const concept of next) byId.set(conceptId(concept.slug), concept);
  const repairs: ConceptAliasRepair[] = [];
  let changed = false;
  for (const conflict of conflicts) {
    const term = conflict.normalizedAlias;
    const members = conflict.conceptIds
      .map((id) => byId.get(id))
      .filter((concept): concept is T => Boolean(concept))
      .filter((concept) =>
        normalizeLookupText(concept.slug) === term ||
        normalizeLookupText(concept.preferredLabel) === term,
      );
    if (members.length < 2) continue;
    const slugOwner = members.find((concept) => normalizeLookupText(concept.slug) === term);
    // No concept OWNS the term through its slug → no principled winner; leave the
    // conflict so the caller rejects it (a genuine duplicate-identity problem).
    if (!slugOwner) continue;
    for (const loser of members) {
      if (loser === slugOwner) continue;
      if (normalizeLookupText(loser.slug) === term) continue; // another slug owner: cannot relabel
      if (normalizeLookupText(loser.preferredLabel) !== term) continue; // collides only via alias (handled elsewhere)
      const relabeled = preferredLabelFromSlug(normalizeConceptSlug(loser.slug));
      if (normalizeLookupText(relabeled) === term) continue; // slug-derived label cannot escape the term
      loser.preferredLabel = relabeled;
      changed = true;
      repairs.push({
        normalizedAlias: term,
        removedFrom: [conceptId(loser.slug)],
        ownerConceptId: conceptId(slugOwner.slug),
        reason: 'canonical-label-relabeled',
      });
    }
  }
  return { concepts: next, repairs, changed };
}

export function reconcileSemanticConceptAliases<T extends {
  slug: string;
  preferredLabel: string;
  aliases: string[];
}>(concepts: readonly T[]): ConceptAliasReconciliation<T> {
  // Alias reconciliation and canonical-collision relabeling can each expose new
  // work for the other, so iterate to a fixed point (bounded). A relabel only
  // ever moves a mislabeled concept onto its own slug-derived label, so the loop
  // strictly makes progress until no slug-owned collision remains.
  const maxPasses = concepts.length + 5;
  let current: readonly T[] = concepts;
  const repairs: ConceptAliasRepair[] = [];
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const once = reconcileSemanticConceptAliasesOnce(current);
    repairs.push(...once.repairs);
    if (once.conflicts.length === 0) {
      return { concepts: once.concepts, repairs: dedupeAliasRepairs(repairs), conflicts: [] };
    }
    const resolved = resolveSlugOwnedLabelCollisions(once.concepts, once.conflicts);
    if (!resolved.changed) {
      return { concepts: once.concepts, repairs: dedupeAliasRepairs(repairs), conflicts: once.conflicts };
    }
    repairs.push(...resolved.repairs);
    current = resolved.concepts;
  }
  const finalPass = reconcileSemanticConceptAliasesOnce(current);
  return {
    concepts: finalPass.concepts,
    repairs: dedupeAliasRepairs([...repairs, ...finalPass.repairs]),
    conflicts: finalPass.conflicts,
  };
}

function dedupeAliasRepairs(repairs: readonly ConceptAliasRepair[]): ConceptAliasRepair[] {
  const seen = new Set<string>();
  const out: ConceptAliasRepair[] = [];
  for (const repair of repairs) {
    const key = `${repair.reason}|${repair.normalizedAlias}|${repair.ownerConceptId ?? ''}|${[...repair.removedFrom].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(repair);
  }
  return out;
}

function reconcileSemanticConceptAliasesOnce<T extends {
  slug: string;
  preferredLabel: string;
  aliases: string[];
}>(concepts: readonly T[]): ConceptAliasReconciliation<T> {
  const prepared = concepts.map((concept) => ({
    ...concept,
    slug: normalizeConceptSlug(concept.slug),
    preferredLabel:
      compactSemanticText(concept.preferredLabel) || preferredLabelFromSlug(concept.slug),
    aliases: uniqueAliasesByLookup(concept.aliases ?? []),
  })) as T[];
  const entriesBySlug = new Map<string, T[]>();
  for (const concept of prepared) {
    const entries = entriesBySlug.get(concept.slug) ?? [];
    entries.push(concept);
    entriesBySlug.set(concept.slug, entries);
  }
  const canonicalLabelBySlug = new Map<string, string>();
  const alternateLabelsBySlug = new Map<string, string[]>();
  for (const [slug, entries] of entriesBySlug) {
    const labelCounts = new Map<string, { label: string; count: number }>();
    for (const entry of entries) {
      const key = normalizeLookupText(entry.preferredLabel);
      const current = labelCounts.get(key);
      labelCounts.set(key, {
        // Equivalent surface forms (case, punctuation, spacing) must not make
        // canonical output depend on which unit happened to appear first.
        label:
          current && current.label <= entry.preferredLabel
            ? current.label
            : entry.preferredLabel,
        count: (current?.count ?? 0) + 1,
      });
    }
    const slugTokens = new Set(normalizeLookupText(slug).split(' ').filter(Boolean));
    const defaultLabelKey = normalizeLookupText(preferredLabelFromSlug(slug));
    const ranked = [...labelCounts.values()].sort((left, right) => {
      const score = (label: string) => {
        if (normalizeLookupText(label) === defaultLabelKey) return 3;
        const labelTokens = new Set(normalizeLookupText(label).split(' ').filter(Boolean));
        const overlap = [...slugTokens].filter((token) => labelTokens.has(token)).length;
        return normalizeConceptSlug(label) === slug
          ? 2
          : overlap / Math.max(slugTokens.size, labelTokens.size, 1);
      };
      return score(right.label) - score(left.label) ||
        right.count - left.count ||
        left.label.length - right.label.length ||
        left.label.localeCompare(right.label);
    });
    const canonicalLabel = ranked[0]?.label ?? preferredLabelFromSlug(slug);
    canonicalLabelBySlug.set(slug, canonicalLabel);
    alternateLabelsBySlug.set(
      slug,
      ranked.slice(1).map((entry) => entry.label),
    );
  }
  const normalized = prepared.map((concept) => {
    const preferredLabel = canonicalLabelBySlug.get(concept.slug) ?? concept.preferredLabel;
    const canonicalKeys = new Set([
      normalizeLookupText(concept.slug),
      normalizeLookupText(preferredLabel),
    ]);
    return {
      ...concept,
      preferredLabel,
      aliases: uniqueAliasesByLookup([
        ...concept.aliases,
        ...(alternateLabelsBySlug.get(concept.slug) ?? []),
      ]).filter((alias) => !canonicalKeys.has(normalizeLookupText(alias))),
    } as T;
  });
  const canonicalOwners = new Map<string, Set<string>>();
  const aliasOwners = new Map<string, Set<string>>();

  const addOwner = (owners: Map<string, Set<string>>, key: string, id: string) => {
    if (!key) return;
    const ids = owners.get(key) ?? new Set<string>();
    ids.add(id);
    owners.set(key, ids);
  };

  for (const concept of normalized) {
    const id = conceptId(concept.slug);
    addOwner(canonicalOwners, normalizeLookupText(concept.slug), id);
    addOwner(canonicalOwners, normalizeLookupText(concept.preferredLabel), id);
    for (const alias of concept.aliases) {
      addOwner(aliasOwners, normalizeLookupText(alias), id);
    }
  }

  const allowedAliasOwners = new Map<string, Set<string>>();
  const repairs: ConceptAliasRepair[] = [];
  for (const [key, owners] of [...aliasOwners.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const canonical = canonicalOwners.get(key) ?? new Set<string>();
    let allowed = new Set<string>();
    let reason: ConceptAliasRepairReason | null = null;
    let ownerConceptId: string | undefined;

    if (canonical.size > 0) {
      reason = 'canonical-term-wins';
      if (canonical.size === 1) ownerConceptId = [...canonical][0];
    } else if (owners.size === 1) {
      allowed = new Set(owners);
    } else {
      const seededOwners = [...owners].filter((ownerId) => {
        const concept = normalized.find((candidate) => conceptId(candidate.slug) === ownerId);
        return Boolean(
          concept &&
            (SEEDED_CONCEPT_ALIASES[concept.slug] ?? []).some(
              (alias) => normalizeLookupText(alias) === key,
            ),
        );
      });
      if (seededOwners.length === 1) {
        ownerConceptId = seededOwners[0];
        allowed = new Set(seededOwners);
        reason = 'seeded-alias-wins';
      } else {
        reason = 'ambiguous-alias-removed';
      }
    }

    allowedAliasOwners.set(key, allowed);
    const removedFrom = [...owners].filter((id) => !allowed.has(id)).sort();
    if (removedFrom.length > 0 && reason) {
      repairs.push({
        normalizedAlias: key,
        removedFrom,
        ...(ownerConceptId ? { ownerConceptId } : {}),
        reason,
      });
    }
  }

  const reconciled = normalized.map((concept) => {
    const id = conceptId(concept.slug);
    return {
      ...concept,
      aliases: concept.aliases.filter((alias) =>
        allowedAliasOwners.get(normalizeLookupText(alias))?.has(id),
      ),
    } as T;
  });

  const finalOwners = new Map<string, Set<string>>();
  for (const concept of reconciled) {
    const id = conceptId(concept.slug);
    for (const term of [concept.slug, concept.preferredLabel, ...concept.aliases]) {
      addOwner(finalOwners, normalizeLookupText(term), id);
    }
  }
  const conflicts = [...finalOwners.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([normalizedAlias, ids]) => ({
      normalizedAlias,
      conceptIds: [...ids].sort(),
    }))
    .sort((left, right) => left.normalizedAlias.localeCompare(right.normalizedAlias));

  return { concepts: reconciled, repairs, conflicts };
}

export function reconcileConceptRegistryAliases(registry: ConceptRegistry): {
  registry: ConceptRegistry;
  repairs: ConceptAliasRepair[];
  conflicts: AliasConflict[];
} {
  const normalized = sortConceptRegistry(registry);
  const reconciled = reconcileSemanticConceptAliases(normalized.concepts);
  return {
    registry: { ...normalized, concepts: reconciled.concepts },
    repairs: reconciled.repairs,
    conflicts: reconciled.conflicts,
  };
}

export function alignSemanticConceptAliasesWithRegistry<T extends {
  slug: string;
  preferredLabel: string;
  aliases: string[];
}>(concepts: readonly T[], registry: ConceptRegistry): T[] {
  const safeRegistry = reconcileConceptRegistryAliases(registry).registry;
  const registryConceptBySlug = new Map(
    safeRegistry.concepts.map((concept) => [concept.slug, concept]),
  );
  return concepts.map((concept) => {
    const registryConcept = registryConceptBySlug.get(normalizeConceptSlug(concept.slug));
    const allowedAliases = new Set(
      (registryConcept?.aliases ?? []).map(normalizeLookupText),
    );
    return {
      ...concept,
      preferredLabel: registryConcept?.preferredLabel ?? concept.preferredLabel,
      aliases: uniqueAliasesByLookup(concept.aliases ?? []).filter((alias) =>
        allowedAliases.has(normalizeLookupText(alias)),
      ),
    } as T;
  });
}

export function resolveConcept(value: string, registry: ConceptRegistry): ConceptRecord | null {
  const compact = compactSemanticText(value);
  if (!compact) return null;
  const requestedId = compact.startsWith('concept:') ? conceptId(compact) : '';
  const requestedSlug = normalizeConceptSlug(compact);
  const exact = registry.concepts.find(
    (concept) => concept.id === requestedId || concept.slug === requestedSlug,
  );
  if (exact) return exact;

  const lookup = normalizeLookupText(compact);
  const labelMatch = registry.concepts.filter(
    (concept) => normalizeLookupText(concept.preferredLabel) === lookup,
  );
  if (labelMatch.length === 1) return labelMatch[0];

  const aliasMatch = registry.concepts.filter((concept) =>
    concept.aliases.some((alias) => normalizeLookupText(alias) === lookup),
  );
  if (aliasMatch.length === 1) return aliasMatch[0];

  const lexical = registry.concepts.filter((concept) => {
    const terms = [concept.slug.replace(/-/g, ' '), concept.preferredLabel, ...concept.aliases];
    return terms.some((term) => normalizeLookupText(term) === lookup);
  });
  return lexical.length === 1 ? lexical[0] : null;
}

export function mergeConcept(
  registry: ConceptRegistry,
  candidate: Partial<ConceptRecord> & { slug: string },
  options: {
    aliasCollisionPolicy: 'repair';
    suppressedAmbiguousAliases: Set<string>;
  } | {
    aliasCollisionPolicy?: 'reject';
    suppressedAmbiguousAliases?: never;
  } = {},
): ConceptRegistry {
  if (options.aliasCollisionPolicy === 'repair' && !options.suppressedAmbiguousAliases) {
    throw new Error('Repair mode requires shared ambiguous-alias suppression state');
  }
  const candidateSlug = normalizeConceptSlug(candidate.slug);
  const normalized = normalizeConceptRecord({
    ...candidate,
    aliases: [
      ...(candidate.aliases ?? []),
      ...(SEEDED_CONCEPT_ALIASES[candidateSlug] ?? []),
    ].filter(
      (alias) => !options.suppressedAmbiguousAliases?.has(normalizeLookupText(alias)),
    ),
  });
  if (!isValidPublicConceptSlug(normalized.slug)) {
    throw new Error(`Invalid public concept slug: ${normalized.slug || '(empty)'}`);
  }
  // Explicit canonical slugs must never be merged merely because another
  // concept happens to claim that text as an alias.
  const existing = registry.concepts.find(
    (concept) => concept.id === normalized.id || concept.slug === normalized.slug,
  );
  const nextConcept = existing
    ? normalizeConceptRecord({
        ...existing,
        preferredLabel: existing.preferredLabel || normalized.preferredLabel,
        aliases: [...existing.aliases, ...normalized.aliases],
        description: existing.description || normalized.description,
        broader: [...existing.broader, ...normalized.broader],
        narrower: [...existing.narrower, ...normalized.narrower],
        related: [...existing.related, ...normalized.related],
        relations: [...existing.relations, ...normalized.relations],
        evidenceAnchors: [...existing.evidenceAnchors, ...normalized.evidenceAnchors],
        status:
          existing.status === 'source-verified' || normalized.status === 'source-verified'
            ? 'source-verified'
            : existing.status,
      })
    : normalized;
  const concepts = registry.concepts.filter((concept) => concept.id !== nextConcept.id);
  const unsortedNext = { ...registry, concepts: [...concepts, nextConcept] };
  if (options.aliasCollisionPolicy !== 'repair') {
    // Strict mode observes the candidate exactly as proposed. Registry sorting
    // may restore curated seed ownership, but that repair must never make a
    // reject-policy collision disappear before it is reported.
    const strictNext = {
      ...unsortedNext,
      schemaVersion: SEMANTIC_SCHEMA_VERSION,
      concepts: unsortedNext.concepts
        .map(normalizeConceptRecord)
        .sort((left, right) => left.slug.localeCompare(right.slug)),
    };
    const strictConflicts = aliasConflicts(strictNext);
    if (strictConflicts.length > 0) {
      const conflict = strictConflicts[0];
      throw new Error(
        `Alias collision for "${conflict.normalizedAlias}": ${conflict.conceptIds.join(', ')}`,
      );
    }
    return sortConceptRegistry(strictNext);
  }

  let next = sortConceptRegistry(unsortedNext);
  let conflicts = aliasConflicts(next);
  if (conflicts.length > 0) {
    const reconciled = reconcileConceptRegistryAliases(next);
    next = reconciled.registry;
    conflicts = reconciled.conflicts;
    for (const repair of reconciled.repairs) {
      if (repair.reason === 'ambiguous-alias-removed') {
        options.suppressedAmbiguousAliases?.add(repair.normalizedAlias);
      }
    }
  }
  if (conflicts.length > 0) {
    const conflict = conflicts[0];
    throw new Error(
      `Alias collision for "${conflict.normalizedAlias}": ${conflict.conceptIds.join(', ')}`,
    );
  }
  return next;
}

export function normalizePageConceptAssignment(input: {
  primaryConcepts: string[];
  supportingConcepts?: string[];
  claimIds?: string[];
  registry: ConceptRegistry;
}): { assignment: PageConceptAssignment; problems: string[] } {
  const problems: string[] = [];
  const resolveMany = (values: readonly string[], role: ConceptRole) => {
    const output: string[] = [];
    for (const value of values) {
      const concept = resolveConcept(value, input.registry);
      if (!concept) {
        problems.push(`${role} concept "${value}" is not registered`);
        continue;
      }
      if (!output.includes(concept.slug)) output.push(concept.slug);
    }
    return output;
  };
  const primaryConcepts = resolveMany(input.primaryConcepts, 'primary');
  const primarySet = new Set(primaryConcepts);
  const supportingConcepts = resolveMany(input.supportingConcepts ?? [], 'supporting')
    .filter((slug) => !primarySet.has(slug));
  const union = [...primaryConcepts, ...supportingConcepts];
  if (primaryConcepts.length === 0) problems.push('learner page has no primary concept');
  if (union.length > MAX_PUBLIC_CONCEPTS) {
    problems.push(`learner page has ${union.length} public concepts; maximum is ${MAX_PUBLIC_CONCEPTS}`);
  }
  const limited = union.slice(0, MAX_PUBLIC_CONCEPTS);
  const limitedSet = new Set(limited);
  return {
    assignment: {
      primaryConcepts: primaryConcepts.filter((slug) => limitedSet.has(slug)),
      supportingConcepts: supportingConcepts.filter((slug) => limitedSet.has(slug)),
      tags: limited,
      claimIds: uniqueSorted(input.claimIds ?? []),
    },
    problems,
  };
}

export function stableClaimId(learningUnitId: string, text: string): string {
  const unit = normalizeConceptSlug(learningUnitId || 'unit');
  const fingerprint = createHash('sha256')
    .update(`${unit}\n${normalizeLookupText(text)}`)
    .digest('hex')
    .slice(0, 12);
  return `claim:${unit}:${fingerprint}`;
}

export function isGenericFillerClaim(text: string): boolean {
  const normalized = normalizeConceptSlug(text);
  if (!normalized) return true;
  return GENERIC_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function normalizeClaimRecord(input: {
  text: string;
  subject: string;
  predicate?: unknown;
  object?: string;
  conceptIds?: string[];
  learningUnitId: string;
  pageRelPath: string;
  evidenceAnchors?: string[];
  derivationAnchors?: string[];
  connectedClaimIds?: string[];
  status?: SemanticEvidenceStatus;
  registry: ConceptRegistry;
}): ClaimRecord {
  const text = compactSemanticText(input.text);
  if (!text) throw new Error('Claim text is required');
  if (isGenericFillerClaim(text)) throw new Error(`Generic fallback claim is not allowed: ${text}`);
  const subject = resolveConcept(input.subject, input.registry);
  if (!subject) throw new Error(`Claim subject is not registered: ${input.subject}`);
  const object = input.object ? resolveConcept(input.object, input.registry) : null;
  if (input.object && !object) throw new Error(`Claim object is not registered: ${input.object}`);
  const evidenceAnchors = uniqueSorted(input.evidenceAnchors ?? []);
  const derivationAnchors = uniqueSorted(input.derivationAnchors ?? []);
  const status = input.status ?? (evidenceAnchors.length > 0 ? 'source-verified' : 'unverified');
  if (status === 'source-verified' && evidenceAnchors.length === 0) {
    throw new Error('Source-verified claim requires at least one evidence anchor');
  }
  if (status === 'synthesized' && derivationAnchors.length === 0) {
    throw new Error('Synthesized claim requires at least one derivation anchor');
  }
  const extraConcepts = (input.conceptIds ?? [])
    .map((value) => resolveConcept(value, input.registry)?.id)
    .filter((value): value is string => Boolean(value));
  const conceptIds = uniqueSorted([
    subject.id,
    ...(object ? [object.id] : []),
    ...extraConcepts,
  ]);
  return {
    id: stableClaimId(input.learningUnitId, text),
    text,
    subject: subject.id,
    predicate: normalizeRelationPredicate(input.predicate),
    ...(object ? { object: object.id } : {}),
    conceptIds,
    learningUnitId: compactSemanticText(input.learningUnitId),
    pageRelPath: input.pageRelPath.replace(/\\/g, '/'),
    evidenceAnchors,
    derivationAnchors,
    status,
    connectedClaimIds: uniqueSorted(input.connectedClaimIds ?? []),
  };
}

export function validateConceptRelationships(registry: ConceptRegistry): string[] {
  const ids = new Set(registry.concepts.map((concept) => concept.id));
  const problems: string[] = [];
  for (const concept of registry.concepts) {
    for (const target of [...concept.broader, ...concept.narrower, ...concept.related]) {
      if (!ids.has(target)) problems.push(`${concept.id} references missing concept ${target}`);
    }
    for (const relation of concept.relations) {
      if (!ids.has(relation.target)) {
        problems.push(`${concept.id} ${relation.predicate} references missing concept ${relation.target}`);
      }
    }
  }
  return uniqueSorted(problems);
}

export function semanticHealthMetrics(input: {
  registry: ConceptRegistry;
  claims: ClaimStore;
  pages: PageConceptAssignment[];
}): SemanticHealthMetrics {
  const counts = new Map<string, number>();
  for (const page of input.pages) {
    for (const slug of new Set(page.tags)) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  let sharedConceptPagePairs = 0;
  for (const count of counts.values()) sharedConceptPagePairs += (count * (count - 1)) / 2;
  const referenced = new Set(input.pages.flatMap((page) => page.tags));
  const invalidRelationEndpoints = validateConceptRelationships(input.registry).length;
  return {
    learnerPages: input.pages.length,
    conceptAssignments: [...counts.values()].reduce((sum, count) => sum + count, 0),
    uniqueConcepts: input.registry.concepts.length,
    singletonConcepts: [...counts.values()].filter((count) => count === 1).length,
    sharedConcepts: [...counts.values()].filter((count) => count > 1).length,
    sharedConceptPagePairs,
    claimsWithEvidence: input.claims.claims.filter((claim) => claim.evidenceAnchors.length > 0).length,
    claimsWithoutEvidence: input.claims.claims.filter((claim) => claim.evidenceAnchors.length === 0).length,
    orphanConcepts: input.registry.concepts.filter((concept) => !referenced.has(concept.slug)).length,
    aliasConflicts: aliasConflicts(input.registry).length,
    invalidRelationEndpoints,
  };
}
