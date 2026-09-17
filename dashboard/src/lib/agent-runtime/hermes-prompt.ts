import { attachmentOrderManifest, productAttachmentPromptText, type ChatAttachment } from "../chat-attachments.ts";
import { modelAttachmentPromptText } from "../model-attachments.ts";

export function hermesPromptText(
  text: string,
  attachments: ChatAttachment[] | undefined,
): string {
  const list = attachments ?? [];
  // "The third screenshot" or "the second pdf" must resolve to the file in
  // that position. The blocks below and the separately-attached images carry
  // names but not places in the row, so the row itself is spelled out.
  const manifest = attachmentOrderManifest(list);
  const blocks = list.flatMap((attachment, index) => {
    const position = manifest ? ` position="${index + 1}"` : "";
    // A document reads the same way as a text file here — its `text` is the
    // structured reading rather than a flattened one, so tables arrive as
    // tables and equations as LaTeX.
    if (attachment.type === "text" || attachment.type === "document") {
      return [
        [
          `<breadboard_attachment name=${JSON.stringify(attachment.name)}${position}>`,
          attachment.text,
          "</breadboard_attachment>",
        ].join("\n"),
      ];
    }
    if (attachment.type === "product") {
      return [
        [
          `<breadboard_attachment name=${JSON.stringify(attachment.name)} kind="product"${position}>`,
          productAttachmentPromptText(attachment),
          "</breadboard_attachment>",
        ].join("\n"),
      ];
    }
    // A mesh has no text, so what was measured from it stands in for one.
    // Without this the model is told a filename and nothing else.
    if (attachment.type === "model") {
      return [
        [
          `<breadboard_attachment name=${JSON.stringify(attachment.name)} kind="3d-model"${position}>`,
          modelAttachmentPromptText(attachment),
          "</breadboard_attachment>",
        ].join("\n"),
      ];
    }
    return [];
  });
  const sections = [...(manifest ? [manifest] : []), ...blocks];
  return sections.length > 0 ? `${text}\n\n${sections.join("\n\n")}` : text;
}
