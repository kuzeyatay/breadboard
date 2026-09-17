import sharp from "sharp";
import { messageAttachments, uploadId } from "../conversations/uploads.ts";

export interface ImageMessage { id: number; metadata: string | null }

/** Newest message first; retain duplicates and the user's image order. */
export function attachedImages(messages: readonly ImageMessage[]) {
  for (const message of messages) {
    const images = messageAttachments(message.metadata).flatMap((attachment, index) =>
      attachment.type === "image" ? [{ ...attachment, uploadId: uploadId(message.id, index) }] : [],
    );
    if (images.length) return images;
  }
  return [];
}

export async function inspectAttachedImage(messages: readonly ImageMessage[], args: Record<string, unknown>) {
  const images = attachedImages(messages);
  const index = args.image ?? 1;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > images.length) {
    throw new Error(`Choose an image from 1 to ${images.length}. If none is available, ask the user for the missing image.`);
  }
  const image = images[index - 1];
  const match = /^data:image\/(?:jpeg|png|webp|gif);base64,([a-z0-9+/=\s]+)$/i.exec(image.dataUrl);
  if (!match) throw new Error("This attachment is not a supported image.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Image exceeds the inspection size limit.");
  // Normalize EXIF orientation before interpreting crop coordinates.
  const normalized = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().toBuffer();
  const metadata = await sharp(normalized).metadata();
  const width = metadata.width!;
  const height = metadata.height!;
  let pipeline = sharp(normalized);
  if (args.crop !== undefined) {
    const crop = args.crop as Record<string, unknown>;
    if (!crop || typeof crop !== "object" || Array.isArray(crop)) throw new Error("Invalid crop.");
    const { x, y, width: w, height: h } = crop;
    if (![x, y, w, h].every(v => typeof v === "number" && Number.isFinite(v)) ||
        (x as number) < 0 || (y as number) < 0 || (w as number) <= 0 || (h as number) <= 0 ||
        (x as number) + (w as number) > 1 || (y as number) + (h as number) > 1) {
      throw new Error("Crop x, y, width and height must describe a rectangle within 0–1.");
    }
    const left = Math.min(width - 1, Math.floor((x as number) * width));
    const top = Math.min(height - 1, Math.floor((y as number) * height));
    pipeline = pipeline.extract({ left, top,
      width: Math.min(width - left, Math.max(1, Math.round((w as number) * width))),
      height: Math.min(height - top, Math.max(1, Math.round((h as number) * height))),
    });
  }
  const rendered = await pipeline.resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 95 }).toBuffer();
  return {
    image: index, count: images.length, name: image.name, originalWidth: width, originalHeight: height,
    url: `/api/hermes/uploads/${image.uploadId}/content`,
    screenshot: { dataUrl: `data:image/jpeg;base64,${rendered.toString("base64")}` },
    guidance: "Read the attached image directly. If a symbol is still unreadable after one focused crop, state what is unclear and ask the user. Solve the readable parts; web searches cannot establish what a blurred symbol says.",
  };
}
