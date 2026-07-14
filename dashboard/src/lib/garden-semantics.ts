import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_PUBLIC_CONCEPTS,
  SEMANTIC_SCHEMA_VERSION,
  alignSemanticConceptAliasesWithRegistry,
  aliasConflicts,
  compactSemanticText,
  createEmptyClaimStore,
  createEmptyConceptRegistry,
  isGenericFillerClaim,
  isValidPublicConceptSlug,
  mergeConcept,
  normalizeClaimRecord,
  normalizeConceptSlug,
  normalizePageConceptAssignment,
  normalizeRelationPredicate,
  preferredLabelFromSlug,
  reconcileConceptRegistryAliases,
  reconcileSemanticConceptAliases,
  resolveConcept,
  semanticHealthMetrics,
  sortConceptRegistry,
  stableClaimId,
  type ClaimRecord,
  type ClaimStore,
  type ConceptAliasRepair,
  type ConceptRegistry,
  type ConceptRole,
  type KnowledgeClaimPlan,
  type PageConceptAssignment,
  type SemanticConceptPlan,
  type SemanticHealthMetrics,
} from './semantic-core.ts';
import { semanticTagsFromText } from './tags.ts';

export const CONCEPT_REGISTRY_REL_PATH = '.breadboard/concept-registry.json';
export const CLAIM_STORE_REL_PATH = '.breadboard/claims.json';
export const SEMANTIC_MIGRATION_REL_PATH = '.breadboard/semantic-migration.json';
export const LEARNING_UNIT_CONTRACT_REL_PATH = '.breadboard/learning-unit-contract.json';

export type Frontmatter = Record<string, string | string[]>;

export interface GardenSemanticArtifacts {
  registry: ConceptRegistry;
  claims: ClaimStore;
}

export interface SemanticMigrationReport {
  schemaVersion: number;
  gardenId: string;
  migrated: boolean;
  migratedAt: string;
  backupDir?: string;
  changedFiles: string[];
  preservedLegacyClaims: number;
  ambiguousMappings: string[];
  diagnostics: string[];
  metrics: SemanticHealthMetrics;
}

export interface ParsedMarkdown {
  data: Frontmatter;
  rawFrontmatter: string;
  body: string;
  hadFrontmatter: boolean;
}

export interface PendingWrite {
  relPath: string;
  content: string;
}

function aliasRepairDiagnostic(repair: ConceptAliasRepair): string {
  const owner = repair.ownerConceptId ? `; owner ${repair.ownerConceptId}` : '';
  return `repaired alias "${repair.normalizedAlias}": removed from ${repair.removedFrom.join(', ')}${owner}`;
}

function normalizedRel(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function yamlListItem(line: string): string | null {
  const match = line.match(/^\s*-\s*(.+?)\s*$/);
  return match ? match[1].replace(/^['"]|['"]$/g, '').trim() : null;
}

function parseInlineArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed)
      ? parsed.map((item) => compactSemanticText(item)).filter(Boolean)
      : [];
  } catch {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
}

export function parseSemanticMarkdown(content: string): ParsedMarkdown {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { data: {}, rawFrontmatter: '', body: content, hadFrontmatter: false };
  }
  const rawFrontmatter = match[1] ?? '';
  const lines = rawFrontmatter.split(/\r?\n/);
  const data: Frontmatter = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!value) {
      const items: string[] = [];
      for (const next of lines.slice(index + 1)) {
        const item = yamlListItem(next);
        if (item === null) break;
        items.push(item);
      }
      data[key] = items;
    } else if (value.startsWith('[')) {
      data[key] = parseInlineArray(value);
    } else {
      data[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return {
    data,
    rawFrontmatter,
    body: content.slice(match[0].length),
    hadFrontmatter: true,
  };
}

export function semanticFrontmatterArray(data: Frontmatter, key: string): string[] {
  const value = data[key];
  return Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
}

function semanticFrontmatterString(data: Frontmatter, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function setArrayField(rawFrontmatter: string, key: string, values: readonly string[]): string {
  // One frontmatter array format across every writer. garden-finalize's
  // fmSetArray emits `key: ["a", "b"]`; the semantic writers must match it
  // exactly, or two passes over the same page produce byte-different files and
  // the pipeline never reaches a fixed point.
  const field = `${key}: [${values.map((value) => JSON.stringify(value)).join(", ")}]`;
  const lines = rawFrontmatter ? rawFrontmatter.split(/\r?\n/) : [];
  const output: string[] = [];
  let found = false;
  let skippingBlock = false;
  for (const line of lines) {
    if (line.trimStart().startsWith(`${key}:`)) {
      found = true;
      skippingBlock = true;
      if (values.length > 0) output.push(field);
      continue;
    }
    if (skippingBlock) {
      if (yamlListItem(line) !== null) continue;
      skippingBlock = false;
    }
    output.push(line);
  }
  if (!found && values.length > 0) output.push(field);
  return output.filter((line, index, all) => line || index < all.length - 1).join('\n').trimEnd();
}

export function renderSemanticMarkdown(parsed: ParsedMarkdown, fields: Record<string, string[]>): string {
  let raw = parsed.rawFrontmatter;
  for (const [key, values] of Object.entries(fields)) raw = setArrayField(raw, key, values);
  if (!raw && !parsed.hadFrontmatter) return parsed.body;
  return `---\n${raw}\n---\n\n${parsed.body.replace(/^\r?\n/, '')}`;
}

export function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Filesystem errors that mean "someone else is holding this file right now",
 * not "this write is invalid". On Windows a rename over an existing file needs
 * delete access to the destination, so a sync client (OneDrive), an antivirus
 * scanner, or the search indexer holding it open for a few hundred milliseconds
 * surfaces as EPERM/EACCES/EBUSY. */
const TRANSIENT_FS_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const FS_RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400, 800];

function isTransientFsError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && TRANSIENT_FS_ERROR_CODES.has(code);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run a filesystem mutation, retrying while another process holds the file. */
function withFsRetry<T>(operation: () => T): T {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isTransientFsError(error) || attempt >= FS_RETRY_DELAYS_MS.length) throw error;
      sleepSync(FS_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * Write via a temp file + rename so a reader never sees a half-written page.
 *
 * The rename is retried while the destination is locked. If every retry loses
 * the race, overwrite the destination in place: that gives up atomicity, but a
 * page written non-atomically beats a generation run aborted by a transient
 * EPERM from a sync client.
 */
function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, content, 'utf8');
  try {
    try {
      withFsRetry(() => fs.renameSync(temporary, filePath));
    } catch (error) {
      if (!isTransientFsError(error)) throw error;
      withFsRetry(() => fs.writeFileSync(filePath, content, 'utf8'));
    }
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

export function walkMarkdown(root: string): Array<{ relPath: string; absPath: string }> {
  const output: Array<{ relPath: string; absPath: string }> = [];
  if (!fs.existsSync(root)) return output;
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.breadboard') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        output.push({
          relPath: normalizedRel(path.relative(root, absolute)),
          absPath: absolute,
        });
      }
    }
  };
  visit(root);
  return output.sort((left, right) => left.relPath.localeCompare(right.relPath));
}

