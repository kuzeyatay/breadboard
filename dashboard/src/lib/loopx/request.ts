const MAX_ARGUMENT_LENGTH = 4_096;
const OUTCOMES = new Set(["completed", "error", "cancelled"]);

export class LoopxError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LoopxError";
    this.code = code;
  }
}

/** Flatten user-derived text before it reaches LoopX durable state. */
export function loopxText(value: string, limit = 400): string {
  const flattened = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flattened.slice(0, Math.min(limit, MAX_ARGUMENT_LENGTH));
}

export interface LoopxTickRuntimeRequest {
  protocolVersion: 1;
  operation: "tick";
  conversationPublicId: string;
  turnSequence: number;
  objective: string;
  outcome: "completed" | "error" | "cancelled";
  toolCalls: number;
  producedArtifact: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 256 && !/\p{Cc}/u.test(value);
}

/** Validate the complete internal tick submitted after a durable chat turn. */
export function validateLoopxTickRuntimeRequest(value: unknown): LoopxTickRuntimeRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "protocolVersion",
      "operation",
      "conversationPublicId",
      "turnSequence",
      "objective",
      "outcome",
      "toolCalls",
      "producedArtifact",
    ]) ||
    value.protocolVersion !== 1 ||
    value.operation !== "tick" ||
    !boundedIdentifier(value.conversationPublicId) ||
    !Number.isSafeInteger(value.turnSequence) ||
    Number(value.turnSequence) < 1 ||
    Number(value.turnSequence) > 10_000_000 ||
    typeof value.objective !== "string" ||
    value.objective !== loopxText(value.objective) ||
    Buffer.byteLength(value.objective, "utf8") > MAX_ARGUMENT_LENGTH ||
    !OUTCOMES.has(String(value.outcome)) ||
    !Number.isSafeInteger(value.toolCalls) ||
    Number(value.toolCalls) < 0 ||
    Number(value.toolCalls) > 10_000 ||
    typeof value.producedArtifact !== "boolean"
  ) {
    throw new LoopxError("loopx_invalid_tick", "The canonical LoopX tick is invalid.");
  }
  return value as unknown as LoopxTickRuntimeRequest;
}
