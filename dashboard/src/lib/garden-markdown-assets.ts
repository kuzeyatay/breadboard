// Filesystem helpers shared by the routes that drop user-uploaded assets into a
// garden's `assets/` folder and hand the note editor a Markdown reference back
// (`/api/markdown-images`, `/api/markdown-videos`).
//
// Everything here is path handling around one rule: an asset may only ever be
// written inside the cluster directory the caller owns, and only next to a note
// that actually exists.

import fs from 'fs';
import path from 'path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Resolve `<contentPath>/<clusterSlug>` and refuse anything that escapes the
 * content root (`..`, absolute slugs, drive-relative paths on Windows).
 */
export function safeClusterDir(contentPath: string, clusterSlug: string): string | null {
  const root = path.resolve(/* turbopackIgnore: true */ contentPath);
  const clusterDir = path.resolve(/* turbopackIgnore: true */ root, clusterSlug.trim());
  if (!clusterDir.startsWith(root + path.sep)) return null;
  return clusterDir;
}

/** Decode a slug that may have been percent-encoded more than once. */
export function decodeSlug(value: string): string {
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

/** Turn a display name into a safe, lowercase asset file stem. */
export function slugifyAssetName(value: string, fallback = 'file'): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || fallback;
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

/**
 * Reduce whatever the garden frame sends (a Quartz slug, a `?note=` URL, a
 * path with the cluster prefix) down to the note's basename, or null when the
 * target is not an editable document (index pages).
 */
export function normalizeDocumentSlug(clusterSlug: string, slug: string): string | null {
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

/** First free `<baseName>.<ext>` (then `-2`, `-3`, …) inside `assetDir`. */
export function uniqueAssetPath(assetDir: string, baseName: string, ext: string): string {
  let candidate = path.join(/* turbopackIgnore: true */ assetDir, `${baseName}.${ext}`);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(/* turbopackIgnore: true */ assetDir, `${baseName}-${counter}.${ext}`);
    counter++;
  }
  return candidate;
}

export type AssetStreamResult =
  | { ok: true; bytes: number }
  | { ok: false; reason: 'too_large' | 'empty' };

/**
 * Stream a request body to `destination`, refusing to write more than
 * `maxBytes`.
 *
 * Streaming rather than buffering is the point: a request body big enough to
 * matter here (a video) must never be held in memory. The cap is enforced on
 * the bytes as they pass, not just on `content-length`, because that header is
 * the client's claim rather than a fact. Any outcome other than a complete,
 * non-empty write removes the partial file, so a failed upload can never leave
 * a truncated asset in the garden.
 *
 * Quartz's watcher waits for a file to stop growing before it picks it up, so
 * writing straight to the final name is safe.
 */
export async function writeAssetStream(
  body: ReadableStream<Uint8Array>,
  destination: string,
  maxBytes: number,
): Promise<AssetStreamResult> {
  let written = 0;
  let tooLarge = false;

  try {
    await pipeline(
      Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
      async function* enforceLimit(source) {
        for await (const chunk of source) {
          written += (chunk as Buffer).length;
          if (written > maxBytes) {
            tooLarge = true;
            throw new Error('asset exceeds the maximum size');
          }
          yield chunk;
        }
      },
      fs.createWriteStream(destination),
    );
  } catch (error) {
    fs.rmSync(destination, { force: true });
    if (tooLarge) return { ok: false, reason: 'too_large' };
    throw error;
  }

  if (written === 0) {
    fs.rmSync(destination, { force: true });
    return { ok: false, reason: 'empty' };
  }

  return { ok: true, bytes: written };
}
