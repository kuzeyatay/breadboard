export type GardenStableTextState = {
  content: string;
  thinking?: string;
  progressNotes?: string[];
};

export type GardenStableTextEvent =
  | { type: "delta"; text: string }
  | { type: "provisional"; text: string }
  | { type: "replace"; text: string }
  | { type: "segment"; text: string; streamed: boolean };

function appendThinking(current: string | undefined, text: string): string {
  const next = text.trim();
  if (!next) return current ?? "";
  return [current?.trim(), next].filter(Boolean).join("\n");
}

function appendProgressNote(current: string[] | undefined, text: string): string[] {
  const next = text.trim();
  if (!next) return current ?? [];
  const notes = current ?? [];
  return notes.at(-1) === next ? notes : [...notes, next];
}

/**
 * Keep Hermes' pre-tool narration out of the answer bubble.
 *
 * `delta` remains the streaming contract for the legacy ChatMock fallback.
 * Hermes emits `provisional` only after a segment has been classified as
 * narration, then emits one `replace` event for the stable final answer.
 * `segment` is retained for an in-flight response from an older hot-reloaded
 * server module.
 */
export function applyGardenStableTextEvent<T extends GardenStableTextState>(
  state: T,
  event: GardenStableTextEvent,
): T {
  if (event.type === "delta") {
    return { ...state, content: `${state.content}${event.text}` } as T;
  }
  if (event.type === "replace") {
    return { ...state, content: event.text } as T;
  }
  if (event.type === "provisional") {
    return {
      ...state,
      thinking: appendThinking(state.thinking, event.text),
      progressNotes: appendProgressNote(state.progressNotes, event.text),
    } as T;
  }
  return {
    ...state,
    thinking: appendThinking(state.thinking, event.text),
    progressNotes: appendProgressNote(state.progressNotes, event.text),
  } as T;
}
