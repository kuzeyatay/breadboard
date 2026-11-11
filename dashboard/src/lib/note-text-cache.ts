import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

/**
 * The text of a garden's notes, remembered by size and modified time.
 *
 * A garden scan read every note again whenever its parsed graph had lapsed or
 * any one note had changed. The first read of a file is slow on Windows (about
 * 10 ms each, measured with plain reads outside Breadboard: real-time virus
 * scanning on open), so a 5,000-note garden took over a minute to open. With
 * this cache a note is read from disk only when it is new or was modified, and
 * after a restart the whole garden comes back from one file.
 */
interface NoteText { size: number; mtimeMs: number; content: string }

export interface NoteTexts {
  /** The note's text, from memory when its size and time are unchanged. */
  read(relPath: string, filePath: string, stat: { size: number; mtimeMs: number }): string;
  /** Forget notes that no longer exist and save if anything changed. */
  finish(liveRelPaths: Iterable<string>): void;
}

const MAX_GARDENS = 12;
const SAVE_INTERVAL_MS = 60_000;
const gardens = new Map<string, Map<string, NoteText>>();
const savedAt = new Map<string, number>();
// undefined: decide from the environment. Tests set a directory or null.
let override: string | null | undefined;

/**
 * Only the dashboard server keeps the file. Runtime workers import this module
 * from source, without NEXT_RUNTIME, and use the in-memory cache alone, so an
 * ingestion that rewrites notes does not also rewrite a garden-sized file.
 */
function diskDirectory(): string | null {
  if (override !== undefined) return override;
  const data = process.env.BREADBOARD_DATA_DIR?.trim();
  return data && process.env.NEXT_RUNTIME === "nodejs" ? path.join(data, "cache", "garden-notes") : null;
}

/** Test seam: keep the files under this data directory, or nowhere for null. */
export function enableNoteTextDiskCache(dataDirectory: string | null): void {
  override = dataDirectory ? path.join(dataDirectory, "cache", "garden-notes") : null;
}

/** Test seam: drop everything held in memory, as a restart would. */
export function forgetNoteTextsInMemory(): void {
  gardens.clear();
  savedAt.clear();
}

function cacheFile(key: string): string | null {
  const directory = diskDirectory();
  return directory ? path.join(directory, `${path.basename(key)}.json`) : null;
}

function load(key: string): Map<string, NoteText> {
  const notes = new Map<string, NoteText>();
  const file = cacheFile(key);
  if (!file) return notes;
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf-8")) as { version?: unknown; garden?: unknown; notes?: unknown };
    if (saved.version !== 1 || saved.garden !== key || !Array.isArray(saved.notes)) return notes;
    for (const entry of saved.notes) {
      if (!Array.isArray(entry)) continue;
      const [relPath, size, mtimeMs, content] = entry as unknown[];
      if (typeof relPath === "string" && typeof size === "number" && typeof mtimeMs === "number" && typeof content === "string") {
        notes.set(relPath, { size, mtimeMs, content });
      }
    }
  } catch {
    // Absent, torn or from another version: the notes themselves are read.
  }
  return notes;
}

function save(key: string, notes: Map<string, NoteText>): void {
  const file = cacheFile(key);
  if (!file) return;
  // A garden being written to (ingestion, Learn) changes on every scan. Notes
  // missed by a skipped save are simply read again after the next restart.
  if (Date.now() - (savedAt.get(key) ?? 0) < SAVE_INTERVAL_MS) return;
  savedAt.set(key, Date.now());
  const payload = JSON.stringify({
    version: 1,
    garden: key,
    notes: [...notes].map(([relPath, note]) => [relPath, note.size, note.mtimeMs, note.content]),
  });
  const temporary = `${file}.${process.pid}.tmp`;
  void fs.promises.mkdir(path.dirname(file), { recursive: true })
    .then(() => fs.promises.writeFile(temporary, payload, "utf-8"))
    .then(() => fs.promises.rename(temporary, file))
    .catch(() => fs.promises.rm(temporary, { force: true }).catch(() => undefined));
}

export function openNoteTexts(clusterDir: string): NoteTexts {
  const key = path.resolve(clusterDir);
  let notes = gardens.get(key);
  if (notes) gardens.delete(key); else notes = load(key);
  gardens.set(key, notes);
  while (gardens.size > MAX_GARDENS) gardens.delete(gardens.keys().next().value!);
  const held = notes;
  let changed = false;
  return {
    read(relPath, filePath, stat) {
      const known = held.get(relPath);
      if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) return known.content;
      const content = fs.readFileSync(filePath, "utf-8");
      held.set(relPath, { size: stat.size, mtimeMs: stat.mtimeMs, content });
      changed = true;
      return content;
    },
    finish(liveRelPaths) {
      const live = new Set(liveRelPaths);
      for (const relPath of held.keys()) {
        if (!live.has(relPath)) { held.delete(relPath); changed = true; }
      }
      if (changed) save(key, held);
      changed = false;
    },
  };
}
