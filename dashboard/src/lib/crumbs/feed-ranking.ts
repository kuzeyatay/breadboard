import type Database from "better-sqlite3";
import { looksPrivatePage } from "../browser-annotations.ts";
import type { CrumbsFeedItem } from "./core.ts";
import { ensureCrumbsSchema } from "./store.ts";

const DAY = 86_400_000;
const weights = { read: 0.45, linger: 0.75, open: 1, source: 2.5, comment: 4, more: 6, less: -6 } as const;
export type FeedAction = keyof typeof weights;
export type FeedInteraction = Exclude<FeedAction, "comment">;
export const isFeedInteraction = (value: unknown): value is FeedInteraction =>
  typeof value === "string" && value !== "comment" && Object.hasOwn(weights, value);
export interface InterestSource { title: string; url?: string; at: number; weight: number }
interface Feedback { subject: string; kind: FeedAction; features: string; observed: number }
type Profile = Map<string, number>;
const stop = new Set("about after again also been being could from have here into just more most only other over some than that their them then there these they this those through very what when where which while will with would your page home news article untitled breadboard".split(" "));
const age = (at: number, now: number) => Math.max(0, (now - at) / DAY);
const decay = (days: number) => 0.55 * 2 ** (-days / 5) + 0.45 * 2 ** (-days / 30);

function features(title: string, url = "", text = "", author = "") {
  const keys = new Set<string>();
  if (author) keys.add("author:" + author);
  if (url) {
    try { keys.add("site:" + new URL(url).hostname.replace(/^www\./, "")); } catch { /* Title-only evidence. */ }
  }
  for (const word of (title + " " + text).slice(0, 1600).normalize("NFKC").toLowerCase().match(/[\p{L}][\p{L}\p{N}-]{2,28}/gu) ?? []) {
    if (!stop.has(word)) keys.add("word:" + word);
    if (keys.size >= 40) break;
  }
  return [...keys];
}
const itemFeatures = (item: CrumbsFeedItem) => features(item.title, item.target.url, (item.target.quote ?? "").slice(0, 500) + " " + item.comment, item.author.did);

export function feedEnabled(db: Database.Database, user: number) {
  ensureCrumbsSchema(db);
  return db.prepare("SELECT enabled FROM crumbs_feed_preferences WHERE user_id=?").pluck().get(user) !== 0;
}

export function setFeedEnabled(db: Database.Database, user: number, enabled: boolean) {
  ensureCrumbsSchema(db);
  db.transaction(() => {
    db.prepare("INSERT INTO crumbs_feed_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled").run(user, Number(enabled));
    if (!enabled) db.prepare("DELETE FROM crumbs_feed_feedback WHERE user_id=?").run(user);
  })();
}

export function recordFeedAction(db: Database.Database, user: number, event: {
  id: string; kind: FeedAction; title: string; url: string; text: string; author: string;
}, now = Date.now()) {
  if (!Object.hasOwn(weights, event.kind) || looksPrivatePage(event.url)) return;
  ensureCrumbsSchema(db);
  db.transaction(() => {
    if (!feedEnabled(db, user)) return;
    const keys = features(event.title, event.url, event.text, event.author);
    if (event.kind === "more" || event.kind === "less") {
      db.prepare("DELETE FROM crumbs_feed_feedback WHERE user_id=? AND subject=? AND kind=?").run(user, event.id, event.kind === "more" ? "less" : "more");
    }
    db.prepare(`INSERT INTO crumbs_feed_feedback VALUES(?,?,?,?,?)
      ON CONFLICT(user_id, subject, kind) DO UPDATE SET observed=excluded.observed, features=excluded.features`)
      .run(user, event.id, event.kind, JSON.stringify(keys), now);
    db.prepare(`DELETE FROM crumbs_feed_feedback WHERE user_id=? AND (observed<? OR rowid IN (
      SELECT rowid FROM crumbs_feed_feedback WHERE user_id=? ORDER BY observed DESC, rowid DESC LIMIT -1 OFFSET 512))`)
      .run(user, now - 90 * DAY, user);
  }).immediate();
}

function learn(profile: Profile, keys: string[], weight: number) {
  for (const key of keys) profile.set(key, (profile.get(key) ?? 0) + weight);
}

// One sparse logistic update per interaction, replayed oldest first. An unexpected choice teaches more
// than another click the model already predicted. Normalizing keeps long passages from dominating.
function learnResponse(profile: Profile, keys: string[], weight: number, freshness: number) {
  if (!keys.length) return;
  const norm = Math.sqrt(keys.length);
  const logit = keys.reduce((sum, key) => sum + (profile.get(key) ?? 0), 0) / norm;
  const probability = 1 / (1 + Math.exp(-logit));
  const residual = Number(weight > 0) - probability;
  learn(profile, keys, 2 * Math.abs(weight) * freshness * residual / norm);
}

