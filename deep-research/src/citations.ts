import type {
  CitationValidation,
  ResearchEvidence,
  ResearchSource,
} from './research-types';

const CitationPattern = /\[(S\d+)\]/gi;

export function extractCitationIds(markdown: string): string[] {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(CitationPattern)) {
    const id = match[1]?.toUpperCase();
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Remove citation markers that do not exist in the run's source registry.
 * A model may discuss uncertainty, but it may never create a plausible-looking
 * source identifier that the application cannot resolve.
 */
export function removeInvalidCitations(
  markdown: string,
  sources: ResearchSource[],
): string {
  const known = new Set(sources.map(source => source.id.toUpperCase()));
  return markdown.replace(CitationPattern, (marker, id: string) =>
    known.has(id.toUpperCase()) ? `[${id.toUpperCase()}]` : '',
  );
}

export function validateCitations(
  markdown: string,
  sources: ResearchSource[],
  evidence: ResearchEvidence[],
): CitationValidation {
  const known = new Set(sources.map(source => source.id.toUpperCase()));
  const allMarkers = extractCitationIds(markdown);
  const citedSourceIds = allMarkers.filter(id => known.has(id));
  const invalidSourceIds = allMarkers.filter(id => !known.has(id));
  const cited = new Set(citedSourceIds);
  const uncitedEvidenceIds = evidence
    .filter(item => !item.sourceIds.some(id => cited.has(id.toUpperCase())))
    .map(item => item.id);

  return {
    citedSourceIds,
    invalidSourceIds,
    uncitedEvidenceIds,
    evidenceCoverage:
      evidence.length === 0
        ? 0
        : (evidence.length - uncitedEvidenceIds.length) / evidence.length,
  };
}
