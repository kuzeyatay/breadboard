// A local stand-in for the parts of the AT Protocol network the services read:
// the PLC directory, account data servers, the Bluesky AppView, the labeler,
// the relay's collection listing, and a Jetstream socket the test can push to.
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const b64 = value => Buffer.from(value).toString("base64url");
const thumbprint = jwk => b64(createHash("sha256").update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest());
/** Check a DPoP proof the way an AT Protocol server does. Returns the key thumbprint, or a reason it failed. */
function checkDpop(request, origin, nonce, accessToken) {
  const proof = request.headers.dpop;
  if (!proof) return { error: "missing proof" };
  const [h, p, sig] = String(proof).split(".");
  const header = JSON.parse(Buffer.from(h, "base64url")), payload = JSON.parse(Buffer.from(p, "base64url"));
  if (header.typ !== "dpop+jwt" || header.alg !== "ES256" || header.jwk?.d) return { error: "bad header" };
  if (!verify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: header.jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))) return { error: "bad signature" };
  if (payload.htm !== request.method || payload.htu !== origin + new URL(request.url, origin).pathname) return { error: "wrong method or url" };
  if (Math.abs(Date.now() / 1000 - payload.iat) > 60 || !payload.jti) return { error: "stale" };
  if (payload.nonce !== nonce) return { error: "use_dpop_nonce" };
  if (accessToken && payload.ath !== b64(createHash("sha256").update(accessToken).digest())) return { error: "wrong ath" };
  return { jkt: thumbprint(header.jwk) };
}

