// What a teaching session is allowed to say in a log.
//
// A demonstration holds a screen recording, a microphone recording, whatever the
// user typed, and the titles of every window they passed through. None of that
// belongs in application logs, where it would outlive the session, get copied
// into diagnostics bundles, and be read by people who were never shown the
// recording.
//
// So logging goes through here. The rule is that a log line may say what kind of
// thing happened and how much of it, never what it was.

import type { DemonstrationEvent } from "./types.ts";

const NEVER_LOGGED_KEYS = new Set([
  "audio",
  "audiopath",
  "audiobase64",
  "detail",
  "frame",
  "framepath",
  "frames",
  "screenshot",
  "screenshotpath",
  "text",
  "transcript",
  "narration",
  "value",
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "clipboard",
  "windowtitle",
  "target",
]);

/** A path is a filename plus a shape, not a location on someone's disk. */
export function redactPath(value: string | null | undefined): string {
  if (!value) return "(none)";
  const normalized = value.replace(/\\/gu, "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot) : "";
  return `<file${extension}>`;
}

/** Text becomes its own length. Enough to debug a truncation, useless to a reader. */
export function redactText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "(none)";
  return `<${value.length} characters>`;
}

/**
 * A log-safe line for one recorded action.
 *
 * The type, the timing and whether a target was resolved are what a support
 * question actually needs. The window title and the typed text are what it
 * never does.
 */
export function describeEventForLog(event: DemonstrationEvent): string {
  const parts = [
    `type=${event.type}`,
    `offset=${event.offsetMs}ms`,
    `importance=${event.importance}`,
    `target=${event.target ? "resolved" : "unresolved"}`,
  ];
  if (event.type === "text_input") {
    parts.push(event.redacted ? "text=withheld(secret field)" : `text=${redactText(event.detail)}`);
  }
  if (event.visualContextRef) parts.push("frame=captured");
  return parts.join(" ");
}

/**
 * Strip a structure down to what may be logged.
 *
 * Unknown keys survive with their values only when those values are numbers or
 * booleans; anything textual is replaced by its length. A new field added to a
 * payload later is therefore safe by default rather than by remembering.
 */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 4) return "<nested>";
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) {
    return value.length <= 8
      ? value.map((item) => redactForLog(item, depth + 1))
      : `<${value.length} items>`;
  }
  if (typeof value !== "object") return "<value>";

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (NEVER_LOGGED_KEYS.has(key.toLowerCase())) {
      output[key] = typeof entry === "string" ? redactText(entry) : "<withheld>";
      continue;
    }
    output[key] = redactForLog(entry, depth + 1);
  }
  return output;
}

/**
 * The single logging entry point for the teaching subsystem.
 *
 * It exists so that "does this feature log the microphone?" has one answer in
 * one place rather than needing every call site audited.
 */
export function teachLog(scope: string, message: string, detail?: Record<string, unknown>): void {
  const suffix = detail ? ` ${JSON.stringify(redactForLog(detail))}` : "";
  console.log(`[teach:${scope}] ${message}${suffix}`);
}

export function teachWarn(scope: string, message: string, detail?: Record<string, unknown>): void {
  const suffix = detail ? ` ${JSON.stringify(redactForLog(detail))}` : "";
  console.warn(`[teach:${scope}] ${message}${suffix}`);
}
