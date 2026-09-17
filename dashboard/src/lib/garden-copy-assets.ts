import { randomUUID } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

/** Copies only files actually used by the notes, into their own folder tree. */
export function gardenCopyAssetResolver(gardenDir: string, destination: string) {
  const root = path.resolve(gardenDir);
  const cluster = path.basename(root);
  const assets = new Map<string, string>();
  const assetFolder = `${destination}/assets/${randomUUID()}`;
  return (url: string, originalPage: string): string | null => {
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(url)) return null;
    const [, raw, suffix = ""] = url.match(/^([^?#]*)(.*)$/) ?? [];
    if (!raw) return null;
    let decoded: string;
    try { decoded = decodeURIComponent(raw); } catch { return null; }
    // Notes outside the copied subtree remain citations, not recursive copies.
    if (!/\.[a-z\d]{1,12}$/i.test(decoded) || /\.md$/i.test(decoded)) return null;
    if (decoded.includes("\\") || decoded.includes("\0") || decoded.includes(":")) throw new Error("Invalid copied attachment path.");
    const prefix = `/${cluster}/`;
    const candidates = decoded.startsWith(prefix) ? [decoded.slice(prefix.length)]
      : decoded.startsWith(`${cluster}/`) ? [decoded.slice(cluster.length + 1)]
      : decoded.startsWith("/") ? []
      : [path.posix.normalize(path.posix.join(path.posix.dirname(originalPage), decoded)), decoded];
    for (const relative of candidates) {
      const parts = relative.split("/");
      if (parts.some(part => !part || part === "." || part === ".." || part.startsWith("."))) continue;
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) continue;
      let ancestor = root;
      for (const part of parts) {
        ancestor = path.join(ancestor, part);
        if (fs.lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Copied attachments cannot use symbolic links.");
      }
      if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
      let copied = assets.get(file);
      if (!copied) {
        copied = `${assetFolder}/${relative}`;
        const target = path.resolve(root, copied);
        if (!target.startsWith(path.resolve(root, destination) + path.sep)) throw new Error("Copied attachment escaped its folder.");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file, target);
        assets.set(file, copied);
      }
      return `/${cluster}/${copied}${suffix}`;
    }
    // A known garden asset must not become a silently broken copy.
    if (candidates.some(relative => relative.split("/").includes("assets"))) {
      throw new Error(`Attachment ${url} is missing; the folder was not copied.`);
    }
    return null;
  };
}
