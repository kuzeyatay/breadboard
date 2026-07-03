import fs from "fs";
import path from "path";

export interface ExistingUrlSource {
  sourceSlug: string;
  sourceRelPath: string;
  title?: string;
  contentHash?: string;
  originalUrl?: string;
}

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

export function findExistingUrlSource({
  contentPath,
  clusterSlug,
  contentHash,
  originalUrl,
}: {
  contentPath: string;
  clusterSlug: string;
  contentHash: string;
  originalUrl: string;
}): ExistingUrlSource | null {
  const sourcesDir = path.join(clusterDir(contentPath, clusterSlug), SOURCE_NOTE_FOLDER);
  if (!fs.existsSync(sourcesDir)) return null;
  const files = fs
    .readdirSync(sourcesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"));
  for (const file of files) {
    const fullPath = path.join(sourcesDir, file.name);
    const data = parseFrontmatter(fs.readFileSync(fullPath, "utf8"));
    const sameHash = data.content_hash && data.content_hash === contentHash;
    const sameUrl =
      data.original_url &&
      data.source_type === "url" &&
      data.original_url.replace(/#.*$/, "") === originalUrl.replace(/#.*$/, "");
    if (!sameHash && !sameUrl) continue;
    const sourceSlug = file.name.replace(/\.md$/i, "");
    return {
      sourceSlug,
      sourceRelPath: `${SOURCE_NOTE_FOLDER}/${file.name}`,
      title: data.title,
      contentHash: data.content_hash,
      originalUrl: data.original_url,
    };
  }
  return null;
}
