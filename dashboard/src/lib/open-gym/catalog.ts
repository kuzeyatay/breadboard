import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot, dashboardDataDir } from "../runtime-paths.ts";

export interface OpenGymExercise {
  id: string;
  n: string;
  bp: string;
  eq: string;
  tg: string;
  mg: string;
  sm: string[];
  st: string[];
  img: string;
  gif: string;
}

export interface OpenGymCatalogMatch extends OpenGymExercise {
  score: number;
}

const DATASET_REVISION = "7455efae41b330c265e7cd4b78dfa848e7ce5ebd";
export const OPEN_GYM_GIF_CDN =
  `https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@${DATASET_REVISION}/videos`;

const globalCatalog = globalThis as typeof globalThis & {
  __breadboardOpenGymCatalog?: { source: string; modified: number; rows: OpenGymExercise[] };
};

export function resolveOpenGymRoot(): string {
  const configured = process.env.OPEN_GYM_ROOT?.trim();
  return path.resolve(configured || path.join(repositoryRoot(), "openGym"));
}

export function openGymCatalogPath(): string {
  return path.join(resolveOpenGymRoot(), "frontend", "src", "lib", "exercises-data.js");
}

function validExercise(value: unknown): value is OpenGymExercise {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.n === "string" &&
    typeof row.gif === "string" &&
    Array.isArray(row.st)
  );
}

export async function loadOpenGymCatalog(): Promise<OpenGymExercise[]> {
  const source = openGymCatalogPath();
  const info = await stat(source);
  const cached = globalCatalog.__breadboardOpenGymCatalog;
  if (cached && cached.source === source && cached.modified === info.mtimeMs) return cached.rows;
  const moduleSource = await readFile(source, "utf8");
  const match = /^\s*export\s+const\s+EXDB\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(moduleSource);
  if (!match) throw new Error("openGym exercise catalogue has an unexpected format");
  const parsed = JSON.parse(match[1]) as unknown;
  if (!Array.isArray(parsed)) throw new Error("openGym exercise catalogue is not an array");
  const rows = parsed.filter(validExercise).map((row) => ({
    ...row,
    sm: Array.isArray(row.sm) ? row.sm.filter((item): item is string => typeof item === "string") : [],
    st: row.st.filter((item): item is string => typeof item === "string"),
  }));
  if (rows.length < 1_000) throw new Error("openGym exercise catalogue is incomplete");
  globalCatalog.__breadboardOpenGymCatalog = { source, modified: info.mtimeMs, rows };
  return rows;
}

function normalized(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const QUERY_NOISE = new Set([
  "a", "an", "and", "animation", "can", "demo", "demonstrate", "do", "exercise",
  "for", "form", "how", "i", "me", "of", "perform", "please", "proper", "should",
  "show", "technique", "the", "to", "what", "with", "you",
]);

export async function searchOpenGymCatalog(
  query: string,
  options: { limit?: number; equipment?: string; bodyPart?: string } = {},
): Promise<OpenGymCatalogMatch[]> {
  const catalog = await loadOpenGymCatalog();
  const needle = normalized(query);
  const tokens = needle.split(/\s+/).filter((token) => token && !QUERY_NOISE.has(token));
  const equipment = normalized(options.equipment ?? "");
  const bodyPart = normalized(options.bodyPart ?? "");
  const scored: OpenGymCatalogMatch[] = [];
  for (const exercise of catalog) {
    if (equipment && !normalized(exercise.eq).includes(equipment)) continue;
    if (bodyPart && !normalized(exercise.bp).includes(bodyPart)) continue;
    const name = normalized(exercise.n);
    const haystack = normalized(
      [exercise.n, exercise.bp, exercise.eq, exercise.tg, exercise.mg, ...exercise.sm].join(" "),
    );
    let score = 0;
    if (needle && name === needle) score += 1_000;
    if (needle && needle.includes(name)) score += 700 + Math.min(name.length, 100);
    if (needle && name.includes(needle)) score += 500 + Math.min(needle.length, 100);
    for (const token of tokens) {
      if (name.split(" ").includes(token)) score += 80;
      else if (name.includes(token)) score += 45;
      else if (haystack.includes(token)) score += 12;
    }
    if (!tokens.length && (equipment || bodyPart)) score = 1;
    if (score > 0) scored.push({ ...exercise, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.n.localeCompare(b.n))
    .slice(0, Math.min(Math.max(options.limit ?? 8, 1), 25));
}

export async function openGymExerciseById(id: string): Promise<OpenGymExercise | null> {
  return (await loadOpenGymCatalog()).find((exercise) => exercise.id === id) ?? null;
}

export function localExerciseGif(exercise: OpenGymExercise): string {
  return path.join(resolveOpenGymRoot(), "media", "gif", path.basename(exercise.gif));
}

export function cachedExerciseGif(exercise: OpenGymExercise): string {
  const configured = process.env.OPEN_GYM_MEDIA_CACHE_DIR?.trim();
  const root = configured
    ? path.resolve(configured)
    : process.env.BREADBOARD_DATA_DIR?.trim()
      ? path.join(dashboardDataDir(), "open-gym-agent", "media", "gif")
      : path.join(repositoryRoot(), ".runtime", "open-gym-agent", "media", "gif");
  return path.join(root, path.basename(exercise.gif));
}

export function remoteExerciseGif(exercise: OpenGymExercise): string {
  const configured = process.env.OPEN_GYM_MEDIA_BASE_URL?.trim().replace(/\/+$/, "");
  return `${configured || OPEN_GYM_GIF_CDN}/${encodeURIComponent(path.basename(exercise.gif))}`;
}

export async function openGymCatalogHealth(): Promise<{
  available: boolean;
  root: string;
  exerciseCount: number;
  reason: string | null;
}> {
  try {
    const rows = await loadOpenGymCatalog();
    return { available: true, root: resolveOpenGymRoot(), exerciseCount: rows.length, reason: null };
  } catch (error) {
    return {
      available: false,
      root: resolveOpenGymRoot(),
      exerciseCount: 0,
      reason: error instanceof Error ? error.message : "openGym catalogue unavailable",
    };
  }
}
