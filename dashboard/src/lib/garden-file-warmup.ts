import type { Dirent } from "node:fs";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

/** Notes walked the way `walkClusterMarkdown` walks them, without blocking. */
export async function gardenMarkdownFiles(gardenDir: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (dir: string) => {
    let entries: Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name !== "assets" && !entry.name.startsWith(".")) await visit(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  await visit(gardenDir);
  return files;
}

/**
 * `scanClusterKnowledge` reads every note synchronously. On a cold disk that
 * held the dashboard's only thread 17-22 s the first time a garden opened
 * after a restart; warm, the same read is 0.2 s. Once per server start, read
 * the most recently viewed gardens' notes asynchronously (two at a time, so
 * the thread pool stays free) and let the OS cache serve that first scan.
 * Best effort: any failure just leaves the cache cold.
 */
export async function warmGardenFiles(contentPath: string, slugs: readonly string[]): Promise<number> {
  let read = 0;
  for (const slug of slugs) {
    const files = await gardenMarkdownFiles(path.join(contentPath, slug));
    for (let i = 0; i < files.length; i += 2) {
      await Promise.all(files.slice(i, i + 2).map(file => fs.promises.readFile(file).then(() => { read += 1; }, () => {})));
    }
  }
  return read;
}
