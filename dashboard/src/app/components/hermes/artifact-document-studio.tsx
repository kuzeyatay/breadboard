"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import type {
  ArtifactEditorBlock,
  ArtifactEditorMode,
  ArtifactReviewComment,
} from "@/lib/hermes/artifact-editor-types";
import { buildContext, tidy } from "@/vendor/human-review/anchor-text";

interface EditorPayload {
  mode: ArtifactEditorMode;
  artifact: PresentedArtifact;
  content?: string;
  blocks?: ArtifactEditorBlock[];
  truncated?: boolean;
}

interface SelectionDraft {
  target: string;
  quote: string;
  prefix: string;
  suffix: string;
}

interface Props {
  artifact: PresentedArtifact;
  onSaved: (artifact: PresentedArtifact) => void;
  onAskAi: (artifact: PresentedArtifact, prompt: string) => void;
}

function endpoint(artifact: PresentedArtifact): string {
  const query = new URLSearchParams({ conversationId: artifact.conversationId });
  return `/api/hermes/artifacts/${encodeURIComponent(artifact.id)}/edit?${query}`;
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string") {
    return (value as { error: string }).error;
  }
  return fallback;
}

function aiReviewPrompt(
  artifact: PresentedArtifact,
  comments: ArtifactReviewComment[],
  overall: string,
): string {
  const review = comments.map((comment, index) => [
    `${index + 1}. Target: ${comment.target || "document"}`,
    `Quoted text: ${JSON.stringify(comment.quote)}`,
    `Requested change: ${comment.comment}`,
  ].join("\n")).join("\n\n");
  return [
    `Continue editing the existing artifact "${artifact.title}" (artifact ID: ${artifact.id}).`,
    "Read it with artifact_read, apply the review with artifact_update, and preserve its current native format and version history.",
    overall.trim() ? `Overall direction:\n${overall.trim()}` : "",
    review ? `Anchored review comments:\n${review}` : "",
    "For Word, PowerPoint, or XLSX, send only changed anchors as patches. For source-backed documents, render the updated artifact before finishing.",
  ].filter(Boolean).join("\n\n");
}

