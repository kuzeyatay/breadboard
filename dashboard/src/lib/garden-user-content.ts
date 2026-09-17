import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

// Source inputs and Learn output have their own lifecycle. Every other visible
// top-level folder belongs to the reader, regardless of its frontmatter.
const MANAGED_ROOTS = new Set([
  "learning", "sources", "concepts", "internal", "assets", "generated", "static", "tags",
  "node_modules", "_index.md", "index.md",
]);

export function isGardenUserPath(relativePath: string): boolean {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  if (parts.some(part => !part || part === "." || part === ".." || part.includes(":"))) return false;
  // Root Markdown can include legacy source documents. Independent folders
  // have an unambiguous boundary; root documents retain the exclusive fence.
  return !parts[0].startsWith(".") && !/\.md$/i.test(parts[0]) && !MANAGED_ROOTS.has(parts[0].toLowerCase());
}

/** Navigation is a derived view rebuilt by both Learn and ordinary saves. */
export function isGardenUserOrNavigationPath(relativePath: string): boolean {
  return isGardenUserPath(relativePath) || ["_index.md", "sources/_index.md"].includes(relativePath.replace(/\\/g, "/").toLowerCase());
}

/** Validate the actual ancestors too: a user folder must not alias a source. */
export function areGardenUserWritePaths(gardenDir: string, paths: readonly string[]): boolean {
  if (!paths.length || !paths.every(isGardenUserPath)) return false;
  const root = path.resolve(gardenDir);
  if (fs.lstatSync(root, { throwIfNoEntry: false })?.isSymbolicLink()) return false;
  for (const relative of paths) {
    let current = root;
    for (const part of relative.replace(/\\/g, "/").split("/")) {
      current = path.resolve(current, part);
      if (!current.startsWith(root + path.sep)) return false;
      const stat = fs.lstatSync(current, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) return false;
    }
  }
  return true;
}

/** Reconcile the whole user namespace, so deleted or renamed notes stay gone.
 * Call only on an isolated candidate while holding the short garden save lease. */
export function mergeCurrentGardenUserContent(currentDir: string, incomingDir: string): void {
  const current = path.resolve(currentDir);
  const incoming = path.resolve(incomingDir);
  if (current === incoming || incoming.startsWith(current + path.sep) || current.startsWith(incoming + path.sep)) {
    throw new Error("User content merge requires separate garden trees.");
  }
  const entries = fs.readdirSync(current, { withFileTypes: true }).filter(entry => isGardenUserPath(entry.name));
  const check = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("User content contains an unsupported symbolic link.");
      if (entry.isDirectory()) check(path.join(dir, entry.name));
    }
  };
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error("User content contains an unsupported symbolic link.");
    if (entry.isDirectory()) check(path.join(current, entry.name));
  }
  for (const entry of fs.readdirSync(incoming, { withFileTypes: true })) {
    if (!isGardenUserPath(entry.name)) continue;
    const target = path.resolve(incoming, entry.name);
    if (!target.startsWith(incoming + path.sep)) throw new Error("User content merge escaped staging.");
    fs.rmSync(target, { recursive: true, force: true });
  }
  for (const entry of entries) {
    fs.cpSync(path.join(current, entry.name), path.join(incoming, entry.name), { recursive: true, dereference: false });
  }
  preserveUserVisuals(current, incoming, entries.map(entry => path.join(current, entry.name)));
}

export function collectGardenUserVisualIds(gardenDir: string): Set<string> {
  const roots = fs.readdirSync(gardenDir, { withFileTypes: true })
    .filter(entry => isGardenUserPath(entry.name))
    .map(entry => path.join(gardenDir, entry.name));
  return collectUserVisualIds(roots);
}

function collectUserVisualIds(roots: string[]): Set<string> {
  const ids = new Set<string>();
  const visit = (file: string): void => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error("User content contains an unsupported symbolic link.");
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(file)) visit(path.join(file, entry));
    } else if (/\.md$/i.test(file)) {
      const markdown = fs.readFileSync(file, "utf8");
      for (const block of markdown.matchAll(/```breadboard-visual[^\r\n]*\r?\n([\s\S]*?)```/g)) {
        for (const match of block[1].matchAll(/["']id["']\s*:\s*["']([A-Za-z0-9_-]+)["']/g)) ids.add(match[1]);
      }
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] ?? "";
      for (const field of frontmatter.matchAll(/^(?:visualIds|visuals):\s*(\[[^\n]*\]|(?:\r?\n[ \t]+-[^\n]*)+)/gm)) {
        for (const id of field[1].replace(/[\[\]"']/g, "").split(/,|\r?\n[ \t]+-\s*/)) {
          if (/^[A-Za-z0-9_-]+$/.test(id.trim())) ids.add(id.trim());
        }
      }
    }
  };
  roots.forEach(visit);
  return ids;
}

/** Copies may still reference visuals from an older curriculum. Preserve those
 * dependencies without replacing any visual validated for the new curriculum. */
function preserveUserVisuals(current: string, incoming: string, roots: string[]): void {
  const ids = collectUserVisualIds(roots);
  if (!ids.size) return;
  const readIndex = (root: string): Record<string, unknown> | unknown[] => {
    const file = path.join(root, ".breadboard/visual-index.json");
    if (!fs.existsSync(file)) return {};
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid visual index while preserving copied notes.");
    return parsed as Record<string, unknown> | unknown[];
  };
  const collection = (value: Record<string, unknown> | unknown[]): Record<string, unknown> | unknown[] => {
    if (Array.isArray(value)) return value;
    return value.visuals && typeof value.visuals === "object" ? value.visuals as Record<string, unknown> | unknown[] : value;
  };
  const currentIndex = collection(readIndex(current));
  const incomingIndex = readIndex(incoming);
  const next = collection(incomingIndex);
  const copyMissing = (source: string, destination: string): void => {
    const stat = fs.lstatSync(source, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error("Copied visual contains an unsupported symbolic link.");
    if (stat.isDirectory()) {
      fs.mkdirSync(destination, { recursive: true });
      for (const entry of fs.readdirSync(source)) copyMissing(path.join(source, entry), path.join(destination, entry));
    } else if (!fs.existsSync(destination)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    }
  };
  const find = (value: Record<string, unknown> | unknown[], id: string): unknown => Array.isArray(value)
    ? value.find(entry => entry && typeof entry === "object" && "id" in entry && entry.id === id) : value[id];
  let changed = false;
  for (const id of ids) {
    for (const name of [id, `${id}.json`]) {
      copyMissing(path.join(current, ".breadboard/visuals", name), path.join(incoming, ".breadboard/visuals", name));
    }
    const existing = find(currentIndex, id);
    if (existing && !find(next, id)) {
      if (Array.isArray(next)) next.push(existing);
      else Object.defineProperty(next, id, { value: existing, enumerable: true, configurable: true, writable: true });
      changed = true;
    }
  }
  if (changed) {
    fs.mkdirSync(path.join(incoming, ".breadboard"), { recursive: true });
    fs.writeFileSync(path.join(incoming, ".breadboard/visual-index.json"), JSON.stringify(incomingIndex, null, 2) + "\n");
  }
}
