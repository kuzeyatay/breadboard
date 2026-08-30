// What can honestly be said about a source from its URL alone.
//
// The engine registers sources and cites them, and until now that was the whole
// of its source model: every registered page counted the same. That is how a
// discredited statistic with no traceable origin reached a report wearing a
// reputable institution's citation, and how four references to one publisher
// read as four agreeing sources.
//
// This module does not score sources and does not rerank them. A URL supports a
// small number of claims and no more, so it produces exactly those: who
// published it, whether the domain is one whose class is knowable, and whether
// the page's shape is promotional. The weighing stays with the model, which has
// read the page; what it lacked was the signal.
//
// Deliberately conservative. `unclassified` is the right answer for most of the
// web, and inventing a class for a domain nobody can place would be worse than
// saying nothing — a confident label on a guess is the failure this exists to
// prevent, not a smaller version of it.

import type { ResearchSource } from './research-types';

export type SourceKind =
  /** A state or public-sector body: `.gov`, `.gov.uk`, `.europa.eu`. */
  | 'government'
  /** A university or the scholarly record: `.edu`, `.ac.*`, DOI, arXiv, PubMed. */
  | 'academic'
  /** A treaty organisation or official statistics body: `.int`, WHO, OECD, UN. */
  | 'intergovernmental'
  /** Everything else. Not a judgement — the domain simply does not say. */
  | 'unclassified';

export interface SourceAnnotation {
  /** The host, without `www.`, as a name a sentence can use. */
  publisher: string;
  kind: SourceKind;
  /**
   * The page's path reads as promotional: a pricing page, an ROI calculator, a
   * vendor-hosted buyer's guide.
   *
   * Advisory and often wrong in both directions. It says "read this as the
   * seller's own material" — which makes it the best source for that seller's
   * price and a weak one for the market's.
   */
  promotional: boolean;
  /** Other registered source ids published by this same host. */
  samePublisherAs: string[];
}

const GOVERNMENT = /(?:^|\.)gov(?:\.[a-z]{2})?$|(?:^|\.)gouv\.fr$|(?:^|\.)europa\.eu$|(?:^|\.)gc\.ca$|(?:^|\.)overheid\.nl$/i;
const ACADEMIC =
  /(?:^|\.)edu(?:\.[a-z]{2})?$|(?:^|\.)ac\.[a-z]{2}$|(?:^|\.)arxiv\.org$|(?:^|\.)doi\.org$|(?:^|\.)ncbi\.nlm\.nih\.gov$|(?:^|\.)pubmed\.gov$|(?:^|\.)jstor\.org$|(?:^|\.)ssrn\.com$/i;
const INTERGOVERNMENTAL =
  /(?:^|\.)int$|(?:^|\.)un\.org$|(?:^|\.)who\.int$|(?:^|\.)oecd\.org$|(?:^|\.)worldbank\.org$|(?:^|\.)imf\.org$|(?:^|\.)iso\.org$/i;

/**
 * Path shapes a seller uses to sell.
 *
 * Matched on the path rather than the host on purpose: a company's engineering
 * post and its pricing page are the same publisher and not the same kind of
 * evidence, and the host cannot tell them apart.
 */
const PROMOTIONAL_PATH =
  /\/(?:pricing|buy|shop|store|product|products|solutions?|offers?|deals?|quote|roi[-_]?calculator|cost[-_]?calculator|savings[-_]?calculator|buyers?[-_]?guide|case[-_]?stud(?:y|ies)|customer[-_]?stor(?:y|ies)|testimonials?|why[-_]choose|request[-_]a[-_]demo|free[-_]trial)(?:\/|$|\?)/i;

/** The host, without `www.`, or an empty string when the URL will not parse. */
export function publisherOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function sourceKindOf(url: string): SourceKind {
  const host = publisherOf(url);
  if (!host) return 'unclassified';
  if (GOVERNMENT.test(host)) return 'government';
  if (ACADEMIC.test(host)) return 'academic';
  if (INTERGOVERNMENTAL.test(host)) return 'intergovernmental';
  return 'unclassified';
}

export function isPromotional(url: string): boolean {
  // A public body's fee schedule is not marketing, and neither is a university
  // shop. The shape only means what it means on a commercial page.
  if (sourceKindOf(url) !== 'unclassified') return false;
  try {
    return PROMOTIONAL_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Annotate a registered source set.
 *
 * The one thing here that no single URL can answer is independence: three pages
 * of one site restating a figure is one source, and counting it as three is the
 * arithmetic that makes a press release look like a consensus. That needs the
 * whole set, which is why it is computed here rather than per source.
 */
export function annotateSources(
  sources: readonly ResearchSource[],
): Map<string, SourceAnnotation> {
  const idsByPublisher = new Map<string, string[]>();
  for (const source of sources) {
    const publisher = publisherOf(source.url);
    if (!publisher) continue;
    idsByPublisher.set(publisher, [
      ...(idsByPublisher.get(publisher) ?? []),
      source.id,
    ]);
  }

  const annotations = new Map<string, SourceAnnotation>();
  for (const source of sources) {
    const publisher = publisherOf(source.url);
    annotations.set(source.id, {
      publisher,
      kind: sourceKindOf(source.url),
      promotional: isPromotional(source.url),
      samePublisherAs: (idsByPublisher.get(publisher) ?? []).filter(
        id => id !== source.id,
      ),
    });
  }
  return annotations;
}

/** How many distinct publishers stand behind a set of sources. */
export function independentPublisherCount(
  sources: readonly ResearchSource[],
): number {
  return new Set(
    sources.map(source => publisherOf(source.url)).filter(Boolean),
  ).size;
}
