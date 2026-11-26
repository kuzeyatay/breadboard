// The Crumbs organization store. It keeps encrypted organization content and
// forwards it to members. It never holds a key: page addresses, passages,
// comments, organization names and report reasons all arrive as ciphertext.
// What it can see is who belongs to an organization and when they post.
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./lib/db.mjs";
import { HttpError, rateLimit, requireAdmin, serve } from "./lib/http.mjs";
import { authenticate } from "./lib/auth.mjs";
import { isDid } from "./lib/atproto.mjs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY, created_by TEXT NOT NULL, created_at TEXT NOT NULL, epoch INTEGER NOT NULL,
  name_ct TEXT NOT NULL, needs_rotation INTEGER NOT NULL DEFAULT 0, suspended INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS members (org_id TEXT NOT NULL, did TEXT NOT NULL, role TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY(org_id, did));
CREATE INDEX IF NOT EXISTS members_did ON members(did);
CREATE TABLE IF NOT EXISTS envelopes (org_id TEXT NOT NULL, epoch INTEGER NOT NULL, did TEXT NOT NULL, device TEXT NOT NULL, envelope TEXT NOT NULL, PRIMARY KEY(org_id, epoch, did, device));
CREATE TABLE IF NOT EXISTS key_requests (org_id TEXT NOT NULL, did TEXT NOT NULL, device TEXT NOT NULL, PRIMARY KEY(org_id, did, device));
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, epoch INTEGER NOT NULL, page_index TEXT NOT NULL, sender TEXT NOT NULL,
  device TEXT NOT NULL, ciphertext TEXT NOT NULL, sig TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_page ON messages(org_id, page_index, created_at);
