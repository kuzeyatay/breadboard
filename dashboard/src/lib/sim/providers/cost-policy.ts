// Breadboard stand-in for sim's providers/cost-policy.ts (simstudioai/sim, Apache-2.0).
// Sim separates pricing (providers own token→USD) from billing policy (whether Sim
// supplied the credentials, and at what margin). Breadboard supplies its own local model
// layer and bills nothing, so policy resolves to "not billed" everywhere — which is sim's
// own non-hosted branch — and the shape is kept so block outputs still carry a cost field.

import type { ModelPricing } from "@/lib/sim/providers/types";

/** Cost shape written onto block output. Mirrors `BlockCost`. */
export interface ModelCost {
  input: number;
  output: number;
  total: number;
  toolCost?: number;
  pricing?: ModelPricing;
}

export type PricedModelCost = ModelCost & { pricing: ModelPricing };

export const ZERO_PRICING: ModelPricing = {
  input: 0,
  output: 0,
  updatedAt: "1970-01-01",
};

export function notBilledCost(): ModelCost {
  return { input: 0, output: 0, total: 0 };
}

/**
 * Applies billing policy to a settled provider cost. Every Breadboard model call runs on
 * the operator's own credentials, so the charge is always zero — but a `pricing` field
 * present on the input is preserved so downstream estimators can tell a priced zero from
 * an unpriced block.
 */
export function resolveProxiedModelCost(cost: unknown): ModelCost {
  if (!cost || typeof cost !== "object") return notBilledCost();
  const { pricing } = cost as Partial<ModelCost>;
  return { ...notBilledCost(), ...(pricing ? { pricing } : {}) };
}
