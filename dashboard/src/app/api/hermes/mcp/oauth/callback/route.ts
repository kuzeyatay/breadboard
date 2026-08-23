import { getAgentRuntime } from "@/lib/agent-runtime/runtime.ts";
import {
  completeEmbeddedOAuth,
  embeddedOAuthStateSlug,
} from "@/lib/connected-apps/broker.ts";
import {
  getMcpConnection,
  runtimeMcpConfig,
} from "@/lib/hermes/mcp-connections.ts";
import { completeMcpAuthentication } from "@/lib/hermes/mcp-oauth.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

function page(title: string, message: string, success: boolean): Response {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const color = success ? "#315c49" : "#9b4f4f";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f0e7;color:#24342c;font:16px system-ui,sans-serif}main{max-width:30rem;margin:2rem;padding:2rem;border:1px solid #b8cdbf;border-radius:18px;background:#faf8f2;box-shadow:8px 8px 18px #d8d2c7,-8px -8px 18px #fff}h1{margin:0 0 .75rem;font-size:1.35rem;color:${color}}p{line-height:1.55}button{border:1px solid #b8cdbf;border-radius:12px;background:#faf8f2;padding:.7rem 1rem;color:#315c49;cursor:pointer}</style></head><body><main><h1>${safeTitle}</h1><p>${safeMessage}</p><button onclick="window.close()">Close window</button></main></body></html>`,
    {
      status: success ? 200 : 400,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("error")) {
    return page(
      "Connection cancelled",
      "The service did not authorize Breadboard. Close this window and return to the connection you were setting up in Settings.",
      false,
    );
  }
  try {
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (embeddedOAuthStateSlug(state) === "spotify") {
      const result = await completeEmbeddedOAuth({ state, code });
      recordAuditEvent({
        eventType: "connected_app.oauth_completed",
        userId: result.userId,
        payload: { slug: result.slug, playback: "web-sdk" },
      });
      return page(
        "Spotify connected",
        "Spotify is ready to play inside Breadboard. You can close this window and return to chat.",
        true,
      );
    }
    const result = await completeMcpAuthentication({
      state,
      code,
    });
    const connection = getMcpConnection(result.userId, result.connectionId);
    if (connection?.enabled) {
      const agentRuntime = getAgentRuntime();
      await agentRuntime
        .addMcpConnection(
          agentRuntime.managementDirectory(result.userId),
          connection.slug,
          runtimeMcpConfig(connection),
          result.userId,
        )
        .catch(() => null);
    }
    recordAuditEvent({
      eventType: "mcp.auth.completed",
      userId: result.userId,
      payload: { connectionId: result.connectionId, slug: result.slug },
    });
    return page(
      `${result.displayName} connected`,
      "The service is ready for Breadboard. You can close this window and return to chat.",
      true,
    );
  } catch {
    return page(
      "Connection failed",
      "Breadboard could not finish this sign-in. Close this window and return to the connection you were setting up in Settings.",
      false,
    );
  }
}
