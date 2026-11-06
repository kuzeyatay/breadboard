import { renderInspectionImage } from "./image-inspection.ts";
import { messageAttachments, uploadId } from "../conversations/uploads.ts";
import { findDocumentBlob, readDocumentFigure } from "../conversations/document-blob-store.ts";

export interface ImageMessage { id: number; metadata: string | null }
type Attachment = ReturnType<typeof messageAttachments>[number];
type AttachedImage =
  | (Extract<Attachment, { type: "image" }> & { uploadId: string })
  | (Extract<Attachment, { type: "document" }> & { uploadId: string; figure: string });

/** Newest message first; retain duplicates and the user's image order. */
export function attachedImages(messages: readonly ImageMessage[]): AttachedImage[] {
  for (const message of messages) {
    const attachments = messageAttachments(message.metadata);
    const images = attachments.flatMap<AttachedImage>((attachment, index) => {
      const id = uploadId(message.id, index);
      if (attachment.type === "image") return [{ ...attachment, uploadId: id }];
      if (attachment.type === "document") {
        return (attachment.figures ?? []).map(figure => ({ ...attachment, uploadId: id, figure }));
      }
      return [];
    });
    // A new document is the current visual source even when its figures are
    // unavailable. Never silently substitute screenshots from an older turn.
    if (images.length || attachments.some(attachment => attachment.type === "document")) return images;
  }
  return [];
}

export async function inspectAttachedImage(
  messages: readonly ImageMessage[], args: Record<string, unknown>,
  owner: { userId: number } | undefined = undefined,
) {
  const images = attachedImages(messages);
  if (!images.length) throw new Error("No attached images or extracted document figures are available.");
  const index = args.image ?? 1;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > images.length) {
    throw new Error(`Choose an image from 1 to ${images.length}. If none is available, ask the user for the missing image.`);
  }
  const image = images[index - 1];
  let bytes: Buffer;
  let url = `/api/hermes/uploads/${image.uploadId}/content`;
  if (image.type === "document") {
    if (!owner) throw new Error("The attached document is unavailable.");
    const stored = findDocumentBlob({ ...owner, blobId: image.blobId });
    if (!stored || stored.format !== image.format) throw new Error("The attached document is unavailable.");
    const figure = readDocumentFigure({ userId: owner.userId, blobId: image.blobId, name: image.figure });
    if (!figure) throw new Error(`The attached document's ${image.figure} is unavailable.`);
    bytes = figure.buffer;
    url = `/api/chat-attachments/documents/${image.blobId}?figure=${encodeURIComponent(image.figure)}`;
  } else {
    const match = /^data:image\/(?:jpeg|png|webp|gif);base64,([a-z0-9+/=\s]+)$/i.exec(image.dataUrl);
    if (!match) throw new Error("This attachment is not a supported image.");
    bytes = Buffer.from(match[1], "base64");
  }
  return {
    image: index, count: images.length, name: image.name,
    ...(image.type === "document" ? { figure: image.figure } : {}),
    url,
    ...await renderInspectionImage(bytes, args),
    guidance: "Read the attached image directly. If a symbol is still unreadable after one focused crop, state what is unclear and ask the user. Solve the readable parts; web searches cannot establish what a blurred symbol says.",
  };
}
