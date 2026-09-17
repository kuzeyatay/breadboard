import { prepareMessagingAttachments, openCachedAttachment, storeMessagingAttachment } from "./store.ts";
import { transcribeMessagingVoice } from "./transcription.ts";
import type { ChatAttachment } from "../chat-attachments.ts";
import type { InboundAttachment } from "./types.ts";
import type { TelegramInboundMessage } from "../telegram/gateway.ts";
import type { WhatsAppInboundMessage } from "../whatsapp/bridge.ts";
import { downloadTelegramFile } from "../telegram/client.ts";
import { readBotToken } from "../telegram/credentials.ts";
import { whatsAppMediaDirectories } from "../whatsapp/config.ts";

async function withVoiceTranscripts(userId: number, channel: "telegram" | "whatsapp", files: readonly InboundAttachment[], attachments: ChatAttachment[]) {
  for (const [index, file] of files.entries()) {
    if (!file.voice) continue;
    let text: string;
    try { text = await transcribeMessagingVoice(userId, channel, attachments[index]); }
    catch { text = "Automatic transcription is unavailable. Listen to or transcribe the attached voice recording with the available speech tools before responding; do not guess what was said."; }
    const name = `${attachments[index].name}.transcript.txt`;
    attachments.push(await storeMessagingAttachment(userId, { name, mimeType: "text/plain" }, new Blob([text]).stream()));
  }
  return attachments;
}

export async function prepareTelegramAttachments(userId: number, message: TelegramInboundMessage) {
  const files = message.attachments ?? [];
  const attachments = await prepareMessagingAttachments({ userId, hasMedia: message.hasMedia, files,
    open: async (file) => {
      const token = readBotToken();
      if (!token || !file.fileId) throw new Error("Telegram is missing the attachment download reference. Please send it again.");
      return downloadTelegramFile(token, file.fileId);
    },
  });
  return withVoiceTranscripts(userId, "telegram", files, attachments);
}

export async function prepareWhatsAppAttachments(userId: number, message: WhatsAppInboundMessage) {
  const files = message.attachments ?? [];
  const attachments = await prepareMessagingAttachments({ userId, hasMedia: message.hasMedia, files,
    open: async (file) => {
      if (!file.filePath) throw new Error("WhatsApp did not download the attachment. Please send it again.");
      return openCachedAttachment(file.filePath, Object.values(whatsAppMediaDirectories()));
    },
  });
  return withVoiceTranscripts(userId, "whatsapp", files, attachments);
}
