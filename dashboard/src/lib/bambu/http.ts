import { requireSameOrigin } from "../request-origin.ts";
import { requireUserId } from "../server-auth.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { fail, BambuError } from "./types.ts";
export async function trustedPrinterUser(request: Request, mutation = false) {
  if (mutation) {
    requireSameOrigin(request, "Printer actions must originate in Breadboard.");
    if (!request.headers.get("origin") || request.headers.has("authorization") || request.headers.has("x-hermes-session-id")) fail("Approve printer actions in Breadboard's signed-in review interface.", "trusted_ui_required", 403);
  }
  return requireUserId();
}
export function printerConversation(request: Request, userId: number) {
  const publicId = new URL(request.url).searchParams.get("conversation") ?? "";
  const conversation = getConversationForUser(publicId, userId);
  const chatSessionId = new URL(request.url).searchParams.get("chatSessionId");
  if (chatSessionId && conversation.legacy_chat_session_id !== Number(chatSessionId)) fail("Printer job is not attached to this chat.", "bambu_scope_mismatch", 403);
  return publicId;
}
export async function boundedBytes(request: Request, max: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length") ?? "0") > max) fail("This upload exceeds its size limit.", "request_too_large", 413);
  const reader = request.body?.getReader(); if (!reader) fail("A request body is required.", "body_required", 400);
  let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); fail("This upload exceeds its size limit.", "request_too_large", 413); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
export async function printerJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) fail("JSON is required.", "json_required", 400);
  try { const value = JSON.parse((await boundedBytes(request, 32768)).toString("utf8")); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; }
  catch (error) { if (error instanceof BambuError) throw error; fail("Invalid JSON request.", "invalid_json", 400); }
}
export function printerError(error: unknown) {
  const e = error as { status?: number; code?: string; message?: string };
  return Response.json({ error: typeof e.status === "number" ? e.message : "Printer request failed. Check the connection or selected file.", code: e.code ?? "printer_request_failed" }, { status: e.status ?? 500, headers: { "Cache-Control": "no-store" } });
}
export const printerResponse = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