export function isLearnerPage(relPath: string, data: Frontmatter): boolean {
  const type = semanticFrontmatterString(data, 'knowledge_type');
  const breadboardType = semanticFrontmatterString(data, 'breadboardType');
  return (
    normalizedRel(relPath).startsWith('learning/') &&
    !path.basename(relPath).startsWith('_index') &&
    (type === 'learning-page' || type === 'textbook-page' || breadboardType === 'learning_page')
  );
}

function conceptCandidates(values: readonly string[], grounding = ''): string[] {
  const candidates: string[] = [];
  const add = (value: string) => {
    const slug = normalizeConceptSlug(value);
    if (isValidPublicConceptSlug(slug) && !candidates.includes(slug)) candidates.push(slug);
  };
  for (const value of values) {
    add(value);
    if (!isValidPublicConceptSlug(value)) {
      for (const inferred of semanticTagsFromText(value, MAX_PUBLIC_CONCEPTS, value)) add(inferred);
    }
  }
  if (candidates.length === 0 && grounding) {
    for (const inferred of semanticTagsFromText(grounding, MAX_PUBLIC_CONCEPTS, grounding)) add(inferred);
  }
  return candidates.slice(0, MAX_PUBLIC_CONCEPTS);
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : [];
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => compactSemanticText(item)).filter(Boolean)
    : compactSemanticText(value)
      ? [compactSemanticText(value)]
      : [];
}

function semanticPlansForUnit(unit: Record<string, unknown>, grounding: string): SemanticConceptPlan[] {
  const explicit = asRecords(unit.semanticConcepts);
  if (explicit.length > 0) {
    return explicit.flatMap((item) => {
      const slug = normalizeConceptSlug(compactSemanticText(item.slug ?? item.id ?? item.preferredLabel));
      if (!isValidPublicConceptSlug(slug)) return [];
      return [{
        slug,
        preferredLabel: compactSemanticText(item.preferredLabel ?? item.label) || preferredLabelFromSlug(slug),
        role: compactSemanticText(item.role) === 'primary' ? 'primary' as const : 'supporting' as const,
        aliases: asStrings(item.aliases),
        evidenceAnchors: asStrings(item.evidenceAnchors ?? item.sourceAnchors),
      }];
    });
  }

  const newConcepts = conceptCandidates(asStrings(unit.newConcepts ?? unit.concepts), grounding);
  const prerequisiteConcepts = conceptCandidates(
    asStrings(unit.prerequisiteConcepts ?? unit.prerequisites),
    grounding,
  );
  // Legacy claim prose is preserved in the claim store, not mined into several
  // tag-shaped fragments. Only fall back to a small title/question-derived set
  // when the contract has no explicit concept vocabulary at all.
  const fallbackConcepts = newConcepts.length + prerequisiteConcepts.length === 0
    ? semanticTagsFromText(
        [compactSemanticText(unit.title), compactSemanticText(unit.learningQuestion)].join('\n'),
        2,
        grounding,
      )
    : [];
  const combined = [...newConcepts, ...prerequisiteConcepts, ...fallbackConcepts]
    .filter((slug, index, all) => isValidPublicConceptSlug(slug) && all.indexOf(slug) === index)
    .slice(0, MAX_PUBLIC_CONCEPTS);
  return combined.map((slug, index) => ({
    slug,
    preferredLabel: preferredLabelFromSlug(slug),
    role: index < Math.max(1, Math.min(2, newConcepts.length)) ? 'primary' : 'supporting',
    aliases: [],
    evidenceAnchors: asStrings(unit.sourceAnchors ?? unit.anchors),
  }));
}

function inferPredicate(text: string): ReturnType<typeof normalizeRelationPredicate> {
  if (/\bcaus(?:e|es|ed)\b/i.test(text)) return 'causes';
  if (/\benabl(?:e|es|ed)\b/i.test(text)) return 'enables';
  if (/\bmeasur(?:e|es|ed|ement)\b/i.test(text)) return 'measured-by';
  if (/\bcontrast|whereas|unlike\b/i.test(text)) return 'contrasts-with';
  if (/\blimit|bound|constraint\b/i.test(text)) return 'limits';
  if (/\bemits?.*\bwhen\b|\bfires?.*\bwhen\b/i.test(text)) return 'emits-when';
  if (/\bpart of\b/i.test(text)) return 'part-of';
  if (/\bderived? from\b/i.test(text)) return 'derived-from';
  return 'related-to';
}

