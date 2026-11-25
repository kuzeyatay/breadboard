import type { ChatTextSelectionReference } from "./chat-text-selection.ts";

export interface CourseCorrectionBoundary {
  id: string;
  content: string;
  offset: number;
  /** Progress notes written before this steer, when the row recorded it. */
  noteIndex?: number;
  textSelection?: ChatTextSelectionReference;
}

/**
 * A reply to the assistant's own mid-turn question is runtime input, not a new
 * user-authored turn. New rows carry the explicit flag; the client id keeps
 * already-persisted clarification replies from reappearing after an upgrade.
 */
export function isClarificationAnswerMessage(message: {
  clientMessageId?: string;
  clarificationAnswer?: boolean;
}): boolean {
  return (
    message.clarificationAnswer === true ||
    message.clientMessageId?.startsWith("clarify:") === true
  );
}

/**
 * A steer accepted before the assistant had shown any answer text belongs
 * above the whole response -- including its thinking header -- not inside it.
 * Everything else interleaves with the answer at its offset.
 */
export function partitionCourseCorrections<T extends { offset: number }>(
  corrections: readonly T[],
): { leading: T[]; inline: T[] } {
  const leading: T[] = [];
  const inline: T[] = [];
  for (const correction of corrections) {
    (correction.offset <= 0 ? leading : inline).push(correction);
  }
  return { leading, inline };
}

export type SteeredResponseSegment =
  | { kind: "assistant"; content: string; key: string }
  | { kind: "correction"; content: string; key: string; textSelection?: ChatTextSelectionReference };

/**
 * Split one continuously streamed assistant response around the moments where
 * the user steered it. Offsets are captured when each steer is accepted and
 * are clamped on read so an interrupted or partially restored response still
 * renders safely.
 */
export function splitSteeredResponse(
  content: string,
  corrections: readonly CourseCorrectionBoundary[],
): SteeredResponseSegment[] {
  if (corrections.length === 0) {
    return content ? [{ kind: "assistant", content, key: "assistant-0" }] : [];
  }

  const ordered = corrections
    .map((correction, index) => ({ correction, index }))
    .sort(
      (left, right) =>
        left.correction.offset - right.correction.offset ||
        left.index - right.index,
    );
  const segments: SteeredResponseSegment[] = [];
  let cursor = 0;

  for (const { correction } of ordered) {
    const boundary = Math.max(
      cursor,
      Math.min(content.length, Math.trunc(correction.offset)),
    );
    if (boundary > cursor) {
      segments.push({
        kind: "assistant",
        content: content.slice(cursor, boundary),
        key: `assistant-${cursor}-${boundary}`,
      });
    }
    segments.push({
      kind: "correction",
      content: correction.content,
      key: `correction-${correction.id}`,
      ...(correction.textSelection ? { textSelection: correction.textSelection } : {}),
    });
    cursor = boundary;
  }

  if (cursor < content.length) {
    segments.push({
      kind: "assistant",
      content: content.slice(cursor),
      key: `assistant-${cursor}-${content.length}`,
    });
  }
  return segments;
}

export type ProgressTimelineItem<T> =
  | { kind: "note"; key: string; text: string }
  | { kind: "correction"; correction: T };

/**
 * Lay out a response's progress notes inline in the transcript (Codex-style
 * commentary), with each steer between the notes at the point it was sent.
 *
 * - A steer with no `noteIndex` (older rows) or sent before the first note
 *   keeps its existing place above the whole response (`leading`).
 * - A steer sent after `noteIndex` notes, before any answer text, follows
 *   note `noteIndex` in the timeline.
 * - A steer that split visible answer text (`offset > 0`) stays in the answer.
 *
 * The last note is not repeated when it is also the answer (a turn that ended
 * after narration promotes its final note to the answer).
 */
export function interleaveProgressNotes<T extends { offset: number; noteIndex?: number }>(
  notes: readonly string[],
  corrections: readonly T[],
  answer: string,
): { leading: T[]; timeline: ProgressTimelineItem<T>[]; inline: T[] } {
  const visible = notes.filter((note) => note.trim());
  if (visible.length && answer.trim() && visible[visible.length - 1].trim() === answer.trim()) {
    visible.pop();
  }
  const leading: T[] = [];
  const inline: T[] = [];
  const after = new Map<number, T[]>();
  for (const correction of corrections) {
    if (correction.offset > 0) {
      inline.push(correction);
      continue;
    }
    const index = correction.noteIndex;
    if (typeof index !== "number" || index <= 0 || visible.length === 0) {
      leading.push(correction);
      continue;
    }
    const slot = Math.min(index, visible.length);
    after.set(slot, [...(after.get(slot) ?? []), correction]);
  }
  const timeline: ProgressTimelineItem<T>[] = [];
  visible.forEach((text, i) => {
    timeline.push({ kind: "note", key: `note-${i}`, text });
    for (const correction of after.get(i + 1) ?? []) timeline.push({ kind: "correction", correction });
  });
  return { leading, timeline, inline };
}
