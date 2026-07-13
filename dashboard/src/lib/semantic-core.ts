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
  const aliases = uniqueSorted([
    ...(input.aliases ?? []),
    ...(SEEDED_CONCEPT_ALIASES[slug] ?? []),
  ]).filter((alias) => normalizeLookupText(alias) !== normalizeLookupText(input.preferredLabel ?? ''));
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
  return {
    ...registry,
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    concepts: registry.concepts
      .map(normalizeConceptRecord)
      .sort((left, right) => left.slug.localeCompare(right.slug)),
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
): ConceptRegistry {
  const normalized = normalizeConceptRecord(candidate);
  if (!isValidPublicConceptSlug(normalized.slug)) {
    throw new Error(`Invalid public concept slug: ${normalized.slug || '(empty)'}`);
  }
  const existing = resolveConcept(normalized.slug, registry);
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
  const next = sortConceptRegistry({ ...registry, concepts: [...concepts, nextConcept] });
  const conflicts = aliasConflicts(next);
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
