export type RecommendationSource = 'gmail' | 'outlook' | 'calendar' | 'recall' | 'garden' | 'chat' | 'task';

export interface RecommendationEvidence {
  id: string;
  source: RecommendationSource;
  title: string;
  summary: string;
  timestamp?: string;
  gardenSlug?: string;
}

export interface Recommendation {
  id: string;
  prompt: string;
  sourceLabel: string;
  sourceIds: string[];
}

export interface RecommendationContext {
  gardenSlug?: string;
  pageTitle?: string;
  localDate?: string;
}

export const RECOMMENDATION_REFRESH_EVENT = 'breadboard:recommendations:refresh';
export const RECOMMENDATION_TTL_MS = 5 * 60_000;

export const SOURCE_LABELS: Record<RecommendationSource, string> = {
  gmail: 'Gmail', outlook: 'Outlook', calendar: 'Calendar', recall: 'Recall',
  garden: 'Your garden', chat: 'Recent chat', task: 'Plan',
};

export function cleanRecommendationText(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Suggestions may name only evidence the authenticated read actually found. */
export function parseRecommendations(value: unknown, evidence: readonly RecommendationEvidence[]): Recommendation[] {
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
    return [{ id: sourceIds.join('|'), prompt: text, sourceIds,
      sourceLabel: [...new Set(sourceIds.map(id => SOURCE_LABELS[known.get(id)!.source]))].join(' · ') }];
  }).slice(0, 4);
}

/** Still useful when the model is unavailable: every fallback names real work. */
export function evidenceRecommendations(evidence: readonly RecommendationEvidence[]): Recommendation[] {
  const used = new Set<string>();
  const ranked = [...evidence].sort((a, b) => {
    const priority = { calendar: 0, task: 1, gmail: 2, outlook: 2, recall: 3, chat: 4, garden: 5 };
    return priority[a.source] - priority[b.source];
  });
  const diverse = ranked.filter(item => {
    const family = item.source === 'outlook' ? 'gmail' : item.source;
    if (used.has(family)) return false;
    used.add(family); return true;
  });
  return parseRecommendations([...diverse, ...ranked].map(item => {
    const title = cleanRecommendationText(item.title, 110);
    const prompt = item.source === 'calendar' ? `Help me prepare for “${title}”.` :
      item.source === 'gmail' || item.source === 'outlook' ? `Summarize the email “${title}” and help me decide what to do next.` :
      item.source === 'recall' ? `Use Recall to help me pick up where I left off with “${title}”.` :
      item.source === 'task' ? `Help me make progress on “${title}”.` :
      item.source === 'chat' ? `Help me continue my recent chat about “${title}”.` :
      `Help me review “${title}” in my garden.`;
    return { prompt, sourceIds: [item.id] };
  }), evidence);
}
