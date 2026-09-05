"use client";

import { speechRequest } from "@/lib/speech/request-client";
import { playSubscriptionText } from "@/lib/speech/playback";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ClickyMessage, ClickyPoint, ClickySnapshot } from "@/lib/clicky/companion";
import { encodePcm16Wav } from "@/lib/speech/live-dictation";
import { prepareLocalSpeech } from "@/lib/speech/prepare-client";
import { playSpeechBlob, stopSpeechPlayback } from "@/lib/speech/playback";
import { speakWithSystemVoice } from "@/lib/clicky/system-speech";
import { notifyHermesSessionsChanged } from "@/lib/hermes/session-client";
import styles from "./page.module.css";

const YOLO_MODE_STORAGE_KEY = "breadboard.clicky.yoloMode";

interface CompanionBridge {
  capture(): Promise<ClickySnapshot[]>;
  point(target: ClickyPoint): Promise<boolean>;
  click(): Promise<boolean>;
  resetTarget(): Promise<void>;
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
  if (response.status === 401) return new Error("Sign in to Breadboard, then reopen Clicky.");
  const body = await response.json().catch(() => null);
  return new Error(body?.error || "Clicky could not complete that request. Try again.");
}

export default function ClickyPage() {
  const [bridge, setBridge] = useState<CompanionBridge | null>(null);
  const [messages, setMessages] = useState<ClickyMessage[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const [question, setQuestion] = useState("");
  const [stage, setStage] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const [includeScreen, setIncludeScreen] = useState(true);
  const [readAloud, setReadAloud] = useState(true);
  const [yoloMode, setYoloMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shortcut, setShortcut] = useState(true);
  const [target, setTarget] = useState<ClickyPoint | null>(null);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const recordingRef = useRef<Recording | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const toggleRef = useRef<() => void>(() => {});
  const conversationRef = useRef<HTMLElement | null>(null);

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
    setTarget(null);
    void bridge?.resetTarget();
    setBusy(false);
    setRecording(false);
    setStage("Ready");
  }

  useEffect(() => {
    try {
      setYoloMode(localStorage.getItem(YOLO_MODE_STORAGE_KEY) === "true");
    } catch { /* Keep the default when preferences cannot be read. */ }
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

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages, stage]);

  useEffect(() => {
    if (!target) return;
    const timer = setTimeout(() => setTarget(null), 60_000);
    return () => clearTimeout(timer);
  }, [target]);

  function changeYoloMode(enabled: boolean) {
    setYoloMode(enabled);
    setTarget(null);
    void bridge?.resetTarget();
    try {
      localStorage.setItem(YOLO_MODE_STORAGE_KEY, String(enabled));
    } catch { /* The switch still works for this window without storage. */ }
  }

  async function clickTarget() {
    if (!bridge || !target || recording) return;
    const typesText = Boolean(target.inputText);
    controllerRef.current?.abort();
    stopSpeechPlayback();
    setBusy(true);
    setError(null);
    setStage(typesText ? "Clicking and typing…" : "Clicking target…");
    const operation = new AbortController();
    controllerRef.current = operation;
    setTarget(null);
    try {
      if (!await bridge.click()) throw new Error("The target could not be clicked. Ask me to look again.");
      setStage(typesText ? "Text entered" : "Click sent");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Windows could not complete that action.");
      setStage("Ready");
    } finally {
      if (controllerRef.current === operation) controllerRef.current = null;
      setBusy(false);
    }
  }

  async function ask(text: string, controller?: AbortController) {
    if (!bridge || !text.trim() || (!controller && controllerRef.current)) return;
    const operation = controller ?? new AbortController();
    controllerRef.current = operation;
    setBusy(true);
    setError(null);
    setSpeechNotice(null);
    setTarget(null);
    stopSpeechPlayback();
    let answered = false;
    try {
      await bridge.resetTarget();
      const nextMessages: ClickyMessage[] = [...messages.slice(-14), { role: "user", content: text.trim() }];
      setStage(includeScreen ? "Taking a screen snapshot…" : "Thinking…");
      const snapshots = includeScreen ? await bridge.capture() : [];
      operation.signal.throwIfAborted();
      setStage("Thinking…");
      if (!conversationIdRef.current) {
        const created = await fetch("/api/clicky/sessions", { method: "POST", signal: operation.signal });
        if (!created.ok) throw await responseError(created);
        const session = await created.json() as { conversationId: string };
        conversationIdRef.current = session.conversationId;
      }
      operation.signal.throwIfAborted();
      const response = await fetch("/api/clicky/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, snapshots, conversationId: conversationIdRef.current, yoloMode }), signal: operation.signal,
      });
      notifyHermesSessionsChanged("dashboard_terminal");
      if (!response.ok) throw await responseError(response);
      const reply = await response.json() as { text: string; point: ClickyPoint | null; conversationId: string };
      operation.signal.throwIfAborted();
      conversationIdRef.current = reply.conversationId;
      setMessages([...nextMessages, { role: "assistant", content: reply.text }]);
      setQuestion("");
      answered = true;
      if (reply.point && await bridge.point(reply.point)) {
        operation.signal.throwIfAborted();
        if (yoloMode) {
          setStage(reply.point.inputText ? "Clicking and typing…" : "Clicking target…");
          if (!await bridge.click()) throw new Error("The target could not be clicked. Ask me to look again.");
        } else {
          setTarget(reply.point);
        }
      }
      operation.signal.throwIfAborted();
      if (readAloud) {
        try {
          setStage("Preparing speech…");
          await prepareLocalSpeech(operation.signal);
          let finishCloud!: (error?: Error) => void;
          const cloudFinished = new Promise<void>((resolve, reject) => { finishCloud = (error) => error ? reject(error) : resolve(); });
          if (await playSubscriptionText(reply.text, finishCloud, operation.signal)) {
            setStage("Speaking…");
            await cloudFinished;
          } else {
          const speech = await speechRequest("/api/speech/synthesize", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: reply.text }), signal: operation.signal,
          });
          if (!speech.ok) throw await responseError(speech);
          const audio = await speech.blob();
          operation.signal.throwIfAborted();
          setStage("Speaking…");
          let finishPlayback!: () => void;
          const playbackFinished = new Promise<void>((resolve) => { finishPlayback = resolve; });
          const abort = () => { stopSpeechPlayback(); finishPlayback(); };
          operation.signal.addEventListener("abort", abort, { once: true });
          try {
            await playSpeechBlob(audio, finishPlayback);
            await playbackFinished;
          } finally {
            operation.signal.removeEventListener("abort", abort);
          }
          }
        } catch {
          operation.signal.throwIfAborted();
          setStage("Reading with Windows voice…");
          const read = await speakWithSystemVoice(reply.text.replace(/\*\*|__|`/g, ""), operation.signal)
            .catch(() => { operation.signal.throwIfAborted(); return false; });
          setSpeechNotice(read
            ? "Read with your Windows voice; the selected speech voice is unavailable."
            : "Read-aloud is unavailable. You can still use this answer and click its target.");
        }
      }
    } catch (failure) {
      if (!operation.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Clicky could not answer. Try again.");
        if (!answered) setQuestion(text);
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
        const response = await speechRequest("/api/speech/transcribe", { method: "POST", body: form, signal: operation.signal });
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
      <div className={styles.titleBar} aria-hidden="true" />
      <header className={styles.header}>
        <span className={styles.cursor} aria-hidden>➤</span>
        <div><h1>Clicky</h1><p>Your screen companion</p></div>
        <button type="button" disabled={busy || recording || !messages.length} onClick={() => { conversationIdRef.current = null; setMessages([]); setError(null); setSpeechNotice(null); setTarget(null); void bridge?.resetTarget(); }}>Clear</button>
      </header>
      <section ref={conversationRef} className={styles.conversation} aria-label="Conversation" aria-live="polite">
        {!messages.length && <div className={styles.welcome}>
          <h2>What are you working on?</h2>
          <p>Ask about your screen. I can explain what you see, highlight the next step, and {yoloMode ? "click and type automatically with YOLO mode on." : "click a target when you choose."}</p>
          {!bridge && <p>Open Clicky from Breadboard’s Windows desktop app to connect to your screen.</p>}
        </div>}
        {messages.map((message, index) => <article key={index} className={message.role === "user" ? styles.question : styles.answer}>
          <span className={styles.author}>{message.role === "user" ? "You" : "Clicky"}</span>
          <div className={styles.messageBody}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]}
            components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>
            {message.content}
          </ReactMarkdown></div>
        </article>)}
      </section>
      <footer className={styles.controls}>
        <div className={styles.statusRow}>
          <p className={styles.status} role="status">{stage}</p>
          {target && <div className={styles.targetActions}>
            <button
              type="button"
              className={styles.target}
              disabled={recording}
              title={target.inputText
                ? `Click, type “${target.inputText}”${target.pressEnter ? ", then press Enter" : ""}`
                : "Click the highlighted target"}
              onClick={() => void clickTarget()}
            >
              {target.inputText ? "Click & type" : "Click target"}
            </button>
            <button type="button" aria-label="Dismiss target" title="Dismiss target" onClick={() => { setTarget(null); void bridge?.resetTarget(); }}>×</button>
          </div>}
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {speechNotice && <p className={styles.notice}>{speechNotice}</p>}
        <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
          <textarea aria-label="Ask Clicky" placeholder="Ask about your screen…" value={question} maxLength={8000}
            disabled={!bridge || busy || recording} onChange={(event) => setQuestion(event.target.value)} rows={1}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(question); } }} />
          <div className={styles.actions}>
            <button
              type="button"
              disabled={!bridge || busy}
              className={`${styles.composerAction} ${recording ? styles.recording : ""}`}
              aria-label={recording ? "Stop and send recording" : "Speak"}
              title={recording ? "Stop and send" : "Speak"}
              onClick={() => void toggleVoice()}
            >
              {recording ? (
                <span className={styles.stopIcon} aria-hidden />
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden>
                  <rect x="8" y="3" width="8" height="12" rx="4" />
                  <path d="M5.5 11.5v.5a6.5 6.5 0 0 0 13 0v-.5M12 18.5V22M8.5 22h7" />
                </svg>
              )}
              <span className={styles.srOnly}>{recording ? "Stop & send" : "Speak"}</span>
            </button>
            {(busy || recording) && (
              <button type="button" className={styles.composerAction} aria-label="Cancel" title="Cancel" onClick={cancel}>
                <svg viewBox="0 0 24 24" aria-hidden><path d="M7 7l10 10M17 7 7 17" /></svg>
                <span className={styles.srOnly}>Cancel</span>
              </button>
            )}
            <button
              type="submit"
              disabled={!bridge || busy || recording || !question.trim()}
              className={`${styles.composerAction} ${styles.send}`}
              aria-label="Send"
              title="Send"
            >
              <svg viewBox="0 0 24 24" aria-hidden><path d="M12 19.5v-15m0 0-6 6m6-6 6 6" /></svg>
              <span className={styles.srOnly}>Send</span>
            </button>
          </div>
        </form>
        <div className={styles.preferences}>
          <label title="Include a snapshot of each display with your question"><input type="checkbox" checked={includeScreen} disabled={busy || recording} onChange={(event) => { setIncludeScreen(event.target.checked); setTarget(null); void bridge?.resetTarget(); }} /> Share screen</label>
          <label><input type="checkbox" checked={readAloud} disabled={busy || recording} onChange={(event) => setReadAloud(event.target.checked)} /> Read aloud</label>
          <label className={styles.yoloPreference} title="Automatically click and type without asking for permission">
            <input type="checkbox" role="switch" checked={yoloMode} disabled={busy || recording} onChange={(event) => changeYoloMode(event.target.checked)} /> YOLO mode
          </label>
        </div>
        {yoloMode && <p className={styles.yoloStatus}>YOLO is on · Clicks and typing run without approval.</p>}
        <p className={styles.help}>{shortcut ? "Ctrl + Alt + Space to speak" : "Shortcut in use — use Speak"}</p>
      </footer>
    </main>
  );
}