function claimPlansForUnit(
  unit: Record<string, unknown>,
  plans: SemanticConceptPlan[],
): Array<KnowledgeClaimPlan & { legacyHandle?: string }> {
  const explicit = asRecords(unit.knowledgeClaims);
  const sourceAnchors = asStrings(unit.sourceAnchors ?? unit.anchors);
  const primary = plans.find((plan) => plan.role === 'primary')?.slug ?? plans[0]?.slug ?? '';
  if (explicit.length > 0) {
    return explicit.flatMap((item) => {
      const text = compactSemanticText(item.text ?? item.claim ?? item.statement);
      if (!text || isGenericFillerClaim(text)) return [];
      return [{
        text,
        subject: compactSemanticText(item.subject) || primary,
        predicate: normalizeRelationPredicate(item.predicate),
        ...(compactSemanticText(item.object) ? { object: compactSemanticText(item.object) } : {}),
        conceptIds: asStrings(item.conceptIds ?? item.concepts),
        evidenceAnchors: asStrings(item.evidenceAnchors ?? item.sourceAnchors).length > 0
          ? asStrings(item.evidenceAnchors ?? item.sourceAnchors)
          : sourceAnchors,
        derivationAnchors: asStrings(item.derivationAnchors),
        connectedClaimIds: asStrings(item.connectedClaimIds),
      }];
    });
  }
  return asRecords(unit.zettelNotes).flatMap((note) => {
    const text = compactSemanticText(note.claim ?? note.statement ?? note.note);
    if (!text || isGenericFillerClaim(text) || !primary) return [];
    return [{
      text,
      subject: primary,
      predicate: inferPredicate(text),
      conceptIds: plans.map((plan) => plan.slug),
      evidenceAnchors: sourceAnchors,
      derivationAnchors: [],
      connectedClaimIds: [],
      legacyHandle: compactSemanticText(note.handle ?? note.id),
    }];
  });
}

