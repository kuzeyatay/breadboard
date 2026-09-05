import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const PIXABAY_ENDPOINT = "https://pixabay.com/api/";
const SEARCH_CACHE_SECONDS = 24 * 60 * 60;
const IMAGE_CACHE_SECONDS = 30 * SEARCH_CACHE_SECONDS;

interface PixabayHit {
  id?: unknown;
  tags?: unknown;
  pageURL?: unknown;
  webformatURL?: unknown;
  largeImageURL?: unknown;
  user?: unknown;
}

interface PixabayResponse {
  totalHits?: unknown;
  hits?: unknown;
}

let fallbackApiKey: string | undefined;

function envValue(contents: string, name: string): string | undefined {
  const prefix = `${name}=`;
  const line = contents
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(prefix));
  if (!line) return undefined;
  const value = line.slice(prefix.length).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).trim() || undefined;
  }
  return value || undefined;
}

async function apiKey(): Promise<string> {
  const key = process.env.PIXABAY_API_KEY?.trim();
  if (key) return key;
  if (fallbackApiKey) return fallbackApiKey;

  // A long-running desktop dev server does not re-read .env.local when a key
  // is added. Resolve it server-side on demand so the wallpaper drawer repairs
  // itself without exposing the credential to the browser or requiring a full
  // Breadboard restart.
  const developmentDashboard = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR?.trim();
  const repositoryRoot = process.env.BREADBOARD_REPO_ROOT?.trim();
  const candidates = [
    ...(developmentDashboard ? [path.join(developmentDashboard, ".env.local")] : []),
    ...(repositoryRoot ? [path.join(repositoryRoot, "dashboard", ".env.local")] : []),
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), "dashboard", ".env.local"),
  ];
  for (const candidate of candidates) {
    try {
      const localKey = envValue(await readFile(candidate, "utf8"), "PIXABAY_API_KEY");
      if (localKey) {
        fallbackApiKey = localKey;
        return localKey;
      }
    } catch {
      // The next candidate may match the dashboard's launch directory.
    }
  }

  throw new Error("pixabay_not_configured");
}

function cleanImageId(value: string | null): string | null {
  return value && /^\d{1,12}$/u.test(value) ? value : null;
}

function cleanQuery(value: string | null): string {
  return (value?.trim() || "inspirational nature landscape wallpaper").slice(0, 100);
}

function displayName(tags: unknown): string {
  if (typeof tags !== "string") return "Pixabay photo";
  const name = tags.split(",").slice(0, 2).join(" · ").trim();
  return name || "Pixabay photo";
}

async function requestPixabay(parameters: URLSearchParams): Promise<PixabayResponse> {
  parameters.set("key", await apiKey());
  const response = await fetch(`${PIXABAY_ENDPOINT}?${parameters.toString()}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: SEARCH_CACHE_SECONDS },
  });
  if (!response.ok) throw new Error(`pixabay_upstream_${response.status}`);
  return await response.json() as PixabayResponse;
}

async function selectedImage(imageId: string): Promise<NextResponse> {
  const data = await requestPixabay(new URLSearchParams({ id: imageId }));
  const hit = Array.isArray(data.hits) ? data.hits[0] as PixabayHit | undefined : undefined;
  if (!hit || typeof hit.largeImageURL !== "string") {
    return NextResponse.json({ ok: false, error: "image_not_found" }, { status: 404 });
  }

  const image = await fetch(hit.largeImageURL, {
    headers: { Accept: "image/*" },
    next: { revalidate: IMAGE_CACHE_SECONDS },
  });
  const contentType = image.headers.get("content-type") ?? "";
  if (!image.ok || !contentType.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "image_unavailable" }, { status: 502 });
  }

  return new NextResponse(await image.arrayBuffer(), {
    headers: {
      "Cache-Control": `public, max-age=${IMAGE_CACHE_SECONDS}, immutable`,
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    const imageId = cleanImageId(parameters.get("id"));
    if (parameters.get("image") === "1") {
      if (!imageId) {
        return NextResponse.json({ ok: false, error: "invalid_image_id" }, { status: 400 });
      }
      return await selectedImage(imageId);
    }

    const page = Math.max(1, Math.min(25, Number.parseInt(parameters.get("page") ?? "1", 10) || 1));
    const data = await requestPixabay(new URLSearchParams({
      q: cleanQuery(parameters.get("q")),
      image_type: "photo",
      orientation: "horizontal",
      safesearch: "true",
      editors_choice: "true",
      order: "popular",
      min_width: "1280",
      min_height: "720",
      per_page: "24",
      page: String(page),
    }));
    const hits = Array.isArray(data.hits) ? data.hits as PixabayHit[] : [];
    const images = hits.flatMap((hit) => {
      if (
        typeof hit.id !== "number" ||
        typeof hit.webformatURL !== "string" ||
        typeof hit.pageURL !== "string"
      ) return [];
      return [{
        id: hit.id,
        name: displayName(hit.tags),
        creator: typeof hit.user === "string" ? hit.user : "Pixabay contributor",
        previewSrc: hit.webformatURL,
        pageUrl: hit.pageURL,
      }];
    });

    return NextResponse.json(
      { ok: true, total: typeof data.totalHits === "number" ? data.totalHits : images.length, images },
      { headers: { "Cache-Control": `public, max-age=${SEARCH_CACHE_SECONDS}` } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "pixabay_unavailable";
    const status = code === "pixabay_not_configured" ? 503 : 502;
    return NextResponse.json({ ok: false, error: code }, { status });
  }
}
