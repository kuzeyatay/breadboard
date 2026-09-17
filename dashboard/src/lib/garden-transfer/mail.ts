import db from "../db.ts";
import { ApiError } from "../hermes/route-core.ts";
import { buildNangoActionInvocation, gmailGardenSlugs, rawGmailMessage, MAX_GMAIL_ATTACHMENT_BYTES } from "../nango/actions.ts";
import type { GmailAttachment } from "../nango/actions.ts";
import { exportGardenArchive } from "./export.ts";
import type { Readable } from "node:stream";

function isGardenMail(action: string, args: unknown): args is Record<string, unknown> {
  return ["gmail_send_message", "gmail_create_draft"].includes(action) &&
    !!args && typeof args === "object" && !Array.isArray(args);
}

/** Validate arguments before looking up an account, without opening Garden files. */
export function validateConnectedAction(action: string, args: unknown) {
  if (!isGardenMail(action, args)) return buildNangoActionInvocation(action, args);
  gmailGardenSlugs(args);
  return buildNangoActionInvocation(action, { ...args, gardenSlugs: [] });
}

/** Bound the compressed attachment, not the uncompressed Garden export. */
export async function readMailAttachment(stream: Readable, remaining: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.length;
    if (bytes > remaining) {
      throw new ApiError(413, "gmail_attachment_too_large", "This garden exceeds Gmail's 25 MB attachment limit. Export it and share it using a file-sharing service, then email its accessible link. No email was sent.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

/** Called only after the connected-action approval and account checks. */
export async function connectedActionWithGardenAttachments(input: {
  userId: number;
  allowedGardenIds?: readonly number[];
  action: string;
  args: unknown;
}) {
  const invocation = validateConnectedAction(input.action, input.args);
  if (!isGardenMail(input.action, input.args)) return invocation;
  const args = input.args;
  const slugs = [...new Set(gmailGardenSlugs(args))];
  if (!slugs.length) return invocation;

  // Ownership alone does not widen a conversation's authorized Garden set.
  for (const slug of slugs) {
    const garden = db.prepare("SELECT id FROM clusters WHERE user_id = ? AND slug = ?")
      .get(input.userId, slug) as { id: number } | undefined;
    if (!garden || !input.allowedGardenIds?.includes(garden.id)) {
      throw new ApiError(403, "garden_attachment_denied", "An attached Garden is outside this conversation's authorized set.");
    }
  }
  const attachments: GmailAttachment[] = [];
  let remaining = MAX_GMAIL_ATTACHMENT_BYTES;
  for (const slug of slugs) {
    const download = exportGardenArchive(input.userId, slug);
    const data = await readMailAttachment(download.stream, remaining);
    remaining -= data.length;
    attachments.push({ filename: download.filename, mimeType: download.mimeType, data });
  }
  const message = { raw: rawGmailMessage(args, attachments),
    ...(args.threadId ? { threadId: args.threadId } : {}) };
  invocation.request.body = input.action === "gmail_create_draft" ? { message } : message;
  return invocation;
}
