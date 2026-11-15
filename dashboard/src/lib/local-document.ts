// The file picked from the home search bar, handed to /open in memory.
// /open keeps it on this computer (website-PDF lifetime, Settings cleanup) so a
// restored tab reopens it; a PDF keeps its highlights and chats by content hash.
let pending: File | null = null;

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp",
};
// Only containers a browser <video> plays; see VIDEO_ATTACHMENT_FORMATS.
const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm"];

export const LOCAL_DOCUMENT_ACCEPT = [".pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp",
  ...Object.keys(IMAGE_TYPES).map(ext => `.${ext}`), ...VIDEO_EXTENSIONS.map(ext => `.${ext}`)].join(",");

const extension = (name: string) => name.toLowerCase().split(".").pop() ?? "";

export function openedImageMimeType(name: string): string | null { return IMAGE_TYPES[extension(name)] ?? null; }

export function localFileKind(name: string): "image" | "video" | "document" {
  return openedImageMimeType(name) ? "image" : VIDEO_EXTENSIONS.includes(extension(name)) ? "video" : "document";
}

export function setLocalDocument(file: File) { pending = file; }
export function localDocument() { return pending; }
