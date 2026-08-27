import { NextResponse } from "next/server";

import { getRecallConfig } from "@/lib/recall/config.ts";
import {
  installState,
  readInstallStatus,
  startInstall,
} from "@/lib/recall/install.ts";
import { recallErrorResponse } from "@/lib/recall/route-helpers.ts";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Begin installing the capture engine. Returns as soon as Runtime V2 durably
 * accepts the disposable job: the download is minutes long, so progress is the
 * heartbeat file the status route reports, not a held-open request.
 */
export async function POST() {
  try {
    const userId = await requireUserId();
    const config = getRecallConfig();
    await startInstall(userId, config);
    return NextResponse.json({
      started: true,
      install: installState(config),
      installStatus: readInstallStatus(config),
    });
  } catch (error) {
    return recallErrorResponse(error);
  }
}
