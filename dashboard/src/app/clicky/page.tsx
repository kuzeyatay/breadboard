"use client";

import { useEffect, useRef, useState } from "react";
import type { ClickyMessage, ClickyPoint, ClickySnapshot } from "@/lib/clicky/companion";
import { encodePcm16Wav } from "@/lib/speech/live-dictation";
import { prepareLocalSpeech } from "@/lib/speech/prepare-client";
import { playSpeechBlob, stopSpeechPlayback } from "@/lib/speech/playback";
import styles from "./page.module.css";

interface CompanionBridge {
  capture(): Promise<ClickySnapshot[]>;
  point(target: ClickyPoint): Promise<boolean>;
  onToggleVoice(callback: () => void): () => void;
  onShortcut(callback: (available: boolean) => void): () => void;
}

interface Recording {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
  chunks: Float32Array[];
  timer: ReturnType<typeof setTimeout> | null;
}

async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error(body?.error || (response.status === 401
    ? "Sign in to Breadboard, then reopen Clicky."
    : "Clicky could not complete that request. Try again."));
}

export default function ClickyPage() {
  const [bridge, setBridge] = useState<CompanionBridge | null>(null);
  const [messages, setMessages] = useState<ClickyMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [stage, setStage] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const [includeScreen, setIncludeScreen] = useState(true);
  const [readAloud, setReadAloud] = useState(true);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shortcut, setShortcut] = useState(true);
  const recordingRef = useRef<Recording | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const toggleRef = useRef<() => void>(() => {});
  const endRef = useRef<HTMLDivElement | null>(null);

  function releaseRecording(): Recording | null {
    const capture = recordingRef.current;
    recordingRef.current = null;
    if (!capture) return null;
    if (capture.timer) clearTimeout(capture.timer);
    capture.processor.onaudioprocess = null;
    capture.source.disconnect();
    capture.processor.disconnect();
    capture.sink.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close();
    return capture;
  }

  function cancel() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    releaseRecording();
    stopSpeechPlayback();
    setBusy(false);
    setRecording(false);
    setStage("Ready");
  }

  useEffect(() => {
    const native = (window as Window & { clickyCompanion?: CompanionBridge }).clickyCompanion;
    if (!native) return;
    setBridge(native);
    const removeVoice = native.onToggleVoice(() => toggleRef.current());
    const removeShortcut = native.onShortcut(setShortcut);
    return () => {
      removeVoice();
      removeShortcut();
      controllerRef.current?.abort();
      controllerRef.current = null;
      releaseRecording();
      stopSpeechPlayback();
    };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, stage]);

  async function ask(text: string, controller?: AbortController) {
    if (!bridge || !text.trim() || (!controller && controllerRef.current)) return;
    const operation = controller ?? new AbortController();
    controllerRef.current = operation;
    setBusy(true);
    setError(null);
    stopSpeechPlayback();
    try {
      const nextMessages: ClickyMessage[] = [...messages.slice(-14), { role: "user", content: text.trim() }];
      setStage(includeScreen ? "Taking a screen snapshot…" : "Thinking…");
      const snapshots = includeScreen ? await bridge.capture() : [];
      operation.signal.throwIfAborted();
      setStage("Thinking…");
      const response = await fetch("/api/clicky/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, snapshots }), signal: operation.signal,
      });
      if (!response.ok) throw await responseError(response);
      const reply = await response.json() as { text: string; point: ClickyPoint | null };
      operation.signal.throwIfAborted();
      setMessages([...nextMessages, { role: "assistant", content: reply.text }]);
      setQuestion("");
      if (reply.point) await bridge.point(reply.point);
      operation.signal.throwIfAborted();
      if (readAloud) {
        setStage("Preparing speech…");
        await prepareLocalSpeech(operation.signal);
        const speech = await fetch("/api/speech/synthesize", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: reply.text }), signal: operation.signal,
        });
        if (!speech.ok) throw await responseError(speech);
        const audio = await speech.blob();
        operation.signal.throwIfAborted();
        setStage("Speaking…");
        await new Promise<void>((resolve, reject) => {
          const abort = () => { stopSpeechPlayback(); resolve(); };
          operation.signal.addEventListener("abort", abort, { once: true });
          void playSpeechBlob(audio, () => {
            operation.signal.removeEventListener("abort", abort);
            resolve();
          }).catch(reject);
        });
      }
    } catch (failure) {
      if (!operation.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Clicky could not answer. Try again.");
        setQuestion(text);
      }
    } finally {
      if (controllerRef.current === operation) {
        controllerRef.current = null;
        setBusy(false);
        setStage("Ready");
      }
    }
  }

  async function finishRecording() {
    const capture = releaseRecording();
    const operation = controllerRef.current;
    setRecording(false);
    if (!capture || !operation || operation.signal.aborted) return;
    setBusy(true);
    setStage("Transcribing…");
    try {
      const form = new FormData();
      form.set("file", encodePcm16Wav(capture.chunks, capture.context.sampleRate), "clicky.wav");
      await prepareLocalSpeech(operation.signal);
      let transcript = "";
      for (let attempt = 0; attempt < 120; attempt++) {
        const response = await fetch("/api/speech/transcribe", { method: "POST", body: form, signal: operation.signal });
        if (response.status === 202) {
          setStage("Preparing the speech model…");
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(operation.signal.reason); };
            const timer = setTimeout(() => {
              operation.signal.removeEventListener("abort", abort);
              resolve();
            }, 2500);
            operation.signal.addEventListener("abort", abort, { once: true });
            if (operation.signal.aborted) abort();
          });
          continue;
        }
        if (!response.ok) throw await responseError(response);
        const body = await response.json();
        transcript = typeof body.text === "string" ? body.text.trim() : "";
        break;
      }
      if (!transcript) throw new Error("No speech was transcribed. Check your microphone and try again.");
      operation.signal.throwIfAborted();
      setQuestion(transcript);
      await ask(transcript, operation);
    } catch (failure) {
      if (!operation.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not transcribe the recording.");
    } finally {
      if (controllerRef.current === operation) {
        controllerRef.current = null;
        setBusy(false);
        setStage("Ready");
      }
    }
  }

  async function toggleVoice() {
    if (recordingRef.current) { await finishRecording(); return; }
    if (!bridge || controllerRef.current) return;
    const operation = new AbortController();
    controllerRef.current = operation;
    setBusy(true);
    setError(null);
    setStage("Opening microphone…");
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      operation.signal.throwIfAborted();
      context = new AudioContext();
      await context.resume();
      operation.signal.throwIfAborted();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const sink = context.createGain();
      sink.gain.value = 0;
      const capture: Recording = { stream, context, source, processor, sink, chunks: [], timer: null };
      processor.onaudioprocess = (event) => {
        if (recordingRef.current === capture) capture.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);
      recordingRef.current = capture;
      capture.timer = setTimeout(() => toggleRef.current(), 60_000);
      setRecording(true);
      setBusy(false);
      setStage("Listening… click Stop & send when finished");
    } catch (failure) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") void context.close();
      if (!operation.signal.aborted) setError(failure instanceof Error && failure.name === "NotAllowedError"
        ? "Allow desktop apps to use your microphone in Windows Settings → Privacy & security → Microphone."
        : "Clicky could not open the microphone. Check your input device and try again.");
      if (controllerRef.current === operation) {
        controllerRef.current = null;
        setBusy(false);
        setStage("Ready");
      }
    }
  }
  toggleRef.current = () => { void toggleVoice(); };

  return (
    <main className={styles.companion}>
      <header className={styles.header}>
        <span className={styles.cursor} aria-hidden>➤</span>
        <div><h1>Clicky</h1><p>Your screen companion</p></div>
        <button type="button" disabled={busy || recording || !messages.length} onClick={() => { setMessages([]); setError(null); }}>Clear</button>
      </header>
      <section className={styles.conversation} aria-label="Conversation">
        {!messages.length && <div className={styles.welcome}>
          <h2>What are you working on?</h2>
          <p>Ask about what’s on your screen. I can explain it, talk you through the next step, and point things out.</p>
          {!bridge && <p>Open Clicky from Breadboard’s Windows desktop app to connect to your screen.</p>}
        </div>}
        {messages.map((message, index) => <article key={index} className={message.role === "user" ? styles.question : styles.answer}>
          <span>{message.role === "user" ? "You" : "Clicky"}</span><p>{message.content}</p>
        </article>)}
        <div ref={endRef} />
      </section>
      <footer className={styles.controls}>
        <p className={styles.status} role="status">{stage}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <form onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
          <textarea aria-label="Ask Clicky" placeholder="Ask about your screen…" value={question} maxLength={8000}
            disabled={!bridge || busy || recording} onChange={(event) => setQuestion(event.target.value)} rows={2}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(question); } }} />
          <div className={styles.actions}>
            <button type="button" disabled={!bridge || busy} className={recording ? styles.recording : ""} onClick={() => void toggleVoice()}>{recording ? "Stop & send" : "Speak"}</button>
            {(busy || recording) && <button type="button" onClick={cancel}>Cancel</button>}
            <button type="submit" disabled={!bridge || busy || recording || !question.trim()} className={styles.send}>Send</button>
          </div>
        </form>
        <div className={styles.preferences}>
          <label><input type="checkbox" checked={includeScreen} disabled={busy || recording} onChange={(event) => setIncludeScreen(event.target.checked)} /> Include screen snapshots</label>
          <label><input type="checkbox" checked={readAloud} disabled={busy || recording} onChange={(event) => setReadAloud(event.target.checked)} /> Read replies aloud</label>
        </div>
        <p className={styles.help}>{includeScreen ? "A snapshot of each screen is sent with your question. " : "Screen sharing is off. "}
          {shortcut ? "Ctrl + Alt + Space starts or stops recording." : "The keyboard shortcut is in use. Use Speak to record."}</p>
      </footer>
    </main>
  );
}
