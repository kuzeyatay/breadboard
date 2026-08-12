// Composer-side half of the blocking build.
//
// A large document is distilled when it is attached, not when the question is
// asked, so the wait happens while the user is still typing instead of after
// they hit send. The turn path builds too — it has to, since a document can
// reach a turn without ever passing through a composer — but by then the build
// is almost always already cached.
//
// Progress is reported as a sentence rather than a percentage because the
// phases are not comparable: segmenting is instant, twenty chapters are not.

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

function progressSentence(name: string, progress: DocumentSkillProgress): string {
  if (progress.phase === "chapters" && progress.total > 0) {
    return `Distilling ${name}: section ${progress.completed} of ${progress.total}`;
  }
  if (progress.phase === "done") return `${name} is ready to answer from`;
  return `${progress.message} — ${name}`;
}

/**
 * Build the skill for one already-extracted document, reporting progress.
 *
 * Never throws: a document that cannot be distilled still travels with the
 * turn as raw text, so a failure here is a status line, not a lost attachment.
 */
export async function distillDocument(
  attachment: Extract<ChatAttachment, { type: "text" }>,
  options: DistillOptions = {},
): Promise<DistillResult> {
  try {
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
      const payload = (await response.json().catch(() => ({}))) as { error?: string; skipped?: boolean };
      if (payload.skipped) return { slug: null, skipped: true, error: null };
      return { slug: null, skipped: false, error: payload.error ?? "The document could not be distilled" };
    }

    // A skipped document answers as JSON rather than a stream.
    if (!response.headers.get("Content-Type")?.includes("ndjson")) {
      const payload = (await response.json().catch(() => ({}))) as { skipped?: boolean };
      return { slug: null, skipped: Boolean(payload.skipped), error: null };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let slug: string | null = null;
    let error: string | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (event.type === "progress") {
          options.onStatus?.(progressSentence(attachment.name, event as unknown as DocumentSkillProgress));
        } else if (event.type === "done") {
          const skill = event.skill as { slug?: unknown } | undefined;
          slug = typeof skill?.slug === "string" ? skill.slug : null;
          options.onStatus?.(
            event.cached
              ? `${attachment.name} was already distilled`
              : `${attachment.name} is ready to answer from`,
          );
        } else if (event.type === "error") {
          error = typeof event.error === "string" ? event.error : "The document could not be distilled";
        }
      }
    }
    return { slug, skipped: false, error };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      return { slug: null, skipped: true, error: null };
    }
    return {
      slug: null,
      skipped: false,
      error: cause instanceof Error ? cause.message : "The document could not be distilled",
    };
  }
}

/**
 * Distill a garden document the user just selected.
 *
 * Unlike an upload, the browser has no copy of the text — the server reads it
 * from the garden the user is authorized for, so only the two slugs travel.
 * Whether it is large enough to be worth distilling is also decided there.
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
 * Distill every attachment large enough to warrant it, one at a time.
 *
 * Sequential on purpose: each build already runs its chapters concurrently, and
 * two books at once would compete for the same model without finishing either
 * any sooner.
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
