import fs from "node:fs";
import path from "node:path";

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
