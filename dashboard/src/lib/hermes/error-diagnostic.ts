/** Server-only crash evidence. Never retain the request or an exception's message. */
export function unexpectedErrorDiagnostic(error: unknown): {
  kind: string;
  frames: Array<{ file: string; line: number; column: number }>;
} {
  const kind = error instanceof RangeError ? "RangeError"
    : error instanceof TypeError ? "TypeError"
    : error instanceof SyntaxError ? "SyntaxError"
    : error instanceof Error ? "Error" : "Unknown";
  const frames: Array<{ file: string; line: number; column: number }> = [];
  try {
    if (error instanceof Error && typeof error.stack === "string") {
      // V8's first line contains the message, which can include tokens, document
      // text or URLs. Keep only code basenames and positions from actual frames.
      for (const entry of error.stack.slice(0, 32_000).split("\n").slice(1)) {
        const match = /^\s+at .*[\\/]([\w.\[\]~@-]+\.(?:[cm]?js|tsx?)):(\d+):(\d+)\)?$/.exec(entry);
        if (!match) continue;
        frames.push({ file: match[1]!, line: Number(match[2]), column: Number(match[3]) });
        if (frames.length === 20) break;
      }
    }
  } catch {
    // A custom stack getter or formatter must not replace the original failure.
  }
  return { kind, frames };
}
