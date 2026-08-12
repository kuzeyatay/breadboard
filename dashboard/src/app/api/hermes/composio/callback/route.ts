import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function page(title: string, message: string, success: boolean): Response {
  const color = success ? "#315c49" : "#9b4f4f";
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f0e7;color:#24342c;font:16px system-ui,sans-serif}
main{max-width:30rem;margin:2rem;padding:2rem;border:1px solid #b8cdbf;border-radius:18px;background:#faf8f2;box-shadow:8px 8px 18px #d8d2c7,-8px -8px 18px #fff}
h1{margin:0 0 .75rem;font-size:1.35rem;color:${color}}p{line-height:1.55}button{border:1px solid #b8cdbf;border-radius:12px;background:#faf8f2;padding:.7rem 1rem;color:#315c49;cursor:pointer}
</style></head><body><main><h1>${title}</h1><p>${message}</p><button onclick="window.close()">Close window</button></main>
<script>try{window.opener&&window.opener.postMessage({type:'breadboard:connections:changed'},window.location.origin)}catch{}</script>
</body></html>`;
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
  const success = url.searchParams.get("status") === "success";
  recordAuditEvent({
    eventType: success
      ? "connected_app.oauth_completed"
      : "connected_app.oauth_failed",
    payload: { broker: "composio" },
  });
  return success
    ? page(
        "App connected",
        "The connection is available to Breadboard agents through Composio. You can close this window.",
        true,
      )
    : page(
        "Connection not completed",
        "Composio did not finish this connection. Close this window and try again from Connections.",
        false,
      );
}
