// The MoneyPrinter agent's chat identity: the slash command that reaches it,
// and the parsing of a prompt into a video request.
//
// Mirrors the ViMax / HyperFrames identity modules so every runtime agent is
// reached the same way — pick it from the Agents tab, prompt it in chat, and its
// own surface appears inline for that turn.
//
// The cloned project takes a topic and produces a finished short: it writes the
// narration, picks the stock footage to search for, speaks the script, times the
// subtitles and cuts the result. Everything a run can decide is therefore a
// property of the video rather than of a conversation, which is why the request
// below is a shape and not a message.

export const MONEY_PRINTER_COMMAND = "/agents:money-printer";
export const MONEY_PRINTER_AGENT_ID = "money-printer";
export const MONEY_PRINTER_AGENT_NAME = "MoneyPrinter";

export type MoneyPrinterAspect = "9:16" | "16:9" | "1:1";

/**
 * Where the footage comes from. The three keyed libraries each need their own
 * API key, which is why the settings panel asks for them; `local` cuts from
 * clips already sitting in the clone's own material directory and needs none.
 */
export type MoneyPrinterSource = "pexels" | "pixabay" | "coverr" | "local";

/** How the downloaded clips are ordered in the cut. */
export type MoneyPrinterConcat = "random" | "sequential";

export interface MoneyPrinterRequest {
  /** The topic the video is about, with the flags stripped out. */
  subject: string;
  /**
   * The narration, word for word, when `--script` says the message already is
   * one. Empty means the model writes it from the subject.
   */
  script: string;
  aspect: MoneyPrinterAspect;
  source: MoneyPrinterSource;
  /** BCP-47 tag for the narration, or empty to follow the subject's language. */
  language: string;
  /** An edge-tts voice, in the clone's own `<voice>-<Gender>` spelling. */
  voice: string;
  /** How many paragraphs of narration to write. */
  paragraphs: number;
  /** How long one piece of footage is held before cutting to the next. */
  clipSeconds: number;
  concat: MoneyPrinterConcat;
  subtitles: boolean;
  /** Background music under the narration. */
  music: boolean;
  /** How many videos to cut from the same script, so you can pick one. */
  videoCount: number;
  /** Search terms to use instead of the ones the model would pick. */
  terms: string[] | null;
}

/**
 * The narrators offered in the settings panel.
 *
 * A curated shortlist rather than the clone's own 331-voice list: every one of
 * these is an edge-tts voice that needs no key and no account, which is the
 * whole reason a run can speak at all out of the box. `--voice` still accepts
 * any name the clone knows, so the list constrains the dropdown and nothing
 * else. Lives here, with the rest of the request vocabulary, so the settings
 * catalog can offer it without importing the runtime.
 */
export const MONEY_PRINTER_VOICES = [
  { value: "en-US-JennyNeural-Female", label: "Jenny — US English, warm" },
  { value: "en-US-AriaNeural-Female", label: "Aria — US English, bright" },
  { value: "en-US-GuyNeural-Male", label: "Guy — US English, steady" },
  { value: "en-US-AndrewNeural-Male", label: "Andrew — US English, conversational" },
  { value: "en-US-EmmaNeural-Female", label: "Emma — US English, light" },
  { value: "en-GB-SoniaNeural-Female", label: "Sonia — British English" },
  { value: "en-GB-RyanNeural-Male", label: "Ryan — British English" },
  { value: "en-AU-NatashaNeural-Female", label: "Natasha — Australian English" },
] as const;

export const DEFAULT_MONEY_PRINTER_VOICE = MONEY_PRINTER_VOICES[0].value;

export const MONEY_PRINTER_ASPECTS: readonly MoneyPrinterAspect[] = ["9:16", "16:9", "1:1"];
export const MONEY_PRINTER_SOURCES: readonly MoneyPrinterSource[] = [
  "pexels",
  "pixabay",
  "coverr",
  "local",
];

/**
 * The brief carried by a `/agents:money-printer …` message, or null when the
 * message is not addressed to this agent. An empty string means the command was
 * typed on its own — the palette inserts the token first and the person is still
 * writing, so the caller waits instead of launching an empty run.
 */
