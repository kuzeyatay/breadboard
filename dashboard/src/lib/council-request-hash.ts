import { createHash } from "crypto";

export const COUNCIL_REQUEST_HASH_SCHEMA_VERSION = 1 as const;

const RESOLVED_MODEL_PLACEHOLDER = "{{BREADBOARD_CHATMOCK_RESOLVED_MODEL}}";
const RESOLVED_PROVIDER_PLACEHOLDER = "{{BREADBOARD_CHATMOCK_RESOLVED_PROVIDER}}";

export interface CouncilRequestEnvelopeV1 {
  schemaVersion: typeof COUNCIL_REQUEST_HASH_SCHEMA_VERSION;
  messages: unknown;
  taskType: string | null;
  gardenId: string | null;
  pageId: string | null;
  sourceContext: unknown;
  councilMode: string;
  requestedModel: string | null;
  resolvedModel: string | null;
  reasoning: {
    effort: string | null;
    summary: string | null;
  };
  temperature: number | null;
  maxTokens: number | null;
}

function float64Hex(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Canonical Council request numbers must be finite.");
  }
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, false);
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalCouncilValueV1(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) {
        throw new Error("Canonical Council request integers must be safe integers.");
      }
      return { $number: `i:${value}` };
    }
    return { $number: `f64:${float64Hex(value)}` };
  }
  if (Array.isArray(value)) {
    return value.map(canonicalCouncilValueV1);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalCouncilValueV1(record[key])]),
    );
  }
  throw new Error(`Unsupported canonical Council request value: ${typeof value}`);
}

export function canonicalCouncilJsonV1(value: unknown): string {
  const write = (normalized: unknown): string => {
    if (
      normalized === null ||
      typeof normalized === "string" ||
      typeof normalized === "boolean"
    ) {
      return JSON.stringify(normalized);
    }
    if (Array.isArray(normalized)) {
      return `[${normalized.map(write).join(",")}]`;
    }
    if (normalized && typeof normalized === "object") {
      const record = normalized as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${write(record[key])}`)
        .join(",")}}`;
    }
    throw new Error("Canonical Council projection contains an unsupported value.");
  };
  return write(canonicalCouncilValueV1(value));
}

export function councilRequestHashV1(envelope: CouncilRequestEnvelopeV1): string {
  return createHash("sha256").update(canonicalCouncilJsonV1(envelope), "utf8").digest("hex");
}

/** Mirror ChatMock's server-side placeholder substitution.  Learn uses an
 * explicit resolved model, so this is deterministic and ordinarily a no-op. */
export function withResolvedCouncilIdentityV1(
  value: unknown,
  model: string,
  provider: string,
): unknown {
  if (typeof value === "string") {
    return value
      .replaceAll(RESOLVED_MODEL_PLACEHOLDER, model)
      .replaceAll(RESOLVED_PROVIDER_PLACEHOLDER, provider);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => withResolvedCouncilIdentityV1(entry, model, provider));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        withResolvedCouncilIdentityV1(entry, model, provider),
      ]),
    );
  }
  return value;
}
