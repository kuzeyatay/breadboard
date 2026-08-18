// Canonicalization: deciding when two names are one thing.
//
// This is the difference between "22 teams" and "31 teams, nine of which are
// the same team twice". Historical research makes it acute, because the whole
// point of asking about the past is that things were called something else.
//
// The rule the module enforces in both directions: an alias never becomes its
// own entity, and two genuinely distinct entities never merge because their
// names look alike. Merging is therefore evidence-driven — a name variant that
// normalizes to the same key, or an explicit alias someone recorded — and never
// a similarity score.

import type {
  EntityLifecycle,
  EntityRelationKind,
  EntityRelationship,
  ResearchEntity,
} from "./types.ts";

/** Words that carry no identity, so their presence must not split an entity. */
const NOISE_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "team",
  "teams",
  "project",
  "group",
  "club",
  "society",
  "association",
  "foundation",
  "org",
  "organisation",
  "organization",
  "student",
  "students",
]);

/**
 * The identity key two names are compared on.
 *
 * Accent folding, punctuation removal and noise-word stripping, and nothing
 * cleverer: every additional normalization step is another way for two real
 * entities to collide. "Northwind Solar Team" and "northwind-solar team" are
 * the same key; "Aeris" and "Aster" are not, and no edit-distance rule here
 * will ever make them so.
 */
export function identityKey(name: string): string {
  const folded = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = folded.split(" ").filter((word) => word && !NOISE_WORDS.has(word));
  // A name made entirely of noise words keeps its folded form rather than
  // becoming the empty key, which would merge every such entity into one.
  return (words.length ? words.join(" ") : folded) || name.toLowerCase().trim();
}

/** Every key one entity answers to — its canonical name plus every alias. */
export function entityKeys(entity: {
  canonicalName: string;
  aliases: readonly string[];
}): string[] {
  return [
    identityKey(entity.canonicalName),
    ...entity.aliases.map((alias) => identityKey(alias)),
  ].filter(Boolean);
}

export interface EntityCandidate {
  name: string;
  aliases?: readonly string[];
  lifecycle?: EntityLifecycle;
  classification?: string;
}

export interface MergeOutcome {
  entities: ResearchEntity[];
  /** Entities that did not exist before this call. */
  created: ResearchEntity[];
  /** Candidates that resolved onto an entity already present. */
  merged: Array<{ candidate: string; into: string }>;
  /** Candidates rejected because the entity ceiling was reached. */
  rejected: string[];
}

function nextEntityId(existing: readonly ResearchEntity[]): string {
  return `e${existing.length + 1}`;
}

/**
 * Fold a round of candidates into the entity list.
 *
 * Candidates arrive from enumeration in whatever form a page used them, so the
 * same real entity commonly appears three times in one round under three
 * spellings. Resolution happens against the accumulated list *and* against the
 * candidates already folded in this call, which is what makes a single round
 * self-deduplicating.
 */
