// God's Eye's optional Google Maps enhancement key, for photorealistic 3D
// tiles and Google-backed place context. The keyless globe does not need it.
//
// The clone reads it as `GOOGLE_MAPS_API_KEY` from its environment (Vite's
// `loadEnv` lets `process.env` win over the clone's own `.env`, so a file the
// user keeps there is left alone). It is stored as runtime state rather than in
// brain.db, and injected into the dev server at spawn time.
//
// Values only ever travel one way. The settings API reports whether the key is
// set, never what it is. The clone's README is explicit that this key is
// client-exposed by design and must be restricted in Google Cloud instead.

import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { repositoryRoot } from "../runtime-paths.ts";

export const GOOGLE_MAPS_ENV = "GOOGLE_MAPS_API_KEY";

function storeFile(): string {
  const configured = process.env.GODS_EYE_CREDENTIALS_FILE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(repositoryRoot(), ".runtime", "gods-eye", "credentials.json");
}

function readStore(): { googleMapsApiKey?: string } {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const value = (parsed as Record<string, unknown>).googleMapsApiKey;
    return typeof value === "string" && value.trim() ? { googleMapsApiKey: value.trim() } : {};
  } catch {
    return {};
  }
}

/**
 * Which key a run would see. A value already exported in the process
 * environment counts: someone who put it in .env should not be asked again.
 */
export function googleMapsKeyStatus(env: NodeJS.ProcessEnv = process.env): {
  set: boolean;
  source: "environment" | "stored" | null;
} {
  if (env[GOOGLE_MAPS_ENV]?.trim()) return { set: true, source: "environment" };
  if (readStore().googleMapsApiKey) return { set: true, source: "stored" };
  return { set: false, source: null };
}

/** The key itself, for the child's environment only. Never sent to a browser. */
export function googleMapsKeyValue(env: NodeJS.ProcessEnv = process.env): string | null {
  return env[GOOGLE_MAPS_ENV]?.trim() || readStore().googleMapsApiKey || null;
}

export function storeGoogleMapsKey(value: string): void {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512 || /\s/.test(trimmed)) {
    throw new Error("That does not look like a Google Maps API key.");
  }
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ googleMapsApiKey: trimmed }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function clearGoogleMapsKey(): void {
  try {
    fs.rmSync(storeFile(), { force: true });
  } catch {
    // Nothing stored is the goal state.
  }
}
