/** Shared pace for chat-title renaming, suggestion cards and inline suggestions. */
function duration(text: string, perCharacter: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, Math.max(1, text.length) * perCharacter)));
}

/** Backspacing reads faster than writing; long text never holds up the UI. */
export function textEraseMs(text: string): number {
  return duration(text, 34, 320, 700);
}

export function textTypeMs(text: string): number {
  return duration(text, 46, 520, 1300);
}
