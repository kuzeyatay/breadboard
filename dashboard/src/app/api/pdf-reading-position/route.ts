import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { requireSameOrigin } from "@/lib/request-origin";
import { pdfReadingPositionKey, validPdfPage } from "@/lib/pdf-reading-position";
import { ensurePdfReadingPositionSchema, readPdfReadingPosition, writePdfReadingPosition } from "@/lib/pdf-reading-position-store";

export const dynamic = "force-dynamic";
ensurePdfReadingPositionSchema(db);

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const source = pdfReadingPositionKey(new URL(request.url).searchParams.get("source"));
    if (!source) throw new RouteError(400, "Invalid PDF source");
    return NextResponse.json({ page: readPdfReadingPosition(db, userId, source) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    requireSameOrigin(request, "PDF reading positions must be saved from Breadboard");
    const userId = await requireUserId();
    const body = await request.json().catch(() => null);
    const source = pdfReadingPositionKey(body?.source);
    if (!source || !validPdfPage(body?.page) || !Number.isSafeInteger(body?.observedAt) || body.observedAt < 1) {
      throw new RouteError(400, "Invalid PDF reading position");
    }
    writePdfReadingPosition(db, userId, source, body.page, body.observedAt);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
