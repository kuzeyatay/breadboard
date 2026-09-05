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

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { ChatAttachment } from "@/lib/chat-attachments.ts";

export interface QueuedFollowUp {
  id: string;
  text: string;
  /** Files are part of the queued message, not leftovers in the composer. */
  attachments: ChatAttachment[];
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

/** Put a queued message back where it was originally composed. */
export function restoreQueuedFollowUpDraft(
  text: string,
  onChange: (value: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): void {
  onChange(text);
  window.requestAnimationFrame(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(text.length, text.length);
  });
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
  onSteer?: (
    text: string,
    attachments: readonly ChatAttachment[],
  ) => Promise<boolean>;
  /** Remove a queued message and restore all of it to this surface's composer. */
  onRestoreDraft: (
    text: string,
    attachments: readonly ChatAttachment[],
  ) => void;
  /** Send one queued message as an ordinary follow-up once the run settles. */
  onSendQueued: (
    text: string,
    attachments: readonly ChatAttachment[],
  ) => Promise<void>;
}

export function useQueuedFollowUps({
  conversationKey,
  runInFlight,
  steerableRunActive,
  stopping = false,
  externalRunActive = false,
  onSteer,
  onRestoreDraft,
  onSendQueued,
}: Options): {
  queueFollowUp: (
    text: string,
    attachments?: readonly ChatAttachment[],
  ) => void;
  headerContent: ReactNode | undefined;
} {
  const [queuedFollowUps, setQueuedFollowUps] = useState<QueuedFollowUp[]>([]);
  const [applyingSteerId, setApplyingSteerId] = useState<string | null>(null);
  const [sendingQueuedId, setSendingQueuedId] = useState<string | null>(null);
  const [draggedQueuedId, setDraggedQueuedId] = useState<string | null>(null);
  const [dragOverQueuedId, setDragOverQueuedId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<
    Extract<ChatAttachment, { type: "image" }> | null
  >(null);
  // Why the last press of Steer did not steer anything, shown on the row it
  // was pressed on. Steering can be refused for reasons the person cannot see
  // — an agent card owns the run, the turn is not one the runtime can
  // redirect, the answer finished between the press and the request — and a
  // control that answers a click with nothing at all reads as broken.
  const [steerNote, setSteerNote] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const steerNoteTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (steerNoteTimerRef.current !== null) {
        window.clearTimeout(steerNoteTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!previewImage) return;
    function closePreview(event: KeyboardEvent) {
      if (event.key === "Escape") setPreviewImage(null);
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closePreview);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closePreview);
    };
  }, [previewImage]);

  function showSteerNote(id: string, text: string) {
    if (steerNoteTimerRef.current !== null) {
      window.clearTimeout(steerNoteTimerRef.current);
    }
    setSteerNote({ id, text });
    steerNoteTimerRef.current = window.setTimeout(() => {
      steerNoteTimerRef.current = null;
      setSteerNote(null);
    }, 8_000);
  }

  const visibleQueued = queuedFollowUps.filter(
    (item) =>
      item.conversationKey === null ||
      item.conversationKey === conversationKey,
  );

  useEffect(() => {
    if (!previewImage) return;
    const imageStillVisible = visibleQueued.some((item) =>
      item.attachments.some((attachment) => attachment === previewImage),
    );
    if (!imageStillVisible) setPreviewImage(null);
  }, [previewImage, visibleQueued]);

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
    void onSendQueued(next.text, next.attachments).finally(() =>
      setSendingQueuedId(null),
    );
  }, [
    applyingSteerId,
    conversationKey,
    onSendQueued,
    queuedFollowUps,
    runInFlight,
    sendingQueuedId,
  ]);

  function queueFollowUp(
    text: string,
    attachments: readonly ChatAttachment[] = [],
  ) {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    setQueuedFollowUps((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        text: trimmed,
        attachments: [...attachments],
        conversationKey,
      },
    ]);
  }

  /**
   * Why the working conversation cannot take a course correction right now.
   * Doubles as the Steer control's tooltip and as the note shown when it is
   * pressed anyway.
   */
  function steerUnavailableReason(): string {
    if (externalRunActive && !steerableRunActive) {
      // Only a chat turn can take a mid-run correction; an agent run is
      // steered by its own card, so this message waits its turn.
      return "This agent run cannot be steered — the message sends when it finishes.";
    }
    if (stopping) {
      return "This run is stopping — the message sends as soon as it settles.";
    }
    if (!onSteer) {
      return "This conversation cannot steer a working answer — the message sends when it finishes.";
    }
    if (!runInFlight) {
      return "Nothing is running to steer — the message sends in a moment.";
    }
    // Agent mode off, or a turn the runtime has not dispatched yet: there is
    // no run behind the answer for a correction to reach.
    return "This answer cannot take a course correction — the message sends when the turn finishes.";
  }

  async function applyQueuedSteer(item: QueuedFollowUp) {
    if (applyingSteerId) return;
    if (!onSteer || !steerableRunActive || stopping) {
      showSteerNote(item.id, steerUnavailableReason());
      return;
    }
    setApplyingSteerId(item.id);
    setSteerNote(null);
    try {
      if (await onSteer(item.text, item.attachments)) {
        setQueuedFollowUps((current) =>
          current.filter((candidate) => candidate.id !== item.id),
        );
      } else {
        // The surface refused it — most often the answer settled between the
        // press and the request. The message stays queued and sends when the
        // queue drains, which is worth saying rather than leaving the row
        // looking untouched.
        showSteerNote(
          item.id,
          "The answer moved on before the correction landed — the message sends as a follow-up instead.",
        );
      }
    } catch (steerError) {
      // The run may have ended first, or the steer request failed; either way
      // the message stays queued and sends when the queue drains.
      showSteerNote(
        item.id,
        steerError instanceof Error && steerError.message
          ? steerError.message
          : "The course correction could not be applied — the message sends as a follow-up instead.",
      );
    } finally {
      setApplyingSteerId(null);
    }
  }

  function editQueuedFollowUp(item: QueuedFollowUp) {
    setQueuedFollowUps((current) =>
      current.filter((candidate) => candidate.id !== item.id),
    );
    setSteerNote((current) => (current?.id === item.id ? null : current));
    onRestoreDraft(item.text, item.attachments);
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

  const previewOverlay =
    previewImage && typeof document !== "undefined"
      ? createPortal(
          <div
            className="bb-viewer-overlay fixed z-[200] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-label={`Image preview: ${previewImage.name}`}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setPreviewImage(null);
            }}
          >
            {/* Data URLs are local message payloads, not remote image URLs. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImage.dataUrl}
              alt={previewImage.name}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Close image preview"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>,
          document.body,
        )
      : null;

  const headerContent =
    visibleQueued.length > 0 ? (
      <>
        <div className="space-y-0.5 py-0.5">
          {visibleQueued.map((item, index) => {
            const images = item.attachments.filter(
              (
                attachment,
              ): attachment is Extract<ChatAttachment, { type: "image" }> =>
                attachment.type === "image",
            );
            const fileNames = item.attachments
              .filter((attachment) => attachment.type !== "image")
              .map((attachment) => attachment.name);
            const itemDescription =
              item.text ||
              (images.length === 1
                ? "1 image"
                : images.length > 1
                  ? `${images.length} images`
                  : fileNames.join(", "));
            return (
          <div key={item.id} className="space-y-0.5">
            <div
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
                draggable
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
                aria-label={`Reorder queued message ${index + 1} of ${visibleQueued.length}: ${itemDescription}. Drag, or use the Up and Down arrow keys.`}
                title="Drag to change steering order"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h8.5a2 2 0 0 1 2 2v.75m0 0-2.25-2.25m2.25 2.25L15 12.5" />
                </svg>
              </button>
              <>
                  {images.length ? (
                    <div className="flex shrink-0 -space-x-1" aria-label={`${images.length} attached ${images.length === 1 ? "image" : "images"}`}>
                      {images.slice(0, 3).map((attachment, imageIndex) => (
                        <button
                          key={`${attachment.name}-${imageIndex}`}
                          type="button"
                          onClick={() => setPreviewImage(attachment)}
                          className="relative block h-7 w-7 cursor-zoom-in overflow-hidden rounded-md border border-[var(--line-strong)] bg-[var(--paper-surface)] shadow-sm transition hover:z-10 hover:scale-105 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
                          aria-label={`Enlarge attached image ${attachment.name}`}
                          title={`View ${attachment.name}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={attachment.dataUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {item.text || fileNames.length ? (
                    <span className="min-w-0 flex-1 truncate text-[var(--ink)]" title={item.text || fileNames.join(", ")}>
                      {item.text || fileNames.join(", ")}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1" aria-hidden />
                  )}
                  <button
                    type="button"
                    onClick={() => void applyQueuedSteer(item)}
                    // Unavailable, but never inert: pressing it says why rather
                    // than swallowing the click. Only a steer already in flight
                    // takes the control away.
                    disabled={Boolean(applyingSteerId)}
                    aria-disabled={!canSteerNow}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm transition hover:bg-[var(--paper-surface)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40 ${
                      canSteerNow ? "" : "opacity-45"
                    }`}
                    aria-label={`Steer the active response with: ${itemDescription}`}
                    title={
                      canSteerNow
                        ? "Steer the active response"
                        : steerUnavailableReason()
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
                    aria-label={`Delete queued message: ${itemDescription}`}
                    title="Delete queued message"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 7.5h15m-9-3h3m-7.5 3 .75 12h10.5l.75-12M9.75 10.5v6m4.5-6v6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => editQueuedFollowUp(item)}
                    disabled={applyingSteerId === item.id}
                    className="rounded-lg p-1.5 transition hover:bg-[var(--paper-surface)] hover:text-[var(--ink)] disabled:opacity-40"
                    aria-label={`Edit queued message: ${itemDescription}`}
                    title="Edit queued message"
                  >
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <circle cx="5" cy="12" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="19" cy="12" r="1.5" />
                    </svg>
                  </button>
              </>
            </div>
            {steerNote?.id === item.id ? (
              <p
                role="status"
                className="px-2 pb-1 pl-11 text-xs text-[var(--ink-muted)]"
              >
                {steerNote.text}
              </p>
            ) : null}
          </div>
            );
          })}
        </div>
        {previewOverlay}
      </>
    ) : undefined;

  return { queueFollowUp, headerContent };
}
