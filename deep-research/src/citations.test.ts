import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  extractCitationIds,
  removeInvalidCitations,
  validateCitations,
} from './citations';
import type { ResearchEvidence, ResearchSource } from './research-types';

const sources: ResearchSource[] = [
  {
    id: 'S1',
    url: 'https://example.com/primary',
    query: 'example',
    retrievedAt: '2026-08-12T00:00:00.000Z',
  },
  {
    id: 'S2',
    url: 'https://example.org/corroboration',
    query: 'example',
    retrievedAt: '2026-08-12T00:00:00.000Z',
  },
];

const evidence: ResearchEvidence[] = [
  {
    id: 'E1',
    claim: 'The primary source reports the event.',
    sourceIds: ['S1'],
    query: 'example',
    depth: 1,
  },
  {
    id: 'E2',
    claim: 'A second source corroborates the date.',
    sourceIds: ['S2'],
    query: 'example',
    depth: 1,
  },
];

describe('citation validation', () => {
  it('reports registered, invented, and uncovered evidence separately', () => {
    const result = validateCitations(
      'Supported fact [S1]. Invented marker [S99].',
      sources,
      evidence,
    );

    assert.deepEqual(result.citedSourceIds, ['S1']);
    assert.deepEqual(result.invalidSourceIds, ['S99']);
    assert.deepEqual(result.uncitedEvidenceIds, ['E2']);
    assert.equal(result.evidenceCoverage, 0.5);
  });

  it('normalizes marker case, de-duplicates IDs, and removes only unknown markers', () => {
    const markdown = 'First [s1], repeated [S1], second [S2], fake [S3].';
    assert.deepEqual(extractCitationIds(markdown), ['S1', 'S2', 'S3']);
    assert.equal(
      removeInvalidCitations(markdown, sources),
      'First [S1], repeated [S1], second [S2], fake .',
    );
  });
});
