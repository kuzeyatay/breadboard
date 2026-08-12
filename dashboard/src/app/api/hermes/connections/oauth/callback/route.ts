import { completeEmbeddedOAuth } from "@/lib/connected-apps/broker.ts";
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
  const color = success ? "#315c49" : "#9b4f4f";
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f0e7;color:#24342c;font:16px system-ui,sans-serif}
main{max-width:30rem;margin:2rem;padding:2rem;border:1px solid #b8cdbf;border-radius:18px;background:#faf8f2;box-shadow:8px 8px 18px #d8d2c7,-8px -8px 18px #fff}
h1{margin:0 0 .75rem;font-size:1.35rem;color:${color}}p{line-height:1.55}button{border:1px solid #b8cdbf;border-radius:12px;background:#faf8f2;padding:.7rem 1rem;color:#315c49;cursor:pointer}
</style></head><body><main><h1>${safeTitle}</h1><p>${safeMessage}</p><button onclick="window.close()">Close window</button></main></body></html>`;
  return new Response(body, {
    status: success ? 200 : 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("error")) {
    return page(
      "Connection cancelled",
      "The provider did not authorize this connection. You can close this window and try again.",
      false,
    );
  }
  try {
    const result = await completeEmbeddedOAuth({
      state: url.searchParams.get("state") ?? "",
      code: url.searchParams.get("code") ?? "",
    });
    recordAuditEvent({
      eventType: "connected_app.oauth_completed",
      userId: result.userId,
      payload: { slug: result.slug },
    });
    return page(
      `${result.integrationName} connected`,
      "The app is available to Breadboard agents. You can close this window.",
      true,
    );
  } catch {
    return page(
      "Connection failed",
      "Breadboard could not finish this sign-in. Close this window and try again from Connections.",
      false,
    );
  }
}
