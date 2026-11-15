// AT Protocol OAuth for a desktop app: pushed authorization requests, PKCE and
// DPoP-bound tokens, as a public client with a loopback redirect. The password
// is only ever typed on the account's own server; Breadboard sees a
// short-lived token bound to a key that never leaves this machine.
//
// This follows the same flow as the official @atproto/oauth-client packages.
// It is written against node:crypto so the dashboard gains no new packages.
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export interface DpopKey { kty: "EC"; crv: "P-256"; x: string; y: string; d: string }
export interface AuthorizationServer { issuer: string; pushed_authorization_request_endpoint: string; authorization_endpoint: string; token_endpoint: string }
export interface PendingAuthorization {
  state: string; verifier: string; dpopKey: DpopKey; issuer: string; clientId: string; redirectUri: string;
  /** Known when sign-in started from a handle; absent for sign-up. */
  did?: string;
}
export interface TokenSet { did: string; pds: string; issuer: string; clientId: string; dpopKey: DpopKey; accessToken: string; refreshToken: string | null; expiresAt: number; scope: string }
export class OAuthError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export const OAUTH_SCOPE = "atproto transition:generic";
const env = (name: string) => process.env[name]?.replace(/\/+$/, "");
const plcUrl = () => env("CRUMBS_PLC_URL") ?? "https://plc.directory";
const appviewUrl = () => env("CRUMBS_APPVIEW_URL") ?? "https://public.api.bsky.app";
/** Where accounts are created when someone has none yet. */
export const signupServer = () => env("CRUMBS_SIGNUP_SERVER") ?? "https://bsky.social";
const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const HANDLE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DID = /^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.%:-]{1,253})$/;
export const isDid = (value: unknown): value is string => typeof value === "string" && DID.test(value);
export const normalizeHandle = (value: unknown) => {
  const handle = String(value ?? "").trim().replace(/^@/, "").toLowerCase();
  return HANDLE.test(handle) && handle.length <= 253 ? handle : null;
};

