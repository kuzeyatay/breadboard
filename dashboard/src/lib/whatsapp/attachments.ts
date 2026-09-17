import path from "node:path";
import { attachmentName, type InboundAttachment } from "../messaging-attachments/types.ts";

export function whatsAppAttachments(entry: Record<string, unknown>): InboundAttachment[] {
  const files: InboundAttachment[] = [];
  const paths = Array.isArray(entry.mediaUrls) ? entry.mediaUrls : [];
  for (const filePath of paths) {
    if (typeof filePath !== "string" || !filePath) continue;
    files.push({ filePath,
      name: attachmentName(typeof entry.fileName === "string" ? entry.fileName : "", path.basename(filePath)),
      mimeType: typeof entry.mime === "string" ? entry.mime : "application/octet-stream",
      ...(entry.mediaType === "ptt" ? { voice: true } : {}),
    });
  }
  const metadata = entry.nativeMetadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    for (const key of ["location", "contact", "contacts", "poll", "pollUpdate"]) {
      const value = (metadata as Record<string, unknown>)[key];
      if (value) files.push({ name: `${key}.json`, mimeType: "application/json", text: JSON.stringify(value, null, 2) });
    }
  }
  return files;
}
