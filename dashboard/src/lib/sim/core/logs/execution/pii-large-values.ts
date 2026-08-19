// Breadboard stand-in for sim's lib/logs/execution/pii-large-values.ts
// (simstudioai/sim, Apache-2.0). See pii-redaction.ts sibling — same reasoning:
// the one call site is gated behind a context flag Breadboard never sets.

interface RedactionOptions {
  entityTypes?: readonly string[];
  language?: string;
  customPatterns?: unknown;
  onFailure?: "throw" | "ignore";
  store?: {
    workspaceId?: string | null;
    workflowId?: string | null;
    executionId?: string | null;
    userId?: string | null;
  };
}

export async function redactLargeValueRefsInValue<T>(
  value: T,
  _options: RedactionOptions,
): Promise<T> {
  return value;
}
