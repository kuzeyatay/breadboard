"use client";

import { useMemo, type ReactNode } from "react";
import ChatMarkdown from "@/app/components/chat-markdown";
import { CourseCorrectionBubble } from "@/app/components/steered-assistant-response";
import {
  interleaveProgressNotes,
  type CourseCorrectionBoundary,
  type ProgressTimelineItem,
} from "@/lib/steered-response";
import { useIntermediateResponses } from "./use-intermediate-responses";

/**
 * Bread's progress notes shown in the transcript, Codex-style: each note is
 * the commentary the model wrote before a tool call, kept in order, with any
 * steer the user sent drawn between the notes where it happened. The Thinking
 * disclosure is separate and unchanged.
 */
export default function InlineProgressNotes({
  timeline,
}: {
  timeline: readonly ProgressTimelineItem<CourseCorrectionBoundary>[];
}) {
  if (!timeline.length) return null;
  return (
    <div data-inline-progress className="mb-3 space-y-2" aria-label="Progress updates">
      {timeline.map((item) =>
        item.kind === "note" ? (
          <div
            key={item.key}
            className="grid grid-cols-[8px_minmax(0,1fr)] gap-3 text-sm leading-6 text-[var(--ink-muted)]"
          >
            <span aria-hidden className="mt-[0.6rem] h-1.5 w-1.5 rounded-full bg-[var(--line-strong)]" />
            <div className="min-w-0">
              <ChatMarkdown content={item.text} compact />
            </div>
          </div>
        ) : (
          <CourseCorrectionBubble
            key={`steer-${item.correction.id}`}
            id={item.correction.id}
            content={item.correction.content}
            textSelection={item.correction.textSelection}
          />
        ),
      )}
    </div>
  );
}

/** True while a turn on this connection is still producing its answer. */
export function isLiveConnection(connection: string | undefined): boolean {
  return connection === "connecting" || connection === "streaming" || connection === "waiting";
}

/**
 * Wraps a Thinking row. While `locked`, the row keeps its label, timer and
 * token count but has no arrow and cannot be opened (see
 * `[data-thinking-locked]` in globals.css); the notes are inline instead.
 */
export function ThinkingRow({ locked, children }: { locked: boolean; children: ReactNode }) {
  return (
    <div className="contents" data-thinking-locked={locked ? "" : undefined}>
      {children}
    </div>
  );
}

/**
 * Codex-style turn framing for surfaces without steer bubbles. With
 * Intermediate responses on and the turn still running, the Thinking row stays
 * (label, seconds, tokens) but cannot be opened, and the notes are drawn
 * inline below it. Once the answer is in, the arrow returns and the notes live
 * only inside the Thinking disclosure. `renderPanel(hideNotes)` renders that
 * surface's own ActivityPanel; pass no progress notes to it when `hideNotes`.
 */
export function IntermediateTurn({
  live,
  notes,
  answer,
  renderPanel,
}: {
  live: boolean;
  notes?: readonly string[];
  answer: string;
  renderPanel: (hideNotes: boolean) => ReactNode;
}) {
  const enabled = useIntermediateResponses();
  const liveNotes = enabled && live;
  const timeline = useMemo(
    () => (liveNotes && notes?.length ? interleaveProgressNotes<CourseCorrectionBoundary>(notes, [], answer).timeline : []),
    [liveNotes, notes, answer],
  );
  return (
    <>
      <ThinkingRow locked={liveNotes}>{renderPanel(liveNotes)}</ThinkingRow>
      {liveNotes ? <InlineProgressNotes timeline={timeline} /> : null}
    </>
  );
}
