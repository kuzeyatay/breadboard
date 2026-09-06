// Hermes' session.create and prompt.submit both cap system_prompt at 262,144
// Python characters. Counting UTF-16 code units here is conservative for emoji.
export const HERMES_SYSTEM_PROMPT_LIMIT = 262_144;
// Leave room for the runtime's identity and transport policy wrapper.
export const COMPOSED_SYSTEM_PROMPT_LIMIT = 240_000;

export const CONTEXT_OMISSION = "\n\n[Context excerpt: some text was omitted to fit this turn. Full messages and sources remain stored. Retrieve the relevant original if the missing text is needed; do not infer it.]\n\n";

/** Bound injected context, preserving both its introduction and latest material. */
export function boundPromptContext(text: string, maximumCharacters: number): string {
  const limit = Math.max(0, Math.floor(maximumCharacters));
  if (text.length <= limit) return text;
  if (limit < CONTEXT_OMISSION.length) return "";
  const available = limit - CONTEXT_OMISSION.length;
  let head = Math.floor(available / 2);
  let tail = text.length - (available - head);
  // Never split a surrogate pair at an excerpt boundary.
  if (head > 0 && /[\uD800-\uDBFF]/u.test(text[head - 1])) head -= 1;
  if (tail < text.length && /[\uDC00-\uDFFF]/u.test(text[tail])) tail += 1;
  return text.slice(0, head) + CONTEXT_OMISSION + text.slice(tail);
}
