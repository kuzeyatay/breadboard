import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  humanizerDevice,
  humanizerMode,
  humanizerModel,
  humanizerRevision,
} from "@/lib/humanizer/config.ts";
import { humanizerHealth } from "@/lib/humanizer/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Whether "Rewrite naturally" can do anything on this machine.
 *
 * Passive: reading this never loads the model and never downloads anything. The
 * service answers from a torch import and a directory check, so a machine that
 * has never run `npm run setup:humanizer` answers as quickly as one that has —
 * it just answers `unavailable`, which is a supported state and not an error.
 *
 * Nothing here exposes the sidecar. The response carries a state, a model id, a
 * revision and a device; no URL, no port, no secret, no cache path.
 */
export async function GET() {
  try {
    await requireUserId();
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const mode = humanizerMode();
  const health = await humanizerHealth();

  // Four states, named the way the UI names them, so clients never have to
  // infer one from a combination of booleans.
  const state =
    mode === "disabled"
      ? "disabled"
      : health.status === "unreachable"
        ? "unavailable"
        : health.status === "degraded"
          ? "error"
          : health.modelState === "not_installed"
            ? "not_installed"
            : "ready";

  return NextResponse.json(
    {
      state,
      mode,
      // What the dashboard expects to be running, next to what answered. A
      // mismatch means the reviewed preservation behaviour and the running
      // model are two different things.
      expectedModel: humanizerModel(),
      expectedRevision: humanizerRevision(),
      requestedDevice: humanizerDevice(),
      model: {
        id: health.modelId,
        revision: health.modelRevision,
        installed: health.modelInstalled,
        loaded: health.modelLoaded,
        state: health.modelState,
      },
      runtime: {
        device: health.device,
        dtype: health.dtype,
        busy: health.busy,
      },
      summary:
        state === "ready"
          ? `Rewriting locally with ${health.modelId} on ${health.device}.`
          : state === "not_installed"
            ? "The rewriting model has not been downloaded on this machine yet."
            : state === "disabled"
              ? "Local rewriting is turned off."
              : state === "error"
                ? `The local rewriter is installed but not usable: ${health.detail || "unknown reason"}.`
                : "The local rewriter is not running.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
