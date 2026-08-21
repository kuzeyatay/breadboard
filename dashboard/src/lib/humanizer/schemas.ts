// What the browser is allowed to send.
//
// Deliberately narrow. The browser may say *what text* to rewrite and *which
// message* to apply a rewrite to. It may not name a service URL, a model id, a
// revision, a device, a filesystem path or a secret: every one of those is
// resolved on the server from configuration the renderer cannot see. A schema
// that accepted them would turn a loopback sidecar into an open proxy.

import { z } from "zod";
import { HUMANIZER_MAX_TEXT_CHARS } from "./config.ts";
import { MAX_CONTENT_VERSIONS } from "../conversations/message-versions.ts";

/**
 * A restored row has a `msg_<id>` identity. A just-finished live row still has
 * the opaque client message id that reserved the turn. Both identify the same
 * assistant row inside an already authenticated, owned conversation.
 */
const MESSAGE_REFERENCE = z.string().regex(
  /^(?:msg_\d+|[A-Za-z0-9][A-Za-z0-9._:-]{7,127})$/,
  "messageId must be a stored message id or client message id",
);

export const humanizeRequestSchema = z.object({
  text: z.string().min(1).max(HUMANIZER_MAX_TEXT_CHARS),
  /**
   * Idempotency and cancellation handle, chosen by the browser. Opaque to
   * everything downstream: it is logged, never interpreted, and never used to
   * build a path.
   */
  requestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "requestId must be 8-64 URL-safe characters"),
});

export type HumanizeRequestInput = z.infer<typeof humanizeRequestSchema>;

export const applyRewriteSchema = z.object({
  conversationId: z.string().min(1).max(128),
  messageId: MESSAGE_REFERENCE,
  /**
   * The content the rewrite was produced from. The apply fails when the row no
   * longer holds it, which is the difference between "apply my rewrite" and
   * "overwrite whatever is there now".
   */
  expectedContent: z.string().min(1).max(HUMANIZER_MAX_TEXT_CHARS),
  rewrittenText: z.string().min(1).max(HUMANIZER_MAX_TEXT_CHARS),
});

export type ApplyRewriteInput = z.infer<typeof applyRewriteSchema>;

export const selectVersionSchema = z.object({
  conversationId: z.string().min(1).max(128),
  messageId: MESSAGE_REFERENCE,
  index: z.number().int().min(0).max(MAX_CONTENT_VERSIONS - 1),
});

export type SelectVersionInput = z.infer<typeof selectVersionSchema>;

export interface SchemaFailure {
  error: string;
  issues: string[];
}

export function parseRequest<T>(
  schema: z.ZodType<T>,
  value: unknown,
): { ok: true; value: T } | { ok: false; failure: SchemaFailure } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    failure: {
      error: "invalid_input",
      issues: result.error.issues.slice(0, 8).map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      }),
    },
  };
}

/** Numeric row id behind a `msg_<id>` public identity. */
export function messageRowId(publicId: string): number {
  return Number.parseInt(publicId.slice(4), 10);
}

export function isStoredMessageId(value: string): boolean {
  return /^msg_\d+$/.test(value);
}
