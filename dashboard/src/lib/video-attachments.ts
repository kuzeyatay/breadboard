// The video formats a chat attachment may be, shared by the browser and the
// server so both agree on one list.
//
// A video is the second attachment kind whose *bytes* are the point. A document
// is read at send time and discarded; a video cannot be — what is worth knowing
// about it is spread across its audio and its pictures, and only the Watch skill
// (ffmpeg + Whisper + frame sampling) can get at either. So the file is stored
// whole, the message keeps a pointer to it, and the turn hands Watch a real path.
//
// Deliberately free of Node imports — the composer imports this too.

export type VideoAttachmentFormat =
  | "mp4"
  | "mov"
  | "m4v"
  | "mkv"
  | "webm"
  | "avi"
  | "mpg"
  | "mpeg"
  | "wmv";

export interface VideoFormatDescriptor {
  /** Served as this when the transcript plays the file back. */
  mimeType: string;
  /** Shown on the attachment chip. */
  label: string;
  /** False for the containers no browser will play; those are stored, not played. */
  playable: boolean;
}

const OCTET = "application/octet-stream";

export const VIDEO_ATTACHMENT_FORMATS: Record<VideoAttachmentFormat, VideoFormatDescriptor> = {
  mp4: { mimeType: "video/mp4", label: "MP4", playable: true },
  mov: { mimeType: "video/quicktime", label: "QuickTime", playable: true },
  m4v: { mimeType: "video/x-m4v", label: "M4V", playable: true },
  webm: { mimeType: "video/webm", label: "WebM", playable: true },
  // ffmpeg reads these happily; a browser <video> element usually will not, so
  // they are kept and analyzed rather than offered as something to press play on.
  mkv: { mimeType: "video/x-matroska", label: "Matroska", playable: false },
  avi: { mimeType: "video/x-msvideo", label: "AVI", playable: false },
  mpg: { mimeType: "video/mpeg", label: "MPEG", playable: false },
  mpeg: { mimeType: "video/mpeg", label: "MPEG", playable: false },
  wmv: { mimeType: OCTET, label: "Windows Media", playable: false },
};

export const VIDEO_ATTACHMENT_EXTENSIONS = Object.keys(
  VIDEO_ATTACHMENT_FORMATS,
) as VideoAttachmentFormat[];

export const VIDEO_ATTACHMENT_ACCEPT = VIDEO_ATTACHMENT_EXTENSIONS.map(
  (format) => `.${format}`,
).join(",");

/**
 * Two gigabytes, the same ceiling the recording upload uses. The body streams
 * straight to disk rather than being parsed as a form, so the limit here is
 * patience and disk rather than heap.
 */
export const MAX_VIDEO_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024;

/** The filename travels in a header, so the request body can be the raw file. */
export const VIDEO_FILENAME_HEADER = "x-video-filename";

export function videoAttachmentFormat(filename: string): VideoAttachmentFormat | null {
  const base = filename.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 ? base.slice(dot + 1) : "";
  return isVideoAttachmentFormat(extension) ? extension : null;
}

export function isVideoAttachmentFormat(value: unknown): value is VideoAttachmentFormat {
  return typeof value === "string" && value in VIDEO_ATTACHMENT_FORMATS;
}

export function isVideoAttachmentName(filename: string): boolean {
  return videoAttachmentFormat(filename) !== null;
}

export function videoFormatMimeType(format: VideoAttachmentFormat): string {
  return VIDEO_ATTACHMENT_FORMATS[format].mimeType;
}

export function videoFormatLabel(format: VideoAttachmentFormat): string {
  return VIDEO_ATTACHMENT_FORMATS[format].label;
}

export function isPlayableVideoFormat(format: VideoAttachmentFormat): boolean {
  return VIDEO_ATTACHMENT_FORMATS[format].playable;
}

/** `vid_` plus a hyphen-free UUID, the same shape a model blob id uses. */
export function isVideoBlobId(value: unknown): value is string {
  return typeof value === "string" && /^vid_[0-9a-f]{32}$/.test(value);
}

export function formatVideoSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
