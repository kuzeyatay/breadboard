import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

import {
  FinalReportMaxTokens,
  finalReportPrompt,
  FindingsPerSearch,
} from './deep-research';
import {
  readerComprehensionPrompt,
  researchAnswerContractPrompt,
  systemPrompt,
} from './prompt';
import type { ResearchEvidence, ResearchSource } from './research-types';

const sources: ResearchSource[] = [
  {
    id: 'S1',
    url: 'https://example.com/evidence',
    query: 'robotics economics',
    retrievedAt: '2026-08-20T00:00:00.000Z',
  },
];

const evidence: ResearchEvidence[] = [
  {
    id: 'E1',
    claim: 'The evidence supports a material economic consequence.',
    sourceIds: ['S1'],
    query: 'robotics economics',
    depth: 1,
  },
];

describe('report writing contract', () => {
  it('reserves enough evidence and output capacity for a long-form report', () => {
    assert.equal(FindingsPerSearch, 5);
    assert.ok(FinalReportMaxTokens >= 8_000);
  });

  it('asks for a substantive report without weakening source constraints', () => {
    const prompt = finalReportPrompt('What changes?', evidence, sources);

    assert.match(prompt, /three-page research brief/i);
    assert.match(prompt, /1,500–2,500 words/i);
    assert.match(prompt, /every material supported dimension/i);
    assert.match(prompt, /for a first-time reader/i);
    assert.match(prompt, /plain-English conclusion and why it matters/i);
    assert.match(prompt, /explain every necessary technical term/i);
    assert.match(prompt, /each important number a baseline and practical meaning/i);
    assert.match(prompt, /allowed_source_ids/);
    assert.match(prompt, /USD 2\.6 trillion/);
    assert.match(prompt, /<evidence id="E1" allowed_source_ids="S1">/);
    assert.match(prompt, /<source id="S1"/);
  });

  it('uses the shared comprehension layer after researcher and user context', () => {
    const prompt = systemPrompt('# user_context\nThe requester prefers short answers.');
    const standaloneCopy = fs
      .readFileSync(new URL('./reader-comprehension.md', import.meta.url), 'utf8')
      .trim();

    assert.doesNotMatch(prompt, /for an experienced analyst/i);
    assert.ok(prompt.includes('# user_context'));
    assert.ok(prompt.endsWith(readerComprehensionPrompt()));
    assert.match(prompt, /# reader_comprehension_layer/);
    assert.equal(readerComprehensionPrompt(), standaloneCopy);
  });

  it('carries the shared writing standard, not only the comprehension layer', () => {
    // The engine already forces a citation after every claim. What it had no
    // rule for is the failure that survives citing correctly: a seller's own
    // figure repeated as a market rate, a 2024 total given in the present
    // tense, a ranking against a criterion nobody named.
    const prompt = systemPrompt(undefined, { writing: true });
    assert.match(prompt, /# research_answer_contract/);
    assert.match(prompt, /One source is not a consensus/);
    assert.match(prompt, /Name the basis you are judging on/);
    assert.match(prompt, /Do not merge things that behave differently/);

    // Before comprehension, which stays last: one decides what a claim must
    // carry, the other whether the result can be understood.
    assert.ok(
      prompt.indexOf(researchAnswerContractPrompt()) <
        prompt.indexOf(readerComprehensionPrompt()),
    );
    assert.ok(prompt.endsWith(readerComprehensionPrompt()));
  });

  it('does not tell the researcher that official always means authoritative', () => {
    // "Prefer primary, official" on its own points straight at the vendor page
    // for a market-wide number, which is the source it is worst for.
    const prompt = systemPrompt();
    assert.match(prompt, /Authority depends on the claim, not only on the publisher/);
    assert.match(prompt, /what the market pays/);
  });

  it('keeps the standalone copy identical to the canonical one', () => {
    // The Docker build ships only this directory. A copy that drifts means an
    // answer's standards depend on which runtime produced it.
    const canonical = fs
      .readFileSync(
        new URL('../../hermes-config/system/research-answer-contract.md', import.meta.url),
        'utf8',
      )
      .trim();
    const standalone = fs
      .readFileSync(new URL('./research-answer-contract.md', import.meta.url), 'utf8')
      .trim();
    assert.equal(standalone, canonical);
    assert.equal(researchAnswerContractPrompt(), canonical);
  });

  it('spends the writing standard only on calls that write prose', () => {
    // Query planning and findings extraction produce structured output. Telling
    // a JSON schema not to write a bibliography is pure token cost — while the
    // claim-authority rule stays on every call, because deciding what a
    // document supports is exactly where a seller's page needs discounting.
    const extraction = systemPrompt();
    assert.doesNotMatch(extraction, /# research_answer_contract/);
    assert.match(extraction, /Authority depends on the claim/);
  });

  it('hands the model the publisher, so an attribution is derived not guessed', () => {
    const prompt = finalReportPrompt('What changes?', evidence, sources);
    assert.match(prompt, /publisher="example\.com"/);
    assert.match(prompt, /A marker is not an attribution/);
    assert.match(prompt, /say in the sentence who published it/);
  });

  it('annotates the registry with what a source address actually says', () => {
    const registrySources = [
      { id: 'S1', url: 'https://www.cdc.gov/nchs/x', query: 'q', retrievedAt: '2026-08-21' },
      { id: 'S2', url: 'https://cobots.example/roi-calculator', query: 'q', retrievedAt: '2026-08-21' },
      { id: 'S3', url: 'https://cobots.example/blog/post', query: 'q', retrievedAt: '2026-08-21' },
    ];
    const prompt = finalReportPrompt('What changes?', evidence, registrySources);

    assert.match(prompt, /publisher="cdc\.gov" publisher_kind="government"/);
    assert.match(prompt, /promotional_page="true"/);
    assert.match(prompt, /same_publisher_as="S3"/);
    // Absence is unknown, not untrustworthy: no kind is asserted for a domain
    // the address cannot place.
    assert.doesNotMatch(prompt, /publisher_kind="unclassified"/);
  });

  it('explains the annotations rather than leaving them as decoration', () => {
    const prompt = finalReportPrompt('What changes?', evidence, sources);
    assert.match(prompt, /its absence means unknown, never untrustworthy/);
    assert.match(prompt, /the best source for that seller's own price/);
    assert.match(prompt, /those are one publisher, not several agreeing ones/);
    assert.match(prompt, /you have read the pages and they have not/);
  });

  it('still names which dollar, for a reader outside the United States', () => {
    const prompt = finalReportPrompt('What changes?', evidence, sources);
    assert.match(prompt, /USD 2\.6 trillion/);
    assert.match(prompt, /which a reader outside the United States needs/);
  });

  it('carries the three rules an unattributed figure breaks', () => {
    const standard = researchAnswerContractPrompt();
    assert.match(standard, /Name the publisher, not just the marker/);
    assert.match(standard, /Carry the scope a figure only holds inside/);
    assert.match(standard, /A projection is not a measurement/);
    assert.match(standard, /is a pointer, not an attribution/);
    assert.match(standard, /compensation range quoted without its country/);
    assert.match(standard, /never let a forecast inherit a measurement's grammar/);
  });

  it('binds the opening conclusion to the evidence beneath it', () => {
    // The error this catches, from a real run: the report opened with "roughly
    // 60% of first marriages survive for life" and then cited, correctly, a
    // finding that about half end within twenty years. Surviving for life
    // cannot be likelier than surviving twenty years, and the reader acts on
    // the first sentence.
    const prompt = finalReportPrompt('What changes?', evidence, sources);
    assert.match(prompt, /That opening conclusion is bound by the same evidence/);
    assert.match(prompt, /consistent with every figure below it/);
    assert.match(prompt, /correct the opening, not the evidence/);
  });

  it('refuses to lend a reputable name to a number it did not produce', () => {
    // The other real error: a discredited remarriage statistic, whose origin is
    // untraceable, carried into the report attached to a CDC citation.
    const standard = researchAnswerContractPrompt();
    assert.match(standard, /Repetition is not provenance/);
    assert.match(standard, /widely cited but untraceable/);
    assert.match(standard, /never attach it to a reputable name that merely repeated it/);
    assert.match(standard, /The summary may not outrun the body it summarizes/);
  });
});
