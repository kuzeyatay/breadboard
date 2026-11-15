"use client";

import { useState } from "react";

/** Inline editor for one assistant answer. Ctrl/Cmd+Enter saves, Escape cancels. */
export default function AssistantResponseEditor({
  content,
  onSave,
  onCancel,
}: {
  content: string;
  /** Resolves false to keep the editor open (the save failed). */
  onSave: (text: string) => boolean | Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);

  async function save() {
    const text = draft.trim();
    if (!text || saving) return;
    if (text === content.trim()) return onCancel();
    setSaving(true);
    const saved = await onSave(text);
    setSaving(false);
    if (saved) onCancel();
  }

  return (
    <form
      className="w-full border-b border-transparent pb-1 focus-within:border-[var(--line-strong)]"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        className="max-h-[60vh] min-h-24 w-full resize-none overflow-y-auto bg-transparent p-0 text-sm leading-7 text-[var(--ink)] outline-none [field-sizing:content]"
        aria-label="Edit assistant response"
        autoFocus
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-full px-3 py-1 text-xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-strong)] disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !draft.trim()}
          className="rounded-full bg-[var(--botanical)] px-3 py-1 text-xs font-medium text-[var(--paper-raised)] transition-[background-color,transform] duration-150 hover:bg-[var(--botanical-hover)] active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)]"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
