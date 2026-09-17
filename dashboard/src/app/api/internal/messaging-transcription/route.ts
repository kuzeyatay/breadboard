import { messagingGatewayChannel } from "@/lib/messaging-attachments/gateway-auth.ts";
import { transcribeMessagingAudioBlob } from "@/lib/messaging-attachments/transcription-server.ts";
import { getTelegramStore } from "@/lib/telegram/instance.ts";
import { getWhatsAppStore } from "@/lib/whatsapp/instance.ts";
import { isAudioBlobId } from "@/lib/audio-attachments.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const channel = messagingGatewayChannel(request.headers.get("authorization"));
  if (!channel) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // The service token chooses the linked owner. Callers cannot supply an account or path.
  const userId = (channel === "telegram" ? getTelegramStore() : getWhatsAppStore()).settings().ownerUserId;
  if (userId === null) return Response.json({ error: "Messaging is not linked." }, { status: 409 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Invalid request" }, { status: 400 });
  let body = "";
  try {
    let bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 512) return Response.json({ error: "Invalid request" }, { status: 413 });
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  let value;
  try { value = JSON.parse(body); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  if (!value || Object.keys(value).join(",") !== "blobId" || !isAudioBlobId(value.blobId)) {
    return Response.json({ error: "Invalid attachment" }, { status: 400 });
  }
  try {
    const text = await transcribeMessagingAudioBlob(userId, value.blobId, request.signal);
    return Response.json({ text }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "The voice message could not be transcribed. Its audio file is still attached." }, { status: 502 });
  }
}