export function readGardenSemanticArtifacts(
  gardenDir: string,
  gardenId = path.basename(gardenDir),
  sourceSetHash = '',
): GardenSemanticArtifacts {
  const registryPath = path.join(gardenDir, CONCEPT_REGISTRY_REL_PATH);
  const claimsPath = path.join(gardenDir, CLAIM_STORE_REL_PATH);
  const registry = sortConceptRegistry(
    readJson<ConceptRegistry>(registryPath, createEmptyConceptRegistry(gardenId, sourceSetHash)),
  );
  const claims = readJson<ClaimStore>(claimsPath, createEmptyClaimStore(gardenId, sourceSetHash));
  return {
    registry: { ...registry, gardenId: registry.gardenId || gardenId, sourceSetHash: registry.sourceSetHash || sourceSetHash },
    claims: {
      ...claims,
      schemaVersion: SEMANTIC_SCHEMA_VERSION,
      gardenId: claims.gardenId || gardenId,
      sourceSetHash: claims.sourceSetHash || sourceSetHash,
      claims: [...(claims.claims ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    },
  };
}

export function ensureGardenConceptRegistry(input: {
  gardenDir: string;
  gardenId: string;
  sourceSetHash?: string;
  concepts: SemanticConceptPlan[];
  persist?: boolean;
}): ConceptRegistry {
  let { registry } = readGardenSemanticArtifacts(
    input.gardenDir,
    input.gardenId,
    input.sourceSetHash ?? '',
  );
  registry = {
    ...registry,
    gardenId: input.gardenId,
    sourceSetHash: input.sourceSetHash ?? registry.sourceSetHash,
  };
  const initialAliasReconciliation = reconcileConceptRegistryAliases(registry);
  registry = initialAliasReconciliation.registry;
  const suppressedAmbiguousAliases = new Set(
    initialAliasReconciliation.repairs
      .filter((repair) => repair.reason === 'ambiguous-alias-removed')
      .map((repair) => repair.normalizedAlias),
  );
  for (const concept of input.concepts) {
    registry = mergeConcept(registry, {
      slug: concept.slug,
      preferredLabel: concept.preferredLabel,
      aliases: concept.aliases,
      evidenceAnchors: concept.evidenceAnchors,
      status: concept.evidenceAnchors.length > 0 ? 'source-verified' : 'unverified',
    }, { aliasCollisionPolicy: 'repair', suppressedAmbiguousAliases });
  }
  const reconciled = reconcileConceptRegistryAliases(registry);
  if (reconciled.conflicts.length > 0) {
    const conflict = reconciled.conflicts[0];
    throw new Error(
      `Alias collision for "${conflict.normalizedAlias}": ${conflict.conceptIds.join(', ')}`,
    );
  }
  registry = reconciled.registry;
  if (input.persist !== false) {
    performWritesWithBackup(input.gardenDir, [
      { relPath: CONCEPT_REGISTRY_REL_PATH, content: stableJson(registry) },
    ], 'semantic-registry');
  }
  return registry;
}

export function performWritesWithBackup(
  gardenDir: string,
  writes: PendingWrite[],
  backupLabel: string,
): { changedFiles: string[]; backupDir?: string } {
  const changed = writes.filter(({ relPath, content }) => {
    const absolute = path.join(gardenDir, ...normalizedRel(relPath).split('/'));
    return !fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== content;
  });
  if (changed.length === 0) return { changedFiles: [] };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRel = `.breadboard/backups/${backupLabel}-${timestamp}`;
  const backupDir = path.join(gardenDir, ...backupRel.split('/'));
  for (const { relPath } of changed) {
    const absolute = path.join(gardenDir, ...normalizedRel(relPath).split('/'));
    if (!fs.existsSync(absolute)) continue;
    const backup = path.join(backupDir, ...normalizedRel(relPath).split('/'));
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(absolute, backup);
  }

  const written: string[] = [];
  try {
    for (const { relPath, content } of changed) {
      const absolute = path.join(gardenDir, ...normalizedRel(relPath).split('/'));
      atomicWrite(absolute, content);
      written.push(normalizedRel(relPath));
    }
  } catch (error) {
    for (const relPath of written) {
      const absolute = path.join(gardenDir, ...relPath.split('/'));
      const backup = path.join(backupDir, ...relPath.split('/'));
      if (fs.existsSync(backup)) fs.copyFileSync(backup, absolute);
      else if (fs.existsSync(absolute)) fs.rmSync(absolute, { force: true });
    }
    throw error;
  }
  return { changedFiles: written, backupDir: normalizedRel(backupRel) };
}

/**
 * Commit the concept registry, learning-unit contract, and optional derived
 * planning view as one rollback-backed operation. If a handled replacement
 * fails, every earlier replacement is restored from backup instead of leaving
 * a partial result. Each file replacement is atomic; the multi-file operation
 * is not a filesystem transaction or a concurrent snapshot API.
 */
export function writeGardenConceptRegistryAndContract(input: {
  gardenDir: string;
  registry: ConceptRegistry;
  contract: unknown;
  planningMarkdown?: string;
}): { changedFiles: string[]; backupDir?: string } {
  const reconciled = reconcileConceptRegistryAliases(input.registry);
  if (reconciled.conflicts.length > 0) {
    const conflict = reconciled.conflicts[0];
    throw new Error(
      `Alias collision for "${conflict.normalizedAlias}": ${conflict.conceptIds.join(', ')}`,
    );
  }
  return performWritesWithBackup(input.gardenDir, [
    { relPath: CONCEPT_REGISTRY_REL_PATH, content: stableJson(reconciled.registry) },
    { relPath: LEARNING_UNIT_CONTRACT_REL_PATH, content: stableJson(input.contract) },
    ...(input.planningMarkdown === undefined
      ? []
      : [{
          relPath: '.breadboard/planning/Learning Unit Contract.md',
          content: input.planningMarkdown,
        }]),
  ], 'semantic-contract');
}

export function migrateGardenSemantics(
  gardenDir: string,
  options: { gardenId?: string; sourceSetHash?: string; migratedAt?: string } = {},
): SemanticMigrationReport {
  const gardenId = options.gardenId ?? path.basename(path.resolve(gardenDir));
  const contractRel = fs.existsSync(path.join(gardenDir, '.breadboard', 'learning-unit-contract.json'))
    ? '.breadboard/learning-unit-contract.json'
    : '.breadboard/planning/learning-unit-contract.json';
  const contractPath = path.join(gardenDir, ...contractRel.split('/'));
  const contract = readJson<Record<string, unknown>>(contractPath, {});
  const sourceSetHash = options.sourceSetHash ?? compactSemanticText(contract.sourceSetHash);
  const existingMigration = readJson<Record<string, unknown>>(
    path.join(gardenDir, SEMANTIC_MIGRATION_REL_PATH),
    {},
  );
  const migratedAt = compactSemanticText(existingMigration.migratedAt) || options.migratedAt || new Date().toISOString();
  let { registry, claims } = readGardenSemanticArtifacts(gardenDir, gardenId, sourceSetHash);
  registry = { ...registry, gardenId, sourceSetHash };
  claims = { ...claims, gardenId, sourceSetHash };

  const units = asRecords(contract.learningUnits ?? contract.units);
  const unitById = new Map(units.map((unit) => [compactSemanticText(unit.id), unit]));
  const pageFiles = walkMarkdown(gardenDir);
  const learnerPages: Array<{
    relPath: string;
    parsed: ParsedMarkdown;
    unitId: string;
    assignment: PageConceptAssignment;
    content: string;
  }> = [];
  const unitPage = new Map<string, string>();
  const ambiguousMappings: string[] = [];
  const diagnostics: string[] = [];
  const pendingPageWrites: PendingWrite[] = [];
  // Old contracts can repeat one canonical slug with inconsistent display
  // labels on different units. Consolidate those explicit plans before any
  // registry merge so a stale label is treated as a repairable alias, never as
  // a second canonical identity whose outcome depends on page order.
  const explicitPlansByUnit = units.map((unit) =>
    asRecords(unit.semanticConcepts).length > 0 ? semanticPlansForUnit(unit, '') : [],
  );
  const explicitPlanReconciliation = reconcileSemanticConceptAliases(
    explicitPlansByUnit.flat(),
  );
  diagnostics.push(...explicitPlanReconciliation.repairs.map(aliasRepairDiagnostic));
  if (explicitPlanReconciliation.conflicts.length > 0) {
    const conflict = explicitPlanReconciliation.conflicts[0];
    throw new Error(
      `Alias collision for "${conflict.normalizedAlias}": ${conflict.conceptIds.join(', ')}`,
    );
  }
  const reconciledExplicitPlansByUnit = new Map<Record<string, unknown>, SemanticConceptPlan[]>();
  let explicitPlanCursor = 0;
  units.forEach((unit, index) => {
    const count = explicitPlansByUnit[index].length;
    if (count > 0) {
      reconciledExplicitPlansByUnit.set(
        unit,
        explicitPlanReconciliation.concepts.slice(explicitPlanCursor, explicitPlanCursor + count),
      );
    }
    explicitPlanCursor += count;
  });
  const plansForUnit = (unit: Record<string, unknown>, grounding: string) =>
    reconciledExplicitPlansByUnit.get(unit) ??
    semanticPlansForUnit(unit, grounding);
  const initialAliasReconciliation = reconcileConceptRegistryAliases(registry);
  registry = initialAliasReconciliation.registry;
  diagnostics.push(...initialAliasReconciliation.repairs.map(aliasRepairDiagnostic));
  if (initialAliasReconciliation.conflicts.length > 0) {
    const conflict = initialAliasReconciliation.conflicts[0];
    throw new Error(
      `Alias collision for "${conflict.normalizedAlias}": ${conflict.conceptIds.join(', ')}`,
    );
  }
  const suppressedAmbiguousAliases = new Set(
    initialAliasReconciliation.repairs
      .filter((repair) => repair.reason === 'ambiguous-alias-removed')
      .map((repair) => repair.normalizedAlias),
  );

  for (const file of pageFiles) {
    const current = fs.readFileSync(file.absPath, 'utf8');
    const parsed = parseSemanticMarkdown(current);
    if (!isLearnerPage(file.relPath, parsed.data)) {
      const existingTags = semanticFrontmatterArray(parsed.data, 'tags');
      const fields: Record<string, string[]> = {
        primaryConcepts: [],
        supportingConcepts: [],
        claimIds: [],
        tags: [],
      };
      if (existingTags.length > 0 && file.relPath.startsWith('sources/')) fields.semanticHints = existingTags;
      const next = renderSemanticMarkdown(parsed, fields);
      if (next !== current) pendingPageWrites.push({ relPath: file.relPath, content: next });
      continue;
    }

    const unitId = semanticFrontmatterString(parsed.data, 'learningUnitId') ||
      semanticFrontmatterString(parsed.data, 'generatedFromUnitId');
    const unit = unitById.get(unitId) ?? {};
    if (unitId) unitPage.set(unitId, file.relPath);
    const title = semanticFrontmatterString(parsed.data, 'title');
    const existingTags = semanticFrontmatterArray(parsed.data, 'tags');
    const plans = plansForUnit(unit, `${title}\n${parsed.body}`);
    const fallbackCandidates = conceptCandidates(existingTags, `${title}\n${parsed.body}`);
    const effectivePlans = plans.length > 0
      ? plans
      : fallbackCandidates.map((slug, index) => ({
          slug,
          preferredLabel: preferredLabelFromSlug(slug),
          role: index === 0 ? 'primary' as const : 'supporting' as const,
          aliases: [],
          evidenceAnchors: semanticFrontmatterArray(parsed.data, 'sourceAnchors'),
        }));
    if (effectivePlans.length === 0) {
      ambiguousMappings.push(`${file.relPath}: no grounded primary concept could be derived`);
    }
    for (const plan of effectivePlans) {
      registry = mergeConcept(registry, {
        slug: plan.slug,
        preferredLabel: plan.preferredLabel,
        aliases: plan.aliases,
        evidenceAnchors: plan.evidenceAnchors,
        // Legacy contract anchors have not passed the Learn source gate. Keep
        // their provenance for later repair, but never upgrade verification
        // status merely because a nonempty string was persisted.
        status: 'unverified',
      }, { aliasCollisionPolicy: 'repair', suppressedAmbiguousAliases });
    }
    const primary = effectivePlans.filter((plan) => plan.role === 'primary').map((plan) => plan.slug);
    const supporting = effectivePlans.filter((plan) => plan.role === 'supporting').map((plan) => plan.slug);
    const normalized = normalizePageConceptAssignment({
      primaryConcepts: primary.length > 0 ? primary : effectivePlans.slice(0, 1).map((plan) => plan.slug),
      supportingConcepts: supporting,
      claimIds: semanticFrontmatterArray(parsed.data, 'claimIds'),
      registry,
    });
    diagnostics.push(...normalized.problems.map((problem) => `${file.relPath}: ${problem}`));
    learnerPages.push({
      relPath: file.relPath,
      parsed,
      unitId,
      assignment: normalized.assignment,
      content: current,
    });
  }

  const nextClaims = new Map<string, ClaimRecord>(claims.claims.map((claim) => [claim.id, claim]));
  const legacyHandleToClaimId = new Map<string, string>();
  let preservedLegacyClaims = 0;
  for (const unit of units) {
    const unitId = compactSemanticText(unit.id);
    const pageRelPath = unitPage.get(unitId) ?? '';
    const page = learnerPages.find((entry) => entry.relPath === pageRelPath);
    const plans = plansForUnit(unit, page ? `${semanticFrontmatterString(page.parsed.data, 'title')}\n${page.parsed.body}` : '');
    for (const plan of plans) {
      const canonicalSlug = normalizeConceptSlug(plan.slug);
      if (!registry.concepts.some((concept) => concept.slug === canonicalSlug)) {
        registry = mergeConcept(registry, {
          slug: plan.slug,
          preferredLabel: plan.preferredLabel,
          aliases: plan.aliases,
          evidenceAnchors: plan.evidenceAnchors,
          status: 'unverified',
        }, { aliasCollisionPolicy: 'repair', suppressedAmbiguousAliases });
      }
    }
    for (const claimPlan of claimPlansForUnit(unit, plans)) {
      if (!pageRelPath) ambiguousMappings.push(`unit ${unitId}: claim has no learner page mapping`);
      try {
        const claim = normalizeClaimRecord({
          ...claimPlan,
          learningUnitId: unitId,
          pageRelPath,
          registry,
          // Migration preserves legacy evidence references but cannot prove
          // that model-authored strings resolve to source material. Only the
          // normal Learn source gate may promote a claim to source-verified.
          status: 'unverified',
        });
        const existing = nextClaims.get(claim.id);
        nextClaims.set(claim.id, existing ? { ...claim, connectedClaimIds: [...new Set([...existing.connectedClaimIds, ...claim.connectedClaimIds])].sort() } : claim);
        if (claimPlan.legacyHandle) legacyHandleToClaimId.set(normalizeConceptSlug(claimPlan.legacyHandle), claim.id);
        preservedLegacyClaims += 1;
      } catch (error) {
        ambiguousMappings.push(
          `unit ${unitId}: ${error instanceof Error ? error.message : 'claim migration failed'}`,
        );
      }
    }
  }

  for (const unit of units) {
    const unitId = compactSemanticText(unit.id);
    const records = asRecords(unit.zettelNotes);
    for (const note of records) {
      const own = legacyHandleToClaimId.get(normalizeConceptSlug(compactSemanticText(note.handle ?? note.id)));
      if (!own) continue;
      const claim = nextClaims.get(own);
      if (!claim) continue;
      const connected = asStrings(note.connectedTo ?? note.links ?? note.related)
        .map((value) => legacyHandleToClaimId.get(normalizeConceptSlug(value)))
        .filter((value): value is string => Boolean(value));
      if (connected.length > 0) {
        nextClaims.set(own, { ...claim, connectedClaimIds: [...new Set([...claim.connectedClaimIds, ...connected])].sort() });
      }
    }
    void unitId;
  }

  claims = {
    ...claims,
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    gardenId,
    sourceSetHash,
    claims: [...nextClaims.values()].sort((left, right) => left.id.localeCompare(right.id)),
    migration: { fromSchema: 'zettelNotes-v0', version: SEMANTIC_SCHEMA_VERSION, migratedAt },
  };

  const claimIdsByPage = new Map<string, string[]>();
  for (const claim of claims.claims) {
    const ids = claimIdsByPage.get(claim.pageRelPath) ?? [];
    ids.push(claim.id);
    claimIdsByPage.set(claim.pageRelPath, ids);
  }
  for (const page of learnerPages) {
    const assignment = {
      ...page.assignment,
      claimIds: [...new Set(claimIdsByPage.get(page.relPath) ?? [])].sort(),
    };
    page.assignment = assignment;
    const next = renderSemanticMarkdown(page.parsed, {
      primaryConcepts: assignment.primaryConcepts,
      supportingConcepts: assignment.supportingConcepts,
      tags: assignment.tags,
      claimIds: assignment.claimIds,
    });
    if (next !== page.content) pendingPageWrites.push({ relPath: page.relPath, content: next });
  }

  const updatedUnitDrafts = units.map((unit) => {
    const unitId = compactSemanticText(unit.id);
    const page = learnerPages.find((entry) => entry.unitId === unitId);
    const plans = plansForUnit(unit, page ? `${semanticFrontmatterString(page.parsed.data, 'title')}\n${page.parsed.body}` : '');
    const knowledgeClaims = claimPlansForUnit(unit, plans).map((claim) => ({
      text: claim.text,
      subject: normalizeConceptSlug(claim.subject),
      predicate: normalizeRelationPredicate(claim.predicate),
      ...(claim.object ? { object: normalizeConceptSlug(claim.object) } : {}),
      conceptIds: (claim.conceptIds ?? plans.map((plan) => plan.slug))
        .map(normalizeConceptSlug)
        .filter(Boolean),
      evidenceAnchors: claim.evidenceAnchors,
      derivationAnchors: claim.derivationAnchors,
    }));
    return { unit, plans, knowledgeClaims };
  });
  const contractAliasReconciliation = reconcileSemanticConceptAliases(
    updatedUnitDrafts.flatMap((draft) => draft.plans),
  );
  diagnostics.push(...contractAliasReconciliation.repairs.map(aliasRepairDiagnostic));
  if (contractAliasReconciliation.conflicts.length > 0) {
    const conflict = contractAliasReconciliation.conflicts[0];
    throw new Error(
      `Alias collision for "${conflict.normalizedAlias}": ${conflict.conceptIds.join(', ')}`,
    );
  }
  const registryAlignedContractConcepts = alignSemanticConceptAliasesWithRegistry(
    contractAliasReconciliation.concepts,
    registry,
  );
  contractAliasReconciliation.concepts.forEach((concept, index) => {
    const alignedKeys = new Set(
      (registryAlignedContractConcepts[index]?.aliases ?? []).map((alias) =>
        normalizeConceptSlug(alias),
      ),
    );
    for (const alias of concept.aliases) {
      const normalizedAlias = normalizeConceptSlug(alias).replace(/-/g, ' ');
      if (!alignedKeys.has(normalizeConceptSlug(alias))) {
        diagnostics.push(
          `repaired alias "${normalizedAlias}": removed from concept:${normalizeConceptSlug(concept.slug)}; registry ownership`,
        );
      }
    }
  });
  let contractConceptCursor = 0;
  const updatedUnits = updatedUnitDrafts.map((draft) => {
    const semanticConcepts = registryAlignedContractConcepts.slice(
      contractConceptCursor,
      contractConceptCursor + draft.plans.length,
    );
    contractConceptCursor += draft.plans.length;
    return { ...draft.unit, semanticConcepts, knowledgeClaims: draft.knowledgeClaims };
  });
  const nextContract = Object.keys(contract).length > 0
    ? {
        ...contract,
        schemaVersion: Math.max(Number(contract.schemaVersion) || 0, 2),
        learningUnits: Array.isArray(contract.learningUnits) ? updatedUnits : contract.learningUnits,
        units: Array.isArray(contract.units) ? updatedUnits : contract.units,
      }
    : contract;

  const finalAliasReconciliation = reconcileConceptRegistryAliases(sortConceptRegistry({
    ...registry,
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    gardenId,
    sourceSetHash,
    migration: { fromSchema: 'claim-as-tag-v0', version: SEMANTIC_SCHEMA_VERSION, migratedAt },
  }));
  registry = finalAliasReconciliation.registry;
  diagnostics.push(...finalAliasReconciliation.repairs.map(aliasRepairDiagnostic));
  if (finalAliasReconciliation.conflicts.length > 0) {
    const conflict = finalAliasReconciliation.conflicts[0];
    throw new Error(
      `Alias collision for "${conflict.normalizedAlias}": ${conflict.conceptIds.join(', ')}`,
    );
  }
  const aliasRepairAudit = [...new Set(
    [
      ...asStrings(existingMigration.aliasRepairs),
      ...diagnostics.filter((diagnostic) => diagnostic.startsWith('repaired alias "')),
    ],
  )].sort();
  const migrationArtifact = {
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    gardenId,
    sourceSetHash,
    fromSchema: 'claim-as-tag-v0',
    migratedAt,
    ambiguousMappings: [...new Set(ambiguousMappings)].sort(),
    ...(aliasRepairAudit.length > 0 ? { aliasRepairs: aliasRepairAudit } : {}),
  };

  const writes: PendingWrite[] = [
    ...pendingPageWrites,
    { relPath: CONCEPT_REGISTRY_REL_PATH, content: stableJson(registry) },
    { relPath: CLAIM_STORE_REL_PATH, content: stableJson(claims) },
    { relPath: SEMANTIC_MIGRATION_REL_PATH, content: stableJson(migrationArtifact) },
  ];
  if (Object.keys(nextContract).length > 0) writes.push({ relPath: contractRel, content: stableJson(nextContract) });
  const applied = performWritesWithBackup(gardenDir, writes, `semantic-v${SEMANTIC_SCHEMA_VERSION}`);
  const metrics = semanticHealthMetrics({
    registry,
    claims,
    pages: learnerPages.map((page) => page.assignment),
  });
  return {
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    gardenId,
    migrated: applied.changedFiles.length > 0,
    migratedAt,
    ...(applied.backupDir ? { backupDir: applied.backupDir } : {}),
    changedFiles: applied.changedFiles,
    preservedLegacyClaims,
    ambiguousMappings: [...new Set(ambiguousMappings)].sort(),
    diagnostics: [...new Set([
      ...diagnostics,
      ...aliasConflicts(registry).map((conflict) =>
        `alias conflict "${conflict.normalizedAlias}": ${conflict.conceptIds.join(', ')}`,
      ),
    ])].sort(),
    metrics,
  };
}

export function updateLearnerPageConcepts(input: {
  gardenDir: string;
  pageRelPath: string;
  requestedTerms: string[];
  primaryTerms?: string[];
  mode?: 'merge' | 'replace';
  provenance?: string;
  contentOverride?: string;
}): PageConceptAssignment {
  const relPath = normalizedRel(input.pageRelPath);
  const absolute = path.resolve(input.gardenDir, ...relPath.split('/'));
  const root = path.resolve(input.gardenDir);
  if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute)) {
    throw new Error('Learner page not found');
  }
  const current = fs.readFileSync(absolute, 'utf8');
  const currentParsed = parseSemanticMarkdown(current);
  if (!isLearnerPage(relPath, currentParsed.data)) {
    throw new Error('Public concepts may only be edited on learner pages');
  }
  const parsed = input.contentOverride
    ? parseSemanticMarkdown(input.contentOverride)
    : currentParsed;
  if (!fs.existsSync(path.join(root, CONCEPT_REGISTRY_REL_PATH))) migrateGardenSemantics(root);
  const artifacts = readGardenSemanticArtifacts(root);
  let registry = artifacts.registry;
  const claims = artifacts.claims;
  const resolvedRequested: string[] = [];
  for (const term of input.requestedTerms) {
    let concept = resolveConcept(term, registry);
    if (!concept) {
      const slug = normalizeConceptSlug(term);
      if (!isValidPublicConceptSlug(slug)) {
        throw new Error(`"${term}" is not a reusable public concept`);
      }
      registry = mergeConcept(registry, {
        slug,
        preferredLabel: preferredLabelFromSlug(slug),
        aliases: normalizeConceptSlug(term) === normalizeLookupForComparison(term) ? [] : [term],
        description: '',
        status: 'unverified',
      });
      concept = resolveConcept(slug, registry);
    }
    if (concept && !resolvedRequested.includes(concept.slug)) resolvedRequested.push(concept.slug);
  }
  const requestedPrimary = (input.primaryTerms ?? input.requestedTerms.slice(0, 1))
    .map((term) => resolveConcept(term, registry)?.slug)
    .filter((slug): slug is string => Boolean(slug));
  const existingPrimary = semanticFrontmatterArray(currentParsed.data, 'primaryConcepts');
  const existingSupporting = semanticFrontmatterArray(currentParsed.data, 'supportingConcepts');
  const primaryConcepts = input.mode === 'replace'
    ? requestedPrimary
    : [...new Set([...existingPrimary, ...requestedPrimary])];
  const supportingConcepts = input.mode === 'replace'
    ? resolvedRequested.filter((slug) => !primaryConcepts.includes(slug))
    : [...new Set([...existingSupporting, ...resolvedRequested])].filter((slug) => !primaryConcepts.includes(slug));
  const normalized = normalizePageConceptAssignment({
    primaryConcepts,
    supportingConcepts,
    claimIds: semanticFrontmatterArray(currentParsed.data, 'claimIds'),
    registry,
  });
  if (normalized.problems.length > 0) throw new Error(normalized.problems.join('; '));

  const nextPage = renderSemanticMarkdown(parsed, {
    primaryConcepts: normalized.assignment.primaryConcepts,
    supportingConcepts: normalized.assignment.supportingConcepts,
    tags: normalized.assignment.tags,
    claimIds: normalized.assignment.claimIds,
  });
  const contractRel = fs.existsSync(path.join(root, '.breadboard', 'learning-unit-contract.json'))
    ? '.breadboard/learning-unit-contract.json'
    : '.breadboard/planning/learning-unit-contract.json';
  const contractPath = path.join(root, ...contractRel.split('/'));
  const contract = readJson<Record<string, unknown>>(contractPath, {});
  const unitId = semanticFrontmatterString(currentParsed.data, 'learningUnitId');
  const updateUnits = (value: unknown) => asRecords(value).map((unit) => {
    if (compactSemanticText(unit.id) !== unitId) return unit;
    const semanticConcepts: SemanticConceptPlan[] = normalized.assignment.tags.map((slug) => {
      const concept = resolveConcept(slug, registry)!;
      return {
        slug,
        preferredLabel: concept.preferredLabel,
        role: normalized.assignment.primaryConcepts.includes(slug) ? 'primary' : 'supporting',
        aliases: concept.aliases,
        evidenceAnchors: concept.evidenceAnchors,
      };
    });
    return { ...unit, semanticConcepts };
  });
  const nextContract = {
    ...contract,
    ...(Array.isArray(contract.learningUnits) ? { learningUnits: updateUnits(contract.learningUnits) } : {}),
    ...(Array.isArray(contract.units) ? { units: updateUnits(contract.units) } : {}),
    semanticEditProvenance: {
      source: input.provenance ?? 'manual-retagging',
      pageRelPath: relPath,
      updatedAt: new Date().toISOString(),
    },
  };
  performWritesWithBackup(root, [
    { relPath, content: nextPage },
    { relPath: CONCEPT_REGISTRY_REL_PATH, content: stableJson(sortConceptRegistry(registry)) },
    { relPath: CLAIM_STORE_REL_PATH, content: stableJson(claims) },
    ...(Object.keys(contract).length > 0 ? [{ relPath: contractRel, content: stableJson(nextContract) }] : []),
  ], 'semantic-edit');
  return normalized.assignment;
}

