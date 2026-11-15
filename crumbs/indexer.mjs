// The Crumbs indexer: reads Breadboard's record types from Jetstream, runs each
// public highlight through the moderation gate, and answers "what is on this
// page" and "what did the people I follow leave". Everything here can be
// rebuilt from the network, so the database is a cache and needs no backups.
import { fileURLToPath } from "node:url";
import { openDatabase } from "./lib/db.mjs";
import { HttpError, rateLimit, requireAdmin, serve } from "./lib/http.mjs";
import { moderate, localVerdict } from "./lib/moderation.mjs";
import { accountLabels, forgetIdentity, getRecord, isDid, listRecords, parseAtUri, profileOf } from "./lib/atproto.mjs";
import { COLLECTIONS, annotationPageUrl, parseHighlightRecord, targetDigest } from "./lib/targets.mjs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS highlights (
  uri TEXT PRIMARY KEY, did TEXT NOT NULL, cid TEXT NOT NULL DEFAULT '', page_url TEXT NOT NULL, target_key TEXT NOT NULL,
  target_json TEXT NOT NULL, comment TEXT NOT NULL, source TEXT, created_at TEXT NOT NULL, indexed_at TEXT NOT NULL,
  status TEXT NOT NULL, reason TEXT, admin_state TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS highlights_page ON highlights(page_url, created_at);
