import 'server-only';
import db from '../db.ts';
import { getHermesUserSettings } from '../hermes/runtime-store.ts';
import { getRecallSettings } from '../recall/settings.ts';
import { ApiError } from '../hermes/route-core.ts';
import { readRecommendationEvidence } from './sources.ts';
import { generateRecommendations } from './generate.ts';
import { RECOMMENDATION_TTL_MS, type Recommendation, type RecommendationContext, type RecommendationEvidence } from './types.ts';

interface Entry<T> { expires: number; value: Promise<T> }
const evidenceCache = new Map<string, Entry<RecommendationEvidence[]>>();
const recommendationCache = new Map<string, Entry<Recommendation[]>>();
const generations = new Map<number, object>();

function generation(userId: number): object {
  let current = generations.get(userId);
  if (!current) { current = {}; generations.set(userId, current); }
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
    key: JSON.stringify([settings.composerSwitches.personalize, recall]) };
}

export function invalidateRecommendations(userId: number) {
  generations.set(userId, {});
  for (const cache of [evidenceCache, recommendationCache]) {
    for (const key of cache.keys()) if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}

export async function recommendationEvidence(userId: number, context: RecommendationContext, refresh = false) {
  const access = policy(userId);
  if (!access.enabled) return [];
  if (context.gardenSlug && !db.prepare('SELECT 1 FROM clusters WHERE slug=? AND user_id=?').get(context.gardenSlug, userId)) {
    throw new ApiError(403, 'garden_access_denied', 'This garden is not available.');
  }
  if (refresh) invalidateRecommendations(userId);
  const current = generation(userId);
  const key = `${userId}:${JSON.stringify([access.key, context])}`;
  const evidence = await cached(evidenceCache, key, () => readRecommendationEvidence(userId, context));
  // A settings change during a provider read takes effect before anything is shown.
  return generation(userId) === current && policy(userId).key === access.key ? evidence : [];
}

export async function recommendationsForUser(userId: number, context: RecommendationContext, options: { baseUrl?: string; refresh?: boolean } = {}) {
  if (options.refresh) invalidateRecommendations(userId);
  const current = generation(userId);
  const access = policy(userId);
  if (!access.enabled) return [];
  const evidence = await recommendationEvidence(userId, context);
  if (!evidence.length) return [];
  const key = `${userId}:${JSON.stringify([access.key, access.model, options.baseUrl, context, evidence])}`;
  const result = await cached(recommendationCache, key, () => generateRecommendations({ evidence, context, model: access.model, baseUrl: options.baseUrl }));
  return generation(userId) === current && policy(userId).key === access.key ? result : [];
}
