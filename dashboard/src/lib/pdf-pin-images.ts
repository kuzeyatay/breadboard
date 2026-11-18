import { randomUUID } from "node:crypto";
import db from "./db.ts";
import { ApiError } from "./hermes/route-core.ts";
import { parseImageDataUrl } from "./image-data-url.ts";

// Images pasted or attached to a PDF pin's note. The pin record (in
// text_highlights) keeps only these ids, so syncing a page's pins stays small.
db.exec(`
  CREATE TABLE IF NOT EXISTS pdf_pin_images (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_id TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, image_id)
  );
`);

export const PDF_PIN_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const MAX_PDF_PIN_IMAGE_BYTES = 6 * 1024 * 1024;
export const PDF_PIN_IMAGE_ID = /^pinimg_[0-9a-f-]{36}$/;

export function savePdfPinImage(userId: number, dataUrl: unknown): string {
  const parsed = typeof dataUrl === "string" ? parseImageDataUrl(dataUrl) : null;
  if (!parsed || !PDF_PIN_IMAGE_TYPES.has(parsed.mimeType)) {
    throw new ApiError(400, "invalid_pin_image", "Only PNG, JPEG, WEBP and GIF images can be attached.");
  }
  const data = Buffer.from(parsed.payload, "base64");
  if (!data.length || data.length > MAX_PDF_PIN_IMAGE_BYTES) {
    throw new ApiError(413, "pin_image_too_large", "That image is too large to attach.");
  }
  const id = `pinimg_${randomUUID()}`;
  db.prepare("INSERT INTO pdf_pin_images(user_id, image_id, mime_type, data) VALUES (?, ?, ?, ?)")
    .run(userId, id, parsed.mimeType, data);
  return id;
}

export function readPdfPinImage(userId: number, id: string): { mimeType: string; data: Buffer } | null {
  if (!PDF_PIN_IMAGE_ID.test(id)) return null;
  const row = db.prepare("SELECT mime_type, data FROM pdf_pin_images WHERE user_id = ? AND image_id = ?")
    .get(userId, id) as { mime_type: string; data: Buffer } | undefined;
  return row ? { mimeType: row.mime_type, data: row.data } : null;
}

export function removePdfPinImages(userId: number, ids: readonly string[]): number {
  const remove = db.prepare("DELETE FROM pdf_pin_images WHERE user_id = ? AND image_id = ?");
  return db.transaction(() => ids.filter(id => PDF_PIN_IMAGE_ID.test(id))
    .reduce((count, id) => count + remove.run(userId, id).changes, 0))();
}
