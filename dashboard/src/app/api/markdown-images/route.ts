import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireOwnedClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
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

function safeClusterDir(contentPath: string, clusterSlug: string): string | null {
  const root = path.resolve(/* turbopackIgnore: true */ contentPath);
  const clusterDir = path.resolve(/* turbopackIgnore: true */ root, clusterSlug.trim());
  if (!clusterDir.startsWith(root + path.sep)) return null;
  return clusterDir;
}

function decodeSlug(value: string): string {
  let current = value;
  for (let index = 0; index < 4; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return current;
      current = decoded;
    } catch {
      return current;
    }
  }
  return current;
}

function slugifyAssetName(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'image';
}

function candidateSlugInputs(slug: string): string[] {
  const decoded = decodeSlug(slug);
  const candidates = [decoded];

  try {
    const url = new URL(decoded, 'http://second-brain.local');
    const note = url.searchParams.get('note');
    if (note) candidates.unshift(decodeSlug(note));
    candidates.push(url.pathname);
  } catch {
    // Plain slugs are handled by the decoded candidate.
  }

  return [...new Set(candidates)];
}

function normalizeDocumentSlug(clusterSlug: string, slug: string): string | null {
  const cluster = clusterSlug.trim();

  for (const candidate of candidateSlugInputs(slug)) {
    const cleaned = candidate
      .replace(/\\/g, '/')
      .replace(/[?#].*$/, '')
      .replace(/\.md$/i, '')
      .trim();
    let segments = cleaned.split('/').map((segment) => segment.trim()).filter(Boolean);
    const clusterIndex = segments.findIndex((segment) => segment === cluster);
    if (clusterIndex >= 0) segments = segments.slice(clusterIndex + 1);
    if (segments[0] === 'garden' && segments[1] === cluster) segments = segments.slice(2);
    if (segments.length === 0) continue;

    const noteSlug = segments.at(-1);
    if (!noteSlug) continue;
    if (noteSlug.toLowerCase() === 'index' || noteSlug.toLowerCase() === '_index') return null;
    return noteSlug;
  }

  return null;
}

function uniqueAssetPath(assetDir: string, baseName: string, ext: string): string {
  let candidate = path.join(/* turbopackIgnore: true */ assetDir, `${baseName}.${ext}`);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(/* turbopackIgnore: true */ assetDir, `${baseName}-${counter}.${ext}`);
    counter++;
  }
  return candidate;
}

function prepareImage(raw: RawImage): { image?: PreparedImage; error?: string } {
  const fileName = typeof raw.fileName === 'string' ? raw.fileName.trim() : '';
  const mimeType = typeof raw.mimeType === 'string' ? raw.mimeType.trim().toLowerCase() : '';
  const dataUrl = typeof raw.dataUrl === 'string' ? raw.dataUrl : '';

  if (!fileName || !dataUrl) {
    return { error: 'fileName and dataUrl are required for each image' };
  }

  const ext = ALLOWED_MIME_TYPES.get(mimeType);
  if (!ext) {
    return { error: 'Only JPEG, PNG, WEBP, and GIF images are supported' };
  }

  const match = dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1].toLowerCase() !== mimeType) {
    return { error: 'Invalid image data' };
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) {
    return { error: 'Image file is empty' };
  }
  if (buffer.length > 10 * 1024 * 1024) {
    return { error: 'Each image must be 10 MB or smaller' };
  }

  const originalName = path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, ' ').trim();
  const altText = originalName || 'image';
  const baseName = slugifyAssetName(originalName || 'image');

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
    const clusterSlug = typeof body.clusterSlug === 'string' ? body.clusterSlug.trim() : '';
    const noteSlug = typeof body.noteSlug === 'string' ? body.noteSlug.trim() : '';
    const rawImages: RawImage[] = Array.isArray(body.images)
      ? body.images
      : [{ fileName: body.fileName, mimeType: body.mimeType, dataUrl: body.dataUrl }];

    if (!clusterSlug) {
      return NextResponse.json({ error: 'clusterSlug is required' }, { status: 400 });
    }
    if (!noteSlug) {
      return NextResponse.json({ error: 'noteSlug is required' }, { status: 400 });
    }

    const { cluster } = await requireOwnedClusterFromSlug(clusterSlug);
    const normalizedNoteSlug = normalizeDocumentSlug(cluster.slug, noteSlug);
    if (!normalizedNoteSlug) {
      return NextResponse.json({ error: 'Document path is not editable' }, { status: 400 });
    }
    if (rawImages.length === 0) {
      return NextResponse.json({ error: 'At least one image is required' }, { status: 400 });
    }
    if (rawImages.length > 20) {
      return NextResponse.json({ error: 'Add 20 images or fewer at a time' }, { status: 400 });
    }

    const preparedImages: PreparedImage[] = [];
    for (const rawImage of rawImages) {
      const prepared = prepareImage(rawImage);
      if (prepared.error || !prepared.image) {
        return NextResponse.json({ error: prepared.error || 'Invalid image' }, { status: 400 });
      }
      preparedImages.push(prepared.image);
    }

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    const clusterDir = safeClusterDir(contentPath, cluster.slug);
    if (!clusterDir) {
      return NextResponse.json({ error: 'Invalid cluster path' }, { status: 400 });
    }

    const notePath = path.resolve(/* turbopackIgnore: true */ clusterDir, `${normalizedNoteSlug}.md`);
    if (!notePath.startsWith(clusterDir + path.sep) || !fs.existsSync(notePath)) {
      return NextResponse.json({ error: 'Markdown note not found' }, { status: 404 });
    }

    const assetDir = path.join(/* turbopackIgnore: true */ clusterDir, 'assets');
    fs.mkdirSync(assetDir, { recursive: true });

    const files = preparedImages.map((image) => {
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

    return NextResponse.json({
      success: true,
      markdown: files.map((file) => `![${file.altText}](${file.path})`).join('\n\n'),
      count: files.length,
      files,
      path: files[0]?.path,
      fileName: files[0]?.fileName,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
