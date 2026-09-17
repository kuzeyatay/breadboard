import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { GardenFilesystemError } from "./garden-directory.ts";
import { detachCopiedGardenVisuals } from "./garden-detached-visual.ts";
import { gardenCopyAssetResolver } from "./garden-copy-assets.ts";
import { rewriteGardenCopyMetadata } from "./garden-copy-metadata.ts";
import { rewriteGardenCopyLinks } from "./garden-copy-links.ts";

// Keep the Explorer's initial (pre-snapshot) protection in sync with this list.
export const AUTOMATIC_GARDEN_FOLDERS = new Set([
  "learning", "sources", "artifacts", "concepts", "notepad", "notes",
  "assets", "internal", "generated", "static", "tags", ".breadboard",
]);

export function isAutomaticGardenFolder(folder: string): boolean {
  return AUTOMATIC_GARDEN_FOLDERS.has(folder.replace(/\\/g, "/").toLowerCase());
}

/** Existing disk paths must retain spaces, punctuation and case. */
export function existingGardenFolder(clusterDir: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GardenFilesystemError("folder is required", 400);
  }
  const folder = value.replace(/\\/g, "/");
  if (folder.split("/").some(part => !part || part === "." || part === ".." || part.includes(":"))) {
    throw new GardenFilesystemError("Invalid folder path", 400);
  }
  const root = fs.realpathSync.native(clusterDir);
  let current = clusterDir;
  for (const part of folder.split("/")) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) throw new GardenFilesystemError("Folder not found", 404);
    const stat = fs.lstatSync(current);
    const resolved = fs.realpathSync.native(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || !resolved.startsWith(root + path.sep)) {
      throw new GardenFilesystemError("Invalid folder path", 400);
    }
  }
  return folder;
}

