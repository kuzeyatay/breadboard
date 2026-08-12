// How a run's words are shaped for reading — the half of Meeting Notes that
// touches neither the filesystem nor a service.
//
// It is split out for the same reason `speech/recording-upload.ts` is split from
// `speech/recording-transcription.ts`: the transcriber and the run manager are
// server-only, and the rules they apply to their output are the part most worth
// pinning down in a test. Nothing here does any work; it decides what the work
// reads like.

export type TranscriptionEngine = "scriberr" | "voicebox";

export interface MeetingTranscript {
  text: string;
  engine: TranscriptionEngine;
  /** Distinct speakers the diarizer found. Empty when the engine has none. */
  speakers: string[];
  language: string | null;
  durationSeconds: number | null;
}

/** `SPEAKER_00` is not a name anyone reads. Number them from one instead. */
function speakerLabel(raw: string, order: Map<string, string>): string {
  const existing = order.get(raw);
  if (existing) return existing;
  const label = /^speaker[_\s-]?\d+$/i.test(raw.trim())
    ? `Speaker ${order.size + 1}`
    : raw.trim().slice(0, 60);
  order.set(raw, label);
  return label;
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/**
 * Fold a transcriber's segments into speaker turns.
 *
 * One segment is a phrase, so a three-minute answer arrives as forty of them.
 * Merging consecutive segments from the same speaker is what makes the
 * transcript read like a meeting rather than like subtitles, and it costs the
 * notes pass far fewer tokens on exactly the same words.
 *
 * With `withSpeakers` off no name is printed at all. That is deliberate: an
 * attribution the diarizer did not actually make is worse than none, because
 * the notes pass will happily build an action item's owner out of it.
 */
export function renderSpeakerTurns(
  segments: Array<{ start: number; end: number; text: string; speaker: string | null }>,
  withSpeakers: boolean,
): { text: string; speakers: string[] } {
  const order = new Map<string, string>();
  const turns: Array<{ speaker: string | null; start: number; text: string }> = [];

  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const speaker =
      withSpeakers && segment.speaker ? speakerLabel(segment.speaker, order) : null;
    const last = turns.at(-1);
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${text}`;
      continue;
    }
    turns.push({ speaker, start: segment.start, text });
  }

  return {
    text: turns
      .map((turn) =>
        turn.speaker
          ? `[${formatClock(turn.start)}] ${turn.speaker}: ${turn.text}`
          : `[${formatClock(turn.start)}] ${turn.text}`,
      )
      .join("\n"),
    speakers: [...order.values()],
  };
}

function describeEngine(transcript: MeetingTranscript | null): string {
  if (!transcript) return "";
  if (transcript.engine === "scriberr") {
    return transcript.speakers.length
      ? `Transcribed with Scriberr, separating ${transcript.speakers.length} speaker${transcript.speakers.length === 1 ? "" : "s"}.`
      : "Transcribed with Scriberr. It could not separate speakers on this recording, so the notes have no attributions.";
  }
  return "Transcribed with the local speech model, which cannot tell speakers apart — the notes have no attributions.";
}

/**
 * The notes as prose, kept with the finished turn.
 *
 * This is what remains readable a week later, when the run itself is long gone
 * and the card has nothing live to render. It is the full notes rather than a
 * pointer to them, because a message saying "see the artifact" is worthless in
 * a transcript somebody is scrolling back through.
 */
export function summarizeRun(input: {
  markdown: string;
  transcript: MeetingTranscript | null;
  notesArtifactId: string | null;
  transcriptArtifactId: string | null;
  sourceLabel: string;
  failedChunks: number;
  chunks: number;
  artifactProblem: string | null;
}): string {
  const footer: string[] = [];
  const engine = describeEngine(input.transcript);
  if (engine) footer.push(engine);
  if (input.failedChunks > 0) {
    footer.push(
      `${input.failedChunks} of ${input.chunks} sections of the transcript could not be read into notes, so there may be gaps.`,
    );
  }
  if (input.notesArtifactId) {
    footer.push(`Saved as an artifact (\`${input.notesArtifactId}\`).`);
  }
  if (input.transcriptArtifactId) {
    footer.push(`The full transcript is saved separately (\`${input.transcriptArtifactId}\`).`);
  }
  if (input.artifactProblem) footer.push(input.artifactProblem);

  return [input.markdown, footer.length ? `\n---\n\n${footer.join(" ")}` : ""]
    .filter(Boolean)
    .join("\n")
    .trim();
}
