// Breadboard stand-in for sim's lib/billing/plan-helpers.ts (simstudioai/sim, Apache-2.0).
// Billing is not vendored (isBillingEnabled === false), so every account resolves to
// the free tier and the execution-limit table reads its untimed branch.

import type { SubscriptionPlan } from "@/lib/sim/core/core/rate-limiter/types";

export function getPlanTypeForLimits(_plan: string | null | undefined): SubscriptionPlan {
  return "free";
}
