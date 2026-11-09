import { systemPromptRevision } from "../system-prompts/service.ts";
import 'server-only';
import db from '../db.ts';
import { getHermesUserSettings } from '../hermes/runtime-store.ts';
import { getRecallSettings } from '../recall/settings.ts';
import { ApiError } from '../hermes/route-core.ts';
import { readRecommendationEvidence } from './sources.ts';
import { generateRecommendations } from './generate.ts';
import { completeRecommendations, scopedRecommendationEvidence, RECOMMENDATION_TTL_MS, type Recommendation, type RecommendationContext, type RecommendationEvidence } from './types.ts';
import { recommendationClock } from './clock.ts';
import { usefulVoiceOpeners, type PreparedVoiceOpener } from './voice-opener.ts';

interface Entry<T> { expires: number; value: Promise<T> }
interface PreparedOpeners { policyKey: string; expiresAt: number; items: PreparedVoiceOpener[] }
interface RecommendationState {
  evidenceCache: Map<string, Entry<RecommendationEvidence[]>>;
  recommendationCache: Map<string, Entry<Recommendation[]>>;
  generations: Map<number, object>;
  recentlyShown: Map<string, string[]>;
  voiceOpeners: Map<number, PreparedOpeners>;
}
// Route importers may be bundled separately. Share the invalidation identities
// and their bounded caches together, so one importer cannot republish another
// importer's invalidated task or personal invitation from an in-flight read.
const cacheGlobal = globalThis as typeof globalThis & { breadboardRecommendationsV1?: RecommendationState };
const sharedState: RecommendationState = cacheGlobal.breadboardRecommendationsV1 ??= {
    evidenceCache: new Map(), recommendationCache: new Map(), generations: new Map(),
    recentlyShown: new Map(), voiceOpeners: new Map(),
  };
const { evidenceCache, recommendationCache, generations, recentlyShown, voiceOpeners } = sharedState;

function contextKey(context: RecommendationContext) {
  return ['garden-scope-v2',context.gardenSlug,context.pageTitle,context.localDate,context.timeZone];
}

function generation(userId: number): object {
  let current = generations.get(userId);
  if (!current) {
    current = {}; generations.set(userId, current);
    if (generations.size > 40) invalidateRecommendations(generations.keys().next().value!);
  }
  return current;
}

function cached<T>(cache: Map<string, Entry<T>>, key: string, read: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.value;
  const next = { expires: Date.now() + RECOMMENDATION_TTL_MS, value: read() };
  cache.set(key, next);
  if (cache.size > 40) cache.delete(cache.keys().next().value!);
  next.value.catch(() => { if (cache.get(key) === next) cache.delete(key); });
  return next.value;
}

function policy(userId: number) {
  const settings = getHermesUserSettings(userId);
  const recall = getRecallSettings(userId);
  return { enabled: settings.composerSwitches.personalize !== false, model: settings.defaultModel,
    key: JSON.stringify([settings.composerSwitches.personalize, recall, systemPromptRevision("personal-recommendations", userId)]) };
}

export function invalidateRecommendations(userId: number, {preserveHistory=false}: {preserveHistory?:boolean} = {}) {
  voiceOpeners.delete(userId);
  generations.delete(userId);
  for (const cache of [evidenceCache, recommendationCache]) {
    for (const key of cache.keys()) if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
  if(!preserveHistory) for (const key of recentlyShown.keys()) if (key.startsWith(`${userId}:`)) recentlyShown.delete(key);
}

/** Cached-only read: no model, connected source, or pending generation is
 * started or awaited while voice opens. Recheck personalization and Recall. */
export function preparedVoiceOpenersForUser(userId: number): PreparedVoiceOpener[] {
  const entry = voiceOpeners.get(userId);
  const access = policy(userId);
  const now = Date.now();
  if (!entry || !access.enabled || entry.policyKey !== access.key || entry.expiresAt <= now) {
    voiceOpeners.delete(userId);
    return [];
  }
  return entry.items.filter(item => item.expiresAt > now);
}

export async function recommendationEvidence(userId: number, context: RecommendationContext, refresh = false) {
  context = recommendationClock(context);
  const access = policy(userId);
  if (!access.enabled) return [];
  if (context.gardenSlug && !db.prepare('SELECT 1 FROM clusters WHERE slug=? AND user_id=?').get(context.gardenSlug, userId)) {
    throw new ApiError(403, 'garden_access_denied', 'This garden is not available.');
  }
  if (refresh) invalidateRecommendations(userId,{preserveHistory:true});
  const current = generation(userId);
  const key = `${userId}:${JSON.stringify([access.key, contextKey(context), Math.floor(Date.now()/RECOMMENDATION_TTL_MS)])}`;
  const evidence = await cached(evidenceCache, key, () => readRecommendationEvidence(userId, context));
  // A settings change during a provider read takes effect before anything is shown.
  return generations.get(userId) === current && policy(userId).key === access.key ? scopedRecommendationEvidence(evidence, context) : [];
}

export async function recommendationsForUser(userId: number, context: RecommendationContext, options: { baseUrl?: string; refresh?: boolean } = {}) {
  context = recommendationClock(context);
  if (options.refresh) invalidateRecommendations(userId,{preserveHistory:true});
  const current = generation(userId);
  const access = policy(userId);
  if (!access.enabled) return [];
  const evidence = await recommendationEvidence(userId, context);
  if (generations.get(userId) !== current || policy(userId).key !== access.key) return [];
  if (!evidence.length) { voiceOpeners.delete(userId); return completeRecommendations([], context); }
  const historyKey = `${userId}:${JSON.stringify([access.key,contextKey(context)])}`;
  const key = `${historyKey}:${JSON.stringify([access.model,options.baseUrl,Math.floor(Date.now()/RECOMMENDATION_TTL_MS),evidence])}`;
  const result = await cached(recommendationCache, key, () => generateRecommendations({ userId, evidence, context, model: access.model, baseUrl: options.baseUrl, previousPrompts:recentlyShown.get(historyKey) ?? [] }));
  if (generations.get(userId) !== current || policy(userId).key !== access.key) return [];
  const expiresAt = recommendationCache.get(key)?.expires ?? Date.now();
  voiceOpeners.set(userId, { policyKey: access.key, expiresAt,
    items: usefulVoiceOpeners(result, evidence, context, expiresAt) });
  if (voiceOpeners.size > 40) voiceOpeners.delete(voiceOpeners.keys().next().value!);
  if (result.length) {
    recentlyShown.set(historyKey,[...new Set([...(recentlyShown.get(historyKey) ?? []),...result.map(item=>item.prompt)])].slice(-8));
    if (recentlyShown.size>40) recentlyShown.delete(recentlyShown.keys().next().value!);
  }
  return result;
}
