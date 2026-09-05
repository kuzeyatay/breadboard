// Orchestration for the "Parse using VLM" option: page images in, one
// Breadboard-safe Markdown document out.
//
// Rasterizing the PDF stays in the ingest route (it already owns pdf-parse and
// the asset writer); this module only knows about images, so it can be unit
// tested against a fake OCR call.

import { runVlmOcrPage } from "./client.ts";
import type { VlmOcrConfig } from "./config.ts";
import { VlmOcrRequestError, vlmOcrErrorMessage } from "./errors.ts";
import { embedPageFigures, type FigureSaver } from "./figures.ts";
import { normalizeDocParseMarkdown } from "./normalize.ts";
import {
  DEFAULT_VLM_OCR_TASK,
  vlmOcrPrompt,
  type VlmOcrTask,
} from "./prompts.ts";
import { ensureVlmOcrServer } from "./server.ts";
import { shiftHeadings, toBreadboardMarkdown } from "./quartz-safe.ts";

export interface VlmOcrInputPage {
  /** Heading shown above the page, e.g. "Page 3". */
  label: string;
  pageNumber: number;
  /** `data:image/...;base64,...` */
  dataUrl: string;
}

export interface VlmOcrParsedPage {
  label: string;
  pageNumber: number;
  text: string;
  failed: boolean;
}

export interface VlmOcrDocument {
  markdown: string;
  pages: VlmOcrParsedPage[];
  warnings: string[];
  failedPages: number;
  truncatedPages: number;
  /** Figures cropped out of the page images and embedded in the markdown. */
  figureCount: number;
}

/** Page headings sit at `##`, so OCR headings start at `###`. */
const HEADING_SHIFT = 2;
const PAGE_TRANSPORT_RETRIES = 3;

type OcrRunner = (args: {
  config: VlmOcrConfig;
  dataUrl: string;
  prompt: string;
  signal?: AbortSignal;
}) => Promise<{ text: string; earlyStopped: boolean }>;

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isRetryableTransportFailure(error: unknown): boolean {
  return (
    error instanceof VlmOcrRequestError &&
    (error.status === undefined || error.status >= 500)
  );
}

export async function parsePagesWithVlm({
  config,
  pages,
  task = DEFAULT_VLM_OCR_TASK,
  signal,
  onProgress,
  saveFigure,
  progressOffset = 0,
  progressTotal,
  // Injected in tests so the pipeline can run without a model server.
  runner = runVlmOcrPage,
  ensureServer = ensureVlmOcrServer,
}: {
  config: VlmOcrConfig;
  pages: VlmOcrInputPage[];
  task?: VlmOcrTask;
  signal?: AbortSignal;
  onProgress?: (step: string) => void;
  /** Persists a cropped figure and returns the URL to embed. */
  saveFigure?: FigureSaver;
  /** Already-completed pages when this call is one bounded render batch. */
  progressOffset?: number;
  /** Whole-document page count for progress emitted by a bounded batch. */
  progressTotal?: number;
  runner?: OcrRunner;
  ensureServer?: (
    config: VlmOcrConfig,
    onProgress?: (step: string) => void,
  ) => Promise<void>;
}): Promise<VlmOcrDocument> {
  const selected =
    config.maxPages > 0 ? pages.slice(0, config.maxPages) : [...pages];
  const warnings: string[] = [];

  if (selected.length < pages.length) {
    warnings.push(
      `Only the first ${selected.length} of ${pages.length} pages were parsed (VLM_OCR_MAX_PAGES).`,
    );
  }
  if (selected.length === 0) {
    return {
      markdown: "",
      pages: [],
      warnings,
      failedPages: 0,
      truncatedPages: 0,
      figureCount: 0,
    };
  }

  await ensureServer(config, onProgress);

  const prompt = vlmOcrPrompt(task);
  const results = new Array<VlmOcrParsedPage>(selected.length);
  const failures: string[] = [];
  let truncatedPages = 0;
  let figureCount = 0;
  let skippedFigures = 0;
  let nextIndex = 0;
  let completed = 0;

  const worker = async () => {
    while (nextIndex < selected.length) {
      const index = nextIndex;
      nextIndex += 1;
      const page = selected[index];
      if (signal?.aborted) return;

      try {
        let result: Awaited<ReturnType<OcrRunner>> | null = null;
        for (let attempt = 0; attempt <= PAGE_TRANSPORT_RETRIES; attempt += 1) {
          try {
            result = await runner({
              config,
              dataUrl: page.dataUrl,
              prompt,
              signal,
            });
            break;
          } catch (error) {
            if (isAbort(error) || !isRetryableTransportFailure(error)) throw error;
            if (attempt >= PAGE_TRANSPORT_RETRIES) throw error;
            onProgress?.(
              `Recovering the local OCR model server for ${page.label} (${attempt + 1}/${PAGE_TRANSPORT_RETRIES})…`,
            );
            await ensureServer(config, onProgress);
          }
        }
        if (!result) {
          throw new VlmOcrRequestError("The OCR page retry ended without a result.");
        }
        if (result.earlyStopped) {
          truncatedPages += 1;
          failures.push(
            `${page.label}: output stopped early because the model began repeating itself`,
          );
        }
        // Figures have to be lifted out before normalization, which deletes
        // the coordinate lines that locate them.
        let pageText = result.text;
        if (saveFigure) {
          const figures = embedPageFigures({
            text: pageText,
            pageNumber: page.pageNumber,
            pageDataUrl: page.dataUrl,
            saveFigure,
          });
          pageText = figures.text;
          figureCount += figures.embedded;
          skippedFigures += figures.skipped;
        }

        results[index] = {
          label: page.label,
          pageNumber: page.pageNumber,
          text: shiftHeadings(
            normalizeDocParseMarkdown(pageText),
            HEADING_SHIFT,
          ),
          failed: false,
        };
      } catch (error) {
        if (isAbort(error)) throw error;
        const reason = vlmOcrErrorMessage(error, "OCR failed");
        failures.push(`${page.label}: ${reason}`);
        results[index] = {
          label: page.label,
          pageNumber: page.pageNumber,
          text: `_The VLM could not read this page: ${reason}_`,
          failed: true,
        };
      }

      completed += 1;
      onProgress?.(
        `Parsing with the VLM (${progressOffset + completed}/${progressTotal ?? selected.length} pages)…`,
      );
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(config.concurrency, selected.length) }, () =>
      worker(),
    ),
  );

  if (signal?.aborted) {
    const abortError = new Error("Upload canceled");
    abortError.name = "AbortError";
    throw abortError;
  }

  const parsed = results.filter(Boolean);
  const assembled = parsed
    .map(
      (page) =>
        `## ${page.label}\n\n${page.text.trim() || "_No text was found on this page._"}`,
    )
    .join("\n\n");

  const safe = toBreadboardMarkdown(assembled);
  warnings.push(...safe.warnings);

  const failedPages = parsed.filter((page) => page.failed).length;
  if (failedPages > 0) {
    warnings.push(
      `The VLM failed on ${failedPages} page${failedPages === 1 ? "" : "s"}: ${failures.join("; ")}`,
    );
  } else if (failures.length > 0) {
    warnings.push(failures.join("; "));
  }

  if (skippedFigures > 0) {
    warnings.push(
      `${skippedFigures} figure${skippedFigures === 1 ? "" : "s"} could not be cropped out of the page image; the full page snapshot still shows them.`,
    );
  }

  return {
    markdown: safe.markdown,
    pages: parsed,
    warnings,
    failedPages,
    truncatedPages,
    figureCount,
  };
}

