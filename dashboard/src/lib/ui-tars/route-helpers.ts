// Shared route helpers for /api/ui-tars/*. Translates typed errors into
// structured, secret-free JSON responses and gates on runtime mode.

import { NextResponse } from "next/server";
import { RouteError } from "../server-auth.ts";
import { UITarsServiceError } from "./service.ts";

export function uiTarsErrorResponse(error: unknown): NextResponse {
  if (error instanceof UITarsServiceError) {
    return NextResponse.json({ ok: false, error: error.code }, { status: error.status });
  }
  if (error instanceof RouteError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  // Never leak an internal message/stack to the browser.
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

/** Read + size-guard a JSON body. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 64 * 1024) throw new UITarsServiceError(413, "payload_too_large");
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    throw new UITarsServiceError(400, "invalid_json");
  }
}
