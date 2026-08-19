// Breadboard stand-in for sim's lib/logs/execution/pii-redaction.ts (simstudioai/sim,
// Apache-2.0). Sim's version calls a Presidio PII service; Breadboard has no such
// sidecar wired into the engine. Both call sites in block-executor.ts are gated
// behind `ExecutionContext.piiBlockOutputRedaction?.enabled`, which Breadboard's
// contextExtensions never sets, so this identity pass-through never actually runs
// — it exists to keep the vendored call sites type-correct.

interface RedactionOptions {
  entityTypes?: readonly string[];
  language?: string;
  customPatterns?: unknown;
  onFailure?: "throw" | "ignore";
}

export async function redactObjectStrings<T>(value: T, _options: RedactionOptions): Promise<T> {
  return value;
}