export function mergeEntityCandidates(input: {
  existing: readonly ResearchEntity[];
  candidates: readonly EntityCandidate[];
  round: number;
  maxEntities: number;
  now?: string;
}): MergeOutcome {
  const now = input.now ?? new Date().toISOString();
  const entities = input.existing.map((entity) => ({
    ...entity,
    aliases: [...entity.aliases],
  }));
  const byKey = new Map<string, ResearchEntity>();
  for (const entity of entities) {
    for (const key of entityKeys(entity)) byKey.set(key, entity);
  }
  const created: ResearchEntity[] = [];
  const merged: MergeOutcome["merged"] = [];
  const rejected: string[] = [];

  for (const candidate of input.candidates) {
    const name = candidate.name?.trim();
    if (!name) continue;
    const keys = [
      identityKey(name),
      ...(candidate.aliases ?? []).map((alias) => identityKey(alias)),
    ].filter(Boolean);
    const hit = keys.map((key) => byKey.get(key)).find(Boolean);
    if (hit) {
      // Known entity under a new name: the name becomes an alias, never a row.
      for (const alias of [name, ...(candidate.aliases ?? [])]) {
        const trimmed = alias.trim();
        if (!trimmed) continue;
        const key = identityKey(trimmed);
        if (key === identityKey(hit.canonicalName)) continue;
        if (!hit.aliases.some((known) => identityKey(known) === key)) {
          hit.aliases.push(trimmed);
        }
        byKey.set(key, hit);
      }
      // Lifecycle is upgraded from "unknown" only; a later page that omits the
      // status must not erase a status an earlier page stated.
      if (candidate.lifecycle && hit.lifecycle === "unknown") {
        hit.lifecycle = candidate.lifecycle;
      }
      if (candidate.classification && !hit.classification) {
        hit.classification = candidate.classification;
      }
      if (identityKey(name) !== identityKey(hit.canonicalName)) {
        merged.push({ candidate: name, into: hit.id });
      }
      continue;
    }
    if (entities.length >= input.maxEntities) {
      rejected.push(name);
      continue;
    }
    const entity: ResearchEntity = {
      id: nextEntityId(entities),
      canonicalName: name,
      aliases: (candidate.aliases ?? [])
        .map((alias) => alias.trim())
        .filter((alias) => alias && identityKey(alias) !== identityKey(name)),
      lifecycle: candidate.lifecycle ?? "unknown",
      ...(candidate.classification ? { classification: candidate.classification } : {}),
      attributes: {},
      discoveredInRound: input.round,
      createdAt: now,
    };
    entities.push(entity);
    created.push(entity);
    for (const key of entityKeys(entity)) byKey.set(key, entity);
  }

  return { entities, created, merged, rejected };
}

/** Find an entity by any name it answers to. */
export function findEntityByName(
  entities: readonly ResearchEntity[],
  name: string,
): ResearchEntity | undefined {
  const key = identityKey(name);
  return entities.find((entity) => entityKeys(entity).includes(key));
}

const INVERSE: Record<EntityRelationKind, EntityRelationKind | null> = {
  renamed_to: null,
  merged_into: null,
  successor_of: "predecessor_of",
  predecessor_of: "successor_of",
  spinout_of: null,
  split_from: null,
};

/**
 * Record a lineage edge, and — for the two relations that are genuinely
 * symmetric — its inverse, so a later question can be asked from either end.
 *
 * `renamed_to` and `merged_into` are deliberately one-directional: they also
 * mean the source entity stopped existing under that name, which the caller
 * reflects in its lifecycle rather than in a second edge.
 */
export function addRelationship(input: {
  relationships: readonly EntityRelationship[];
  fromEntityId: string;
  toEntityId: string;
  kind: EntityRelationKind;
  evidenceIds?: readonly string[];
}): EntityRelationship[] {
  if (input.fromEntityId === input.toEntityId) return [...input.relationships];
  const next = [...input.relationships];
  const push = (from: string, to: string, kind: EntityRelationKind) => {
    if (
      next.some(
        (edge) =>
          edge.fromEntityId === from &&
          edge.toEntityId === to &&
          edge.kind === kind,
      )
    ) {
      return;
    }
    next.push({
      id: `r${next.length + 1}`,
      fromEntityId: from,
      toEntityId: to,
      kind,
      evidenceIds: [...(input.evidenceIds ?? [])],
    });
  };
  push(input.fromEntityId, input.toEntityId, input.kind);
  const inverse = INVERSE[input.kind];
  if (inverse) push(input.toEntityId, input.fromEntityId, inverse);
  return next;
}

/**
 * Aliases worth searching separately.
 *
 * A former name is not a synonym for search purposes: the old name is what the
 * old sources used, and those are exactly the sources a historical question
 * needs. This returns the names an entity is worth re-searching under, so the
 * scheduler can spend an `alias_search` attempt on the one likeliest to have
 * its own archive footprint.
 */
export function searchableAliases(entity: ResearchEntity): string[] {
  const canonical = identityKey(entity.canonicalName);
  return entity.aliases.filter((alias) => identityKey(alias) !== canonical);
}
