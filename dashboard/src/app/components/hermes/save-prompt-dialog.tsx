"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  PROMPT_CATEGORIES,
  savePromptToCatalog,
  suggestedPromptTitle,
} from "@/lib/hermes/prompt-save-client";

export default function SavePromptDialog({
  content,
  onClose,
}: {
  content: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(() => suggestedPromptTitle(content));
  const [category, setCategory] = useState("Custom");
  const [promptContent, setPromptContent] = useState(content);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || saved) return;
    setSaving(true);
    setMessage(null);
    try {
      await savePromptToCatalog({
        title,
        category,
        content: promptContent,
      });
      setSaved(true);
      setMessage("Saved to Prompts.");
      window.dispatchEvent(new CustomEvent("breadboard:prompts-changed"));
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "The prompt could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center bg-[color-mix(in_srgb,var(--ink)_24%,transparent)] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-prompt-title"
        onSubmit={submit}
        className="neu-surface-raised w-full max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] p-5 text-[var(--ink)] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="save-prompt-title"
              className="text-base font-semibold text-[var(--ink-heading)]"
            >
              Save to Prompts
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              Save this message as a reusable prompt in the Prompts tab.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] disabled:opacity-40"
            aria-label="Close save prompt dialog"
          >
            <svg
              aria-hidden
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <label className="mt-5 block text-xs font-medium text-[var(--ink-heading)]">
          Title
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            disabled={saved}
            className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--botanical)] disabled:opacity-60"
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-[var(--ink-heading)]">
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={saved}
            className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--botanical)] disabled:opacity-60"
          >
            {PROMPT_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-xs font-medium text-[var(--ink-heading)]">
          Prompt
          <textarea
            value={promptContent}
            onChange={(event) => setPromptContent(event.target.value)}
            maxLength={50_000}
            rows={7}
            disabled={saved}
            className="mt-1.5 max-h-72 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm leading-6 outline-none focus:border-[var(--botanical)] disabled:opacity-60"
          />
        </label>

        {message ? (
          <p
            role="status"
            className={`mt-3 text-xs ${saved ? "text-[var(--botanical)]" : "text-[var(--danger)]"}`}
          >
            {message}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full border border-[var(--line)] px-4 py-2 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] disabled:opacity-40"
          >
            {saved ? "Close" : "Cancel"}
          </button>
          {!saved ? (
            <button
              type="submit"
              disabled={saving || !title.trim() || !promptContent.trim()}
              className="neu-button-accent rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] px-4 py-2 text-xs font-medium text-[var(--paper-raised)] transition hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)]"
            >
              {saving ? "Saving…" : "Save prompt"}
            </button>
          ) : null}
        </div>
      </form>
    </div>,
    document.body,
  );
}