export function readGardenFolderTitle(dir: string, fallback: string): string {
  for (const file of ["_index.md", "index.md"]) {
    const index = path.join(dir, file);
    if (!fs.existsSync(index)) continue;
    const raw = fs.readFileSync(index, "utf8");
    const title = raw.match(/^---\r?\n[\s\S]*?^title:\s*(.+)$/m)?.[1]?.trim();
    if (title) {
      try {
        const parsed: unknown = JSON.parse(title);
        if (typeof parsed === "string") return parsed;
      } catch { /* YAML also permits unquoted and single-quoted strings. */ }
      return title.replace(/^['"]|['"]$/g, "");
    }
  }
  return fallback;
}

export function writeGardenFolderTitle(dir: string, title: string): void {
  const existing = ["_index.md", "index.md"].filter(file => fs.existsSync(path.join(dir, file)));
  for (const file of existing.length ? existing : ["_index.md"]) {
    const index = path.join(dir, file);
    const raw = fs.existsSync(index) ? fs.readFileSync(index, "utf8") : "";
    const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const line = `title: ${JSON.stringify(title)}`;
    const header = frontmatter
      ? /^title:.*$/m.test(frontmatter[1])
        ? frontmatter[1].replace(/^title:.*$/m, line)
        : `${line}\n${frontmatter[1]}`
      : line;
    fs.writeFileSync(index, `---\n${header}\n---\n${frontmatter ? raw.slice(frontmatter[0].length) : raw}`, "utf8");
  }
}

/** Copy a complete subtree with distinct note identities and local links. */
export function copyGardenFolderContents(clusterDir: string, folder: string, newFolder: string, noteSlug: (name: string) => string): void {
  const source = path.join(clusterDir, folder);
  const target = path.join(clusterDir, newFolder);
  const files: string[] = [];
  const directories: string[] = [];
  const scan = (dir: string, rel = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new GardenFilesystemError("Folders containing symbolic links cannot be copied", 400);
      const relative = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { directories.push(relative); scan(path.join(dir, entry.name), relative); }
      else if (entry.isFile()) files.push(relative);
    }
  };
  scan(source);

  // Legacy editor/delete/PDF APIs still address notes by basename. Never let
  // a copied page share that identity with the original or another copy.
  const occupied = new Set<string>();
  const collectNames = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) collectNames(path.join(dir, entry.name));
      else if (entry.isFile()) occupied.add(noteSlug(entry.name.replace(/\.md$/i, "")));
    }
  };
  collectNames(clusterDir);
  const copiedPaths = new Map<string, string>();
  for (const file of files) {
    const basename = path.basename(file);
    let copied = file;
    if (/\.md$/i.test(file) && !/^_?index\.md$/i.test(basename)) {
      const stem = basename.slice(0, -3);
      let number = 1;
      let name = `${stem}-copy.md`;
      while (occupied.has(noteSlug(name.slice(0, -3)))) name = `${stem}-copy-${++number}.md`;
      occupied.add(noteSlug(name.slice(0, -3)));
      const parent = file.split("/").slice(0, -1).join("/");
      copied = parent ? `${parent}/${name}` : name;
    }
    copiedPaths.set(`${folder}/${file}`, `${newFolder}/${copied}`);
  }
  const cluster = path.basename(clusterDir);
  const copyAsset = gardenCopyAssetResolver(clusterDir, newFolder);
  const rewriteLink = (link: string, originalFile: string, copiedFile: string, wiki: boolean) => {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(link)) return link;
    const [, destination, suffix = ""] = link.match(/^([^#?]*)(.*)$/) ?? [];
    if (!destination) return link;
    let decoded: string;
    try { decoded = decodeURIComponent(destination); } catch { return link; }
    const rooted = decoded.replace(/^\//, "");
    const clusterPrefix = rooted.startsWith(`${cluster}/`) ? `${cluster}/` : "";
    const fromRoot = clusterPrefix ? rooted.slice(clusterPrefix.length) : rooted;
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(originalFile), decoded));
    const candidates = wiki ? [fromRoot, relative] : [relative, fromRoot];
    for (const candidate of candidates) {
      for (const extension of ["", ".md", "/_index.md", "/index.md"]) {
        const copied = copiedPaths.get(candidate + extension);
        if (!copied) continue;
        const result = wiki || clusterPrefix || decoded.startsWith("/")
          ? `${decoded.startsWith("/") ? "/" : ""}${clusterPrefix}${copied}`
          : path.posix.relative(path.posix.dirname(copiedFile), copied);
        const rewritten = (extension === ".md" ? result.replace(/\.md$/, "") : result) + suffix;
        return wiki ? rewritten : rewritten.replace(/ /g, "%20");
      }
    }
    if (wiki && !decoded.includes("/")) {
      const matches = [...copiedPaths].filter(([original]) =>
        path.posix.basename(original).replace(/\.md$/i, "") === decoded.replace(/\.md$/i, ""));
      if (matches.length === 1) return matches[0][1].replace(/\.md$/i, "") + suffix;
    }
    const asset = copyAsset(link, originalFile);
    return asset ? (wiki ? asset : asset.replace(/ /g, "%20")) : link;
  };

  // Reserve the destination first. A collision must never merge two folders.
  fs.mkdirSync(target);
  try {
    for (const dir of directories) fs.mkdirSync(path.join(target, dir), { recursive: true });
    for (const file of files) {
      const original = `${folder}/${file}`;
      const copied = copiedPaths.get(original)!;
      if (/\.md$/i.test(file)) {
        const raw = fs.readFileSync(path.join(clusterDir, original), "utf8");
        const withMetadata = rewriteGardenCopyMetadata(raw, link => rewriteLink(link, original, copied, true), { original, folder: newFolder });
        const updated = rewriteGardenCopyLinks(withMetadata, (link, wiki) => rewriteLink(link, original, copied, wiki));
        fs.writeFileSync(path.join(clusterDir, copied), detachCopiedGardenVisuals(clusterDir, original, updated), "utf8");
      } else fs.copyFileSync(path.join(clusterDir, original), path.join(clusterDir, copied));
    }
  } catch (error) {
    // Only the newly reserved sibling is removed; the source is never touched.
    const resolved = path.resolve(target);
    if (resolved.startsWith(path.resolve(clusterDir) + path.sep) && resolved !== path.resolve(source)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
    throw error;
  }
}

/** Keep path-qualified links within a renamed copy pointed at that copy. */
export function rewriteRenamedFolderLinks(clusterDir: string, folder: string, newFolder: string): void {
  const cluster = path.basename(clusterDir);
  const rewrite = (link: string) => {
    for (const prefix of ["", "/", `${cluster}/`, `/${cluster}/`]) {
      const oldPath = `${prefix}${folder}/`;
      if (link.startsWith(oldPath)) return `${prefix}${newFolder}/${link.slice(oldPath.length)}`;
    }
    return link;
  };
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const raw = fs.readFileSync(file, "utf8");
        const withMetadata = rewriteGardenCopyMetadata(raw, rewrite);
        const updated = rewriteGardenCopyLinks(withMetadata, rewrite);
        if (updated !== raw) fs.writeFileSync(file, updated, "utf8");
      }
    }
  };
  walk(path.join(clusterDir, newFolder));
}
