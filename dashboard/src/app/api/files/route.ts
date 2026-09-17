import path from "node:path";
import db from "@/lib/db";
import { requireUserId } from "@/lib/server-auth";
import { dashboardDataDir } from "@/lib/runtime-paths.ts";
import { legacyImageBytes, ownedImageUpload } from "@/lib/hermes/legacy-image-link.ts";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import type { ImageMessage } from "@/lib/hermes/attachment-image.ts";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const candidate = new URL(request.url).searchParams.get("path") ?? "";
    const root = path.join(process.env.BREADBOARD_HERMES_HOME || path.join(dashboardDataDir(), "runtime", "hermes"), "images");
    const bytes = await legacyImageBytes(candidate, root);
    if (bytes) {
      // Bound each batch; the join proves ownership before any attachment is
      // compared. Return the retained upload, never the path supplied by a model.
      let beforeId = Number.MAX_SAFE_INTEGER;
      for (;;) {
        const rows = db.prepare(`SELECT m.id, m.metadata FROM conversation_messages m
          JOIN conversations c ON c.id=m.conversation_id
          WHERE c.user_id=? AND m.role='user' AND m.id<?
            AND m.metadata LIKE '%"image"%'
          ORDER BY m.id DESC LIMIT 20`).all(userId, beforeId) as ImageMessage[];
        if (!rows.length) break;
        const id = ownedImageUpload(bytes, rows);
        if (id) return Response.redirect(new URL(`/api/hermes/uploads/${id}/content`, request.url), 307);
        beforeId = rows[rows.length - 1].id;
        if (request.signal.aborted) break;
      }
    }
    throw new ApiError(404, "image_not_found", "This image link is unavailable. Open the image from its chat attachment.");
  } catch (error) { return apiErrorResponse(error); }
}
