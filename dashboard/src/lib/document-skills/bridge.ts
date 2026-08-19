// Breadboard's only entry point into the vendored book-to-skill clone.
//
// The clone is a Python package plus a spec; nothing here reimplements its
// document handling. `scripts/book-to-skill-bridge.py` runs inside it and
// answers in JSON, and this module spawns that bridge.
//
// Segmentation needs no optional dependencies (the clone's chapter detection is
// pure stdlib), so the common path works on a bare interpreter. Full extraction
// does need them, and is only reached for formats Breadboard's own Node
// extractor cannot read.
//
// When Python is missing entirely the pipeline still runs: `fallbackStructure`
// splits on the same headings the clone recognizes for Latin-script documents.
// It is deliberately narrower than the clone (no CJK/Thai/Korean chapter
// styles), and callers can tell the two apart through `fromClone`.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import { RecursiveChunker } from "../sim/chunkers/recursive-chunker.ts";
import type { DocumentChapter, DocumentStructure } from "./types.ts";

const BRIDGE_TIMEOUT_MS = 120_000;
const EXTRACT_TIMEOUT_MS = 600_000;

export function cloneRoot(): string {
  const configured = process.env.BOOK_TO_SKILL_ROOT?.trim();
  return configured ? path.resolve(configured) : path.join(repositoryRoot(), "book-to-skill");
}

export function cloneAvailable(): boolean {
  return fs.existsSync(path.join(cloneRoot(), "book_to_skill", "utils.py"));
}

function bridgeScript(): string {
  return path.join(repositoryRoot(), "dashboard", "scripts", "book-to-skill-bridge.py");
}

/**
 * Interpreter candidates, most specific first: an explicit override, the
 * clone's own virtualenv when an operator prepared one for the optional
 * parsers, then whatever `python` the machine has.
 */
function pythonCandidates(): string[] {
  const configured = process.env.BOOK_TO_SKILL_PYTHON?.trim();
  const venv = process.platform === "win32"
    ? path.join(cloneRoot(), ".venv", "Scripts", "python.exe")
    : path.join(cloneRoot(), ".venv", "bin", "python");
  return [
    ...(configured ? [configured] : []),
    ...(fs.existsSync(venv) ? [venv] : []),
    ...(process.platform === "win32" ? ["python.exe", "python"] : ["python3", "python"]),
  ];
}

interface BridgeRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

function runBridge(
  python: string,
  args: string[],
  stdin: string | null,
  timeoutMs: number,
): Promise<BridgeRun> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(python, [bridgeScript(), ...args], {
        cwd: repositoryRoot(),
        env: { ...process.env, PYTHONIOENCODING: "utf-8", BOOK_TO_SKILL_ROOT: cloneRoot() },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        ok: false,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : "spawn failed",
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (run: BridgeRun) => {
      if (settled) return;
      settled = true;
      resolve(run);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, stdout, stderr, error: "book-to-skill bridge timed out" });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ ok: false, stdout, stderr, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, stdout, stderr, error: code === 0 ? undefined : `exit ${code}` });
    });

    if (stdin === null) {
      child.stdin.end();
    } else {
      child.stdin.end(stdin, "utf8");
    }
  });
}

/**
 * Run the bridge under the first interpreter that produces parseable JSON.
 * A machine can have a `python` that is a Windows Store stub or a 2.x binary;
 * trying the next candidate is cheaper than telling the user to fix their PATH.
 */
async function callBridge(
  args: string[],
  stdin: string | null,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  for (const python of pythonCandidates()) {
    const run = await runBridge(python, args, stdin, timeoutMs);
    const line = run.stdout.trim().split("\n").filter(Boolean).pop();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // Not this interpreter's output; try the next candidate.
    }
  }
  return null;
}

