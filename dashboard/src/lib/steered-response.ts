export interface CourseCorrectionBoundary {
  id: string;
  content: string;
  offset: number;
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

export type SteeredResponseSegment =
  | { kind: "assistant"; content: string; key: string }
  | { kind: "correction"; content: string; key: string };

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
