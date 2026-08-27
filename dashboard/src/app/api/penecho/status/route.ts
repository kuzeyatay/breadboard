// Cross-origin lifecycle bridge for whiteboard cards embedded in Quartz.
//
// GET is observational. POST renews a bounded server-side view hold and starts
// the Runtime V2 PenEcho service only for a real card. DELETE releases that
// hold on navigation. Native lease identifiers never leave the dashboard.

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import {
  embedOrigins,
  penechoCorsHeaders,
  penechoServiceStatus,
} from "@/lib/penecho/service";
import {
  releasePenechoViewLease,
  renewPenechoViewLease,
} from "@/lib/penecho/view-lease";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 256;
const VIEW_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class PenechoRouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function responseHeaders(origin: string | null): Record<string, string> {
  return {
    ...penechoCorsHeaders(origin),
    "Cache-Control": "no-store",
  };
}

function assertAllowedOrigin(origin: string | null): void {
  if (origin && !embedOrigins().includes(origin)) {
    throw new PenechoRouteError(
      403,
      "This page is not allowed to control the whiteboard server.",
    );
  }
}

async function readBoundedBody(request: Request): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number.parseInt(declared, 10);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new PenechoRouteError(
        400,
        "A valid whiteboard view request is required.",
      );
    }
    if (bytes > MAX_BODY_BYTES) {
      throw new PenechoRouteError(
        413,
        "The whiteboard view request is too large.",
      );
    }
  }

  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PenechoRouteError(
          413,
          "The whiteboard view request is too large.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PenechoRouteError(
      400,
      "A valid whiteboard view request is required.",
    );
  }
}

async function readViewId(
  request: Request,
  options: { allowLegacyEmptyObject: boolean },
): Promise<string> {
  const body = await readBoundedBody(request);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new PenechoRouteError(
      400,
      "A valid whiteboard view request is required.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PenechoRouteError(
      400,
      "A valid whiteboard view request is required.",
    );
  }

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  // Quartz pages built before the heartbeat cutover sent `{}`. Give those
  // pages one bounded compatibility hold; newly built pages always send and
  // subsequently release a UUID.
  if (options.allowLegacyEmptyObject && keys.length === 0) return randomUUID();
  if (
    keys.length !== 1 ||
    keys[0] !== "viewId" ||
    typeof record.viewId !== "string" ||
    !VIEW_ID_PATTERN.test(record.viewId)
  ) {
    throw new PenechoRouteError(
      400,
      "A valid whiteboard view identifier is required.",
    );
  }
  return record.viewId;
}

function routeStatus(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
    ? status
    : 503;
}

async function errorResponse(
  error: unknown,
  origin: string | null,
): Promise<NextResponse> {
  const snapshot = await penechoServiceStatus().catch(() => ({
    running: false,
    baseUrl: "",
    available: false,
  }));
  return NextResponse.json(
    {
      running: snapshot.running,
      baseUrl: snapshot.baseUrl,
      available: snapshot.available,
      error:
        error instanceof Error
          ? error.message
          : "The whiteboard server could not be controlled.",
    },
    { status: routeStatus(error), headers: responseHeaders(origin) },
  );
}

export function OPTIONS(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: responseHeaders(request.headers.get("origin")),
  });
}

export async function GET(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const status = await penechoServiceStatus();
  return NextResponse.json(status, { headers: responseHeaders(origin) });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  try {
    assertAllowedOrigin(origin);
    const viewId = await readViewId(request, { allowLegacyEmptyObject: true });
    const hold = await renewPenechoViewLease(origin ?? "local", viewId);
    return NextResponse.json(
      {
        running: true,
        baseUrl: hold.service.baseUrl,
        managed: hold.service.managed,
        viewId,
        expiresInMs: hold.expiresInMs,
      },
      { headers: responseHeaders(origin) },
    );
  } catch (error) {
    return errorResponse(error, origin);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  try {
    assertAllowedOrigin(origin);
    const viewId = await readViewId(request, { allowLegacyEmptyObject: false });
    await releasePenechoViewLease(origin ?? "local", viewId);
    return NextResponse.json(
      { released: true },
      { headers: responseHeaders(origin) },
    );
  } catch (error) {
    return errorResponse(error, origin);
  }
}