/** Heading shapes the clone matches that are worth mirroring without Python. */
const FALLBACK_CHAPTER =
  /^\s*(?:#{1,6}\s+)?(?:chapter|chapitre|capítulo|capitulo|capitolo|kapitel|hoofdstuk)\s+(\d{1,3})\b/i;
const FALLBACK_ATX = /^\s{0,3}#{1,2}\s+(.+?)\s*#*\s*$/;

function headingTitle(line: string): string {
  return line.replace(/^\s*#{1,6}\s*/, "").replace(/\s*#+\s*$/, "").trim();
}

/**
 * Structure without Python: the same three tiers the bridge uses (numbered
 * headings, then structural headings, then fixed windows), restricted to
 * Latin-script chapter words.
 */
/**
 * ~24,000 characters, the old fixed-stride window's size, expressed in the
 * chunker's unit (1 token ≈ 4 characters). Kept equal on purpose: the point of
 * this change is where the boundary falls, not how much text each window
 * holds.
 */
const WINDOW_CHUNK_SIZE_TOKENS = 6000;

/** The old loop's ceiling on window count, preserved so a pathologically large
 * document still terminates in bounded work rather than producing thousands
 * of one-paragraph chapters for `mergeToLimit` to fold back down. */
const MAX_WINDOW_CHAPTERS = 200;

/**
 * Boundaries for a document with no detectable chapter headings, split at
 * paragraph/sentence boundaries instead of a raw character count.
 *
 * The previous version of this function cut every 24,000 characters exactly,
 * with no regard for what was at that position — routinely mid-sentence, and
 * on a technical document sometimes mid-code-fence. That is the naive
 * length-based split the vendored chunker exists to replace: `RecursiveChunker`
 * (dashboard/src/lib/sim/chunkers/recursive-chunker.ts, vendored from
 * simstudioai/sim) walks paragraph breaks, then sentence breaks, then word
 * boundaries, only falling back to a raw character cut for a single run of
 * text with no boundary of any kind in 24,000 characters.
 *
 * `RecursiveChunker.chunk()` cleans the text first (collapsing repeated
 * whitespace, normalizing line endings) before splitting, so the chunk
 * boundaries it returns are offsets into that *cleaned* copy, not into `text`
 * — and `planChapters` later slices `text` itself at these offsets, so a
 * cleaned-text offset would be silently wrong the moment a document has any
 * CRLF line ending, tab, or run of blank lines. Cleaning never reorders or
 * removes non-whitespace characters, though, so each chunk's own words are
 * still a substring of `text` — this re-locates every chunk by searching for
 * its opening words, in order, which is exact wherever it succeeds and only
 * approximate (falling back to the running cursor) on the degenerate input
 * that defeats the search entirely.
 */
async function windowChapters(text: string): Promise<DocumentChapter[]> {
  const chunker = new RecursiveChunker({ chunkSize: WINDOW_CHUNK_SIZE_TOKENS, chunkOverlap: 0 });
  const chunks = (await chunker.chunk(text)).slice(0, MAX_WINDOW_CHAPTERS);

  const starts: number[] = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const anchor = chunk.text.slice(0, 80).trim();
    const found = anchor ? text.indexOf(anchor, cursor) : -1;
    const start = found >= 0 ? found : cursor;
    starts.push(start);
    cursor = start;
  }

  return chunks.map((_chunk, index) => ({
    number: index + 1,
    title: `Part ${index + 1}`,
    start: starts[index],
    end: index + 1 < chunks.length ? starts[index + 1] : text.length,
    kind: "window" as const,
  }));
}

export async function fallbackStructure(text: string): Promise<DocumentStructure> {
  const lines = text.split(/\r?\n/);
  const marks: Array<{ number: number; title: string; start: number; kind: DocumentChapter["kind"] }> = [];
  let offset = 0;
  const offsets: number[] = [];
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  lines.forEach((line, index) => {
    const numbered = FALLBACK_CHAPTER.exec(line);
    if (numbered) {
      marks.push({
        number: Number(numbered[1]),
        title: headingTitle(line),
        start: offsets[index],
        kind: "numbered",
      });
    }
  });

  if (marks.length === 0) {
    lines.forEach((line, index) => {
      const atx = FALLBACK_ATX.exec(line);
      if (atx) {
        marks.push({
          number: marks.length + 1,
          title: atx[1].trim(),
          start: offsets[index],
          kind: "structural",
        });
      }
    });
  }

  // Same ownership rule as the bridge: a repeated chapter number belongs where
  // it owns the most text, so a table of contents never wins over the body.
  const widest = new Map<number, { mark: (typeof marks)[number]; span: number }>();
  marks.sort((left, right) => left.start - right.start);
  marks.forEach((mark, index) => {
    const next = marks.slice(index + 1).find((other) => other.number !== mark.number);
    const span = (next ? next.start : text.length) - mark.start;
    const best = widest.get(mark.number);
    if (!best || span > best.span) widest.set(mark.number, { mark, span });
  });
  const chosen = [...widest.values()].map((entry) => entry.mark).sort((a, b) => a.start - b.start);

  const chapters: DocumentChapter[] = [];
  if (chosen.length > 0) {
    if (chosen[0].start > 2000) {
      chapters.push({ number: 0, title: "Front matter", start: 0, end: chosen[0].start, kind: "front-matter" });
    }
    chosen.forEach((mark, index) => {
      chapters.push({
        number: mark.number,
        title: mark.title || `Section ${mark.number}`,
        start: mark.start,
        end: index + 1 < chosen.length ? chosen[index + 1].start : text.length,
        kind: mark.kind,
      });
    });
  } else {
    chapters.push(...(await windowChapters(text)));
  }

  const merged: DocumentChapter[] = [];
  for (const chapter of chapters) {
    const previous = merged[merged.length - 1];
    if (previous && chapter.end - chapter.start < 600) {
      previous.end = chapter.end;
      continue;
    }
    merged.push({ ...chapter });
  }

  return {
    chapters: merged,
    chaptersDetected: merged.length,
    hasToc: /table of contents|^\s*contents\s*$/im.test(text.slice(0, 30000)),
    headingSample: merged.slice(0, 10).map((chapter) => chapter.title),
    // The clone's own ratio (config.WORDS_PER_TOKEN = 0.75) for Latin text.
    estimatedTokens: Math.round(text.split(/\s+/).filter(Boolean).length / 0.75),
    fromClone: false,
  };
}

function parseChapters(value: unknown): DocumentChapter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const start = Number(record.start);
    const end = Number(record.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const kind = record.kind;
    return [{
      number: Number.isFinite(Number(record.number)) ? Number(record.number) : 0,
      title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : "Untitled section",
      start,
      end,
      kind:
        kind === "numbered" || kind === "structural" || kind === "front-matter" || kind === "window"
          ? kind
          : "window",
    }];
  });
}

