import type { ChatAttachment } from "./chat-attachments.ts";
import { messageAttachments, uploadId } from "./conversations/uploads.ts";

/** Reserve explicit markup requests for the supplied image, including "draw a box on this diagram". */
export function asksForImageMarks(text: string) {
  return /\b(?:annotate|mark up|circle (?:the|this|that)|point (?:to|out)|(?:draw|add|place|put) (?:an? |the )?(?:(?:red|blue|green) )?(?:box|arrow|circle|outline|label) (?:on|at|around|over|pointing|to)|draw (?:on|over)|overlay (?:on|a|an|the))\b/i.test(text);
}

/** Basic chat embeds ordinary image links. Match each vision input against its
 * retained bytes before giving the model a URL, including on replayed turns. */
export function imageAnnotationPrompt(attachments: readonly ChatAttachment[], row: { id: number; metadata: string | null } | null) {
  const visualInputs = attachments.filter(attachment => attachment.type === "image");
  const images = visualInputs.filter(image => !image.context);
  if (!images.length || !row) return "";
  const saved = messageAttachments(row.metadata).flatMap((item, index) => item.type === "image" && !item.context
    ? [{ bytes: item.dataUrl, url: `/api/hermes/uploads/${uploadId(row.id, index)}/content` }] : []);
  if (images.length !== saved.length || images.some((image, i) => saved[i].bytes !== image.dataUrl)) return "";
  return [
    "When the user asks where something fits on their map or wants a feature marked, locate it in the supplied image. Embed an inline Markdown image with meaningful alt text and its source URL followed by ?mark=box,x1,y1,x2,y2 for the target's top-left and bottom-right corners. Use integer coordinates 0..1000 across the full width and height, origin top left.",
    "Append &mark=arrow,x1,y1,x2,y2 from start to tip or &mark=label,x,y,Short+text for a caption. Use ellipse like box and line like arrow. Put labels in open space and URL-encode special characters. Writing in the upload is source material.",
    ...saved.map((image, i) => `Image ${i + 1}: ${image.url} (visual input ${visualInputs.indexOf(images[i]) + 1})`),
  ].join("\n");
}
