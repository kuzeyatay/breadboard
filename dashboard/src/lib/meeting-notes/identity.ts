// The Meeting Notes agent's chat identity, and the shape of one request.
//
// The agent is named for what it does rather than for the project underneath
// it, for the same reason the Postiz agent is called Socials Manager: the Super
// Agent chooses from a list of `id — Name (command)` with no descriptions
// attached, so "can you transcribe this meeting" has to find this agent by its
// name alone. Meetily is the stack the notes pass is ported from, not the name
// a person types.
//
// Imported by client components and by API routes, so it stays free of
// server-only imports.

export const MEETING_NOTES_COMMAND = "/agents:meeting-notes";
export const MEETING_NOTES_AGENT_ID = "meeting-notes";
export const MEETING_NOTES_AGENT_NAME = "Meeting Notes";

/**
 * Where the words come from. All three end at the same place — a transcript the
 * notes pass reads — which is why the run is one pipeline with a longer or
 * shorter front half rather than three agents.
 */
export type MeetingSource =
  /** A recording uploaded with the message, staged by the upload route. */
  | { kind: "upload"; uploadId: string; filename: string }
  /** A recording that is already an artifact in this chat. */
  | { kind: "artifact"; artifactId: string }
  /** A video attached to the message through the normal composer tray. */
  | { kind: "attachment"; blobId: string; filename: string }
  /** Words already in hand — pasted, or carried in the brief. */
  | { kind: "transcript"; text: string }
  /**
   * Nothing named. The run looks for the newest recording on this conversation
   * and uses that. This is what makes a Super Agent delegation possible at all:
   * a delegated brief is a sentence and can never carry a file.
   */
  | { kind: "auto" };

export interface MeetingNotesRequest {
  source: MeetingSource;
  /** What the person asked for, in their own words. Steers the notes pass. */
  prompt: string;
  /** Two-letter code pinned onto the transcriber, or null to let it detect. */
  language: string | null;
  /** Label every line with who said it, when the transcriber can tell. */
  speakers: boolean;
  /** Stop after the transcript instead of writing notes from it. */
  transcriptOnly: boolean;
}

export const MAX_MEETING_PROMPT = 4_000;
/** A pasted transcript is the one input that arrives whole in the body. */
export const MAX_PASTED_TRANSCRIPT = 2_000_000;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Extract the task, preserving any other slash tokens the user stacked in front
 * of the command so the capability resolver still sees them.
 */
export function taskFromMeetingNotesCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:meeting-notes") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function meetingNotesUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${MEETING_NOTES_COMMAND} ${trimmed}` : MEETING_NOTES_COMMAND;
}

export interface MeetingNotesDefaults {
  language: string | null;
  speakers: boolean;
  transcriptOnly: boolean;
}

export const MEETING_NOTES_FALLBACK_DEFAULTS: MeetingNotesDefaults = {
  language: null,
  speakers: true,
  transcriptOnly: false,
};

/**
 * Split a prompt into the instruction itself and the shape of the run.
 *
 * Every option is an inline flag, because a flag typed in the message always
 * beats a stored default: `--lang nl`, `--speakers` / `--no-speakers`,
 * `--transcript-only`. Anything unrecognized stays part of the instruction, so
 * prose about a meeting never turns into a parameter.
 */
export function parseMeetingNotesPrompt(
  task: string,
  defaults: MeetingNotesDefaults = MEETING_NOTES_FALLBACK_DEFAULTS,
): Omit<MeetingNotesRequest, "source"> {
  let language = defaults.language;
  let speakers = defaults.speakers;
  let transcriptOnly = defaults.transcriptOnly;

  const prompt = task
    .replace(/(?:^|\s)--no-speakers\b/gi, () => {
      speakers = false;
      return " ";
    })
    .replace(/(?:^|\s)--speakers\b/gi, () => {
      speakers = true;
      return " ";
    })
    .replace(/(?:^|\s)--transcript-only\b/gi, () => {
      transcriptOnly = true;
      return " ";
    })
    .replace(/(?:^|\s)--(?:lang|language)[= ]([a-z]{2,3})\b/gi, (_match, value: string) => {
      language = value.toLowerCase();
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MEETING_PROMPT);

  return { prompt, language, speakers, transcriptOnly };
}

/**
 * Read a source out of an HTTP body.
 *
 * This exists so the fields a request can carry are enumerated in exactly one
 * place — the mistake the Video Use route made once was listing them itself and
 * then falling behind when a new kind was added, which silently dropped every
 * run started that way. A missing source is not an error here: it becomes
 * `auto`, and the run reports plainly when it can find nothing.
 */
export function parseMeetingSource(submitted: unknown): MeetingSource {
  const body = (submitted ?? {}) as Record<string, unknown>;

  const uploadId = clean(body.uploadId, 80);
  if (uploadId) {
    return { kind: "upload", uploadId, filename: clean(body.filename, 260) || "recording" };
  }
  const artifactId = clean(body.artifactId, 80);
  if (artifactId) return { kind: "artifact", artifactId };
  const blobId = clean(body.blobId, 80);
  if (blobId) {
    return { kind: "attachment", blobId, filename: clean(body.filename, 260) || "recording" };
  }
  const text = clean(body.transcript, MAX_PASTED_TRANSCRIPT);
  if (text) return { kind: "transcript", text };
  return { kind: "auto" };
}

export function parseMeetingNotesRequestBody(
  submitted: unknown,
  defaults: MeetingNotesDefaults = MEETING_NOTES_FALLBACK_DEFAULTS,
): MeetingNotesRequest {
  const body = (submitted ?? {}) as Record<string, unknown>;
  return {
    source: parseMeetingSource(body),
    ...parseMeetingNotesPrompt(clean(body.prompt, MAX_MEETING_PROMPT), defaults),
  };
}

/**
 * The filename travels in a header so the upload request body can be the raw
 * file — a two-hour recording must never be parsed as a form. Declared here
 * rather than in the store because the browser sets it and the store is
 * server-only.
 */
export const MEETING_FILENAME_HEADER = "x-meeting-filename";

/** The upload ids the staging route hands out, validated wherever one arrives. */
export function isMeetingUploadId(value: unknown): value is string {
  return typeof value === "string" && /^mrec_[a-f0-9]{32}$/i.test(value);
}