/** Chapter boundaries for already-extracted text, from the clone when possible. */
export async function segmentDocument(text: string): Promise<DocumentStructure> {
  if (!cloneAvailable()) return fallbackStructure(text);
  const result = await callBridge(["--mode", "segment"], JSON.stringify({ text }), BRIDGE_TIMEOUT_MS);
  const chapters = result?.ok === true ? parseChapters(result.chapters) : [];
  if (chapters.length === 0) return fallbackStructure(text);
  return {
    chapters,
    chaptersDetected: Number(result?.chaptersDetected) || chapters.length,
    hasToc: Boolean(result?.hasToc),
    headingSample: Array.isArray(result?.headingSample)
      ? (result.headingSample as unknown[]).filter((item): item is string => typeof item === "string")
      : [],
    estimatedTokens: Number(result?.estimatedTokens) || Math.round(text.length / 4),
    fromClone: true,
  };
}

export interface CloneExtraction {
  text: string;
  metadata: Record<string, unknown>;
}

/**
 * Read a document off disk through the clone's parser stack. Returns null when
 * the clone cannot handle it (missing optional dependency, unsupported format),
 * which is a signal to fall back to Breadboard's own extraction rather than an
 * error worth showing.
 */
export async function extractWithClone(
  filePath: string,
  extractionMode: "text" | "technical" = "text",
): Promise<CloneExtraction | null> {
  if (!cloneAvailable()) return null;
  const result = await callBridge(
    ["--mode", "extract", "--file", filePath, "--extraction-mode", extractionMode],
    null,
    EXTRACT_TIMEOUT_MS,
  );
  if (result?.ok !== true || typeof result.text !== "string" || !result.text.trim()) return null;
  return {
    text: result.text,
    metadata:
      result.metadata && typeof result.metadata === "object"
        ? (result.metadata as Record<string, unknown>)
        : {},
  };
}

/** Formats only the clone can read; Breadboard's Node extractor handles the rest. */
export const CLONE_ONLY_EXTENSIONS = new Set(["epub", "rtf", "mobi", "azw", "azw3"]);
