import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GOOGLE_SUGGEST_ENDPOINT = "https://suggestqueries.google.com/complete/search";

function languageFor(request: Request): string {
  const candidate = request.headers.get("accept-language")?.split(",", 1)[0]?.trim() ?? "en";
  return /^[a-z]{2,3}(?:-[a-z]{2})?$/iu.test(candidate) ? candidate.slice(0, 12) : "en";
}

/** A narrow authenticated proxy for Google's public autocomplete predictions. */
export async function GET(request: Request) {
  try {
    await requireUserId();
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 200) ?? "";
    if (!query) return NextResponse.json({ suggestions: [] });

    const upstream = new URL(GOOGLE_SUGGEST_ENDPOINT);
    upstream.searchParams.set("client", "firefox");
    upstream.searchParams.set("hl", languageFor(request));
    upstream.searchParams.set("q", query);
    const response = await fetch(upstream, {
      headers: {
        accept: "application/json",
        "user-agent": "Breadboard Browser",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return NextResponse.json({ suggestions: [] });

    const payload = (await response.json()) as unknown;
    const candidates = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : [];
    const seen = new Set<string>();
    const suggestions = candidates
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().slice(0, 300))
      .filter((value) => Boolean(value) && !seen.has(value) && seen.add(value))
      .slice(0, 8);
    return NextResponse.json(
      { suggestions },
      { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=300" } },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json({ suggestions: [] });
    }
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return NextResponse.json({ suggestions: [] });
    }
    return routeErrorResponse(error);
  }
}
