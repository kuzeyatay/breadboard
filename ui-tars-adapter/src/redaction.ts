// Secret redaction for logs and outbound error messages.
//
// Two layers:
//  1. Exact-value redaction of secrets we hold (adapter secret, provider key).
//  2. Pattern redaction of known secret formats, so a leaked key we do NOT hold
//     (e.g. echoed by an upstream error) is still scrubbed.
//
// This never returns a raw stack, path, or provider request body to a caller.

const REDACTED = "[REDACTED]";

/** Known secret-shaped patterns, redacted even when we don't hold the value. */
const SECRET_PATTERNS: RegExp[] = [
  // OpenAI / OpenAI-compatible keys
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  // Anthropic keys
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  // Bearer tokens in Authorization headers
  /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{12,}=*/g,
  // Generic long base64url-ish secrets after key=/token= assignments
  /\b(api[_-]?key|apikey|secret|token|password|authorization)\s*[=:]\s*["']?[A-Za-z0-9._~+/-]{12,}["']?/gi,
];

/**
 * Redact a single log/error line. `extraSecrets` are exact values (adapter
 * secret, provider key) that must be scrubbed by value.
 */
export function redact(line: string, extraSecrets: readonly string[] = []): string {
  let out = line;
  for (const secret of extraSecrets) {
    if (typeof secret === "string" && secret.length >= 6) {
      out = out.split(secret).join(REDACTED);
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/** Build a line redactor bound to a fixed secret set (for a log stream hook). */
export function makeRedactor(extraSecrets: readonly string[]): (line: string) => string {
  const held = extraSecrets.filter((s) => typeof s === "string" && s.length >= 6);
  return (line: string) => redact(line, held);
}

/**
 * Produce a caller-safe error string: stable, redacted, never a stack or path.
 * Used before any error text crosses the loopback boundary.
 */
export function safeErrorMessage(err: unknown, extraSecrets: readonly string[] = []): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "unknown_error";
  // Strip anything path-like (Windows or POSIX) before redacting secrets.
  const noPaths = raw
    .replace(/[A-Za-z]:\\[^\s"']+/g, "<path>")
    .replace(/(?:\/[^\s"':]+){2,}/g, "<path>");
  return redact(noPaths, extraSecrets);
}
