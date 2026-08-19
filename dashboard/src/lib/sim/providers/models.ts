// Breadboard stand-in for sim's providers/models.ts (simstudioai/sim, Apache-2.0).
// Sim's file is a 4,700-line static catalog: every vendor, every model id, per-model
// pricing and capability flags, driving both its model picker and its billing. Breadboard
// does not have a static catalog — the model list is served at runtime by the ChatMock
// layer (`/api/models`) and changes with whichever accounts are signed in — so a baked-in
// copy would be wrong the day it was written. Every model here therefore routes to the one
// provider (providers/index.ts) and capability queries answer permissively.

import type { ComponentType } from "react";
import type { ModelPricing, ProviderId } from "@/lib/sim/providers/types";
import { BREADBOARD_PROVIDER_ID } from "@/lib/sim/providers/types";

/** Sim's pseudo-model that asks a hosted classifier to pick a real one. Not vendored —
 * `core/model-router/resolve` always returns the caller's fallback. */
export const SIM_AUTO_MODEL_ID = "sim-auto";

export function isAutoModel(model: string): boolean {
  return model.trim().toLowerCase() === SIM_AUTO_MODEL_ID;
}

export function getBaseModelProviders(): Record<string, ProviderId> {
  return {};
}

export function getProviderModels(_providerId: string): string[] {
  return [];
}

export function getProviderDefaultModel(_providerId: string): string {
  return "";
}

/** Sim gates billing and platform-key handout on this set. Breadboard hosts nothing. */
export function getHostedModels(): string[] {
  return [];
}

export function getModelSunsetStatus(
  _modelId: string | undefined | null,
): "legacy" | "deprecated" | undefined {
  return undefined;
}

export function isModelDeprecated(modelId: string | undefined | null): boolean {
  return getModelSunsetStatus(modelId) !== undefined;
}

/** Editor-only: sim maps a model to its vendor's React icon. Breadboard's picker renders
 * its own, so there is never one to hand back. */
export function getProviderIcon(
  _model: string,
): ComponentType<{ className?: string }> | null {
  return null;
}

/** No release-date metadata without a catalog; the caller's order is kept. */
export function orderModelIdsByReleaseDate(modelIds: string[]): string[] {
  return [...modelIds];
}

export function getModelPricing(_modelId: string): ModelPricing | null {
  return null;
}

export function supportsTemperature(_modelId: string): boolean {
  return true;
}

export function getMaxTemperature(_modelId: string): number | undefined {
  return 2;
}

export function supportsToolUsageControl(_providerId: string): boolean {
  return true;
}

// Capability sets. Empty rather than guessed: an incorrect "yes" makes the agent block
// send a parameter the local model layer rejects, while an empty set only hides an
// optional control.
export function getModelsWithReasoningEffort(): string[] {
  return [];
}
export function getModelsWithVerbosity(): string[] {
  return [];
}
export function getModelsWithThinking(): string[] {
  return [];
}
export function getModelsWithPromptCaching(): string[] {
  return [];
}
export function getModelsWithDeepResearch(): string[] {
  return [];
}
export function getModelsWithoutMemory(): string[] {
  return [];
}
export function getComputerUseModels(): string[] {
  return [];
}

export function getReasoningEffortValuesForModel(_modelId: string): string[] | null {
  return null;
}
export function getVerbosityValuesForModel(_modelId: string): string[] | null {
  return null;
}
export function getThinkingLevelsForModel(_modelId: string): string[] | null {
  return null;
}

export const PROVIDER_DEFINITIONS: Record<string, { id: string; models: string[] }> = {
  [BREADBOARD_PROVIDER_ID]: { id: BREADBOARD_PROVIDER_ID, models: [] },
};
