import { createHash } from "node:crypto";
import sharp from "sharp";

type InspectionCrop = { x: number; y: number; width: number; height: number };
function inspectionCrop(value: unknown): InspectionCrop | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid crop.");
  const { x, y, width, height } = value as Record<string, unknown>;
  if (![x, y, width, height].every(v => typeof v === "number" && Number.isFinite(v)) ||
      (x as number) < 0 || (y as number) < 0 || (width as number) <= 0 || (height as number) <= 0 ||
      (x as number) + (width as number) > 1 || (y as number) + (height as number) > 1) {
    throw new Error("Crop x, y, width and height must describe a rectangle within 0–1.");
  }
  return { x, y, width, height } as InspectionCrop;
}

type PdfPage = Awaited<ReturnType<typeof renderInspectionImage>> & { pdfPage: number };
type CachedPdfPage = Omit<PdfPage, "screenshot"> & { totalPages: number; jpeg: Buffer };
// Source reading and review often request the same original pages. Reuse only
// identical bytes and crops, after the caller's normal file authorization.
// Keep binary JPEGs instead of base64 strings to bound retained pixel memory.
const PDF_PAGE_CACHE_BYTES = 64 * 1024 * 1024;
const pdfPageCache = new Map<string, CachedPdfPage>();
let pdfPageCacheBytes = 0;
function retainPdfPage(key: string, page: PdfPage, totalPages: number) {
  const jpeg = Buffer.from(page.screenshot.dataUrl.slice("data:image/jpeg;base64,".length), "base64");
  if (jpeg.byteLength > PDF_PAGE_CACHE_BYTES) return;
  const prior = pdfPageCache.get(key);
  if (prior) { pdfPageCacheBytes -= prior.jpeg.byteLength; pdfPageCache.delete(key); }
  while (pdfPageCacheBytes + jpeg.byteLength > PDF_PAGE_CACHE_BYTES && pdfPageCache.size) {
    const oldest = pdfPageCache.keys().next().value!;
    pdfPageCacheBytes -= pdfPageCache.get(oldest)!.jpeg.byteLength;
    pdfPageCache.delete(oldest);
  }
  pdfPageCache.set(key, { pdfPage: page.pdfPage, originalWidth: page.originalWidth,
    originalHeight: page.originalHeight, totalPages, jpeg });
  pdfPageCacheBytes += jpeg.byteLength;
}

/** Render one preserved PDF page, including pages without pre-generated snapshots. */
export async function renderInspectionPdfPage(bytes: Buffer, pageNumber: number, args: Record<string, unknown>) {
  const result = await renderInspectionPdfPages(bytes, [pageNumber], args);
  return { ...result.pages[0], totalPages: result.totalPages };
}

/** Read one PDF once when a source excerpt spans several original pages. */
export async function renderInspectionPdfPages(bytes: Buffer, pageNumbers: number[], args: Record<string, unknown>) {
  if (!pageNumbers.length || pageNumbers.some(page => !Number.isInteger(page) || page < 1)) throw new Error("pdfPage must be a positive integer.");
  if (bytes.length > 128 * 1024 * 1024) throw new Error("PDF exceeds the inspection size limit.");
  const crop = inspectionCrop(args.crop);
  const documentHash = createHash("sha256").update(bytes).digest("hex");
  const key = (page: number) => JSON.stringify([documentHash, page, crop ?? null]);
  const pages = new Map<number, PdfPage>();
  let totalPages = 0;
  for (const pageNumber of new Set(pageNumbers)) {
    const id = key(pageNumber), cached = pdfPageCache.get(id);
    if (!cached) continue;
    pdfPageCache.delete(id); pdfPageCache.set(id, cached);
    totalPages = cached.totalPages;
    pages.set(pageNumber, { pdfPage: pageNumber, originalWidth: cached.originalWidth,
      originalHeight: cached.originalHeight,
      screenshot: { dataUrl: `data:image/jpeg;base64,${cached.jpeg.toString("base64")}` } });
  }
  const needed = [...new Set(pageNumbers)].filter(page => !pages.has(page));
  if (!needed.length) return { totalPages, pages: pageNumbers.map(page => pages.get(page)!) };
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    const info = await parser.getInfo();
    totalPages = info.total;
    const missing = pageNumbers.find(page => page > info.total);
    if (missing !== undefined) throw new Error(`This PDF has ${info.total} pages, not page ${missing}.`);
    const result = await parser.getScreenshot({ partial: needed, desiredWidth: 1600,
      imageBuffer: true, imageDataUrl: false });
    for (const pageNumber of needed) {
      const page = result.pages.find(candidate => candidate.pageNumber === pageNumber);
      if (!page?.data?.length) throw new Error("The requested PDF page could not be rendered.");
      const rendered = { pdfPage: pageNumber, ...await renderInspectionImage(Buffer.from(page.data), { crop }) };
      pages.set(pageNumber, rendered);
      retainPdfPage(key(pageNumber), rendered, totalPages);
    }
    return { totalPages, pages: pageNumbers.map(page => pages.get(page)!) };
  } finally { await parser.destroy(); }
}

/** Shared pixel preparation for an owned attachment or authorized Garden figure. */
export async function renderInspectionImage(bytes: Buffer, args: Record<string, unknown>) {
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Image exceeds the inspection size limit.");
  const crop = inspectionCrop(args.crop);
  // Normalize EXIF orientation before interpreting crop coordinates.
  const normalized = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().toBuffer();
  const metadata = await sharp(normalized).metadata();
  const width = metadata.width!;
  const height = metadata.height!;
  let pipeline = sharp(normalized);
  if (crop) {
    const { x, y, width: w, height: h } = crop;
    const left = Math.min(width - 1, Math.floor((x as number) * width));
    const top = Math.min(height - 1, Math.floor((y as number) * height));
    pipeline = pipeline.extract({ left, top,
      width: Math.min(width - left, Math.max(1, Math.round((w as number) * width))),
      height: Math.min(height - top, Math.max(1, Math.round((h as number) * height))),
    });
  }
  const rendered = await pipeline.resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 95 }).toBuffer();
  return { originalWidth: width, originalHeight: height,
    screenshot: { dataUrl: `data:image/jpeg;base64,${rendered.toString("base64")}` } };
}
