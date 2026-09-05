import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getAgentRuntime } from "@/lib/agent-runtime/runtime.ts";
import { beginEmbeddedOAuth } from "@/lib/connected-apps/broker.ts";
import {
  deleteMcpConnection,
  getMcpConnectionBySlug,
} from "@/lib/hermes/mcp-connections.ts";
import {
  ApiError,
  apiErrorResponse,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";
import { removeNangoConnection } from "@/lib/nango/service.ts";
import {
  SPOTIFY_CONNECTION_SLUG,
  spotifyConnectionStatus,
} from "@/lib/spotify/service.ts";
import {
  SPOTIFY_OAUTH_CALLBACK_PATH,
  spotifyOAuthCallbackOrigin,
} from "@/lib/spotify/config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    requireEnabled();
    return NextResponse.json(spotifyConnectionStatus(userId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    // Remove the retired hosted-MCP connection. It cannot provide the
    // `streaming` grant required by Spotify's in-browser playback SDK and was
    // the source of the misleading "not connected" response.
    const legacy = getMcpConnectionBySlug(userId, SPOTIFY_CONNECTION_SLUG);
    if (legacy) {
      deleteMcpConnection(userId, legacy.id);
      const agentRuntime = getAgentRuntime();
      await agentRuntime
        .setMcpConnectionConnected(
          agentRuntime.managementDirectory(userId),
          legacy.slug,
          false,
          userId,
        )
        .catch(() => false);
    }
    const requestOrigin = new URL(request.url).origin;
    const callbackOrigin = spotifyOAuthCallbackOrigin(requestOrigin);
    const { authorizationUrl } = beginEmbeddedOAuth({
      userId,
      integrationValue: SPOTIFY_CONNECTION_SLUG,
      requestOrigin,
      // The desktop dashboard can move off port 3000 when that port is busy.
      // Spotify permits dynamic ports for an allowlisted loopback IP callback,
      // so always return to the live dashboard that started this request.
      callbackPath: SPOTIFY_OAUTH_CALLBACK_PATH,
      callbackOrigin,
    });
    recordAuditEvent({
      eventType: "connected_app.oauth_started",
      userId,
      payload: { provider: "spotify", playback: "web-sdk" },
    });
    return NextResponse.json({ authorizationUrl });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const removedNative = await removeNangoConnection(
      userId,
      SPOTIFY_CONNECTION_SLUG,
    );
    const legacy = getMcpConnectionBySlug(userId, SPOTIFY_CONNECTION_SLUG);
    const connection = legacy ? deleteMcpConnection(userId, legacy.id) : null;
    if (!removedNative && !connection) {
      throw new ApiError(
        404,
        "spotify_not_connected",
        "Spotify is not connected.",
      );
    }
    if (connection) {
      const agentRuntime = getAgentRuntime();
      await agentRuntime
        .setMcpConnectionConnected(
          agentRuntime.managementDirectory(userId),
          connection.slug,
          false,
          userId,
        )
        .catch(() => false);
    }
    recordAuditEvent({
      eventType: "connected_app.removed",
      userId,
      payload: {
        provider: "spotify",
        nativeConnectionRemoved: removedNative > 0,
        legacyConnectionId: connection?.id ?? null,
        externalDataDeleted: false,
      },
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
