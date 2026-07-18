// Dedup lookup for video transcript sources. Mirrors url-source-store.ts:
// scans the garden's sources/ frontmatter for a matching YouTube video ID,
// uploaded-media hash, or generated-content hash.

import fs from "fs";
import path from "path";

import type { ExistingVideoSource } from "./types";

const SOURCE_NOTE_FOLDER = "sources";

function clusterDir(contentPath: string, clusterSlug: string): string {
  const root = path.resolve(contentPath);
  const dir = path.resolve(root, clusterSlug.trim());
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error("Invalid garden path");
  }
  return dir;
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end === -1) return {};
  const data: Record<string, string> = {};
  for (const line of content.slice(3, end).trim().split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    if (!key) continue;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "string") data[key] = parsed;
    } catch {
      data[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
  return data;
}

function normalizedContentHash(value: string | undefined): string {
  return (value ?? "").replace(/^sha256:/, "").trim().toLowerCase();
}

export function findExistingVideoSource({
  contentPath,
  clusterSlug,
  youtubeVideoId,
  mediaSha256,
  contentHash,
}: {
  contentPath: string;
  clusterSlug: string;
  youtubeVideoId?: string | null;
  mediaSha256?: string | null;
  contentHash?: string | null;
}): ExistingVideoSource | null {
  const sourcesDir = path.join(
    clusterDir(contentPath, clusterSlug),
    SOURCE_NOTE_FOLDER,
  );
  if (!fs.existsSync(sourcesDir)) return null;

  const wantedHash = normalizedContentHash(contentHash ?? undefined);
  const wantedMedia = (mediaSha256 ?? "").trim().toLowerCase();
  const wantedVideo = (youtubeVideoId ?? "").trim();
  if (!wantedHash && !wantedMedia && !wantedVideo) return null;

  let files: fs.Dirent[];
  try {
    files = fs.readdirSync(sourcesDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const file of files) {
    if (!file.isFile() || !file.name.toLowerCase().endsWith(".md")) continue;
    const fullPath = path.join(sourcesDir, file.name);
    let data: Record<string, string>;
    try {
      data = parseFrontmatter(fs.readFileSync(fullPath, "utf8"));
    } catch {
      continue;
    }

    const sameVideo =
      wantedVideo && (data.youtube_video_id ?? "").trim() === wantedVideo;
    const sameMedia =
      wantedMedia &&
      (data.media_sha256 ?? "").trim().toLowerCase() === wantedMedia;
    const sameHash =
      wantedHash && normalizedContentHash(data.content_hash) === wantedHash;
    if (!sameVideo && !sameMedia && !sameHash) continue;

    const sourceSlug = file.name.replace(/\.md$/i, "");
    return {
      sourceSlug,
      sourceRelPath: `${SOURCE_NOTE_FOLDER}/${file.name}`,
      title: data.title,
      youtubeVideoId: data.youtube_video_id,
      mediaSha256: data.media_sha256,
      contentHash: data.content_hash,
    };
  }
  return null;
}

/** True when slugify(title) would collide with an existing source file. */
export function sourceSlugExists(
  contentPath: string,
  clusterSlug: string,
  slug: string,
): boolean {
  if (!slug) return false;
  const sourcesDir = path.join(
    clusterDir(contentPath, clusterSlug),
    SOURCE_NOTE_FOLDER,
  );
  return fs.existsSync(path.join(sourcesDir, `${slug}.md`));
}
