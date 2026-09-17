import { PAINT_POMODORO_SETTINGS_KEY, parsePaintPomodoroDurations, type PaintPomodoroDurations } from "./paint-pomodoro-settings.ts";

const SETTINGS_URL = "/api/paint-pomodoro/settings";
let pendingSave: Promise<void> = Promise.resolve();

export function readLocalPaintPomodoroDurations(): PaintPomodoroDurations | null {
  try {
    return parsePaintPomodoroDurations(JSON.parse(window.localStorage.getItem(PAINT_POMODORO_SETTINGS_KEY) ?? "null"));
  } catch {
    return null;
  }
}

export function cachePaintPomodoroDurations(durations: PaintPomodoroDurations): void {
  try {
    window.localStorage.setItem(PAINT_POMODORO_SETTINGS_KEY, JSON.stringify(durations));
  } catch {
    // Account storage still works when browser storage is unavailable.
  }
}

export async function loadPaintPomodoroDurations(): Promise<PaintPomodoroDurations | null> {
  // A remount must see the last change even if its write is still in flight.
  await pendingSave;
  const response = await fetch(SETTINGS_URL, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error("Could not load saved timer settings.");
  const data = await response.json();
  if (data?.durations === null) return null;
  const durations = parsePaintPomodoroDurations(data?.durations);
  if (!durations) throw new Error("The saved timer settings could not be read.");
  return durations;
}

export function savePaintPomodoroDurations(durations: PaintPomodoroDurations): Promise<void> {
  cachePaintPomodoroDurations(durations);
  const body = JSON.stringify(durations);
  // Serialize clicks so a slower earlier save cannot replace the final value.
  const save = pendingSave.then(async () => {
    const response = await fetch(SETTINGS_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Could not save timer settings to your account.");
  });
  pendingSave = save.catch(() => undefined);
  return save;
}
