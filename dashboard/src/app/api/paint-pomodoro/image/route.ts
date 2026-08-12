import { PUBLIC_DOMAIN_ARTWORKS } from "@/lib/paint-pomodoro";

export const dynamic = "force-dynamic";

// Same-origin proxy for artwork images so the reveal canvas can sample pixels
// without cross-origin taint. Locked to the exact image URLs in our catalog to
// avoid being turned into an open proxy.
const ALLOWED_URLS = new Set(PUBLIC_DOMAIN_ARTWORKS.map((art) => art.imageUrl));

export async function GET(request: Request) {
  const src = new URL(request.url).searchParams.get("src");
  if (!src || !ALLOWED_URLS.has(src)) {
    return new Response("Bad image request", { status: 400 });
  }
  try {
    const upstream = await fetch(src, { headers: { "User-Agent": "breadboard-paint-pomodoro" } });
    if (!upstream.ok) return new Response("Upstream error", { status: 502 });
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return new Response("Fetch failed", { status: 502 });
  }
}
