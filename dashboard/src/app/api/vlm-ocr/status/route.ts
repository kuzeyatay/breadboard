// Tells the upload UI whether "Parse using VLM" can be offered right now, and
// what to say when it cannot. Probe only — it never starts the model server, so
// opening the upload panel does not trigger a multi-gigabyte download.

import { NextResponse } from "next/server";

import { getVlmOcrConfig } from "@/lib/vlm-ocr/config";
import { vlmOcrStatus } from "@/lib/vlm-ocr/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { readSupervisedServiceSnapshot } from "@/lib/supervisor-control";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUserId();
    const config = getVlmOcrConfig();
    const status = await vlmOcrStatus(config);
    const service = status.managed
      ? await readSupervisedServiceSnapshot("vlm-ocr")
      : null;
    const runtimeCanColdStart =
      status.managed &&
      service !== null &&
      service.state !== "installation-unavailable";

    return NextResponse.json({
      enabled: status.enabled,
      // A stopped Runtime-owned service remains selectable. Only the real
      // ingestion job may acquire its lease and cold-start it.
      available: status.enabled && (status.ok || runtimeCanColdStart),
      running: status.ok,
      managed: status.managed,
      autoStart: status.autoStart && runtimeCanColdStart,
      serviceState: service?.state ?? (status.ok ? "ready" : null),
      baseUrl: status.baseUrl,
      source: status.source,
      models: status.models,
      detail: status.detail,
    });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