function normalizeLookupForComparison(value: string): string {
  return normalizeConceptSlug(value).replace(/-/g, ' ');
}

export function validateGardenSemantics(gardenDir: string): {
  hardFailures: string[];
  diagnostics: string[];
  metrics: SemanticHealthMetrics;
} {
  const { registry, claims } = readGardenSemanticArtifacts(gardenDir);
  const hardFailures: string[] = [];
  const diagnostics: string[] = [];
  const pages: PageConceptAssignment[] = [];
  const registryIds = new Set(registry.concepts.map((concept) => concept.id));
  const claimIds = new Set<string>();
  for (const file of walkMarkdown(gardenDir)) {
    const parsed = parseSemanticMarkdown(fs.readFileSync(file.absPath, 'utf8'));
    const tags = semanticFrontmatterArray(parsed.data, 'tags');
    if (!isLearnerPage(file.relPath, parsed.data)) {
      if (tags.length > 0) hardFailures.push(`${file.relPath}: non-learner page carries public tags`);
      continue;
    }
    const primaryConcepts = semanticFrontmatterArray(parsed.data, 'primaryConcepts');
    const supportingConcepts = semanticFrontmatterArray(parsed.data, 'supportingConcepts');
    const pageClaimIds = semanticFrontmatterArray(parsed.data, 'claimIds');
    const normalized = normalizePageConceptAssignment({
      primaryConcepts,
      supportingConcepts,
      claimIds: pageClaimIds,
      registry,
    });
    hardFailures.push(...normalized.problems.map((problem) => `${file.relPath}: ${problem}`));
    if (JSON.stringify(tags) !== JSON.stringify(normalized.assignment.tags)) {
      hardFailures.push(`${file.relPath}: tags must equal primaryConcepts + supportingConcepts`);
    }
    for (const tag of tags) {
      if (!isValidPublicConceptSlug(tag)) hardFailures.push(`${file.relPath}: claim or invalid concept used as public tag "${tag}"`);
    }
    if (tags.length === 1) diagnostics.push(`${file.relPath}: focused page has one public concept`);
    pages.push(normalized.assignment);
  }
  for (const conflict of aliasConflicts(registry)) {
    hardFailures.push(`alias collision "${conflict.normalizedAlias}": ${conflict.conceptIds.join(', ')}`);
  }
  for (const claim of claims.claims) {
    if (claimIds.has(claim.id)) hardFailures.push(`claim ID collision: ${claim.id}`);
    claimIds.add(claim.id);
    if (!registryIds.has(claim.subject)) hardFailures.push(`${claim.id}: missing subject ${claim.subject}`);
    if (claim.object && !registryIds.has(claim.object)) hardFailures.push(`${claim.id}: missing object ${claim.object}`);
    if (claim.status === 'source-verified' && claim.evidenceAnchors.length === 0) {
      hardFailures.push(`${claim.id}: source-verified claim lacks evidence`);
    }
    if (!claim.learningUnitId || !claim.pageRelPath) hardFailures.push(`${claim.id}: missing page or unit lineage`);
    else if (!fs.existsSync(path.join(gardenDir, ...claim.pageRelPath.split('/')))) {
      hardFailures.push(`${claim.id}: referenced page does not exist: ${claim.pageRelPath}`);
    }
  }
  const metrics = semanticHealthMetrics({ registry, claims, pages });
  for (const concept of registry.concepts) {
    const occurrences = pages.filter((page) => page.tags.includes(concept.slug)).length;
    if (occurrences === 1) diagnostics.push(`singleton concept: ${concept.slug}`);
    if (occurrences === 0) diagnostics.push(`orphan concept: ${concept.slug}`);
  }
  return {
    hardFailures: [...new Set(hardFailures)].sort(),
    diagnostics: [...new Set(diagnostics)].sort(),
    metrics,
  };
}

export function claimIdForPlan(unitId: string, claim: Pick<KnowledgeClaimPlan, 'text'>): string {
  return stableClaimId(unitId, claim.text);
}

export function publicConceptFieldsForPlans(
  plans: SemanticConceptPlan[],
  registry: ConceptRegistry,
): PageConceptAssignment {
  return normalizePageConceptAssignment({
    primaryConcepts: plans.filter((plan) => plan.role === 'primary').map((plan) => plan.slug),
    supportingConcepts: plans.filter((plan) => plan.role === 'supporting').map((plan) => plan.slug),
    registry,
  }).assignment;
}

export function semanticRole(value: unknown): ConceptRole {
  return compactSemanticText(value) === 'primary' ? 'primary' : 'supporting';
}
