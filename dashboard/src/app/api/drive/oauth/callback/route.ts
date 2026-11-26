import { drive } from "@/lib/crumbs/service.ts";
import { DriveError } from "@/lib/drive/drive-client.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Where Google sends the system browser back after the consent page. That
 * browser has no Breadboard session; the one-time `state` from the start of
 * the flow names the account, and it is good for ten minutes and one use.
 */
export async function GET(request: Request) {
  let title = "Google Drive is connected";
  let detail = "You can close this tab and go back to Breadboard.";
  try {
    await drive.finish(new URL(request.url).searchParams);
  } catch (error) {
    title = "Google Drive was not connected";
    detail = error instanceof DriveError ? error.message : "Something went wrong. Go back to Breadboard and try again.";
  }
  const escape = (text: string) => text.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:Canvas;color:CanvasText}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;opacity:.75}</style>
</head><body><main><h1>${escape(title)}</h1><p>${escape(detail)}</p></main></body></html>`;
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
}
