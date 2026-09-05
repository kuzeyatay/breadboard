type Event = { type: string; sdp?: string; role?: string; text?: string; message?: string };
export type SubscriptionVoice = Awaited<ReturnType<typeof connectSubscriptionVoice>>;

export async function subscriptionSelected(signal?: AbortSignal): Promise<boolean> {
  const response = await fetch("/api/speech/settings", { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Speech settings are unavailable.");
  return body.settings?.speechProvider === "chatgpt";
}

/** One duplex call for a whole voice conversation, not one call per recording. */
export async function connectSubscriptionVoice(options: {
  microphone?: MediaStream;
  signal?: AbortSignal;
  onTranscript?: (text: string) => void;
  capture?: boolean;
} = {}) {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const peer = new RTCPeerConnection();
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const silent = context.createOscillator();
  const silence = context.createGain();
  silence.gain.value = 0;
  silent.connect(silence).connect(destination);
  silence.connect(context.destination);
  silent.start();
  const inputGain = context.createGain();
  inputGain.connect(destination);
  const microphone = options.microphone ? context.createMediaStreamSource(options.microphone) : null;
  microphone?.connect(inputGain);
  peer.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
  const channel = peer.createDataChannel("oai-events");
  let player: HTMLAudioElement | undefined;
  let recorder: MediaRecorder | undefined;
  const captured: Blob[] = [];
  let id: string | undefined;
  let answer: string | undefined;
  let error: Error | undefined;
  let polling: Promise<void> | undefined;
  let partial = "";
  let completed: string[] = [];
  let changedAt = 0;
  let outputVersion = 0;
  let audible = false;
  let speechEpoch = 0;
  let closed = false;
  const text = () => [...completed, partial].filter(Boolean).join(" ").trim();
  const check = () => {
    signal.throwIfAborted();
    if (error) throw error;
    if (peer.connectionState === "failed") throw new Error("The subscription audio connection failed. Try again.");
  };
  const pause = (ms: number) => new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  async function until(predicate: () => boolean, timeout = 35000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      check();
      if (Date.now() >= deadline) throw new Error("Subscription voice timed out. Try again.");
      await pause(50);
    }
    check();
  }
  async function request(url: string, init: RequestInit = {}) {
    const response = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(50000)]), cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || "Subscription voice could not connect.");
    return body;
  }
  const endpoint = () => `/api/speech/subscription/${encodeURIComponent(id!)}`;
  peer.ontrack = event => {
    const stream = new MediaStream([event.track]);
    player = new Audio();
    player.srcObject = stream;
    player.volume = audible ? 1 : 0;
    void player.play().catch(() => { error = new Error("Allow audio playback in this browser and try again."); });
    if (options.capture) {
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = event => { if (event.data.size) captured.push(event.data); };
      recorder.start(200);
    }
  };
  async function close() {
    if (closed) return;
    closed = true;
    controller.abort();
    if (recorder?.state === "recording") recorder.stop();
    player?.pause();
    if (player) player.srcObject = null;
    silent.stop();
    microphone?.disconnect();
    channel.close(); peer.close();
    destination.stream.getTracks().forEach(track => track.stop());
    await context.close().catch(() => {});
    if (id) await fetch(endpoint(), { method: "DELETE", keepalive: true, signal: AbortSignal.timeout(5000) }).catch(() => {});
    await polling;
  }
  try {
    void context.resume();
    await until(() => context.state === "running", 5000);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const session = await request("/api/speech/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sdp: offer.sdp, mode: "conversation" }) });
    id = session.id;
    polling = (async () => {
      let cursor = 0;
      while (!signal.aborted) {
        const batch = await request(`${endpoint()}?cursor=${cursor}`);
        cursor = batch.cursor;
        for (const event of batch.events as Event[]) {
          if (event.type === "sdp") answer = event.sdp;
          if (event.role === "user") {
            if (event.type === "transcriptDelta") partial += event.text || "";
            if (event.type === "transcript") { completed.push(event.text?.trim() || ""); partial = ""; }
            changedAt = Date.now();
            options.onTranscript?.(text());
          }
          if (event.type === "transcript" && event.role === "assistant") outputVersion++;
          if (event.type === "error" || event.type === "closed") throw new Error(event.message || "The ChatGPT voice connection ended. Reopen voice to reconnect.");
        }
      }
    })().catch(caught => { if (!signal.aborted) error = caught instanceof Error ? caught : new Error("Subscription voice disconnected."); });
    await until(() => Boolean(answer));
    await peer.setRemoteDescription({ type: "answer", sdp: answer! });
    await until(() => channel.readyState === "open");
    // The control channel can open before the duplex media clock is running.
    // Sending speakable context in that gap can leave the AVAS call silent.
    const mediaDeadline = Date.now() + 15000;
    while (true) {
      check();
      const stats = await peer.getStats();
      if ([...stats.values()].some(item => item.type === "outbound-rtp" && item.kind === "audio" && item.packetsSent >= 10)) break;
      if (Date.now() >= mediaDeadline) throw new Error("The browser could not start sending voice audio.");
      await pause(50);
    }
  } catch (caught) { await close(); throw caught; }
  // Abort must also stop audio immediately, not just the next event poll.
  signal.addEventListener("abort", () => { void close(); }, { once: true });
  return {
    close,
    setListening(listening: boolean) { inputGain.gain.value = listening ? 1 : 0; },
    resetTranscript() { partial = ""; completed = []; changedAt = 0; },
    transcript: text,
    stopSpeaking() { speechEpoch++; audible = false; if (player) player.volume = 0; },
    async finishTranscript() {
      inputGain.gain.value = 0;
      await until(() => Boolean(text()), 15000);
      await until(() => Date.now() - changedAt > 500, 10000);
      return text();
    },
    async speak(spoken: string, play = true) {
      const epoch = ++speechEpoch;
      inputGain.gain.value = 0;
      audible = play;
      if (player) player.volume = audible ? 1 : 0;
      for (const part of splitSpeechText(spoken)) {
        const before = outputVersion;
        await request(endpoint(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: part }) });
        await until(() => outputVersion > before || epoch !== speechEpoch, 120000);
        if (epoch !== speechEpoch) return;
        // Transcript completion precedes playout. Observe received speech
        // settling so a buffered tail is not cut off at an arbitrary delay.
        let quietSince = Date.now();
        const settleDeadline = Date.now() + 30000;
        while (Date.now() - quietSince < 800) {
          check();
          if (epoch !== speechEpoch) return;
          const stats = await peer.getStats();
          if ([...stats.values()].some(item => item.type === "inbound-rtp" && item.kind === "audio" && item.audioLevel > 0.003)) quietSince = Date.now();
          if (Date.now() > settleDeadline) throw new Error("The spoken response did not finish. Stop playback and try again.");
          await pause(100);
        }
      }
      audible = false;
      if (player) player.volume = 0;
    },
    async capture(): Promise<Blob> {
      if (!recorder) throw new Error("Audio recording was not enabled for this connection.");
      await new Promise<void>(resolve => { recorder!.onstop = () => resolve(); recorder!.stop(); });
      return new Blob(captured, { type: recorder.mimeType });
    },
    async transcribeFile(file: Blob) {
      // Stream decoding through a media element; large files are not copied
      // into a giant ArrayBuffer, and there is no fixed recording-duration cap.
      const url = URL.createObjectURL(file);
      const media = new Audio(url);
      const source = context.createMediaElementSource(media);
      source.connect(inputGain);
      inputGain.gain.value = 1;
      try {
        await media.play();
        while (!media.ended) { check(); if (media.error) throw new Error("This recording format is not supported by your browser."); await pause(100); }
        await pause(600);
        inputGain.gain.value = 0;
        await until(() => Boolean(text()), 15000);
        await until(() => Date.now() - changedAt > 500, 10000);
        return text();
      } finally { media.pause(); source.disconnect(); media.removeAttribute("src"); media.load(); URL.revokeObjectURL(url); }
    },
  };
}

/** Transport-sized pieces, not a user-facing text limit. Preserve all words. */
export function splitSpeechText(text: string): string[] {
  const result: string[] = [];
  let remaining = text.trim();
  while (remaining) {
    let end = Math.min(1800, remaining.length);
    if (end < remaining.length) {
      const prefix = remaining.slice(0, end);
      const sentence = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("! "), prefix.lastIndexOf("? "));
      const space = prefix.lastIndexOf(" ");
      if (sentence > 900) end = sentence + 1;
      else if (space > 900) end = space;
      if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
    }
    result.push(remaining.slice(0, end)); remaining = remaining.slice(end).trimStart();
  }
  return result;
}
