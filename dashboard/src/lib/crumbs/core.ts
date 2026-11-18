// Crumbs on the Breadboard side: the linked AT Protocol account, public
// highlights (records in the user's own account, read back through the
// indexer) and encrypted organizations (ciphertext in the organization store,
// keys on this machine). Routes bind this to the real database in service.ts;
// tests drive it against local services.
import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { annotationPageUrl, annotationTargetKey, normalizeAnnotationTarget, passageLink } from "../browser-annotations.ts";
import type { AnnotationMessage, AnnotationResponse, AnnotationThread, BrowserAnnotationTarget } from "../browser-annotations.ts";
import { OAuthError, dpopFetch, finishAuthorization, isDid, normalizeHandle, refreshTokens, resolveHandle, resolveIdentity, revokeTokens, startAuthorization } from "./atproto-oauth.ts";
import type { Fetcher } from "./atproto-oauth.ts";
import * as crypto from "./crypto.ts";
import * as store from "./store.ts";
import { shortHandle } from "./handle.ts";
import type { CrumbsAccount, CrumbsVisibility } from "./store.ts";

export class CrumbsError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const NS = { highlight: "com.breadboard.highlight", report: "com.breadboard.report", follow: "com.breadboard.follow", handle: "com.breadboard.handle", key: "com.breadboard.key", note: "com.breadboard.note", rating: "com.breadboard.rating" } as const;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const targetId = (target: BrowserAnnotationTarget) => digest(annotationTargetKey(target));
const env = (name: string) => process.env[name]?.replace(/\/+$/, "");
const appview = () => env("CRUMBS_APPVIEW_URL") ?? "https://public.api.bsky.app";

export interface CrumbsPerson { did: string; handle: string | null; displayName: string | null; avatar: string | null }
export interface CrumbsFeedItem { id: string; author: CrumbsPerson; url: string; title: string; target: BrowserAnnotationTarget; comment: string; source: string | null; createdAt: string; threadCount: number; own: boolean; audience: string; state?: string; reason?: string | null; note?: { uri: string; body: string; source: string | null }; noteCount?: number; /** The crumb that started the thread, when this one is a reply. */ parent?: CrumbsFeedItem }
export interface CrumbsNote { uri: string; handle: string | null; displayName: string | null; avatar: string | null; body: string; source: string | null; createdAt: string; helpful: number; unhelpful: number; shown: boolean; myRating: boolean | null; own: boolean }
export interface CrumbsOrg { id: string; name: string; role: "admin" | "member"; ready: boolean }
export interface CrumbsRoom { id: string; name: string; own: boolean; fixed: boolean }
export interface CrumbsChatMessage { id: string; author: string; handle: string | null; avatar: string | null; did: string; body: string; createdAt: string; own: boolean; agent?: boolean; parent?: string; unverified?: boolean; /** Set when the message is a crumb: what it is about. */ crumb?: ChatCrumb }
export interface ChatCrumb { target: BrowserAnnotationTarget; body: string; source: string | null }
export interface CrumbsStatus {
  signedIn: boolean; needsSignIn: boolean; did: string | null; handle: string | null; displayName: string | null; avatar: string | null;
  defaultVisibility: CrumbsVisibility; servers: { indexer: string; orgStore: string };
  /** "records": Crumbs' own record type through the index. "posts": the fallback, ordinary Bluesky posts. */
  publicMode: "records" | "posts";
}

export { passageLink };

interface IndexerItem { uri: string; did: string; handle: string | null; displayName: string | null; avatar: string | null; url: string; target: BrowserAnnotationTarget; targetKey: string; comment: string; source: string | null; createdAt: string; threadCount?: number; state?: string; reason?: string | null; note?: { uri: string; body: string; source: string | null }; noteCount?: number; parent?: IndexerItem }
interface OrgDetail { id: string; epoch: number; nameCt: string; role: "admin" | "member"; needsRotation: boolean; members: Array<{ did: string; role: "admin" | "member" }>;
  envelopeIndex: Array<{ epoch: number; did: string; device: string }>; keyRequests: Array<{ did: string; device: string }> }
interface OrgMessage { id: string; epoch: number; sender: string; device: string; ciphertext: string; sig: string; createdAt: string }
interface OrgPlaintext { target: BrowserAnnotationTarget; body: string; source: string | null; author: { handle: string | null; displayName: string | null; avatar: string | null } }

