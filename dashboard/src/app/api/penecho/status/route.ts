// Where a whiteboard card asks for its canvas.
//
// GET reports whether the PenEcho server is answering; POST starts it if it is
// not. Both are called from garden pages, which are a different origin, so the
// route carries its own CORS allowlist.
//
// POST is deliberately not session-gated. A garden page cannot send the
// dashboard's cookies cross-site, and what the call can do is start a loopback
// drawing server that only processes already running as this user can reach —
// so the origin allowlist is the control, and a session check here would only
// break the card without withholding anything.

import { NextResponse } from "next/server";
import {
  ensurePenechoService,
  embedOrigins,
  penechoCorsHeaders,
  penechoServiceStatus,
} from "@/lib/penecho/service";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: penechoCorsHeaders(request.headers.get("origin")),
  });
}

export async function GET(request: Request): Promise<Response> {
  const headers = penechoCorsHeaders(request.headers.get("origin"));
  const status = await penechoServiceStatus();
  return NextResponse.json(status, { headers });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const headers = penechoCorsHeaders(origin);
  if (origin && !embedOrigins().includes(origin)) {
    return NextResponse.json(
      { running: false, error: "This page is not allowed to start the whiteboard server." },
      { status: 403, headers },
    );
  }

  try {
    const service = await ensurePenechoService();
    return NextResponse.json(
      { running: true, baseUrl: service.baseUrl, managed: service.managed },
      { headers },
    );
  } catch (error) {
    const status = await penechoServiceStatus();
    return NextResponse.json(
      {
        running: false,
        baseUrl: status.baseUrl,
        available: status.available,
        error: error instanceof Error ? error.message : "The whiteboard server could not be started.",
      },
      { status: 503, headers },
    );
  }
}
