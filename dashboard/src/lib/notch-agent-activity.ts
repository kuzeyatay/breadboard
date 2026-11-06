import { open, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import type {
  NotchActivityPayload,
  NotchActivitySession,
  NotchActivityState,
} from "./usage-notch.ts";

const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const COMPLETE_TTL_MS = 24 * 60 * 60 * 1000;
const WAITING_TTL_MS = 24 * 60 * 60 * 1000;
const CODEX_COMPLETE_TTL_MS = 10_000;
const CODEX_STALE_ITEM_MS = 10 * 60 * 1000;
const CODEX_FRESH_TURN_MS = 2 * 60 * 1000;

type JsonObject = Record<string, unknown>;

export interface ClaudeTranscriptActivity {
  state: NotchActivityState;
  waitingFor?: string;
  since: number;
}

export interface ReadNotchActivityOptions {
  home?: string;
  now?: number;
  isProcessAlive?: (pid: number) => boolean;
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function timestamp(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function iso(value: number): string {
  return new Date(Number.isFinite(value) ? value : Date.now()).toISOString();
}

function bounded(value: string | undefined, maximum: number, fallback: string): string {
  const compact = value?.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  return compact.length > maximum ? `${compact.slice(0, maximum - 1)}…` : compact;
}

function basename(value: string | undefined, fallback = "Claude"): string {
  if (!value) return fallback;
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? fallback;
}

function isInterruption(record: JsonObject): boolean {
  const message = object(record.message);
  const content = message?.content;
  if (typeof content === "string") return content.startsWith("[Request interrupted by user");
  return Array.isArray(content) && content.some((entry) =>
    text(object(entry)?.text)?.startsWith("[Request interrupted by user") === true);
}

function assistantToolName(message: JsonObject | null): string | undefined {
  if (!Array.isArray(message?.content)) return undefined;
  for (const entry of message.content) {
    const block = object(entry);
    if (block?.type === "tool_use") return text(block.name);
  }
  return undefined;
}

/**
 * Codenotch's Windows fallback state machine, applied to the conversation tail:
 * fresh work is working, a quiet tool request is waiting, and a final response
 * remains complete until the next prompt (or the 24-hour stale sweep).
 */
export function parseClaudeTranscriptTail(
  tail: string,
  modifiedAt: number,
  now: number = Date.now(),
): ClaudeTranscriptActivity | null {
  const lines = tail.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let record: JsonObject | null = null;
    try { record = object(JSON.parse(lines[index])); } catch { continue; }
    if (!record || record.isSidechain === true) continue;
    const type = text(record.type);
    if (type !== "assistant" && type !== "user") continue;
    const at = timestamp(record.timestamp, modifiedAt);
    const quiet = Math.max(0, now - at);

    if (type === "assistant") {
      const message = object(record.message);
      if (text(message?.stop_reason) === "tool_use") {
        const tool = assistantToolName(message);
        if (quiet > 20_000 && quiet <= WAITING_TTL_MS) {
          return { state: "waiting", waitingFor: tool ? `${tool} approval` : "needs your input", since: at };
        }
        if (quiet <= WAITING_TTL_MS) return { state: "working", since: at };
        return { state: "idle", since: at };
      }
      return { state: quiet <= COMPLETE_TTL_MS ? "complete" : "idle", since: at };
    }

    if (isInterruption(record) || quiet > 75_000) {
      return { state: quiet <= COMPLETE_TTL_MS ? "complete" : "idle", since: at };
    }
    return { state: "working", since: at };
  }
  return null;
}

function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return object(error)?.code === "EPERM";
  }
}

