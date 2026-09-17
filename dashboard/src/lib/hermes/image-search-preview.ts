import sharp from "sharp";
import { assertPublicHost } from "../get-doc/download.ts";
import { fetchImageBytes } from "../url-source-images.ts";
import { MAX_IMAGE_RESULTS, imageResultKey, imageResultUrl } from "./image-results.ts";
import type { ImageSearchDisplayItem, ImageSearchResult } from "./image-search-service.ts";

const CELL_WIDTH = 768;
const IMAGE_HEIGHT = 576;
const LABEL_HEIGHT = 40;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface ImagePreviewOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  assertPublicHostImpl?: typeof assertPublicHost;
  timeoutMs?: number;
}

/** Load pixels, not just titles. The answering model judges relevance afterward. */
async function previewItem(item: ImageSearchDisplayItem, options: ImagePreviewOptions, deadline: AbortSignal) {
  for (const url of new Set([item.image, item.thumb].map(imageResultUrl).filter(Boolean))) {
    options.signal?.throwIfAborted();
    if (deadline.aborted) return null;
    try {
      const loaded = await fetchImageBytes({
        initialUrl: new URL(url),
        pageUrl: imageResultUrl(item.page) || url,
        fetchImpl: options.fetchImpl ?? fetch,
        assertPublicHostImpl: options.assertPublicHostImpl ?? assertPublicHost,
        maxImageBytes: MAX_IMAGE_BYTES,
        timeoutMs: 5_000,
        signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline,
      });
      const pipeline = sharp(loaded.bytes, { limitInputPixels: 40_000_000 }).rotate();
      const metadata = await pipeline.metadata();
      // Tiny tracking pixels and icons cannot establish what a subject looks like.
      if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 80) continue;
      const { data, info } = await pipeline
        .resize(CELL_WIDTH, IMAGE_HEIGHT, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
      return {
        // When only the thumbnail loads, display those same pixels. Do not switch
        // back to an original image the model could not inspect.
        item: { ...item, page: imageResultUrl(item.page), image: loaded.finalUrl, thumb: loaded.finalUrl, w: info.width, h: info.height },
        data, width: info.width, height: info.height,
      };
    } catch {
      options.signal?.throwIfAborted();
      // A hotlink refusal or invalid image may still have a usable thumbnail.
    }
  }
  return null;
}

/** A bounded, numbered contact sheet maps each visible picture to display.items. */
export async function prepareImageSearchPreview(
  result: ImageSearchResult,
  count: number,
  startIndex: number,
  options: ImagePreviewOptions = {},
): Promise<ImageSearchResult> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGE_RESULTS) {
    throw new Error(`Choose between 1 and ${MAX_IMAGE_RESULTS} images to preview.`);
  }
  if (!Number.isInteger(startIndex) || startIndex < 1 || startIndex > 91) throw new Error("Invalid image-search start index.");
  const deadline = AbortSignal.timeout(Math.max(1, Math.min(20_000, options.timeoutMs ?? 20_000)));
  const seen = new Set<string>();
  const previews: NonNullable<Awaited<ReturnType<typeof previewItem>>>[] = [];
  let examined = 0;
  const candidates = result.display.items.slice(0, 10);
  while (examined < candidates.length && previews.length < count && !deadline.aborted) {
    const batch: ImageSearchDisplayItem[] = [];
    while (examined < candidates.length && batch.length < count - previews.length) {
      const item = candidates[examined++];
      const url = imageResultUrl(item.image) || imageResultUrl(item.thumb);
      if (!url) continue;
      const key = imageResultKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      batch.push(item);
    }
    const loaded = await Promise.all(batch.map((item) => previewItem(item, options, deadline)));
    for (const preview of loaded) {
      if (preview && !previews.some((prior) => prior.data.equals(preview.data))) previews.push(preview);
    }
  }
  options.signal?.throwIfAborted();
  const items = previews.map(({ item }) => item);
  const next = examined < candidates.length
    ? result.candidatePositions?.[examined] ?? startIndex + examined
    : result.nextPageStartIndex;
  const prepared: ImageSearchResult = {
    query: result.query,
    itemsReturned: items.length,
    ...(next !== undefined && Number.isInteger(next) && next > startIndex && next <= 91 ? { nextPageStartIndex: next } : {}),
    display: { query: result.query, items },
    inspection: { status: items.length ? "awaiting_review" : "unavailable", requested: count, loaded: items.length, timedOut: deadline.aborted },
    guidance: items.length
      ? "Inspect the numbered contact sheet before answering. Picture N corresponds to display.items[N-1]. These are candidates, not verified matches. Use pixels AND the source title/page to establish the subject; titles alone are insufficient. Select only relevant, clear, distinct pictures you actually viewed. Remove wrong people, memes, logos, or unrelated scenes unless requested. Choose 1–5 images TOTAL for this answer and emit one image-results block containing only the selected items; preserve their image/thumb/page URLs. Describe only visible details, using source attribution for identity. If none matches, refine the query or use nextPageStartIndex before answering. Never claim inspection when image input is unavailable."
      : "No viewable images were found. Refine the query or try the next page once. Do not render an empty gallery or invent image links; if no usable match can be viewed, explain that briefly.",
  };
  if (!previews.length) return prepared;
  const columns = Math.min(2, previews.length);
  const cellHeight = IMAGE_HEIGHT + LABEL_HEIGHT;
  const layers = previews.flatMap((preview, index) => {
    const left = (index % columns) * CELL_WIDTH;
    const top = Math.floor(index / columns) * cellHeight;
    // Only a locally generated index is interpolated, never web-supplied text.
    const label = Buffer.from(`<svg width="768" height="40"><rect width="768" height="40" fill="#eeeeee"/><text x="16" y="28" font-family="sans-serif" font-size="24" fill="#111111">Picture ${index + 1}</text></svg>`);
    return [
      { input: label, left, top },
      { input: preview.data, left: left + Math.floor((CELL_WIDTH - preview.width) / 2), top: top + LABEL_HEIGHT + Math.floor((IMAGE_HEIGHT - preview.height) / 2) },
    ];
  });
  const sheet = await sharp({ create: {
    width: columns * CELL_WIDTH, height: Math.ceil(previews.length / columns) * cellHeight,
    channels: 3, background: "#ffffff",
  } }).composite(layers).jpeg({ quality: 85 }).toBuffer();
  prepared.screenshot = { dataUrl: `data:image/jpeg;base64,${sheet.toString("base64")}` };
  return prepared;
}
