// The two optional data-vendor keys a TradingAgents run can use.
//
// Neither is required: the default vendor chain is yfinance, which needs no
// account. Alpha Vantage is an alternative price/news vendor, and FRED is what
// the macro tools read. Both are consumed by the cloned Python as ordinary
// environment variables, so they are stored as runtime state (like the Postiz
// stack credentials) rather than in brain.db, and injected into the child
// process at spawn time.
//
// Values only ever travel one way. The settings API reports whether a key is
// set, never what it is.

import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export const VENDOR_CREDENTIALS = [
  {
    key: "alphaVantage",
    env: "ALPHA_VANTAGE_API_KEY",
    label: "Alpha Vantage",
    unlocks: "An alternative vendor for prices, indicators, fundamentals and news.",
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
  const configured = process.env.TRADINGAGENTS_CREDENTIALS_FILE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(repositoryRoot(), ".runtime", "tradingagents", "credentials.json");
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

/** The env additions for a run: stored keys, never overriding the environment. */
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
