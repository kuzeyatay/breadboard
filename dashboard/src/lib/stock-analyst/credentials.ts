// The optional data-vendor keys a Stock Analyst run can use.
//
// None is required. The clone's default chain is keyless end to end — Eastmoney
// (efinance), AkShare, Pytdx and Baostock for mainland China, Yahoo Finance for
// everything else, and public SearXNG instances for news — and every keyed
// source below simply joins that chain when its key is present and is silently
// skipped when it is not. What the keys buy is stability: the free sources are
// scrapers subject to upstream rate limits, which is exactly what a daily
// watchlist run hits first.
//
// The keys are consumed by the cloned Python as ordinary environment variables,
// so they are stored as runtime state (like the Vibe Trading and Trading Agent
// vendor keys) rather than in brain.db, and injected into the supervised
// service at spawn time. Values only ever travel one way: the API reports
// whether a key is set, never what it is.

import fs from "node:fs";
import path from "node:path";
import { stateHome } from "./runtime.ts";

export const VENDOR_CREDENTIALS = [
  {
    key: "tushare",
    env: "TUSHARE_TOKEN",
    label: "Tushare Pro",
    unlocks: "A rate-limit-free A-share source for prices, fundamentals and index constituents.",
    link: "https://tushare.pro",
  },
  {
    key: "tickflow",
    env: "TICKFLOW_API_KEY",
    label: "TickFlow",
    unlocks: "Another A-share quote and K-line source, ahead of the free scrapers.",
    link: "https://tickflow.org/auth/register",
  },
  {
    key: "anspire",
    env: "ANSPIRE_API_KEYS",
    label: "Anspire Search",
    unlocks: "News and sentiment search across A-share, Hong Kong and US coverage.",
    link: "https://open.anspire.cn/dsa",
  },
  {
    key: "serpapi",
    env: "SERPAPI_API_KEYS",
    label: "SerpAPI",
    unlocks: "Search-engine results for real-time financial news.",
    link: "https://serpapi.com/baidu-search-api",
  },
  {
    key: "tavily",
    env: "TAVILY_API_KEYS",
    label: "Tavily",
    unlocks: "A general news-search API used for catalysts and announcements.",
    link: "https://tavily.com",
  },
  {
    key: "brave",
    env: "BRAVE_API_KEYS",
    label: "Brave Search",
    unlocks: "A further news-search fallback.",
    link: "https://brave.com/search/api/",
  },
] as const;

export type VendorCredentialKey = (typeof VENDOR_CREDENTIALS)[number]["key"];

type Store = Partial<Record<VendorCredentialKey, string>>;

function storeFile(): string {
  const configured = process.env.STOCK_ANALYST_CREDENTIALS_FILE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(stateHome(), "credentials.json");
}

function readStore(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const store: Store = {};
    for (const credential of VENDOR_CREDENTIALS) {
      const value = (parsed as Record<string, unknown>)[credential.key];
      if (typeof value === "string" && value.trim()) store[credential.key] = value.trim();
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function isVendorCredentialKey(value: unknown): value is VendorCredentialKey {
  return VENDOR_CREDENTIALS.some((credential) => credential.key === value);
}

/**
 * Which keys a run would see. A value already exported in the process
 * environment counts: someone who put it in .env should not be asked again.
 */
export function credentialStatus(
  env: NodeJS.ProcessEnv = process.env,
): Record<VendorCredentialKey, { set: boolean; source: "environment" | "stored" | null }> {
  const store = readStore();
  const status = {} as Record<
    VendorCredentialKey,
    { set: boolean; source: "environment" | "stored" | null }
  >;
  for (const credential of VENDOR_CREDENTIALS) {
    if (env[credential.env]?.trim()) {
      status[credential.key] = { set: true, source: "environment" };
    } else if (store[credential.key]) {
      status[credential.key] = { set: true, source: "stored" };
    } else {
      status[credential.key] = { set: false, source: null };
    }
  }
  return status;
}

/** The env additions for the service: stored keys, never overriding the environment. */
export function credentialEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const store = readStore();
  const additions: Record<string, string> = {};
  for (const credential of VENDOR_CREDENTIALS) {
    const stored = store[credential.key];
    if (stored && !env[credential.env]?.trim()) additions[credential.env] = stored;
  }
  return additions;
}

/**
 * A stable fingerprint of which keys are in play, so the supervised service is
 * restarted after one is added or cleared. The values themselves never appear:
 * the clone reads them once at boot, so only the *set* of keys has to be
 * compared, not their contents.
 */
export function credentialFingerprint(env: NodeJS.ProcessEnv = process.env): string {
  const status = credentialStatus(env);
  return VENDOR_CREDENTIALS.filter((credential) => status[credential.key].set)
    .map((credential) => credential.key)
    .join(",");
}

/** Store a key, or clear it when the value is empty. */
export function setCredential(key: VendorCredentialKey, value: string): void {
  const store = readStore();
  const trimmed = value.trim();
  if (trimmed) {
    store[key] = trimmed;
  } else {
    delete store[key];
  }
  writeStore(store);
}
