// Breadboard stand-in for sim's lib/core/rate-limiter/types.ts (simstudioai/sim, Apache-2.0).
// Only the plan union is referenced by the vendored engine; the token-bucket rate
// limiter itself is SaaS machinery and was not vendored.

export type SubscriptionPlan = "free" | "pro" | "team" | "enterprise";
