import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { spotifyBrowserAccessToken } from "@/lib/spotify/service.ts";
import {
  issueSpotifyPlaybackEngineTicket,
  registerSpotifyPlaybackEngine,
  spotifyPlaybackEngineStatus,
  verifySpotifyEngineTicket,
} from "@/lib/spotify/playback-engine.ts";
import {
  releaseSpotifyPlaybackViewLease,
  renewSpotifyPlaybackViewLease,
} from "@/lib/spotify/view-lease.ts";
import { ApiError } from "@/lib/hermes/route-core.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
};

function exactBody(
  body: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(body).length === keys.length &&
    keys.every((key) => Object.hasOwn(body, key))
  );
}

function viewId(value: unknown): string {
  const parsed = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(parsed)) {
    throw new ApiError(
      400,
      "invalid_spotify_playback_view",
      "The Spotify player view is invalid.",
    );
  }
  return parsed;
}

export async function GET(request: Request) {
  try {
    requireEnabled();
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") ?? "status";
    if (mode !== "status") {
      throw new ApiError(
        400,
        "invalid_spotify_engine_mode",
        "The Spotify player request is invalid.",
      );
    }
    const userId = await requireUserId();
    return NextResponse.json(await spotifyPlaybackEngineStatus(userId), {
      headers: noStoreHeaders,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireEnabled();
    const body = await readJsonBody(request, 4 * 1024);
    if (exactBody(body, ["ticket", "operation"])) {
      if (body.operation !== "token" || typeof body.ticket !== "string") {
        throw new ApiError(
          400,
          "invalid_spotify_engine_request",
          "The Spotify player request is invalid.",
        );
      }
      const userId = verifySpotifyEngineTicket(body.ticket);
      return NextResponse.json(await spotifyBrowserAccessToken(userId), {
        headers: noStoreHeaders,
      });
    }
    if (exactBody(body, ["ticket", "deviceId"])) {
      registerSpotifyPlaybackEngine({
        ticket: typeof body.ticket === "string" ? body.ticket : "",
        deviceId: body.deviceId,
      });
      return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
    }
    if (!exactBody(body, ["viewId"])) {
      throw new ApiError(
        400,
        "invalid_spotify_engine_request",
        "The Spotify player request is invalid.",
      );
    }
    const userId = await requireUserId();
    await renewSpotifyPlaybackViewLease({
      userId,
      viewId: viewId(body.viewId),
      ticket: issueSpotifyPlaybackEngineTicket(userId),
    });
    return NextResponse.json(await spotifyPlaybackEngineStatus(userId), {
      headers: noStoreHeaders,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireEnabled();
    const userId = await requireUserId();
    const body = await readJsonBody(request, 4 * 1024);
    if (!exactBody(body, ["viewId"])) {
      throw new ApiError(
        400,
        "invalid_spotify_engine_request",
        "The Spotify player request is invalid.",
      );
    }
    await releaseSpotifyPlaybackViewLease({
      userId,
      viewId: viewId(body.viewId),
    });
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
