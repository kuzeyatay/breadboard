"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ChatMarkdown from "@/app/components/chat-markdown";
import { CourseCorrectionBubble } from "@/app/components/steered-assistant-response";
import {
  interleaveProgressNotes,
  type CourseCorrectionBoundary,
  type ProgressTimelineItem,
} from "@/lib/steered-response";
import { useIntermediateResponses } from "./use-intermediate-responses";

/**
 * Reveals `text` progressively, Codex-style. A note keeps what it has already
 * shown when its text grows (a streaming draft) or is replaced by the sealed
 * version of itself, so a note never re-types or jumps. `instant` shows the
 * whole text at once (notes that were already there when the view opened).
 */
export function useTypedText(text: string, instant: boolean): string {
  const [shown, setShown] = useState(instant ? text.length : 0);
  const shownRef = useRef(shown);
  const previous = useRef(text);
  // A rewrite that is not a continuation restarts from the shared prefix.
  if (previous.current !== text) {
    if (!text.startsWith(previous.current.slice(0, shownRef.current))) {
      let common = 0;
      while (common < shownRef.current && previous.current[common] === text[common]) common += 1;
      shownRef.current = common;
    }
    previous.current = text;
  }
  useEffect(() => {
    if (shownRef.current >= text.length) {
      if (shown !== text.length) setShown(text.length);
      shownRef.current = text.length;
      return;
    }
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      shownRef.current = text.length;
      setShown(text.length);
      return;
    }
    let frame = 0;
    const step = () => {
      const remaining = text.length - shownRef.current;
      if (remaining <= 0) return;
      // Fast enough to keep up with a stream, slow enough to read as typing.
      shownRef.current += Math.max(2, Math.ceil(remaining / 18));
      shownRef.current = Math.min(shownRef.current, text.length);
      setShown(shownRef.current);
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [text, shown]);
  return text.slice(0, Math.min(shown, text.length));
}

/**
 * Answers whose streamed text was held back while the turn ran (it could
 * still have become a progress note). When such an answer first appears it
 * types in; everywhere else, and on any later mount, it shows whole.
 */
const heldAnswers = new Set<string>();

/** Marks an answer as held back; call while its draft is hidden. */
export function holdAnswer(id: string): void {
  heldAnswers.add(id);
}

/**
 * Renders a finished answer, typing it in when it was held back during the
 * turn. `children` receives the text to show so the surface keeps its own
 * markdown, selection and annotation rendering.
 */
export function TypeInAnswer({
  id,
  content,
  children,
}: {
  id: string;
  content: string;
  children: (text: string) => ReactNode;
}) {
  const [animate] = useState(() => heldAnswers.has(id));
  useEffect(() => {
    heldAnswers.delete(id);
  }, [id]);
  const typed = useTypedText(content, !animate);
  return <>{children(typed)}</>;
}

function NoteDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-[0.55rem] h-2 w-2 rounded-full ${
        active ? "bg-[var(--botanical)] motion-safe:animate-pulse" : "bg-[var(--line-strong)]"
      }`}
    />
  );
}

function TypedNote({ text, instant, active }: { text: string; instant: boolean; active: boolean }) {
  const typed = useTypedText(text, instant);
  return (
    <div data-progress-note className="grid grid-cols-[8px_minmax(0,1fr)] gap-3 text-sm leading-6 text-[var(--ink-muted)]">
      <NoteDot active={active} />
      <div className="min-w-0">
        <ChatMarkdown content={typed} compact />
      </div>
    </div>
  );
}

/**
 * Bread's progress notes shown in the transcript, Codex-style: each note is
 * the commentary the model wrote before a tool call, kept in order, with any
 * steer the user sent drawn between the notes where it happened. While the
 * turn is `live`, the newest dot pulses and new notes type in; `waiting` adds
 * a pulsing dot for a steer Bread has not answered yet. The Thinking
 * disclosure is separate and unchanged.
 */
export default function InlineProgressNotes({
  timeline,
  live = false,
  waiting = false,
}: {
  timeline: readonly ProgressTimelineItem<CourseCorrectionBoundary>[];
  live?: boolean;
  waiting?: boolean;
}) {
  // Notes already present when this view opened (a reload mid-turn) are shown
  // whole, except the newest, which types in like every note after it. The
  // list mounts with its first note, so that one always types in too.
  const initialKeys = useRef<Set<string> | null>(null);
  if (initialKeys.current === null) {
    const keys = timeline.flatMap((item) => (item.kind === "note" ? [item.key] : []));
    initialKeys.current = new Set(keys.slice(0, -1));
  }
  if (!timeline.length && !waiting) return null;
  let lastNote = -1;
  timeline.forEach((item, index) => {
    if (item.kind === "note") lastNote = index;
  });
  return (
    <div data-inline-progress className="mb-3 space-y-2" aria-label="Progress updates" aria-live="polite">
      {timeline.map((item, index) =>
        item.kind === "note" ? (
          <TypedNote
            key={item.key}
            text={item.text}
            instant={initialKeys.current!.has(item.key)}
            active={live && !waiting && index === lastNote}
          />
        ) : (
          <CourseCorrectionBubble
            key={`steer-${item.correction.id}`}
            id={item.correction.id}
            content={item.correction.content}
            textSelection={item.correction.textSelection}
          />
        ),
      )}
      {waiting ? (
        <div data-progress-waiting className="grid grid-cols-[8px_minmax(0,1fr)] gap-3 text-sm leading-6">
          <NoteDot active />
          <span className="thinking-shimmer">Reading your message</span>
        </div>
      ) : null}
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
 * only inside the Thinking disclosure, which then lists those notes rather
 * than reasoning summaries. `renderPanel(hideNotes, notesOnly)` renders that
 * surface's own ActivityPanel: pass no progress notes when `hideNotes`, and no
 * reasoning when `notesOnly`.
 */
export function IntermediateTurn({
  live,
  notes,
  answer,
  corrections = [],
  renderPanel,
}: {
  live: boolean;
  notes?: readonly string[];
  answer: string;
  /**
   * Steers the user sent during this turn. While it runs they sit between the
   * notes where they happened, and one not yet answered gets a pulsing
   * "Reading your message…" dot; afterwards they sit above the Thinking row.
   * A steer without a recorded note position falls after the latest note.
   */
  corrections?: readonly CourseCorrectionBoundary[];
  renderPanel: (hideNotes: boolean, notesOnly: boolean) => ReactNode;
}) {
  const enabled = useIntermediateResponses();
  const liveNotes = enabled && live;
  const notesOnly = enabled && Boolean(notes?.some((note) => note.trim()));
  const timeline = useMemo(() => {
    if (!liveNotes) return [];
    const noteCount = (notes ?? []).filter((note) => note.trim()).length;
    const placed = corrections.map((correction) => ({
      ...correction,
      offset: 0,
      noteIndex: correction.noteIndex ?? noteCount,
    }));
    const layout = interleaveProgressNotes<CourseCorrectionBoundary>(notes ?? [], placed, answer);
    return [
      // Sent before Bread wrote any note.
      ...layout.leading.map((correction) => ({ kind: "correction" as const, correction })),
      ...layout.timeline,
    ];
  }, [liveNotes, notes, answer, corrections]);
  const waiting = liveNotes && timeline.at(-1)?.kind === "correction";
  return (
    <>
      {!liveNotes && corrections.length ? (
        <div data-turn-corrections>
          {corrections.map((correction) => (
            <CourseCorrectionBubble
              key={`steer-${correction.id}`}
              id={correction.id}
              content={correction.content}
              textSelection={correction.textSelection}
            />
          ))}
        </div>
      ) : null}
      <ThinkingRow locked={liveNotes}>{renderPanel(liveNotes, notesOnly)}</ThinkingRow>
      {liveNotes ? <InlineProgressNotes timeline={timeline} live waiting={waiting} /> : null}
    </>
  );
}
