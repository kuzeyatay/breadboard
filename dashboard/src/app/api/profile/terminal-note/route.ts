import db from "@/lib/db";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { readJsonBody } from "@/lib/hermes/route-core";
import { DEFAULT_NOTE_ID, validNoteId, validNoteText } from "@/lib/terminal-note";
import { createTerminalNote, deleteTerminalNote, listTerminalNotes, readTerminalNote, writeTerminalNote } from "@/lib/terminal-note-store";

export const dynamic = "force-dynamic";
const headers = {"Cache-Control": "no-store"};
async function owner(request: Request) {
  const userId = await requireUserId();
  const user = db.prepare("SELECT email FROM users WHERE id=?").get(userId) as {email: string} | undefined;
  const key = new URL(request.url).searchParams.get("ownerKey")?.trim().toLowerCase();
  if (!key || !user || ![String(userId), user.email.trim().toLowerCase()].includes(key)) {
    throw new RouteError(403, "Your account changed. Reload before editing this note.");
  }
  return userId;
}
function noteId(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? DEFAULT_NOTE_ID;
  if (!validNoteId(id)) throw new RouteError(400, "Invalid note.");
  return id;
}
export async function GET(request: Request) {
  try {
    const userId = await owner(request);
    if (new URL(request.url).searchParams.get("list") === "1") return Response.json({notes: listTerminalNotes(db, userId)}, {headers});
    const note = readTerminalNote(db, userId, noteId(request));
    return Response.json({note}, {status: note ? 200 : 404, headers});
  } catch (error) { return routeErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await owner(request);
    const body = await readJsonBody(request, 128_000);
    const id = body.id;
    if (!validNoteId(id) || id === DEFAULT_NOTE_ID || !validNoteText(body)) throw new RouteError(400, "Invalid note.");
    const note = createTerminalNote(db, userId, id, body);
    return Response.json({note}, {status: note ? 200 : 409, headers});
  } catch (error) { return routeErrorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    const userId = await owner(request);
    const body = await readJsonBody(request, 128_000);
    const revision = body.revision;
    if (!validNoteText(body) || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
      throw new RouteError(400, "The note is too long or invalid.");
    }
    const result = writeTerminalNote(db, userId, {title: body.title, body: body.body}, revision, noteId(request));
    return Response.json(result, {status: result.ok ? 200 : result.note ? 409 : 404, headers});
  } catch (error) { return routeErrorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    const userId = await owner(request), id = noteId(request);
    const body = await readJsonBody(request, 1024);
    if (typeof body.revision !== "number" || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new RouteError(400, "Invalid note.");
    const ok = deleteTerminalNote(db, userId, id, body.revision);
    return Response.json({ok}, {status: ok ? 200 : 409, headers});
  } catch (error) { return routeErrorResponse(error); }
}
