import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

/**
 * One next-prompt suggestion per unchanged chat.
 *
 * Writing a suggestion is a model call of about five seconds. A chat nobody
 * has added to keeps the suggestion it already has: across reopens, and, from
 * a small file, across restarts. The caller's key covers the transcript and
 * the local date, so a new message or a new day asks the model again.
 */
const KEEP_MS = 24 * 60 * 60_000;
const MAX_ENTRIES = 300;

interface Kept { expires: number; value: Promise<string | null> }
const kept = new Map<string, Kept>();
const settled = new Map<string, { expires: number; value: string }>();
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let directoryOverride: string | null | undefined;

/** Test seam: keep the file under this data directory, or nowhere for null. */
export function setPromptSuggestionCacheDirectory(dataDirectory: string | null): void {
  directoryOverride = dataDirectory;
  kept.clear(); settled.clear(); loaded = false;
}

function cacheFile(): string | null {
  const data = directoryOverride !== undefined ? directoryOverride : process.env.BREADBOARD_DATA_DIR?.trim();
  return data ? path.join(data, "cache", "prompt-suggestions.json") : null;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const file = cacheFile();
  if (!file) return;
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { version?: unknown; entries?: unknown };
    if (saved.version !== 1 || !Array.isArray(saved.entries)) return;
    const now = Date.now();
    for (const entry of saved.entries) {
      if (!Array.isArray(entry)) continue;
      const [key, expires, value] = entry as unknown[];
      if (typeof key !== "string" || typeof expires !== "number" || typeof value !== "string" || expires <= now) continue;
      settled.set(key, { expires, value });
      kept.set(key, { expires, value: Promise.resolve(value) });
    }
  } catch {
    // Absent, torn or from another version: the model is simply asked again.
  }
}

function scheduleSave(): void {
  const file = cacheFile();
  if (!file || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    const payload = JSON.stringify({ version: 1, entries: [...settled].map(([key, entry]) => [key, entry.expires, entry.value]) });
    const temporary = `${file}.${process.pid}.tmp`;
    void fs.promises.mkdir(path.dirname(file), { recursive: true })
      .then(() => fs.promises.writeFile(temporary, payload, "utf8"))
      .then(() => fs.promises.rename(temporary, file))
      .catch(() => fs.promises.rm(temporary, { force: true }).catch(() => undefined));
  }, 2_000);
  saveTimer.unref?.();
}

export function keptPromptSuggestion(key: string, generate: () => Promise<string | null>): Promise<string | null> {
  load();
  const existing = kept.get(key);
  if (existing && existing.expires > Date.now()) return existing.value;
  const entry: Kept = { expires: Date.now() + KEEP_MS, value: generate() };
  kept.set(key, entry);
  while (kept.size > MAX_ENTRIES) { const oldest = kept.keys().next().value!; kept.delete(oldest); settled.delete(oldest); }
  // A failed or empty answer is not worth keeping: the next open asks again.
  const drop = () => { if (kept.get(key) === entry) kept.delete(key); };
  entry.value.then((value) => {
    if (!value) return drop();
    if (kept.get(key) !== entry) return;
    settled.set(key, { expires: entry.expires, value });
    scheduleSave();
  }, drop);
  return entry.value;
}
