import { createHash, randomUUID } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";

export interface VisualDescription {
  imagePath: string;
  caption: string;
  description: string;
  visibleText: string;
  model: string;
  sha256: string;
  size: number;
  mtimeMs: number;
}

export type VisualDescriptionCache = Map<string, unknown>;

/** Runtime V2 uses extended Windows roots; realpath returns ordinary paths.
 * Compare like representations while still rejecting resolved link escapes. */
function insideGarden(root: string, resolved: string): boolean {
  const relative = path.relative(path.toNamespacedPath(root), path.toNamespacedPath(resolved));
  return relative !== "" && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
}

/** Both inventory and enrichment use the same authorized asset boundary. */
export async function localGardenImage(root: string, gardenSlug: string, imagePath?: string): Promise<string | null> {
  if (!imagePath) return null;
  let url: string;
  try { url = decodeURIComponent(imagePath); } catch { return null; }
  const prefix = `/${gardenSlug}/assets/`;
  if (!url.startsWith(prefix) || /[\\?#\u0000-\u001f]/.test(url)) return null;
  const parts = url.slice(prefix.length).split("/");
  if (parts.some(part => !part || part === "." || part === ".." || part.includes(":"))) return null;
  try {
    const asset = await fs.promises.realpath(path.join(root, "assets", ...parts));
    if (!insideGarden(root, asset)) return null;
    const stat = await fs.promises.stat(asset);
    return stat.isFile() && stat.size > 0 ? asset : null;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(String((error as NodeJS.ErrnoException).code))) return null;
    throw error;
  }
}

async function descriptionDirectory(root: string, create: boolean): Promise<string | null> {
  try {
    const metadata = path.join(root, ".breadboard");
    if (create) await fs.promises.mkdir(metadata, { recursive: true });
    if (!insideGarden(root, await fs.promises.realpath(metadata))) return null;
    const directory = path.join(metadata, "visual-descriptions");
    if (create) await fs.promises.mkdir(directory, { recursive: true });
    const resolved = await fs.promises.realpath(directory);
    return insideGarden(root, resolved) ? resolved : null;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(String((error as NodeJS.ErrnoException).code))) return null;
    throw error;
  }
}

function descriptionKey(imagePath: string) {
  return createHash("sha256").update(imagePath).digest("hex");
}

/** Full searches share one catalog; page reads open only their candidate records. */
export async function loadVisualDescriptions(root: string, imagePaths?: readonly string[]): Promise<VisualDescriptionCache> {
  const cache: VisualDescriptionCache = new Map();
  if (imagePaths?.length === 0) return cache;
  const directory = await descriptionDirectory(root, false);
  if (!directory) return cache;
  const files = imagePaths
    ? [...new Set(imagePaths.map(imagePath => `${descriptionKey(imagePath)}.json`))]
    : (await fs.promises.readdir(directory, { withFileTypes: true }))
      .filter(file => file.isFile() && /^[a-f0-9]{64}\.json$/.test(file.name)).map(file => file.name);
  // Each record is at most 30 KB. Bound open files while avoiding a serial
  // filesystem round trip for every figure in a full-Garden search.
  for (let offset = 0; offset < files.length; offset += 16) {
    await Promise.all(files.slice(offset, offset + 16).map(async file => {
      try {
        const filename = path.join(directory, file);
        const stat = await fs.promises.lstat(filename);
        if (!stat.isFile() || stat.size > 30_000) return;
        const record = JSON.parse(await fs.promises.readFile(filename, "utf8"));
        if (record && typeof record.imagePath === "string" && `${descriptionKey(record.imagePath)}.json` === file) {
          cache.set(record.imagePath, record);
        }
      } catch { /* A partial/corrupt cache is not evidence; source context remains usable. */ }
    }));
  }
  return cache;
}

/** Text-only search hint. Call readVisualDescription before returning it as evidence. */
export function cachedVisualDescription(imagePath: string, cache: VisualDescriptionCache): VisualDescription | null {
  const record = cache.get(imagePath) as (VisualDescription & { version: number }) | undefined;
  if (!record || record.version !== 1 || record.imagePath !== imagePath ||
    typeof record.caption !== "string" || !record.caption.trim() || record.caption.length > 300 ||
    typeof record.description !== "string" || !record.description.trim() || record.description.length > 2400 ||
    typeof record.visibleText !== "string" || record.visibleText.length > 2400 ||
    typeof record.model !== "string" || typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)) return null;
  return record;
}

export async function readVisualDescription(root: string, imagePath: string, asset: string, cache?: VisualDescriptionCache): Promise<VisualDescription | null> {
  try {
    const record = cachedVisualDescription(imagePath, cache ?? await loadVisualDescriptions(root, [imagePath]));
    if (!record) return null;
    const stat = await fs.promises.stat(asset);
    if (record.size !== stat.size) return null;
    // Learn copies assets into staging, changing their timestamps. Reuse the
    // description only if the copied pixels still have the recorded digest.
    if (record.mtimeMs !== stat.mtimeMs && createHash("sha256").update(await fs.promises.readFile(asset)).digest("hex") !== record.sha256) return null;
    return record;
  } catch (error) {
    if (error instanceof SyntaxError || ["ENOENT", "ENOTDIR"].includes(String((error as NodeJS.ErrnoException).code))) return null;
    throw error;
  }
}

/** Per-image atomic records prevent concurrent source imports losing each other's descriptions. */
export async function saveVisualDescription(root: string, record: VisualDescription) {
  const directory = await descriptionDirectory(root, true);
  if (!directory) throw new Error("Visual descriptions must stay inside the Garden.");
  const target = path.join(directory, `${descriptionKey(record.imagePath)}.json`);
  const temporary = path.join(directory, `${randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(temporary, JSON.stringify({ ...record, version: 1 }), { flag: "wx" });
    await fs.promises.rename(temporary, target);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
}