CREATE INDEX IF NOT EXISTS highlights_author ON highlights(did, created_at);
CREATE INDEX IF NOT EXISTS highlights_recent ON highlights(created_at);
CREATE TABLE IF NOT EXISTS reports (uri TEXT PRIMARY KEY, did TEXT NOT NULL, subject TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS reports_subject ON reports(subject);
CREATE TABLE IF NOT EXISTS notes (uri TEXT PRIMARY KEY, did TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, source TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL, reason TEXT);
CREATE INDEX IF NOT EXISTS notes_subject ON notes(subject);
CREATE TABLE IF NOT EXISTS ratings (uri TEXT PRIMARY KEY, did TEXT NOT NULL, subject TEXT NOT NULL, helpful INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ratings_subject ON ratings(subject);
CREATE TABLE IF NOT EXISTS follows (uri TEXT PRIMARY KEY, did TEXT NOT NULL, subject TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS follows_did ON follows(did);
CREATE TABLE IF NOT EXISTS handles (name TEXT PRIMARY KEY, did TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS accounts (
  did TEXT PRIMARY KEY, handle TEXT, display_name TEXT, avatar TEXT, active INTEGER NOT NULL DEFAULT 1,
  labels TEXT NOT NULL DEFAULT '[]', hidden INTEGER NOT NULL DEFAULT 0, checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const HANDLE_NAME = /^[a-z0-9](?:[a-z0-9-]{1,18})[a-z0-9]$/;
const RESERVED = new Set(["www", "api", "admin", "crumbs", "breadboard", "support", "abuse", "help", "mail", "indexer", "store", "status", "about", "terms", "privacy"]);
const now = () => new Date().toISOString();

export function settings(env = process.env) {
  return {
    port: Number(env.PORT ?? 8787),
    databaseFile: env.CRUMBS_INDEXER_DB ?? "./data/indexer.db",
    jetstream: (env.CRUMBS_JETSTREAM_URL ?? "wss://jetstream2.us-east.bsky.network").replace(/\/+$/, ""),
    relay: (env.CRUMBS_RELAY_URL ?? "https://relay1.us-west.bsky.network").replace(/\/+$/, ""),
    publicUrl: env.CRUMBS_PUBLIC_URL?.replace(/\/+$/, "") ?? null,
    handleDomain: env.CRUMBS_HANDLE_DOMAIN?.toLowerCase() ?? null,
    reportThreshold: Math.max(1, Number(env.CRUMBS_REPORT_THRESHOLD ?? 3)),
    // A community note shows once this many people other than its author rate it helpful, and helpful leads by as many.
    noteThreshold: Math.max(1, Number(env.CRUMBS_NOTE_THRESHOLD ?? 2)),
    blockedLabels: new Set((env.CRUMBS_BLOCKED_LABELS ?? "!hide,!takedown,!suspend,spam,impersonation,scam,threat,intolerant").split(",").map(value => value.trim()).filter(Boolean)),
    adminToken: env.CRUMBS_ADMIN_TOKEN ?? null,
    abuseEmail: env.CRUMBS_ABUSE_EMAIL ?? null,
    openaiKey: env.OPENAI_API_KEY ?? null,
  };
}

export async function createIndexer({ db, config = settings(), gate = text => moderate(text, { apiKey: config.openaiKey }) }) {
  await db.exec(SCHEMA);
  const visible = `(h.admin_state='approved' OR (h.admin_state='' AND h.status='visible'
    AND (SELECT count(DISTINCT r.did) FROM reports r WHERE r.subject=h.uri AND r.did<>h.did) < ${config.reportThreshold}))
    AND a.active=1 AND a.hidden=0`;
  // Community notes: context readers add to a crumb. Ratings from the note's own author never count.
  const noteScore = `(SELECT count(*) FROM ratings r WHERE r.subject=n.uri AND r.helpful=1 AND r.did<>n.did) AS helpful,
    (SELECT count(*) FROM ratings r WHERE r.subject=n.uri AND r.helpful=0 AND r.did<>n.did) AS unhelpful`;
  const noteThreshold = config.noteThreshold ?? 2;
  const shown = row => Number(row.helpful) >= noteThreshold && Number(row.helpful) - Number(row.unhelpful) >= noteThreshold;
  async function notesOn(subject) {
    const rows = await db.all(`SELECT n.*, a.handle, a.display_name, a.avatar, ${noteScore} FROM notes n JOIN accounts a ON a.did=n.did
      WHERE n.subject=? AND n.status='visible' AND a.active=1 AND a.hidden=0 ORDER BY n.created_at LIMIT 100`, [subject]);
    return rows.map(row => ({ uri: row.uri, did: row.did, handle: row.handle, displayName: row.display_name, avatar: row.avatar, body: row.body, source: row.source, createdAt: row.created_at,
      helpful: Number(row.helpful), unhelpful: Number(row.unhelpful), shown: shown(row) }));
  }
  /** The note readers found most helpful, and how many notes there are in all. */
  async function withNote(item) {
    const notes = await notesOn(item.uri);
    const best = notes.filter(note => note.shown).sort((a, b) => (b.helpful - b.unhelpful) - (a.helpful - a.unhelpful))[0];
    return { ...item, noteCount: notes.length, ...(best ? { note: { uri: best.uri, body: best.body, source: best.source, helpful: best.helpful } } : {}) };
  }
  const view = row => ({ uri: row.uri, cid: row.cid, did: row.did, handle: row.handle, displayName: row.display_name, avatar: row.avatar,
    url: row.page_url, target: JSON.parse(row.target_json), targetKey: row.target_key, comment: row.comment, source: row.source, createdAt: row.created_at });

  /** Display details and Bluesky's account labels, refreshed every six hours. */
  async function ensureAccount(did, force = false) {
    const known = await db.get("SELECT * FROM accounts WHERE did=?", [did]);
    if (known && !force && Date.parse(known.checked_at) > Date.now() - 6 * 3600_000) return known;
    let profile, labels;
    try { [profile, labels] = await Promise.all([profileOf(did), accountLabels(did)]); }
    catch (error) {
      if (known) return known;
      // Unknown authors stay hidden until Bluesky can vouch for the account.
      await db.run("INSERT INTO accounts(did,active,hidden,checked_at) VALUES(?,1,1,?) ON CONFLICT(did) DO NOTHING", [did, new Date(0).toISOString()]);
      return db.get("SELECT * FROM accounts WHERE did=?", [did]);
    }
    const hidden = !profile || labels.some(label => config.blockedLabels.has(label)) ? 1 : 0;
    await db.run(`INSERT INTO accounts(did,handle,display_name,avatar,active,labels,hidden,checked_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(did) DO UPDATE SET handle=excluded.handle,display_name=excluded.display_name,avatar=excluded.avatar,labels=excluded.labels,hidden=excluded.hidden,checked_at=excluded.checked_at`,
      [did, profile?.handle ?? known?.handle ?? null, profile?.displayName ?? null, profile?.avatar ?? null, known?.active ?? 1, JSON.stringify(labels), hidden, now()]);
    return db.get("SELECT * FROM accounts WHERE did=?", [did]);
  }

  async function indexRecord(did, collection, rkey, record, cid = "") {
    const uri = `at://${did}/${collection}/${rkey}`;
    if (collection === COLLECTIONS.highlight) {
      const parsed = parseHighlightRecord(record);
      if (!parsed) { await db.run("DELETE FROM highlights WHERE uri=?", [uri]); return; }
      await ensureAccount(did);
      const verdict = await gate([parsed.comment, parsed.target.quote ?? "", parsed.source ?? ""].join("\n"));
      await db.run(`INSERT INTO highlights(uri,did,cid,page_url,target_key,target_json,comment,source,created_at,indexed_at,status,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(uri) DO UPDATE SET cid=excluded.cid,page_url=excluded.page_url,target_key=excluded.target_key,target_json=excluded.target_json,
          comment=excluded.comment,source=excluded.source,created_at=excluded.created_at,status=excluded.status,reason=excluded.reason`,
        [uri, did, cid, parsed.target.url, targetDigest(parsed.target), JSON.stringify(parsed.target), parsed.comment, parsed.source,
          // A record cannot claim a time in the future to pin itself to the top of feeds.
          parsed.createdAt > now() ? now() : parsed.createdAt, now(), verdict.status, verdict.reason]);
    } else if (collection === COLLECTIONS.report) {
      const subject = parseAtUri(record?.subject);
      if (!subject || subject.collection !== COLLECTIONS.highlight) return;
      await db.run("INSERT INTO reports(uri,did,subject,reason,created_at) VALUES(?,?,?,?,?) ON CONFLICT(uri) DO UPDATE SET subject=excluded.subject,reason=excluded.reason",
        [uri, did, record.subject, String(record.reason ?? "").slice(0, 1000), now()]);
    } else if (collection === COLLECTIONS.note) {
      const subject = parseAtUri(record?.subject);
      const body = typeof record?.body === "string" ? record.body.trim() : "";
      if (!subject || subject.collection !== COLLECTIONS.highlight || !body || body.length > 2000) { await db.run("DELETE FROM notes WHERE uri=?", [uri]); return; }
      await ensureAccount(did);
      const source = record.source ? annotationPageUrl(record.source) : null;
      const verdict = await gate(`${body}\n${source ?? ""}`);
      await db.run(`INSERT INTO notes(uri,did,subject,body,source,created_at,status,reason) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(uri) DO UPDATE SET body=excluded.body,source=excluded.source,status=excluded.status,reason=excluded.reason`, [uri, did, record.subject, body, source, now(), verdict.status, verdict.reason]);
    } else if (collection === COLLECTIONS.rating) {
      const subject = parseAtUri(record?.subject);
      if (!subject || subject.collection !== COLLECTIONS.note || typeof record.helpful !== "boolean") return;
      await db.run("INSERT INTO ratings(uri,did,subject,helpful) VALUES(?,?,?,?) ON CONFLICT(uri) DO UPDATE SET subject=excluded.subject,helpful=excluded.helpful", [uri, did, record.subject, record.helpful ? 1 : 0]);
    } else if (collection === COLLECTIONS.follow) {
      if (!isDid(record?.subject) || record.subject === did) return;
      await db.run("INSERT INTO follows(uri,did,subject) VALUES(?,?,?) ON CONFLICT(uri) DO UPDATE SET subject=excluded.subject", [uri, did, record.subject]);
    } else if (collection === COLLECTIONS.handle) {
      const name = String(record?.name ?? "").toLowerCase();
      if (rkey !== "self" || !HANDLE_NAME.test(name) || RESERVED.has(name)) return;
      const owner = await db.get("SELECT did FROM handles WHERE name=?", [name]);
      if (owner && owner.did !== did) return; // First claim wins.
      await db.tx(async tx => {
        await tx.run("DELETE FROM handles WHERE did=?", [did]);
        await tx.run("INSERT INTO handles(name,did) VALUES(?,?) ON CONFLICT(name) DO NOTHING", [name, did]);
      });
    }
  }

  async function removeRecord(did, collection, rkey) {
    const uri = `at://${did}/${collection}/${rkey}`;
    if (collection === COLLECTIONS.highlight) { await db.run("DELETE FROM highlights WHERE uri=?", [uri]); await db.run("DELETE FROM reports WHERE subject=?", [uri]); }
    else if (collection === COLLECTIONS.note) { await db.run("DELETE FROM notes WHERE uri=?", [uri]); await db.run("DELETE FROM ratings WHERE subject=?", [uri]); }
    else if (collection === COLLECTIONS.rating) await db.run("DELETE FROM ratings WHERE uri=?", [uri]);
    else if (collection === COLLECTIONS.report) await db.run("DELETE FROM reports WHERE uri=?", [uri]);
    else if (collection === COLLECTIONS.follow) await db.run("DELETE FROM follows WHERE uri=?", [uri]);
    else if (collection === COLLECTIONS.handle && rkey === "self") await db.run("DELETE FROM handles WHERE did=?", [did]);
  }

  /** One Jetstream event. Takedowns and deletions by Bluesky or the user remove everything here too. */
  async function handleEvent(event) {
    if (!event || !isDid(event.did)) return;
    if (event.kind === "commit" && event.commit && Object.values(COLLECTIONS).includes(event.commit.collection)) {
      const { operation, collection, rkey, record, cid } = event.commit;
      if (operation === "delete") await removeRecord(event.did, collection, rkey);
      else if (operation === "create" || operation === "update") await indexRecord(event.did, collection, rkey, record, cid);
    } else if (event.kind === "account" && event.account) {
      const known = await db.get("SELECT did FROM accounts WHERE did=?", [event.did]);
      const status = event.account.status ?? "";
      if (status === "deleted" || status === "takendown") {
        for (const table of ["highlights", "reports", "follows", "handles", "notes", "ratings"]) await db.run(`DELETE FROM ${table} WHERE did=?`, [event.did]);
        if (known) await db.run("UPDATE accounts SET active=0 WHERE did=?", [event.did]);
      } else if (known) await db.run("UPDATE accounts SET active=? WHERE did=?", [event.account.active === false ? 0 : 1, event.did]);
    } else if (event.kind === "identity") {
      forgetIdentity(event.did);
      if (await db.get("SELECT did FROM accounts WHERE did=?", [event.did])) await ensureAccount(event.did, true).catch(() => {});
    }
  }

  /** Read one record from its author's server and index it now, without waiting for the stream. */
  async function fetchAndIndex(uri) {
    const at = parseAtUri(uri);
    if (!at || !Object.values(COLLECTIONS).includes(at.collection)) throw new HttpError(400, "Not a Crumbs record.");
    const found = await getRecord(at.did, at.collection, at.rkey);
    if (!found) await removeRecord(at.did, at.collection, at.rkey);
    else await indexRecord(at.did, at.collection, at.rkey, found.value, found.cid ?? "");
  }

  async function backfill(did) {
    let count = 0;
    for (const collection of [COLLECTIONS.highlight, COLLECTIONS.report, COLLECTIONS.follow, COLLECTIONS.handle, COLLECTIONS.note, COLLECTIONS.rating]) {
      for (const item of await listRecords(did, collection)) {
        const at = parseAtUri(item.uri);
        if (at) { await indexRecord(did, collection, at.rkey, item.value, item.cid ?? ""); count++; }
      }
    }
    return count;
  }

  /** After losing the database: find every account holding our records through the relay and read them back. */
  async function rebuild(log = console.log) {
    const seen = new Set();
    for (const collection of [COLLECTIONS.highlight, COLLECTIONS.follow, COLLECTIONS.handle, COLLECTIONS.report, COLLECTIONS.note, COLLECTIONS.rating]) {
      let cursor = "";
      do {
        const response = await fetch(`${config.relay}/xrpc/com.atproto.sync.listReposByCollection?collection=${collection}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`Relay answered ${response.status}`);
        const page = await response.json();
        for (const repo of page.repos ?? []) if (isDid(repo.did)) seen.add(repo.did);
        cursor = page.cursor ?? "";
      } while (cursor);
    }
    let records = 0;
    for (const did of seen) records += await backfill(did).catch(error => { log(`backfill ${did} failed: ${error.message}`); return 0; });
    log(`rebuilt ${records} records from ${seen.size} accounts`);
    return { accounts: seen.size, records };
  }

  async function retryPending() {
    for (const row of await db.all("SELECT uri,comment,target_json,source FROM highlights WHERE status='pending' ORDER BY indexed_at LIMIT 100")) {
      const verdict = await gate([row.comment, JSON.parse(row.target_json).quote ?? "", row.source ?? ""].join("\n"));
      if (verdict.status !== "pending") await db.run("UPDATE highlights SET status=?,reason=? WHERE uri=?", [verdict.status, verdict.reason, row.uri]);
    }
  }
  async function refreshAccounts() {
    const stale = new Date(Date.now() - 6 * 3600_000).toISOString();
    for (const row of await db.all("SELECT did FROM accounts WHERE checked_at<? ORDER BY checked_at LIMIT 200", [stale])) await ensureAccount(row.did, true).catch(() => {});
  }

  const select = `SELECT h.*, a.handle, a.display_name, a.avatar FROM highlights h JOIN accounts a ON a.did=h.did`;
  const dids = value => (Array.isArray(value) ? value : String(value ?? "").split(",")).filter(isDid).slice(0, 2000);

  async function api({ method, path, query, host, ip, body, headers }) {
    if (method === "GET" && path === "/.well-known/atproto-did") {
      const name = config.handleDomain && host.split(":")[0].endsWith(`.${config.handleDomain}`) ? host.split(":")[0].slice(0, -config.handleDomain.length - 1) : "";
      const row = name ? await db.get("SELECT did FROM handles WHERE name=?", [name]) : null;
      if (!row) throw new HttpError(404, "No such handle.");
      return { text: row.did };
    }
    if (method === "GET" && (path === "/" || path === "/health")) return { service: "crumbs-indexer", ok: true, cursor: (await db.get("SELECT value FROM meta WHERE key='cursor'"))?.value ?? null, abuseEmail: config.abuseEmail, handleDomain: config.handleDomain };
    if (method === "GET" && path === "/client-metadata.json") {
      if (!config.publicUrl) throw new HttpError(404, "CRUMBS_PUBLIC_URL is not set.");
      return { client_id: `${config.publicUrl}/client-metadata.json`, client_name: "Breadboard Crumbs", client_uri: config.publicUrl, tos_uri: `${config.publicUrl}/terms`, policy_uri: `${config.publicUrl}/privacy`,
        application_type: "native", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "atproto transition:generic",
        redirect_uris: ["http://127.0.0.1/api/crumbs/oauth/callback"], token_endpoint_auth_method: "none", dpop_bound_access_tokens: true };
    }
    if (method === "GET" && (path === "/terms" || path === "/privacy")) {
      const contact = config.abuseEmail ? ` Contact: ${config.abuseEmail}.` : "";
      return { text: path === "/terms"
        ? `Breadboard Crumbs terms\n\nCrumbs are public notes you attach to web pages. They are stored in your own AT Protocol account and you can delete them at any time. Do not post spam, harassment, threats, hate, or anything illegal. Notes that break these rules are not shown, and accounts that Bluesky has taken down are not shown.${contact}\n`
        : `Breadboard Crumbs privacy\n\nThis service keeps a searchable copy of public Crumbs records that people publish from their own AT Protocol accounts, plus public profile details (handle, name, avatar). It stores no passwords, no private highlights and no organization content. Deleting a record from your account removes it here.${contact}\n` };
    }
    if (method === "GET" && path === "/highlights") {
      const url = annotationPageUrl(query.get("url"));
      if (!url) throw new HttpError(400, "Pass a page url.");
      const rows = await db.all(`${select} WHERE h.page_url=? AND ${visible} ORDER BY h.created_at, h.rowid LIMIT 1000`, [url]);
      const threads = new Map();
      for (const row of rows) {
        const item = await withNote(view(row));
        if (!threads.has(item.targetKey)) threads.set(item.targetKey, { targetKey: item.targetKey, target: item.target, items: [] });
        threads.get(item.targetKey).items.push(item);
      }
      return { url, threads: [...threads.values()].slice(0, 200) };
    }
    if (method === "POST" && path === "/feed") {
      const actors = dids(body.actors);
      const before = typeof body.before === "string" && !Number.isNaN(Date.parse(body.before)) ? body.before : "9999";
      const limit = Math.min(50, Math.max(1, Number(body.limit) || 30));
      const scope = actors.length ? `h.did IN (${actors.map(() => "?").join(",")}) AND` : "";
      const rows = await db.all(`${select} WHERE ${scope} h.created_at<? AND ${visible} ORDER BY h.created_at DESC, h.rowid DESC LIMIT ${limit}`, [...actors, before]);
      const items = [];
      for (const row of rows) {
        const replies = await db.get(`SELECT count(*) AS n FROM highlights h JOIN accounts a ON a.did=h.did WHERE h.page_url=? AND h.target_key=? AND ${visible}`, [row.page_url, row.target_key]);
        items.push({ ...(await withNote(view(row))), threadCount: Number(replies.n) });
      }
      return { items, before: rows.length === limit ? rows[rows.length - 1].created_at : null };
    }
    if (method === "GET" && path === "/actor") {
      const did = query.get("did");
      if (!isDid(did)) throw new HttpError(400, "Pass a did.");
      const account = await ensureAccount(did);
      const mine = query.get("all") === "1";
      const rows = await db.all(`${select} WHERE h.did=? ${mine ? "" : `AND ${visible}`} ORDER BY h.created_at DESC, h.rowid DESC LIMIT 200`, [did]);
      const items = [];
      for (const row of rows) {
        const reports = await db.get("SELECT count(DISTINCT did) AS n FROM reports WHERE subject=? AND did<>?", [row.uri, did]);
        const state = row.admin_state === "hidden" ? "hidden" : row.admin_state === "approved" ? "visible" : row.status !== "visible" ? row.status : Number(reports.n) >= config.reportThreshold ? "reported" : "visible";
        items.push({ ...(await withNote(view(row))), state, reason: state === "rejected" ? row.reason : null });
      }
      const follows = await db.all("SELECT f.subject AS did, f.uri, a.handle, a.display_name AS \"displayName\", a.avatar FROM follows f LEFT JOIN accounts a ON a.did=f.subject WHERE f.did=? LIMIT 2000", [did]);
      const followers = await db.get("SELECT count(*) AS n FROM follows WHERE subject=?", [did]);
      const handle = await db.get("SELECT name FROM handles WHERE did=?", [did]);
      return { did, handle: account?.handle ?? null, displayName: account?.display_name ?? null, avatar: account?.avatar ?? null,
        crumbsHandle: handle && config.handleDomain ? `${handle.name}.${config.handleDomain}` : null, items, follows, followers: Number(followers.n) };
    }
    if (method === "GET" && path === "/notes") {
      const subject = String(query.get("subject") ?? "");
      if (parseAtUri(subject)?.collection !== COLLECTIONS.highlight) throw new HttpError(400, "Pass a crumb.");
      const viewer = query.get("viewer");
      const notes = await notesOn(subject);
      for (const note of notes) {
        const mine = isDid(viewer) ? await db.get("SELECT helpful FROM ratings WHERE subject=? AND did=?", [note.uri, viewer]) : null;
        note.myRating = mine ? Boolean(Number(mine.helpful)) : null;
      }
      return { notes };
    }
    if (method === "GET" && path === "/handle") {
      const name = String(query.get("name") ?? "").toLowerCase();
      if (!config.handleDomain) return { available: false, reason: "Breadboard handles are not set up on this server." };
      if (!HANDLE_NAME.test(name) || RESERVED.has(name)) return { available: false, reason: "Use 3 to 20 letters, digits or hyphens." };
      const owner = await db.get("SELECT did FROM handles WHERE name=?", [name]);
      return { available: !owner, owner: owner?.did ?? null, handle: `${name}.${config.handleDomain}` };
    }
    if (method === "POST" && path === "/moderate") {
      rateLimit(`moderate:${ip}`, 60);
      return localVerdict(String(body.text ?? ""));
    }
    if (method === "POST" && path === "/notify") {
      rateLimit(`notify:${ip}`, 120);
      await fetchAndIndex(body.uri);
      const row = await db.get("SELECT status, reason FROM highlights WHERE uri=?", [body.uri]);
      return { indexed: true, status: row?.status ?? null, reason: row?.status === "rejected" ? row.reason : null };
    }
    if (method === "POST" && path === "/backfill") {
      rateLimit(`backfill:${ip}`, 6);
      if (!isDid(body.did)) throw new HttpError(400, "Pass a did.");
      return { records: await backfill(body.did) };
    }
    if (path.startsWith("/admin/")) {
      requireAdmin(headers, config.adminToken);
      if (method === "GET" && path === "/admin/queue") {
        const rows = await db.all(`SELECT h.uri,h.did,h.page_url,h.comment,h.status,h.reason,h.admin_state,
          (SELECT count(DISTINCT r.did) FROM reports r WHERE r.subject=h.uri AND r.did<>h.did) AS reports FROM highlights h
          WHERE h.admin_state='' AND (h.status<>'visible' OR EXISTS (SELECT 1 FROM reports r WHERE r.subject=h.uri)) ORDER BY h.indexed_at DESC LIMIT 200`);
        return { items: rows.map(row => ({ ...row, reports: Number(row.reports) })) };
      }
      if (method === "POST" && path === "/admin/review") {
        if (!["approved", "hidden", ""].includes(body.state)) throw new HttpError(400, "state must be approved, hidden or empty.");
        const result = await db.run("UPDATE highlights SET admin_state=? WHERE uri=?", [body.state, String(body.uri)]);
        return { updated: result.changes };
      }
      if (method === "POST" && path === "/admin/rebuild") return rebuild();
    }
    throw new HttpError(404, "Not found.");
  }

  /** Follow Jetstream, resuming a few seconds before the last saved position. */
  function follow(log = console.log) {
    let socket, stopped = false, lastCursor = 0, saved = 0, chain = Promise.resolve();
    const timers = [setInterval(() => void retryPending().catch(() => {}), 5 * 60_000), setInterval(() => void refreshAccounts().catch(() => {}), 60 * 60_000)];
    async function connect() {
      if (stopped) return;
      const stored = Number((await db.get("SELECT value FROM meta WHERE key='cursor'"))?.value ?? 0);
      const url = new URL(`${config.jetstream}/subscribe`);
      url.searchParams.append("wantedCollections", "com.breadboard.*");
      if (stored) url.searchParams.set("cursor", String(stored - 5_000_000));
      socket = new WebSocket(url);
      socket.onopen = () => log(`[indexer] following ${config.jetstream}${stored ? " from the saved position" : ""}`);
      socket.onmessage = message => {
        chain = chain.then(async () => {
          const event = JSON.parse(String(message.data));
          await handleEvent(event);
          if (typeof event.time_us === "number") lastCursor = event.time_us;
          if (lastCursor && Date.now() - saved > 5000) { saved = Date.now(); await db.run("INSERT INTO meta(key,value) VALUES('cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(lastCursor)]); }
        }).catch(error => log(`[indexer] event failed: ${error.message}`));
      };
      socket.onclose = () => { if (!stopped) setTimeout(() => void connect(), 3000); };
      socket.onerror = () => {};
    }
    void connect();
    return async () => {
      stopped = true; timers.forEach(clearInterval); socket?.close(); await chain;
      if (lastCursor) await db.run("INSERT INTO meta(key,value) VALUES('cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(lastCursor)]);
    };
  }

  return { api, handleEvent, fetchAndIndex, backfill, rebuild, retryPending, refreshAccounts, follow };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = settings();
  const db = await openDatabase({ file: config.databaseFile });
  const indexer = await createIndexer({ db, config });
  if (process.argv.includes("--rebuild")) { await indexer.rebuild(); await db.close(); process.exit(0); }
  await serve({ port: config.port, handler: indexer.api, name: "indexer" });
  const stop = indexer.follow();
  console.log(`[indexer] listening on :${config.port}${config.openaiKey ? "" : " (no OPENAI_API_KEY: built-in moderation rules only)"}`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await stop(); await db.close(); process.exit(0); });
}
