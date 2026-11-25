import fs from "node:fs";
import path from "node:path";

/** Read the source metadata without loading a book's extracted text on each PDF range request. */
export function readSourceFrontmatter(markdownPath: string): Record<string, string> {
  const fd = fs.openSync(/* turbopackIgnore: true */ markdownPath, "r");
  try {
    const prefix = Buffer.allocUnsafe(8192);
    const count = fs.readSync(fd, prefix, 0, prefix.length, 0);
    const start = prefix.subarray(0, count).toString("utf8");
    if (!/^---\r?\n/.test(start)) return {};
    // Only an unusually long header needs another read. A short header can
    // end anywhere, including across the boundary of the first block.
    const content = count < prefix.length || /\n---/.test(start)
      ? start : fs.readFileSync(fd, "utf8");
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fields: Record<string, string> = Object.create(null);
    for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const raw = line.slice(colon + 1).trim();
      let value: string;
      try {
        const parsed: unknown = JSON.parse(raw);
        value = typeof parsed === "string" ? parsed : "";
      } catch {
        value = raw.replace(/^["']|["']$/g, "");
      }
      fields[line.slice(0, colon).trim()] = value;
    }
    return fields;
  } finally {
    fs.closeSync(fd);
  }
}

/** Resolve a published source path by directory entries, including Quartz's space-to-dash spelling. */
export function findGardenSourceNote(clusterDir: string, note: string) {
  const parts = note.split("/");
  if (parts[0]?.toLowerCase() !== "sources" || parts.length < 2 || /^_?index$/i.test(parts.at(-1)!) ||
      parts.some(part => !part || part.startsWith(".") || /[\\:\0]/.test(part) || part.toLowerCase() === "assets")) return null;
  const spelling = (name: string) => name.toLowerCase().replace(/\s+/g, "-");
  let directory = clusterDir;
  const relative: string[] = [];
  for (const [index, part] of parts.entries()) {
    const last = index === parts.length - 1;
    const wanted = spelling(last ? `${part}.md` : part);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(/* turbopackIgnore: true */ directory, { withFileTypes: true });
    } catch {
      return null;
    }
    const matches = entries.filter(entry =>
      (last ? entry.isFile() : entry.isDirectory()) && spelling(entry.name) === wanted);
    if (matches.length !== 1) return null;
    relative.push(matches[0]!.name);
    directory = path.join(directory, matches[0]!.name);
  }
  const fields = readSourceFrontmatter(directory);
  // Older notes infer their type from several other fields. Let the existing
  // Garden index resolve those and ambiguous published names.
  if (fields.knowledge_type !== "source-document") return null;
  const slug = relative.at(-1)!.replace(/\.md$/i, "");
  return {
    slug, relPath: relative.join("/"), type: fields.knowledge_type, title: fields.title || slug,
    sourceFile: fields.source_file || "", sourceType: fields.source_type || "",
    sourcePdf: fields.source_pdf || "", sourceMedia: fields.source_media || "",
  };
}

/**
 * Find a source note by basename using the same traversal order as
 * `walkClusterMarkdown`, without importing the full knowledge pipeline into a
 * small PDF route. Garden files are authenticated mutable runtime data, never
 * standalone build assets.
 */
export function resolveSourcePdfMarkdownPath(
  clusterDir: string,
  slug: string,
): string | null {
  if (!slug || slug.includes("/") || slug.includes("\\")) return null;
  if (!fs.existsSync(/* turbopackIgnore: true */ clusterDir)) return null;

  const root = path.resolve(/* turbopackIgnore: true */ clusterDir);
  const wanted = slug.replace(/\.md$/i, "");
  const matches: Array<{ filePath: string; relPath: string }> = [];

  const walk = (directory: string, relDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(/* turbopackIgnore: true */ directory, {
        withFileTypes: true,
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === "assets" || entry.name.startsWith(".")) continue;
        walk(
          path.resolve(/* turbopackIgnore: true */ directory, entry.name),
          relDir ? `${relDir}/${entry.name}` : entry.name,
        );
        continue;
      }
      if (
        !entry.isFile() ||
        !entry.name.toLowerCase().endsWith(".md") ||
        entry.name.toLowerCase() === "index.md" ||
        entry.name.toLowerCase() === "_index.md" ||
        entry.name.replace(/\.md$/i, "") !== wanted
      ) {
        continue;
      }
      const filePath = path.resolve(
        /* turbopackIgnore: true */ directory,
        entry.name,
      );
      if (!filePath.startsWith(root + path.sep)) continue;
      matches.push({
        filePath,
        relPath: relDir ? `${relDir}/${entry.name}` : entry.name,
      });
    }
  };

  walk(root, "");
  matches.sort((left, right) => left.relPath.localeCompare(right.relPath));
  return matches[0]?.filePath ?? null;
}
