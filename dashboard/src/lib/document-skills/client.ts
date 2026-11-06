// Composer-side preparation of exact, indexed document text.
//
// Preparation stores readable chunks without model calls. The turn path also
// prepares sources, so attachments remain usable if this early request fails.
// Function names remain compatible with existing composer integrations.

import { shouldDistill } from "./planning.ts";
import type { ChatAttachment } from "../chat-attachments.ts";
import type { DocumentSkillProgress } from "./types.ts";

export interface DistillOptions {
  /** Set when the document belongs to a garden rather than a chat upload. */
  clusterSlug?: string;
  documentSlug?: string;
  onStatus?: (status: string) => void;
  signal?: AbortSignal;
}

export interface DistillResult {
  slug: string | null;
  skipped: boolean;
  error: string | null;
}

const MAX_CONNECTION_ATTEMPTS = 3;
const CONNECTION_ERROR =
  "The connection was interrupted while preparing this document. The document is still available; select it again to reconnect.";

function retryDelay(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 1_000);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function progressSentence(name: string, progress: DocumentSkillProgress): string {
  if (progress.phase === "chapters" && progress.total > 0) {
    return `Distilling ${name}: section ${progress.completed} of ${progress.total}`;
  }
  if (progress.phase === "done") return `${name} is ready to answer from`;
  return `${progress.message} — ${name}`;
}

/**
 * Prepare one already-extracted document, reporting progress.
 *
 * Never throws: a document that cannot be prepared still travels with the
 * turn as raw text, so a failure here is a status line, not a lost attachment.
 */
export async function distillDocument(
  attachment: Extract<ChatAttachment, { type: "text" }>,
  options: DistillOptions = {},
): Promise<DistillResult> {
  for (let attempt = 0; attempt < MAX_CONNECTION_ATTEMPTS; attempt++) {
    try {
      options.signal?.throwIfAborted();
      if (attempt > 0) {
        options.onStatus?.(`Reconnecting to ${attachment.name}…`);
        await retryDelay(options.signal);
      }
      const response = await fetch("/api/document-skills/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Omitted entirely for a garden document: an empty string would read as
          // "the browser has the text and it is blank" rather than "read it".
          ...(attachment.text ? { text: attachment.text } : {}),
          fileName: attachment.name,
          ...(options.clusterSlug ? { clusterSlug: options.clusterSlug } : {}),
          ...(options.documentSlug ? { documentSlug: options.documentSlug } : {}),
        }),
        signal: options.signal,
      });

      if (!response.ok || !response.body) {
        if ([502, 503, 504].includes(response.status)) {
          await response.body?.cancel();
          throw new Error(CONNECTION_ERROR);
        }
        const payload = (await response.json().catch(() => ({}))) as { error?: string; skipped?: boolean };
        if (payload.skipped) return { slug: null, skipped: true, error: null };
        return { slug: null, skipped: false, error: payload.error ?? "The document could not be prepared" };
      }

      // A skipped document answers as JSON rather than a stream.
      if (!response.headers.get("Content-Type")?.includes("ndjson")) {
        const payload = (await response.json().catch(() => ({}))) as { skipped?: boolean };
        if (payload.skipped === true) return { slug: null, skipped: true, error: null };
        throw new Error(CONNECTION_ERROR);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handleLine = (line: string): DistillResult | null => {
        if (!line.trim()) return null;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
        if (event.type === "progress") {
          options.onStatus?.(progressSentence(attachment.name, event as unknown as DocumentSkillProgress));
        } else if (event.type === "done") {
          const skill = event.skill as { slug?: unknown } | undefined;
          if (typeof skill?.slug !== "string" || !skill.slug) throw new Error(CONNECTION_ERROR);
          options.onStatus?.(
            event.cached
              ? `${attachment.name} is ready to answer from`
              : `${attachment.name} is ready to answer from`,
          );
          return { slug: skill.slug, skipped: false, error: null };
        } else if (event.type === "error") {
          return {
            slug: null, skipped: false,
            error: typeof event.error === "string" ? event.error : "The document could not be prepared",
          };
        }
        return null;
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            const result = handleLine(buffer + decoder.decode());
            if (result) return result;
            // EOF is not completion. Rejoin the existing server build/cache.
            throw new Error(CONNECTION_ERROR);
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const result = handleLine(line);
            if (result) return result;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (cause) {
      if (options.signal?.aborted || (cause instanceof DOMException && cause.name === "AbortError")) {
        return { slug: null, skipped: true, error: null };
      }
      if (attempt === MAX_CONNECTION_ATTEMPTS - 1) {
        return { slug: null, skipped: false, error: CONNECTION_ERROR };
      }
    }
  }
  return { slug: null, skipped: false, error: CONNECTION_ERROR };
}

/**
 * Index a garden document the user just selected.
 *
 * Unlike an upload, the browser has no copy of the text — the server reads it
 * from the garden the user is authorized for, so only the two slugs travel.
 * Whether it is large enough to be worth indexing is also decided there.
 */
export async function distillGardenDocumentSkill(
  clusterSlug: string,
  documentSlug: string,
  label: string,
  options: Pick<DistillOptions, "onStatus" | "signal"> = {},
): Promise<DistillResult> {
  return distillDocument(
    { type: "text", text: "", name: label },
    { ...options, clusterSlug, documentSlug },
  );
}

/**
 * Index every attachment large enough to warrant it, one at a time.
 *
 * Each request only stores exact text; no model processing is involved.
 */
export async function distillAttachments(
  attachments: readonly ChatAttachment[],
  options: DistillOptions = {},
): Promise<string[]> {
  const errors: string[] = [];
  for (const attachment of attachments) {
    if (attachment.type !== "text" || !shouldDistill(attachment.text)) continue;
    const result = await distillDocument(attachment, options);
    if (result.error) errors.push(`${attachment.name}: ${result.error}`);
  }
  return errors;
}