CREATE INDEX IF NOT EXISTS messages_recent ON messages(org_id, created_at);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, message_id TEXT NOT NULL, reporter TEXT NOT NULL, epoch INTEGER NOT NULL, reason_ct TEXT NOT NULL, created_at TEXT NOT NULL);
`;

const ID = /^[a-zA-Z0-9-]{8,64}$/;
const DEVICE = /^[a-z0-9]{8,32}$/;
const HEX = /^[a-f0-9]{64}$/;
const now = () => new Date().toISOString();
const text = (value, max, name) => { if (typeof value !== "string" || !value || value.length > max) throw new HttpError(400, `Send a valid ${name}.`); return value; };

export function settings(env = process.env) {
  return {
    port: Number(env.PORT ?? 8788),
    databaseUrl: env.DATABASE_URL ?? null,
    databaseFile: env.CRUMBS_ORG_DB ?? "./data/org-store.db",
    adminToken: env.CRUMBS_ADMIN_TOKEN ?? null,
    abuseEmail: env.CRUMBS_ABUSE_EMAIL ?? null,
    maxOrgsPerAccount: Number(env.CRUMBS_MAX_ORGS ?? 20),
    maxMembers: Number(env.CRUMBS_MAX_MEMBERS ?? 200),
  };
}

export async function createOrgStore({ db, config = settings(), auth = authenticate }) {
  await db.exec(SCHEMA);

  // Live signals. Each member's Breadboard keeps one `GET /orgs/stream` open and
  // is told *that* something changed in one of its organizations: which
  // organization, and for a message, its page index and id. Never content; the
  // client then fetches and decrypts as it always does. Signals are a hint, so
  // a missed one costs only latency: clients catch up whenever they reconnect.
  // ponytail: subscribers live in this process. Running more than one store
  // machine needs the signal fanned out between them (Postgres LISTEN/NOTIFY).
  const subscribers = new Map(); // did -> Set<sink>
  const heartbeat = setInterval(() => { for (const sinks of subscribers.values()) for (const sink of sinks) sink.ping(); }, 25_000);
  heartbeat.unref?.();
  const signalDids = (dids, data) => { for (const did of new Set(dids)) for (const sink of subscribers.get(did) ?? []) sink.send(data); };
  async function signal(orgId, data, extra = []) {
    if (!subscribers.size) return;
    const members = (await db.all("SELECT did FROM members WHERE org_id=?", [orgId])).map(row => row.did);
    signalDids([...members, ...extra], { org: orgId, ...data });
  }
  function subscribe(did) {
    const sinks = subscribers.get(did) ?? new Set();
    // A few machines per account; a flood of connections from one is refused.
    if (sinks.size >= 10) throw new HttpError(429, "Too many live connections for this account.");
    return { stream(sink) {
      sinks.add(sink); subscribers.set(did, sinks);
      sink.onClose(() => { sinks.delete(sink); if (!sinks.size) subscribers.delete(did); });
      // Sent once the subscription is in place, so the client's catch-up sync cannot miss anything.
      sink.send({ kind: "ready" });
    } };
  }

  async function membership(orgId, did, needAdmin = false) {
    if (!ID.test(orgId)) throw new HttpError(404, "Organization not found.");
    const org = await db.get("SELECT * FROM orgs WHERE id=?", [orgId]);
    const member = org ? await db.get("SELECT role FROM members WHERE org_id=? AND did=?", [orgId, did]) : null;
    // Outsiders get the same answer for a missing organization and a private one.
    if (!org || !member) throw new HttpError(404, "Organization not found.");
    if (Number(org.suspended)) throw new HttpError(403, `This organization is suspended.${config.abuseEmail ? ` Contact ${config.abuseEmail}.` : ""}`);
    if (needAdmin && member.role !== "admin") throw new HttpError(403, "Only an organization admin can do that.");
    return { org, role: member.role };
  }

  function validEnvelopes(list) {
    if (!Array.isArray(list) || list.length > 2000) throw new HttpError(400, "Send key envelopes.");
    return list.map(item => {
      if (!isDid(item?.did) || !DEVICE.test(String(item.device))) throw new HttpError(400, "Send valid key envelopes.");
      return { did: item.did, device: item.device, envelope: text(item.envelope, 4000, "key envelope") };
    });
  }
  async function storeEnvelopes(tx, orgId, epoch, envelopes) {
    const members = new Set((await tx.all("SELECT did FROM members WHERE org_id=?", [orgId])).map(row => row.did));
    for (const item of envelopes) {
      if (!members.has(item.did)) continue; // Keys are only ever stored for current members.
      await tx.run("INSERT INTO envelopes(org_id,epoch,did,device,envelope) VALUES(?,?,?,?,?) ON CONFLICT(org_id,epoch,did,device) DO NOTHING", [orgId, epoch, item.did, item.device, item.envelope]);
      await tx.run("DELETE FROM key_requests WHERE org_id=? AND did=? AND device=? AND EXISTS (SELECT 1 FROM orgs o WHERE o.id=? AND o.epoch=?)", [orgId, item.did, item.device, orgId, epoch]);
    }
  }
  const orgView = (org, role) => ({ id: org.id, epoch: Number(org.epoch), nameCt: org.name_ct, role, needsRotation: Boolean(Number(org.needs_rotation)), createdAt: org.created_at });

  async function api(request) {
    const { method, path, query, body, headers } = request;
    if (method === "GET" && (path === "/" || path === "/health")) return { service: "crumbs-org-store", ok: true, abuseEmail: config.abuseEmail };
    if (path.startsWith("/admin/")) {
      requireAdmin(headers, config.adminToken);
      const match = /^\/admin\/orgs\/([a-zA-Z0-9-]{8,64})\/suspend$/.exec(path);
      if (method === "POST" && match) {
        const result = await db.run("UPDATE orgs SET suspended=? WHERE id=?", [body.suspended === false ? 0 : 1, match[1]]);
        if (!result.changes) throw new HttpError(404, "Organization not found.");
        return { id: match[1], suspended: body.suspended !== false };
      }
      if (method === "GET" && path === "/admin/orgs") {
        const rows = await db.all("SELECT o.id,o.created_by,o.created_at,o.suspended,(SELECT count(*) FROM members m WHERE m.org_id=o.id) AS members,(SELECT count(*) FROM reports r WHERE r.org_id=o.id) AS reports FROM orgs o ORDER BY o.created_at DESC LIMIT 500");
        return { orgs: rows.map(row => ({ ...row, suspended: Boolean(Number(row.suspended)), members: Number(row.members), reports: Number(row.reports) })) };
      }
      throw new HttpError(404, "Not found.");
    }

    const { did, device } = await auth(request);
    rateLimit(`org:${did}`, 600);
    const parts = path.split("/").filter(Boolean);
    if (parts[0] !== "orgs") throw new HttpError(404, "Not found.");
    if (parts.length === 2 && parts[1] === "stream" && method === "GET") {
      rateLimit(`org-stream:${did}`, 30);
      return subscribe(did);
    }

    if (parts.length === 1 && method === "GET") {
      const rows = await db.all("SELECT o.*, m.role FROM orgs o JOIN members m ON m.org_id=o.id WHERE m.did=? AND o.suspended=0 ORDER BY o.created_at", [did]);
      return { orgs: rows.map(row => orgView(row, row.role)) };
    }
    if (parts.length === 1 && method === "POST") {
      rateLimit(`org-create:${did}`, 5, 3600_000);
      // The client may choose the id so that the first key envelopes can be bound to it.
      const id = body.id === undefined ? randomUUID() : String(body.id);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) || await db.get("SELECT id FROM orgs WHERE id=?", [id])) throw new HttpError(409, "Choose another organization id.");
      const envelopes = validEnvelopes(body.envelopes);
      if (!envelopes.some(item => item.did === did && item.device === device)) throw new HttpError(400, "Include a key envelope for this device.");
      const owned = await db.get("SELECT count(*) AS n FROM members WHERE did=?", [did]);
      if (Number(owned.n) >= config.maxOrgsPerAccount) throw new HttpError(409, "You have reached the organization limit.");
      await db.tx(async tx => {
        await tx.run("INSERT INTO orgs(id,created_by,created_at,epoch,name_ct) VALUES(?,?,?,1,?)", [id, did, now(), text(body.nameCt, 2000, "name")]);
        await tx.run("INSERT INTO members(org_id,did,role,added_by,added_at) VALUES(?,?,'admin',?,?)", [id, did, did, now()]);
        await storeEnvelopes(tx, id, 1, envelopes);
      });
      return { id, epoch: 1 };
    }

    const orgId = parts[1];
    const section = parts[2] ?? "";
    if (!section && method === "GET") {
      const { org, role } = await membership(orgId, did);
      const members = await db.all("SELECT did, role, added_at AS \"addedAt\" FROM members WHERE org_id=? ORDER BY added_at", [orgId]);
      const held = await db.all("SELECT epoch, did, device FROM envelopes WHERE org_id=?", [orgId]);
      const requests = await db.all("SELECT did, device FROM key_requests WHERE org_id=?", [orgId]);
      return { ...orgView(org, role), members, envelopeIndex: held.map(row => ({ epoch: Number(row.epoch), did: row.did, device: row.device })), keyRequests: requests.map(row => ({ did: row.did, device: row.device })) };
    }
    if (!section && method === "DELETE") {
      await membership(orgId, did, true);
      const members = (await db.all("SELECT did FROM members WHERE org_id=?", [orgId])).map(row => row.did);
      await db.tx(async tx => { for (const table of ["reports", "messages", "envelopes", "key_requests", "members"]) await tx.run(`DELETE FROM ${table} WHERE org_id=?`, [orgId]); await tx.run("DELETE FROM orgs WHERE id=?", [orgId]); });
      signalDids(members, { org: orgId, kind: "membership" });
      return { deleted: true };
    }

    if (section === "members" && method === "POST") {
      await membership(orgId, did, true);
      if (!isDid(body.did)) throw new HttpError(400, "Send the member's account.");
      const role = body.role === "admin" ? "admin" : "member";
      const count = await db.get("SELECT count(*) AS n FROM members WHERE org_id=?", [orgId]);
      const existing = await db.get("SELECT role FROM members WHERE org_id=? AND did=?", [orgId, body.did]);
      if (!existing && Number(count.n) >= config.maxMembers) throw new HttpError(409, "This organization is full.");
      if (existing?.role === "admin" && role !== "admin" && body.did === did) {
        const admins = await db.get("SELECT count(*) AS n FROM members WHERE org_id=? AND role='admin'", [orgId]);
        if (Number(admins.n) <= 1) throw new HttpError(409, "Make someone else an admin first.");
      }
      await db.run("INSERT INTO members(org_id,did,role,added_by,added_at) VALUES(?,?,?,?,?) ON CONFLICT(org_id,did) DO UPDATE SET role=excluded.role", [orgId, body.did, role, did, now()]);
      await signal(orgId, { kind: "membership" });
      return { did: body.did, role };
    }
    if (section === "members" && method === "DELETE" && parts[3] === "me") {
      const { role } = await membership(orgId, did);
      const others = await db.get("SELECT count(*) AS n FROM members WHERE org_id=? AND did<>?", [orgId, did]);
      const admins = await db.get("SELECT count(*) AS n FROM members WHERE org_id=? AND role='admin' AND did<>?", [orgId, did]);
      if (role === "admin" && Number(others.n) > 0 && Number(admins.n) === 0) throw new HttpError(409, "Make someone else an admin before you leave.");
      await db.tx(async tx => {
        await tx.run("DELETE FROM members WHERE org_id=? AND did=?", [orgId, did]);
        await tx.run("DELETE FROM envelopes WHERE org_id=? AND did=?", [orgId, did]);
        await tx.run("DELETE FROM key_requests WHERE org_id=? AND did=?", [orgId, did]);
        if (Number(others.n) === 0) { for (const table of ["reports", "messages", "envelopes"]) await tx.run(`DELETE FROM ${table} WHERE org_id=?`, [orgId]); await tx.run("DELETE FROM orgs WHERE id=?", [orgId]); }
        else await tx.run("UPDATE orgs SET needs_rotation=1 WHERE id=?", [orgId]);
      });
      await signal(orgId, { kind: "membership" }, [did]);
      return { left: true };
    }

    // A new key epoch. Removing members and replacing the key happen in one step,
    // so a removed member never receives a key that protects later messages.
    if (section === "epochs" && method === "POST") {
      const { org } = await membership(orgId, did, true);
      const epoch = Number(body.epoch);
      if (epoch !== Number(org.epoch) + 1) throw new HttpError(409, "Another admin changed the keys first. Reload and try again.");
      const remove = Array.isArray(body.remove) ? body.remove.filter(isDid) : [];
      if (remove.includes(did)) throw new HttpError(400, "Use Leave to remove yourself.");
      const envelopes = validEnvelopes(body.envelopes).filter(item => !remove.includes(item.did));
      if (!envelopes.some(item => item.did === did && item.device === device)) throw new HttpError(400, "Include a key envelope for this device.");
      await db.tx(async tx => {
        for (const gone of remove) for (const table of ["members", "envelopes", "key_requests"]) await tx.run(`DELETE FROM ${table} WHERE org_id=? AND did=?`, [orgId, gone]);
        await tx.run("UPDATE orgs SET epoch=?, name_ct=?, needs_rotation=0 WHERE id=?", [epoch, text(body.nameCt, 2000, "name"), orgId]);
        await storeEnvelopes(tx, orgId, epoch, envelopes);
      });
      await signal(orgId, { kind: "membership" }, remove);
      return { epoch };
    }
    if (section === "envelopes" && method === "POST") {
      const { org } = await membership(orgId, did);
      const epoch = Number(body.epoch);
      if (!Number.isInteger(epoch) || epoch < 1 || epoch > Number(org.epoch)) throw new HttpError(400, "Unknown key epoch.");
      await db.tx(tx => storeEnvelopes(tx, orgId, epoch, validEnvelopes(body.envelopes)));
      await signal(orgId, { kind: "keys" });
      return { stored: true };
    }
    if (section === "envelopes" && method === "GET") {
      const { org } = await membership(orgId, did);
      const rows = await db.all("SELECT epoch, envelope FROM envelopes WHERE org_id=? AND did=? AND device=? ORDER BY epoch", [orgId, did, device]);
      // A device without the current key leaves a request that any member's client answers.
      if (!rows.some(row => Number(row.epoch) === Number(org.epoch))) {
        const asked = await db.run("INSERT INTO key_requests(org_id,did,device) VALUES(?,?,?) ON CONFLICT(org_id,did,device) DO NOTHING", [orgId, did, device]);
        // Members online hand the key over now rather than the next time they open the organization.
        if (asked.changes) await signal(orgId, { kind: "keys" });
      }
      return { envelopes: rows.map(row => ({ epoch: Number(row.epoch), envelope: row.envelope })) };
    }

    if (section === "messages" && method === "POST") {
      const { org } = await membership(orgId, did);
      rateLimit(`org-post:${did}`, 30);
      if (Number(body.epoch) !== Number(org.epoch)) throw new HttpError(409, "The organization's keys changed. Reload and send again.");
      if (!ID.test(String(body.id)) || !HEX.test(String(body.pageIndex))) throw new HttpError(400, "Send a valid message.");
      await db.run("INSERT INTO messages(id,org_id,epoch,page_index,sender,device,ciphertext,sig,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        [body.id, orgId, Number(org.epoch), body.pageIndex, did, device, text(body.ciphertext, 100000, "message"), text(body.sig, 200, "signature"), now()]);
      await signal(orgId, { kind: "message", index: body.pageIndex, id: body.id });
      return { id: body.id };
    }
    if (section === "messages" && method === "GET") {
      await membership(orgId, did);
      const indexes = String(query.get("index") ?? "").split(",").filter(value => HEX.test(value)).slice(0, 200);
      const before = query.get("before") ?? "9999";
      const after = query.get("after") ?? "";
      // `latest=N` answers the newest N of a conversation; `after` answers only what arrived since.
      const latest = Math.min(500, Math.max(0, Number(query.get("latest")) || 0));
      const marks = indexes.map(() => "?").join(",");
      const rows = !indexes.length ? await db.all("SELECT * FROM messages WHERE org_id=? AND created_at<? ORDER BY created_at DESC, id LIMIT 50", [orgId, before])
        : latest ? await db.all(`SELECT * FROM (SELECT * FROM messages WHERE org_id=? AND page_index IN (${marks}) AND created_at<? ORDER BY created_at DESC, id DESC LIMIT ${latest}) AS recent ORDER BY created_at, id`, [orgId, ...indexes, before])
        : await db.all(`SELECT * FROM messages WHERE org_id=? AND page_index IN (${marks}) AND created_at>? ORDER BY created_at, id LIMIT 2000`, [orgId, ...indexes, after]);
      return { messages: rows.map(row => ({ id: row.id, epoch: Number(row.epoch), pageIndex: row.page_index, sender: row.sender, device: row.device, ciphertext: row.ciphertext, sig: row.sig, createdAt: row.created_at })) };
    }
    if (section === "messages" && method === "DELETE" && parts[3]) {
      const { role } = await membership(orgId, did);
      const message = await db.get("SELECT sender FROM messages WHERE id=? AND org_id=?", [parts[3], orgId]);
      if (!message || (message.sender !== did && role !== "admin")) throw new HttpError(404, "Message not found.");
      await db.tx(async tx => { await tx.run("DELETE FROM reports WHERE message_id=? AND org_id=?", [parts[3], orgId]); await tx.run("DELETE FROM messages WHERE id=? AND org_id=?", [parts[3], orgId]); });
      return { deleted: true };
    }

    if (section === "reports" && method === "POST") {
      await membership(orgId, did);
      rateLimit(`org-report:${did}`, 20, 3600_000);
      const message = await db.get("SELECT id FROM messages WHERE id=? AND org_id=?", [String(body.messageId), orgId]);
      if (!message) throw new HttpError(404, "Message not found.");
      const id = randomUUID();
      await db.run("INSERT INTO reports(id,org_id,message_id,reporter,epoch,reason_ct,created_at) VALUES(?,?,?,?,?,?,?)", [id, orgId, message.id, did, Number(body.epoch) || 1, text(body.reasonCt, 8000, "reason"), now()]);
      return { id };
    }
    if (section === "reports" && method === "GET") {
      await membership(orgId, did, true);
      const rows = await db.all("SELECT * FROM reports WHERE org_id=? ORDER BY created_at DESC LIMIT 200", [orgId]);
      return { reports: rows.map(row => ({ id: row.id, messageId: row.message_id, reporter: row.reporter, epoch: Number(row.epoch), reasonCt: row.reason_ct, createdAt: row.created_at })) };
    }
    if (section === "reports" && method === "DELETE" && parts[3]) {
      await membership(orgId, did, true);
      await db.run("DELETE FROM reports WHERE id=? AND org_id=?", [parts[3], orgId]);
      return { dismissed: true };
    }
    throw new HttpError(404, "Not found.");
  }
  return { api, close: () => clearInterval(heartbeat) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = settings();
  const db = await openDatabase({ url: config.databaseUrl, file: config.databaseFile });
  const store = await createOrgStore({ db, config });
  await serve({ port: config.port, handler: store.api, name: "org-store" });
  console.log(`[org-store] listening on :${config.port} (${db.kind})`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await db.close(); process.exit(0); });
}
