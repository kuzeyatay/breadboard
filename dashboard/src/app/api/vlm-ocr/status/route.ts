// Tells the upload UI whether "Parse using VLM" can be offered right now, and
// what to say when it cannot. Probe only — it never starts the model server, so
// opening the upload panel does not trigger a multi-gigabyte download.

import { NextResponse } from "next/server";

import { getVlmOcrConfig } from "@/lib/vlm-ocr/config";
import { vlmOcrStatus } from "@/lib/vlm-ocr/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUserId();
    const config = getVlmOcrConfig();
    const status = await vlmOcrStatus(config);

    return NextResponse.json({
      enabled: status.enabled,
      // The option stays selectable when auto-start is on: the server is
      // started on demand by the first upload that needs it.
      available: status.enabled && (status.ok || status.autoStart),
      running: status.ok,
      managed: status.managed,
      autoStart: status.autoStart,
      baseUrl: status.baseUrl,
      source: status.source,
      models: status.models,
      detail: status.detail,
    });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
