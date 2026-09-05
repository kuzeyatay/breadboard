import type { Dirent } from "node:fs";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

function slugKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function requestedNotePath(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.md$/i, "");
  const segments = normalized.split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return segments.join("/");
}

/**
 * Turn either a current nested note path or a basename-only historical link
 * into the exact path Quartz publishes for that Garden. An exact path wins
 * before the compatibility basename lookup, which keeps duplicate filenames
 * from overriding a destination that was already unambiguous.
 */
export function resolveGardenNoteSlug(
  contentPath: string,
  gardenSlug: string,
  requestedNote: string,
): string | null {
  const root = path.resolve(contentPath);
  const gardenDir = path.resolve(root, gardenSlug.trim());
  if (gardenDir === root || !gardenDir.startsWith(`${root}${path.sep}`)) return null;

  const wantedPath = requestedNotePath(requestedNote);
  if (!wantedPath || !fs.existsSync(gardenDir)) return null;

  const notes: Array<{ relPath: string; pageSlug: string; basename: string }> = [];
  const walk = (directory: string, relativeDirectory: string): void => {
    let entries: Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === "assets" || entry.name.startsWith(".")) continue;
        walk(
          path.join(directory, entry.name),
          relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
        );
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const lowerName = entry.name.toLowerCase();
      if (lowerName === "index.md" || lowerName === "_index.md") continue;
      const relPath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      notes.push({
        relPath,
        pageSlug: relPath.replace(/\.md$/i, ""),
        basename: entry.name.replace(/\.md$/i, ""),
      });
    }
  };
  walk(gardenDir, "");
  notes.sort((left, right) => left.relPath.localeCompare(right.relPath));

  const exact = notes.find(
    (note) => note.pageSlug.toLowerCase() === wantedPath.toLowerCase(),
  );
  if (exact) return exact.pageSlug;

  const wantedBasename = wantedPath.split("/").at(-1) ?? "";
  const wantedKey = slugKey(wantedBasename);
  const legacy = notes.find(
    (note) =>
      note.basename.toLowerCase() === wantedBasename.toLowerCase() ||
      (wantedKey !== "" && slugKey(note.basename) === wantedKey),
  );
  return legacy?.pageSlug ?? null;
}
