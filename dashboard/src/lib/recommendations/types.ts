import { parseVoiceOpener, type VoiceOpenerAssessment } from './voice-opener.ts';
import { recommendationCandidates, recommendationPriority, recommendationSubjects, usefulRecommendation } from './quality.ts';

export type RecommendationSource = 'gmail' | 'outlook' | 'calendar' | 'recall' | 'screen-time' | 'garden' | 'chat' | 'task';

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

export const FALLBACK_RECOMMENDATION_PROMPTS = [
  'Help me turn a rough idea into a clear plan.',
  'Explain something I’m stuck on with a worked example.',
  'Review a draft and point out what I could improve.',
  'Help me compare options for a decision I’m making.',
] as const;

export const GARDEN_FALLBACK_RECOMMENDATION_PROMPTS = [
  'Explain a difficult idea from this garden with a worked example.',
  'Quiz me on the key ideas in this garden, one question at a time.',
  'Find connections between the notes in this garden.',
  'Help me identify gaps in this garden and choose what to study next.',
] as const;

/** Garden membership is an explicit boundary, never a title/keyword guess. */
export function scopedRecommendationEvidence(evidence: readonly RecommendationEvidence[], context: RecommendationContext): RecommendationEvidence[] {
  return evidence.filter(item => !context.gardenSlug || item.gardenSlug === context.gardenSlug);
}

/** Fill only missing slots, after useful, grounded candidates have been chosen. */
export function completeRecommendationPrompts(prompts: readonly string[], fallbacks: readonly string[] = [], context: RecommendationContext = {}): string[] {
  const defaults = context.gardenSlug ? GARDEN_FALLBACK_RECOMMENDATION_PROMPTS : FALLBACK_RECOMMENDATION_PROMPTS;
  return [...new Map([...prompts,...fallbacks,...defaults]
    .filter(prompt=>typeof prompt==='string'&&prompt.trim()).map(prompt=>[prompt.trim().toLocaleLowerCase(),prompt.trim()])).values()].slice(0,4);
}

export function completeRecommendations(cards: readonly Recommendation[], context: RecommendationContext = {}): Recommendation[] {
  const byPrompt=new Map(cards.map(card=>[card.prompt,card]));
  return completeRecommendationPrompts(cards.map(card=>card.prompt), [], context).map((prompt,index)=>byPrompt.get(prompt)??{
    id:`fallback:${index}`,prompt,sourceIds:[],sourceLabel:'Ideas',
  });
}

export const SOURCE_LABELS: Record<RecommendationSource, string> = {
  gmail: 'Gmail', outlook: 'Outlook', calendar: 'Calendar', recall: 'Recall', 'screen-time': 'Screen Time',
  garden: 'Your garden', chat: 'Recent chat', task: 'Plan',
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
      sourceLabel: [...new Set(sourceIds.map(id => SOURCE_LABELS[known.get(id)!.source]))].join(' · ') }];
  }).slice(0, limit);
}

/** Prefer fresh actions and different subjects; keep a useful card when there
 * simply is not enough evidence for four new ones. */
export function selectRecommendations(candidates: readonly Recommendation[], evidence: readonly RecommendationEvidence[], previousPrompts: readonly string[] = [], context:RecommendationContext={}): Recommendation[] {
  evidence = scopedRecommendationEvidence(evidence, context);
  const previous=new Set(previousPrompts.map(prompt=>prompt.toLowerCase()));
  const known=new Map(evidence.map(item=>[item.id,item]));
  const picked: Recommendation[]=[];
  const subjects=new Set<string>(),families=new Map<string,number>();
  const eligible=candidates.filter(item=>item.sourceIds.every(id=>known.has(id)) && usefulRecommendation(item,evidence));
  while(picked.length<4) {
    const ranked=eligible.filter(item=>!recommendationSubjects(item,known).some(id=>subjects.has(id))).map((item,index)=>{
      const sources=item.sourceIds.map(id=>known.get(id)!).filter(Boolean).sort((a,b)=>recommendationPriority(b,context)-recommendationPriority(a,context));
      const source=sources[0],family=source.source==='outlook'?'gmail':source.source==='calendar'?(source.calendar?.kind??'event'):source.source;
      return {item,family,index,score:recommendationPriority(source,context)+(sources.length>1?12:0)
        +(previous.has(item.prompt.toLowerCase())?0:18)-(families.get(family)??0)*20};
    }).sort((a,b)=>b.score-a.score||a.index-b.index);
    if(!ranked.length)break;
    const {item,family}=ranked[0];picked.push(item);
    recommendationSubjects(item,known).forEach(id=>subjects.add(id));families.set(family,(families.get(family)??0)+1);
  }
  return picked;
}

/** Model-independent actions grounded in the actual schedule and recent work. */
export function evidenceRecommendations(evidence: readonly RecommendationEvidence[], previousPrompts: readonly string[] = [], context:RecommendationContext={}): Recommendation[] {
  evidence = scopedRecommendationEvidence(evidence, context);
  const candidates=evidence.flatMap(item=>recommendationCandidates(item,evidence,context));
  return selectRecommendations(parseRecommendations(candidates,evidence,candidates.length),evidence,previousPrompts,context);
}
