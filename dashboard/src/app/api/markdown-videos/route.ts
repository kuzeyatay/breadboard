import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireOwnedClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';
import { walkClusterMarkdown } from '@/lib/knowledge';
import {
  normalizeDocumentSlug,
  safeClusterDir,
  uniqueAssetPath,
  writeAssetStream,
} from '@/lib/garden-markdown-assets';
import {
  MAX_MARKDOWN_VIDEO_BYTES,
  formatMegabytes,
  isResolvedVideoUpload,
  resolveVideoUpload,
  sanitizeEmbedTitle,
  videoEmbedMarkdown,
} from '@/lib/garden-video-embed';
import { parseYouTubeUrl } from '@/lib/scriberr/youtube';

export const dynamic = 'force-dynamic';

/**
 * Add a video to a garden note.
 *
 * Uploads arrive as a raw body (`?clusterSlug=&noteSlug=&fileName=`) rather
 * than multipart so the bytes stream straight to disk — buffering a 200 MB
 * video into a FormData part would hold the whole file in memory. YouTube links
 * arrive as JSON and are only validated and canonicalized; nothing is
 * downloaded.
 *
 * Both return the Markdown snippet the note editor inserts.
 */
export async function POST(request: Request) {
  try {
    const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
    return contentType.includes('application/json')
      ? await addYouTubeEmbed(request)
      : await addUploadedVideo(request);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

interface EmbedTarget {
  clusterSlug: string;
  noteSlug: string;
  /** Absolute path of the cluster's content directory. */
  clusterDir: string;
}

/**
 * Authorize the cluster, confirm the note exists on disk, and hand back the
 * paths an embed needs. Shared by both sources so a YouTube link cannot be
 * inserted into a note the caller does not own either.
 */
async function resolveEmbedTarget(
  rawClusterSlug: unknown,
  rawNoteSlug: unknown,
): Promise<EmbedTarget | { response: NextResponse }> {
  const clusterSlug = typeof rawClusterSlug === 'string' ? rawClusterSlug.trim() : '';
  const noteSlug = typeof rawNoteSlug === 'string' ? rawNoteSlug.trim() : '';

  if (!clusterSlug) {
    return { response: NextResponse.json({ error: 'clusterSlug is required' }, { status: 400 }) };
  }
  if (!noteSlug) {
    return { response: NextResponse.json({ error: 'noteSlug is required' }, { status: 400 }) };
  }

  const { cluster } = await requireOwnedClusterFromSlug(clusterSlug);
  const normalizedNoteSlug = normalizeDocumentSlug(cluster.slug, noteSlug);
  if (!normalizedNoteSlug) {
    return {
      response: NextResponse.json({ error: 'Document path is not editable' }, { status: 400 }),
    };
  }

  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) {
    return {
      response: NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 }),
    };
  }

  const clusterDir = safeClusterDir(contentPath, cluster.slug);
  if (!clusterDir) {
    return { response: NextResponse.json({ error: 'Invalid garden path' }, { status: 400 }) };
  }

  // The note may live in any sub-folder; match on its basename.
  const noteEntry = walkClusterMarkdown(clusterDir).find(
    (item) => item.entry.replace(/\.md$/i, '') === normalizedNoteSlug,
  );
  if (!noteEntry) {
    return { response: NextResponse.json({ error: 'Markdown note not found' }, { status: 404 }) };
  }

  return { clusterSlug: cluster.slug, noteSlug: normalizedNoteSlug, clusterDir };
}

function isResolved(
  value: EmbedTarget | { response: NextResponse },
): value is EmbedTarget {
  return !('response' in value);
}

async function addUploadedVideo(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const target = await resolveEmbedTarget(
    url.searchParams.get('clusterSlug'),
    url.searchParams.get('noteSlug'),
  );
  if (!isResolved(target)) return target.response;

  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MARKDOWN_VIDEO_BYTES) {
    return NextResponse.json(
      { error: `Videos must be ${formatMegabytes(MAX_MARKDOWN_VIDEO_BYTES)} or smaller` },
      { status: 413 },
    );
  }

  const resolved = resolveVideoUpload(
    url.searchParams.get('fileName'),
    request.headers.get('content-type'),
    Number.isFinite(declaredLength) ? declaredLength : undefined,
  );
  if (!isResolvedVideoUpload(resolved)) {
    return NextResponse.json({ error: resolved.error }, { status: 415 });
  }

  if (!request.body) {
    return NextResponse.json({ error: 'No video data received' }, { status: 400 });
  }

  const assetDir = path.join(/* turbopackIgnore: true */ target.clusterDir, 'assets');
  fs.mkdirSync(assetDir, { recursive: true });
  const assetPath = uniqueAssetPath(assetDir, resolved.baseName, resolved.ext);

  const write = await writeAssetStream(request.body, assetPath, MAX_MARKDOWN_VIDEO_BYTES);
  if (!write.ok) {
    return write.reason === 'too_large'
      ? NextResponse.json(
          { error: `Videos must be ${formatMegabytes(MAX_MARKDOWN_VIDEO_BYTES)} or smaller` },
          { status: 413 },
        )
      : NextResponse.json({ error: 'That video file is empty' }, { status: 400 });
  }

  const assetFileName = path.basename(assetPath);
  const markdownPath = `/${target.clusterSlug}/assets/${assetFileName}`;

  return NextResponse.json({
    success: true,
    kind: 'upload',
    markdown: videoEmbedMarkdown(markdownPath, resolved.title),
    title: resolved.title,
    path: markdownPath,
    contentPath: `${target.clusterSlug}/assets/${assetFileName}`,
    fileName: assetFileName,
    bytes: write.bytes,
  });
}

async function addYouTubeEmbed(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const target = await resolveEmbedTarget(body.clusterSlug, body.noteSlug);
  if (!isResolved(target)) return target.response;

  let parsed: ReturnType<typeof parseYouTubeUrl>;
  try {
    parsed = parseYouTubeUrl(body.youtubeUrl ?? body.url);
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'userMessage' in error
        ? String((error as { userMessage: string }).userMessage)
        : 'That is not a valid YouTube video URL.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const title =
    sanitizeEmbedTitle(body.title) || (await fetchYouTubeTitle(parsed.canonicalUrl)) || 'YouTube video';

  return NextResponse.json({
    success: true,
    kind: 'youtube',
    markdown: videoEmbedMarkdown(parsed.canonicalUrl, title),
    title,
    videoId: parsed.videoId,
    path: parsed.canonicalUrl,
  });
}

/**
 * Best-effort title from YouTube's public oEmbed endpoint so the embed carries
 * the real video name. Never blocks the insert: any failure just falls back to
 * a generic caption.
 */
async function fetchYouTubeTitle(canonicalUrl: string): Promise<string> {
  try {
    const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl)}`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return '';
    const data = (await response.json()) as { title?: unknown };
    return sanitizeEmbedTitle(data.title);
  } catch {
    return '';
  }
}