export async function startFakeNetwork() {
  const state = { records: new Map(), profiles: new Map(), labels: [], sockets: new Set(), subscribeUrls: [], follows: new Map(),
    oauth: { nonce: "nonce-1", requests: new Map(), codes: new Map(), access: new Map(), refresh: new Map(), expiresIn: 300, pars: [], revoked: 0 }, handleUpdates: [], rkey: 0 };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://local");
    const send = (status, body, headers = {}) => { response.writeHead(status, { "content-type": "application/json", "dpop-nonce": state.oauth.nonce, ...headers }); response.end(JSON.stringify(body)); };
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const oauth = state.oauth;

    // ---- OAuth authorization server ----
    if (url.pathname === "/.well-known/oauth-protected-resource") return send(200, { resource: origin, authorization_servers: [origin] });
    if (url.pathname === "/.well-known/oauth-authorization-server") return send(200, { issuer: origin, pushed_authorization_request_endpoint: `${origin}/oauth/par`,
      authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`, revocation_endpoint: `${origin}/oauth/revoke` });
    if (url.pathname.startsWith("/oauth/") && request.method === "POST") {
      const proof = checkDpop(request, origin, oauth.nonce);
      if (proof.error) return send(400, { error: proof.error === "use_dpop_nonce" ? "use_dpop_nonce" : "invalid_dpop_proof", error_description: proof.error });
      const form = new URLSearchParams(raw);
      if (url.pathname === "/oauth/par") {
        const redirect = new URL(form.get("redirect_uri"));
        if (redirect.hostname !== "127.0.0.1" || !form.get("client_id").startsWith("http://localhost?") || form.get("code_challenge_method") !== "S256" || form.get("response_type") !== "code") return send(400, { error: "invalid_request" });
        const requestUri = `urn:ietf:params:oauth:request_uri:${b64(randomBytes(12))}`;
        oauth.requests.set(requestUri, { params: Object.fromEntries(form), jkt: proof.jkt });
        oauth.pars.push(Object.fromEntries(form));
        return send(201, { request_uri: requestUri, expires_in: 300 });
      }
      if (url.pathname === "/oauth/token") {
        let did;
        if (form.get("grant_type") === "authorization_code") {
          const grant = oauth.codes.get(form.get("code")); oauth.codes.delete(form.get("code"));
          if (!grant || grant.jkt !== proof.jkt || grant.params.redirect_uri !== form.get("redirect_uri") || grant.params.client_id !== form.get("client_id")
            || b64(createHash("sha256").update(form.get("code_verifier") ?? "").digest()) !== grant.params.code_challenge) return send(400, { error: "invalid_grant" });
          did = grant.did;
        } else if (form.get("grant_type") === "refresh_token") {
          const grant = oauth.refresh.get(form.get("refresh_token")); oauth.refresh.delete(form.get("refresh_token"));
          if (!grant || grant.jkt !== proof.jkt) return send(400, { error: "invalid_grant" });
          did = grant.did;
        } else return send(400, { error: "unsupported_grant_type" });
        const access = b64(randomBytes(18)), refresh = b64(randomBytes(18));
        oauth.access.set(access, { did, jkt: proof.jkt, expires: Date.now() + oauth.expiresIn * 1000 });
        oauth.refresh.set(refresh, { did, jkt: proof.jkt });
        return send(200, { access_token: access, refresh_token: refresh, token_type: "DPoP", sub: did, scope: "atproto transition:generic", expires_in: oauth.expiresIn });
      }
      if (url.pathname === "/oauth/revoke") { oauth.revoked++; oauth.refresh.delete(form.get("token")); return send(200, {}); }
    }

    // The account server's own sign-in screen: the one page Breadboard does not draw.
    if (url.pathname === "/oauth/authorize" && request.method === "GET") {
      const saved = oauth.requests.get(url.searchParams.get("request_uri"));
      if (!saved) { response.writeHead(400, { "content-type": "text/html" }); return response.end("<h1>Unknown request</h1>"); }
      const hinted = [...state.profiles.values()].find(profile => profile.handle === saved.params.login_hint);
      const choices = saved.params.prompt === "create" ? [{ did: "create", handle: "Create a new account" }] : hinted ? [hinted] : [...state.profiles.values()];
      response.writeHead(200, { "content-type": "text/html" });
      return response.end(`<!doctype html><title>Account server sign-in</title><body style="font:16px system-ui;max-width:420px;margin:80px auto"><h1>Sign in</h1><p>Password: <input type="password" aria-label="Password" value="${hinted ? "" : ""}"></p>${choices.map(profile =>
        `<form method="get" action="/oauth/approve"><input type="hidden" name="request_uri" value="${url.searchParams.get("request_uri")}"><input type="hidden" name="client_id" value="${url.searchParams.get("client_id").replace(/"/g, "&quot;")}"><input type="hidden" name="did" value="${profile.did}"><button>Continue as ${profile.handle}</button></form>`).join("")}</body>`);
    }
    if (url.pathname === "/oauth/approve" && request.method === "GET") {
      let did = url.searchParams.get("did");
      if (did === "create") { did = `did:plc:${"newaccount".padEnd(24, "a")}`; state.profiles.set(did, { did, handle: "newbie.test", displayName: "Newbie", avatar: null }); }
      const authorize = new URL(`${origin}/oauth/authorize`);
      authorize.searchParams.set("request_uri", url.searchParams.get("request_uri")); authorize.searchParams.set("client_id", url.searchParams.get("client_id"));
      const saved = oauth.requests.get(url.searchParams.get("request_uri"));
      if (!saved) { response.writeHead(400); return response.end("Unknown request"); }
      oauth.requests.delete(url.searchParams.get("request_uri"));
      const code = b64(randomBytes(12));
      oauth.codes.set(code, { ...saved, did });
      response.writeHead(302, { location: `${saved.params.redirect_uri}?${new URLSearchParams({ code, state: saved.params.state, iss: origin })}` });
      return response.end();
    }

    // ---- Writes to the account's data server, as the signed-in user ----
    if (["/xrpc/com.atproto.repo.createRecord", "/xrpc/com.atproto.repo.putRecord", "/xrpc/com.atproto.repo.deleteRecord", "/xrpc/com.atproto.identity.updateHandle", "/xrpc/com.atproto.moderation.createReport"].includes(url.pathname)) {
      const token = String(request.headers.authorization ?? "").replace(/^DPoP /, "");
      const grant = oauth.access.get(token);
      if (!grant || grant.expires < Date.now()) return send(401, { error: "invalid_token", message: "Token expired" });
      const proof = checkDpop(request, origin, oauth.nonce, token);
      if (proof.error) return send(401, { error: proof.error }, proof.error === "use_dpop_nonce" ? { "www-authenticate": 'DPoP error="use_dpop_nonce"' } : {});
      if (proof.jkt !== grant.jkt) return send(401, { error: "invalid_token", message: "Key mismatch" });
      const body = JSON.parse(raw || "{}");
      if (url.pathname.endsWith("createReport")) { (state.moderationReports ??= []).push({ by: grant.did, ...body }); return send(200, { id: state.moderationReports.length }); }
      if (url.pathname.endsWith("updateHandle")) {
        if (state.rejectHandleUpdate) return send(400, { error: "InvalidRequest", message: "Handle changes are not available to this app" });
        state.handleUpdates.push({ did: grant.did, handle: body.handle }); state.profiles.get(grant.did).handle = body.handle; return send(200, {});
      }
      if (body.repo !== grant.did) return send(403, { error: "Forbidden", message: "Not your repository" });
      const rkey = body.rkey ?? `3k${String(++state.rkey).padStart(11, "0")}`;
      const uri = `at://${body.repo}/${body.collection}/${rkey}`;
      if (url.pathname.endsWith("deleteRecord")) { state.records.delete(uri); return send(200, {}); }
      state.records.set(uri, body.record);
      return send(200, { uri, cid: "bafytest" });
    }

    // ---- AppView extras ----
    if (url.pathname === "/xrpc/com.atproto.identity.resolveHandle") {
      const found = [...state.profiles.values()].find(profile => profile.handle === url.searchParams.get("handle"));
      return found ? send(200, { did: found.did }) : send(400, { error: "InvalidRequest", message: "Unable to resolve handle" });
    }
    const postView = ([uri, record]) => ({ uri, cid: "bafytest", author: state.profiles.get(uri.split("/")[2]) ?? { did: uri.split("/")[2] }, record, labels: state.postLabels?.get(uri) ?? [] });
    const postLinks = record => [record.embed?.external?.uri, ...(record.facets ?? []).flatMap(facet => (facet.features ?? []).map(feature => feature.uri))].filter(Boolean);
    if (url.pathname === "/xrpc/app.bsky.feed.searchPosts") {
      const wanted = url.searchParams.get("url"), author = url.searchParams.get("author"), q = url.searchParams.get("q");
      // Like the real search: `url` matches links with their fragment ignored.
      const posts = [...state.records].filter(([uri]) => uri.split("/")[3] === "app.bsky.feed.post" && !state.searchLag?.has(uri)).filter(([uri, record]) =>
        (!author || uri.split("/")[2] === author) && (!wanted || postLinks(record).some(link => link.split("#")[0] === wanted.split("#")[0])) && (q === "*" || (q === "#:~:text=" && postLinks(record).some(link => link.includes(q))) || String(record.text).includes(q)));
      return send(200, { posts: posts.map(postView) });
    }
    if (url.pathname === "/xrpc/app.bsky.feed.getPosts") return send(200, { posts: [...state.records].filter(([uri]) => url.searchParams.getAll("uris").includes(uri)).map(postView) });
    if (url.pathname === "/xrpc/app.bsky.actor.getProfiles") return send(200, { profiles: url.searchParams.getAll("actors").map(actor => state.profiles.get(actor)).filter(Boolean) });
    if (url.pathname === "/xrpc/app.bsky.graph.getFollows") return send(200, { follows: (state.follows.get(url.searchParams.get("actor")) ?? []).map(did => ({ did })) });
    if (url.pathname === "/xrpc/app.bsky.actor.searchActorsTypeahead") return send(200, { actors: [...state.profiles.values()].filter(profile => profile.handle.startsWith(url.searchParams.get("q"))) });
    if (url.pathname === "/article") { response.writeHead(200, { "content-type": "text/html" }); return response.end(state.article ?? "<html><body><p>Nothing here.</p></body></html>"); }

    const did = decodeURIComponent(url.pathname.slice(1));
    if (did.startsWith("did:plc:")) return send(200, { id: did, alsoKnownAs: [`at://${state.profiles.get(did)?.handle ?? "unknown.test"}`], service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: origin }] });
    if (url.pathname === "/xrpc/com.atproto.repo.getRecord") {
      const uri = `at://${url.searchParams.get("repo")}/${url.searchParams.get("collection")}/${url.searchParams.get("rkey")}`;
      const value = state.records.get(uri);
      return value ? send(200, { uri, cid: "bafytest", value }) : send(400, { error: "RecordNotFound" });
    }
    if (url.pathname === "/xrpc/com.atproto.repo.listRecords") {
      const prefix = `at://${url.searchParams.get("repo")}/${url.searchParams.get("collection")}/`;
      return send(200, { records: [...state.records].filter(([uri]) => uri.startsWith(prefix)).map(([uri, value]) => ({ uri, cid: "bafytest", value })) });
    }
    if (url.pathname === "/xrpc/app.bsky.actor.getProfile") {
      const profile = state.profiles.get(url.searchParams.get("actor"));
      return profile ? send(200, profile) : send(400, { error: "AccountTakedown" });
    }
    if (url.pathname === "/xrpc/com.atproto.label.queryLabels") return send(200, { labels: state.labels.filter(label => label.uri === url.searchParams.get("uriPatterns")) });
    if (url.pathname === "/xrpc/com.atproto.sync.listReposByCollection") {
      const collection = url.searchParams.get("collection");
      const dids = new Set([...state.records.keys()].filter(uri => uri.split("/")[3] === collection).map(uri => uri.split("/")[2]));
      return send(200, { repos: [...dids].map(did => ({ did })) });
    }
    send(404, { error: "NotFound" });
  });
  const sockets = new WebSocketServer({ server, path: "/subscribe" });
  sockets.on("connection", (socket, request) => { state.subscribeUrls.push(request.url); state.sockets.add(socket); socket.on("close", () => state.sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const name of ["CRUMBS_PLC_URL", "CRUMBS_APPVIEW_URL", "CRUMBS_LABELER_URL"]) process.env[name] = origin;
  let clock = 1_700_000_000_000_000;
  return {
    origin, state,
    jetstream: origin.replace("http", "ws"),
    account(did, handle) { state.profiles.set(did, { did, handle, displayName: handle.split(".")[0], avatar: `https://cdn.test/${handle}.jpg` }); },
    /** Store a record on the fake data server and return the Jetstream event for it. */
    put(did, collection, rkey, record) {
      state.records.set(`at://${did}/${collection}/${rkey}`, record);
      return { did, time_us: ++clock, kind: "commit", commit: { rev: "r", operation: "create", collection, rkey, record, cid: "bafytest" } };
    },
    remove(did, collection, rkey) {
      state.records.delete(`at://${did}/${collection}/${rkey}`);
      return { did, time_us: ++clock, kind: "commit", commit: { rev: "r", operation: "delete", collection, rkey } };
    },
    push(event) { for (const socket of state.sockets) socket.send(JSON.stringify(event)); },
    /** What the account's server does once the person approves on its own screen: redirect back with a code. */
    approve(authorizeUrl, did) {
      const url = new URL(authorizeUrl);
      const saved = state.oauth.requests.get(url.searchParams.get("request_uri"));
      if (!saved || saved.params.client_id !== url.searchParams.get("client_id")) throw new Error("unknown authorization request");
      state.oauth.requests.delete(url.searchParams.get("request_uri"));
      const code = b64(randomBytes(12));
      state.oauth.codes.set(code, { ...saved, did });
      return new URLSearchParams({ code, state: saved.params.state, iss: origin });
    },
    async close() { for (const socket of state.sockets) socket.terminate(); sockets.close(); await new Promise(resolve => server.close(resolve)); },
  };
}

export const did = n => `did:plc:${String(n).padStart(24, "a").replace(/[^a-z2-7]/g, "b")}`;