export default function ArtifactDocumentStudio({ artifact, onSaved, onAskAi }: Props) {
  const [payload, setPayload] = useState<EditorPayload | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [blockText, setBlockText] = useState<Record<string, string>>({});
  const [originalBlocks, setOriginalBlocks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [selection, setSelection] = useState<SelectionDraft | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [comments, setComments] = useState<ArtifactReviewComment[]>([]);
  const [overall, setOverall] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetch(endpoint(artifact), { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(errorMessage(body, "The document editor could not open this artifact."));
        return body as EditorPayload;
      })
      .then((body) => {
        if (cancelled) return;
        const nextContent = body.content ?? "";
        const nextBlocks = Object.fromEntries((body.blocks ?? []).map((block) => [block.anchor, block.text]));
        setPayload(body);
        setContent(nextContent);
        setOriginalContent(nextContent);
        setBlockText(nextBlocks);
        setOriginalBlocks(nextBlocks);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "The editor could not open.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [artifact]);

  const blocks = useMemo(() => payload?.blocks ?? [], [payload?.blocks]);
  const changedPatches = useMemo(
    () => blocks
      .filter((block) => blockText[block.anchor] !== originalBlocks[block.anchor])
      .map((block) => ({ anchor: block.anchor, text: blockText[block.anchor] ?? "" })),
    [blockText, blocks, originalBlocks],
  );
  const dirty = payload
    ? payload.mode === "source" || payload.mode === "file-text"
      ? content !== originalContent
      : changedPatches.length > 0
    : false;
  const visibleBlocks = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return blocks;
    return blocks.filter((block) =>
      `${block.anchor} ${blockText[block.anchor] ?? ""}`.toLowerCase().includes(query),
    );
  }, [blockText, blocks, filter]);

  const captureSelection = useCallback((target: string, text: string, start: number, end: number) => {
    if (start === end) return;
    const context = buildContext(text, Math.min(start, end), Math.max(start, end));
    if (!context.quote.trim()) return;
    setSelection({ target, ...context });
  }, []);

  const addComment = useCallback(() => {
    if (!selection || !commentDraft.trim()) return;
    setComments((current) => [...current, {
      id: crypto.randomUUID(),
      ...selection,
      comment: commentDraft.trim(),
      createdAt: new Date().toISOString(),
    }]);
    setCommentDraft("");
    setSelection(null);
  }, [commentDraft, selection]);

  const save = useCallback(async (): Promise<PresentedArtifact | null> => {
    if (!payload || !dirty || saving) return payload?.artifact ?? null;
    setSaving(true);
    setError("");
    setSavedMessage("");
    try {
      const response = await fetch(endpoint(payload.artifact), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: payload.artifact.version,
          ...(
            payload.mode === "source" || payload.mode === "file-text"
              ? { content }
              : { patches: changedPatches }
          ),
        }),
      });
      const body = await response.json().catch(() => ({})) as { artifact?: PresentedArtifact; error?: string };
      if (!response.ok || !body.artifact) throw new Error(errorMessage(body, "The document could not be saved."));
      const saved = body.artifact;
      setPayload((current) => current ? { ...current, artifact: saved } : current);
      setOriginalContent(content);
      setOriginalBlocks(blockText);
      setSavedMessage(`Saved as version ${saved.version}`);
      onSaved(saved);
      return saved;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The document could not be saved.");
      return null;
    } finally {
      setSaving(false);
    }
  }, [blockText, changedPatches, content, dirty, onSaved, payload, saving]);

  const askAi = useCallback(async () => {
    if (!payload) return;
    const saved = dirty ? await save() : payload.artifact;
    if (!saved) return;
    onAskAi(saved, aiReviewPrompt(saved, comments, overall));
  }, [comments, dirty, onAskAi, overall, payload, save]);

  if (loading) {
    return <div className="grid h-full min-h-[30rem] place-items-center text-sm text-[var(--ink-muted)]">Opening document editor…</div>;
  }
  if (!payload) {
    return <div className="m-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error || "The document editor is unavailable."}</div>;
  }

  const sourceMode = payload.mode === "source" || payload.mode === "file-text";
  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_19rem]" data-artifact-document-studio>
      <section className="flex min-h-0 flex-col border-r border-[var(--line)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--paper-strong)] px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            {sourceMode ? "Document source" : payload.mode === "spreadsheet-cells" ? "Workbook cells" : "Document blocks"}
          </span>
          {!sourceMode ? (
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Find a block or cell"
              className="ml-auto min-w-44 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--botanical)]"
            />
          ) : <span className="flex-1" />}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="neu-button rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save version"}
          </button>
          <button
            type="button"
            onClick={() => void askAi()}
            disabled={saving}
            className="rounded-lg bg-[var(--botanical)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Ask AI to edit
          </button>
        </div>
        {payload.truncated ? (
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            This file is large. The first {blocks.length.toLocaleString()} editable items are shown.
          </p>
        ) : null}
        {error ? <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p> : null}
        {savedMessage ? <p className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{savedMessage}</p> : null}
        {sourceMode ? (
          <textarea
            aria-label="Editable document content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onSelect={(event) => captureSelection("document", content, event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
            spellCheck
            className="min-h-0 flex-1 resize-none bg-[var(--paper-raised)] p-5 font-mono text-sm leading-6 text-[var(--ink)] outline-none"
          />
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[var(--neu-surface-pressed)] p-4">
            {visibleBlocks.map((block) => (
              <label key={block.anchor} className="block rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-3 shadow-sm">
                <span className="mb-2 flex items-center justify-between gap-3 text-[11px] text-[var(--ink-muted)]">
                  <span className="font-mono">{block.anchor}</span>
                  <span>{block.kind}{block.slide ? ` · slide ${block.slide}` : ""}</span>
                </span>
                <textarea
                  value={blockText[block.anchor] ?? ""}
                  onChange={(event) => setBlockText((current) => ({ ...current, [block.anchor]: event.target.value }))}
                  onSelect={(event) => {
                    const value = blockText[block.anchor] ?? "";
                    captureSelection(block.anchor, value, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
                  }}
                  disabled={!block.editable}
                  rows={Math.max(2, Math.min(8, (blockText[block.anchor]?.split("\n").length ?? 1) + 1))}
                  className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm leading-5 outline-none focus:border-[var(--botanical)] disabled:opacity-60"
                />
              </label>
            ))}
          </div>
        )}
      </section>

      <aside className="min-h-0 overflow-auto bg-[var(--paper-surface)] p-4" aria-label="Human review">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Human review</p>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
          Select text to anchor feedback, then send the whole review to the AI in one batch.
        </p>
        {selection ? (
          <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-3">
            <p className="text-[11px] font-medium text-[var(--ink-muted)]">{selection.target}</p>
            <blockquote className="mt-1 border-l-2 border-[var(--botanical)] pl-2 text-xs text-[var(--ink)]">
              {tidy(selection.quote, 160)}
            </blockquote>
            <textarea
              value={commentDraft}
              onChange={(event) => setCommentDraft(event.target.value)}
              placeholder="What should change here?"
              rows={3}
              className="mt-3 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-2.5 py-2 text-xs outline-none focus:border-[var(--botanical)]"
            />
            <button type="button" onClick={addComment} disabled={!commentDraft.trim()} className="mt-2 rounded-lg bg-[var(--ink-heading)] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              Add comment
            </button>
          </div>
        ) : null}
        <label className="mt-4 block text-xs font-medium text-[var(--ink-heading)]">
          Overall direction
          <textarea
            value={overall}
            onChange={(event) => setOverall(event.target.value)}
            placeholder="Tone, structure, facts, audience…"
            rows={4}
            className="mt-1.5 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-2.5 py-2 font-normal outline-none focus:border-[var(--botanical)]"
          />
        </label>
        <div className="mt-4 space-y-2">
          {comments.map((comment) => (
            <div key={comment.id} className="rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-3 text-xs">
              <p className="font-mono text-[10px] text-[var(--ink-muted)]">{comment.target}</p>
              <p className="mt-1 text-[var(--ink-muted)]">“{tidy(comment.quote, 100)}”</p>
              <p className="mt-2 text-[var(--ink)]">{comment.comment}</p>
              <button type="button" onClick={() => setComments((current) => current.filter((entry) => entry.id !== comment.id))} className="mt-2 text-[11px] text-red-600 hover:underline">Remove</button>
            </div>
          ))}
        </div>
        <p className="mt-5 border-t border-[var(--line)] pt-3 text-[10px] leading-4 text-[var(--ink-muted)]">
          Review anchoring adapted from human-review by Peter Yang (MIT).
        </p>
      </aside>
    </div>
  );
}
