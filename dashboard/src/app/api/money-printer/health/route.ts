import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  credentialStatus,
  FOOTAGE_CREDENTIALS,
} from "@/lib/money-printer/credentials.ts";
import { SETUP_ACTIONS } from "@/lib/money-printer/setup-contract.ts";
import { readMoneyPrinterRuntimeStatus } from "@/lib/money-printer/runtime-service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const { availability: snapshot } = await readMoneyPrinterRuntimeStatus({ userId }, refresh);
    const stored = credentialStatus();
    return NextResponse.json({
      ok: true,
      available: snapshot.available,
      cloned: snapshot.cloned,
      root: snapshot.root,
      environmentReady: snapshot.environmentReady,
      packageInstalled: snapshot.packageInstalled,
      systemPython: snapshot.systemPython,
      uvAvailable: snapshot.uvAvailable,
      ffmpegPath: snapshot.ffmpegPath,
      version: snapshot.version,
      serviceRunning: snapshot.serviceRunning,
      footageSources: snapshot.footageSources,
      reason: snapshot.reason,
      setupActions: SETUP_ACTIONS,
      credentials: FOOTAGE_CREDENTIALS.map((credential) => ({
        key: credential.key,
        label: credential.label,
        unlocks: credential.unlocks,
        link: credential.link,
        ...stored[credential.key],
        // A key living in the clone's own config is set, but not something this
        // panel can clear — saying where it came from keeps that honest.
        ...(stored[credential.key].set
          ? {}
          : snapshot.footageSources.includes(credential.key)
            ? { set: true, source: "clone" as const }
            : {}),
      })),
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
