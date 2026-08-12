// Shared route helpers for /api/deep-research/*. Translates typed errors into
// structured, secret-free JSON responses.

import { NextResponse } from "next/server";
import { RouteError } from "../server-auth.ts";
import { DeepResearchError } from "./service.ts";

export function deepResearchErrorResponse(error: unknown): NextResponse {
  if (error instanceof DeepResearchError) {
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
  if (text.length > 64 * 1024) throw new DeepResearchError(413, "payload_too_large");
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    throw new DeepResearchError(400, "invalid_json");
  }
}
