/** Transport references stay server-side; only stored ChatAttachments reach a turn. */
export interface InboundAttachment {
  fileId?: string;
  filePath?: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  voice?: boolean;
  text?: string;
}

export function attachmentName(name: string, fallback = "attachment.bin"): string {
  const base = name.split(/[\\/]/).pop()?.replace(/[\x00-\x1f<>:"|?*]/g, "_").trim();
  return base && base !== "." && base !== ".." ? base.slice(-240) : fallback;
}

export function attachmentMessageText(message: {
  body: string;
  hasMedia: boolean;
  mediaType: string;
  fileName: string;
  attachments?: InboundAttachment[];
}): string {
  const body = message.body.trim();
  if (body && !/^\[(?:ptt|audio|image|video|gif|document) received\]$/.test(body)) return body;
  if (!message.hasMedia && !message.attachments?.length) return "";
  if (message.attachments?.some((file) => file.voice)) return "Please transcribe this voice message and respond to it.";
  return `Please read the attached ${message.fileName || message.mediaType || "file"} and help me with it.`;
}
