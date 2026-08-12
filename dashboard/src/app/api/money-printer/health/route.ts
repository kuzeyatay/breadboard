import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  availableFootageSources,
  credentialStatus,
  FOOTAGE_CREDENTIALS,
} from "@/lib/money-printer/credentials.ts";
import { configuredFootageSources } from "@/lib/money-printer/config-file.ts";
import { health, resolveMoneyPrinterRoot } from "@/lib/money-printer/runtime.ts";
import { SETUP_ACTIONS } from "@/lib/money-printer/setup.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUserId();
    // The probe really starts a Python interpreter, so the default read uses the
    // cached report; `?refresh=1` is the deliberate slow path taken after a
    // setup step.
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const root = resolveMoneyPrinterRoot()?.root ?? null;
    // A key the user put in the clone's own config.toml counts, so nobody is
    // asked to enter the same Pexels key in two places.
    const inClone = root ? configuredFootageSources(root) : [];
    const snapshot = await health({
      force: refresh,
      availableSources: () => [...new Set([...availableFootageSources(), ...inClone])],
    });
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
          : inClone.includes(credential.key)
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
