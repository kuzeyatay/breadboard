"use client";

// "This event / This and following / All events".
//
// The question every calendar has to ask before touching a repeating event, and
// the one place a wrong default is expensive: defaulting to the whole series
// would let a drag of one Tuesday silently move every Tuesday. So the dialog
// opens on "This event" and the caller cannot proceed without an answer.

import { useEffect, useState } from "react";

import type { SeriesScope } from "@/lib/calendar/types.ts";

export interface ScopePrompt {
  /** What the confirmed scope will be applied to. */
  intent: "edit" | "delete" | "move";
  title: string;
  /** Rendered under the heading — what specifically is changing. */
  detail?: string;
  onConfirm: (scope: SeriesScope) => void;
}

const OPTIONS: { value: SeriesScope; label: string; hint: string }[] = [
  {
    value: "instance",
    label: "This event",
    hint: "Only the occurrence you picked. The rest of the series is untouched.",
  },
  {
    value: "following",
    label: "This and following events",
    hint: "Splits the series here. Earlier occurrences keep their current details.",
  },
  {
    value: "series",
    label: "All events",
    hint: "Every occurrence, including ones already changed on their own.",
  },
];

export default function CalendarScopeDialog({
  prompt,
  onClose,
}: {
  prompt: ScopePrompt;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<SeriesScope>("instance");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const verb =
    prompt.intent === "delete" ? "Delete" : prompt.intent === "move" ? "Move" : "Save";

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${verb} repeating event`}
        className="bb-modal-panel neu-dialog w-full max-w-md rounded-2xl border p-6"
      >
        <h2 className="text-lg font-semibold text-white">
          {verb} repeating event
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          “{prompt.title}” repeats.{prompt.detail ? ` ${prompt.detail}` : ""}
        </p>

        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">Which occurrences to change</legend>
          {OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                scope === option.value ? "neu-selected" : "neu-surface-subtle"
              }`}
            >
              <input
                type="radio"
                name="series-scope"
                value={option.value}
                checked={scope === option.value}
                onChange={() => setScope(option.value)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--botanical)]"
              />
              <span className="min-w-0">
                <span className="block text-sm text-white">{option.label}</span>
                <span className="block text-xs text-gray-500">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="neu-button flex-1 rounded-lg border py-2.5 text-sm text-gray-400"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => prompt.onConfirm(scope)}
            className={`flex-1 rounded-lg border py-2.5 text-sm font-medium ${
              prompt.intent === "delete" ? "neu-button-destructive" : "neu-button-accent"
            }`}
          >
            {verb}
          </button>
        </div>
      </div>
    </div>
  );
}
