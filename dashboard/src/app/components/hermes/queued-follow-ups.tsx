"use client";

// Messages typed while a conversation is still working. Every chat surface
// funnels its composer's mid-run sends here instead of dropping them: the
// message joins a visible queue above the composer, can be edited, reordered,
// deleted, or — while a steerable chat turn is active — applied to the working
// response as a course correction. Whatever is still queued when the run
// settles is sent as ordinary follow-up messages, oldest first.
//
// Extracted from the agent runtime panel so the garden workspace chat, the
// garden assistant, and the knowledge terminal queue and steer exactly the way
// the dashboard terminal does.

import { useEffect, useState, type ReactNode } from "react";

export interface QueuedFollowUp {
  id: string;
  text: string;
  /**
   * Conversation the message was queued in; null while the chat is a draft
   * with no id yet. Queued messages only render and flush in their own
   * conversation — switching chats holds them rather than sending them into
   * the wrong transcript. A null tag belongs to whichever conversation the
   * draft became, so it matches wherever the queue drains.
   */
  conversationKey: string | null;
}

export function reorderQueuedFollowUps(
  items: QueuedFollowUp[],
  sourceId: string,
  targetId: string,
): QueuedFollowUp[] {
  if (sourceId === targetId) return items;
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return items;

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

interface Options {
  /** The active conversation; null while the chat is an unsaved draft. */
  conversationKey: string | null;
  /** Anything still working on this conversation holds the queue. */
  runInFlight: boolean;
  /** A chat turn that can take a mid-run correction is active. */
  steerableRunActive: boolean;
  /** The active run is being stopped; steering it would race the stop. */
  stopping?: boolean;
  /**
   * An external agent run is holding the queue. Only used to explain why the
   * Steer control is unavailable: an agent card owns its own run, so the
   * queued message waits for it rather than trying to redirect it.
   */
  externalRunActive?: boolean;
  /**
   * Apply one queued message to the active response as a course correction.
   * Resolves false when the run ended first; the message stays queued and
   * sends when the queue drains. Omitted on surfaces that cannot steer.
   */
  onSteer?: (text: string) => Promise<boolean>;
  /** Send one queued message as an ordinary follow-up once the run settles. */
  onSendQueued: (text: string) => Promise<void>;
}

export function useQueuedFollowUps({
  conversationKey,
  runInFlight,
  steerableRunActive,
  stopping = false,
  externalRunActive = false,
  onSteer,
  onSendQueued,
}: Options): {
  queueFollowUp: (text: string) => void;
  headerContent: ReactNode | undefined;
} {
  const [queuedFollowUps, setQueuedFollowUps] = useState<QueuedFollowUp[]>([]);
  const [applyingSteerId, setApplyingSteerId] = useState<string | null>(null);
  const [sendingQueuedId, setSendingQueuedId] = useState<string | null>(null);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const [queuedEditText, setQueuedEditText] = useState("");
  const [draggedQueuedId, setDraggedQueuedId] = useState<string | null>(null);
  const [dragOverQueuedId, setDragOverQueuedId] = useState<string | null>(null);

  const visibleQueued = queuedFollowUps.filter(
    (item) =>
      item.conversationKey === null ||
      item.conversationKey === conversationKey,
  );

  useEffect(() => {
    if (runInFlight || applyingSteerId || sendingQueuedId) return;
    const next = queuedFollowUps.find(
      (item) =>
        item.conversationKey === null ||
        item.conversationKey === conversationKey,
    );
    if (!next) return;
    setQueuedFollowUps((current) =>
      current.filter((item) => item.id !== next.id),
    );
    setSendingQueuedId(next.id);
    void onSendQueued(next.text).finally(() => setSendingQueuedId(null));
  }, [
    applyingSteerId,
    conversationKey,
    onSendQueued,
    queuedFollowUps,
    runInFlight,
    sendingQueuedId,
  ]);

  function queueFollowUp(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setQueuedFollowUps((current) => [
      ...current,
      { id: crypto.randomUUID(), text: trimmed, conversationKey },
    ]);
  }

  async function applyQueuedSteer(item: QueuedFollowUp) {
    if (!onSteer || !steerableRunActive || applyingSteerId) return;
    setApplyingSteerId(item.id);
    try {
      if (await onSteer(item.text)) {
        setQueuedFollowUps((current) =>
          current.filter((candidate) => candidate.id !== item.id),
        );
      }
    } catch {
      // The run may have ended first, or the steer request failed; either way
      // the message stays queued and sends when the queue drains.
    } finally {
      setApplyingSteerId(null);
    }
  }

  function beginQueuedEdit(item: QueuedFollowUp) {
    setEditingQueuedId(item.id);
    setQueuedEditText(item.text);
  }

  function saveQueuedEdit(itemId: string) {
    const text = queuedEditText.trim();
    if (!text) return;
    setQueuedFollowUps((current) =>
      current.map((item) => (item.id === itemId ? { ...item, text } : item)),
    );
    setEditingQueuedId(null);
    setQueuedEditText("");
  }

  function moveQueuedFollowUp(itemId: string, offset: -1 | 1) {
    const currentIndex = visibleQueued.findIndex((item) => item.id === itemId);
    const target = visibleQueued[currentIndex + offset];
    if (currentIndex < 0 || !target) return;
    setQueuedFollowUps((current) =>
      reorderQueuedFollowUps(current, itemId, target.id),
    );
  }

  function finishQueuedDrop(targetId: string) {
    if (draggedQueuedId) {
      setQueuedFollowUps((current) =>
        reorderQueuedFollowUps(current, draggedQueuedId, targetId),
      );
    }
    setDraggedQueuedId(null);
    setDragOverQueuedId(null);
  }

  const canSteerNow = Boolean(onSteer) && steerableRunActive && !stopping;

  const headerContent =
    visibleQueued.length > 0 ? (
      <div className="space-y-0.5 py-0.5">
        {visibleQueued.map((item, index) => (
          <div
            key={item.id}
            onDragOver={(event) => {
              if (!draggedQueuedId || draggedQueuedId === item.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverQueuedId(item.id);
            }}
            onDragLeave={() =>
              setDragOverQueuedId((current) =>
                current === item.id ? null : current,
              )
            }
            onDrop={(event) => {
              event.preventDefault();
              finishQueuedDrop(item.id);
            }}
            className={`flex min-h-9 items-center gap-2 rounded-xl px-2 text-sm text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] ${
              dragOverQueuedId === item.id
                ? "bg-[var(--paper-strong)] ring-1 ring-inset ring-[var(--line-strong)]"
                : ""
            }`}
          >
            <button
              type="button"
              draggable={editingQueuedId !== item.id}
              onDragStart={(event) => {
                setDraggedQueuedId(item.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
              }}
              onDragEnd={() => {
                setDraggedQueuedId(null);
                setDragOverQueuedId(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" && index > 0) {
                  event.preventDefault();
                  moveQueuedFollowUp(item.id, -1);
                } else if (
                  event.key === "ArrowDown" &&
                  index < visibleQueued.length - 1
                ) {
                  event.preventDefault();
                  moveQueuedFollowUp(item.id, 1);
                }
              }}
              className="grid h-7 w-7 shrink-0 cursor-grab place-items-center rounded-lg opacity-70 transition hover:bg-[var(--paper-surface)] hover:opacity-100 active:cursor-grabbing"
              aria-label={`Reorder queued message ${index + 1} of ${visibleQueued.length}: ${item.text}. Drag, or use the Up and Down arrow keys.`}
              title="Drag to change steering order"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h8.5a2 2 0 0 1 2 2v.75m0 0-2.25-2.25m2.25 2.25L15 12.5" />
              </svg>
            </button>
            {editingQueuedId === item.id ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveQueuedEdit(item.id);
                }}
              >
                <input
                  value={queuedEditText}
                  onChange={(event) => setQueuedEditText(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1 text-sm text-[var(--ink)] outline-none focus:border-[var(--line-strong)]"
                  aria-label="Edit queued message"
                  autoFocus
                />
                <button type="submit" className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)] hover:bg-[var(--paper-surface)]">
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingQueuedId(null)}
                  className="rounded-lg px-2 py-1 text-xs hover:bg-[var(--paper-surface)]"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate" title={item.text}>
                  {item.text}
                </span>
                <button
                  type="button"
                  onClick={() => void applyQueuedSteer(item)}
                  disabled={Boolean(applyingSteerId) || !canSteerNow}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm transition hover:bg-[var(--paper-surface)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Steer the active response with: ${item.text}`}
                  title={
                    canSteerNow
                      ? "Steer the active response"
                      : externalRunActive
                        // Only a chat turn can take a mid-run correction; an
                        // agent run is steered by its own card, so this
                        // message waits its turn.
                        ? "This agent run cannot be steered — the message sends when it finishes"
                        : !onSteer
                          ? "This conversation cannot steer a working answer — the message sends when it finishes"
                          : "Nothing is running to steer"
                  }
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.7}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 8.25H9.75a4.5 4.5 0 0 0-4.5 4.5v.75m0 0 3-3m-3 3 3 3"
                    />
                  </svg>
                  <span>
                    {applyingSteerId === item.id ? "Steering..." : "Steer"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setQueuedFollowUps((current) =>
                      current.filter((candidate) => candidate.id !== item.id),
                    )
                  }
                  disabled={applyingSteerId === item.id}
                  className="rounded-lg p-1.5 transition hover:bg-[var(--paper-surface)] hover:text-[var(--ink)] disabled:opacity-40"
                  aria-label={`Delete queued message: ${item.text}`}
                  title="Delete queued message"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 7.5h15m-9-3h3m-7.5 3 .75 12h10.5l.75-12M9.75 10.5v6m4.5-6v6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => beginQueuedEdit(item)}
                  disabled={applyingSteerId === item.id}
                  className="rounded-lg p-1.5 transition hover:bg-[var(--paper-surface)] hover:text-[var(--ink)] disabled:opacity-40"
                  aria-label={`Edit queued message: ${item.text}`}
                  title="Edit queued message"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Z" />
                  </svg>
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    ) : undefined;

  return { queueFollowUp, headerContent };
}
