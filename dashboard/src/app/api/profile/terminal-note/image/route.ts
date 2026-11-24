import { randomUUID } from "node:crypto";
import db from "@/lib/db";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { readTerminalNoteImage, saveTerminalNoteImage } from "@/lib/terminal-note-store";

export const dynamic = "force-dynamic";
const MAX_BYTES = 10 * 1024 * 1024;
const MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const mime = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!MIME.has(mime)) throw new RouteError(415, "Only PNG, JPEG, GIF or WebP images can be pasted.");
    const data = Buffer.from(await request.arrayBuffer());
    if (!data.length || data.length > MAX_BYTES) throw new RouteError(413, "Images must be under 10 MB.");
    const id = randomUUID().replace(/-/g, "");
    saveTerminalNoteImage(db, userId, id, mime, data);
    return Response.json({url: `/api/profile/terminal-note/image?id=${id}`}, {headers: {"Cache-Control": "no-store"}});
  } catch (error) { return routeErrorResponse(error); }
}
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!/^[a-f0-9]{32}$/.test(id)) throw new RouteError(400, "Invalid image.");
    const image = readTerminalNoteImage(db, userId, id);
    if (!image) throw new RouteError(404, "Image not found.");
    return new Response(new Uint8Array(image.data), {headers: {"Content-Type": image.mime, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"}});
  } catch (error) { return routeErrorResponse(error); }
}
