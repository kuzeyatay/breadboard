import { subscriptionSpeech } from "./subscription-client";

/** Shared dispatch for voice mode, dictation, Clicky, previews and read-aloud. */
export async function speechRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const status = await fetch("/api/speech/settings", { cache: "no-store", signal: init.signal });
  if (!status.ok) return status;
  const { settings } = await status.json();
  if (settings.speechProvider === "local") return fetch(url, init);
  if (!settings.enabled) return Response.json({ error: "Speech is turned off in Voice settings." }, { status: 409 });
  if (settings.speechProvider !== "chatgpt") return Response.json({ error: "Choose Local or ChatGPT subscription in Voice settings." }, { status: 409 });
  try {
    if (url === "/api/speech/synthesize" || url === "/api/speech/synthesize/mp3") {
      const { text } = JSON.parse(String(init.body));
      const audio = await subscriptionSpeech({ text }, init.signal) as Blob;
      if (url.endsWith("/mp3")) return fetch(url, { ...init, body: audio, headers: { "Content-Type": "audio/wav" } });
      return new Response(audio, { headers: { "Content-Type": audio.type } });
    }
    const upload = url === "/api/speech/transcribe-upload";
    const file = upload ? init.body : init.body instanceof FormData ? init.body.get("file") : null;
    if (!(file instanceof Blob)) throw new Error("No recording was supplied.");
    const text = await subscriptionSpeech({ file }, init.signal) as string;
    return upload
      ? new Response(JSON.stringify({ stage: "done", text }) + "\n", { headers: { "Content-Type": "application/x-ndjson" } })
      : Response.json({ text });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    return Response.json({ error: error instanceof Error ? error.message : "Subscription voice failed." }, { status: 503 });
  }
}
