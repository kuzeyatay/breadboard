import { stripEmDashes } from "./prose-punctuation.ts";

// Hermes also sends its CLI spinner through the thinking stream. Match only
// known face + verb frames so ordinary prose about processing is preserved.
const SPINNER_FACES = [
  "(｡•́︿•̀｡)", "(◔_◔)", "(¬‿¬)", "( •_•)>⌐■-■", "(⌐■_■)",
  "(´･_･`)", "◉_◉", "(°ロ°)", "( ˘⌣˘)♡", "ヽ(>∀<☆)☆",
  "٩(๑❛ᴗ❛๑)۶", "(⊙_⊙)", "(¬_¬)", "( ͡° ͜ʖ ͡°)", "ಠ_ಠ",
];
const SPINNER_VERBS = "pondering|contemplating|musing|cogitating|ruminating|deliberating|mulling|reflecting|processing|reasoning|analyzing|computing|synthesizing|formulating|brainstorming";
const SPINNER_FRAME = new RegExp(
  `(?:${SPINNER_FACES.map((face) => face.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s+(?:${SPINNER_VERBS})(?:\\.{3}|…)`,
  "gu",
);
const CODE_REGIONS = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g;
// Recognize a face before interpreting its backtick as an inline-code opener.
// A real code span starts earlier and keeps its entire contents untouched.
const THINKING_REGIONS = new RegExp(`(${SPINNER_FRAME.source})|${CODE_REGIONS.source}`, "gu");

function cleanThinkingProse(text: string): string {
  return text
    // Consecutive provider summaries can arrive without a separating newline.
    .replace(/(\*\*[^*\n]+\*\*)(?=\*\*[^*\n])/g, "$1\n\n");
}

function cleanThinkingText(text: string): string {
  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(THINKING_REGIONS)) {
    result += cleanThinkingProse(text.slice(cursor, match.index)) + (match[1] ? "\n\n" : match[0]);
    cursor = match.index + match[0].length;
  }
  return (result + cleanThinkingProse(text.slice(cursor))).trim();
}

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
  const cleaned = cleanThinkingText(text);
  return [answerContent, ...progressNotes].some((content) =>
    isAssistantTextPreview(text, content) || isAssistantTextPreview(cleaned, content),
  ) ? "" : cleaned;
}

/** Readable timeline entries for both live streams and saved conversations. */
export function assistantThinkingUpdates(
  reasoning: string | undefined,
  answerContent: string,
  progressNotes: readonly string[],
): string[] {
  const text = assistantThinkingText(reasoning, answerContent, progressNotes);
  const entries = [""];
  const appendProse = (prose: string) => {
    const [first, ...rest] = prose.split(/\n\s*\n/);
    entries[entries.length - 1] += first;
    entries.push(...rest);
  };
  // Blank lines in code are not timeline boundaries.
  let cursor = 0;
  for (const match of text.matchAll(CODE_REGIONS)) {
    appendProse(text.slice(cursor, match.index));
    entries[entries.length - 1] += match[0];
    cursor = match.index + match[0].length;
  }
  appendProse(text.slice(cursor));
  const comparable = (value: string) => value.replace(/\*\*|__/g, "");
  const existing = [answerContent, ...progressNotes].map(comparable);
  return entries.reduce<string[]>((updates, entry) => {
    const trimmed = entry.trim();
    const comparison = comparable(trimmed);
    if (trimmed && !existing.some((content) => isAssistantTextPreview(comparison, content))) {
      updates.push(trimmed);
      existing.push(comparison);
    }
    return updates;
  }, []);
}
