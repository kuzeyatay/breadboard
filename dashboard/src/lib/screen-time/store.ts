import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { dashboardDataDir } from "@/lib/runtime-paths";
import { getRecallSettings } from "@/lib/recall/settings";
import { isExcluded, normalizeExcludedWindows } from "@/lib/recall/policy";
import { readUsageSlice, summarizeUsage, type ScreenTimeSettings, type UsageSlice, type ScreenTimeResponse } from "./model.ts";

function userDirectory(userId: number): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid user.");
  return path.join(dashboardDataDir(), "screen-time", String(userId));
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function getScreenTimeSettings(userId: number): Promise<ScreenTimeSettings> {
  const value = await readJson(path.join(userDirectory(userId), "settings.json"));
  return { enabled: value?.enabled !== false, excluded: normalizeExcludedWindows(value?.excluded), useForSuggestions: value?.useForSuggestions !== false };
}

export async function updateScreenTimeSettings(userId: number, patch: Partial<ScreenTimeSettings>): Promise<ScreenTimeSettings> {
  const previous = await getScreenTimeSettings(userId);
  const next = { enabled: patch.enabled ?? previous.enabled, excluded: patch.excluded === undefined ? previous.excluded : normalizeExcludedWindows(patch.excluded), useForSuggestions: patch.useForSuggestions ?? previous.useForSuggestions };
  const dir = userDirectory(userId);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, "settings.json"), temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(next), "utf8");
  await rename(temporary, target);
  return next;
}

export async function readScreenTime(userId: number, range: { start: number; end: number; boundaries: number[]; previousStart: number; previousEnd: number }): Promise<ScreenTimeResponse> {
  const dir = userDirectory(userId);
  const [settings, status] = await Promise.all([getScreenTimeSettings(userId), readJson(path.join(dir, "status.json"))]);
  const recall = getRecallSettings(userId);
  const excluded = [...settings.excluded, ...recall.excludedWindows];
  const slices: UsageSlice[] = [];
  // One preceding UTC date covers checkpoints which cross midnight.
  const first = new Date(range.previousStart - 86400000); first.setUTCHours(0, 0, 0, 0);
  const last = Math.min(range.end, Date.now());
  for (let day = first.getTime(); day < last; day += 86400000) {
    const file = path.join(dir, `${new Date(day).toISOString().slice(0, 10)}.jsonl`);
    const stream = createReadStream(file, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line || line.length > 12000) continue;
        let slice: UsageSlice | null;
        try { slice = readUsageSlice(JSON.parse(line)); } catch { continue; } // A partial final checkpoint is retried on refresh.
        if (!slice || slice.end <= range.previousStart || slice.start >= last ||
          isExcluded({ appName: slice.app, windowName: slice.title }, excluded) ||
          isExcluded({ appName: slice.process, windowName: slice.title }, excluded)) continue;
        slices.push(slice);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    finally { lines.close(); stream.destroy(); }
  }
  const updatedAt = typeof status?.updatedAt === "number" ? status.updatedAt : null;
  const available = updatedAt !== null && Date.now() - updatedAt < 20000;
  return { summary: summarizeUsage(slices, range.boundaries), previousTotal: summarizeUsage(slices, [range.previousStart, range.previousEnd]).total,
    range: { start: range.start, end: range.end }, settings,
    status: { state: !available ? "offline" : typeof status?.state === "string" ? status.state : "offline", updatedAt, available },
    recall: { enabled: recall.captureEnabled, agentAccess: recall.agentAccess } };
}
