import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { isPageTranslationRequest, translatePageText } from "@/lib/browser-translation";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireUserId();
    // Only trusted browser chrome can ask the authenticated service to translate.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "Page text is required." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 100000) { await reader.cancel(); return NextResponse.json({ error: "Too much page text." }, { status: 413 }); }
      chunks.push(value);
    }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return NextResponse.json({ error: "Invalid page text." }, { status: 400 }); }
    if (!isPageTranslationRequest(input)) return NextResponse.json({ error: "Invalid page text or language." }, { status: 400 });
    try {
      return NextResponse.json({ segments: await translatePageText(input, request.signal, fetch, resolveChatmockBaseUrl(request).baseURL) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error && error.name !== "AbortError" && error.name !== "TimeoutError"
        ? error.message : "Translation timed out. Try again." }, { status: 502 });
    }
  } catch (error) { return routeErrorResponse(error); }
}
