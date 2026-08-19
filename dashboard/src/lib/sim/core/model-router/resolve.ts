// Breadboard stand-in for sim's lib/model-router/resolve.ts (simstudioai/sim, Apache-2.0).
// `sim-auto` is a hosted-only pseudo-model: sim calls a mothership classifier to pick a
// difficulty tier, then maps that tier onto its own model pool. Sim itself returns the
// fallback unchanged whenever `isHosted` is false, which is Breadboard's only state — so
// this keeps that branch and drops the classifier, its cache, and its billing.

import type { ExecutionContext } from "@/lib/sim/executor/types";
import type { ModelCost } from "@/lib/sim/providers/cost-policy";

export type AutoMediaKind = "none" | "image" | "file";
export type AutoTierId = string;

export const SIM_AUTO_SYSTEM_PREAMBLE = "";

export interface ModelRouterUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AutoRoutingSignals {
  systemPrompt?: string;
  lastMessage?: string;
  messageCount: number;
  toolNames: string[];
  mediaKind: AutoMediaKind;
  hasResponseFormat: boolean;
  approxInputTokens: number;
}

export interface AutoRoutingResult {
  model: string;
  tier: AutoTierId | null;
  decidedBy: "llm" | "cache" | "fallback";
  billableRoutingCost: number;
  usage?: ModelRouterUsage;
}

export type AutoRoutedModelCost = ModelCost & { routing?: number };

/** Adds a successful classifier call to a settled provider cost. Always a no-op here:
 * no classifier runs, so `routingCost` is always 0. */
export function addAutoRoutingCost(cost: ModelCost, routingCost: number): AutoRoutedModelCost {
  if (routingCost <= 0) return cost;
  return { ...cost, routing: routingCost, total: cost.total + routingCost };
}

export async function resolveAutoModel(args: {
  ctx: ExecutionContext;
  blockId: string;
  signals: AutoRoutingSignals;
  fallbackModel: string;
}): Promise<AutoRoutingResult> {
  return {
    model: args.fallbackModel,
    tier: null,
    decidedBy: "fallback",
    billableRoutingCost: 0,
  };
}
