// Shared response shaping for the browser-facing Recall routes.

import { NextResponse } from "next/server";

import { sanitizeRecallError } from "./errors.ts";
import { RouteError, routeErrorResponse } from "@/lib/server-auth";

/**
 * Answer a failure. Recall's own errors carry a stable code and a message
 * written for a person; anything else falls back to the dashboard's generic
 * handler so an unexpected throw never leaks internals here either.
 */
export function recallErrorResponse(error: unknown): NextResponse {
  if (error instanceof RouteError) return routeErrorResponse(error);
  const { code, message, status } = sanitizeRecallError(error);
  return NextResponse.json({ error: message, code }, { status });
}

/** Parse a JSON body, treating an empty one as `{}`. */
export async function readRecallBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
