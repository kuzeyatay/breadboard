// Which video files the composer offers and the upload route accepts.
//
// Split out of uploads.ts because that module reaches for node:fs, and the
// composer's form is a client component: one shared list, importable from both
// sides, so the picker can never offer a format the route would refuse.

/** Container formats ffmpeg and OpenCV can both read. */
export const SHORTS_UPLOAD_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".m4v",
  ".mkv",
  ".webm",
  ".avi",
  ".mpg",
  ".mpeg",
  ".wmv",
] as const;

/** The `accept` attribute for a file input. */
export const UPLOAD_ACCEPT = SHORTS_UPLOAD_EXTENSIONS.join(",");