async function tailFile(filename: string): Promise<{ text: string; modifiedAt: number } | null> {
  let handle;
  try {
    const info = await stat(filename);
    if (!info.isFile()) return null;
    handle = await open(filename, "r");
    const length = Math.min(info.size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, info.size - length));
    return { text: buffer.toString("utf8"), modifiedAt: info.mtimeMs };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function claudeProjectSlugCandidates(cwd: string): string[] {
  const mac = [...cwd].map((character) => character === "/" || character === "." ? "-" : character).join("");
  const windows = cwd.replace(/[:\\/.]/g, "-");
  return [...new Set([mac, windows, windows.replace(/^[A-Z](?=-)/, (drive) => drive.toLowerCase())])];
}

async function findClaudeTranscript(projects: string, sessionId: string, cwd: string): Promise<string | null> {
  const filename = `${sessionId}.jsonl`;
  for (const slug of claudeProjectSlugCandidates(cwd)) {
    const candidate = path.join(projects, slug, filename);
    try { if ((await stat(candidate)).isFile()) return candidate; } catch { /* scan below */ }
  }
  try {
    const folders = await readdir(projects, { withFileTypes: true });
    for (const folder of folders.slice(0, 2_000)) {
      if (!folder.isDirectory()) continue;
      const candidate = path.join(projects, folder.name, filename);
      try { if ((await stat(candidate)).isFile()) return candidate; } catch { /* next folder */ }
    }
  } catch { /* Claude has not created a projects directory yet. */ }
  return null;
}

function claudeSurface(entrypoint: string | undefined): string {
  if (entrypoint === "claude-desktop" || entrypoint === "claude-desktop-3p") return "Desktop";
  if (entrypoint === "claude-vscode") return "VS Code";
  if (entrypoint === "local-agent") return "Agent";
  return "Terminal";
}

function registryState(record: JsonObject): { state: NotchActivityState; reports: boolean } {
  const tempo = text(record.tempo)?.toLowerCase();
  const raw = text(record.status)?.toLowerCase();
  if (tempo === "blocked" || /^(waiting|attention|permission)$/.test(raw ?? "")) return { state: "waiting", reports: true };
  if (tempo === "active" || /^(busy|running|working)$/.test(raw ?? "")) return { state: "working", reports: true };
  if (/^(done|complete|completed|success)$/.test(raw ?? "")) return { state: "complete", reports: true };
  if (tempo === "idle" || raw === "idle") return { state: "idle", reports: true };
  return { state: "idle", reports: false };
}

async function claudeProfiles(home: string): Promise<string[]> {
  try {
    const entries = await readdir(home, { withFileTypes: true });
    const profiles = entries
      .filter((entry) => entry.isDirectory() && (entry.name === ".claude" || entry.name.startsWith(".claude-")))
      .map((entry) => path.join(home, entry.name))
      .sort();
    return profiles.slice(0, 32);
  } catch {
    return [path.join(home, ".claude")];
  }
}

export async function readClaudeNotchActivity(
  options: ReadNotchActivityOptions = {},
): Promise<NotchActivitySession[]> {
  const home = options.home ?? os.homedir();
  const now = options.now ?? Date.now();
  const alive = options.isProcessAlive ?? processAlive;
  const sessions: NotchActivitySession[] = [];

  for (const profile of await claudeProfiles(home)) {
    const registry = path.join(profile, "sessions");
    let files;
    try { files = await readdir(registry, { withFileTypes: true }); } catch { continue; }
    for (const entry of files.slice(0, 200)) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      let record: JsonObject | null = null;
      try {
        const data = await readFile(path.join(registry, entry.name), "utf8");
        if (data.length > 128 * 1024) continue;
        record = object(JSON.parse(data));
      } catch { continue; }
      const pid = finiteNumber(record?.pid);
      const cwd = text(record?.cwd);
      if (!record || !pid || !cwd || !alive(pid)) continue;

      const reported = registryState(record);
      let state = reported.state;
      let waitingFor = text(record.waitingFor) ?? text(record.needs);
      let since = finiteNumber(record.statusUpdatedAt) ?? finiteNumber(record.updatedAt)
        ?? finiteNumber(record.startedAt) ?? now;
      const sessionId = text(record.sessionId);
      if (!reported.reports && sessionId) {
        const transcript = await findClaudeTranscript(path.join(profile, "projects"), sessionId, cwd);
        const tail = transcript ? await tailFile(transcript) : null;
        const activity = tail ? parseClaudeTranscriptTail(tail.text, tail.modifiedAt, now) : null;
        if (activity) {
          state = activity.state;
          waitingFor = activity.waitingFor;
          since = activity.since;
        }
      }

      const folder = basename(cwd);
      sessions.push({
        id: `claude.${path.basename(profile)}.${sessionId ?? pid}`,
        name: bounded(text(record.name), 64, folder),
        detail: `${claudeSurface(text(record.entrypoint))} · ${folder}`,
        state,
        ...(state === "waiting" && waitingFor ? { waiting_for: bounded(waitingFor, 100, "needs your input") } : {}),
        since: iso(since),
      });
    }
  }
  return sessions.sort((left, right) => Date.parse(right.since) - Date.parse(left.since));
}