export function createCrumbs({ db, fetcher = fetch as Fetcher, complete, ensureServers }: {
  db: Database.Database; fetcher?: Fetcher;
  /** Called once when a Crumbs server cannot be reached, before one retry. */
  ensureServers?: (servers: { indexer: string; orgStore: string }) => Promise<void>;
  /** A plain chat completion on the user's own model. */
  complete?: (userId: number, system: string, prompt: string) => Promise<string>;
}) {
  // Everyone shares the hosted servers by default (crumbs/fly.*.toml). A developer points
  // Breadboard at local ones with CRUMBS_INDEXER_URL / CRUMBS_ORG_STORE_URL or the Servers
  // setting; http://127.0.0.1 addresses start crumbs/dev.mjs in a source checkout.
  const servers = () => ({
    indexer: env("CRUMBS_INDEXER_URL") ?? store.getSetting(db, "indexer_url") ?? "https://breadboard-crumbs-indexer.fly.dev",
    orgStore: env("CRUMBS_ORG_STORE_URL") ?? store.getSetting(db, "org_store_url") ?? "https://breadboard-crumbs-orgs.fly.dev",
  });
  const cache = new Map<string, { value: unknown; expires: number }>();
  async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    const value = await load();
    cache.set(key, { value, expires: Date.now() + ttlMs });
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    return value;
  }

  async function readJson<T>(response: Response, unreachable: string): Promise<T> {
    const data = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    if (!response.ok) throw new CrumbsError(response.status >= 500 ? 502 : response.status, data?.error && typeof data.error === "string" && response.status < 500 ? data.message ?? data.error : unreachable);
    return data as T;
  }
  async function indexer<T>(path: string, body?: unknown): Promise<T> {
    const send = () => fetcher(servers().indexer + path, { method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(15000), headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let response: Response;
    try { response = await send().catch(async error => { if (!ensureServers) throw error; await ensureServers(servers()); return send(); }); }
    catch { throw new CrumbsError(503, "Crumbs can’t reach its server right now. Try again shortly."); }
    return readJson<T>(response, "The Crumbs server had a problem. Try again shortly.");
  }

  // ---- Account -----------------------------------------------------------

  function account(userId: number): CrumbsAccount {
    const value = store.getAccount(db, userId);
    if (!value || value.needsSignIn) throw new CrumbsError(401, "Sign in to Crumbs to do that.");
    return value;
  }
  function status(userId: number): CrumbsStatus {
    const value = store.getAccount(db, userId);
    return { signedIn: Boolean(value && !value.needsSignIn), needsSignIn: Boolean(value?.needsSignIn), did: value?.did ?? null, handle: value?.handle ?? null,
      displayName: value?.displayName ?? null, avatar: value?.avatar ?? null, defaultVisibility: value?.defaultVisibility ?? "private", servers: servers(), publicMode: publicMode() };
  }

  async function profiles(dids: string[]): Promise<Map<string, CrumbsPerson>> {
    const people = new Map<string, CrumbsPerson>();
    const missing: string[] = [];
    for (const did of new Set(dids)) { const hit = cache.get(`person:${did}`); if (hit && hit.expires > Date.now()) people.set(did, hit.value as CrumbsPerson); else missing.push(did); }
    for (let index = 0; index < missing.length; index += 25) {
      const batch = missing.slice(index, index + 25);
      try {
        const response = await fetcher(`${appview()}/xrpc/app.bsky.actor.getProfiles?${batch.map(did => `actors=${encodeURIComponent(did)}`).join("&")}`, { signal: AbortSignal.timeout(10000) });
        const data = response.ok ? await response.json() as { profiles?: Array<{ did: string; handle?: string; displayName?: string; avatar?: string }> } : { profiles: [] };
        for (const profile of data.profiles ?? []) people.set(profile.did, { did: profile.did, handle: profile.handle ?? null, displayName: profile.displayName || null, avatar: profile.avatar ?? null });
      } catch { /* Names fall back to the identity document below. */ }
      for (const did of batch) {
        if (!people.has(did)) people.set(did, { did, handle: await resolveIdentity(fetcher, did).then(identity => identity.handle).catch(() => null), displayName: null, avatar: null });
        cache.set(`person:${did}`, { value: people.get(did), expires: Date.now() + 10 * 60_000 });
      }
    }
    return people;
  }

  // A hosted indexer publishes the app's sign-in identity ("Breadboard Crumbs"); a local one has
  // none, so sign-in falls back to the unnamed loopback client meant for development.
  function hostedClientId() {
    const indexer = servers().indexer;
    return indexer.startsWith("https://") ? `${indexer.replace(/\/$/, "")}/client-metadata.json` : undefined;
  }
  async function startSignIn(userId: number, input: { handle?: unknown; signup?: boolean; origin: string; returnTo?: unknown }) {
    const handle = input.signup ? undefined : normalizeHandle(input.handle);
    if (!input.signup && !handle) throw new CrumbsError(400, "Enter your handle, like name.bsky.social.");
    // Loopback redirects must use the IP literal; the port is the dashboard's own.
    const origin = new URL(input.origin);
    const redirectUri = `http://127.0.0.1:${origin.port || "80"}/api/crumbs/oauth/callback`;
    const returnTo = typeof input.returnTo === "string" && /^\/(?!\/)/.test(input.returnTo) ? input.returnTo : "/crumbs";
    try {
      const { url, pending } = await startAuthorization(fetcher, { handle: handle ?? undefined, redirectUri, clientId: env("CRUMBS_CLIENT_ID") ?? store.getSetting(db, "client_id") ?? hostedClientId() });
      store.savePending(db, userId, pending, `${origin.origin}${returnTo}`);
      return { url };
    } catch (error) { throw error instanceof OAuthError ? new CrumbsError(error.status, error.message) : error; }
  }

  async function finishSignIn(params: URLSearchParams): Promise<{ returnTo: string; error?: string }> {
    const saved = store.takePending(db, params.get("state") ?? "");
    if (!saved) return { returnTo: "/crumbs", error: "That link expired. Start again." };
    try {
      const tokens = await finishAuthorization(fetcher, saved.pending, { code: params.get("code"), iss: params.get("iss"), error: params.get("error"), errorDescription: params.get("error_description") });
      const person = (await profiles([tokens.did])).get(tokens.did);
      store.saveAccount(db, saved.userId, tokens, { handle: person?.handle ?? null, displayName: person?.displayName ?? null, avatar: person?.avatar ?? null });
      await ensureDevice(saved.userId).catch(() => {});
      void indexer("/backfill", { did: tokens.did }).catch(() => {});
      return { returnTo: saved.returnTo };
    } catch (error) {
      return { returnTo: saved.returnTo, error: error instanceof OAuthError || error instanceof CrumbsError ? error.message : "Could not sign in. Try again." };
    }
  }

  async function signOut(userId: number) {
    const value = store.getAccount(db, userId);
    if (value) await revokeTokens(fetcher, value);
    store.deleteAccount(db, userId);
  }

  const refreshing = new Map<number, Promise<CrumbsAccount>>();
  /** Refresh tokens are single use, so concurrent callers share one refresh. */
  function refreshed(userId: number, current: CrumbsAccount): Promise<CrumbsAccount> {
    let pending = refreshing.get(userId);
    if (!pending) {
      pending = (async () => {
        try { store.saveTokens(db, userId, await refreshTokens(fetcher, current)); return account(userId); }
        catch (error) {
          if (error instanceof OAuthError && error.status === 401) { store.markNeedsSignIn(db, userId); throw new CrumbsError(401, "Sign in to Crumbs again."); }
          throw error instanceof OAuthError ? new CrumbsError(error.status, error.message) : error;
        } finally { refreshing.delete(userId); }
      })();
      refreshing.set(userId, pending);
    }
    return pending;
  }

  /** One call to the user's own data server, as the user. */
  async function xrpc<T>(userId: number, method: "GET" | "POST", nsid: string, input: { params?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    let current = account(userId);
    if (current.expiresAt < Date.now() + 30_000) current = await refreshed(userId, current);
    const url = `${current.pds}/xrpc/${nsid}${input.params ? `?${new URLSearchParams(input.params)}` : ""}`;
    const send = (tokens: CrumbsAccount) => dpopFetch(fetcher, tokens.dpopKey, url, { method, headers: input.body === undefined ? {} : { "content-type": "application/json" }, body: input.body === undefined ? undefined : JSON.stringify(input.body) }, tokens.accessToken);
    let response: Response;
    try {
      response = await send(current);
      if (response.status === 401) response = await send(await refreshed(userId, current));
    } catch (error) { if (error instanceof CrumbsError) throw error; throw new CrumbsError(503, "Your account's server did not answer. Try again shortly."); }
    if (response.status === 401) { store.markNeedsSignIn(db, userId); throw new CrumbsError(401, "Sign in to Crumbs again."); }
    return readJson<T>(response, "Your account's server had a problem. Try again shortly.");
  }
  const putRecord = (userId: number, collection: string, rkey: string, record: Record<string, unknown>) =>
    xrpc<{ uri: string; cid: string }>(userId, "POST", "com.atproto.repo.putRecord", { body: { repo: account(userId).did, collection, rkey, record: { $type: collection, ...record } } });
  const createRecord = (userId: number, collection: string, record: Record<string, unknown>) =>
    xrpc<{ uri: string; cid: string }>(userId, "POST", "com.atproto.repo.createRecord", { body: { repo: account(userId).did, collection, record: { $type: collection, ...record } } });
  const deleteRecord = (userId: number, collection: string, rkey: string) =>
    xrpc<unknown>(userId, "POST", "com.atproto.repo.deleteRecord", { body: { repo: account(userId).did, collection, rkey } });
  function ownRecord(userId: number, uri: unknown, collection: string) {
    const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(uri));
    if (!match || match[1] !== account(userId).did || match[2] !== collection) throw new CrumbsError(404, "Crumb not found.");
    return match[3]!;
  }

  async function typeahead(query: unknown): Promise<CrumbsPerson[]> {
    const q = String(query ?? "").trim().replace(/^@/, "").slice(0, 100);
    if (q.length < 2) return [];
    try {
      const response = await fetcher(`${appview()}/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(q)}&limit=6`, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) return [];
      const data = await response.json() as { actors?: Array<{ did: string; handle: string; displayName?: string; avatar?: string }> };
      return (data.actors ?? []).map(actor => ({ did: actor.did, handle: actor.handle, displayName: actor.displayName || null, avatar: actor.avatar ?? null }));
    } catch { return []; }
  }

  // ---- Public crumbs -----------------------------------------------------

  const publicMessage = (item: IndexerItem, me: string | null): AnnotationMessage => ({ id: item.uri, author: item.displayName || shortHandle(item.handle) || "Someone", handle: item.handle, avatar: item.avatar, did: item.did,
    body: item.comment, source: item.source, createdAt: item.createdAt, own: item.did === me, noteCount: item.noteCount ?? 0, ...(item.note ? { note: item.note } : {}) });

  async function readPublic(userId: number, pageUrl: unknown, threadId?: string | null, notice?: string): Promise<AnnotationResponse> {
    const url = annotationPageUrl(pageUrl);
    if (!url) throw new CrumbsError(400, "Open a web page first.");
    if (publicMode() === "posts") return readPosts(userId, url, threadId, notice);
    const me = store.getAccount(db, userId)?.did ?? null;
    const data = await indexer<{ threads: Array<{ targetKey: string; target: BrowserAnnotationTarget; items: IndexerItem[] }> }>(`/highlights?url=${encodeURIComponent(url)}`);
    const threads: AnnotationThread[] = data.threads.map(thread => ({ id: thread.targetKey, target: thread.target, roomPublicId: null, rootMessageId: null, count: thread.items.length,
      preview: thread.items[0] ? `${thread.items[0].displayName || shortHandle(thread.items[0].handle) || "Someone"}: ${thread.items[0].comment}`.slice(0, 160) : undefined }));
    const selected = threadId ? data.threads.find(thread => thread.targetKey === threadId) : undefined;
    return { threads, thread: selected ? threads.find(thread => thread.id === threadId)! : null, messages: selected ? selected.items.map(item => publicMessage(item, me)) : [], flags: [], ...(notice ? { notice } : {}) };
  }

  async function writePublic(userId: number, input: Record<string, unknown>): Promise<AnnotationResponse> {
    const target = normalizeAnnotationTarget(input.target);
    if (!target) throw new CrumbsError(400, "Select content on the current page.");
    const me = account(userId);
    if (publicMode() === "posts") return writePosts(userId, target, input);
    const action = String(input.action);
    let notice: string | undefined;
    if (action === "comment") {
      const body = typeof input.body === "string" ? input.body.trim() : "";
      if (!body || body.length > 4000) throw new CrumbsError(400, "Write between 1 and 4,000 characters.");
      const source = input.source ? annotationPageUrl(input.source) : null;
      if (input.source && !source) throw new CrumbsError(400, "Use an http or https source link.");
      // An early warning for honest mistakes. The indexer's gate is the one that counts.
      const early = await indexer<{ status: string; reason: string | null }>("/moderate", { text: `${body}\n${source ?? ""}` });
      if (early.status === "rejected") throw new CrumbsError(422, `This looks like it breaks the Crumbs rules (${early.reason}). Edit it and try again.`);
      const { kind, quote, prefix, suffix, mediaUrl, selector, time } = target;
      const anchor = Object.fromEntries(Object.entries({ kind, quote, prefix, suffix, mediaUrl, selector, time }).filter(([, value]) => value !== undefined));
      const created = await createRecord(userId, NS.highlight, { url: target.url, title: target.title, target: anchor, comment: body, ...(source ? { source } : {}), createdAt: new Date().toISOString() });
      const indexed = await indexer<{ status: string | null; reason: string | null }>("/notify", { uri: created.uri });
      if (indexed.status === "rejected") {
        await deleteRecord(userId, NS.highlight, created.uri.split("/").pop()!).catch(() => {});
        throw new CrumbsError(422, `This crumb was held back by moderation (${indexed.reason ?? "rules"}), so it was not published.`);
      }
      if (indexed.status === "pending") notice = "Waiting for review";
    } else if (action === "delete-comment") {
      const rkey = ownRecord(userId, input.messageId, NS.highlight);
      await deleteRecord(userId, NS.highlight, rkey);
      await indexer("/notify", { uri: input.messageId });
    } else if (action === "flag" || action === "withdraw-flag") {
      const subject = String(input.messageId ?? "");
      if (!/^at:\/\/did:[^/]+\/com\.breadboard\.highlight\/[^/]+$/.test(subject)) throw new CrumbsError(400, "Choose a crumb to report.");
      if (subject.startsWith(`at://${me.did}/`)) throw new CrumbsError(400, "You can delete your own crumb instead of reporting it.");
      // One report per person per crumb: the record key is derived from the subject.
      const rkey = digest(subject).slice(0, 32);
      if (action === "flag") await putRecord(userId, NS.report, rkey, { subject, reason: String(input.body ?? "").trim().slice(0, 1000), createdAt: new Date().toISOString() });
      else await deleteRecord(userId, NS.report, rkey);
      await indexer("/notify", { uri: `at://${me.did}/${NS.report}/${rkey}` });
      if (action === "flag") notice = "Reported";
    } else throw new CrumbsError(400, "Unknown action.");
    const threadId = targetId(target);
    const result = await readPublic(userId, target.url, undefined, notice);
    const thread = result.threads.find(item => item.id === threadId);
    return thread ? readPublic(userId, target.url, threadId, notice) : result;
  }

  // ---- Fallback: public crumbs as ordinary Bluesky posts ---------------------
  // The plan's way out if moderating our own record type becomes a burden:
  // a crumb is a normal post whose link carries the passage as a text
  // fragment, Bluesky moderates it, and pages are read back through Bluesky's
  // own search. No Crumbs server is involved in this mode.

  const publicMode = (): "records" | "posts" => (env("CRUMBS_PUBLIC_MODE") ?? store.getSetting(db, "public_mode")) === "posts" ? "posts" : "records";
  const searchApi = () => env("CRUMBS_SEARCH_URL") ?? "https://api.bsky.app";
  const HIDDEN_LABELS = new Set(["!hide", "!warn", "!takedown", "spam", "porn", "sexual", "nudity", "graphic-media"]);
  interface BskyPost {
    uri: string; cid: string; labels?: Array<{ val: string }>;
    author: { did: string; handle?: string; displayName?: string; avatar?: string; labels?: Array<{ val: string }> };
    record: { text?: string; createdAt?: string; facets?: Array<{ features?: Array<{ uri?: string }> }>; embed?: { external?: { uri?: string; title?: string; description?: string } } };
  }
  // Search takes a few seconds to learn about a new or deleted post, so remember our own for a while.
  const recentPosts = new Map<string, { post: BskyPost; until: number }>();
  const recentlyDeleted = new Map<string, number>();

  /** The passage a post links to (on `pageUrl`, when given), or null when it links elsewhere. */
  function postTarget(post: BskyPost, pageUrl?: string): BrowserAnnotationTarget | null {
    const links = [post.record.embed?.external?.uri, ...(post.record.facets ?? []).flatMap(facet => (facet.features ?? []).map(feature => feature.uri))].filter((link): link is string => typeof link === "string");
    for (const link of links) {
      const url = annotationPageUrl(link);
      if (!url || (pageUrl && url !== pageUrl)) continue;
      const title = post.record.embed?.external?.title || new URL(url).hostname;
      const fragment = link.split(":~:text=")[1]?.split("&")[0];
      if (!fragment) { if (pageUrl) return { kind: "page", url, title }; continue; }
      const parts = fragment.split(",").map(part => { try { return decodeURIComponent(part); } catch { return part; } });
      const prefix = parts.length > 1 && parts[0]!.endsWith("-") ? parts.shift()!.slice(0, -1) : "";
      const suffix = parts.length > 1 && parts.at(-1)!.startsWith("-") ? parts.pop()!.slice(1) : "";
      const described = post.record.embed?.external?.description ?? "";
      // "start,end" names a range. Posts made here carry the whole passage in their link card.
      const quote = parts.length === 1 ? parts[0]! : described.startsWith(parts[0]!) && described.endsWith(parts[1]!) ? described : `${parts[0]} … ${parts[1]}`;
      const target = normalizeAnnotationTarget({ kind: "text", url, title, quote, prefix, suffix });
      if (target) return target;
    }
    return null;
  }
  function postBody(post: BskyPost, target: BrowserAnnotationTarget) {
    const text = String(post.record.text ?? "");
    const tail = `\n\n${new URL(target.url).hostname}`;
    return (text.endsWith(tail) ? text.slice(0, -tail.length) : text).trim();
  }
  async function searchPosts(params: Record<string, string>): Promise<BskyPost[]> {
    let response: Response;
    try { response = await fetcher(`${searchApi()}/xrpc/app.bsky.feed.searchPosts?${new URLSearchParams({ limit: "100", sort: "latest", ...params })}`, { signal: AbortSignal.timeout(15000) }); }
    catch { throw new CrumbsError(503, "Bluesky search did not answer. Try again shortly."); }
    const data = await readJson<{ posts?: BskyPost[] }>(response, "Bluesky search had a problem. Try again shortly.");
    const now = Date.now();
    for (const [uri, entry] of recentPosts) if (entry.until < now) recentPosts.delete(uri);
    for (const [uri, until] of recentlyDeleted) if (until < now) recentlyDeleted.delete(uri);
    const found = (data.posts ?? []).filter(post => !recentlyDeleted.has(post.uri) && ![...(post.labels ?? []), ...(post.author?.labels ?? [])].some(label => HIDDEN_LABELS.has(label.val)));
    return [...found, ...[...recentPosts.values()].map(entry => entry.post).filter(post => !found.some(other => other.uri === post.uri))];
  }

  async function readPosts(userId: number, url: string, threadId?: string | null, notice?: string): Promise<AnnotationResponse> {
    const me = store.getAccount(db, userId)?.did ?? null;
    const groups = new Map<string, { target: BrowserAnnotationTarget; items: Array<{ post: BskyPost; target: BrowserAnnotationTarget }> }>();
    const posts = (await searchPosts({ q: "*", url })).sort((a, b) => String(a.record.createdAt).localeCompare(String(b.record.createdAt)));
    for (const post of posts) {
      const target = postTarget(post, url);
      if (!target) continue;
      const id = targetId(target);
      if (!groups.has(id)) groups.set(id, { target, items: [] });
      groups.get(id)!.items.push({ post, target });
    }
    const threads: AnnotationThread[] = [...groups].map(([id, group]) => ({ id, target: group.target, roomPublicId: null, rootMessageId: null, count: group.items.length,
      preview: `${group.items[0]!.post.author.displayName || shortHandle(group.items[0]!.post.author.handle) || "Someone"}: ${postBody(group.items[0]!.post, group.target)}`.slice(0, 160) }));
    const selected = threadId ? groups.get(threadId) : undefined;
    return { threads, thread: selected ? threads.find(thread => thread.id === threadId)! : null, flags: [], ...(notice ? { notice } : {}),
      messages: (selected?.items ?? []).map(({ post, target }) => ({ id: post.uri, author: post.author.displayName || shortHandle(post.author.handle) || "Someone", handle: post.author.handle ?? null, avatar: post.author.avatar ?? null,
        did: post.author.did, body: postBody(post, target), source: null, createdAt: post.record.createdAt ?? new Date().toISOString(), own: post.author.did === me })) };
  }

  async function writePosts(userId: number, target: BrowserAnnotationTarget, input: Record<string, unknown>): Promise<AnnotationResponse> {
    const me = account(userId);
    const action = String(input.action);
    let notice: string | undefined;
    if (action === "comment") {
      const comment = typeof input.body === "string" ? input.body.trim() : "";
      const source = input.source ? annotationPageUrl(input.source) : null;
      if (input.source && !source) throw new CrumbsError(400, "Use an http or https source link.");
      const body = source ? `${comment}\n${source}` : comment;
      const host = new URL(target.url).hostname;
      const text = `${body}\n\n${host}`;
      const room = 300 - [...`\n\n${host}`].length;
      if (!comment || [...body].length > room) throw new CrumbsError(400, `A Bluesky post holds 300 characters. Write between 1 and ${room}.`);
      const link = passageLink(target);
      const start = Buffer.byteLength(`${body}\n\n`);
      const record = { text, createdAt: new Date().toISOString(), facets: [{ index: { byteStart: start, byteEnd: start + Buffer.byteLength(host) }, features: [{ $type: "app.bsky.richtext.facet#link", uri: link }] }],
        embed: { $type: "app.bsky.embed.external", external: { uri: link, title: target.title || host, description: (target.kind === "text" ? target.quote ?? "" : "").slice(0, 1000) } } };
      const created = await createRecord(userId, "app.bsky.feed.post", record);
      recentPosts.set(created.uri, { until: Date.now() + 3 * 60_000, post: { uri: created.uri, cid: created.cid, author: { did: me.did, handle: me.handle ?? undefined, displayName: me.displayName ?? undefined, avatar: me.avatar ?? undefined }, record } });
    } else if (action === "delete-comment") {
      const uri = String(input.messageId);
      await deleteRecord(userId, "app.bsky.feed.post", ownRecord(userId, uri, "app.bsky.feed.post"));
      recentPosts.delete(uri); recentlyDeleted.set(uri, Date.now() + 3 * 60_000);
    } else if (action === "flag") {
      const uri = String(input.messageId ?? "");
      if (uri.startsWith(`at://${me.did}/`)) throw new CrumbsError(400, "You can delete your own crumb instead of reporting it.");
      const found = await fetcher(`${searchApi()}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`, { signal: AbortSignal.timeout(10000) }).then(response => response.json() as Promise<{ posts?: BskyPost[] }>).catch(() => ({ posts: [] }));
      const post = found.posts?.[0];
      if (!post) throw new CrumbsError(404, "That post is gone.");
      await xrpc(userId, "POST", "com.atproto.moderation.createReport", { body: { reasonType: "com.atproto.moderation.defs#reasonOther", reason: String(input.body ?? "").trim().slice(0, 1000), subject: { $type: "com.atproto.repo.strongRef", uri: post.uri, cid: post.cid } } });
      notice = "Reported to Bluesky’s moderators.";
    } else throw new CrumbsError(400, action === "withdraw-flag" ? "A report to Bluesky can’t be withdrawn from here." : "Unknown action.");
    const threadId = targetId(target);
    const result = await readPosts(userId, target.url, undefined, notice);
    return result.threads.some(thread => thread.id === threadId) ? readPosts(userId, target.url, threadId, notice) : result;
  }

  async function feedPosts(userId: number, scope: string): Promise<{ items: CrumbsFeedItem[]; before: string | null; empty?: string }> {
    const me = store.getAccount(db, userId);
    const signedIn = me && !me.needsSignIn ? me : null;
    if (scope !== "everyone" && !signedIn) return { items: [], before: null, empty: scope === "mine" ? "Sign in to see your crumbs" : "Sign in to see people you follow" };
    // Bluesky's search finds passage links by this exact marker (checked against the live index).
    const posts = await searchPosts({ q: "#:~:text=", ...(scope === "mine" ? { author: signedIn!.did } : {}) });
    const following = scope === "following" ? new Set([signedIn!.did, ...(await blueskyFollows(signedIn!.did))]) : null;
    const items: CrumbsFeedItem[] = [];
    for (const post of posts.sort((a, b) => String(b.record.createdAt).localeCompare(String(a.record.createdAt)))) {
      const target = postTarget(post);
      if (!target || (following && !following.has(post.author.did))) continue;
      items.push({ id: post.uri, author: { did: post.author.did, handle: post.author.handle ?? null, displayName: post.author.displayName ?? null, avatar: post.author.avatar ?? null }, url: passageLink(target), title: target.title, target,
        comment: postBody(post, target), source: null, createdAt: post.record.createdAt ?? new Date().toISOString(), threadCount: 1, own: post.author.did === signedIn?.did, audience: "Bluesky" });
    }
    return { items, before: null };
  }

  async function follows(userId: number): Promise<{ crumbs: Array<CrumbsPerson & { uri: string }>; bluesky: number }> {
    const me = account(userId);
    if (publicMode() === "posts") return { crumbs: [], bluesky: (await blueskyFollows(me.did)).length };
    const actor = await indexer<{ follows: Array<CrumbsPerson & { uri: string }> }>(`/actor?did=${encodeURIComponent(me.did)}`);
    return { crumbs: actor.follows, bluesky: (await blueskyFollows(me.did)).length };
  }
  function blueskyFollows(did: string): Promise<string[]> {
    return cached(`bsky-follows:${did}`, 10 * 60_000, async () => {
      const dids: string[] = [];
      let cursor = "";
      try {
        for (let page = 0; page < 10; page++) {
          const response = await fetcher(`${appview()}/xrpc/app.bsky.graph.getFollows?actor=${encodeURIComponent(did)}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal: AbortSignal.timeout(10000) });
          if (!response.ok) break;
          const data = await response.json() as { follows?: Array<{ did: string }>; cursor?: string };
          dids.push(...(data.follows ?? []).map(item => item.did));
          if (!data.cursor) break;
          cursor = data.cursor;
        }
      } catch { /* The feed still shows Crumbs follows. */ }
      return dids;
    });
  }
  async function follow(userId: number, who: unknown, on: boolean) {
    const me = account(userId);
    if (publicMode() === "posts") throw new CrumbsError(409, "Following on Crumbs needs the Crumbs index. The people you follow on Bluesky already appear in your feed.");
    let did = String(who ?? "");
    if (!isDid(did)) {
      const handle = normalizeHandle(who);
      if (!handle) throw new CrumbsError(400, "Enter a handle, like name.bsky.social.");
      did = await resolveHandle(fetcher, handle).then(identity => identity.did).catch(error => { throw new CrumbsError(404, error.message); });
    }
    if (did === me.did) throw new CrumbsError(400, "That is you.");
    const rkey = digest(did).slice(0, 32);
    if (on) await putRecord(userId, NS.follow, rkey, { subject: did, createdAt: new Date().toISOString() });
    else await deleteRecord(userId, NS.follow, rkey);
    await indexer("/notify", { uri: `at://${me.did}/${NS.follow}/${rkey}` });
    return follows(userId);
  }

  const feedItem = (item: IndexerItem, me: string | null, audience: string): CrumbsFeedItem => ({ id: item.uri, author: { did: item.did, handle: item.handle, displayName: item.displayName, avatar: item.avatar },
    url: passageLink(item.target), title: item.target.title, target: item.target, comment: item.comment, source: item.source, createdAt: item.createdAt, threadCount: item.threadCount ?? 1,
    own: item.did === me, audience, noteCount: item.noteCount ?? 0, ...(item.note ? { note: item.note } : {}), ...(item.state ? { state: item.state, reason: item.reason ?? null } : {}),
    ...(item.parent ? { parent: feedItem({ ...item.parent, threadCount: item.threadCount }, me, audience) } : {}) });

  /** `following` (people you follow, and you), `everyone`, `mine`, or `org:<id>`. Reading needs no account. */
  async function feed(userId: number, scope: string, before?: string | null): Promise<{ items: CrumbsFeedItem[]; before: string | null; empty?: string }> {
    const me = store.getAccount(db, userId);
    if (scope.startsWith("org:")) return orgFeed(userId, scope.slice(4), before);
    if (publicMode() === "posts") return feedPosts(userId, scope);
    if (scope === "mine") {
      const mine = account(userId);
      const actor = await indexer<{ items: IndexerItem[] }>(`/actor?did=${encodeURIComponent(mine.did)}&all=1`);
      return { items: actor.items.map(item => feedItem(item, mine.did, "Public")), before: null };
    }
    let actors: string[] = [];
    if (scope === "following") {
      if (!me || me.needsSignIn) return { items: [], before: null, empty: "Sign in to see people you follow" };
      const mine = await indexer<{ follows: Array<{ did: string }> }>(`/actor?did=${encodeURIComponent(me.did)}`);
      actors = [...new Set([me.did, ...mine.follows.map(item => item.did), ...(await blueskyFollows(me.did))])];
    }
    const page = await indexer<{ items: IndexerItem[]; before: string | null }>("/feed", { actors, before: before ?? undefined, limit: 30 });
    return { items: page.items.map(item => feedItem(item, me?.did ?? null, "Public")), before: page.before };
  }

  // ---- Community notes -----------------------------------------------------
  // Context readers add to a public crumb. A note shows on the crumb once
  // enough people other than its author rate it helpful.

  const CRUMB_URI = /^at:\/\/did:[^/]+\/com\.breadboard\.highlight\/[^/]+$/;
  const NOTE_URI = /^at:\/\/did:[^/]+\/com\.breadboard\.note\/[^/]+$/;
  function needIndex() { if (publicMode() === "posts") throw new CrumbsError(409, "Community notes need the Crumbs index."); }

  async function listNotes(userId: number, crumb: unknown): Promise<{ notes: CrumbsNote[] }> {
    needIndex();
    if (!CRUMB_URI.test(String(crumb))) throw new CrumbsError(400, "Choose a crumb.");
    const me = store.getAccount(db, userId);
    const viewer = me && !me.needsSignIn ? `&viewer=${encodeURIComponent(me.did)}` : "";
    const data = await indexer<{ notes: Array<Omit<CrumbsNote, "own"> & { did: string }> }>(`/notes?subject=${encodeURIComponent(String(crumb))}${viewer}`);
    return { notes: data.notes.map(note => ({ ...note, own: note.did === me?.did })) };
  }
  async function addNote(userId: number, crumb: unknown, text: unknown, link: unknown) {
    needIndex();
    const me = account(userId);
    const subject = String(crumb);
    if (!CRUMB_URI.test(subject)) throw new CrumbsError(400, "Choose a crumb.");
    if (subject.startsWith(`at://${me.did}/`)) throw new CrumbsError(400, "Notes are written by other readers.");
    const body = typeof text === "string" ? text.trim() : "";
    if (!body || body.length > 2000) throw new CrumbsError(400, "Write between 1 and 2,000 characters.");
    const source = link ? annotationPageUrl(link) : null;
    if (link && !source) throw new CrumbsError(400, "Use an http or https source link.");
    const early = await indexer<{ status: string; reason: string | null }>("/moderate", { text: `${body}\n${source ?? ""}` });
    if (early.status === "rejected") throw new CrumbsError(422, `This looks like it breaks the Crumbs rules (${early.reason}). Edit it and try again.`);
    // One note per person per crumb: writing again replaces it.
    const rkey = digest(subject).slice(0, 32);
    await putRecord(userId, NS.note, rkey, { subject, body, ...(source ? { source } : {}), createdAt: new Date().toISOString() });
    await indexer("/notify", { uri: `at://${me.did}/${NS.note}/${rkey}` });
    return listNotes(userId, subject);
  }
  async function deleteNote(userId: number, crumb: unknown, note: unknown) {
    needIndex();
    await deleteRecord(userId, NS.note, ownRecord(userId, note, NS.note));
    await indexer("/notify", { uri: note });
    return listNotes(userId, crumb);
  }
  /** `helpful` true or false rates the note; null withdraws the rating. */
  async function rateNote(userId: number, crumb: unknown, note: unknown, helpful: unknown) {
    needIndex();
    const me = account(userId);
    const subject = String(note);
    if (!NOTE_URI.test(subject)) throw new CrumbsError(400, "Choose a note.");
    if (subject.startsWith(`at://${me.did}/`)) throw new CrumbsError(400, "You can’t rate your own note.");
    const rkey = digest(subject).slice(0, 32);
    if (typeof helpful === "boolean") await putRecord(userId, NS.rating, rkey, { subject, helpful, createdAt: new Date().toISOString() });
    else await deleteRecord(userId, NS.rating, rkey);
    await indexer("/notify", { uri: `at://${me.did}/${NS.rating}/${rkey}` });
    return listNotes(userId, crumb);
  }

  async function deleteMine(userId: number, uri: unknown) {
    if (publicMode() === "posts") {
      await deleteRecord(userId, "app.bsky.feed.post", ownRecord(userId, uri, "app.bsky.feed.post"));
      recentPosts.delete(String(uri)); recentlyDeleted.set(String(uri), Date.now() + 3 * 60_000);
      return;
    }
    const rkey = ownRecord(userId, uri, NS.highlight);
    await deleteRecord(userId, NS.highlight, rkey);
    await indexer("/notify", { uri });
  }

  /** Claim name.<domain> and try to make it the account's handle. */
  async function claimHandle(userId: number, name: unknown) {
    const me = account(userId);
    const wanted = String(name ?? "").trim().toLowerCase();
    const check = await indexer<{ available: boolean; owner?: string | null; reason?: string; handle?: string }>(`/handle?name=${encodeURIComponent(wanted)}`);
    if (!check.handle) throw new CrumbsError(400, check.reason ?? "That name can't be used.");
    if (!check.available && check.owner !== me.did) throw new CrumbsError(409, "That name is taken.");
    await putRecord(userId, NS.handle, "self", { name: wanted, createdAt: new Date().toISOString() });
    await indexer("/notify", { uri: `at://${me.did}/${NS.handle}/self` });
    try {
      await xrpc(userId, "POST", "com.atproto.identity.updateHandle", { body: { handle: check.handle } });
      cache.delete(`person:${me.did}`);
      const person = (await profiles([me.did])).get(me.did);
      db.prepare("UPDATE crumbs_accounts SET handle=? WHERE user_id=?").run(person?.handle ?? check.handle, userId);
      return { handle: check.handle, applied: true };
    } catch {
      return { handle: check.handle, applied: false, instructions: `The name is reserved for you. To switch to it, open Bluesky, go to Settings, Account, Handle, choose "I have my own domain", enter ${check.handle} and pick "No DNS panel".` };
    }
  }

  // ---- Encrypted organizations --------------------------------------------

  /** This machine's keys, published in the user's account so other members can send it organization keys. */
  async function ensureDevice(userId: number): Promise<crypto.DeviceKeys> {
    const me = account(userId);
    let device = store.getDevice(db, userId);
    if (!device) { store.saveDevice(db, userId, crypto.generateDeviceKeys(), null); device = store.getDevice(db, userId)!; }
    if (device.publishedFor !== me.did) {
      await putRecord(userId, NS.key, device.keys.deviceId, crypto.deviceKeyRecord(device.keys, "Breadboard"));
      store.saveDevice(db, userId, device.keys, me.did);
    }
    return device.keys;
  }

  async function orgStore<T>(userId: number, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const me = account(userId);
    const keys = await ensureDevice(userId);
    const text = body === undefined ? "" : JSON.stringify(body);
    const send = () => fetcher(servers().orgStore + path, { method, signal: AbortSignal.timeout(15000), body: text || undefined, headers: { "content-type": "application/json", authorization: crypto.signRequest(keys, me.did, method, path, text) } });
    let response: Response;
    try { response = await send().catch(async error => { if (!ensureServers) throw error; await ensureServers(servers()); return send(); }); }
    catch { throw new CrumbsError(503, "Crumbs can’t reach the organization server right now. Try again shortly."); }
    return readJson<T>(response, "The organization server had a problem. Try again shortly.");
  }

  /** Every device key a member has published, read from their own account. */
  function devicesOf(did: string): Promise<Array<{ device: string; signingKey: crypto.PublicJwk; agreementKey: crypto.PublicJwk }>> {
    return cached(`devices:${did}`, 60_000, async () => {
      const { pds } = await resolveIdentity(fetcher, did);
      const response = await fetcher(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${NS.key}&limit=20`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return [];
      const data = await response.json() as { records?: Array<{ uri: string; value?: { signingKey?: unknown; agreementKey?: unknown } }> };
      return (data.records ?? []).flatMap(record => {
        const device = record.uri.split("/").pop()!;
        const { signingKey, agreementKey } = record.value ?? {};
        return /^[a-z0-9]{8,32}$/.test(device) && crypto.isPublicJwk(signingKey) && crypto.isPublicJwk(agreementKey) ? [{ device, signingKey, agreementKey }] : [];
      });
    });
  }

  const orgContext = (orgId: string, epoch: number) => `${orgId}\n${epoch}`;
  /** The keys this device holds for an organization, fetching any it has been sent since last time. */
  async function orgKeys(userId: number, orgId: string, currentEpoch: number): Promise<Map<number, Buffer>> {
    const keys = store.getOrgKeys(db, userId, orgId);
    if (keys.has(currentEpoch)) return keys;
    const me = account(userId), device = await ensureDevice(userId);
    const { envelopes } = await orgStore<{ envelopes: Array<{ epoch: number; envelope: string }> }>(userId, "GET", `/orgs/${orgId}/envelopes`);
    for (const item of envelopes) {
      if (keys.has(item.epoch)) continue;
      try {
        const key = crypto.unwrapKey(item.envelope, device.agreement, crypto.envelopeContext(orgId, item.epoch, me.did, device.deviceId));
        store.saveOrgKey(db, userId, orgId, item.epoch, key); keys.set(item.epoch, key);
      } catch { /* An envelope this device cannot open is ignored. */ }
    }
    return keys;
  }

  async function envelopesFor(orgId: string, epoch: number, key: Buffer, dids: string[], held: OrgDetail["envelopeIndex"] = []) {
    const out: Array<{ did: string; device: string; envelope: string }> = [];
    for (const did of dids) for (const device of await devicesOf(did).catch(() => [])) {
      if (held.some(item => item.epoch === epoch && item.did === did && item.device === device.device)) continue;
      out.push({ did, device: device.device, envelope: crypto.wrapKey(key, device.agreementKey, crypto.envelopeContext(orgId, epoch, did, device.device)) });
    }
    return out;
  }

  /**
   * Housekeeping any member's client does when it opens an organization: hand
   * the keys it holds to member devices that lack them (a new member, or a
   * member's new computer), and, as an admin, replace the key after someone left.
   *
   * ponytail: membership comes from the store, so a store that lied about who
   * is a member could obtain a key. MLS would bind membership into the key
   * schedule; revisit together with the epoch-key note in crypto.ts.
   */
  async function maintain(userId: number, detail: OrgDetail, keys: Map<number, Buffer>) {
    if (detail.role === "admin" && detail.needsRotation && keys.has(detail.epoch)) { await rotate(userId, detail, keys, []); return; }
    if (!keys.has(detail.epoch)) return;
    const members = new Set(detail.members.map(member => member.did));
    // Devices that asked for the key, plus members who hold no key at all yet
    // (invited before they first opened Crumbs). The second group is probed at
    // most twice a minute so an absent member costs nothing.
    const waiting = detail.members.map(member => member.did).filter(did => !detail.envelopeIndex.some(item => item.epoch === detail.epoch && item.did === did));
    const wanted = new Set(detail.keyRequests.filter(request => members.has(request.did)).map(request => request.did));
    for (const did of waiting) {
      const id = `${detail.id}:${did}`;
      if (wanted.has(did) || probed.has(id)) continue;
      probed.add(id); setTimeout(() => probed.delete(id), 30_000).unref?.();
      wanted.add(did);
    }
    await shareKeys(userId, detail, keys, [...wanted]);
  }
  const probed = new Set<string>();
  /** Send every key this device holds to the devices of `dids` that lack it. */
  async function shareKeys(userId: number, detail: OrgDetail, keys: Map<number, Buffer>, dids: string[]) {
    if (!dids.length) return;
    for (const did of dids) cache.delete(`devices:${did}`);
    for (const [epoch, key] of keys) {
      const envelopes = await envelopesFor(detail.id, epoch, key, dids, detail.envelopeIndex);
      if (envelopes.length) await orgStore(userId, "POST", `/orgs/${detail.id}/envelopes`, { epoch, envelopes });
    }
  }

  async function rotate(userId: number, detail: OrgDetail, keys: Map<number, Buffer>, remove: string[]) {
    const current = keys.get(detail.epoch);
    if (!current) throw new CrumbsError(409, "This device does not have the organization's current key yet.");
    const { name } = crypto.decryptJson<{ name: string }>(current, detail.nameCt, orgContext(detail.id, detail.epoch));
    const epoch = detail.epoch + 1, key = crypto.newEpochKey();
    const remaining = detail.members.map(member => member.did).filter(did => !remove.includes(did));
    for (const did of remaining) cache.delete(`devices:${did}`);
    await orgStore(userId, "POST", `/orgs/${detail.id}/epochs`, { epoch, remove, nameCt: crypto.encryptJson(key, { name }, orgContext(detail.id, epoch)), envelopes: await envelopesFor(detail.id, epoch, key, remaining) });
    store.saveOrgKey(db, userId, detail.id, epoch, key);
  }

  async function openOrg(userId: number, orgId: string) {
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(orgId)) throw new CrumbsError(404, "Organization not found.");
    let detail = await orgStore<OrgDetail>(userId, "GET", `/orgs/${orgId}`);
    let keys = await orgKeys(userId, orgId, detail.epoch);
    const before = detail.epoch;
    await maintain(userId, detail, keys).catch(() => {});
    if (detail.needsRotation && detail.role === "admin") { detail = await orgStore<OrgDetail>(userId, "GET", `/orgs/${orgId}`); if (detail.epoch !== before) keys = await orgKeys(userId, orgId, detail.epoch); }
    const current = keys.get(detail.epoch);
    let name = "Organization";
    if (current) { try { name = crypto.decryptJson<{ name: string }>(current, detail.nameCt, orgContext(orgId, detail.epoch)).name; } catch { /* Shown without its name. */ } }
    return { detail, keys, name, ready: Boolean(current) };
  }

  async function listOrgs(userId: number): Promise<CrumbsOrg[]> {
    const { orgs } = await orgStore<{ orgs: Array<{ id: string; epoch: number; nameCt: string; role: "admin" | "member" }> }>(userId, "GET", "/orgs");
    const out: CrumbsOrg[] = [];
    for (const org of orgs) {
      const key = (await orgKeys(userId, org.id, org.epoch).catch(() => new Map<number, Buffer>())).get(org.epoch);
      let name = "New organization";
      if (key) { try { name = crypto.decryptJson<{ name: string }>(key, org.nameCt, orgContext(org.id, org.epoch)).name; } catch { /* Keep the placeholder. */ } }
      out.push({ id: org.id, name, role: org.role, ready: Boolean(key) });
    }
    return out;
  }

  async function createOrg(userId: number, name: unknown): Promise<CrumbsOrg> {
    const label = String(name ?? "").trim().slice(0, 80);
    if (!label) throw new CrumbsError(400, "Give the organization a name.");
    const me = account(userId);
    await ensureDevice(userId);
    cache.delete(`devices:${me.did}`);
    const id = randomUUID(), key = crypto.newEpochKey();
    await orgStore(userId, "POST", "/orgs", { id, nameCt: crypto.encryptJson(key, { name: label }, orgContext(id, 1)), envelopes: await envelopesFor(id, 1, key, [me.did]) });
    store.saveOrgKey(db, userId, id, 1, key);
    return { id, name: label, role: "admin", ready: true };
  }

  async function orgDetail(userId: number, orgId: string) {
    const { detail, keys, name, ready } = await openOrg(userId, orgId);
    const people = await profiles(detail.members.map(member => member.did));
    const waiting = new Set(detail.members.filter(member => !detail.envelopeIndex.some(item => item.epoch === detail.epoch && item.did === member.did)).map(member => member.did));
    let reports: Array<{ id: string; messageId: string; reporter: CrumbsPerson; reason: string; createdAt: string }> = [];
    if (detail.role === "admin") {
      const data = await orgStore<{ reports: Array<{ id: string; messageId: string; reporter: string; epoch: number; reasonCt: string; createdAt: string }> }>(userId, "GET", `/orgs/${orgId}/reports`);
      const reporters = await profiles(data.reports.map(report => report.reporter));
      reports = data.reports.map(report => {
        let reason = "";
        try { reason = crypto.decryptJson<{ reason: string }>(keys.get(report.epoch)!, report.reasonCt, orgContext(orgId, report.epoch)).reason; } catch { reason = "(could not be read on this device)"; }
        return { id: report.id, messageId: report.messageId, reporter: reporters.get(report.reporter) ?? { did: report.reporter, handle: null, displayName: null, avatar: null }, reason, createdAt: report.createdAt };
      });
    }
    return { id: orgId, name, role: detail.role, ready, reports,
      members: detail.members.map(member => ({ ...(people.get(member.did) ?? { did: member.did, handle: null, displayName: null, avatar: null }), role: member.role, waitingForKey: waiting.has(member.did) })) };
  }

  async function addOrgMember(userId: number, orgId: string, who: unknown, role: unknown) {
    const handle = normalizeHandle(who);
    const did = isDid(who) ? who : handle ? await resolveHandle(fetcher, handle).then(identity => identity.did).catch(error => { throw new CrumbsError(404, error.message); }) : null;
    if (!did) throw new CrumbsError(400, "Enter a handle, like name.bsky.social.");
    await orgStore(userId, "POST", `/orgs/${orgId}/members`, { did, role: role === "admin" ? "admin" : "member" });
    // Hand the keys to whatever devices the new member already has.
    const { detail, keys } = await openOrg(userId, orgId);
    await shareKeys(userId, detail, keys, [did]).catch(() => {});
    return orgDetail(userId, orgId);
  }
  async function removeOrgMember(userId: number, orgId: string, did: unknown) {
    if (!isDid(did)) throw new CrumbsError(400, "Choose a member.");
    const { detail, keys } = await openOrg(userId, orgId);
    await rotate(userId, detail, keys, [did]);
    return orgDetail(userId, orgId);
  }
  async function leaveOrg(userId: number, orgId: string) { await orgStore(userId, "DELETE", `/orgs/${orgId}/members/me`); store.forgetOrgKeys(db, userId, orgId); }
  async function deleteOrg(userId: number, orgId: string) { await orgStore(userId, "DELETE", `/orgs/${orgId}`); store.forgetOrgKeys(db, userId, orgId); }
  async function dismissOrgReport(userId: number, orgId: string, reportId: unknown) { await orgStore(userId, "DELETE", `/orgs/${orgId}/reports/${encodeURIComponent(String(reportId))}`); return orgDetail(userId, orgId); }

  /** Decrypt what this device has keys for, and check each sender's signature. */
  async function openMessages<T>(orgId: string, keys: Map<number, Buffer>, messages: OrgMessage[]) {
    const out: Array<{ message: OrgMessage; plain: T; verified: boolean }> = [];
    for (const message of messages) {
      const key = keys.get(message.epoch);
      if (!key) continue;
      try {
        const plain = crypto.decryptJson<T>(key, message.ciphertext, orgContext(orgId, message.epoch));
        if (!plain || typeof plain !== "object") continue;
        // The store names the sender; the signature proves it, against the key that sender published.
        const device = (await devicesOf(message.sender).catch(() => [])).find(item => item.device === message.device);
        const verified = Boolean(device && crypto.verifyBytes(device.signingKey, crypto.messageSigningInput(orgId, message.epoch, message.id, message.ciphertext), message.sig));
        out.push({ message, plain, verified });
      } catch { /* Not readable with the keys on this device. */ }
    }
    return out;
  }
  /** Crumbs only: messages anchored to a page. Chat and room entries are skipped. */
  async function decryptMessages(orgId: string, keys: Map<number, Buffer>, messages: OrgMessage[]) {
    return (await openMessages<OrgPlaintext>(orgId, keys, messages)).flatMap(item => {
      const target = normalizeAnnotationTarget(item.plain.target);
      return target && typeof item.plain.body === "string" ? [{ ...item, plain: { ...item.plain, target } }] : [];
    });
  }

  // ---- Organization messaging ------------------------------------------------
  // Rooms and chat use the same encrypted messages as crumbs. A conversation is
  // a channel name that only members can compute an index for, so the store
  // cannot tell a chat room from a web page, let alone read either.

  const ROOMS_CHANNEL = "crumbs:rooms";
  const roomChannel = (roomId: string) => `crumbs:room:${roomId}`;
  const GENERAL: CrumbsRoom = { id: "general", name: "General", own: false, fixed: true };
  interface ChatPlain { kind: "chat" | "room"; body?: string; name?: string; agent?: boolean; parent?: string; crumb?: ChatCrumb; author?: { handle: string | null; displayName: string | null; avatar: string | null } }

  async function channelMessages(userId: number, orgId: string, keys: Map<number, Buffer>, channel: string, query = "") {
    const indexes = [...keys.values()].map(key => crypto.pageIndex(key, channel));
    const { messages } = await orgStore<{ messages: OrgMessage[] }>(userId, "GET", `/orgs/${orgId}/messages?index=${indexes.join(",")}${query}`);
    return openMessages<ChatPlain>(orgId, keys, messages);
  }
  async function postToChannel(userId: number, orgId: string, epoch: number, key: Buffer, channel: string, plain: ChatPlain) {
    const id = randomUUID();
    const ciphertext = crypto.encryptJson(key, plain, orgContext(orgId, epoch));
    const device = await ensureDevice(userId);
    await orgStore(userId, "POST", `/orgs/${orgId}/messages`, { id, epoch, pageIndex: crypto.pageIndex(key, channel), ciphertext, sig: crypto.signBytes(device.signing, crypto.messageSigningInput(orgId, epoch, id, ciphertext)) });
    return id;
  }
  async function readyOrg(userId: number, orgId: string) {
    const opened = await openOrg(userId, orgId);
    const key = opened.keys.get(opened.detail.epoch);
    if (!opened.ready || !key) throw new CrumbsError(409, "Waiting for a member to share the key with this device");
    return { ...opened, key };
  }

  async function listRooms(userId: number, orgId: string): Promise<CrumbsRoom[]> {
    const me = account(userId);
    const { keys } = await readyOrg(userId, orgId);
    const rooms = (await channelMessages(userId, orgId, keys, ROOMS_CHANNEL)).filter(item => item.plain.kind === "room" && typeof item.plain.name === "string" && item.verified)
      .map(item => ({ id: item.message.id, name: item.plain.name!.slice(0, 60), own: item.message.sender === me.did, fixed: false }));
    return [GENERAL, ...rooms];
  }
  async function createRoom(userId: number, orgId: string, name: unknown): Promise<CrumbsRoom[]> {
    const label = String(name ?? "").trim().slice(0, 60);
    if (!label) throw new CrumbsError(400, "Give the room a name.");
    const { detail, key } = await readyOrg(userId, orgId);
    await postToChannel(userId, orgId, detail.epoch, key, ROOMS_CHANNEL, { kind: "room", name: label });
    return listRooms(userId, orgId);
  }
  /** Removes the room from everyone's list. Its creator or an admin may do this. */
  async function deleteRoom(userId: number, orgId: string, roomId: unknown): Promise<CrumbsRoom[]> {
    if (roomId === GENERAL.id) throw new CrumbsError(400, "General can’t be removed.");
    await orgStore(userId, "DELETE", `/orgs/${orgId}/messages/${encodeURIComponent(String(roomId))}`);
    return listRooms(userId, orgId);
  }

  /** The newest messages of a room, or only those after `after` when polling. */
  async function readChat(userId: number, orgId: string, roomId: unknown, after?: string | null): Promise<{ messages: CrumbsChatMessage[]; admin: boolean }> {
    const room = String(roomId ?? GENERAL.id);
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(room)) throw new CrumbsError(404, "Room not found.");
    const me = account(userId);
    const { detail, keys } = await readyOrg(userId, orgId);
    const opened = await channelMessages(userId, orgId, keys, roomChannel(room), after ? `&after=${encodeURIComponent(after)}` : "&latest=200");
    return { admin: detail.role === "admin", messages: opened.filter(item => item.plain.kind === "chat" && typeof item.plain.body === "string").map(({ message, plain, verified }) => ({
      id: message.id, author: plain.author?.displayName || shortHandle(plain.author?.handle) || "A member", handle: plain.author?.handle ?? null, avatar: plain.author?.avatar ?? null, did: message.sender,
      body: plain.body!, createdAt: message.createdAt, own: message.sender === me.did, ...(plain.agent ? { agent: true } : {}), ...(typeof plain.parent === "string" ? { parent: plain.parent } : {}), ...crumbOf(plain.crumb), ...(verified ? {} : { unverified: true }) })) };
  }
  /** What another member sent is checked like anything typed here. */
  function crumbOf(value: unknown): { crumb?: ChatCrumb } {
    const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const target = normalizeAnnotationTarget(raw.target);
    return target && typeof raw.body === "string" ? { crumb: { target, body: raw.body.slice(0, 4000), source: annotationPageUrl(raw.source) } } : {};
  }
  async function sendChat(userId: number, orgId: string, roomId: unknown, text: unknown, extra: { agent?: boolean; parent?: string; crumb?: ChatCrumb; author?: ChatPlain["author"] } = {}) {
    const body = typeof text === "string" ? text.trim() : "";
    if (!body || body.length > 12000) throw new CrumbsError(400, "Write between 1 and 12,000 characters.");
    const room = String(roomId ?? GENERAL.id);
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(room)) throw new CrumbsError(404, "Room not found.");
    const me = account(userId);
    const { detail, key } = await readyOrg(userId, orgId);
    return { id: await postToChannel(userId, orgId, detail.epoch, key, roomChannel(room), { kind: "chat", body, author: extra.author ?? { handle: me.handle, displayName: me.displayName, avatar: me.avatar }, ...(extra.agent ? { agent: true } : {}), ...(extra.parent ? { parent: extra.parent } : {}), ...(extra.crumb ? { crumb: extra.crumb } : {}) }) };
  }
  async function deleteChat(userId: number, orgId: string, messageId: unknown) { await orgStore(userId, "DELETE", `/orgs/${orgId}/messages/${encodeURIComponent(String(messageId))}`); }
  async function reportChat(userId: number, orgId: string, messageId: unknown, reason: unknown) {
    const { detail, key } = await readyOrg(userId, orgId);
    await orgStore(userId, "POST", `/orgs/${orgId}/reports`, { messageId: String(messageId), epoch: detail.epoch, reasonCt: crypto.encryptJson(key, { reason: String(reason ?? "").trim().slice(0, 1000) }, orgContext(orgId, detail.epoch)) });
  }


  async function readOrg(userId: number, orgId: string, pageUrl: unknown, threadId?: string | null, notice?: string): Promise<AnnotationResponse> {
    const url = annotationPageUrl(pageUrl);
    if (!url) throw new CrumbsError(400, "Open a web page first.");
    const me = account(userId);
    const { detail, keys, ready } = await openOrg(userId, orgId);
    if (!ready) return { threads: [], thread: null, messages: [], flags: [], notice: "Waiting for a member to share the key with this device" };
    const indexes = [...keys.values()].map(key => crypto.pageIndex(key, url));
    const { messages } = await orgStore<{ messages: OrgMessage[] }>(userId, "GET", `/orgs/${orgId}/messages?index=${indexes.join(",")}`);
    const readable = await decryptMessages(orgId, keys, messages);
    const groups = new Map<string, typeof readable>();
    for (const item of readable) { const id = targetId(item.plain.target); groups.set(id, [...(groups.get(id) ?? []), item]); }
    const threads: AnnotationThread[] = [...groups].map(([id, items]) => ({ id, target: items[0]!.plain.target, roomPublicId: null, rootMessageId: null, count: items.length,
      preview: `${items[0]!.plain.author?.displayName || items[0]!.plain.author?.handle || "Someone"}: ${items[0]!.plain.body}`.slice(0, 160) }));
    const selected = threadId ? groups.get(threadId) : undefined;
    let flags: AnnotationResponse["flags"] = [];
    if (selected && detail.role === "admin") {
      const { reports } = await orgStore<{ reports: Array<{ id: string; messageId: string; reporter: string; epoch: number; reasonCt: string }> }>(userId, "GET", `/orgs/${orgId}/reports`);
      const people = await profiles(reports.map(report => report.reporter));
      flags = reports.filter(report => selected.some(item => item.message.id === report.messageId)).map((report, index) => {
        let reason = "";
        try { reason = crypto.decryptJson<{ reason: string }>(keys.get(report.epoch)!, report.reasonCt, orgContext(orgId, report.epoch)).reason; } catch { /* Left blank. */ }
        const person = people.get(report.reporter);
        return { id: index + 1, author: person?.displayName || person?.handle || "A member", reason, own: false };
      });
    }
    return { threads, thread: selected ? threads.find(thread => thread.id === threadId)! : null, flags, ...(notice ? { notice } : {}),
      messages: (selected ?? []).map(({ message, plain, verified }) => ({ id: `org:${message.id}`, author: plain.author?.displayName || shortHandle(plain.author?.handle) || "A member", handle: plain.author?.handle ?? null, avatar: plain.author?.avatar ?? null,
        did: message.sender, body: plain.body, source: plain.source ?? null, createdAt: message.createdAt, own: message.sender === me.did, ...(verified ? {} : { unverified: true }), ...(detail.role === "admin" ? { canDelete: true } : {}) })) };
  }

  async function writeOrg(userId: number, orgId: string, input: Record<string, unknown>): Promise<AnnotationResponse> {
    const target = normalizeAnnotationTarget(input.target);
    if (!target) throw new CrumbsError(400, "Select content on the current page.");
    const me = account(userId);
    const { detail, keys, ready } = await openOrg(userId, orgId);
    const key = keys.get(detail.epoch);
    if (!ready || !key) throw new CrumbsError(409, "This device does not have the organization's key yet.");
    const action = String(input.action);
    const messageId = String(input.messageId ?? "").replace(/^org:/, "");
    let notice: string | undefined;
    if (action === "comment") {
      const body = typeof input.body === "string" ? input.body.trim() : "";
      if (!body || body.length > 4000) throw new CrumbsError(400, "Write between 1 and 4,000 characters.");
      const source = input.source ? annotationPageUrl(input.source) : null;
      if (input.source && !source) throw new CrumbsError(400, "Use an http or https source link.");
      const id = randomUUID();
      const plain: OrgPlaintext = { target, body, source, author: { handle: me.handle, displayName: me.displayName, avatar: me.avatar } };
      const ciphertext = crypto.encryptJson(key, plain, orgContext(orgId, detail.epoch));
      const device = await ensureDevice(userId);
      await orgStore(userId, "POST", `/orgs/${orgId}/messages`, { id, epoch: detail.epoch, pageIndex: crypto.pageIndex(key, target.url), ciphertext, sig: crypto.signBytes(device.signing, crypto.messageSigningInput(orgId, detail.epoch, id, ciphertext)) });
    } else if (action === "delete-comment") await orgStore(userId, "DELETE", `/orgs/${orgId}/messages/${encodeURIComponent(messageId)}`);
    else if (action === "flag") {
      await orgStore(userId, "POST", `/orgs/${orgId}/reports`, { messageId, epoch: detail.epoch, reasonCt: crypto.encryptJson(key, { reason: String(input.body ?? "").trim().slice(0, 1000) }, orgContext(orgId, detail.epoch)) });
      notice = "Sent to the admins";
    } else throw new CrumbsError(400, "Unknown action.");
    const threadId = targetId(target);
    const result = await readOrg(userId, orgId, target.url, undefined, notice);
    return result.threads.some(thread => thread.id === threadId) ? readOrg(userId, orgId, target.url, threadId, notice) : result;
  }

  async function orgFeed(userId: number, orgId: string, before?: string | null): Promise<{ items: CrumbsFeedItem[]; before: string | null; empty?: string }> {
    const me = account(userId);
    const { keys, name, ready } = await openOrg(userId, orgId);
    if (!ready) return { items: [], before: null, empty: "Waiting for a member to share the key with this device" };
    const { messages } = await orgStore<{ messages: OrgMessage[] }>(userId, "GET", `/orgs/${orgId}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`);
    const readable = await decryptMessages(orgId, keys, messages);
    const items: CrumbsFeedItem[] = readable.map(({ message, plain }) => ({ id: `org:${message.id}`, author: { did: message.sender, handle: plain.author?.handle ?? null, displayName: plain.author?.displayName ?? null, avatar: plain.author?.avatar ?? null },
      url: passageLink(plain.target), title: plain.target.title, target: plain.target, comment: plain.body, source: plain.source ?? null, createdAt: message.createdAt, threadCount: 1, own: message.sender === me.did, audience: name }));
    // Crumbs on one passage are one thread: the earliest starts it, the rest reply to it.
    // ponytail: threads only within this page of messages; a root on an older page leaves its replies standing alone.
    const threads = new Map<string, CrumbsFeedItem[]>();
    for (const item of items) { const key = annotationTargetKey(item.target); threads.set(key, [...threads.get(key) ?? [], item]); }
    for (const group of threads.values()) {
      const first = group.reduce((a, b) => Date.parse(b.createdAt) < Date.parse(a.createdAt) ? b : a);
      for (const item of group) { item.threadCount = group.length; if (item !== first) item.parent = { ...first }; }
    }
    return { before: messages.length === 50 ? messages[messages.length - 1]!.createdAt : null, items };
  }

  // ---- AI on top -----------------------------------------------------------

  async function pageText(url: string): Promise<string> {
    const target = new URL(url);
    if (!["http:", "https:"].includes(target.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(target.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(target.hostname)) throw new CrumbsError(400, "That page can't be read.");
    let response: Response;
    try { response = await fetcher(target.href, { signal: AbortSignal.timeout(15000), headers: { accept: "text/html,text/plain" } }); }
    catch { throw new CrumbsError(502, "The page could not be loaded to check against."); }
    if (!response.ok || !/text\/(html|plain)|xhtml/.test(response.headers.get("content-type") ?? "")) throw new CrumbsError(502, "The page could not be loaded to check against.");
    const html = (await response.text()).slice(0, 2_000_000);
    return html.replace(/<(script|style|noscript|svg|nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim().slice(0, 24_000);
  }

  /** `check`: does the source page support this comment? `summary`: what is being said about the page. */
  async function ai(userId: number, input: Record<string, unknown>): Promise<{ text: string }> {
    if (!complete) throw new CrumbsError(503, "No model is available for this.");
    const url = annotationPageUrl(input.url);
    if (!url) throw new CrumbsError(400, "Open a web page first.");
    const page = await pageText(url);
    if (input.mode === "check") {
      const claim = String(input.claim ?? "").trim().slice(0, 4000);
      if (!claim) throw new CrumbsError(400, "Choose a comment to check.");
      const passage = String(input.quote ?? "").slice(0, 4000);
      return { text: await complete(userId, "You check a reader's comment against the web page it was written about. Use only the page text you are given. Start with one word on its own line: Supported, Contradicted, Partly, or Unclear. Then explain in two to four plain sentences, quoting the most relevant sentence from the page. If the page does not cover the point, say so. No headings, no lists.",
        `Page: ${url}\n\nPage text:\n${page}\n\n${passage ? `Highlighted passage:\n${passage}\n\n` : ""}Comment to check:\n${claim}`) };
    }
    const scope = String(input.scope ?? "public");
    const reading = scope.startsWith("org:") ? await readOrg(userId, scope.slice(4), url) : await readPublic(userId, url);
    const lines: string[] = [];
    for (const thread of reading.threads.slice(0, 40)) {
      const detail = scope.startsWith("org:") ? await readOrg(userId, scope.slice(4), url, thread.id) : await readPublic(userId, url, thread.id);
      lines.push(`Passage: ${thread.target.kind === "text" ? `"${(thread.target.quote ?? "").slice(0, 300)}"` : thread.target.kind}`, ...detail.messages.slice(0, 30).map(message => `- ${message.author}: ${message.body.slice(0, 600)}`), "");
    }
    if (!lines.length) return { text: "Nobody has left a crumb on this page yet." };
    return { text: await complete(userId, "You summarise what readers are saying about a web page, for someone about to read it. In at most five plain sentences: the main points of agreement and disagreement, and which passages draw the most attention. Attribute views to commenters by name. Do not add opinions of your own. No headings, no lists.",
      `Page: ${url}\n\nPage text (for context):\n${page.slice(0, 8000)}\n\nComments by passage:\n${lines.join("\n").slice(0, 16_000)}`) };
  }

  return { status, startSignIn, finishSignIn, signOut, typeahead, readPublic, writePublic, feed, follows, follow, deleteMine, claimHandle,
    listNotes, addNote, deleteNote, rateNote, listRooms, createRoom, deleteRoom, readChat, sendChat, deleteChat, reportChat, listOrgs, createOrg, orgDetail, addOrgMember, removeOrgMember, leaveOrg, deleteOrg, dismissOrgReport, readOrg, writeOrg, ai,
    setDefaultVisibility(userId: number, value: unknown) {
      const visibility = String(value);
      if (visibility !== "private" && visibility !== "public" && !/^org:[a-zA-Z0-9-]{8,64}$/.test(visibility)) throw new CrumbsError(400, "Choose who sees your crumbs by default.");
      account(userId); store.setDefaultVisibility(db, userId, visibility as CrumbsVisibility);
    },
    setServers(input: { indexer?: unknown; orgStore?: unknown; publicMode?: unknown }) {
      if (input.publicMode !== undefined) {
        if (input.publicMode !== "records" && input.publicMode !== "posts") throw new CrumbsError(400, "Choose how public crumbs are stored.");
        store.setSetting(db, "public_mode", input.publicMode);
      }
      for (const [key, value] of [["indexer_url", input.indexer], ["org_store_url", input.orgStore]] as const) {
        if (value === undefined) continue;
        const text = String(value ?? "").trim().replace(/\/+$/, "");
        if (text && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(text)) throw new CrumbsError(400, "Enter a server address starting with https://.");
        store.setSetting(db, key, text || null);
      }
      return servers();
    },
  };
}
export type Crumbs = ReturnType<typeof createCrumbs>;
