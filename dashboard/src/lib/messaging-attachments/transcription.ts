import { readHermesConfig } from "../hermes/config.ts";
import { isSupervisorControlConfigured } from "../supervisor-control.ts";
import type { ChatAttachment } from "../chat-attachments.ts";

/** Gateways ask the dashboard to acquire speech leases; they never get supervisor authority. */
export async function transcribeMessagingVoice(userId: number, channel: "telegram" | "whatsapp", attachment: ChatAttachment): Promise<string> {
  if (attachment.type !== "audio") throw new Error("The voice message is not an audio attachment.");
  const token = process.env[channel === "telegram" ? "BREADBOARD_TELEGRAM_GATEWAY_TOKEN" : "BREADBOARD_WHATSAPP_GATEWAY_TOKEN"]?.trim();
  if (isSupervisorControlConfigured() || !token) {
    const { transcribeMessagingAudioBlob } = await import("./transcription-server.ts");
    return transcribeMessagingAudioBlob(userId, attachment.blobId);
  }
  const response = await fetch(`${readHermesConfig().dashboardInternalUrl}/api/internal/messaging-transcription`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ blobId: attachment.blobId }), signal: AbortSignal.timeout(12 * 60_000), cache: "no-store",
  });
  const data = await response.json().catch(() => null) as { text?: string; error?: string } | null;
  if (!response.ok || !data?.text?.trim()) throw new Error(data?.error || "Voice transcription is unavailable.");
  return data.text.trim();
}
