export type PaintPomodoroMode = "focus" | "short" | "long";
export type PaintPomodoroDurations = Record<PaintPomodoroMode, number>;

export const DEFAULT_PAINT_POMODORO_DURATIONS: PaintPomodoroDurations = {
  focus: 25,
  short: 5,
  long: 15,
};
export const PAINT_POMODORO_SETTINGS_KEY = "bb_paint_pomodoro_settings_v1";

export function parsePaintPomodoroDurations(input: unknown): PaintPomodoroDurations | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const values = input as Record<string, unknown>;
  const durations = { ...DEFAULT_PAINT_POMODORO_DURATIONS };
  for (const mode of ["focus", "short", "long"] as const) {
    const value = values[mode];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 180) return null;
    durations[mode] = value;
  }
  return durations;
}
