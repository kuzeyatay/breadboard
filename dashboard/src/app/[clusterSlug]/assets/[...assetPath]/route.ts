import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { gardenSourcePdfViewerHref } from "@/lib/garden-source-navigation";
import {
  requireReadableClusterFromSlugOrPublic,
  routeErrorResponse,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IMAGE_TYPES = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"], [".avif", "image/avif"],
  [".svg", "image/svg+xml"],
]);

type Context = { params: Promise<{ clusterSlug: string; assetPath: string[] }> };

function safeSegment(segment: string): boolean {
  return !!segment && !segment.startsWith(".") && !/[\\/:\u0000-\u001f]/.test(segment);
}

function inside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return !!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

// Garden Markdown embeds use /<garden>/assets/... on both Quartz and the
// dashboard. Read the canonical assets here, so chat and previews do not depend
// on a publication build or the changing port of the desktop Quartz service.
async function imageResponse(request: Request, context: Context, head = false) {
  try {
    const { clusterSlug, assetPath } = await context.params;
    if (!safeSegment(clusterSlug) || !assetPath?.length || !assetPath.every(safeSegment)) return notFound();
    const url = new URL(request.url);
    const viewer = gardenSourcePdfViewerHref(url.pathname + url.search);
    if (viewer) {
      await requireReadableClusterFromSlugOrPublic(clusterSlug);
      // Old chat replies and copied links may still contain the asset URL.
      // Redirect the document to a page with navigation controls. Browsers
      // carry the original #page fragment across this redirect.
      return new Response(null, { status: 307, headers: {
        Location: new URL(viewer, url.origin).href,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      } });
    }
    const type = IMAGE_TYPES.get(path.extname(assetPath.at(-1)!).toLowerCase());
    if (!type) return notFound();

    await requireReadableClusterFromSlugOrPublic(clusterSlug);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) return new Response(null, { status: 503 });

    const root = await fs.promises.realpath(contentPath);
    const expectedGarden = path.join(root, clusterSlug);
    const garden = await fs.promises.realpath(expectedGarden);
    // A junction to another Garden must not inherit this Garden's permission.
    if (path.relative(expectedGarden, garden) !== "") return notFound();
    const assets = await fs.promises.realpath(path.join(garden, "assets"));
    if (!inside(garden, assets)) return notFound();
    const file = await fs.promises.realpath(path.join(assets, ...assetPath));
    if (!inside(assets, file)) return notFound();
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size === 0) return notFound();

    const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    const headers = new Headers({
      "Content-Type": type,
      "Cache-Control": "private, no-cache",
      "Vary": "Cookie",
      "ETag": etag,
      "X-Content-Type-Options": "nosniff",
      // SVGs can be viewed as images, but cannot execute when opened directly.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    if (request.headers.get("if-none-match")?.split(/\s*,\s*/).some(value => value === etag || value === "*")) {
      return new Response(null, { status: 304, headers });
    }
    headers.set("Content-Length", String(stat.size));
    if (head) return new Response(null, { headers });
    const bytes = await fs.promises.readFile(file);
    return new Response(new Uint8Array(bytes), { headers });
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(String((error as NodeJS.ErrnoException).code))) return notFound();
    return routeErrorResponse(error);
  }
}

export async function GET(request: Request, context: Context) {
  return imageResponse(request, context);
}

export async function HEAD(request: Request, context: Context) {
  return imageResponse(request, context, true);
}
