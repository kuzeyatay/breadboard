// The one transcript shape the editor reads, whichever engine produced it.
//
// The clone's helpers (`pack_transcripts.py`, `render.py --build-subtitles`)
// were written against ElevenLabs Scribe's response, so that response *is* the
// interface: a `words` array whose entries carry `type`, `text`, `start`, `end`
// and `speaker_id`. Nothing in Breadboard calls ElevenLabs any more — speech
// comes from Scriberr on this machine — but keeping the file shape means the
// clone's Python needs no fork and no second format to understand.
//
// `spacing` entries are not decoration. They carry the silences between words,
// and the packer breaks phrases on them; without them a take reads as one
// unbroken run and a cut has no boundary to land on.

export interface ScribeWordInput {
  start: number;
  end: number;
  text: string;
  /** Diarization label when the engine produced one. */
  speaker?: string | null;
}

export interface ScribeEntry {
  type: "word" | "spacing";
  text: string;
  start: number;
  end: number;
  speaker_id: string;
}

export interface ScribeTranscript {
  text: string;
  words: ScribeEntry[];
}

/**
 * `SPEAKER_00` (WhisperX) and `speaker_0` (Scribe) both mean the first voice.
 * The packer prints the id after stripping a `speaker_` prefix, so they are
 * normalized to the short form here rather than leaking either engine's spelling
 * into the transcript a person may read.
 */
function normalizeSpeaker(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "S0";
  const numbered = /^speaker[_\- ]?0*(\d+)$/i.exec(value);
  if (numbered) return `S${numbered[1]}`;
  return value;
}

/**
 * Build the Scribe-shaped transcript from an engine's word list.
 *
 * Words arrive sorted by start time; entries with unusable timings are dropped
 * rather than written, because a word with no start is a word no cut can be
 * made on.
 */
export function scribeTranscript(words: readonly ScribeWordInput[]): ScribeTranscript {
  const usable = words
    .map((word) => ({
      start: Number(word.start),
      end: Number(word.end),
      text: (word.text ?? "").trim(),
      speaker: normalizeSpeaker(word.speaker),
    }))
    .filter(
      (word) =>
        word.text.length > 0 &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.start >= 0 &&
        word.end >= word.start,
    )
    .sort((left, right) => left.start - right.start);

  const entries: ScribeEntry[] = [];
  let previousEnd: number | null = null;

  for (const word of usable) {
    if (previousEnd !== null && word.start > previousEnd) {
      entries.push({
        type: "spacing",
        text: " ",
        start: previousEnd,
        end: word.start,
        speaker_id: word.speaker,
      });
    }
    entries.push({
      type: "word",
      text: word.text,
      start: word.start,
      end: word.end,
      speaker_id: word.speaker,
    });
    previousEnd = Math.max(previousEnd ?? word.end, word.end);
  }

  return {
    text: entries
      .filter((entry) => entry.type === "word")
      .map((entry) => entry.text)
      .join(" "),
    words: entries,
  };
}
