"use client";

// The board: Kaneo's columns and cards in Breadboard's paper-and-shadow style.
//
// Drag and drop is the browser's own HTML5 drag, not a library. A card carries
// its id in the drag payload; every card and every column body works out the
// slot the pointer is currently over, and the insertion line is drawn there.
// That keeps the whole interaction to one piece of state and no dependencies.

import { useState } from "react";

import type { PlanBoard, PlanTask, TaskPriority } from "@/lib/plan/types.ts";

interface DropTarget {
  columnId: number;
  index: number;
}

interface Props {
  board: PlanBoard;
  today: string;
  busyTaskIds: ReadonlySet<number>;
  selectedTaskId: number | null;
  onMoveTask: (taskId: number, columnId: number, position: number) => void;
  onOpenTask: (taskId: number) => void;
  onCreateTask: (columnId: number, title: string) => void;
}

/** Priority reads as a small coloured bar, not a word: the board is scanned. */
const PRIORITY_STYLE: Record<TaskPriority, { label: string; color: string }> = {
  urgent: { label: "Urgent", color: "var(--danger)" },
  high: { label: "High", color: "#b5743a" },
  medium: { label: "Medium", color: "#7b97aa" },
  low: { label: "Low", color: "#6e8f87" },
};

const SOURCE_LABEL: Record<string, string> = {
  agent_run: "agent",
  schedule: "scheduled",
  assistant: "assistant",
};

function dueClass(task: PlanTask, today: string): string {
  if (!task.dueDate || task.completedAt) return "text-gray-500";
  if (task.dueDate < today) return "text-red-400";
  if (task.dueDate === today) return "text-amber-400";
  return "text-gray-500";
}

function formatDue(date: string, today: string): string {
  if (date === today) return "Today";
  const [year, month, day] = date.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const label = `${Number(day)} ${months[Number(month) - 1]}`;
  return year === today.slice(0, 4) ? label : `${label} ${year}`;
}

export default function PlanBoard({
  board,
  today,
  busyTaskIds,
  selectedTaskId,
  onMoveTask,
  onOpenTask,
  onCreateTask,
}: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [composerColumn, setComposerColumn] = useState<number | null>(null);
  const [composerTitle, setComposerTitle] = useState("");

  function endDrag() {
    setDragging(null);
    setTarget(null);
  }

  function drop(columnId: number) {
    if (dragging === null) return;
    const index = target?.columnId === columnId ? target.index : Number.MAX_SAFE_INTEGER;
    onMoveTask(dragging, columnId, index);
    endDrag();
  }

  function submitComposer(columnId: number) {
    const title = composerTitle.trim();
    if (title) onCreateTask(columnId, title);
    setComposerTitle("");
    // Stay open: adding cards is usually done in a burst.
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 py-4">
      {board.columns.map((column) => {
        const isTarget = target?.columnId === column.id;
        return (
          <section
            key={column.id}
            className="neu-surface-subtle flex max-h-full min-h-0 w-72 shrink-0 flex-col rounded-xl border"
            onDragOver={(event) => {
              event.preventDefault();
              if (dragging !== null && !isTarget) {
                setTarget({ columnId: column.id, index: column.tasks.length });
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              drop(column.id);
            }}
          >
            <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: column.color }}
                aria-hidden="true"
              />
              <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                {column.name}
              </h2>
              <span className="shrink-0 text-xs tabular-nums text-gray-500">
                {column.tasks.length}
              </span>
            </header>

            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2 pt-1">
              {column.tasks.map((task, index) => {
                const busy = busyTaskIds.has(task.id);
                const showLineBefore = isTarget && target.index === index;
                return (
                  <div key={task.id}>
                    {showLineBefore && <DropLine />}
                    <article
                      draggable={!busy}
                      onDragStart={(event) => {
                        setDragging(task.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(task.id));
                      }}
                      onDragEnd={endDrag}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (dragging === null) return;
                        // Above the midpoint means "insert before me", below
                        // means "after" — the usual list-drop convention.
                        const box = event.currentTarget.getBoundingClientRect();
                        const after = event.clientY > box.top + box.height / 2;
                        const slot = index + (after ? 1 : 0);
                        if (target?.columnId !== column.id || target.index !== slot) {
                          setTarget({ columnId: column.id, index: slot });
                        }
                      }}
                      onClick={() => onOpenTask(task.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenTask(task.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${task.ref} ${task.title}`}
                      className={`neu-surface-raised cursor-grab rounded-lg border px-2.5 py-2 text-left transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] ${
                        dragging === task.id ? "opacity-50" : ""
                      } ${busy ? "pointer-events-none opacity-60" : ""} ${
                        selectedTaskId === task.id ? "neu-selected" : ""
                      }`}
                      style={{
                        borderLeft: `3px solid ${PRIORITY_STYLE[task.priority].color}`,
                      }}
                    >
                      <p
                        className={`text-sm leading-5 text-white ${
                          task.completedAt ? "line-through opacity-70" : ""
                        }`}
                      >
                        {task.title}
                      </p>

                      {task.labels.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {task.labels.map((label) => (
                            <span
                              key={label.id}
                              className="rounded-full px-1.5 py-px text-[10px] leading-4"
                              style={{
                                backgroundColor: `color-mix(in srgb, ${label.color} 24%, var(--paper-raised))`,
                                color: "var(--ink)",
                              }}
                            >
                              {label.name}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-500">
                        <span className="tabular-nums">{task.ref}</span>
                        {task.dueDate && (
                          <span className={dueClass(task, today)}>
                            {formatDue(task.dueDate, today)}
                          </span>
                        )}
                        {task.commentCount > 0 && <span>{task.commentCount}c</span>}
                        {task.source !== "manual" && (
                          <span
                            className="ml-auto rounded px-1 py-px"
                            style={{
                              backgroundColor:
                                "color-mix(in srgb, var(--botanical) 16%, transparent)",
                            }}
                            title="Filed by breadboard, not typed by you"
                          >
                            {SOURCE_LABEL[task.source] ?? task.source}
                          </span>
                        )}
                      </div>
                    </article>
                  </div>
                );
              })}

              {isTarget && target.index >= column.tasks.length && <DropLine />}

              {composerColumn === column.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitComposer(column.id);
                  }}
                >
                  <textarea
                    autoFocus
                    value={composerTitle}
                    onChange={(event) => setComposerTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        submitComposer(column.id);
                      }
                      if (event.key === "Escape") {
                        setComposerColumn(null);
                        setComposerTitle("");
                      }
                    }}
                    onBlur={() => {
                      if (!composerTitle.trim()) setComposerColumn(null);
                    }}
                    rows={2}
                    placeholder="What needs doing?"
                    className="neu-control w-full resize-none rounded-lg border px-2.5 py-2 text-sm text-white placeholder:text-gray-600"
                  />
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setComposerColumn(column.id);
                    setComposerTitle("");
                  }}
                  className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-gray-500 transition-colors hover:text-white"
                >
                  + Add card
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Where the dragged card would land. */
function DropLine() {
  return (
    <div
      className="my-0.5 h-0.5 rounded-full"
      style={{ backgroundColor: "var(--botanical)" }}
      aria-hidden="true"
    />
  );
}
