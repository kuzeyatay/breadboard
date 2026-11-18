// Parental website locks. This side owns `site-locks.json` (password hash and
// locked sites); the desktop owns `site-lock-usage.json` (today's foreground
// time per site and temporary unlocks) and enforces both in its browser.
// See desktop/src/main/site-locks.ts.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dashboardDataDir } from "@/lib/runtime-paths";

export type SiteLockMode = "always" | "daily";
export interface SiteLockView { domain: string; mode: SiteLockMode; minutes: number; usedMs: number; unlockedUntil: number | null }
export interface SiteLocksView { hasPassword: boolean; sites: SiteLockView[] }
interface Stored { password: string | null; sites: { domain: string; mode: SiteLockMode; minutes: number }[] }

const DOMAIN = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;

export class SiteLockError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

function dir(userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid user.");
  return path.join(dashboardDataDir(), "screen-time", String(userId));
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** "https://www.YouTube.com/watch?v=1" → "youtube.com". */
export function normalizeSiteDomain(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw || raw.length > 300) return null;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
    return DOMAIN.test(host) ? host : null;
  } catch { return null; }
}

const derive = (password: string, salt: Buffer, length: number) => new Promise<Buffer>((resolve, reject) =>
  scrypt(password, salt, length, (error, key) => error ? reject(error) : resolve(key)));

export async function hashSiteLockPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await derive(password, salt, 32)).toString("hex")}`;
}

export async function verifySiteLockPassword(stored: string | null, password: string): Promise<boolean> {
  const [, salt, key] = stored?.split("$") ?? [];
  if (!salt || !key || !password || password.length > 200) return false;
  const expected = Buffer.from(key, "hex"), actual = await derive(password, Buffer.from(salt, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

async function readStored(userId: number): Promise<Stored> {
  const row = await readJson(path.join(dir(userId), "site-locks.json"));
  const sites = Array.isArray(row?.sites) ? (row.sites as Stored["sites"]).filter(site => DOMAIN.test(site?.domain) && (site.mode === "always" || site.mode === "daily")) : [];
  return { password: typeof row?.password === "string" ? row.password : null, sites };
}

async function writeStored(userId: number, value: Stored) {
  const target = path.join(dir(userId), "site-locks.json"), temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await mkdir(dir(userId), { recursive: true });
  await writeFile(temporary, JSON.stringify(value), "utf8");
  await rename(temporary, target);
}

export async function readSiteLocks(userId: number): Promise<SiteLocksView> {
  const [stored, usage] = await Promise.all([readStored(userId), readJson(path.join(dir(userId), "site-lock-usage.json")).catch(() => null)]);
  const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const used = usage?.day === today && usage.used && typeof usage.used === "object" ? usage.used as Record<string, number> : {};
  const unlocks = usage?.unlocks && typeof usage.unlocks === "object" ? usage.unlocks as Record<string, number> : {};
  return { hasPassword: Boolean(stored.password), sites: stored.sites.map(site => ({ ...site,
    usedMs: Number(used[site.domain]) || 0, unlockedUntil: Number(unlocks[site.domain]) > Date.now() ? Number(unlocks[site.domain]) : null })) };
}

export type SiteLockChange =
  | { action: "set-password"; password?: string; newPassword: string }
  | { action: "add"; password: string; domain: string; mode: SiteLockMode; minutes?: number }
  | { action: "remove"; password: string; domain: string };

export async function changeSiteLocks(userId: number, change: SiteLockChange): Promise<SiteLocksView> {
  const stored = await readStored(userId);
  // Setting the first password is the only change that needs no password.
  if (stored.password || change.action !== "set-password") {
    if (!await verifySiteLockPassword(stored.password, change.password ?? "")) {
      await new Promise(resolve => setTimeout(resolve, 700)); // slows guessing
      throw new SiteLockError(stored.password ? "That password isn't right." : "Create a parent password first.", 403);
    }
  }
  if (change.action === "set-password") {
    if (change.newPassword.length < 4 || change.newPassword.length > 200) throw new SiteLockError("Use at least 4 characters.");
    stored.password = await hashSiteLockPassword(change.newPassword);
  } else {
    const domain = normalizeSiteDomain(change.domain);
    if (!domain) throw new SiteLockError("Enter a website such as youtube.com.");
    stored.sites = stored.sites.filter(site => site.domain !== domain);
    if (change.action === "add") {
      const minutes = change.mode === "daily" ? Number(change.minutes) : 0;
      if (change.mode === "daily" && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) throw new SiteLockError("Choose between 1 and 1440 minutes a day.");
      if (stored.sites.length >= 200) throw new SiteLockError("You can lock up to 200 websites.");
      stored.sites.push({ domain, mode: change.mode, minutes });
    }
  }
  await writeStored(userId, stored);
  return readSiteLocks(userId);
}
