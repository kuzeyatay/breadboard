import { createHash } from "node:crypto";

/**
 * Convert Breadboard's durable request identity into an Hermes message ID.
 * Hermes brands prompt message IDs with the `msg_` prefix, so forwarding a
 * browser UUID directly is rejected before the course correction is persisted.
 * The hash keeps retries deterministic without exposing arbitrary request text
 * in the runtime identifier.
 */
export function hermesMessageId(clientRequestId: string): string {
  const digest = createHash("sha256")
    .update(clientRequestId, "utf8")
    .digest("base64url")
    .slice(0, 26);
  return `msg_${digest}`;
}
