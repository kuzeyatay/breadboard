import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { gardenDirectory } from "./garden-directory.ts";
import { understandingPageSlug } from "./page-understanding-types.ts";

/** Resolve a published Quartz path one directory at a time, without scanning the garden. */
export async function resolveUnderstandingPage(contentPath: string, gardenSlug: string, pageSlug: string): Promise<string | null> {
  const parts = pageSlug.split("/");
  if (!pageSlug || pageSlug.length > 1000 || parts.some(part => !part || part.startsWith(".") || /[:\\]/.test(part))) return null;
  try {
    const root = await fs.promises.realpath(gardenDirectory(gardenSlug, contentPath));
    let directory = root;
    const relative: string[] = [];
    for (let index = 0; index < parts.length; index++) {
      const last = index === parts.length - 1;
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      const matches = entries.filter(entry => {
        if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "assets" || (index === 0 && entry.name === "Internal")) return false;
        if (last ? !entry.isFile() || !/\.md$/i.test(entry.name) : !entry.isDirectory()) return false;
        // A sentinel keeps directory names from being treated as file extensions
        // or _index aliases by Quartz's file-path normalization.
        const suffix = last ? [] : ["__page__.md"];
        const candidate = understandingPageSlug([...relative, entry.name, ...suffix].join("/"));
        const expected = [...parts.slice(0, index + 1), ...(last ? [] : ["__page__"])].join("/");
        return candidate === expected;
      });
      if (matches.length !== 1) return null;
      relative.push(matches[0].name);
      const resolved = await fs.promises.realpath(path.join(directory, matches[0].name));
      if (!resolved.startsWith(root + path.sep)) return null;
      directory = resolved;
    }
    return relative.join("/");
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(String((error as NodeJS.ErrnoException).code))) return null;
    throw error;
  }
}