export function briefFromMoneyPrinterCommand(value: string): string | null {
  const trimmed = value.trim();
  const match = /^\/agents:money-printer(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export function moneyPrinterUserMessage(brief: string): string {
  const trimmed = brief.trim();
  return trimmed ? `${MONEY_PRINTER_COMMAND} ${trimmed}` : MONEY_PRINTER_COMMAND;
}

/**
 * A short label for the run card and the conversation list. The brief is the
 * user's own message directly above the card, so the label only has to be
 * recognisable at a glance.
 */
export function moneyPrinterRunLabel(subject: string): string {
  const firstLine = subject.trim().split(/\r?\n/).find((line) => line.trim()) ?? "";
  return firstLine.length > 70 ? `${firstLine.slice(0, 69)}…` : firstLine || "Short video";
}

function clampInteger(value: string, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * The subject a scripted run is filed under.
 *
 * The clone requires a subject even when it is handed a finished script — it is
 * what the search-term step reads alongside the narration — so a `--script` run
 * borrows the opening of the script rather than sending an empty string the
 * request model would reject.
 */
export function subjectFromScript(script: string): string {
  const opening = script.trim().split(/(?<=[.!?])\s+|\r?\n/).find((part) => part.trim()) ?? "";
  const chosen = opening.trim() || script.trim();
  return chosen.length > 120 ? `${chosen.slice(0, 119)}…` : chosen;
}

/**
 * Split a prompt into the subject and the shape of the video. Options stay
 * inline flags so chat remains the only surface:
 *   `--script`                      the message already is the narration
 *   `--vertical|--landscape|--square`  the frame the video is cut for
 *   `--source pexels|pixabay|coverr|local`  which footage library to search
 *   `--voice en-US-GuyNeural-Male`  the narrator
 *   `--language en`                 the language the narration is written in
 *   `--paragraphs 2`                how much narration to write
 *   `--clip 4`                      seconds each piece of footage is held
 *   `--sequential|--random`         clip order in the cut
 *   `--subtitles|--no-subtitles`    burn the narration in as captions
 *   `--music|--no-music`            background music under the voiceover
 *   `--count 3`                     cut this many videos from one script
 *   `--terms "sunrise, city"`       search these instead of the model's terms
 * Anything unrecognized stays part of the subject.
 *
 * `defaults` is the user's saved settings — where the video starts before a flag
 * is read. Every default has a flag that undoes it for one message, because a
 * preference you cannot override in a message is a trap.
 */
export function parseMoneyPrinterRequest(
  task: string,
  defaults?: Partial<Omit<MoneyPrinterRequest, "subject" | "script" | "terms">>,
): MoneyPrinterRequest {
  let aspect: MoneyPrinterAspect = defaults?.aspect ?? "9:16";
  let source: MoneyPrinterSource = defaults?.source ?? "pexels";
  let language = defaults?.language ?? "";
  let voice = defaults?.voice ?? "en-US-JennyNeural-Female";
  let paragraphs = defaults?.paragraphs ?? 1;
  let clipSeconds = defaults?.clipSeconds ?? 5;
  let concat: MoneyPrinterConcat = defaults?.concat ?? "random";
  let subtitles = defaults?.subtitles ?? true;
  let music = defaults?.music ?? true;
  let videoCount = defaults?.videoCount ?? 1;
  let scripted = false;
  let terms: string[] | null = null;

  const quoted = String.raw`"[^"]*"|[^\s]+`;

  const body = task
    .replace(/(?:^|\s)--(?:script|narration)\b/gi, () => {
      scripted = true;
      return " ";
    })
    .replace(/(?:^|\s)--(?:vertical|portrait)\b/gi, () => {
      aspect = "9:16";
      return " ";
    })
    .replace(/(?:^|\s)--(?:landscape|wide|horizontal)\b/gi, () => {
      aspect = "16:9";
      return " ";
    })
    .replace(/(?:^|\s)--square\b/gi, () => {
      aspect = "1:1";
      return " ";
    })
    .replace(
      /(?:^|\s)--source[= ](pexels|pixabay|coverr|local)\b/gi,
      (_match, value: string) => {
        source = value.toLowerCase() as MoneyPrinterSource;
        return " ";
      },
    )
    .replace(/(?:^|\s)--(pexels|pixabay|coverr|local)\b/gi, (_match, value: string) => {
      source = value.toLowerCase() as MoneyPrinterSource;
      return " ";
    })
    .replace(new RegExp(String.raw`(?:^|\s)--voice[= ](${quoted})`, "gi"), (_m, value: string) => {
      const chosen = value.replace(/^"|"$/g, "").trim();
      if (chosen) voice = chosen;
      return " ";
    })
    .replace(
      /(?:^|\s)--(?:language|lang)[= ]([a-z]{2}(?:-[a-zA-Z]{2,4})?)\b/gi,
      (_match, value: string) => {
        language = value;
        return " ";
      },
    )
    .replace(/(?:^|\s)--paragraphs?[= ](\d+)/gi, (_match, value: string) => {
      paragraphs = clampInteger(value, 1, 10);
      return " ";
    })
    .replace(/(?:^|\s)--clip(?:-duration)?[= ](\d+)/gi, (_match, value: string) => {
      clipSeconds = clampInteger(value, 1, 30);
      return " ";
    })
    .replace(/(?:^|\s)--sequential\b/gi, () => {
      concat = "sequential";
      return " ";
    })
    .replace(/(?:^|\s)--random\b/gi, () => {
      concat = "random";
      return " ";
    })
    .replace(/(?:^|\s)--no-(?:subtitles|captions)\b/gi, () => {
      subtitles = false;
      return " ";
    })
    .replace(/(?:^|\s)--(?:subtitles|captions)\b/gi, () => {
      subtitles = true;
      return " ";
    })
    .replace(/(?:^|\s)--no-(?:music|bgm)\b/gi, () => {
      music = false;
      return " ";
    })
    .replace(/(?:^|\s)--(?:music|bgm)\b/gi, () => {
      music = true;
      return " ";
    })
    .replace(/(?:^|\s)--count[= ](\d+)/gi, (_match, value: string) => {
      videoCount = clampInteger(value, 1, 5);
      return " ";
    })
    .replace(new RegExp(String.raw`(?:^|\s)--terms[= ](${quoted})`, "gi"), (_m, value: string) => {
      const listed = value
        .replace(/^"|"$/g, "")
        .split(/[,，]/)
        .map((term) => term.trim())
        .filter(Boolean);
      terms = listed.length ? listed : null;
      return " ";
    })
    // Trailing spaces are collapsed, but the line structure of a pasted script
    // is meaningful — the clone splits narration on its own punctuation, and a
    // script flattened into one line still reads correctly while an over-eager
    // collapse of blank lines would not.
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();

  return {
    subject: scripted ? subjectFromScript(body) : body,
    script: scripted ? body : "",
    aspect,
    source,
    language,
    voice,
    paragraphs,
    clipSeconds,
    concat,
    subtitles,
    music,
    videoCount,
    terms,
  };
}
