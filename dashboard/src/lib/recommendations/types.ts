import { parseVoiceOpener, type VoiceOpenerAssessment } from './voice-opener.ts';
import { recommendationCandidates, recommendationPriority, recommendationSubjects, usefulRecommendation } from './quality.ts';

export type RecommendationSource = 'gmail' | 'outlook' | 'calendar' | 'recall' | 'screen-time' | 'garden' | 'chat' | 'task'
  | 'memory' | 'schedule' | 'hook' | 'connection';

export interface RecommendationEvidence {
  id: string;
  source: RecommendationSource;
  title: string;
  summary: string;
  timestamp?: string;
  gardenSlug?: string;
  calendar?: {
    kind: 'event' | 'overlap' | 'gap';
    start: string;
    end: string;
    status?: 'upcoming' | 'ongoing' | 'recently-ended';
    allDay?: boolean;
  };
  /** Explicit topical matches, not an assumption that captured work is unfinished. */
  relatedIds?: string[];
}

export interface Recommendation {
  id: string;
  prompt: string;
  sourceLabel: string;
  sourceIds: string[];
  voice?: VoiceOpenerAssessment;
  /** 0-100ish; higher is more useful now. */
  score?: number;
  usefulness?: RecommendationUsefulness;
  /** Fingerprint of the evidence when the card was made; see recommendationBasis. */
  basis?: string;
}

export interface RecommendationContext {
  gardenSlug?: string;
  pageTitle?: string;
  localDate?: string;
  localTime?: string;
  timeZone?: string;
}

export const RECOMMENDATION_REFRESH_EVENT = 'breadboard:recommendations:refresh';
export const RECOMMENDATION_TTL_MS = 3 * 60_000;

/** Garden membership is an explicit boundary, never a title/keyword guess. */
export function scopedRecommendationEvidence(evidence: readonly RecommendationEvidence[], context: RecommendationContext): RecommendationEvidence[] {
  return evidence.filter(item => !context.gardenSlug || item.gardenSlug === context.gardenSlug);
}

/** Distinct prompts, at most four. Never padded: an empty slot stays empty. */
export function completeRecommendationPrompts(prompts: readonly string[]): string[] {
  return [...new Map(prompts.filter(prompt=>typeof prompt==='string'&&prompt.trim())
    .map(prompt=>[prompt.trim().toLocaleLowerCase(),prompt.trim()])).values()].slice(0,4);
}

export const SOURCE_LABELS: Record<RecommendationSource, string> = {
  gmail: 'Gmail', outlook: 'Outlook', calendar: 'Calendar', recall: 'Recall', 'screen-time': 'Screen Time',
  garden: 'Your garden', chat: 'Recent chat', task: 'Plan',
  memory: 'Memory', schedule: 'Scheduled', hook: 'Hooks', connection: 'Connected app',
};

export function cleanRecommendationText(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Suggestions may name only evidence the authenticated read actually found. */
export function parseRecommendations(value: unknown, evidence: readonly RecommendationEvidence[], limit = 4): Recommendation[] {
  if (!Array.isArray(value)) return [];
  const known = new Map(evidence.map(item => [item.id, item]));
  const seen = new Set<string>();
  return value.flatMap((item): Recommendation[] => {
    if (!item || typeof item !== 'object') return [];
    const { prompt, sourceIds } = item;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 240 || /[\r\n<>]/.test(prompt) ||
        !Array.isArray(sourceIds) || !sourceIds.length || sourceIds.length > 3 ||
        sourceIds.some(id => typeof id !== 'string' || !known.has(id))) return [];
    const text = prompt.trim();
    if (seen.has(text.toLowerCase())) return [];
    seen.add(text.toLowerCase());
    const voice = parseVoiceOpener(item.voice);
    return [{ id: sourceIds.join('|'), prompt: text, sourceIds, ...(voice ? { voice } : {}),
      sourceLabel: [...new Set(sourceIds.map(id => { const item = known.get(id)!; return item.source === 'connection' ? item.title : SOURCE_LABELS[item.source]; }))].join(' · ') }];
  }).slice(0, limit);
}

export type RecommendationUsefulness = 'urgent' | 'timely' | 'helpful';

/** How much more useful a new card must be before it displaces one on screen. */
export const RECOMMENDATION_REPLACE_MARGIN = 15;

/** urgent: something broke or is about to happen; timely: tied to now; helpful: grounded, no clock. */
export function recommendationUsefulness(score: number): RecommendationUsefulness {
  return score >= 75 ? 'urgent' : score >= 50 ? 'timely' : 'helpful';
}

