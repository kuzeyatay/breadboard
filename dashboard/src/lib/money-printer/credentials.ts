// The stock-footage keys a MoneyPrinter run searches with.
//
// Unlike the vendor keys of the finance agents, at least one of these is close
// to required: the clone assembles a video out of clips it downloads, and every
// hosted library it can search — Pexels, Pixabay, Coverr — authenticates. A run
// with no key at all is not broken, but it can only cut from footage already
// sitting in the clone's own material directory, which is what `--local` says
// explicitly and what a run falls back to reporting when a search is refused.
//
// The keys are consumed by the cloned Python out of its config.toml, so they are
// stored as runtime state (like the Postiz stack credentials and the Vibe
// Trading vendor keys) and merged into that file when the service starts.
// Values only ever travel one way: the API reports whether a key is set, never
// what it is.

import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import type { MoneyPrinterSource } from "./identity.ts";

export const FOOTAGE_CREDENTIALS = [
  {
    key: "pexels",
    /** The config.toml key the clone reads this list from. */
    setting: "pexels_api_keys",
    label: "Pexels",
    unlocks: "The default footage library. Free, large, and generous about rate limits.",
    link: "https://www.pexels.com/api/",
  },
  {
    key: "pixabay",
    setting: "pixabay_api_keys",
    label: "Pixabay",
    unlocks: "A second free library, useful when Pexels has nothing for a search term.",
    link: "https://pixabay.com/api/docs/",
  },
  {
    key: "coverr",
    setting: "coverr_api_keys",
    label: "Coverr",
    unlocks: "Cinematic stock footage. Smaller catalogue, better-looking clips.",
    link: "https://coverr.co/developers",
  },
] as const;

export type FootageCredentialKey = (typeof FOOTAGE_CREDENTIALS)[number]["key"];

type Store = Partial<Record<FootageCredentialKey, string>>;

function storeFile(): string {
  const configured = process.env.MONEY_PRINTER_CREDENTIALS_FILE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(repositoryRoot(), ".runtime", "money-printer", "credentials.json");
}

function readStore(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const store: Store = {};
    for (const credential of FOOTAGE_CREDENTIALS) {
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

export function isFootageCredentialKey(value: unknown): value is FootageCredentialKey {
  return FOOTAGE_CREDENTIALS.some((credential) => credential.key === value);
}

/**
 * Which keys a run would see. A value already exported in the process
 * environment counts: someone who put `PEXELS_API_KEY` in .env should not be
 * asked for it again.
 */
export function credentialStatus(
  env: NodeJS.ProcessEnv = process.env,
): Record<FootageCredentialKey, { set: boolean; source: "environment" | "stored" | null }> {
  const store = readStore();
  const status = {} as Record<
    FootageCredentialKey,
    { set: boolean; source: "environment" | "stored" | null }
  >;
  for (const credential of FOOTAGE_CREDENTIALS) {
    if (env[environmentName(credential.key)]?.trim()) {
      status[credential.key] = { set: true, source: "environment" };
    } else if (store[credential.key]) {
      status[credential.key] = { set: true, source: "stored" };
    } else {
      status[credential.key] = { set: false, source: null };
    }
  }
  return status;
}

/** The environment variable Breadboard reads a key from, when one is exported. */
function environmentName(key: FootageCredentialKey): string {
  return `${key.toUpperCase()}_API_KEY`;
}

/** Every key a run can search with, as the config.toml settings they become. */
export function credentialSettings(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string[]> {
  const store = readStore();
  const settings: Record<string, string[]> = {};
  for (const credential of FOOTAGE_CREDENTIALS) {
    const value = env[environmentName(credential.key)]?.trim() || store[credential.key];
    if (value) settings[credential.setting] = [value];
  }
  return settings;
}

/** The footage libraries a run could actually search right now. */
export function availableFootageSources(
  env: NodeJS.ProcessEnv = process.env,
): FootageCredentialKey[] {
  const status = credentialStatus(env);
  return FOOTAGE_CREDENTIALS.filter((credential) => status[credential.key].set).map(
    (credential) => credential.key,
  );
}

/**
 * The source a run should actually use.
 *
 * A stored preference for a library whose key was never entered would otherwise
 * fail deep into the run, after the script has been written and the voiceover
 * recorded. Falling back is silent in the request but reported in the run's
 * events, so the substitution is visible without being fatal.
 */
export function resolveFootageSource(
  requested: MoneyPrinterSource,
  env: NodeJS.ProcessEnv = process.env,
): { source: MoneyPrinterSource; substituted: boolean } {
  if (requested === "local") return { source: "local", substituted: false };
  const available = availableFootageSources(env);
  if (available.includes(requested as FootageCredentialKey)) {
    return { source: requested, substituted: false };
  }
  const fallback = available[0];
  return fallback
    ? { source: fallback, substituted: true }
    : { source: "local", substituted: true };
}

/**
 * A stable fingerprint of which keys are in play, so the supervised service is
 * restarted after one is added or cleared. The clone reads config.toml once at
 * import, so only the *set* of keys has to be compared, not their contents.
 */
export function credentialFingerprint(env: NodeJS.ProcessEnv = process.env): string {
  return availableFootageSources(env).join(",");
}

/** Store a key, or clear it when the value is empty. */
export function setCredential(key: FootageCredentialKey, value: string): void {
  const store = readStore();
  const trimmed = value.trim();
  if (trimmed) {
    store[key] = trimmed;
  } else {
    delete store[key];
  }
  writeStore(store);
}