/**
 * Parse a large document without retaining every rendered page image. The
 * producer is advanced only after the current batch has been fully OCR'd, so
 * callers can release each batch's multi-megabyte data URLs before rendering
 * the next one.
 */
export async function parsePageBatchesWithVlm({
  config,
  batches,
  totalPages,
  task = DEFAULT_VLM_OCR_TASK,
  signal,
  onProgress,
  saveFigure,
  runner = runVlmOcrPage,
  ensureServer = ensureVlmOcrServer,
}: {
  config: VlmOcrConfig;
  batches: AsyncIterable<VlmOcrInputPage[]>;
  totalPages: number;
  task?: VlmOcrTask;
  signal?: AbortSignal;
  onProgress?: (step: string) => void;
  saveFigure?: FigureSaver;
  runner?: OcrRunner;
  ensureServer?: (
    config: VlmOcrConfig,
    onProgress?: (step: string) => void,
  ) => Promise<void>;
}): Promise<VlmOcrDocument> {
  if (!Number.isSafeInteger(totalPages) || totalPages < 0) {
    throw new TypeError("The VLM batch page total is invalid.");
  }
  const pages: VlmOcrParsedPage[] = [];
  const markdown: string[] = [];
  const warnings: string[] = [];
  let failedPages = 0;
  let truncatedPages = 0;
  let figureCount = 0;

  for await (const rawBatch of batches) {
    if (signal?.aborted) {
      const abortError = new Error("Upload canceled");
      abortError.name = "AbortError";
      throw abortError;
    }
    const remaining = totalPages - pages.length;
    if (remaining <= 0) break;
    const batch = rawBatch.slice(0, remaining);
    if (batch.length === 0) continue;
    const result = await parsePagesWithVlm({
      config: { ...config, maxPages: 0 },
      pages: batch,
      task,
      signal,
      onProgress,
      saveFigure,
      runner,
      ensureServer,
      progressOffset: pages.length,
      progressTotal: totalPages,
    });
    pages.push(...result.pages);
    if (result.markdown.trim()) markdown.push(result.markdown.trim());
    warnings.push(...result.warnings);
    failedPages += result.failedPages;
    truncatedPages += result.truncatedPages;
    figureCount += result.figureCount;
  }

  return {
    markdown: markdown.join("\n\n"),
    pages,
    warnings: [...new Set(warnings)],
    failedPages,
    truncatedPages,
    figureCount,
  };
}
