// The audio formats a chat attachment may be, shared by the browser and the
// server so both agree on one list.
//
// Audio is the fourth attachment kind whose *bytes* are the point, and it is
// the one Breadboard used to have no answer for at all: a song dropped into the
// composer went to the text extractor, which read an mp3 as mojibake and
// refused it. What is worth knowing about a piece of music — its key, its
// tempo, how loud it really is, where the chorus starts — is in the waveform,
// and only the audio analyzer can get at it. So the file is stored whole and
// the message keeps a pointer to it.
//
// The list is Symphonia's decodable set, because the analyzer is what reads
// these: offering a format it cannot decode would be offering a file nothing
// can open.
//
// Deliberately free of Node imports — the composer imports this too.

export type AudioAttachmentFormat =
  | "mp3"
  | "wav"
  | "flac"
  | "ogg"
  | "oga"
  | "m4a"
  | "aac"
  | "mp4a";

export interface AudioFormatDescriptor {
  /** Served as this when the transcript plays the file back. */
  mimeType: string;
  /** Shown on the attachment chip. */
  label: string;
}

export const AUDIO_ATTACHMENT_FORMATS: Record<AudioAttachmentFormat, AudioFormatDescriptor> = {
  mp3: { mimeType: "audio/mpeg", label: "MP3" },
  wav: { mimeType: "audio/wav", label: "WAV" },
  flac: { mimeType: "audio/flac", label: "FLAC" },
  ogg: { mimeType: "audio/ogg", label: "Ogg" },
  oga: { mimeType: "audio/ogg", label: "Ogg" },
  // An MPEG-4 audio container. Symphonia reads the AAC inside it, and every
  // browser plays it, so it is stored under its own extension rather than
  // renamed.
  m4a: { mimeType: "audio/mp4", label: "M4A" },
  aac: { mimeType: "audio/aac", label: "AAC" },
  mp4a: { mimeType: "audio/mp4", label: "M4A" },
};

export const AUDIO_ATTACHMENT_EXTENSIONS = Object.keys(
  AUDIO_ATTACHMENT_FORMATS,
) as AudioAttachmentFormat[];

export const AUDIO_ATTACHMENT_ACCEPT = AUDIO_ATTACHMENT_EXTENSIONS.map(
  (format) => `.${format}`,
).join(",");

/**
 * Half a gigabyte. A lossless album side is a few hundred megabytes and the
 * analyzer decodes the whole file into memory, so this is where patience and
 * the decoder agree.
 */
export const MAX_AUDIO_ATTACHMENT_BYTES = 512 * 1024 * 1024;

/** The filename travels in a header, so the request body can be the raw file. */
export const AUDIO_FILENAME_HEADER = "x-audio-filename";

export function audioAttachmentFormat(filename: string): AudioAttachmentFormat | null {
  const base = filename.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 ? base.slice(dot + 1) : "";
  return isAudioAttachmentFormat(extension) ? extension : null;
}

export function isAudioAttachmentFormat(value: unknown): value is AudioAttachmentFormat {
  return typeof value === "string" && value in AUDIO_ATTACHMENT_FORMATS;
}

export function isAudioAttachmentName(filename: string): boolean {
  return audioAttachmentFormat(filename) !== null;
}

export function audioFormatMimeType(format: AudioAttachmentFormat): string {
  return AUDIO_ATTACHMENT_FORMATS[format].mimeType;
}

export function audioFormatLabel(format: AudioAttachmentFormat): string {
  return AUDIO_ATTACHMENT_FORMATS[format].label;
}

/** `aud_` plus a hyphen-free UUID, the same shape a video blob id uses. */
export function isAudioBlobId(value: unknown): value is string {
  return typeof value === "string" && /^aud_[0-9a-f]{32}$/.test(value);
}

export function formatAudioSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
