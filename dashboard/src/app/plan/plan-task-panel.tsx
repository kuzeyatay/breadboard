"use client";

// The card detail: a right-hand drawer rather than a modal, so the board stays
// visible and a reader can move between cards without the page flashing.
//
// Every field saves on blur or on change — there is no Save button, because a
// board is edited in small nudges and a form that has to be submitted turns each
// nudge into a decision.

import { useEffect, useState } from "react";

import type {
  PlanColumn,
  PlanComment,
  PlanLabel,
  PlanTask,
  PlanTaskRelation,
  TaskPriority,
} from "@/lib/plan/types.ts";
import { TASK_PRIORITIES } from "@/lib/plan/types.ts";

interface Props {
  task: PlanTask;
  columns: readonly PlanColumn[];
  labels: readonly PlanLabel[];
  comments: readonly PlanComment[];
  relations: readonly PlanTaskRelation[];
  saving: boolean;
  error: string | null;
  onPatch: (patch: Record<string, unknown>) => void;
  onMove: (columnId: number) => void;
  onComment: (content: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function PlanTaskPanel({
  task,
  columns,
  labels,
  comments,
  relations,
  saving,
  error,
  onPatch,
  onMove,
  onComment,
  onDelete,
  onClose,
}: Props) {
  // Seeded from the card, then owned by the reader while they type. Switching
  // to another card resets these because the parent keys this component by task
  // id, which remounts it — the React-recommended way to reset state on a prop
  // change, and cheaper than syncing four fields in an effect.
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [comment, setComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const labelIds = new Set(task.labels.map((label) => label.id));

  function toggleLabel(labelId: number) {
    const next = new Set(labelIds);
    if (next.has(labelId)) next.delete(labelId);
    else next.add(labelId);
    onPatch({ labelIds: [...next] });
  }

  return (
    <aside className="bb-neu-sidebar-right flex w-[22rem] shrink-0 flex-col overflow-y-auto border-l">
      <header className="flex items-center gap-2 px-4 py-3">
        {task.completedAt && (
          <span
            className="rounded px-1.5 py-px text-[10px]"
            style={{ backgroundColor: "color-mix(in srgb, var(--botanical) 20%, transparent)" }}
          >
            Done
          </span>
        )}
        {saving && <span className="text-[11px] text-gray-500">Saving…</span>}
        <button
          type="button"
          onClick={onClose}
          className="neu-button-icon ml-auto rounded-lg border px-2 py-1 text-xs text-gray-400"
          aria-label="Close"
          title="Close (Esc)"
        >
          ×
        </button>
      </header>

      {error && <p className="px-4 pb-2 text-xs text-red-400">{error}</p>}

      <div className="space-y-4 px-4 pb-6">
        <textarea
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next && next !== task.title) onPatch({ title: next });
            else setTitle(task.title);
          }}
          rows={2}
          className="neu-control w-full resize-none rounded-lg border px-3 py-2 text-sm font-medium text-white"
          aria-label="Title"
        />

        <div className="grid grid-cols-2 gap-2">
          <Field label="Column">
            <select
              value={task.columnId}
              onChange={(event) => onMove(Number(event.target.value))}
              className="neu-control w-full rounded-lg border px-2 py-1.5 text-xs text-white"
            >
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Priority">
            <select
              value={task.priority}
              onChange={(event) =>
                onPatch({ priority: event.target.value as TaskPriority })
              }
              className="neu-control w-full rounded-lg border px-2 py-1.5 text-xs text-white"
            >
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Start">
            <input
              type="date"
              value={task.startDate ?? ""}
              onChange={(event) => onPatch({ startDate: event.target.value || null })}
              className="neu-control w-full rounded-lg border px-2 py-1.5 text-xs text-white"
            />
          </Field>

          <Field label="Due">
            <input
              type="date"
              value={task.dueDate ?? ""}
              onChange={(event) => onPatch({ dueDate: event.target.value || null })}
              className="neu-control w-full rounded-lg border px-2 py-1.5 text-xs text-white"
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => {
              if (description !== (task.description ?? "")) {
                onPatch({ description: description || null });
              }
            }}
            rows={5}
            placeholder="Anything worth remembering about this."
            className="neu-control w-full resize-y rounded-lg border px-3 py-2 text-xs text-gray-300 placeholder:text-gray-600"
          />
        </Field>

        {labels.length > 0 && (
          <Field label="Labels">
            <div className="flex flex-wrap gap-1.5">
              {labels.map((label) => {
                const on = labelIds.has(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => toggleLabel(label.id)}
                    aria-pressed={on}
                    className="rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                    style={{
                      borderColor: on ? label.color : "var(--neu-border)",
                      backgroundColor: on
                        ? `color-mix(in srgb, ${label.color} 24%, var(--paper-raised))`
                        : "transparent",
                      color: on ? "var(--ink)" : "var(--ink-muted)",
                    }}
                  >
                    {label.name}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {task.sourceUrl && (
          <Field label="Filed by breadboard">
            <a
              href={task.sourceUrl}
              className="block truncate text-xs underline"
              style={{ color: "var(--botanical)" }}
            >
              Open what this is tracking
            </a>
          </Field>
        )}

        {relations.length > 0 && (
          <Field label="Links">
            <ul className="space-y-1">
              {relations.map((relation) => (
                <li key={relation.id} className="truncate text-xs text-gray-400">
                  <span className="text-gray-500">
                    {relation.relationType.replace("_", " ")}
                  </span>{" "}
                  {relation.relatedTitle}
                </li>
              ))}
            </ul>
          </Field>
        )}

        <Field label={`Comments${comments.length ? ` (${comments.length})` : ""}`}>
          <ul className="space-y-2">
            {comments.map((entry) => (
              <li
                key={entry.id}
                className="neu-surface-subtle rounded-lg border px-2.5 py-2 text-xs"
              >
                <span
                  className="mb-0.5 block text-[10px] uppercase tracking-wider text-gray-500"
                >
                  {entry.author === "assistant" ? "Assistant" : "You"}
                </span>
                <span className="whitespace-pre-wrap text-gray-300">{entry.content}</span>
              </li>
            ))}
          </ul>
          <form
            className="mt-2"
            onSubmit={(event) => {
              event.preventDefault();
              const text = comment.trim();
              if (!text) return;
              onComment(text);
              setComment("");
            }}
          >
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              placeholder="Add a note…"
              className="neu-control w-full resize-none rounded-lg border px-3 py-2 text-xs text-gray-300 placeholder:text-gray-600"
            />
          </form>
        </Field>

        <div className="pt-2">
          {confirmDelete ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="neu-button flex-1 rounded-lg border px-3 py-1.5 text-xs text-gray-400"
              >
                Keep
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="neu-button-destructive flex-1 rounded-lg border px-3 py-1.5 text-xs"
              >
                Delete for good
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-gray-600 transition-colors hover:text-red-400"
            >
              Delete this card
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-gray-500">
        {label}
      </span>
      {children}
    </div>
  );
}
