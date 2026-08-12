// Next-aware route helpers for /api/hermes/* and /api/quartz-ai/*.
//
// The framework-free policy (size limits, structured errors, secret-free error
// translation) lives in ./route-core so it can be unit-tested without
// next/server. This module adds the thin NextResponse wrapper.

import { NextResponse } from "next/server";
import { describeError } from "./route-core.ts";

export {
  ApiError,
  MAX_REQUEST_BYTES,
  requireEnabled,
  readJsonBody,
  requireString,
  describeError,
} from "./route-core.ts";

/** Translate any thrown error into a structured, secret-free JSON response. */
export function apiErrorResponse(error: unknown): NextResponse {
  const { status, body } = describeError(error);
  return NextResponse.json(body, { status });
}
