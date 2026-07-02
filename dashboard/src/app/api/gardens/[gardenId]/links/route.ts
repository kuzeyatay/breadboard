import { NextResponse } from "next/server";
import {
  addGardenLink,
  deleteGardenLink,
  readGardenLinks,
} from "@/lib/garden-links";
import {
  requireOwnedClusterFromSlug,
  requireReadableClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

function contentPathOrResponse(): string | NextResponse {
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) {
    return NextResponse.json(
      { error: "QUARTZ_CONTENT_PATH not configured" },
      { status: 500 },
    );
  }
  return contentPath;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { cluster } = await requireReadableClusterFromSlug(gardenId);
    const contentPath = contentPathOrResponse();
    if (contentPath instanceof NextResponse) return contentPath;

    return NextResponse.json({
      links: readGardenLinks(contentPath, cluster.slug),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { cluster } = await requireOwnedClusterFromSlug(gardenId);
    const contentPath = contentPathOrResponse();
    if (contentPath instanceof NextResponse) return contentPath;

    const body = await request.json().catch(() => ({}));
    const link = addGardenLink(contentPath, cluster.slug, {
      title: body.title,
      url: body.url,
    });

    return NextResponse.json({
      success: true,
      link,
      links: readGardenLinks(contentPath, cluster.slug),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save link";
    if (
      message === "Link URL is required" ||
      message === "Enter a valid link URL" ||
      message === "Only HTTP and HTTPS links are supported"
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return routeErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { cluster } = await requireOwnedClusterFromSlug(gardenId);
    const contentPath = contentPathOrResponse();
    if (contentPath instanceof NextResponse) return contentPath;

    const body = await request.json().catch(() => ({}));
    const deleted = deleteGardenLink(contentPath, cluster.slug, body.id);

    return NextResponse.json({
      success: true,
      deleted,
      links: readGardenLinks(contentPath, cluster.slug),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete link";
    if (message === "Link id is required") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return routeErrorResponse(error);
  }
}