/** Rank a bounded window of already-moderated posts. The upstream time cursor always belongs to the original window. */
export function rankFeed(db: Database.Database, user: number, items: CrumbsFeedItem[], history: InterestSource[], follows: Set<string>, now = Date.now()) {
  if (!items.length || !feedEnabled(db, user)) return items;
  const feedback = db.prepare("SELECT subject,kind,features,observed FROM crumbs_feed_feedback WHERE user_id=? AND observed>=? ORDER BY observed DESC, rowid DESC LIMIT 512")
    .all(user, now - 90 * DAY) as Feedback[];
  const activity: Profile = new Map(), interests: Profile = new Map();
  const seen = new Map<string, number>(), dismissed = new Set<string>();
  for (const row of feedback.reverse()) {
    const strength = decay(age(row.observed, now));
    learnResponse(activity, JSON.parse(row.features), weights[row.kind], strength);
    seen.set(row.subject, Math.max(seen.get(row.subject) ?? 0, strength));
    if (row.kind === "less") dismissed.add(row.subject);
  }
  for (const row of history) {
    learn(interests, features(row.title, row.url), row.weight * decay(age(row.at, now)));
  }
  // Keep the newest reply with its parent, including when the parent also occurs in this window.
  const threads = new Map<string, CrumbsFeedItem[]>();
  for (const item of items) {
    const root = item.parent ?? item;
    if (dismissed.has(item.id) || dismissed.has(root.id)) continue;
    const group = threads.get(root.id);
    if (group) group.push(item); else threads.set(root.id, [item]);
  }
  const frequency = new Map<string, number>();
  const candidates = [...threads.values()].map(group => {
    const item = group[0]!, root = item.parent ?? item;
    const keys = [...new Set([...itemFeatures(root), ...(item === root ? [] : itemFeatures(item))])];
    for (const key of keys) frequency.set(key, (frequency.get(key) ?? 0) + 1);
    return { group, root, item, keys, site: keys.find(key => key.startsWith("site:")) ?? "" };
  });
  const ranked = candidates.map(candidate => {
    const { item, root, keys } = candidate;
    let topics = 0, social = 0, words = 0;
    for (const key of keys) {
      const affinity = Math.tanh((activity.get(key) ?? 0) / 1.8) + 0.75 * Math.tanh((interests.get(key) ?? 0) / 4);
      if (key.startsWith("word:")) {
        // Terms shared across almost every candidate carry little information.
        topics += affinity * Math.log1p(candidates.length / (frequency.get(key) ?? 1));
        words++;
      } else social += affinity * (key.startsWith("author:") ? 1.3 : 0.8);
    }
    const following = follows.has(root.author.did) || follows.has(item.author.did);
    const relevance = 2.5 * Math.tanh(topics / Math.sqrt(1 + words)) + social + Number(following);
    const recency = 1 / (1 + age(Date.parse(item.createdAt) || 0, now) / 4);
    const quality = 0.2 * Number(Boolean(root.source)) + 0.3 * Number(Boolean(root.note)) + 0.12 * Math.log1p(Math.min(10, Math.max(0, item.threadCount - 1)));
    const baseline = recency + quality - 1.6 * Math.max(seen.get(root.id) ?? 0, seen.get(item.id) ?? 0);
    return { ...candidate, following, relevance, baseline };
  });
  const result: CrumbsFeedItem[] = [];
  const recent: Array<{ author: string; site: string }> = [];
  for (let position = 0; ranked.length; position++) {
    let best = 0, highest = -Infinity;
    for (const [index, candidate] of ranked.entries()) {
      const author = candidate.root.author.did;
      const repetition = recent.reduce((sum, prior) => sum + Number(prior.author === author) * 0.9 + Number(prior.site === candidate.site) * 0.35, 0);
      // Every sixth thread can introduce an unfamiliar source, while respecting negative feedback.
      const explore = position % 6 === 5;
      const affinity = explore ? Math.min(0, candidate.relevance) + Number(!candidate.following && !activity.has("author:" + author)) * 0.7 : candidate.relevance;
      const score = candidate.baseline + affinity - repetition;
      if (score > highest) { highest = score; best = index; }
    }
    const next = ranked.splice(best, 1)[0]!;
    result.push(...next.group);
    recent.push({ author: next.root.author.did, site: next.site });
    if (recent.length > 3) recent.shift();
  }
  return result;
}
