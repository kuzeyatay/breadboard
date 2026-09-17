"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bookmark, Check, Copy, Pencil, Trash2 } from "lucide-react";
import { useConfirmDialog } from "@/app/components/confirm-dialog";
import SavePromptDialog from "@/app/components/hermes/save-prompt-dialog";

const buttonClass = "rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)] disabled:cursor-not-allowed disabled:opacity-35";

export default function UserMessageControls({
  content,
  disabled = false,
  onEdit,
  onDelete,
  children,
}: {
  content: string;
  disabled?: boolean;
  onEdit: (text: string) => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
  }, []);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1_600);
    } catch {
      // Do not report success when clipboard access was denied.
    }
  }

  function saveEdit() {
    const text = draft.trim();
    if (!text || disabled) return;
    setEditing(false);
    onEdit(text);
  }

  async function deleteMessage() {
    if (disabled) return;
    if (await confirm({
      title: "Delete this message?",
      body: "The message and the answer it produced will be permanently removed from this chat. This cannot be undone.",
      confirmLabel: "Delete message",
    })) onDelete();
  }

  return (
    <div className="group/user-message flex w-full min-w-0 flex-col items-end" data-editing={editing}>
      {editing ? (
        <div className="neu-chat-message neu-chat-message-user w-full min-w-0 rounded-[22px] p-3">
          <textarea
            autoFocus
            aria-label="Edit message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); setEditing(false); }
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                saveEdit();
              }
            }}
            rows={3}
            className="block max-h-[60vh] min-h-24 w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-sm leading-6 text-[var(--ink)] outline-none [field-sizing:content]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="rounded-full px-3 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]">Cancel</button>
            <button type="button" onClick={saveEdit} disabled={disabled || !draft.trim()} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] px-3 text-xs font-medium text-[var(--paper-raised)] shadow-sm transition-colors hover:bg-[var(--botanical-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)] disabled:shadow-none">
              <span>Save &amp; send</span>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 0-6 6m6-6 6 6" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <>
          {children}
          <div aria-label="Sent message actions" className="mt-1 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover/user-message:opacity-100 group-focus-within/user-message:opacity-100 [@media(hover:none)]:opacity-100">
            <button type="button" onClick={() => void copyMessage()} className={buttonClass} title={copied ? "Copied" : "Copy message"} aria-label={copied ? "Message copied" : "Copy message"}>
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            </button>
            <button type="button" onClick={() => setSavingPrompt(true)} className={buttonClass} title="Save to Prompts" aria-label="Save message to Prompts">
              <Bookmark className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={() => { setDraft(content); setEditing(true); }} disabled={disabled} className={buttonClass} title="Edit message" aria-label="Edit message and create a branch">
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={() => void deleteMessage()} disabled={disabled} className={`${buttonClass} hover:text-[var(--danger)]`} title="Delete message" aria-label="Delete this message and its answer">
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </>
      )}
      {savingPrompt ? <SavePromptDialog content={content} onClose={() => setSavingPrompt(false)} /> : null}
      {confirmDialog}
    </div>
  );
}
