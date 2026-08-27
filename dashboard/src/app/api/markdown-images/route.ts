import { NextResponse } from "next/server";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";
import { walkClusterMarkdown } from "@/lib/knowledge";
import {
  normalizeDocumentSlug,
  safeClusterDir,
  slugifyAssetName,
  uniqueAssetPath,
} from "@/lib/garden-markdown-assets";
import { acquireGardenMutationLease } from "@/lib/garden-mutation-lease";

export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

interface RawImage {
  fileName?: unknown;
  mimeType?: unknown;
  dataUrl?: unknown;
}

interface PreparedImage {
  fileName: string;
  mimeType: string;
  ext: string;
  buffer: Buffer;
  baseName: string;
  altText: string;
}

function prepareImage(raw: RawImage): {
  image?: PreparedImage;
  error?: string;
} {
  const fileName = typeof raw.fileName === "string" ? raw.fileName.trim() : "";
  const mimeType =
    typeof raw.mimeType === "string" ? raw.mimeType.trim().toLowerCase() : "";
  const dataUrl = typeof raw.dataUrl === "string" ? raw.dataUrl : "";

  if (!fileName || !dataUrl) {
    return { error: "fileName and dataUrl are required for each image" };
  }

  const ext = ALLOWED_MIME_TYPES.get(mimeType);
  if (!ext) {
    return { error: "Only JPEG, PNG, WEBP, and GIF images are supported" };
  }

  const match = dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1].toLowerCase() !== mimeType) {
    return { error: "Invalid image data" };
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0) {
    return { error: "Image file is empty" };
  }
  if (buffer.length > 10 * 1024 * 1024) {
    return { error: "Each image must be 10 MB or smaller" };
  }

  const originalName = path
    .basename(fileName, path.extname(fileName))
    .replace(/[_-]+/g, " ")
    .trim();
  const altText = originalName || "image";
  const baseName = slugifyAssetName(originalName || "image", "image");

  return {
    image: {
      fileName,
      mimeType,
      ext,
      buffer,
      baseName,
      altText,
    },
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clusterSlug =
      typeof body.clusterSlug === "string" ? body.clusterSlug.trim() : "";
    const noteSlug =
      typeof body.noteSlug === "string" ? body.noteSlug.trim() : "";
    const rawImages: RawImage[] = Array.isArray(body.images)
      ? body.images
      : [
          {
            fileName: body.fileName,
            mimeType: body.mimeType,
            dataUrl: body.dataUrl,
          },
        ];

    if (!clusterSlug) {
      return NextResponse.json(
        { error: "clusterSlug is required" },
        { status: 400 },
      );
    }
    if (!noteSlug) {
      return NextResponse.json(
        { error: "noteSlug is required" },
        { status: 400 },
      );
    }

    const { cluster } = await requireOwnedClusterFromSlug(clusterSlug);
    const normalizedNoteSlug = normalizeDocumentSlug(cluster.slug, noteSlug);
    if (!normalizedNoteSlug) {
      return NextResponse.json(
        { error: "Document path is not editable" },
        { status: 400 },
      );
    }
    if (rawImages.length === 0) {
      return NextResponse.json(
        { error: "At least one image is required" },
        { status: 400 },
      );
    }
    if (rawImages.length > 20) {
      return NextResponse.json(
        { error: "Add 20 images or fewer at a time" },
        { status: 400 },
      );
    }

    const preparedImages: PreparedImage[] = [];
    for (const rawImage of rawImages) {
      const prepared = prepareImage(rawImage);
      if (prepared.error || !prepared.image) {
        return NextResponse.json(
          { error: prepared.error || "Invalid image" },
          { status: 400 },
        );
      }
      preparedImages.push(prepared.image);
    }

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json(
        { error: "QUARTZ_CONTENT_PATH not configured" },
        { status: 500 },
      );
    }

    const clusterDir = safeClusterDir(contentPath, cluster.slug);
    if (!clusterDir) {
      return NextResponse.json(
        { error: "Invalid garden path" },
        { status: 400 },
      );
    }

    const lease = acquireGardenMutationLease(
      clusterDir,
      "upload-markdown-images",
    );
    let files: Array<{
      altText: string;
      path: string;
      contentPath: string;
      fileName: string;
    }>;
    try {
      // Recheck under the mutation lease; the note may live in any sub-folder.
      const noteEntry = walkClusterMarkdown(clusterDir).find(
        (item) => item.entry.replace(/\.md$/i, "") === normalizedNoteSlug,
      );
      if (!noteEntry) {
        return NextResponse.json(
          { error: "Markdown note not found" },
          { status: 404 },
        );
      }

      const assetDir = path.join(
        /* turbopackIgnore: true */ clusterDir,
        "assets",
      );
      fs.mkdirSync(assetDir, { recursive: true });

      files = preparedImages.map((image) => {
        const assetPath = uniqueAssetPath(assetDir, image.baseName, image.ext);
        fs.writeFileSync(assetPath, image.buffer);

        const assetFileName = path.basename(assetPath);
        const markdownPath = `/${cluster.slug}/assets/${assetFileName}`;

        return {
          altText: image.altText,
          path: markdownPath,
          contentPath: `${cluster.slug}/assets/${assetFileName}`,
          fileName: assetFileName,
        };
      });
    } finally {
      lease.release();
    }

    return NextResponse.json({
      success: true,
      markdown: files
        .map((file) => `![${file.altText}](${file.path})`)
        .join("\n\n"),
      count: files.length,
      files,
      path: files[0]?.path,
      fileName: files[0]?.fileName,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
