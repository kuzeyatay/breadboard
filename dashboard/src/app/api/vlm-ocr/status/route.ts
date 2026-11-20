// Tells the upload UI whether "Parse using VLM" can be offered right now, and
// what to say when it cannot. Probe only — it never starts the model server, so
// opening the upload panel does not trigger a multi-gigabyte download.

import { NextResponse } from "next/server";

import { getVlmOcrConfig } from "@/lib/vlm-ocr/config";
import { vlmOcrStatus } from "@/lib/vlm-ocr/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { readSupervisedServiceSnapshot } from "@/lib/supervisor-control";
import { optionalComponentInstalled } from "@/lib/runtime-v2/optional-components";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUserId();
    const config = getVlmOcrConfig();
    const status = await vlmOcrStatus(config);
    const service = status.managed
      ? await readSupervisedServiceSnapshot("vlm-ocr")
      : null;
    // The Runtime never reports installation-unavailable for missing weights
    // (the start just fails), so check the managed install itself. A dev setup
    // that points at its own model or Hugging Face repo needs no install.
    const weightsMissing =
      status.managed &&
      !status.ok &&
      !process.env.VLM_OCR_MODEL_PATH &&
      !process.env.VLM_OCR_HF_REPO &&
      !optionalComponentInstalled("vlm-ocr");
    const runtimeCanColdStart =
      status.managed &&
      service !== null &&
      !weightsMissing &&
      service.state !== "installation-unavailable";

    return NextResponse.json({
      enabled: status.enabled,
      // A stopped Runtime-owned service remains selectable. Only the real
      // ingestion job may acquire its lease and cold-start it.
      available: status.enabled && (status.ok || runtimeCanColdStart),
      running: status.ok,
      managed: status.managed,
      autoStart: status.autoStart && runtimeCanColdStart,
      serviceState: weightsMissing ? "installation-unavailable" : service?.state ?? (status.ok ? "ready" : null),
      baseUrl: status.baseUrl,
      source: status.source,
      models: status.models,
      detail: status.detail,
    });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
