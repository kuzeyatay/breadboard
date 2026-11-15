import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { resolveSourcePdfMarkdownPath } from "./source-pdf-garden.ts";
import { resolveGardenSourcePdfPath } from "./garden-source-pdf-path.ts";
import { readQuartzMetadata } from "./quartz-document-metadata.ts";

export interface GardenPdfReference { clusterSlug: string; documentSlug: string }

/** URLs locate a candidate only; access and byte identity are checked separately. */
export function gardenPdfReference(request: Request, sourceUrl?: unknown): GardenPdfReference | null {
  const source = typeof sourceUrl === "string" && sourceUrl
    ? sourceUrl : request.headers.get("x-pdf-source-url") || request.headers.get("referer");
  if (!source) return null;
  try {
    // Next's request URL can use its bind address (localhost), while Electron
    // reaches the app through 127.0.0.1. Compare the browser-facing authority.
    const requestUrl = new URL(request.url);
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
      || request.headers.get("host") || requestUrl.host;
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
      || requestUrl.protocol.slice(0, -1);
    const authority = new URL(`${protocol}://${host}`);
    if (!["http:", "https:"].includes(authority.protocol) || authority.username || authority.password ||
        authority.pathname !== "/" || authority.search || authority.hash) return null;
    const url = new URL(source, authority);
    if (url.origin !== authority.origin) return null;
    const api = url.pathname.match(/^\/api\/documents\/([^/]+)\/source-pdf$/);
    const reader = url.pathname.match(/^\/gardens\/([^/]+)\/pdf\/([^/]+)$/);
    const clusterSlug = api ? url.searchParams.get("clusterSlug") : reader ? decodeURIComponent(reader[1]) : null;
    const documentSlug = api ? decodeURIComponent(api[1]) : reader ? decodeURIComponent(reader[2]) : null;
    if (!clusterSlug || !documentSlug || [clusterSlug, documentSlug].some(value =>
      value === "." || value === ".." || /[/\\:\0%]/.test(value))) return null;
    return { clusterSlug, documentSlug };
  } catch { return null; }
}

/** Preserve page numbers and exclude summaries/concept notes from source OCR. */
export function gardenPdfPageReadings(content: string): Record<number, string> {
  const pages: Record<number, string> = {};
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/, "");
  let page: number | null = null;
  let lines: string[] = [];
  let fence = "";
  const flush = () => { if (page !== null && lines.join("\n").trim()) pages[page] = lines.join("\n").trim(); };
  for (const line of body.split(/\r?\n/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = "";
      lines.push(line);
      continue;
    }
    if (!fence && /^#{1,2}\s/.test(line)) {
      flush();
      const match = line.match(/^##\s+Page\s+([1-9]\d*)\s*#*\s*$/i);
      page = match ? Number(match[1]) : null;
      lines = [];
    } else lines.push(line);
  }
  flush();
  return pages;
}

function sameFileContents(a: string, b: string): boolean {
  if (fs.statSync(a).size !== fs.statSync(b).size) return false;
  const fa = fs.openSync(a, "r"), fb = fs.openSync(b, "r");
  try {
    const ba = Buffer.allocUnsafe(1 << 20), bb = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const na = fs.readSync(fa, ba, 0, ba.length, null);
      const nb = fs.readSync(fb, bb, 0, bb.length, null);
      if (na !== nb || !ba.subarray(0, na).equals(bb.subarray(0, nb))) return false;
      if (na === 0) return true;
    }
  } finally {
    fs.closeSync(fa); fs.closeSync(fb);
  }
}

/** Caller must authorize this Garden. Reuse OCR only for the exact source/twin. */
export function readGardenPdfPages(input: GardenPdfReference & {
  contentPath: string;
  bytes?: Uint8Array;
  /** The uploaded PDF on disk; compared in chunks instead of loaded whole. */
  filePath?: string;
}): Record<number, string> | null {
  const root = path.resolve(input.contentPath);
  const garden = path.resolve(root, input.clusterSlug);
  if (!garden.startsWith(root + path.sep)) return null;
  const note = resolveSourcePdfMarkdownPath(garden, input.documentSlug);
  if (!note || fs.lstatSync(note).isSymbolicLink()) return null;
  const content = fs.readFileSync(note, "utf8");
  const metadata = readQuartzMetadata(content);
  const candidates = [metadata.source_pdf, metadata.searchable_pdf].flatMap(value => {
    if (typeof value !== "string") return [];
    const file = resolveGardenSourcePdfPath(root, input.clusterSlug, value);
    return file && fs.existsSync(file) ? [file] : [];
  });
  if (!candidates.length) return null;
  if (input.bytes && !candidates.some(file =>
    fs.statSync(file).size === input.bytes!.byteLength &&
    fs.readFileSync(file).equals(Buffer.from(input.bytes!.buffer, input.bytes!.byteOffset, input.bytes!.byteLength)))) return null;
  if (input.filePath && !candidates.some(file => sameFileContents(file, input.filePath!))) return null;
  const pages = gardenPdfPageReadings(content);
  return Object.keys(pages).length ? pages : null;
}
