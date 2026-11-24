import os from "node:os";
import { randomUUID } from "node:crypto";

// Like the dashboard's external-runtime filesystem helpers, keep user profiles
// outside Next's asset trace. This module also ships with the standalone CLI.
const getBuiltin = Reflect.get(process, "getBuiltinModule");
const fs = /** @type {typeof import("node:fs")} */ (Reflect.apply(getBuiltin, process, ["node:fs"]));
const path = /** @type {typeof import("node:path")} */ (Reflect.apply(getBuiltin, process, ["node:path"]));

export const isProfileId = id => id === "default" || (typeof id === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id));

export function claudeRoot(env = process.env) {
  return path.resolve(env.CLAUDE_CONFIG_DIR || path.join(env.USERPROFILE || env.HOME || os.homedir(), ".claude"));
}

export function profileStore(root) {
  return path.join(root, ".breadboard", "accounts");
}

export function profileDir(root, id) {
  if (!isProfileId(id)) throw new Error("Invalid Claude profile.");
  return id === "default" ? root : path.join(profileStore(root), id);
}

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

function metadata(root, id) {
  return path.join(profileStore(root), id + ".json");
}

export function rememberProfile(root, id, status) {
  profileDir(root, id);
  const file = metadata(root, id);
  const old = read(file);
  const email = status.loggedIn ? status.email ?? null : null;
  if (old?.email === email && old.loggedIn === status.loggedIn) return;
  write(file, { email, loggedIn: status.loggedIn, connectedAt: new Date().toISOString() });
  if (old) fs.rmSync(path.join(profileStore(root), id + ".reset"), { force: true });
}

export function profileRows(root) {
  const store = profileStore(root);
  let names;
  try { names = fs.readdirSync(store); }
  catch (error) { if (error.code !== "ENOENT") throw error; names = []; }
  const ids = ["default", ...names.filter(name => name.endsWith(".json"))
    .map(name => name.slice(0, -5)).filter(id => id !== "default" && isProfileId(id)).sort()];
  const preferred = read(path.join(store, "preferred.json"));
  const rows = ids.flatMap(id => {
    const info = read(metadata(root, id));
    if (info?.loggedIn === false || (!info && id !== "default")) return [];
    const resetAt = Number(read(path.join(store, id + ".reset"))) || 0;
    return [{ id, email: info?.email ?? null, connectedAt: info?.connectedAt ?? null, resetAt }];
  }).sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred)
    || String(a.connectedAt ?? "").localeCompare(String(b.connectedAt ?? "")));
  const emails = new Set();
  return rows.filter(row => {
    const email = row.email?.toLowerCase();
    if (email && emails.has(email)) return false;
    if (email) emails.add(email);
    return true;
  });
}

export function servingProfile(root, now = Date.now()) {
  return profileRows(root).find(row => row.resetAt <= now)?.id ?? null;
}

export function preferProfile(root, id) {
  if (!profileRows(root).some(row => row.id === id)) throw new Error("That Claude account is signed out.");
  write(path.join(profileStore(root), "preferred.json"), id);
}

export function restProfile(root, id, resetAt = 0) {
  const directory = profileDir(root, id);
  const now = Date.now();
  let until = Number.isFinite(resetAt) && resetAt > now ? resetAt : 0;
  try {
    const report = read(path.join(directory, ".breadboard", "usage-cache.json"))?.snapshot;
    for (const { limit } of report?.limits ?? []) {
      const reset = Date.parse(report.captured_at) + limit.resets_in_seconds * 1000;
      if (limit.used_percent >= 100 && reset > now) until = Math.max(until, reset);
    }
  } catch { /* A usage report is optional. */ }
  write(path.join(profileStore(root), id + ".reset"), until || now + 300_000);
}

/** Claude's CLI accepts an absolute transcript path across configuration directories. */
export function sessionTranscript(root, id, sessionId) {
  if (!isProfileId(sessionId) || sessionId === "default") return null;
  const projects = path.join(profileDir(root, id), "projects");
  if (!fs.existsSync(projects)) return null;
  for (const entry of fs.readdirSync(projects, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(projects, entry.name, sessionId + ".jsonl");
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
  }
  return null;
}

/** Only the fresh, unpublished directory created by this invocation is disposable. */
export async function addProfile(root, login, status) {
  const id = randomUUID();
  const directory = profileDir(root, id);
  fs.mkdirSync(profileStore(root), { recursive: true, mode: 0o700 });
  fs.mkdirSync(directory, { mode: 0o700 });
  let published = false;
  try {
    const original = await status("default");
    rememberProfile(root, "default", original);
    await login(id);
    const added = await status(id);
    if (!added.loggedIn || !added.email) throw new Error("Claude Code did not confirm the new subscription login.");
    const existing = profileRows(root).find(row => row.email?.toLowerCase() === added.email.toLowerCase());
    if (existing) {
      preferProfile(root, existing.id);
      return existing.id;
    }
    rememberProfile(root, id, added);
    published = true;
    preferProfile(root, id);
    return id;
  } finally {
    if (!published) fs.rmSync(directory, { recursive: true, force: true });
  }
}