interface CodexTurnRow {
  thread_id: string;
  turn_id: string;
  status: string;
  started_at: number | null;
  completed_at: number | null;
}

interface CodexItemRow {
  last_ms: number | null;
  last_type: string | null;
}

function epochMillis(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value!) < 10_000_000_000 ? value! * 1000 : value!;
}

export function readCodexNotchActivity(
  options: Pick<ReadNotchActivityOptions, "home" | "now"> = {},
): NotchActivitySession[] {
  const home = options.home ?? os.homedir();
  const now = options.now ?? Date.now();
  const historyPath = path.join(home, ".codex", "thread_history_1.sqlite");
  const namesPath = path.join(home, ".codex", "state_5.sqlite");
  let history: Database.Database | undefined;
  let names: Database.Database | undefined;
  try {
    history = new Database(historyPath, { readonly: true, fileMustExist: true, timeout: 250 });
    try { names = new Database(namesPath, { readonly: true, fileMustExist: true, timeout: 250 }); } catch { /* titles are optional */ }
    const active = history.prepare(`
      SELECT thread_id, turn_id, status, started_at, completed_at
      FROM thread_turns
      WHERE status = 'inProgress'
      ORDER BY started_at DESC LIMIT 12
    `).all() as CodexTurnRow[];
    const completed = (history.prepare(`
      SELECT thread_id, turn_id, status, started_at, completed_at
      FROM thread_turns
      WHERE status = 'completed'
      ORDER BY completed_at DESC LIMIT 12
    `).all() as CodexTurnRow[])
      .filter((row) => now - epochMillis(row.completed_at) <= CODEX_COMPLETE_TTL_MS);
    const rows = [...active, ...completed]
      .sort((left, right) => epochMillis(right.started_at) - epochMillis(left.started_at))
      .slice(0, 12);
    const latestItem = history.prepare(`
      SELECT created_at_ms AS last_ms, item_type AS last_type
      FROM thread_items
      WHERE thread_id = ? AND turn_id = ?
      ORDER BY rollout_ordinal DESC LIMIT 1
    `);

    const named = names?.prepare("SELECT title, first_user_message, agent_nickname, cwd FROM threads WHERE id = ?");
    return rows.flatMap((row): NotchActivitySession[] => {
      const item = latestItem.get(row.thread_id, row.turn_id) as CodexItemRow | undefined;
      const started = epochMillis(row.started_at);
      const latest = epochMillis(item?.last_ms) || started;
      if (row.status === "inProgress" && now - latest > CODEX_STALE_ITEM_MS && now - started > CODEX_FRESH_TURN_MS) return [];
      const meta = named?.get(row.thread_id) as { title?: string; first_user_message?: string; agent_nickname?: string; cwd?: string } | undefined;
      const lastType = item?.last_type?.toLowerCase() ?? "";
      const waiting = /approval|permission|request_user/.test(lastType);
      const complete = row.status === "completed";
      const state: NotchActivityState = complete ? "complete" : waiting ? "waiting" : "working";
      const project = basename(meta?.cwd, "");
      return [{
        id: `codex.${row.thread_id}`,
        name: bounded(meta?.title ?? meta?.first_user_message ?? meta?.agent_nickname, 64, "Codex"),
        detail: complete ? "Complete" : waiting ? "needs your input" : project ? `Working in ${project}` : "Working",
        state,
        ...(waiting ? { waiting_for: "needs your input" } : {}),
        since: iso(complete ? epochMillis(row.completed_at) || latest : started || latest),
      }];
    });
  } catch {
    return [];
  } finally {
    names?.close();
    history?.close();
  }
}

