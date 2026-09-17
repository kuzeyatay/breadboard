import { OPENAI_SPEECH_VOICES } from './providers';
import { splitSpeechPassages } from './passages.ts';
import { applyPronunciations } from './pronunciation.ts';
import { createConnectionPreloader } from './connection-preloader';
import { createVerifiedSpeechOutput, sameSpokenWords, SpeechFidelityError } from './verified-output';
import { createRemoteAudioActivity } from './remote-audio-activity';
import { createScriptGuard } from './script-guard';

type Event = { type: string; sdp?: string; role?: string; text?: string; message?: string };
class SubscriptionRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
class SubscriptionSpeechStartError extends Error {
  constructor(readonly safeToRetry: boolean) {
    super('The voice service did not start speaking. Try again.');
  }
}
export interface SubscriptionVoice {
  close(): Promise<void>;
  release?(reusable: boolean): Promise<void>;
  isHealthy(): boolean;
  setMicrophone(stream: MediaStream): void;
  setCallbacks(callbacks: Pick<SubscriptionVoiceOptions, 'onTranscript' | 'onDisconnect'>): void;
  setListening(listening: boolean): void;
  resetTranscript(): void;
  transcript(): string;
  stopSpeaking(): void;
  /** Open the muted output reader while the host is preparing an answer. */
  prepareSpeaker(): Promise<void>;
  finishTranscript(): Promise<string>;
  speak(spoken: string, play?: boolean, onProgress?: (progress: number) => void): Promise<void>;
  capture(): Promise<Blob>;
  transcribeFile(file: Blob): Promise<string>;
}

