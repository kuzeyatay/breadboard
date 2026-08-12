/**
 * Browser-safe normalization for additive Deep Research v2 evidence events.
 *
 * The sidecar is deliberately treated as untrusted input: URLs are restricted
 * to navigable web protocols, text is bounded, duplicate records are folded,
 * and evidence may only reference sources present in the same snapshot.
 */

export interface ResearchSource {
  id: string;
  url: string;
  title?: string;
  excerpt?: string;
  query?: string;
  retrievedAt?: string;
}

export interface ResearchEvidence {
  id: string;
  claim: string;
  sourceIds: string[];
  query?: string;
  depth?: number;
}

export interface ResearchWarning {
  code: string;
  message: string;
  query?: string;
  recoverable: boolean;
}

export interface ResearchCoverage {
  totalClaims: number;
  citedClaims: number;
  ratio: number;
  referencedSources: number;
  totalSources: number;
  sourceRatio: number;
}

export interface ResearchEvidenceSnapshot {
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  warnings: ResearchWarning[];
  coverage: ResearchCoverage;
}

export interface ResearchBudget {
  searches: number;
  modelCalls: number;
  sources: number;
  tokens: number;
  elapsedMs: number;
  stoppedReason?: string;
}

const MAX_SOURCES = 250;
const MAX_EVIDENCE = 500;
const MAX_WARNINGS = 100;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, limit) : undefined;
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function ratio(value: unknown, numerator: number, denominator: number): number {
  const number = Number(value);
  if (Number.isFinite(number)) return Math.min(1, Math.max(0, number));
  return denominator > 0 ? Math.min(1, numerator / denominator) : 0;
}

function safeWebUrl(value: unknown): string | null {
  const text = boundedText(value, 4_096);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeResearchBudget(input: unknown): ResearchBudget | null {
  const candidate = record(input);
  if (!candidate) return null;
  const stoppedReason = boundedText(candidate.stoppedReason, 40);
  return {
    searches: nonNegativeInteger(candidate.searches),
    modelCalls: nonNegativeInteger(candidate.modelCalls),
    sources: nonNegativeInteger(candidate.sources),
    tokens: nonNegativeInteger(candidate.tokens),
    elapsedMs: nonNegativeInteger(candidate.elapsedMs),
    ...(stoppedReason ? { stoppedReason } : {}),
  };
}

function normalizeSources(payload: Record<string, unknown>): ResearchSource[] {
  const rawSources = Array.isArray(payload.sources) ? payload.sources : [];
  const legacyUrls = Array.isArray(payload.visitedUrls) ? payload.visitedUrls : [];
  const combined: unknown[] = [
    ...rawSources,
    ...legacyUrls.map((url) => ({ url })),
  ];
  const seenUrls = new Set<string>();
  const usedIds = new Set<string>();
  const sources: ResearchSource[] = [];

  for (const raw of combined) {
    if (sources.length >= MAX_SOURCES) break;
    const candidate = record(raw);
    if (!candidate) continue;
    const url = safeWebUrl(candidate.url);
    if (!url || seenUrls.has(url)) continue;

    let id = boundedText(candidate.id, 80) ?? `S${sources.length + 1}`;
    if (!/^[A-Za-z0-9._:-]+$/.test(id) || usedIds.has(id)) {
      id = `S${sources.length + 1}`;
    }
    seenUrls.add(url);
    usedIds.add(id);
    sources.push({
      id,
      url,
      ...(boundedText(candidate.title, 300)
        ? { title: boundedText(candidate.title, 300) }
        : {}),
      ...(boundedText(candidate.excerpt, 2_000)
        ? { excerpt: boundedText(candidate.excerpt, 2_000) }
        : {}),
      ...(boundedText(candidate.query, 1_000)
        ? { query: boundedText(candidate.query, 1_000) }
        : {}),
      ...(boundedText(candidate.retrievedAt, 80)
        ? { retrievedAt: boundedText(candidate.retrievedAt, 80) }
        : {}),
    });
  }
  return sources;
}

function normalizeEvidence(
  payload: Record<string, unknown>,
  sourceIds: ReadonlySet<string>,
): ResearchEvidence[] {
  const rawEvidence = Array.isArray(payload.evidence) ? payload.evidence : [];
  const evidence: ResearchEvidence[] = [];
  const seenClaims = new Set<string>();
  for (const raw of rawEvidence) {
    if (evidence.length >= MAX_EVIDENCE) break;
    const candidate = record(raw);
    if (!candidate) continue;
    const claim = boundedText(candidate.claim, 4_000);
    if (!claim || seenClaims.has(claim)) continue;
    const referenced = Array.isArray(candidate.sourceIds)
      ? candidate.sourceIds
          .map((id) => boundedText(id, 80))
          .filter((id): id is string => Boolean(id && sourceIds.has(id)))
      : [];
    const uniqueSourceIds = [...new Set(referenced)];
    seenClaims.add(claim);
    evidence.push({
      id: boundedText(candidate.id, 80) ?? `E${evidence.length + 1}`,
      claim,
      sourceIds: uniqueSourceIds,
      ...(boundedText(candidate.query, 1_000)
        ? { query: boundedText(candidate.query, 1_000) }
        : {}),
      ...(Number.isFinite(Number(candidate.depth))
        ? { depth: nonNegativeInteger(candidate.depth) }
        : {}),
    });
  }
  return evidence;
}

function normalizeWarnings(payload: Record<string, unknown>): ResearchWarning[] {
  const rawWarnings = Array.isArray(payload.warnings) ? payload.warnings : [];
  const warnings: ResearchWarning[] = [];
  const seen = new Set<string>();
  for (const raw of rawWarnings) {
    if (warnings.length >= MAX_WARNINGS) break;
    const candidate = record(raw);
    if (!candidate) continue;
    const code = boundedText(candidate.code, 100);
    const message = boundedText(candidate.message, 1_000);
    if (!code || !message) continue;
    const key = `${code}\u0000${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push({
      code,
      message,
      ...(boundedText(candidate.query, 1_000)
        ? { query: boundedText(candidate.query, 1_000) }
        : {}),
      recoverable: candidate.recoverable !== false,
    });
  }
  return warnings;
}

export function normalizeResearchEvidenceSnapshot(
  input: unknown,
): ResearchEvidenceSnapshot {
  const payload = record(input) ?? {};
  const sources = normalizeSources(payload);
  const sourceIds = new Set(sources.map((source) => source.id));
  const evidence = normalizeEvidence(payload, sourceIds);
  const warnings = normalizeWarnings(payload);
  const rawCoverage = record(payload.coverage) ?? {};
  const totalClaims = nonNegativeInteger(
    rawCoverage.totalClaims ?? evidence.length,
  );
  const derivedCited = evidence.filter((item) => item.sourceIds.length > 0).length;
  const citedClaims = Math.min(
    totalClaims,
    nonNegativeInteger(rawCoverage.citedClaims ?? derivedCited),
  );
  const totalSources = nonNegativeInteger(
    rawCoverage.totalSources ?? sources.length,
  );
  const derivedReferenced = new Set(evidence.flatMap((item) => item.sourceIds)).size;
  const referencedSources = Math.min(
    totalSources,
    nonNegativeInteger(rawCoverage.referencedSources ?? derivedReferenced),
  );

  return {
    sources,
    evidence,
    warnings,
    coverage: {
      totalClaims,
      citedClaims,
      ratio: ratio(rawCoverage.ratio, citedClaims, totalClaims),
      referencedSources,
      totalSources,
      sourceRatio: ratio(
        rawCoverage.sourceRatio,
        referencedSources,
        totalSources,
      ),
    },
  };
}
