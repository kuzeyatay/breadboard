import { systemPromptRevision } from "../system-prompts/service.ts";
import 'server-only';
import db from '../db.ts';
import { getHermesUserSettings } from '../hermes/runtime-store.ts';
import { getRecallSettings } from '../recall/settings.ts';
import { ApiError } from '../hermes/route-core.ts';
import { readRecommendationEvidence } from './sources.ts';
import { generateRecommendations } from './generate.ts';
import { scopedRecommendationEvidence, selectRecommendations, RECOMMENDATION_TTL_MS, type Recommendation, type RecommendationContext, type RecommendationEvidence } from './types.ts';
import { recommendationClock } from './clock.ts';
import { usefulVoiceOpeners, type PreparedVoiceOpener } from './voice-opener.ts';

interface Entry<T> { expires: number; value: Promise<T> }
interface PreparedOpeners { policyKey: string; expiresAt: number; items: PreparedVoiceOpener[] }
interface RecommendationState {
  evidenceCache: Map<string, Entry<RecommendationEvidence[]>>;
  recommendationCache: Map<string, Entry<Recommendation[]>>;
  generations: Map<number, object>;
  /** The cards each reader currently has on screen, per surface. */
  recentlyShown: Map<string, Recommendation[]>;
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
  if(!preserveHistory) {
    for (const key of recentlyShown.keys()) if (key.startsWith(`${userId}:`)) recentlyShown.delete(key);
    try { shownStore()?.forget.run(userId); } catch { /* Store optional. */ }
  }
}

/**
 * The cards each reader has on screen, kept in the database too, so a server
 * restart does not reshuffle a board that was meant to stay put. Keyed like the
 * in-memory map, which includes the local date, so yesterday's board expires
 * on its own; rows older than two days are swept on write.
 */
let shownStatements: { read: { get: (...args: unknown[]) => unknown }; write: { run: (...args: unknown[]) => unknown };
  forget: { run: (...args: unknown[]) => unknown }; sweep: { run: (...args: unknown[]) => unknown } } | null | undefined;
function shownStore() {
  if (shownStatements !== undefined) return shownStatements;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS recommendation_shown_cards (
      user_id INTEGER NOT NULL, history_key TEXT NOT NULL, cards TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, history_key))`);
    // better-sqlite3 types prepare() as a union of Statement generics; only the call shapes matter here.
    shownStatements = ({
      read: db.prepare('SELECT cards FROM recommendation_shown_cards WHERE user_id = ? AND history_key = ?'),
      write: db.prepare(`INSERT INTO recommendation_shown_cards (user_id, history_key, cards) VALUES (?, ?, ?)
        ON CONFLICT (user_id, history_key) DO UPDATE SET cards = excluded.cards, updated_at = datetime('now')`),
      forget: db.prepare('DELETE FROM recommendation_shown_cards WHERE user_id = ?'),
      sweep: db.prepare("DELETE FROM recommendation_shown_cards WHERE updated_at < datetime('now', '-2 days')"),
    }) as unknown as NonNullable<typeof shownStatements>;
  } catch { shownStatements = null; }
  return shownStatements;
}

function shownCards(userId: number, historyKey: string): Recommendation[] {
  const memory = recentlyShown.get(historyKey);
  if (memory) return memory;
  try {
    const row = shownStore()?.read.get(userId, historyKey) as { cards: string } | undefined;
    const cards = row ? JSON.parse(row.cards) : [];
    return Array.isArray(cards) ? cards.filter(card => card && typeof card.prompt === 'string' && Array.isArray(card.sourceIds)) : [];
  } catch { return []; }
}

function rememberShown(userId: number, historyKey: string, cards: Recommendation[]) {
  recentlyShown.set(historyKey, cards);
  if (recentlyShown.size>40) recentlyShown.delete(recentlyShown.keys().next().value!);
  try {
    const store = shownStore();
    store?.write.run(userId, historyKey, JSON.stringify(cards.map(({ voice: _voice, ...card }) => card)));
    store?.sweep.run();
  } catch { /* A board that cannot be saved still works for this process. */ }
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
  if (!evidence.length) { voiceOpeners.delete(userId); return []; }
  const historyKey = `${userId}:${JSON.stringify([access.key,contextKey(context)])}`;
  const key = `${historyKey}:${JSON.stringify([access.model,options.baseUrl,Math.floor(Date.now()/RECOMMENDATION_TTL_MS),evidence])}`;
  const generate = () => cached(recommendationCache, key, () => generateRecommendations({ userId, evidence, context, model: access.model, baseUrl: options.baseUrl, shown:shownCards(userId, historyKey) }));
  const settle = (result: Recommendation[]) => {
    if (generations.get(userId) !== current || policy(userId).key !== access.key) return [];
    const expiresAt = recommendationCache.get(key)?.expires ?? Date.now();
    voiceOpeners.set(userId, { policyKey: access.key, expiresAt,
      items: usefulVoiceOpeners(result, evidence, context, expiresAt) });
    if (voiceOpeners.size > 40) voiceOpeners.delete(voiceOpeners.keys().next().value!);
    rememberShown(userId, historyKey, result);
    return result;
  };
  // The board is meant to stay put until a card stops applying or something
  // beats it. When the model has to be asked again (5-12 s), the cards already
  // on screen that still apply to today's evidence are returned at once and the
  // model's answer replaces them on the next read. An explicit refresh waits.
  const ready = recommendationCache.get(key);
  if (!options.refresh && !(ready && ready.expires > Date.now())) {
    const standing = selectRecommendations([], evidence, shownCards(userId, historyKey), context);
    if (standing.length) {
      void generate().then(settle, () => undefined);
      return standing;
    }
  }
  return settle(await generate());
}
