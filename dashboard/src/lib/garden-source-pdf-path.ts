import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { isGardenUserPath } from "./garden-user-content.ts";

/** Original PDFs and private copies both resolve inside this garden's asset trees. */
export function resolveGardenSourcePdfPath(contentPath: string, clusterSlug: string, sourcePdf: string): string | null {
  const root = path.resolve(contentPath);
  const garden = path.resolve(root, clusterSlug);
  if (!garden.startsWith(root + path.sep)) return null;
  let url: string;
  try { url = decodeURIComponent(sourcePdf.trim()); } catch { return null; }
  const prefix = `/${clusterSlug}/`;
  if (!url.startsWith(prefix) || !/\.pdf$/i.test(url)) return null;
  const relative = url.slice(prefix.length);
  const parts = relative.split("/");
  if (parts.some(part => !part || part.startsWith(".") || /[\\:\0]/.test(part))) return null;
  if (parts[0] !== "assets" && !(isGardenUserPath(relative) && parts.slice(1, -1).includes("assets"))) return null;
  let current = garden;
  for (const part of ["", ...parts]) {
    current = path.join(current, part);
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) return null;
  }
  return current.startsWith(garden + path.sep) ? current : null;
}
