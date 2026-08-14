/**
 * The HTTP shell the three transfer routes share.
 *
 * Both error types that reach these routes — `TransferError` from this module
 * and `RouteError` from `server-auth` — already carry the status they want, so
 * the responder reads it off either rather than knowing about both.
 */

import { TransferError } from "./format.ts";
import type { TransferDownload } from "./export.ts";

function statusOf(error: unknown): number {
  if (error instanceof TransferError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 600
    ? status
    : 500;
}

export function transferErrorResponse(error: unknown): Response {
  const status = statusOf(error);
  const message =
    status === 500 || !(error instanceof Error)
      ? "Something went wrong."
      : error.message;
  if (status === 500) console.error("[transfer]", error);
  return Response.json({ error: message }, { status });
}

export function transferDownloadResponse(download: TransferDownload): Response {
  return new Response(new Uint8Array(download.buffer), {
    headers: {
      "Content-Type": download.mimeType,
      "Content-Length": String(download.buffer.byteLength),
      "Content-Disposition": `attachment; filename="${download.filename.replace(/["\r\n]/g, "-")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Transfer-Summary": JSON.stringify(download.summary),
    },
  });
}
