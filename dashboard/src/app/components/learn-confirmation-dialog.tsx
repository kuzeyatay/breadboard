"use client";

import { useEffect, useRef } from "react";

export type LearnDestructiveAction = "full_rebuild" | "clear";

interface LearnConfirmationDialogProps {
  action: LearnDestructiveAction;
  onCancel: () => void;
  onConfirm: () => void;
}

const CONTENT = {
  full_rebuild: {
    title: "Rebuild the entire garden?",
    description:
      "This recreates the Learning Map, Learning Unit Contract, all learner pages, and interactive visuals.",
    guidanceLabel: "Before you rebuild",
    guidance:
      "Use Repair issues when only validation errors need to be fixed. Unaffected content is preserved during a repair.",
    confirmLabel: "Rebuild garden",
  },
  clear: {
    title: "Clear all Learn data?",
    description:
      "This permanently removes the Learning Map, Learning Unit Contract, generated learner pages and visuals, validation reports, Learn job history, and snapshots.",
    guidanceLabel: "What stays",
    guidance:
      "Uploaded source documents and notes outside the generated Learning folder will remain. This cannot be undone.",
    confirmLabel: "Clear Learn data",
  },
} satisfies Record<
  LearnDestructiveAction,
  {
    title: string;
    description: string;
    guidanceLabel: string;
    guidance: string;
    confirmLabel: string;
  }
>;

export default function LearnConfirmationDialog({
  action,
  onCancel,
  onConfirm,
}: LearnConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const content = CONTENT[action];

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-[130] flex items-center justify-center px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="learn-confirmation-title"
        aria-describedby="learn-confirmation-description learn-confirmation-guidance"
        className="bb-modal-panel neu-dialog w-full max-w-md overflow-hidden rounded-2xl border bg-[var(--paper-raised)] text-[var(--ink)]"
      >
        <div className="p-6 pb-5">
          <div className="flex items-start gap-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_11%,var(--paper-raised))] text-[var(--danger)]">
              <svg
                className="h-[18px] w-[18px]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v4m0 4h.01M10.3 4.7 2.9 17.5A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-2.5L13.7 4.7a2 2 0 0 0-3.4 0Z"
                />
              </svg>
            </span>
            <div className="min-w-0 pt-0.5">
              <h2
                id="learn-confirmation-title"
                className="text-lg font-semibold leading-6 text-[var(--ink-heading)]"
              >
                {content.title}
              </h2>
              <p
                id="learn-confirmation-description"
                className="mt-2 text-sm leading-6 text-[var(--ink-muted)]"
              >
                {content.description}
              </p>
            </div>
          </div>

          <div
            id="learn-confirmation-guidance"
            className="neu-inset mt-5 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-3 text-sm leading-5 text-[var(--ink-muted)]"
          >
            <p className="font-semibold text-[var(--ink-heading)]">
              {content.guidanceLabel}
            </p>
            <p className="mt-1">{content.guidance}</p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--line)] bg-[var(--paper-surface)] px-6 py-4 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:bg-[var(--paper-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--botanical)] focus:ring-offset-2 focus:ring-offset-[var(--paper-surface)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="neu-button-destructive rounded-lg border border-[var(--danger-hover)] bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-[#fffefb] transition hover:bg-[var(--danger-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--danger)] focus:ring-offset-2 focus:ring-offset-[var(--paper-surface)]"
          >
            {content.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
