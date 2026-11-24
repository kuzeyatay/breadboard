import { crumbs } from "@/lib/crumbs/service.ts";
import { SQUIRCLE_DOCUMENT_CSS } from "@/lib/squircle-corner";

export const dynamic = "force-dynamic";
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);

/**
 * Where the account's own server sends the person back after they approve.
 * The single-use `state` value ties the reply to the Breadboard user who
 * started it, so this route needs no session cookie. That matters: sign-in
 * runs in a browser tab that does not share Breadboard's own session, so the
 * answer is a small standalone page and the Crumbs tab picks the account up.
 */
export async function GET(request: Request) {
  const result = await crumbs.finishSignIn(new URL(request.url).searchParams);
  const title = result.error ? "Could not sign in" : "Signed in to Crumbs";
  const detail = result.error ?? "You can close this tab.";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>${SQUIRCLE_DOCUMENT_CSS}html{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#e6f0e6;color:#13201b;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:380px;margin:24px;padding:32px;border:1px solid #bccfc2;border-radius:18px;background:#faf7ef;text-align:center;box-shadow:0 10px 30px #13201b14}
svg{color:${result.error ? "#a45c5c" : "#4f6f68"}}h1{margin:14px 0 6px;font-size:19px;letter-spacing:-.02em}p{margin:0;color:#50615a}
@media(prefers-color-scheme:dark){body{background:#141a17;color:#e8efe9}main{background:#1c2420;border-color:#33423a}p{color:#a5b5ac}}</style></head>
<body><main><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.6 10.3C4.4 9.7 3.6 8.7 3.6 7.5c0-2.2 2.6-3.7 6.4-3.7s6.4 1.5 6.4 3.7c0 1.2-.8 2.2-2 2.8v6.1c0 1-.8 1.8-1.8 1.8H7.4c-1 0-1.8-.8-1.8-1.8v-6.1Z"/><circle cx="18.6" cy="14.4" r="1.25" fill="currentColor" stroke="none"/><circle cx="20.4" cy="18.5" r=".95" fill="currentColor" stroke="none"/><circle cx="16.9" cy="19.7" r=".8" fill="currentColor" stroke="none"/></svg>
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></main></body></html>`, { status: result.error ? 400 : 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
