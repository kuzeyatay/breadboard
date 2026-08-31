import {
  DEFAULT_OPENEXECUTIVE_MAX_ITERATIONS,
  MAX_OPENEXECUTIVE_MAX_ITERATIONS,
  MIN_OPENEXECUTIVE_MAX_ITERATIONS,
} from "./identity.ts";

export interface OpenExecutiveSettings {
  maxIterations: number;
  committeeReview: boolean;
}
export const DEFAULT_OPENEXECUTIVE_SETTINGS: OpenExecutiveSettings = {
  maxIterations: DEFAULT_OPENEXECUTIVE_MAX_ITERATIONS,
  committeeReview: false,
};

export function openExecutiveSettingsFrom(
  values: Record<string, unknown>,
): OpenExecutiveSettings {
  const candidate = Number(values.maxIterations);
  const maxIterations = Number.isFinite(candidate)
    ? Math.min(
        MAX_OPENEXECUTIVE_MAX_ITERATIONS,
        Math.max(MIN_OPENEXECUTIVE_MAX_ITERATIONS, Math.round(candidate)),
      )
    : DEFAULT_OPENEXECUTIVE_SETTINGS.maxIterations;
  return {
    maxIterations,
    committeeReview:
      typeof values.committeeReview === "boolean"
        ? values.committeeReview
        : DEFAULT_OPENEXECUTIVE_SETTINGS.committeeReview,
  };
}
