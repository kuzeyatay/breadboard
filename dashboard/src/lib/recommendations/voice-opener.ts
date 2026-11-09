import { parseStamp, toEpochMinutes } from '../calendar/wallclock.ts';
import { recommendationClock } from './clock.ts';
import type { Recommendation, RecommendationContext, RecommendationEvidence } from './types.ts';

/** Assessed alongside the terminal cards, never by a model on voice startup. */
export interface VoiceOpenerAssessment {
  text: string;
  reason: string;
  relevance: number;
  timeliness: number;
  actionability: number;
  confidence: number;
}

export interface PreparedVoiceOpener {
  id: string;
  text: string;
  prompt: string;
  sourceIds: string[];
  score: number;
  reason: string;
  expiresAt: number;
}

export function parseVoiceOpener(value: unknown): VoiceOpenerAssessment | undefined {
  if (!value || typeof value !== 'object') return;
  const row = value as Record<string, unknown>;
  if (typeof row.text !== 'string' || typeof row.reason !== 'string') return;
  const text = row.text.trim(), reason = row.reason.trim();
  // An invitation, not an unsolicited answer, action, or reading of a card.
  if (!text || text.length > 180 || text.split(/\s+/).length > 32 ||
      !/[?？]$/.test(text) || /[\r\n<>`]|https?:\/\//i.test(text) ||
      !reason || reason.length > 180 || /[\r\n<>]/.test(reason)) return;
  const scores = ['relevance', 'timeliness', 'actionability', 'confidence'] as const;
  if (scores.some(key => !Number.isInteger(row[key]) || Number(row[key]) < 0 || Number(row[key]) > 2)) return;
  return { text, reason, relevance: Number(row.relevance), timeliness: Number(row.timeliness),
    actionability: Number(row.actionability), confidence: Number(row.confidence) };
}

function stampMinutes(stamp: string): number {
  const parsed = parseStamp(stamp);
  return parsed ? toEpochMinutes(parsed) : NaN;
}

function sourceLifetime(item: RecommendationEvidence, context: RecommendationContext, now: number): number {
  const hour = 3_600_000;
  if (item.source === 'calendar') {
    const calendar = item.calendar;
    if (!calendar) return 0;
    const clock = recommendationClock(context, new Date(now));
    const minute = stampMinutes(`${clock.localDate}T${clock.localTime}`);
    const start = stampMinutes(calendar.start), end = stampMinutes(calendar.end);
    if (!Number.isFinite(minute) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    if (calendar.status === 'recently-ended') {
      return minute >= end ? (end + 120 - minute) * 60_000 - new Date(now).getSeconds() * 1000 : 0;
    }
    // Do not repeat a preparation invitation after its appointment has begun,
    // or a gap/overlap invitation after it is over.
    const boundary = calendar.status === 'upcoming' ? start : end;
    if (start - minute > 24 * 60) return 0;
    return (boundary - minute) * 60_000 - new Date(now).getSeconds() * 1000;
  }
  // This source query includes only incomplete tasks. The shared cache adds
  // its own three-minute limit and is invalidated when Plan changes.
  if (item.source === 'task') return Infinity;
  if (item.source === 'garden') return context.gardenSlug === item.gardenSlug ? Infinity : 0;
  if (!item.timestamp) return 0;
  const stamp = item.timestamp.replace(' ', 'T');
  const timestamp = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(stamp) ? stamp : `${stamp}Z`);
  const age = now - timestamp;
  const lifetime = item.source === 'gmail' || item.source === 'outlook' ? 7 * 24 * hour : 48 * hour;
  return Number.isFinite(timestamp) && age >= -5 * 60_000 ? lifetime - age : 0;
}

/** Rank only the four cards actually returned to the terminal. No qualifying
 * card is a normal outcome; a weak card must not become a forced greeting. */
export function usefulVoiceOpeners(cards: readonly Recommendation[], evidence: readonly RecommendationEvidence[],
  context: RecommendationContext, expiresAt: number, now = Date.now()): PreparedVoiceOpener[] {
  const known = new Map(evidence.map(item => [item.id, item]));
  return cards.slice(0, 4).flatMap((card): PreparedVoiceOpener[] => {
    const voice = parseVoiceOpener(card.voice);
    if (!voice || voice.confidence !== 2 || voice.actionability !== 2 || voice.relevance < 1 || voice.timeliness < 1) return [];
    const score = voice.relevance + voice.timeliness + voice.actionability + voice.confidence;
    if (score < 7 || !card.sourceIds.length || card.sourceIds.some(id => !known.has(id))) return [];
    const sources = card.sourceIds.map(id => known.get(id)!);
    if (context.gardenSlug && !sources.some(item => item.gardenSlug === context.gardenSlug)) return [];
    const until = Math.min(expiresAt, ...sources.map(item => now + sourceLifetime(item, context, now)));
    if (until <= now) return [];
    return [{ id: card.id, text: voice.text, prompt: card.prompt, sourceIds: [...card.sourceIds], score, reason: voice.reason, expiresAt: until }];
  }).sort((a, b) => b.score - a.score);
}
