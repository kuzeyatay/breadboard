// The optional data-vendor keys a Vibe Trading run can use.
//
// None is required. The clone's default chain is keyless end to end — Yahoo,
// Stooq, Eastmoney and Sina for equities, the OKX public API for crypto — and
// every keyed source below simply joins the fallback chain when its key is
// present and is silently skipped when it is not.
//
// The keys are consumed by the cloned Python as ordinary environment variables,
// so they are stored as runtime state (like the Postiz stack credentials and the
// Trading Agent vendor keys) rather than in brain.db, and injected into the
// supervised service at spawn time. Values only ever travel one way: the API
// reports whether a key is set, never what it is.

import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export const VENDOR_CREDENTIALS = [
  {
    key: "tushare",
    env: "TUSHARE_TOKEN",
    label: "Tushare Pro",
    unlocks: "Mainland-China A-share prices, fundamentals and index constituents.",
    link: "https://tushare.pro",
  },
  {
    key: "finnhub",
    env: "FINNHUB_API_KEY",
    label: "Finnhub",
    unlocks: "An additional US-equity OHLCV provider in the fallback chain.",
    link: "https://finnhub.io/register",
  },
  {
    key: "alphaVantage",
    env: "ALPHAVANTAGE_API_KEY",
    label: "Alpha Vantage",
    unlocks: "Another US-equity OHLCV provider. Free tier, heavily rate-limited.",
    link: "https://www.alphavantage.co/support/#api-key",
  },
  {
    key: "fred",
    env: "FRED_API_KEY",
    label: "FRED",
    unlocks: "Federal Reserve macro series — rates, inflation, labour, growth.",
    link: "https://fred.stlouisfed.org/docs/api/api_key.html",
  },
] as const;

export type VendorCredentialKey = (typeof VENDOR_CREDENTIALS)[number]["key"];

type Store = Partial<Record<VendorCredentialKey, string>>;

function storeFile(): string {
  const configured = process.env.VIBE_TRADING_CREDENTIALS_FILE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(repositoryRoot(), ".runtime", "vibe-trading", "credentials.json");
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
export function credentialEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
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
