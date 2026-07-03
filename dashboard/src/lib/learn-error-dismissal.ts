export interface LearnErrorLike {
  id?: string;
  currentStep?: string;
  currentSectionTitle?: string;
  currentPageTitle?: string;
  error?: string;
}

export const LEARN_ERROR_DISMISSALS_STORAGE_KEY =
  "breadboard.learnErrorDismissals.v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function gardenPrefix(gardenKey: string): string {
  return `learn-error:${encodeURIComponent(gardenKey)}:`;
}

export function learnErrorDismissalKey(
  gardenKey: string,
  job: LearnErrorLike,
): string {
  const fingerprint = JSON.stringify({
    step: job.currentStep ?? "",
    section: job.currentSectionTitle ?? "",
    page: job.currentPageTitle ?? "",
    error: job.error ?? "",
  });
  return `${gardenPrefix(gardenKey)}${hashString(fingerprint)}`;
}

export function loadDismissedLearnErrorKeys(
  storage: StorageLike | null = getBrowserStorage(),
): string[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(
      storage.getItem(LEARN_ERROR_DISMISSALS_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberDismissedLearnErrorKey(
  key: string,
  storage: StorageLike | null = getBrowserStorage(),
): string[] {
  if (!storage) return [];
  const current = loadDismissedLearnErrorKeys(storage);
  const next = [key, ...current.filter((item) => item !== key)].slice(0, 100);
  try {
    storage.setItem(LEARN_ERROR_DISMISSALS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The caller still receives the in-memory value for the current render.
  }
  return next;
}

export function forgetDismissedLearnErrorsForGarden(
  gardenKey: string,
  storage: StorageLike | null = getBrowserStorage(),
): string[] {
  if (!storage) return [];
  const prefix = gardenPrefix(gardenKey);
  const next = loadDismissedLearnErrorKeys(storage).filter(
    (item) => !item.startsWith(prefix),
  );
  try {
    storage.setItem(LEARN_ERROR_DISMISSALS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The caller still receives the in-memory value for the current render.
  }
  return next;
}