/**
 * The evidence a card was built from, as it read then. A card whose basis has
 * changed — the event has since ended, the task was edited, the failing
 * schedule ran again — no longer says the right thing, so it gives up its slot.
 */
export function recommendationBasis(card: Pick<Recommendation, 'sourceIds'>, known: ReadonlyMap<string, RecommendationEvidence>): string | null {
  const sources = card.sourceIds.map(id => known.get(id));
  if (!sources.length || sources.some(item => !item)) return null;
  return JSON.stringify(sources.map(item => [item!.id, item!.title, item!.calendar?.kind, item!.calendar?.status,
    item!.source === 'task' || item!.source === 'schedule' || item!.source === 'hook' ? item!.summary : '']));
}

interface ScoredRecommendation { item: Recommendation; family: string; score: number; subjects: string[] }

function scoreRecommendation(item: Recommendation, known: ReadonlyMap<string, RecommendationEvidence>, context: RecommendationContext): ScoredRecommendation {
  const sources = item.sourceIds.map(id => known.get(id)!).sort((a, b) => recommendationPriority(b, context) - recommendationPriority(a, context));
  const source = sources[0];
  const family = source.source === 'outlook' ? 'gmail' : source.source === 'calendar' ? (source.calendar?.kind ?? 'event') : source.source;
  return { item, family, score: recommendationPriority(source, context) + (sources.length > 1 ? 12 : 0), subjects: recommendationSubjects(item, known) };
}

/**
 * At most four cards, and cards stay put. A card already on screen keeps its
 * slot and its wording while its evidence still reads the same and it still
 * passes the usefulness gate; free slots take the most useful new cards; and a
 * kept card is displaced only by one that is clearly more useful. Nothing
 * generic is ever added to make up the count.
 */
export function selectRecommendations(candidates: readonly Recommendation[], evidence: readonly RecommendationEvidence[], shown: readonly Recommendation[] = [], context: RecommendationContext = {}): Recommendation[] {
  evidence = scopedRecommendationEvidence(evidence, context);
  const known = new Map(evidence.map(item => [item.id, item]));
  const applies = (item: Recommendation) => item.sourceIds.length > 0 && item.sourceIds.every(id => known.has(id)) && usefulRecommendation(item, evidence);
  const overlaps = (item: ScoredRecommendation, slots: readonly ScoredRecommendation[]) =>
    slots.some(slot => slot.item.prompt.toLowerCase() === item.item.prompt.toLowerCase() || slot.subjects.some(id => item.subjects.includes(id)));
  const penalty = (item: ScoredRecommendation, slots: readonly ScoredRecommendation[]) =>
    item.score - slots.filter(slot => slot.family === item.family).length * 20;

  const slots: ScoredRecommendation[] = [];
  for (const card of shown) {
    if (slots.length >= 4 || !card.basis || !applies(card) || recommendationBasis(card, known) !== card.basis) continue;
    const kept = scoreRecommendation(card, known, context);
    if (!overlaps(kept, slots)) slots.push(kept);
  }
  const pool = candidates.filter(applies).map(item => scoreRecommendation(item, known, context));
  const best = (others: readonly ScoredRecommendation[]) => pool.filter(item => !overlaps(item, others))
    .map((item, index) => ({ item, index, adjusted: penalty(item, others) }))
    .sort((a, b) => b.adjusted - a.adjusted || a.index - b.index)[0];

  while (slots.length < 4) {
    const next = best(slots);
    if (!next) break;
    slots.push(next.item);
  }
  for (let round = 0; round < 4 && slots.length; round++) {
    const weakest = slots.reduce((low, slot, index) => slot.score < slots[low].score ? index : low, 0);
    const others = slots.filter((_, index) => index !== weakest);
    const challenger = best(others);
    if (!challenger || challenger.adjusted - slots[weakest].score < RECOMMENDATION_REPLACE_MARGIN) break;
    slots[weakest] = challenger.item;
  }
  return slots.map(slot => ({ ...slot.item, score: slot.score, usefulness: recommendationUsefulness(slot.score),
    basis: recommendationBasis(slot.item, known) ?? undefined }));
}

/** Model-independent actions grounded in the actual schedule and recent work. */
export function evidenceRecommendations(evidence: readonly RecommendationEvidence[], shown: readonly Recommendation[] = [], context:RecommendationContext={}): Recommendation[] {
  evidence = scopedRecommendationEvidence(evidence, context);
  const candidates=evidence.flatMap(item=>recommendationCandidates(item,evidence,context));
  return selectRecommendations(parseRecommendations(candidates,evidence,candidates.length),evidence,shown,context);
}
