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
    guidance:
      "Use Repair issues when only validation errors need to be fixed. Unaffected content is preserved during a repair.",
    confirmLabel: "Rebuild garden",
  },
  clear: {
    title: "Clear all Learn data?",
    description:
      "This permanently removes the Learning Map, Learning Unit Contract, generated learner pages and visuals, validation reports, Learn job history, and snapshots.",
    guidance:
      "Uploaded sources and notes outside the generated Learning folder will remain. This cannot be undone.",
    confirmLabel: "Clear Learn data",
  },
} satisfies Record<
  LearnDestructiveAction,
  {
    title: string;
    description: string;
    guidance: string;
    confirmLabel: string;
  }
>;

export default function LearnConfirmationDialog({
  action,
  onCancel,
  onConfirm,
}: LearnConfirmationDialogProps) {
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
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancelRef.current();
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
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="learn-confirmation-title"
        aria-describedby="learn-confirmation-description learn-confirmation-guidance"
        className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 p-6 text-gray-100 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-900/80 bg-red-950/40 text-red-300">
            <svg
              className="h-4 w-4"
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
          <div className="min-w-0">
            <h2
              id="learn-confirmation-title"
              className="text-base font-semibold text-white"
            >
              {content.title}
            </h2>
            <p
              id="learn-confirmation-description"
              className="mt-2 text-sm leading-6 text-gray-400"
            >
              {content.description}
            </p>
          </div>
        </div>

        <p
          id="learn-confirmation-guidance"
          className="mt-4 rounded-xl border border-amber-900/60 bg-amber-950/20 px-3 py-2.5 text-xs leading-5 text-amber-200"
        >
          {content.guidance}
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-800 px-4 py-2 text-sm text-gray-300 transition hover:border-gray-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg border border-red-700 bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:border-red-600 hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            {content.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
