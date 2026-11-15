// Public, unauthenticated AT Protocol reads: identity documents and records.
// Every base URL can be overridden so the test suite runs against local fakes.
const env = name => process.env[name]?.replace(/\/+$/, "");
export const endpoints = {
  plc: () => env("CRUMBS_PLC_URL") ?? "https://plc.directory",
  appview: () => env("CRUMBS_APPVIEW_URL") ?? "https://public.api.bsky.app",
  labeler: () => env("CRUMBS_LABELER_URL") ?? "https://mod.bsky.app",
};

const DID = /^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.%:-]{1,253})$/;
export const isDid = value => typeof value === "string" && DID.test(value);

const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return value;
}
export const forgetIdentity = did => { for (const key of cache.keys()) if (key.includes(did)) cache.delete(key); };

async function json(url, timeoutMs = 10000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
  if (!response.ok) throw Object.assign(new Error(`${response.status} from ${new URL(url).host}`), { status: response.status });
  return response.json();
}

export function resolveDid(did) {
  if (!isDid(did)) throw new Error("Not a DID.");
  return cached(`doc:${did}`, 10 * 60_000, () => {
    if (did.startsWith("did:plc:")) return json(`${endpoints.plc()}/${did}`);
    const host = decodeURIComponent(did.slice(8).split(":")[0]);
    return json(`${/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https"}://${host}/.well-known/did.json`);
  });
}

export async function pdsOf(did) {
  const doc = await resolveDid(did);
  const service = (doc.service ?? []).find(item => item.id === "#atproto_pds" || item.id === `${did}#atproto_pds`);
  const url = typeof service?.serviceEndpoint === "string" ? service.serviceEndpoint.replace(/\/+$/, "") : null;
  if (!url || !/^https?:\/\//.test(url)) throw new Error("This account has no data server.");
  return url;
}

export async function handleOf(did) {
  const doc = await resolveDid(did);
  const aka = (doc.alsoKnownAs ?? []).find(value => typeof value === "string" && value.startsWith("at://"));
  return aka ? aka.slice(5) : null;
}

/** A record read straight from its author's data server, or null when it is gone. */
export async function getRecord(did, collection, rkey) {
  const pds = await pdsOf(did);
  try {
    return await json(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`);
  } catch (error) { if (error.status === 400 || error.status === 404) return null; throw error; }
}

export async function listRecords(did, collection, limit = 100) {
  const pds = await pdsOf(did);
  try {
    const page = await json(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&limit=${limit}`);
    return Array.isArray(page.records) ? page.records : [];
  } catch (error) { if (error.status === 400 || error.status === 404) return []; throw error; }
}

/** Display details from the Bluesky AppView. A missing or suspended profile answers null. */
export async function profileOf(did) {
  try {
    const profile = await json(`${endpoints.appview()}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`);
    return { handle: profile.handle ?? null, displayName: profile.displayName ?? null, avatar: profile.avatar ?? null };
  } catch (error) {
    if (error.status === 400 || error.status === 404) return null;
    throw error;
  }
}

/** Account-level labels from Bluesky's moderation service, with negations applied. */
export async function accountLabels(did) {
  const page = await json(`${endpoints.labeler()}/xrpc/com.atproto.label.queryLabels?uriPatterns=${encodeURIComponent(did)}&limit=100`);
  const active = new Map();
  for (const label of (page.labels ?? []).sort((a, b) => String(a.cts).localeCompare(String(b.cts)))) {
    if (label.uri !== did) continue;
    if (label.neg) active.delete(label.val); else if (!label.exp || Date.parse(label.exp) > Date.now()) active.set(label.val, true);
  }
  return [...active.keys()];
}

export const parseAtUri = uri => {
  const match = /^at:\/\/(did:[a-z]+:[a-zA-Z0-9.%:-]+)\/([a-zA-Z0-9.-]+)\/([a-zA-Z0-9._~:-]{1,512})$/.exec(String(uri));
  return match ? { did: match[1], collection: match[2], rkey: match[3] } : null;
};
