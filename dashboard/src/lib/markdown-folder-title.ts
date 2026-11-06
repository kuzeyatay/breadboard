import { externalRuntimeFilesystem as fs, externalRuntimePortableRealpath } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { parseMarkdownFrontmatter } from "./markdown-render/frontmatter.ts";

/** Use the folder's displayed title, with its directory name as a fallback. */
export function markdownFolderTitle(contentRoot: string, notePath: string): string {
  const directory = path.dirname(notePath);
  const root = externalRuntimePortableRealpath(contentRoot);
  for (const name of ["_index.md", "index.md"]) {
    const file = path.join(directory, name);
    try {
      const relative = path.relative(root, externalRuntimePortableRealpath(file));
      if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) continue;
      const metadata = fs.lstatSync(file);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1_000_000) continue;
      const title = parseMarkdownFrontmatter(fs.readFileSync(file, "utf8")).title.replace(/^Folder:\s*/i, "").trim();
      if (title) return title;
    } catch { /* A folder without an index still has a readable directory name. */ }
  }
  return path.basename(directory).replace(/[-_]+/g, " ");
}
