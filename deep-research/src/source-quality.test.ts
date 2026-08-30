import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  annotateSources,
  independentPublisherCount,
  isPromotional,
  publisherOf,
  sourceKindOf,
} from './source-quality';
import type { ResearchSource } from './research-types';

const source = (id: string, url: string): ResearchSource => ({
  id,
  url,
  query: 'q',
  retrievedAt: '2026-08-21T00:00:00.000Z',
});

describe('source quality signals', () => {
  it('names the publisher without the www', () => {
    assert.equal(publisherOf('https://www.CDC.gov/nchs/x'), 'cdc.gov');
    assert.equal(publisherOf('not a url'), '');
  });

  it('places only the domains an address actually places', () => {
    assert.equal(sourceKindOf('https://cdc.gov/x'), 'government');
    assert.equal(sourceKindOf('https://www.gov.uk/x'), 'government');
    assert.equal(sourceKindOf('https://stanford.edu/x'), 'academic');
    assert.equal(sourceKindOf('https://ox.ac.uk/x'), 'academic');
    assert.equal(sourceKindOf('https://arxiv.org/abs/1'), 'academic');
    assert.equal(sourceKindOf('https://who.int/x'), 'intergovernmental');
    assert.equal(sourceKindOf('https://oecd.org/x'), 'intergovernmental');
  });

  it('says unknown rather than guessing', () => {
    // Most of the web is unplaceable from its address, and a confident label on
    // a guess is the failure this exists to prevent, not a smaller version.
    assert.equal(sourceKindOf('https://ifstudies.org/blog/x'), 'unclassified');
    assert.equal(sourceKindOf('https://nytimes.com/x'), 'unclassified');
    assert.equal(sourceKindOf('https://some-startup.ai/x'), 'unclassified');
  });

  it('marks sales material by the shape of its path', () => {
    assert.equal(isPromotional('https://cobots.example/roi-calculator'), true);
    assert.equal(isPromotional('https://cobots.example/pricing'), true);
    assert.equal(isPromotional('https://cobots.example/buyers-guide'), true);
    assert.equal(isPromotional('https://cobots.example/case-studies/acme'), true);
    assert.equal(isPromotional('https://cobots.example/blog/why-cobots'), false);
  });

  it('does not read a public body\'s fee page as marketing', () => {
    // The shape only means what it means on a commercial page.
    assert.equal(isPromotional('https://cdc.gov/products/index.html'), false);
    assert.equal(isPromotional('https://stanford.edu/store'), false);
  });

  it('counts publishers, not pages', () => {
    // Three pages of one site restating a figure is one source. Counting it as
    // three is the arithmetic that makes a press release look like a consensus.
    const sources = [
      source('S1', 'https://acme.com/guide'),
      source('S2', 'https://www.acme.com/blog/post'),
      source('S3', 'https://acme.com/pdf/report.pdf'),
      source('S4', 'https://other.org/study'),
    ];
    assert.equal(independentPublisherCount(sources), 2);

    const annotations = annotateSources(sources);
    assert.deepEqual(annotations.get('S1')?.samePublisherAs, ['S2', 'S3']);
    assert.deepEqual(annotations.get('S4')?.samePublisherAs, []);
  });

  it('survives a malformed url without dropping the source', () => {
    const annotations = annotateSources([source('S1', 'http://[bad')]);
    assert.equal(annotations.get('S1')?.publisher, '');
    assert.equal(annotations.get('S1')?.kind, 'unclassified');
  });
});
