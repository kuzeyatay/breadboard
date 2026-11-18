import { scrypt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * Parental website locks for Breadboard's browser.
 *
 * The dashboard owns `site-locks.json` (password hash + locked sites); this
 * process owns `site-lock-usage.json` (foreground minutes per site today and
 * temporary unlocks). One writer per file, so neither side races the other.
 * Usage is counted here, not from Screen Time slices, so pausing Screen Time
 * or excluding a window never lifts a limit.
 */

export interface SiteLock { domain: string; mode: "always" | "daily"; minutes: number }
export interface SiteLockConfig { password: string | null; sites: SiteLock[] }
export interface SiteLockUsage { day: string; used: Record<string, number>; unlocks: Record<string, number> }
export interface SiteLockVerdict { domain: string; mode: SiteLock["mode"]; minutes: number }

const DOMAIN = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
export const SITE_LOCK_PAGE_PREFIX = `data:text/html;charset=utf-8,${encodeURIComponent("<!--bb-site-lock-->")}`;

export const localDay = (now = Date.now()) => {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function siteLockConfig(value: unknown): SiteLockConfig {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const sites = Array.isArray(row.sites) ? row.sites.flatMap((item): SiteLock[] => {
    const site = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const domain = typeof site.domain === "string" ? site.domain.toLowerCase() : "";
    const minutes = Number(site.minutes);
    if (!DOMAIN.test(domain)) return [];
    if (site.mode === "daily" && Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440) return [{ domain, mode: "daily", minutes }];
    return site.mode === "always" ? [{ domain, mode: "always", minutes: 0 }] : [];
  }).slice(0, 200) : [];
  return { password: typeof row.password === "string" && row.password.startsWith("scrypt$") ? row.password : null, sites };
}

export function siteLockUsage(value: unknown, now = Date.now()): SiteLockUsage {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const numbers = (input: unknown) => Object.fromEntries(Object.entries(input && typeof input === "object" ? input : {})
    .filter((entry): entry is [string, number] => DOMAIN.test(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0));
  const unlocks = Object.fromEntries(Object.entries(numbers(row.unlocks)).filter(([, until]) => until > now));
  const day = localDay(now);
  return { day, used: row.day === day ? numbers(row.used) : {}, unlocks };
}

export function siteHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch { return null; }
}

export function matchSiteLock(config: SiteLockConfig, url: string): SiteLock | null {
  const host = siteHost(url);
  if (!host) return null;
  return config.sites.find(site => host === site.domain || host.endsWith(`.${site.domain}`)) ?? null;
}

export function siteLockVerdict(config: SiteLockConfig, usage: SiteLockUsage, url: string, now = Date.now()): SiteLockVerdict | null {
  const site = matchSiteLock(config, url);
  if (!site || (usage.unlocks[site.domain] ?? 0) > now) return null;
  if (site.mode === "daily" && (usage.used[site.domain] ?? 0) < site.minutes * 60000) return null;
  return { domain: site.domain, mode: site.mode, minutes: site.minutes };
}

/** `scrypt$<salt hex>$<key hex>`, the format the dashboard writes. */
export async function verifySiteLockPassword(stored: string | null, password: string): Promise<boolean> {
  const [, salt, key] = stored?.split("$") ?? [];
  if (!salt || !key || !password || password.length > 200) return false;
  const expected = Buffer.from(key, "hex");
  const actual = await new Promise<Buffer>((resolve, reject) =>
    scrypt(password, Buffer.from(salt, "hex"), expected.length, (error, derived) => error ? reject(error) : resolve(derived)));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

export function siteLockPage(verdict: SiteLockVerdict, returnUrl: string, error = ""): string {
  const site = escapeHtml(verdict.domain);
  const reason = verdict.mode === "always" ? "This website is locked."
    : `Today's limit of ${verdict.minutes} ${verdict.minutes === 1 ? "minute" : "minutes"} is used up. It opens again tomorrow.`;
  const html = `<!--bb-site-lock--><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${site} is locked</title>
<style>
:root{--bg:#f6f5f0;--card:#fffefb;--fg:#1d2520;--muted:#65706a;--line:#e3e2da;--accent:#2f6b4f;--warn:#a5532f;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#141815;--card:#1c211d;--fg:#e8ece8;--muted:#9aa49d;--line:#2d342f;--accent:#7cc4a0;--warn:#e39a78}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{width:min(420px,100%);background:var(--card);border:1px solid var(--line);border-radius:20px;padding:32px;box-shadow:0 12px 40px rgb(0 0 0/.06)}
.icon{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
h1{font-size:22px;line-height:1.3;margin:18px 0 6px;font-weight:600;overflow-wrap:anywhere}p{margin:0;color:var(--muted)}
form{margin-top:24px;display:grid;gap:14px}label{font-size:13px;font-weight:600}
input[type=password]{width:100%;margin-top:6px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:inherit}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
fieldset{border:0;padding:0;margin:0}legend{font-size:13px;font-weight:600;margin-bottom:6px}
.choices{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.choices label{font-weight:500;text-align:center;border:1px solid var(--line);border-radius:9px;padding:8px 4px;cursor:pointer}
.choices input{position:absolute;opacity:0}.choices label:has(input:checked){border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent)}
button{border:0;border-radius:10px;padding:11px;background:var(--accent);color:var(--card);font:inherit;font-weight:600;cursor:pointer}
.error{color:var(--warn);font-size:13px}small{display:block;margin-top:18px;color:var(--muted);font-size:12px}
</style></head><body><main>
<div class="icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
<h1>${site} is locked</h1><p>${escapeHtml(reason)}</p>
<form id="f"><label>Parent password<input type="password" id="pw" autocomplete="off" required autofocus></label>
<fieldset><legend>Unlock for</legend><div class="choices">
<label><input type="radio" name="d" value="15" checked>15 min</label><label><input type="radio" name="d" value="60">1 hour</label><label><input type="radio" name="d" value="day">Rest of today</label></div></fieldset>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}<button type="submit">Unlock</button></form>
<small>Locks are managed in Screen Time.</small></main>
<script>document.getElementById("f").addEventListener("submit",e=>{e.preventDefault();const q=new URLSearchParams({domain:${JSON.stringify(verdict.domain)},return:${JSON.stringify(returnUrl).replace(/</g, "\\u003c")},password:document.getElementById("pw").value,duration:new FormData(e.target).get("d")});location.href="breadboard-lock://unlock?"+q;});</script>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** Desktop-side lock state for the signed-in account. */
export class SiteLocks {
  private userId: string | null = null;
  private config: SiteLockConfig = { password: null, sites: [] };
  private usage: SiteLockUsage = siteLockUsage(null);
  private lastTick = 0;
  private dirty = false;
  private failures: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: {
    dataRoot: string;
    /** Signed-in user and the foreground tab, the same context Screen Time uses. */
    context: () => { userId: string | null; tab?: { url: string; browser: boolean } };
    /** Re-check every open browser tab against {@link verdict}. */
    enforce: () => void;
  }) {}

  start(): void { this.timer ??= setInterval(() => void this.tick(), 5000); void this.tick(); }
  close(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private dir(userId: string) { return path.join(this.options.dataRoot, "screen-time", userId); }

  private async tick(): Promise<void> {
    try {
      const context = this.options.context();
      const userId = context.userId && /^[1-9]\d*$/.test(context.userId) ? context.userId : null;
      const now = Date.now();
      if (userId !== this.userId) {
        this.userId = userId; this.lastTick = 0; this.dirty = false;
        this.usage = siteLockUsage(userId ? await readJson(path.join(this.dir(userId), "site-lock-usage.json")) : null, now);
      }
      if (!userId) { this.config = { password: null, sites: [] }; return; }
      this.config = siteLockConfig(await readJson(path.join(this.dir(userId), "site-locks.json")));
      if (this.usage.day !== localDay(now)) { this.usage = siteLockUsage({ unlocks: this.usage.unlocks }, now); this.dirty = true; }
      // Only foreground time counts; a gap (sleep, frozen session) is not time spent.
      const site = context.tab?.browser ? matchSiteLock(this.config, context.tab.url) : null;
      if (site?.mode === "daily" && this.lastTick && now - this.lastTick <= 6500) {
        this.usage.used[site.domain] = (this.usage.used[site.domain] ?? 0) + (now - this.lastTick);
        this.dirty = true;
      }
      this.lastTick = now;
      if (this.dirty) { this.dirty = false; await writeJson(path.join(this.dir(userId), "site-lock-usage.json"), this.usage); }
      if (this.config.sites.length) this.options.enforce();
    } catch { /* A missing or unreadable lock file means no locks; try again next tick. */ }
  }

  verdict(url: string): SiteLockVerdict | null {
    return this.userId ? siteLockVerdict(this.config, this.usage, url) : null;
  }

  /** Handle `breadboard-lock://unlock?...` from the lock page. Returns the URL the tab should load. */
  async unlock(request: string): Promise<string | null> {
    let params: URLSearchParams;
    try { params = new URL(request).searchParams; } catch { return null; }
    const target = params.get("return") ?? "", password = params.get("password") ?? "";
    const verdict = this.verdict(target);
    if (!verdict || verdict.domain !== params.get("domain")) return siteHost(target) ? target : null;
    const now = Date.now();
    this.failures = this.failures.filter(at => now - at < 60000);
    if (this.failures.length >= 5) return siteLockPage(verdict, target, "Too many tries. Wait a minute, then try again.");
    if (!await verifySiteLockPassword(this.config.password, password)) {
      this.failures.push(now);
      return siteLockPage(verdict, target, "That password isn't right.");
    }
    this.failures = [];
    const duration = params.get("duration");
    const end = new Date(now); end.setHours(24, 0, 0, 0);
    this.usage.unlocks[verdict.domain] = duration === "day" ? end.getTime() : now + (duration === "60" ? 60 : 15) * 60000;
    if (this.userId) await writeJson(path.join(this.dir(this.userId), "site-lock-usage.json"), this.usage).catch(() => undefined);
    return target;
  }
}

async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(value));
  await rename(`${file}.tmp`, file);
}
