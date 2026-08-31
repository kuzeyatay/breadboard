export const COMPUTER_USE_STATE_FILENAME = "computer-use-state.json";
export const COMPUTER_USE_STATE_PREFIX = "computer-use-state.";
export const COMPUTER_USE_CANCEL_FILENAME = "computer-use-cancel";
export const COMPUTER_USE_STATE_MAX_AGE_MS = 2_750;

export type ComputerUseAppearance = "green" | "red";

export function freshComputerUseAppearance(
  raw: string,
  now = Date.now(),
  maxAgeMs = COMPUTER_USE_STATE_MAX_AGE_MS,
): ComputerUseAppearance | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value["version"] !== 1 || value["active"] !== true) return null;
    const updatedAt = value["updatedAt"];
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
    const age = now - updatedAt;
    if (age < -1_000 || age > maxAgeMs) return null;
    const appearance = value["appearance"];
    if (appearance === undefined || appearance === "green") return "green";
    return appearance === "red" ? "red" : null;
  } catch {
    return null;
  }
}

export function isFreshComputerUseState(
  raw: string,
  now = Date.now(),
  maxAgeMs = COMPUTER_USE_STATE_MAX_AGE_MS,
): boolean {
  return freshComputerUseAppearance(raw, now, maxAgeMs) !== null;
}

export function isComputerUseStateFilename(name: string): boolean {
  return name === COMPUTER_USE_STATE_FILENAME || (
    name.startsWith(COMPUTER_USE_STATE_PREFIX) &&
    name.endsWith(".json") &&
    /^[a-z0-9.-]+$/u.test(name)
  );
}
