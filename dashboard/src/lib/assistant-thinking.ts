import { stripEmDashes } from "./prose-punctuation.ts";

/** Older Hermes responses saved an answer preview as reasoning. Keep that
 * preview out of the disclosure without changing the stored conversation. */
export function isAssistantTextPreview(text: string, content: string): boolean {
  // Answer prose is normalized at the runtime boundary, while the old preview
  // retained the provider's punctuation and line breaks.
  const normalize = (value: string) => stripEmDashes(value).replace(/\s+/g, " ").trim();
  const preview = normalize(text);
  const answer = normalize(content);
  return Boolean(preview && answer && (
    preview === answer || (preview.length >= 80 && answer.startsWith(preview))
  ));
}

export function assistantThinkingText(
  reasoning: string | undefined,
  answerContent: string,
  progressNotes: readonly string[],
): string {
  const text = reasoning?.trim() ?? "";
  return [answerContent, ...progressNotes].some((content) =>
    isAssistantTextPreview(text, content),
  ) ? "" : text;
}
