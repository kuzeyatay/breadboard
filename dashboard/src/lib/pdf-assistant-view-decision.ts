import { PROMPT_PDF_VIEW_DECISION } from "./system-prompts/feature-defaults.ts";
export interface PdfViewDecisionContext {
  question: string;
  title: string;
  pageNumber: number;
  pageText: string;
  sourcePageText?: string;
  selectedText?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

/** The assistant chooses evidence; do not substitute keyword capture rules. */
export function pdfViewDecisionMessages(context: PdfViewDecisionContext, systemPrompt = PROMPT_PDF_VIEW_DECISION) {
  return [
    {
      role: "system" as const,
      content: systemPrompt,
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        question: context.question.slice(0, 12_000),
        title: context.title.slice(0, 500),
        currentPage: context.pageNumber,
        currentPageText: context.pageText.slice(0, 16_000),
        originalGardenPageText: context.sourcePageText?.slice(0, 16_000),
        selectedExcerpt: context.selectedText?.slice(0, 4_000),
        recentConversation: context.history?.slice(-6).map((message) => ({
          role: message.role,
          content: message.content.slice(0, 2_000),
        })),
      }),
    },
  ];
}

export function parsePdfViewDecision(
  raw: string,
): { captureView: boolean; readWholeDocument?: boolean } | null {
  const text = raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  try {
    const value = JSON.parse(text);
    return value && typeof value.captureView === "boolean" &&
      (value.readWholeDocument === undefined || typeof value.readWholeDocument === "boolean")
      ? { captureView: value.captureView, ...(value.readWholeDocument === undefined ? {} : { readWholeDocument: value.readWholeDocument }) }
      : null;
  } catch {
    return null;
  }
}

/** Access and validation failures must still be shown instead of retried as context. */
class PdfViewDecisionRequestError extends Error {}

/** Bound the entire browser request, including route startup and response reading. */
export async function requestPdfViewDecision(input: {
  signal: AbortSignal;
  context: PdfViewDecisionContext & { sourceUrl?: string; model?: string };
  timeoutMs?: number;
}): Promise<{ captureView: boolean; readWholeDocument?: boolean }> {
  let rejectedRequest: PdfViewDecisionRequestError | undefined;
  const decision = await resolvePdfViewDecision({
    signal: input.signal,
    // Allow the server's five-second planner deadline plus transport overhead.
    timeoutMs: input.timeoutMs ?? 8_000,
    requestDecision: async signal => {
      const response = await fetch("/api/pdf-assistant/view-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify(input.context),
      });
      signal.throwIfAborted();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 &&
            response.status !== 408 && response.status !== 429) {
          rejectedRequest = new PdfViewDecisionRequestError(
            "The assistant could not prepare the PDF context. Try again.",
          );
          const detail = await response.json().catch(() => null);
          if (typeof detail?.error === "string") rejectedRequest.message = detail.error;
          throw rejectedRequest;
        }
        // Planning is optional; service failures need no new PDF or user retry.
        return "";
      }
      return response.text();
    },
  });
  // A stalled error body must not hide an access/validation status already received.
  if (rejectedRequest) throw rejectedRequest;
  return decision;
}

/** Planning only optimizes the context bundle; it must never block an answer. */
export async function resolvePdfViewDecision(input: {
  signal: AbortSignal;
  requestDecision: (signal: AbortSignal) => Promise<string>;
  timeoutMs?: number;
}): Promise<{ captureView: boolean; readWholeDocument?: boolean }> {
  input.signal.throwIfAborted();
  const deadline = new AbortController();
  const signal = AbortSignal.any([input.signal, deadline.signal]);
  let onAbort: () => void = () => {};
  const stopped = new Promise<null>((resolve, reject) => {
    onAbort = () => input.signal.aborted ? reject(input.signal.reason) : resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const timer = setTimeout(() => deadline.abort(), input.timeoutMs ?? 5_000);
  try {
    const decision = await Promise.race([
      Promise.resolve().then(() => input.requestDecision(signal))
        .then(parsePdfViewDecision).catch(error => {
          if (error instanceof PdfViewDecisionRequestError) throw error;
          return null;
        }),
      stopped,
    ]);
    input.signal.throwIfAborted();
    // The original PDF and saved/embedded text still accompany the screenshot.
    // Never start unbounded whole-document OCR just because planning was slow.
    return decision ?? { captureView: true, readWholeDocument: false };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