/** A client id for a loopback app, as the AT Protocol OAuth profile defines it. */
export function loopbackClientId(redirectUri: string, scope = OAUTH_SCOPE) {
  return `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
}

export function generateDpopKey(): DpopKey {
  const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
  return { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y!, d: jwk.d! };
}

export function dpopProof(key: DpopKey, method: string, url: string, nonce?: string, accessToken?: string) {
  const target = new URL(url);
  const header = { typ: "dpop+jwt", alg: "ES256", jwk: { kty: key.kty, crv: key.crv, x: key.x, y: key.y } };
  const payload = { jti: b64(randomBytes(16)), htm: method, htu: target.origin + target.pathname, iat: Math.floor(Date.now() / 1000),
    ...(nonce ? { nonce } : {}), ...(accessToken ? { ath: b64(createHash("sha256").update(accessToken).digest()) } : {}) };
  const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key: createPrivateKey({ key: { ...key }, format: "jwk" }), dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

// Servers hand out a fresh DPoP nonce per origin and expect it back.
const nonces = new Map<string, string>();

/** A request carrying a DPoP proof. Retries once when the server asks for a newer nonce. */
export async function dpopFetch(fetcher: Fetcher, key: DpopKey, url: string, init: { method: string; headers?: Record<string, string>; body?: string }, accessToken?: string): Promise<Response> {
  const origin = new URL(url).origin;
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(url, { method: init.method, body: init.body, signal: AbortSignal.timeout(20000), headers: { ...init.headers,
      DPoP: dpopProof(key, init.method, url, nonces.get(origin), accessToken), ...(accessToken ? { Authorization: `DPoP ${accessToken}` } : {}) } });
    const nonce = response.headers.get("dpop-nonce");
    if (nonce) nonces.set(origin, nonce);
    if (attempt > 0 || !nonce || ![400, 401].includes(response.status)) return response;
    const challenge = response.headers.get("www-authenticate") ?? "";
    const body = challenge.includes("use_dpop_nonce") ? "" : await response.clone().text().catch(() => "");
    if (!challenge.includes("use_dpop_nonce") && !body.includes("use_dpop_nonce")) return response;
  }
}

async function json<T>(fetcher: Fetcher, url: string): Promise<T> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(10000), headers: { accept: "application/json" }, redirect: "error" });
  if (!response.ok) throw new OAuthError(`${new URL(url).host} answered ${response.status}.`, 502);
  return await response.json() as T;
}

interface DidDocument { id?: string; alsoKnownAs?: string[]; service?: Array<{ id?: string; serviceEndpoint?: unknown }> }
export async function resolveIdentity(fetcher: Fetcher, did: string): Promise<{ did: string; handle: string | null; pds: string }> {
  if (!isDid(did)) throw new OAuthError("That account id is not valid.");
  const host = did.startsWith("did:web:") ? decodeURIComponent(did.slice(8).split(":")[0]!) : "";
  const doc = await json<DidDocument>(fetcher, did.startsWith("did:plc:") ? `${plcUrl()}/${did}` : `${/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https"}://${host}/.well-known/did.json`);
  if (doc.id !== did) throw new OAuthError("The account's identity document does not match.", 502);
  const endpoint = (doc.service ?? []).find(item => item.id === "#atproto_pds" || item.id === `${did}#atproto_pds`)?.serviceEndpoint;
  if (typeof endpoint !== "string" || !/^https?:\/\//.test(endpoint)) throw new OAuthError("This account has no data server.", 502);
  const aka = (doc.alsoKnownAs ?? []).find(value => typeof value === "string" && value.startsWith("at://"));
  return { did, handle: aka ? aka.slice(5) : null, pds: endpoint.replace(/\/+$/, "") };
}

/** Handle to account, checked in both directions so a handle cannot point at someone else's account. */
export async function resolveHandle(fetcher: Fetcher, handle: string) {
  let did: string | undefined;
  try { did = (await json<{ did?: string }>(fetcher, `${appviewUrl()}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`)).did; }
  catch { /* Fall through to the handle's own domain. */ }
  if (!did) {
    try { did = (await (await fetcher(`https://${handle}/.well-known/atproto-did`, { signal: AbortSignal.timeout(5000), redirect: "error" })).text()).trim(); }
    catch { /* Reported below. */ }
  }
  if (!isDid(did)) throw new OAuthError(`No account found for ${handle}. Check the spelling.`, 404);
  const identity = await resolveIdentity(fetcher, did);
  if (identity.handle !== handle) throw new OAuthError(`${handle} does not point back to its account. Try again in a minute.`, 409);
  return identity;
}

export async function authorizationServerFor(fetcher: Fetcher, pds: string): Promise<AuthorizationServer> {
  const resource = await json<{ authorization_servers?: string[] }>(fetcher, `${pds}/.well-known/oauth-protected-resource`);
  const issuer = resource.authorization_servers?.[0];
  if (typeof issuer !== "string") throw new OAuthError("This account's server does not allow signing in from apps.", 502);
  return authorizationServer(fetcher, issuer);
}
export async function authorizationServer(fetcher: Fetcher, issuer: string): Promise<AuthorizationServer> {
  const base = issuer.replace(/\/+$/, "");
  const meta = await json<AuthorizationServer>(fetcher, `${base}/.well-known/oauth-authorization-server`);
  if (meta.issuer !== base || !meta.pushed_authorization_request_endpoint || !meta.authorization_endpoint || !meta.token_endpoint) throw new OAuthError("The sign-in server sent an unexpected description.", 502);
  return meta;
}

async function tokenError(response: Response, fallback: string) {
  const detail = await response.json().catch(() => null) as { error?: string; error_description?: string } | null;
  return new OAuthError(detail?.error_description ?? detail?.error ?? fallback, response.status >= 500 ? 502 : 400);
}

/**
 * Begin sign-in. With a handle, the account's own server is used and the handle
 * is prefilled; without one, the sign-up server opens on its create-account screen.
 */
export async function startAuthorization(fetcher: Fetcher, input: { handle?: string; redirectUri: string; clientId?: string }): Promise<{ url: string; pending: PendingAuthorization }> {
  const identity = input.handle ? await resolveHandle(fetcher, input.handle) : null;
  const server = identity ? await authorizationServerFor(fetcher, identity.pds) : await authorizationServer(fetcher, signupServer());
  const clientId = input.clientId ?? loopbackClientId(input.redirectUri);
  const state = b64(randomBytes(24)), verifier = b64(randomBytes(48)), dpopKey = generateDpopKey();
  const form = new URLSearchParams({ client_id: clientId, redirect_uri: input.redirectUri, response_type: "code", scope: OAUTH_SCOPE, state,
    code_challenge: b64(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
    ...(identity ? { login_hint: input.handle! } : { prompt: "create" }) });
  const response = await dpopFetch(fetcher, dpopKey, server.pushed_authorization_request_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  if (!response.ok) throw await tokenError(response, "The sign-in server refused the request.");
  const { request_uri: requestUri } = await response.json() as { request_uri?: string };
  if (!requestUri) throw new OAuthError("The sign-in server sent no request.", 502);
  const url = new URL(server.authorization_endpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("request_uri", requestUri);
  return { url: url.href, pending: { state, verifier, dpopKey, issuer: server.issuer, clientId, redirectUri: input.redirectUri, did: identity?.did } };
}

interface TokenResponse { access_token?: string; refresh_token?: string; token_type?: string; sub?: string; scope?: string; expires_in?: number }
function tokenSet(body: TokenResponse, base: { did: string; pds: string; issuer: string; clientId: string; dpopKey: DpopKey }, previousRefresh: string | null = null): TokenSet {
  if (!body.access_token || body.token_type?.toLowerCase() !== "dpop") throw new OAuthError("The sign-in server sent an unusable token.", 502);
  return { ...base, accessToken: body.access_token, refreshToken: body.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + Math.max(30, Number(body.expires_in) || 300) * 1000, scope: body.scope ?? OAUTH_SCOPE };
}

/** Exchange the code from the redirect for tokens, and confirm who they belong to. */
export async function finishAuthorization(fetcher: Fetcher, pending: PendingAuthorization, params: { code?: string | null; iss?: string | null; error?: string | null; errorDescription?: string | null }): Promise<TokenSet> {
  if (params.error) throw new OAuthError(params.error === "access_denied" ? "Sign in was cancelled." : params.errorDescription ?? params.error);
  if (!params.code) throw new OAuthError("The sign-in server sent no code.");
  if (params.iss && params.iss.replace(/\/+$/, "") !== pending.issuer) throw new OAuthError("The reply came from a different sign-in server.");
  const server = await authorizationServer(fetcher, pending.issuer);
  const form = new URLSearchParams({ grant_type: "authorization_code", code: params.code, redirect_uri: pending.redirectUri, client_id: pending.clientId, code_verifier: pending.verifier });
  const response = await dpopFetch(fetcher, pending.dpopKey, server.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  if (!response.ok) throw await tokenError(response, "Could not sign in.");
  const body = await response.json() as TokenResponse;
  if (!isDid(body.sub) || (pending.did && body.sub !== pending.did)) throw new OAuthError("The sign-in server answered for a different account.", 502);
  if (!String(body.scope ?? "").split(" ").includes("atproto")) throw new OAuthError("The sign-in server did not grant account access.", 502);
  // The account named by the token must itself point at this sign-in server.
  const identity = await resolveIdentity(fetcher, body.sub);
  if ((await authorizationServerFor(fetcher, identity.pds)).issuer !== pending.issuer) throw new OAuthError("That account is not served by this sign-in server.", 502);
  return tokenSet(body, { did: body.sub, pds: identity.pds, issuer: pending.issuer, clientId: pending.clientId, dpopKey: pending.dpopKey });
}

export async function refreshTokens(fetcher: Fetcher, current: TokenSet): Promise<TokenSet> {
  if (!current.refreshToken) throw new OAuthError("Sign in to Crumbs again.", 401);
  const server = await authorizationServer(fetcher, current.issuer);
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: current.clientId });
  const response = await dpopFetch(fetcher, current.dpopKey, server.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  if (!response.ok) throw response.status >= 500 ? new OAuthError("The account server is unavailable. Try again shortly.", 502) : new OAuthError("Sign in to Crumbs again.", 401);
  const body = await response.json() as TokenResponse;
  if (body.sub && body.sub !== current.did) throw new OAuthError("The sign-in server answered for a different account.", 502);
  return tokenSet(body, current, current.refreshToken);
}

/** Best effort: tell the server to forget the tokens when the user signs out. */
export async function revokeTokens(fetcher: Fetcher, current: TokenSet) {
  try {
    const meta = await json<{ revocation_endpoint?: string }>(fetcher, `${current.issuer}/.well-known/oauth-authorization-server`);
    if (!meta.revocation_endpoint) return;
    const form = new URLSearchParams({ token: current.refreshToken ?? current.accessToken, client_id: current.clientId });
    await dpopFetch(fetcher, current.dpopKey, meta.revocation_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  } catch { /* The local copy is deleted either way. */ }
}
