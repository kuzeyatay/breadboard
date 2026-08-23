import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

export interface OpenGymProfile {
  goals: string[];
  experience: string;
  equipment: string[];
  daysPerWeek: number | null;
  sessionMinutes: number | null;
  constraints: string[];
  preferences: string[];
}

export interface OpenGymSavedProgram {
  id: string;
  title: string;
  markdown: string;
  exerciseIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OpenGymState {
  version: 1;
  profile: OpenGymProfile;
  programs: OpenGymSavedProgram[];
  recentRuns: Array<{
    runId: string;
    task: string;
    outcome: "completed" | "failed" | "aborted";
    at: string;
  }>;
  updatedAt: string;
}

function emptyState(): OpenGymState {
  return {
    version: 1,
    profile: {
      goals: [], experience: "", equipment: [], daysPerWeek: null,
      sessionMinutes: null, constraints: [], preferences: [],
    },
    programs: [],
    recentRuns: [],
    updatedAt: new Date().toISOString(),
  };
}

export function openGymStateRoot(): string {
  const configured = process.env.OPEN_GYM_AGENT_DATA_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : process.env.BREADBOARD_DATA_DIR?.trim()
      ? path.join(dashboardDataDir(), "open-gym-agent", "state")
      : path.join(repositoryRoot(), ".runtime", "open-gym-agent", "state");
}

function statePath(userId: number): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("invalid_user");
  return path.join(openGymStateRoot(), `user-${userId}.json`);
}

function strings(value: unknown, limit = 40): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 500)).filter(Boolean).slice(0, limit)
    : [];
}

function numberOrNull(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), min), max)
    : null;
}

function sanitize(value: unknown): OpenGymState {
  const base = emptyState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const row = value as Record<string, unknown>;
  const profile = row.profile && typeof row.profile === "object" && !Array.isArray(row.profile)
    ? row.profile as Record<string, unknown> : {};
  const programs = Array.isArray(row.programs) ? row.programs.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const program = item as Record<string, unknown>;
    if (typeof program.id !== "string" || typeof program.markdown !== "string") return [];
    return [{
      id: program.id.slice(0, 100),
      title: typeof program.title === "string" ? program.title.slice(0, 240) : "Training program",
      markdown: program.markdown.slice(0, 200_000),
      exerciseIds: strings(program.exerciseIds, 100),
      createdAt: typeof program.createdAt === "string" ? program.createdAt : new Date().toISOString(),
      updatedAt: typeof program.updatedAt === "string" ? program.updatedAt : new Date().toISOString(),
    }];
  }).slice(-20) : [];
  const recentRuns = Array.isArray(row.recentRuns) ? row.recentRuns.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const run = item as Record<string, unknown>;
    if (typeof run.runId !== "string" || typeof run.task !== "string") return [];
    const outcome: "completed" | "failed" | "aborted" =
      run.outcome === "failed" || run.outcome === "aborted" ? run.outcome : "completed";
    return [{ runId: run.runId.slice(0, 100), task: run.task.slice(0, 4_000), outcome, at: typeof run.at === "string" ? run.at : new Date().toISOString() }];
  }).slice(-50) : [];
  return {
    version: 1,
    profile: {
      goals: strings(profile.goals),
      experience: typeof profile.experience === "string" ? profile.experience.slice(0, 500) : "",
      equipment: strings(profile.equipment),
      daysPerWeek: numberOrNull(profile.daysPerWeek, 1, 7),
      sessionMinutes: numberOrNull(profile.sessionMinutes, 5, 300),
      constraints: strings(profile.constraints),
      preferences: strings(profile.preferences),
    },
    programs,
    recentRuns,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : base.updatedAt,
  };
}

export async function readOpenGymState(userId: number): Promise<OpenGymState> {
  try {
    return sanitize(JSON.parse(await readFile(statePath(userId), "utf8")) as unknown);
  } catch {
    return emptyState();
  }
}

const globalLocks = globalThis as typeof globalThis & {
  __breadboardOpenGymStateLocks?: Map<number, Promise<void>>;
};
const locks = globalLocks.__breadboardOpenGymStateLocks ?? new Map<number, Promise<void>>();
globalLocks.__breadboardOpenGymStateLocks = locks;

export async function updateOpenGymState(
  userId: number,
  update: (current: OpenGymState) => OpenGymState | Promise<OpenGymState>,
): Promise<OpenGymState> {
  const prior = locks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const chain = prior.then(() => pending);
  locks.set(userId, chain);
  await prior;
  try {
    const next = sanitize(await update(await readOpenGymState(userId)));
    next.updatedAt = new Date().toISOString();
    const target = statePath(userId);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temporary, target);
    return next;
  } finally {
    release();
    if (locks.get(userId) === chain) locks.delete(userId);
  }
}

export async function mergeOpenGymProfile(
  userId: number,
  patch: Partial<OpenGymProfile>,
): Promise<OpenGymState> {
  return updateOpenGymState(userId, (current) => ({
    ...current,
    profile: { ...current.profile, ...patch },
  }));
}

export async function saveOpenGymProgram(input: {
  userId: number;
  title: string;
  markdown: string;
  exerciseIds: string[];
}): Promise<OpenGymSavedProgram> {
  const now = new Date().toISOString();
  const program: OpenGymSavedProgram = {
    id: `program_${randomUUID().replaceAll("-", "")}`,
    title: input.title.trim().slice(0, 240) || "Training program",
    markdown: input.markdown.slice(0, 200_000),
    exerciseIds: [...new Set(input.exerciseIds)].slice(0, 100),
    createdAt: now,
    updatedAt: now,
  };
  await updateOpenGymState(input.userId, (current) => ({
    ...current,
    programs: [...current.programs, program].slice(-20),
  }));
  return program;
}

export async function recordOpenGymRun(input: {
  userId: number;
  runId: string;
  task: string;
  outcome: "completed" | "failed" | "aborted";
}): Promise<void> {
  await updateOpenGymState(input.userId, (current) => ({
    ...current,
    recentRuns: [...current.recentRuns, { ...input, task: input.task.slice(0, 4_000), at: new Date().toISOString() }].slice(-50),
  }));
}
