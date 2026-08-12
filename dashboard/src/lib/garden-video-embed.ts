// Video embeds inside garden Markdown.
//
// Two sources, one Markdown shape. An uploaded file lands in the garden's
// `assets/` folder and a YouTube link stays a link; both are written as plain
// image syntax — `![Title](target)` — so the note stays portable (Obsidian
// renders the same two cases) while Quartz's BreadboardVideos transformer turns
// them into the player widget.
//
// Pure module: no Node APIs, so the API route, the garden UI, and the tests all
// share the exact same validation.

/**
 * Container extensions a browser `<video>` element can actually play.
 *
 * `.ogv` but not `.ogg`: Ogg is a container for either, and Quartz already
 * reads `.ogg` as audio, so accepting it here would make the same file render
 * two different ways depending on how the note referenced it.
 */
export const MARKDOWN_VIDEO_EXTENSIONS = new Map<string, string>([
  ['mp4', 'video/mp4'],
  ['m4v', 'video/mp4'],
  ['webm', 'video/webm'],
  ['ogv', 'video/ogg'],
  ['mov', 'video/quicktime'],
]);

/** `accept` attribute for the note editor's video picker. */
export const MARKDOWN_VIDEO_ACCEPT_ATTR = [...MARKDOWN_VIDEO_EXTENSIONS.keys()]
  .map((ext) => `.${ext}`)
  .join(',');

/**
 * Upload ceiling. Garden assets are copied into the Quartz output on every
 * build and live in the user's content folder, so this is deliberately far
 * below what a media server would allow.
 */
export const MAX_MARKDOWN_VIDEO_BYTES = 256 * 1024 * 1024;

export interface ResolvedVideoUpload {
  /** Normalized extension, without the dot. */
  ext: string;
  /** Content type to store the file under, derived from the extension. */
  mimeType: string;
  /** Safe file stem for the asset on disk. */
  baseName: string;
  /** Human title used as the embed's caption. */
  title: string;
}

export interface VideoUploadRejection {
  error: string;
}

export function isResolvedVideoUpload(
  value: ResolvedVideoUpload | VideoUploadRejection,
): value is ResolvedVideoUpload {
  return !('error' in value);
}

function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : '';
}

function assetStem(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'video';
}

/**
 * Decide whether a file may be embedded, and under what name.
 *
 * The extension is authoritative: browsers report `video/quicktime` as an empty
 * string often enough that trusting the client's MIME type would reject valid
 * files. The declared type only has to not contradict the extension.
 */
export function resolveVideoUpload(
  fileName: unknown,
  declaredMimeType?: unknown,
  sizeBytes?: unknown,
): ResolvedVideoUpload | VideoUploadRejection {
  const name = typeof fileName === 'string' ? fileName.trim() : '';
  if (!name) return { error: 'A file name is required' };

  const ext = extensionOf(name);
  const mimeType = MARKDOWN_VIDEO_EXTENSIONS.get(ext);
  if (!mimeType) {
    return {
      error: `Unsupported video format. Use ${[...MARKDOWN_VIDEO_EXTENSIONS.keys()]
        .map((value) => `.${value}`)
        .join(' ')}`,
    };
  }

  const declared = typeof declaredMimeType === 'string' ? declaredMimeType.trim().toLowerCase() : '';
  if (declared && !declared.startsWith('video/') && declared !== 'application/octet-stream') {
    return { error: 'That file is not a video' };
  }

  if (typeof sizeBytes === 'number' && Number.isFinite(sizeBytes)) {
    if (sizeBytes <= 0) return { error: 'That video file is empty' };
    if (sizeBytes > MAX_MARKDOWN_VIDEO_BYTES) {
      return { error: `Videos must be ${formatMegabytes(MAX_MARKDOWN_VIDEO_BYTES)} or smaller` };
    }
  }

  const stem = name.slice(0, name.length - ext.length - 1);
  const readable = stem.replace(/[_-]+/g, ' ').trim();

  return {
    ext,
    mimeType,
    baseName: assetStem(stem),
    title: readable || 'Video',
  };
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Markdown alt text is delimited by brackets and cannot span lines, so a title
 * carrying either would silently break the embed.
 */
export function sanitizeEmbedTitle(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value
    .replace(/[[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

/** `![Title](target)` — the one shape both video sources are written as. */
export function videoEmbedMarkdown(target: string, title?: string): string {
  return `![${sanitizeEmbedTitle(title)}](${target})`;
}
