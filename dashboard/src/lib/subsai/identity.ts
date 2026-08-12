// Subtitles: when someone is asking for them, and in what shape.
//
// Two different things get called "subtitles", and they want different work:
//
//   "add captions to this"      → burn them into the picture. That is an edit,
//                                 and Video Use owns it — this module only
//                                 supplies the transcript it was missing.
//   "give me an SRT for this"   → a subtitle *file*, as an artifact, with the
//                                 video left alone.
//
// Telling those apart is the whole job here. Getting it wrong means either
// re-encoding a video when someone wanted a file, or handing over a file when
// they wanted the video changed.
//
// Deliberately free of Node imports — the composer imports this too.

/** What pysubs2 can write, restricted to what a person would actually ask for. */
export const SUBTITLE_FORMATS = ["srt", "vtt", "ass", "ssa", "sub", "txt"] as const;
export type SubtitleFormat = (typeof SUBTITLE_FORMATS)[number];

export function isSubtitleFormat(value: unknown): value is SubtitleFormat {
  return typeof value === "string" && (SUBTITLE_FORMATS as readonly string[]).includes(value);
}

/** The words for the thing itself. Without one of these, nothing here applies. */
const SUBTITLE_NOUNS = [
  "subtitle", "subtitles", "subs", "caption", "captions", "closed caption",
  "closed captions", "cc", "srt", "vtt", "webvtt", "ass file", "transcript file",
] as const;

/**
 * Asking for the video to carry them. "Burn" is the giveaway, but so is any
 * phrasing that puts the captions *on* or *in* the picture.
 */
const BURN_PHRASES = [
  "burn", "burnt", "burned", "hardcode", "hard code", "hard-coded", "hardcoded",
  "baked in", "bake in", "on the video", "in the video", "onto the video",
  "on screen", "onscreen", "open captions", "into the video", "add captions to",
  "add subtitles to", "with captions", "with subtitles",
] as const;

/**
 * Asking for the file. A format name on its own counts here — nobody says
 * "make me an SRT" meaning "change the video".
 */
const FILE_PHRASES = [
  "srt", "vtt", "webvtt", ".ass", "sidecar", "subtitle file", "subtitles file",
  "caption file", "separate file", "as a file", "download the subtitles",
  "export the subtitles", "give me the subtitles", "subtitle track",
] as const;

export type SubtitleIntent =
  | { subtitles: false }
  | {
      subtitles: true;
      /**
       * `burn` re-renders the video with the captions in the picture; `file`
       * produces a subtitle artifact and leaves the video alone.
       */
      delivery: "burn" | "file";
      /** The format asked for, when one was named. */
      format: SubtitleFormat | null;
      matched: string;
    };

function containsPhrase(text: string, phrase: string): boolean {
  if (phrase.includes(" ") || phrase.startsWith(".")) return text.includes(phrase);
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text);
}

/** A format named outright: "as vtt", "an srt", ".ass". */
function namedFormat(text: string): SubtitleFormat | null {
  for (const format of SUBTITLE_FORMATS) {
    if (format === "txt" || format === "sub") continue; // too common as words
    if (containsPhrase(text, format)) return format;
  }
  if (containsPhrase(text, "webvtt")) return "vtt";
  return null;
}

/**
 * Is this a request for subtitles, and which kind?
 *
 * Burn wins ties: "add subtitles to the video and give me the srt" is asking
 * for the video to change, and the file falls out of that anyway.
 */
export function subtitleIntent(message: string): SubtitleIntent {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return { subtitles: false };

  const noun = SUBTITLE_NOUNS.find((phrase) => containsPhrase(text, phrase));
  if (!noun) return { subtitles: false };

  const format = namedFormat(text);
  const burn = BURN_PHRASES.find((phrase) => containsPhrase(text, phrase));
  if (burn) {
    return { subtitles: true, delivery: "burn", format, matched: burn };
  }
  const file = FILE_PHRASES.find((phrase) => containsPhrase(text, phrase));
  if (file || format) {
    return { subtitles: true, delivery: "file", format, matched: file ?? format ?? noun };
  }

  // Bare "add subtitles" with no other signal. The commonest reading by far is
  // "put them on the video" — that is what the word means to most people — and
  // it is also the recoverable direction: the burn produces a transcript, so
  // asking for the file afterwards costs nothing.
  return { subtitles: true, delivery: "burn", format: null, matched: noun };
}

/** A filename for a subtitle artifact, derived from the video's own name. */
export function subtitleFilename(sourceName: string, format: SubtitleFormat): string {
  const base =
    sourceName
      .replace(/\.[a-z0-9]{1,8}$/i, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .toLowerCase() || "subtitles";
  return `${base}.${format}`;
}