export function parseAntigravityTranscriptTail(tail: string): { state: NotchActivityState; waitingFor?: string } {
  let turnOver = false;
  const lines = tail.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let record: JsonObject | null = null;
    try { record = object(JSON.parse(lines[index])); } catch { continue; }
    const type = text(record?.type);
    if (type === "USER_INPUT") return turnOver ? { state: "idle" } : { state: "working" };
    if (type === "PLANNER_RESPONSE") {
      const calls = Array.isArray(record?.tool_calls) ? record.tool_calls.map(object).filter(Boolean) as JsonObject[] : [];
      if (!calls.length) { turnOver = true; continue; }
      for (const call of calls) {
        const name = text(call.name) ?? "";
        if (name.includes("ask_question")) return { state: "waiting", waitingFor: "Question" };
        if (/multi_replace_file_content|write_to_file|replace_file_content/.test(name)) {
          const args = object(call.arguments);
          const metadata = object(args?.ArtifactMetadata);
          if (metadata?.RequestFeedback === true) return { state: "waiting", waitingFor: "Approval" };
        }
      }
      if (!turnOver) return { state: "working" };
      continue;
    }
    if (["EPHEMERAL_MESSAGE", "CONVERSATION_HISTORY", "KNOWLEDGE_ARTIFACTS", "CHECKPOINT"].includes(type ?? "")) continue;
    if (!turnOver) return { state: "working" };
  }
  return { state: "idle" };
}

export async function readGeminiNotchActivity(
  options: Pick<ReadNotchActivityOptions, "home" | "now"> = {},
): Promise<NotchActivitySession[]> {
  const home = options.home ?? os.homedir();
  const now = options.now ?? Date.now();
  let installs;
  try {
    installs = (await readdir(path.join(home, ".gemini"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("antigravity"))
      .slice(0, 32);
  } catch { return []; }

  let newest: { filename: string; modifiedAt: number; id: string } | null = null;
  for (const install of installs) {
    const root = path.join(home, ".gemini", install.name, "brain");
    let trajectories;
    try { trajectories = await readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const trajectory of trajectories.slice(0, 10_000)) {
      if (!trajectory.isDirectory()) continue;
      const filename = path.join(root, trajectory.name, ".system_generated", "logs", "transcript.jsonl");
      try {
        const info = await stat(filename);
        if (!newest || info.mtimeMs > newest.modifiedAt) newest = { filename, modifiedAt: info.mtimeMs, id: trajectory.name };
      } catch { /* not a trajectory */ }
    }
  }
  if (!newest) return [];
  const activity = parseAntigravityTranscriptTail((await tailFile(newest.filename))?.text ?? "");
  const age = Math.max(0, now - newest.modifiedAt);
  let state = activity.state;
  if (state === "idle") {
    if (age > 9_000) return [];
    state = "complete";
  } else if (state === "working" && age > 60_000) return [];
  else if (state === "waiting" && age > WAITING_TTL_MS) return [];
  return [{
    id: `antigravity.${newest.id}`,
    name: "Antigravity",
    detail: state === "working" ? "Working" : state === "waiting" ? activity.waitingFor ?? "Waiting" : "Complete",
    state,
    ...(state === "waiting" && activity.waitingFor ? { waiting_for: activity.waitingFor } : {}),
    since: iso(newest.modifiedAt),
  }];
}

/** Read the three agent families represented by the new-tab quota rings. */
export async function readNotchAgentActivity(
  options: ReadNotchActivityOptions = {},
): Promise<NotchActivityPayload> {
  const now = options.now ?? Date.now();
  const [anthropic, google] = await Promise.all([
    readClaudeNotchActivity({ ...options, now }),
    readGeminiNotchActivity({ ...options, now }),
  ]);
  const chatgpt = readCodexNotchActivity({ ...options, now });
  return {
    captured_at: iso(now),
    providers: { anthropic, chatgpt, google },
  };
}