export async function subscriptionSelected(signal?: AbortSignal): Promise<boolean> {
  const response = await fetch("/api/speech/settings", { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Speech settings are unavailable.");
  if (body.userId !== undefined) preloader.invalidate(subscriptionPreloadKey(body.userId, body.settings));
  if (!["chatgpt", "local", "openaiweb", "elevenlabs"].includes(body.settings?.speechProvider)) throw new Error('Choose a speech provider in Voice settings before starting voice.');
  return body.settings?.speechProvider === "chatgpt";
}

/** Keep transcription connected; its remote audio must never become narration. */
export interface SubscriptionVoiceOptions {
  microphone?: MediaStream;
  mode?: 'speak' | 'transcribe' | 'conversation';
  signal?: AbortSignal;
  onTranscript?: (text: string) => void;
  onDisconnect?: (error: Error) => void;
  capture?: boolean;
  listening?: boolean;
}

type PreloadSettings = { enabled?: boolean; speechProvider?: string; openaiVoice?: string; language?: string; transcriptionLanguage?: string | null; pronunciations?: string };
function subscriptionPreloadKey(userId: string | number, settings: PreloadSettings): string {
  return settings?.enabled && settings.speechProvider === 'chatgpt'
    ? JSON.stringify([String(userId), settings.openaiVoice, settings.language, settings.transcriptionLanguage, settings.pronunciations]) : '';
}

const preloader = createConnectionPreloader<SubscriptionVoice>((mode, signal) =>
  openSubscriptionVoice({ mode: mode as 'conversation' | 'speak', listening: false, signal }));
const borrowed = new WeakMap<SubscriptionVoice, { voice: SubscriptionVoice; detach(): void }>();
const released = new WeakSet<SubscriptionVoice>();

/** Called only by the persistent companion. No microphone is opened to warm it. */
export function preloadSubscriptionVoice(userId: string | number, settings: PreloadSettings, conversation = true, idle = true): Promise<void> {
  return preloader.configure(subscriptionPreloadKey(userId, settings), conversation ? ['conversation', 'speak'] : ['speak'], idle);
}
export function clearSubscriptionPreload(): Promise<void> { return preloader.clear(); }

/** A completed notification can reuse its drained reader for the next notice. */
export async function releaseSubscriptionVoice(voice: SubscriptionVoice, reusable = false): Promise<void> {
  if (released.has(voice)) return;
  const lease = borrowed.get(voice);
  if (!lease) { await voice.close(); return; }
  released.add(voice);
  borrowed.delete(voice);
  lease.detach();
  lease.voice.setCallbacks({});
  await preloader.release(lease.voice, reusable);
}

export async function connectSubscriptionVoice(options: SubscriptionVoiceOptions = {}): Promise<SubscriptionVoice> {
  const mode = options.mode ?? (options.microphone ? 'conversation' : 'speak');
  const prepared = !options.capture && preloader.has(mode) ? await preloader.take(mode, options.signal) : undefined;
  if (!prepared) {
    // Foreground audio may have just cleared this page's preloads. Their
    // native sessions still own both slots until DELETE finishes.
    await preloader.settled();
    options.signal?.throwIfAborted();
    return openSubscriptionVoice(options);
  }
  try {
    if (options.microphone) prepared.setMicrophone(options.microphone);
    prepared.setCallbacks(options);
    prepared.resetTranscript();
    prepared.setListening(options.listening !== false && Boolean(options.microphone));
  } catch (error) { await preloader.release(prepared); throw error; }
  const close = () => releaseSubscriptionVoice(voice);
  const abort = () => { void close(); };
  const voice: SubscriptionVoice = { ...prepared, close, release: reusable => releaseSubscriptionVoice(voice, reusable) };
  borrowed.set(voice, { voice: prepared, detach: () => options.signal?.removeEventListener('abort', abort) });
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) { await close(); options.signal.throwIfAborted(); }
  return voice;
}

async function openSubscriptionVoice(options: SubscriptionVoiceOptions = {}): Promise<SubscriptionVoice> {
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
  inputGain.gain.value = options.listening === false ? 0 : 1;
  inputGain.connect(destination);
  let microphone = options.microphone ? context.createMediaStreamSource(options.microphone) : null;
  const conversation = options.mode === 'conversation' || Boolean(options.microphone);
  let callbacks = { onTranscript: options.onTranscript, onDisconnect: options.onDisconnect };
  microphone?.connect(inputGain);
  peer.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
  const channel = peer.createDataChannel("oai-events");
  const verifiedOutput = createVerifiedSpeechOutput(signal);
  const audioActivity = createRemoteAudioActivity(context);
  let player: HTMLAudioElement | undefined;
  let id: string | undefined;
  let answer: string | undefined;
  let error: Error | undefined;
  let polling: Promise<void> | undefined;
  let partial = "";
  let completed: string[] = [];
  let changedAt = 0;
  let outputVersion = 0;
  let controlOutputVersion = 0;
  let controlOutputSeen = false;
  let outputTranscript = '';
  let controlTranscript = '';
  // The reader's own words as they stream, for the live guard.
  let liveTranscript = '';
  const completedOutputTurns = new Set<string>();
  let speechEpoch = 0;
  let activeSpeechEpoch: number | undefined;
  let interruptedOutput = false;
  let closed = false;
  let closing: Promise<void> | undefined;
  let sessionClosing: Promise<unknown> | undefined;
  let connected = false;
  let selectedVoice: string | undefined;
  let pronunciations = '';
  let sessionStarted = false;
  let voiceUpdateSent = false;
  let voiceConfirmed = false;
  let reader: SubscriptionVoice | undefined;
  let readerConnection: Promise<SubscriptionVoice> | undefined;
  let readerController: AbortController | undefined;
  let readerRetirement: Promise<void> = Promise.resolve();
  let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const fail = (caught: unknown) => {
    if (signal.aborted || closed || error) return;
    error = caught instanceof Error ? caught : new Error("Subscription voice disconnected.");
    if (connected) callbacks.onDisconnect?.(error);
  };
  channel.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message?.type === 'session.started') sessionStarted = true;
    if (message?.type === 'output_transcript.added' ||
      (message?.type === 'turn.created' && message.turn?.role === 'assistant')) {
      controlOutputSeen = true;
      // New words after a completed turn invalidate that turn's approval too.
      controlTranscript = '';
    }
    if (message?.type === 'turn.done' && message.turn?.role === 'assistant') {
      controlOutputSeen = true;
      if (!message.turn.id || !completedOutputTurns.has(message.turn.id)) {
        if (message.turn.id) completedOutputTurns.add(message.turn.id);
        if (completedOutputTurns.size > 256) completedOutputTurns.delete(completedOutputTurns.values().next().value!);
        controlTranscript = typeof message.turn.transcript === 'string' ? message.turn.transcript : '';
        controlOutputVersion++;
      }
    }
    if (message?.type === 'session.updated' && voiceUpdateSent) {
      const reportedVoice = message.session?.audio?.output?.voice;
      if (reportedVoice && reportedVoice !== selectedVoice) {
        fail(new Error('The subscription service selected a different voice. Try again.'));
      } else {
        voiceConfirmed = true;
      }
    }
    if (message?.type === 'error') fail(new Error('The subscription service could not apply the selected voice. Try again.'));
  };
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
  async function until(predicate: () => boolean, timeout = 35000, allowTimeout = false) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      check();
      if (Date.now() >= deadline) {
        if (allowTimeout) return false;
        throw new Error("Subscription voice timed out. Try again.");
      }
      await pause(50);
    }
    check();
    return true;
  }
  async function request(url: string, init: RequestInit = {}) {
    const response = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(50000)]), cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new SubscriptionRequestError(body?.error || "Subscription voice could not connect.", response.status);
    return body;
  }
  const endpoint = () => `/api/speech/subscription/${encodeURIComponent(id!)}`;
  /** Speech start/stop detection from the remote track's statistics. */
  function audioMeter(initialStats: RTCStatsReport) {
    const receivedAudio = (stats: RTCStatsReport) => {
      const incoming = [...stats.values()].find(item => item.type === 'inbound-rtp' && item.kind === 'audio');
      const decoded = audioActivity.snapshot();
      return decoded ? { ...incoming, ...decoded } : incoming;
    };
    const initialEnergy = receivedAudio(initialStats)?.totalAudioEnergy;
    let lastEnergy = initialEnergy;
    let lastDuration: number | undefined;
    const meter = {
      receivedAudio,
      initialEnergy,
      playoutDelayMs: 0,
      speechActive(stats: RTCStatsReport): boolean | undefined {
        const incoming = receivedAudio(stats);
        if (!incoming) return undefined;
        const energy = incoming.totalAudioEnergy;
        const duration = incoming.totalSamplesDuration;
        const energyDelta = typeof energy === 'number' && typeof lastEnergy === 'number' ? energy - lastEnergy : undefined;
        const durationDelta = typeof duration === 'number' && typeof lastDuration === 'number' ? duration - lastDuration : undefined;
        lastEnergy = energy;
        lastDuration = duration;
        // Energy changes catch quiet syllables and browsers that omit
        // audioLevel. Normalize when possible so comfort noise is silence.
        const active = energyDelta !== undefined && energyDelta >= 0
          ? energyDelta > 0 && (durationDelta === undefined || durationDelta <= 0 || energyDelta / durationDelta > 0.000001)
          : undefined;
        if (incoming.jitterBufferEmittedCount > 0 && incoming.jitterBufferDelay >= 0) {
          meter.playoutDelayMs = Math.max(meter.playoutDelayMs, 1000 * incoming.jitterBufferDelay / incoming.jitterBufferEmittedCount);
        }
        if (active || incoming.audioLevel > 0.001) return true;
        // A frozen receiver is not a quiet receiver. Wait for fresh
        // decoded samples before allowing a passage to finish.
        if (durationDelta !== undefined && durationDelta <= 0) return undefined;
        if (active === false || typeof incoming.audioLevel === 'number') return false;
        return undefined;
      },
    };
    meter.speechActive(initialStats);
    return meter;
  }
  /**
   * Completion can precede playout. Require observed quiet, including
   * energy-only stats, and leave time for the jitter/output buffers. The quiet
   * span is the floor of every gap between passages, so it is only as long as
   * decoded silence needs to be trusted. False when the reading was superseded.
   */
  async function settle(meter: ReturnType<typeof audioMeter>, epoch: number): Promise<boolean> {
    let quietSince = Date.now();
    const settleDeadline = Date.now() + 30000;
    while (true) {
      check();
      if (epoch !== speechEpoch) return false;
      const stats = await peer.getStats();
      if (epoch !== speechEpoch) return false;
      if (meter.speechActive(stats) !== false) quietSince = Date.now();
      const outputDelayMs = 1000 * ((context.baseLatency || 0) + (context.outputLatency || 0));
      if (Date.now() - quietSince >= 250 + meter.playoutDelayMs + outputDelayMs) return true;
      if (Date.now() > settleDeadline) throw new Error("The spoken response did not finish. Stop playback and try again.");
      await pause(50);
    }
  }
  /**
   * Live reading: the remote track is audible while the reader speaks, so the
   * whole message plays as one continuous paragraph the moment the reader
   * starts. The reader's own transcript is followed against the script and
   * the track is muted within a word or two if it stops reading the script;
   * the error then says where a fresh reading should resume.
   */
  async function speakLive(spoken: string, epoch: number, onProgress?: (progress: number) => void) {
    // Characters of the script whose readings have finished.
    let heard = 0;
    try {
      for (const part of splitLiveSpeechText(spoken)) {
        const before = outputVersion;
        const beforeControl = controlOutputVersion;
        const initialStats = await peer.getStats();
        check();
        if (epoch !== speechEpoch) return;
        const meter = audioMeter(initialStats);
        const guard = createScriptGuard(part);
        await until(() => verifiedOutput.ready());
        check();
        if (epoch !== speechEpoch) return;
        liveTranscript = '';
        // The speakable channel still interprets text as conversational
        // context. Bare notices such as "Your answer is ready" can produce
        // silence or an unrelated reply. Request a reading explicitly and let
        // the guard judge the words that come back.
        const readingRequest = `Read aloud exactly this text. Say only these words, with no introduction or commentary: ${part}`;
        setAudible(true);
        await request(endpoint(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: readingRequest }) });
        const startDeadline = Date.now() + 5000;
        // A whole paragraph can take minutes to read.
        const responseDeadline = Date.now() + 60_000 + part.length * 120;
        let audioObserved = false;
        let silenceConfirmed = false;
        let judged = '';
        while (epoch === speechEpoch) {
          check();
          const stats = await peer.getStats();
          if (epoch !== speechEpoch) return;
          const incoming = meter.receivedAudio(stats);
          const active = meter.speechActive(stats);
          audioObserved ||= active === true ||
            (typeof meter.initialEnergy === 'number' && incoming?.totalAudioEnergy > meter.initialEnergy);
          silenceConfirmed = typeof meter.initialEnergy === 'number' && incoming?.totalAudioEnergy === meter.initialEnergy;
          // WebRTC sends completion directly as well as through the native
          // bridge. Once direct events are present, ignore their delayed bridge
          // copies so a previous passage cannot finish the next one.
          const completed = controlOutputSeen ? controlOutputVersion > beforeControl : outputVersion > before;
          // The completed transcript is authoritative; until then follow the deltas.
          const transcript = completed ? `${controlOutputSeen ? controlTranscript : outputTranscript} ` : liveTranscript;
          if (transcript !== judged) {
            judged = transcript;
            guard.feed(transcript);
            onProgress?.((heard + guard.position) / spoken.length);
          }
          if (guard.diverged) {
            setAudible(false);
            throw new SpeechFidelityError(heard === 0 && guard.position === 0, heard + guard.resumeAt);
          }
          if (audioObserved && completed) break;
          if (Date.now() >= startDeadline && !audioObserved) {
            setAudible(false);
            // Only an entirely silent first reading may be replayed, after
            // retiring its connection.
            throw new SubscriptionSpeechStartError(heard === 0 && silenceConfirmed);
          }
          if (Date.now() >= responseDeadline) throw new Error("The voice service did not finish the spoken response. Try again.");
          await pause(50);
        }
        check();
        if (epoch !== speechEpoch) return;
        if (!await settle(meter, epoch)) return;
        setAudible(false);
        // A reader that stopped well short of the end leaves the rest unread.
        // Ask for the unread sentences again rather than the whole message.
        if (guard.remainingWords >= TRUNCATION_WORDS) {
          throw new SpeechFidelityError(heard === 0 && guard.position === 0, heard + guard.resumeAt);
        }
        heard += part.length;
      }
      onProgress?.(1);
    } catch (caught) {
      if (epoch === speechEpoch) fail(caught);
      throw caught;
    } finally {
      if (epoch === speechEpoch) setAudible(false);
    }
  }
  // The live track is audible only while a guarded reading is in progress.
  const setAudible = (audible: boolean) => { if (player) player.volume = audible ? 1 : 0; };
  peer.ontrack = event => {
    const stream = new MediaStream([event.track]);
    player = new Audio();
    player.srcObject = stream;
    player.volume = 0;
    audioActivity.attach(stream);
    verifiedOutput.attach(stream);
    void player.play().catch(() => { fail(new Error("Allow audio playback in this browser and try again.")); });
  };
  peer.onconnectionstatechange = () => {
    clearTimeout(disconnectTimer);
    if (peer.connectionState === "failed" || peer.connectionState === "closed") {
      fail(new Error("The subscription audio connection ended. Try again."));
    } else if (peer.connectionState === "disconnected") {
      disconnectTimer = setTimeout(() => fail(new Error("The subscription audio connection was lost. Try again.")), 5000);
    }
  };
  channel.onclose = () => fail(new Error("The subscription voice control connection ended. Try again."));
  function close(): Promise<void> {
    return closing ??= dispose();
  }
  const onPageHide = () => { void close(); };
  function endSession(): Promise<unknown> {
    if (!id) return Promise.resolve();
    return sessionClosing ??= fetch(endpoint(), { method: "DELETE", keepalive: true, signal: AbortSignal.timeout(8000) }).catch(() => {});
  }
  function retireReader(): Promise<void> {
    const connection = readerConnection;
    reader?.stopSpeaking();
    reader = undefined;
    readerConnection = undefined;
    readerController?.abort();
    readerController = undefined;
    if (connection) {
      readerRetirement = Promise.all([readerRetirement, connection.then(voice => voice.close(), () => {})]).then(() => {});
    }
    return readerRetirement;
  }
  function connectReader(): Promise<SubscriptionVoice> {
    if (!readerConnection) {
      readerController = new AbortController();
      const connection = connectSubscriptionVoice({ mode: 'speak', signal: AbortSignal.any([signal, readerController.signal]) })
        .then(voice => { if (readerConnection === connection) reader = voice; return voice; }, caught => {
          if (readerConnection === connection) readerConnection = undefined;
          throw caught;
        });
      readerConnection = connection;
    }
    return readerConnection;
  }
  async function dispose() {
    if (closed) return;
    closed = true;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
    clearTimeout(disconnectTimer);
    // Start the keepalive request synchronously: a closing tab cannot wait
    // for AudioContext.close() or its reader before notifying the bridge.
    const sessionEnded = endSession();
    controller.abort();
    const readerClosing = retireReader();
    verifiedOutput.stop();
    audioActivity.close();
    player?.pause();
    if (player) player.srcObject = null;
    silent.stop();
    microphone?.disconnect();
    channel.close(); peer.close();
    destination.stream.getTracks().forEach(track => track.stop());
    await context.close().catch(() => {});
    // Closing during reader setup also waits for its aborted connection to
    // release the second session before the conversation can reconnect.
    await readerClosing;
    await sessionEnded;
    await polling;
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);
  try {
    void context.resume();
    await until(() => context.state === "running", 5000);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const mode = options.mode ?? (options.microphone ? 'conversation' : 'speak');
    let session;
    for (let attempt = 0; ; attempt++) {
      check();
      try {
        session = await request("/api/speech/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sdp: offer.sdp, mode }) });
        break;
      } catch (caught) {
        // Another page's companion releases its warm slots asynchronously.
        // Only an explicit capacity rejection proves no session was created;
        // never repeat an ambiguous creation failure or interrupt active voice.
        const delay = [200, 500, 1000, 2000, 3000][attempt];
        if (!(caught instanceof SubscriptionRequestError) || caught.status !== 429 || delay === undefined) throw caught;
        await pause(delay);
      }
    }
    id = session.id;
    if (closed) await endSession();
    check();
    pronunciations = typeof session.pronunciations === 'string' ? session.pronunciations : '';
    if (!OPENAI_SPEECH_VOICES.includes(session.voice)) throw new Error('The subscription service did not return the selected voice. Restart Breadboard and try again.');
    selectedVoice = session.voice;
    polling = (async () => {
      let cursor = 0;
      let failures = 0;
      while (!signal.aborted) {
        let batch;
        try {
          batch = await request(`${endpoint()}?cursor=${cursor}`);
          failures = 0;
        } catch (caught) {
          signal.throwIfAborted();
          const delay = [250, 750, 1500][failures++];
          // Event reads are safe to repeat at the same cursor. Never replay
          // session creation or appendSpeech after an ambiguous POST failure.
          if (delay === undefined || (caught instanceof SubscriptionRequestError &&
            caught.status < 500 && ![408, 429].includes(caught.status))) throw caught;
          await pause(delay);
          continue;
        }
        signal.throwIfAborted();
        cursor = batch.cursor;
        for (const event of batch.events as Event[]) {
          if (event.type === "sdp") answer = event.sdp;
          if (event.role === "user") {
            if (event.type === "transcriptDelta") partial += event.text || "";
            if (event.type === "transcript") { completed.push(event.text?.trim() || ""); partial = ""; }
            changedAt = Date.now();
            callbacks.onTranscript?.(text());
          }
          if (event.type === "transcriptDelta" && event.role === "assistant") liveTranscript += event.text || "";
          if (event.type === "transcript" && event.role === "assistant") {
            outputTranscript = event.text ?? '';
            liveTranscript = outputTranscript;
            outputVersion++;
          }
          if (event.type === "error" || event.type === "closed") throw new Error(event.message || "The ChatGPT voice connection ended. Reopen voice to reconnect.");
        }
      }
    })().catch(fail);
    await until(() => Boolean(answer));
    await peer.setRemoteDescription({ type: "answer", sdp: answer! });
    await until(() => channel.readyState === "open" && sessionStarted);
    // AVAS starts the media session separately from the native control call.
    // Apply the saved voice on the live session and wait for its acknowledgment
    // before any reader can unmute or append text. Creation parameters alone
    // do not establish that the running audio session applied the selection.
    voiceUpdateSent = true;
    channel.send(JSON.stringify({ type: 'session.update', session: { audio: { output: { voice: selectedVoice } } } }));
    await until(() => voiceConfirmed, 10000);
    // The control channel and local sender can start before the remote media
    // clock. AVAS can acknowledge an early script but never speak it. Wait for
    // packets in both directions, including silence from the remote reader.
    const mediaDeadline = Date.now() + 15000;
    while (true) {
      check();
      const stats = await peer.getStats();
      const audio = [...stats.values()].filter(item => item.kind === 'audio');
      if (audio.some(item => item.type === 'outbound-rtp' && item.packetsSent >= 10) &&
        audio.some(item => item.type === 'inbound-rtp' && item.packetsReceived >= 10)) break;
      if (Date.now() >= mediaDeadline) throw new Error("The voice audio connection did not become ready. Try again.");
      await pause(50);
    }
    connected = true;
  } catch (caught) { await close(); throw caught; }
  // Abort must also stop audio immediately, not just the next event poll.
  signal.addEventListener("abort", () => { void close(); }, { once: true });
  return {
    close,
    isHealthy() { return !closed && !signal.aborted && !error && !interruptedOutput && peer.connectionState !== "failed"; },
    setMicrophone(stream) {
      check();
      inputGain.gain.value = 0;
      microphone?.disconnect();
      microphone = context.createMediaStreamSource(stream);
      microphone.connect(inputGain);
    },
    setCallbacks(value) { callbacks = { onTranscript: value.onTranscript, onDisconnect: value.onDisconnect }; },
    setListening(listening: boolean) { inputGain.gain.value = listening ? 1 : 0; },
    resetTranscript() { partial = ""; completed = []; changedAt = 0; },
    transcript: text,
    stopSpeaking() {
      const interrupted = activeSpeechEpoch !== undefined;
      speechEpoch++;
      activeSpeechEpoch = undefined;
      setAudible(false);
      verifiedOutput.stop();
      // An idle reader has already drained its audio. Keep its connection for
      // the next turn; only an interrupted script can leave stale audio queued.
      if (interrupted) void retireReader();
      if (interrupted && !conversation) interruptedOutput = true;
    },
    async prepareSpeaker() {
      if (!conversation) return;
      const epoch = speechEpoch;
      await readerRetirement;
      check();
      if (reader && !reader.isHealthy()) await retireReader();
      check();
      if (epoch !== speechEpoch) return;
      await connectReader();
    },
    async finishTranscript() {
      inputGain.gain.value = 0;
      // A missed utterance is not a failed connection. Leave the duplex call
      // usable so the next turn can listen again.
      if (!await until(() => Boolean(text()), 15000, true)) return "";
      await until(() => Date.now() - changedAt > 500, 10000);
      return text();
    },
    async speak(spoken: string, play = true, onProgress?: (progress: number) => void) {
      check();
      if (interruptedOutput) throw new Error('This reading was interrupted. Open a fresh voice connection to continue.');
      if (activeSpeechEpoch !== undefined) throw new Error('A message is already being read on this voice connection.');
      const epoch = ++speechEpoch;
      activeSpeechEpoch = epoch;
      try {
        inputGain.gain.value = 0;
        if (conversation) {
          // Realtime may answer microphone input despite transcription-only
          // instructions. Unmuting that same track exposes its queued reply
          // ahead of the requested script, and its transcript can finish the
          // wrong reading. Only the output-only reader receives spoken scripts.
          // An interrupted reader can still have remote audio queued. Retire it
          // before opening another, so neither old words nor its session slot leak.
          await readerRetirement;
          check();
          if (epoch !== speechEpoch) return;
          if (reader && !reader.isHealthy()) await retireReader();
          // A reading that strayed resumes on a fresh reader from the sentence
          // it abandoned, so nothing already heard is repeated.
          let offset = 0;
          for (let attempt = 0; attempt < 3; attempt++) {
            check();
            if (epoch !== speechEpoch) return;
            try {
              const output = await connectReader();
              check();
              if (epoch !== speechEpoch) return;
              const remaining = spoken.slice(offset);
              await output.speak(remaining, play, progress => onProgress?.((offset + progress * remaining.length) / spoken.length));
              return;
            } catch (caught) {
              if (epoch !== speechEpoch) return;
              // Failed or unfaithful output must not poison the microphone or
              // remain cached. Retry only when nothing heard would be replayed.
              await retireReader();
              if (epoch !== speechEpoch) return;
              if (attempt < 2 && caught instanceof SpeechFidelityError && caught.resumeAt !== undefined) {
                offset += caught.resumeAt;
                if (!spoken.slice(offset).trim()) { onProgress?.(1); return; }
                continue;
              }
              if (attempt === 0 && (caught instanceof SubscriptionSpeechStartError || caught instanceof SpeechFidelityError) && caught.safeToRetry) continue;
              throw caught;
            }
          }
          return;
        }
        // Apply once, before splitting, so a multiword correction stays intact.
        // Duplex callers hand the original script to their output-only reader.
        spoken = applyPronunciations(spoken, pronunciations);
        if (play) { await speakLive(spoken, epoch, onProgress); return; }
        // Buffered output (downloads) is never heard live, so it keeps the
        // strict path: each passage is recorded, verified word for word and
        // only then kept. Passages are recorded one ahead of playback.
        let playback: Promise<void> = Promise.resolve();
        let playbackFailure: unknown;
        try {
          // Characters handed to playback. A later failure can no longer be
          // retried from the start once any of these may have been heard.
          let playedCharacters = 0;
          let rereadings = 0;
          for (const part of splitSpeechText(spoken)) {
            if (playbackFailure) throw playbackFailure;
            let audio: Blob | undefined;
            while (!audio) try {
              // Preparation never reports progress: the reading position comes
              // from the verified recording's actual playback clock below.
              const before = outputVersion;
              const beforeControl = controlOutputVersion;
              const initialStats = await peer.getStats();
              check();
              if (epoch !== speechEpoch) return;
              const meter = audioMeter(initialStats);
              const { receivedAudio, speechActive, initialEnergy } = meter;
              let audioObserved = false;
              let silenceConfirmed = false;
              await until(() => verifiedOutput.ready());
              check();
              if (epoch !== speechEpoch) return;
              await verifiedOutput.begin();
              check();
              if (epoch !== speechEpoch) return;
              // The speakable channel still interprets text as conversational
              // context. Bare notices such as "Your answer is ready" can produce
              // silence or an unrelated reply. Request a reading explicitly, then
              // verify the output against only the original passage below.
              const readingRequest = `Read aloud exactly this text. Say only these words, with no introduction or commentary: ${part}`;
              await request(endpoint(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: readingRequest }) });
              // Recover an accepted but silent first passage promptly. Replay is
              // allowed below only with positive evidence that no audio arrived.
              const startDeadline = Date.now() + 5000;
              const responseDeadline = Date.now() + 120000;
              // WebRTC sends completion directly as well as through the native
              // bridge. Once direct events are present, ignore their delayed bridge
              // copies so a previous passage cannot finish the next one.
              while (epoch === speechEpoch) {
                check();
                const stats = await peer.getStats();
                if (epoch !== speechEpoch) return;
                const incoming = receivedAudio(stats);
                const active = speechActive(stats);
                audioObserved ||= active === true ||
                  (typeof initialEnergy === 'number' && incoming?.totalAudioEnergy > initialEnergy);
                silenceConfirmed = typeof initialEnergy === 'number' && incoming?.totalAudioEnergy === initialEnergy;
                // Transcript/control events can arrive even when the remote track
                // stays silent. They neither prove speech started nor complete it.
                const completed = controlOutputSeen ? controlOutputVersion > beforeControl : outputVersion > before;
                // A transcript that does not match is judged by finish() below,
                // after the wrong audio has drained: a re-reading posted while
                // it is still arriving would record its tail as the new passage.
                if (audioObserved && completed) break;
                if (Date.now() >= startDeadline && !audioObserved) {
                  // Only an entirely silent first passage may be replayed, after
                  // retiring its connection. Never replay partially spoken text or
                  // an ambiguous failed POST.
                  throw new SubscriptionSpeechStartError(playedCharacters === 0 && silenceConfirmed);
                }
                if (Date.now() >= responseDeadline) throw new Error("The voice service did not finish the spoken response. Try again.");
                await pause(50);
              }
              check();
              if (epoch !== speechEpoch) return;
              if (!await settle(meter, epoch)) return;
              const transcript = controlOutputSeen ? controlTranscript : outputTranscript;
              audio = await verifiedOutput.finish(part, transcript, playedCharacters === 0);
            } catch (caught) {
              // The discarded recording was never audible and the remote track
              // is quiet again, so the same passage can simply be read once
              // more. Nothing already heard is repeated.
              if (!(caught instanceof SpeechFidelityError) || rereadings >= MAX_REREADINGS || epoch !== speechEpoch) throw caught;
              rereadings++;
              check();
            }
            check();
            if (epoch !== speechEpoch) return;
            const verified = audio;
            const start = playedCharacters;
            playedCharacters += part.length;
            playback = playback.then(async () => {
              if (epoch !== speechEpoch || signal.aborted) return;
              if (play) await verifiedOutput.play(verified, progress => {
                if (epoch === speechEpoch && !signal.aborted) onProgress?.((start + part.length * progress) / spoken.length);
              });
              if (epoch === speechEpoch && options.capture) verifiedOutput.keep(verified);
            });
            playback.catch(caught => { playbackFailure ??= caught; });
          }
          await playback;
          check();
          if (epoch !== speechEpoch) return;
          onProgress?.(1);
        } catch (caught) {
          // A passage that is already playing was verified. Let it finish rather
          // than cutting it off because the one after it failed.
          if (epoch === speechEpoch && !signal.aborted) await playback.catch(() => {});
          if (epoch === speechEpoch) fail(caught);
          throw caught;
        } finally {
          if (epoch === speechEpoch) {
            verifiedOutput.stop();
          }
        }
      } finally {
        if (activeSpeechEpoch === epoch) activeSpeechEpoch = undefined;
      }
    },
    async capture(): Promise<Blob> {
      if (!options.capture) throw new Error("Audio recording was not enabled for this connection.");
      return verifiedOutput.capture(context);
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

// A passage becomes audible only once its complete recording is verified, so
// the wait before the first word is the time the reader needs to speak the
// first passage. Open with a sentence-sized passage, then settle near ten
// seconds at a conversational pace: the reader records each passage while the
// previous one plays, and the gap between passages grows with the difference
// in their lengths. Large scripts also make the realtime reader rush to fit the
// whole passage into one audio turn.
const OPENING_PASSAGE_LIMITS = [{ maxCharacters: 80, maxWords: 12 }, { maxCharacters: 120, maxWords: 18 }];
const MAX_SPEECH_CHUNK_CHARACTERS = 160;
const MAX_SPEECH_CHUNK_WORDS = 24;
// A passage that stops mid-sentence reads as a fragment, and the realtime
// reader tends to "repair" fragments with words that are not in the script,
// which fails verification. Passages may run past their target to the end of
// the sentence, up to this cap, before a clause or word break is accepted.
const HARD_PASSAGE_LIMITS = { maxCharacters: 360, maxWords: 50 };
/** Unfaithful passages re-read per script before the reading gives up. */
const MAX_REREADINGS = 2;
// Live readings go to the reader whole, so a message plays as one continuous
// paragraph. The bridge accepts 4,000 characters per request including the
// reading instruction.
const LIVE_REQUEST_CHARACTERS = 3800;
/** Unread readable words that mean a live reading stopped early rather than ending a little differently. */
const TRUNCATION_WORDS = 3;

/** Requests for a live reading: the whole message unless it exceeds the bridge limit. */
export function splitLiveSpeechText(text: string): string[] {
  return splitSpeechPassages(text, { maxCharacters: LIVE_REQUEST_CHARACTERS });
}
const PASSAGE_GROWTH = { maxCharacters: 40, maxWords: 6 };

const endsSentence = (passage: string, text: string) =>
  passage.length === text.length || /(?:\n\s*\n|[.!?。！？]["'”’»）)\]]*)$/u.test(passage) || /^\s*\n\s*\n/u.test(text.slice(passage.length));

/** Only the head of a long text can influence its first passage. */
const head = (text: string, limits: { maxCharacters: number; maxWords: number }) =>
  splitSpeechPassages(text.slice(0, limits.maxCharacters + 2), limits)[0];

/** The first passage of `text`: the shortest sentence-ending prefix at or past the target, else the target split. */
function firstPassage(text: string, target: { maxCharacters: number; maxWords: number }): string {
  const preferred = head(text, target);
  let limits = target;
  let candidate = preferred;
  while (!endsSentence(candidate, text) && (limits.maxCharacters < HARD_PASSAGE_LIMITS.maxCharacters || limits.maxWords < HARD_PASSAGE_LIMITS.maxWords)) {
    limits = {
      maxCharacters: Math.min(HARD_PASSAGE_LIMITS.maxCharacters, limits.maxCharacters + PASSAGE_GROWTH.maxCharacters),
      maxWords: Math.min(HARD_PASSAGE_LIMITS.maxWords, limits.maxWords + PASSAGE_GROWTH.maxWords),
    };
    candidate = head(text, limits);
  }
  return endsSentence(candidate, text) ? candidate : preferred;
}

/** Short, sequential passages for a steady reading pace. Preserve all words. */
export function splitSpeechText(text: string): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  const steady = { maxCharacters: MAX_SPEECH_CHUNK_CHARACTERS, maxWords: MAX_SPEECH_CHUNK_WORDS };
  for (let index = 0; remaining; index++) {
    // Each passage is a prefix of the remaining text, so the remainder keeps
    // its original paragraph breaks for the later splits.
    const passage = firstPassage(remaining, OPENING_PASSAGE_LIMITS[index] ?? steady);
    parts.push(passage);
    remaining = remaining.slice(passage.length).trimStart();
  }
  return parts;
}
