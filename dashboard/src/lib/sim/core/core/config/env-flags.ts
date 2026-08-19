// Breadboard stand-in for sim's lib/core/config/env-flags.ts (simstudioai/sim, Apache-2.0).
// Sim's flags gate its hosted SaaS (billing, managed sandboxes, first-party provider
// keys). Breadboard runs the engine self-hosted against its own model layer, so every
// hosted-only flag is false and the provider-configured flags read straight from env.

import { getEnv, isTruthy } from "@/lib/sim/core/core/config/env";

/** Sim's multi-tenant cloud. Breadboard is always self-hosted. */
export const isHosted = false;

/** Sim's billing/subscription plane is not vendored. */
export const isBillingEnabled = false;

export const isProd = process.env.NODE_ENV === "production";
export const isDev = process.env.NODE_ENV === "development";
export const isTest = process.env.NODE_ENV === "test";

/** Remote code sandboxes (e2b/daytona) were not vendored — the function block runs on node:vm. */
export const isSandboxesEnabled = false;

export const isAzureConfigured = Boolean(getEnv("AZURE_OPENAI_API_KEY"));
export const isCohereConfigured = Boolean(getEnv("COHERE_API_KEY"));
export const isOllamaConfigured = Boolean(getEnv("OLLAMA_URL"));

export const isTruthyEnv = (name: string): boolean => isTruthy(getEnv(name));
