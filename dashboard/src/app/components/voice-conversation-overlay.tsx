'use client';

/**
 * Voice mode — the whole screen, one drawn ring, and the chat underneath.
 *
 * Double-tapping the composer's microphone opens this. Everything said here is
 * sent through the host's ordinary chat send, so the conversation is already in
 * the transcript the moment the screen is closed: this is a way to talk to the
 * same chat, not a second one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { encodePcm16Wav } from '@/lib/speech/live-dictation';
import { describeMicrophoneBlock, type MicrophoneFix } from '@/lib/speech/microphone-access';
import { playSpeechBlob, stopSpeechPlayback } from '@/lib/speech/playback';
import {
  advanceVoiceTurn,
  frameLevel,
  haloRings,
  initialVoiceTurn,
  inkRingPath,
  inkUnderlinePath,
  latestAssistantReply,
  replyKey,
  scribbleRings,
  speakableText,
  speechThreshold,
  stageLabel,
  voiceTurnVerdict,
  type VoiceMessage,
  type VoiceStage,
} from '@/lib/speech/voice-conversation';

/** The desktop shell, where one exists: it paints the window's own chrome. */
interface DesktopWindowBridge {
  setTheme?: (surface: 'light' | 'dark' | 'voice') => Promise<boolean>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Sends one spoken turn through the host's normal chat send. */
  onSend: (text: string) => void;
  /** The host's live chat messages — where the answer to read out comes from. */
  messages: readonly VoiceMessage[];
  /** True while the host is generating an answer. */
  busy: boolean;
}

/**
 * How long a turn has to *reach* the chat — not to be answered. Once the host
 * picks it up, the answer takes as long as it takes; an agent that thinks for
 * two minutes is working, not lost.
 */
const DISPATCH_WATCHDOG_MS = 20_000;
const RING_VIEWBOX = 200;
const RING_RADIUS = 62;
/**
 * The halo stays out this long after the last loud frame, so the gaps between
 * words do not make it flicker in and out.
 */
const VOICING_HOLD_MS = 420;

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const error = body?.error;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}

export default function VoiceConversationOverlay({
  open,
  onClose,
  onSend,
  messages,
  busy,
}: Props) {
  const [stage, setStage] = useState<VoiceStage>('opening');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<MicrophoneFix | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const stageNodeRef = useRef<HTMLDivElement | null>(null);
  const ringButtonRef = useRef<HTMLButtonElement | null>(null);
  const captureRef = useRef<{
    stream: MediaStream;
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    sink: GainNode;
  } | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const turnRef = useRef(initialVoiceTurn());
  const listeningRef = useRef(false);
  const levelRef = useRef(0);
  const smoothedRef = useRef(0);
  const stageRef = useRef<VoiceStage>('opening');
  const awaitingRef = useRef(false);
  const answeredKeyRef = useRef<string | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const deferredFinishRef = useRef<number | null>(null);
  const resumeListeningRef = useRef<number | null>(null);
  const requestAbortRef = useRef<Set<AbortController>>(new Set());
  /** The chat has taken the turn: it is generating, or the turn is in its log. */
  const dispatchedRef = useRef(false);
  const sentMessageCountRef = useRef(0);
  /** Bumped on every close, so audio callbacks from a past session go nowhere. */
  const sessionRef = useRef(0);
  const messagesRef = useRef(messages);
  const busyRef = useRef(busy);

  messagesRef.current = messages;
  busyRef.current = busy;

  const enterStage = useCallback((next: VoiceStage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  }, []);

  const clearDeferredWork = useCallback(() => {
    if (deferredFinishRef.current !== null) {
      window.clearTimeout(deferredFinishRef.current);
      deferredFinishRef.current = null;
    }
    if (resumeListeningRef.current !== null) {
      window.clearTimeout(resumeListeningRef.current);
      resumeListeningRef.current = null;
    }
    for (const controller of requestAbortRef.current) controller.abort();
    requestAbortRef.current.clear();
  }, []);

  const releaseMicrophone = useCallback(() => {
    listeningRef.current = false;
    const capture = captureRef.current;
    captureRef.current = null;
    chunksRef.current = [];
    if (!capture) return;
    capture.processor.onaudioprocess = null;
    capture.source.disconnect();
    capture.processor.disconnect();
    capture.sink.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close();
  }, []);

  const beginTurn = useCallback(() => {
    if (resumeListeningRef.current !== null) {
      window.clearTimeout(resumeListeningRef.current);
      resumeListeningRef.current = null;
    }
    chunksRef.current = [];
    turnRef.current = initialVoiceTurn();
    listeningRef.current = true;
    enterStage('listening');
  }, [enterStage]);

  /** Transcribe the buffered utterance and hand it to the chat. */
  const finishTurn = useCallback(
    async (session: number) => {
      const capture = captureRef.current;
      const chunks = chunksRef.current;
      chunksRef.current = [];
      if (!capture || chunks.length === 0) return;
      enterStage('transcribing');

      const wav = encodePcm16Wav(chunks, capture.context.sampleRate);
      const controller = new AbortController();
      requestAbortRef.current.add(controller);
      try {
        const form = new FormData();
        form.set('file', wav, 'voice-turn.wav');
        const response = await fetch('/api/speech/transcribe', {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });
        if (session !== sessionRef.current) return;
        if (response.status === 202) {
          setNote('Voicebox is still downloading the transcription model. Say that again in a moment.');
          beginTurn();
          return;
        }
        if (!response.ok) {
          setNote(await responseMessage(response, 'That could not be transcribed.'));
          beginTurn();
          return;
        }
        const result = (await response.json()) as { text?: string };
        const text = result.text?.trim() ?? '';
        if (session !== sessionRef.current) return;
        if (!text) {
          setNote('I did not catch that.');
          beginTurn();
          return;
        }

        setNote(null);
        setHeard(text);
        setReply('');
        answeredKeyRef.current = replyKey(messagesRef.current);
        sentMessageCountRef.current = messagesRef.current.length;
        dispatchedRef.current = false;
        awaitingRef.current = true;
        enterStage('thinking');
        onSend(text);
        clearWatchdog();
        watchdogRef.current = window.setTimeout(() => {
          // Only a turn the chat never picked up is lost. One it is still
          // thinking about is left alone however long it takes — the ring can
          // be tapped to stop waiting.
          if (session !== sessionRef.current || !awaitingRef.current) return;
          if (dispatchedRef.current || busyRef.current) return;
          awaitingRef.current = false;
          setNote('That did not reach the chat. Try again.');
          beginTurn();
        }, DISPATCH_WATCHDOG_MS);
      } catch {
        if (session !== sessionRef.current) return;
        setNote('That could not be transcribed.');
        beginTurn();
      } finally {
        requestAbortRef.current.delete(controller);
      }
    },
    [beginTurn, clearWatchdog, enterStage, onSend],
  );

  const openMicrophone = useCallback(async () => {
    const session = sessionRef.current;
    setBlocked(null);
    enterStage('opening');
    if (!navigator.mediaDevices?.getUserMedia) {
      setNote('This browser cannot open a microphone.');
      enterStage('blocked');
      return;
    }
    const AudioContextClass = audioContextConstructor();
    if (!AudioContextClass) {
      setNote('This browser cannot analyse microphone audio.');
      enterStage('blocked');
      return;
    }

    let openingStream: MediaStream | null = null;
    let openingContext: AudioContext | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      openingStream = stream;
      if (session !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const context = new AudioContextClass();
      openingContext = context;
      if (context.state === 'suspended') await context.resume();
      if (session !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      // A silent sink keeps the processor scheduled without feeding the speakers.
      const sink = context.createGain();
      sink.gain.value = 0;

      processor.onaudioprocess = (event) => {
        if (session !== sessionRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        const level = frameLevel(input);
        levelRef.current = level;
        if (!listeningRef.current) return;

        const copy = new Float32Array(input.length);
        copy.set(input);
        chunksRef.current.push(copy);
        const frameMs = (input.length / context.sampleRate) * 1_000;
        turnRef.current = advanceVoiceTurn(turnRef.current, level, frameMs);
        const verdict = voiceTurnVerdict(turnRef.current);
        if (verdict === 'send') {
          listeningRef.current = false;
          // Encoding a whole turn takes long enough to stutter the next audio
          // frame, so it happens after this callback returns, not inside it.
          if (deferredFinishRef.current !== null) {
            window.clearTimeout(deferredFinishRef.current);
          }
          deferredFinishRef.current = window.setTimeout(() => {
            deferredFinishRef.current = null;
            void finishTurn(session);
          }, 0);
        } else if (verdict === 'silent') {
          // Nobody spoke. Drop the silence rather than transcribing a room.
          chunksRef.current = [];
          turnRef.current = initialVoiceTurn();
        }
      };

      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);
      captureRef.current = { stream, context, source, processor, sink };
      openingStream = null;
      openingContext = null;
      beginTurn();
    } catch (caught) {
      openingStream?.getTracks().forEach((track) => track.stop());
      void openingContext?.close();
      if (session !== sessionRef.current) return;
      releaseMicrophone();
      if (caught instanceof DOMException && caught.name === 'NotAllowedError') {
        setBlocked(await describeMicrophoneBlock(caught));
      } else {
        setNote(caught instanceof Error ? caught.message : 'The microphone could not be opened.');
      }
      enterStage('blocked');
    }
  }, [beginTurn, enterStage, finishTurn, releaseMicrophone]);

  /* --- session lifecycle ------------------------------------------------- */

  useEffect(() => {
    if (!open) return;
    sessionRef.current += 1;
    setHeard('');
    setReply('');
    setNote(null);
    setShowTranscript(false);
    awaitingRef.current = false;
    void openMicrophone();
    return () => {
      sessionRef.current += 1;
      awaitingRef.current = false;
      clearWatchdog();
      clearDeferredWork();
      stopSpeechPlayback();
      releaseMicrophone();
    };
    // openMicrophone is stable for the life of an open session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Voice mode fills the window, so it takes the window's own chrome with it:
  // the desktop shell's caption strip and the native buttons in it would
  // otherwise sit on top of the terracotta as a cream band. The window goes
  // back to the app's theme on close.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.dataset.voiceStage = 'open';
    const shell = (window as Window & { breadboardDesktop?: DesktopWindowBridge })
      .breadboardDesktop;
    void shell?.setTheme?.('voice');
    return () => {
      delete root.dataset.voiceStage;
      void shell?.setTheme?.(root.dataset.theme === 'dark' ? 'dark' : 'light');
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Keyboard focus follows the screen, so Tab and Enter act on the ring
    // rather than on the composer still mounted behind it.
    const focusFrame = window.requestAnimationFrame(() => ringButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  /* --- the answer -------------------------------------------------------- */

  const speakReply = useCallback(
    async (text: string) => {
      const session = sessionRef.current;
      setReply(text);
      enterStage('speaking');
      const spoken = speakableText(text);
      if (!spoken) {
        beginTurn();
        return;
      }
      const controller = new AbortController();
      requestAbortRef.current.add(controller);
      try {
        const response = await fetch('/api/speech/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: spoken }),
          signal: controller.signal,
        });
        if (session !== sessionRef.current) return;
        if (!response.ok) throw new Error(await responseMessage(response, 'That answer could not be spoken.'));
        await playSpeechBlob(await response.blob(), () => {
          if (session !== sessionRef.current) return;
          beginTurn();
        });
      } catch (caught) {
        if (session !== sessionRef.current) return;
        setNote(caught instanceof Error ? caught.message : 'That answer could not be spoken.');
        // The answer is on screen and already in the chat, so reading time is
        // all that is owed before the microphone opens again — roughly as long
        // as the answer takes to read, and the ring cuts it short.
        if (resumeListeningRef.current !== null) {
          window.clearTimeout(resumeListeningRef.current);
        }
        resumeListeningRef.current = window.setTimeout(
          () => {
            resumeListeningRef.current = null;
            if (session === sessionRef.current) beginTurn();
          },
          Math.min(9_000, 1_500 + spoken.length * 25),
        );
      } finally {
        requestAbortRef.current.delete(controller);
      }
    },
    [beginTurn, enterStage],
  );

  useEffect(() => {
    if (!open || !awaitingRef.current) return;
    // The chat is generating, or the turn is already in its log: either way it
    // arrived, so the dispatch watchdog has nothing left to catch.
    if (busy || messages.length > sentMessageCountRef.current) {
      if (!dispatchedRef.current) {
        dispatchedRef.current = true;
        clearWatchdog();
      }
    }
    // While the answer streams, show it forming; only speak the settled text.
    if (busy) {
      const streaming = latestAssistantReply(messages);
      if (streaming) setReply(streaming);
      return;
    }
    const key = replyKey(messages);
    if (!key || key === answeredKeyRef.current) return;
    const text = latestAssistantReply(messages);
    if (!text) return;
    awaitingRef.current = false;
    answeredKeyRef.current = key;
    clearWatchdog();
    void speakReply(text);
  }, [busy, clearWatchdog, messages, open, speakReply]);

  /* --- drawing ----------------------------------------------------------- */

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let voicing = false;
    let lastLoudAt = 0;
    const tick = () => {
      const node = stageNodeRef.current;
      smoothedRef.current = smoothedRef.current * 0.8 + levelRef.current * 0.2;
      // The level drives the ring and the wave through a custom property, so a
      // 60 fps meter never re-renders React.
      const visible = Math.min(1, smoothedRef.current * 6);
      node?.style.setProperty('--voice-level', visible.toFixed(3));

      // Is someone talking *right now*? The same threshold the turn uses, held
      // briefly past the last loud frame so the halo does not blink out in the
      // gap between two words.
      const now = performance.now();
      const loud =
        stageRef.current === 'listening' &&
        smoothedRef.current >= speechThreshold(turnRef.current.noiseFloor);
      if (loud) lastLoudAt = now;
      const next = stageRef.current === 'listening' && now - lastLoudAt < VOICING_HOLD_MS;
      if (next !== voicing) {
        voicing = next;
        if (node) node.dataset.voicing = next ? 'true' : 'false';
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const centre = RING_VIEWBOX / 2;
  const ringPath = useMemo(() => inkRingPath(11, centre, centre, RING_RADIUS, 0.035, 18), [centre]);
  const echoPath = useMemo(() => inkRingPath(29, centre, centre, RING_RADIUS, 0.055, 16), [centre]);
  const scribblePaths = useMemo(() => scribbleRings(centre, centre, RING_RADIUS), [centre]);
  const halo = useMemo(() => haloRings(centre, centre, RING_RADIUS), [centre]);
  const underlinePath = useMemo(() => inkUnderlinePath(43), []);

  const spokenTurns = useMemo(
    () => messages.filter((message) => message.content.trim().length > 0).slice(-8),
    [messages],
  );

  if (!open || typeof document === 'undefined') return null;

  // While an answer is streaming or being read out it owns the caption; before
  // that, the caption is the sentence just heard.
  const showingReply = Boolean(reply) && (stage === 'speaking' || stage === 'thinking');
  const caption = showingReply ? reply : heard;
  const captionRole = showingReply ? 'reply' : 'heard';

  function handleRingClick() {
    if (stage === 'speaking') {
      stopSpeechPlayback();
      beginTurn();
      return;
    }
    if (stage === 'listening') {
      listeningRef.current = false;
      chunksRef.current = [];
      enterStage('paused');
      return;
    }
    if (stage === 'paused') {
      setNote(null);
      beginTurn();
      return;
    }
    if (stage === 'thinking') {
      // Stop waiting on an answer that is taking too long. It still lands in
      // the chat; it just will not interrupt the next thing said.
      awaitingRef.current = false;
      clearWatchdog();
      beginTurn();
      return;
    }
    if (stage === 'blocked') {
      void openMicrophone();
    }
  }

  const overlay = (
    <div
      ref={stageNodeRef}
      className="voice-stage"
      data-stage={stage}
      role="dialog"
      aria-modal="true"
      aria-label="Voice conversation"
    >
      <div className="voice-stage-wash" aria-hidden />

      <header className="voice-stage-header">
        <div className="voice-stage-header-actions">
          <button
            type="button"
            className="voice-chip"
            onClick={() => setShowTranscript((current) => !current)}
            aria-pressed={showTranscript}
          >
            {showTranscript ? 'Hide chat' : 'Chat'}
          </button>
          <button type="button" className="voice-chip" onClick={onClose} aria-label="Close voice mode">
            Close
            <span className="voice-chip-hint">Esc</span>
          </button>
        </div>
      </header>

      <div className="voice-stage-centre">
        <button
          ref={ringButtonRef}
          type="button"
          className="voice-ring-button"
          onClick={handleRingClick}
          aria-label={
            stage === 'listening'
              ? 'Pause listening'
              : stage === 'speaking'
                ? 'Interrupt and speak'
                : stage === 'paused'
                  ? 'Start listening'
                  : stage === 'thinking'
                    ? 'Stop waiting for the answer'
                    : stageLabel(stage)
          }
        >
          <svg className="voice-ring" viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`} aria-hidden>
            {/* The halo. It lies on the drawn circle and is invisible until a
                voice is in the room, and then it is carried outwards by how loud
                that voice is — so the circle stays the circle and only breathes.
                Behind the ring, so the crisp line is never drawn over. */}
            <g className="voice-halo">
              {halo.map((ring) => (
                <path
                  key={ring.id}
                  className="voice-halo-ring"
                  d={ring.path}
                  style={
                    {
                      '--halo-spread': `${ring.spread}`,
                      '--halo-opacity': `${ring.opacity}`,
                      '--halo-width': `${ring.width}`,
                    } as React.CSSProperties
                  }
                />
              ))}
            </g>
            <g className="voice-ring-line">
              <path className="voice-ring-glow" d={ringPath} pathLength={1} />
              {/* The same circle gone over again and again, so the line is never
                  quite finished being drawn. */}
              {scribblePaths.map((path, index) => (
                <path
                  key={path}
                  className="voice-ring-scribble"
                  d={path}
                  pathLength={1}
                  style={{ '--scribble-delay': `${index * 940}ms` } as React.CSSProperties}
                />
              ))}
              <path className="voice-ring-ink" d={ringPath} pathLength={1} />
            </g>
            <path className="voice-ring-echo" d={echoPath} pathLength={1} />
          </svg>
        </button>

        <p className="voice-stage-state">{stageLabel(stage)}</p>

        {caption ? (
          <div className={`voice-caption voice-caption-${captionRole}`}>
            {/* The text scrolls, the rule does not — otherwise a long answer
                scrolls underneath it and the rule reads as a strikethrough. */}
            <div className="voice-caption-text">
              <p>{caption}</p>
            </div>
            <svg className="voice-caption-rule" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
              <path d={underlinePath} />
            </svg>
          </div>
        ) : null}

        {blocked ? (
          <div className="voice-blocked" role="alert">
            <p className="voice-blocked-headline">{blocked.headline}</p>
            <ol className="voice-blocked-steps">
              {blocked.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <button type="button" className="voice-action" onClick={() => void openMicrophone()}>
              {blocked.retryLabel ?? 'Try again'}
            </button>
          </div>
        ) : null}

        {note ? (
          <p className="voice-note" role="status">
            {note}
          </p>
        ) : null}
      </div>

      {showTranscript ? (
        <div className="voice-transcript">
          {spokenTurns.length === 0 ? (
            <p className="voice-transcript-empty">Nothing said yet.</p>
          ) : (
            spokenTurns.map((message, index) => (
              <p
                key={`${message.role}-${index}`}
                className={`voice-transcript-line voice-transcript-${message.role}`}
              >
                {message.content}
              </p>
            ))
          )}
        </div>
      ) : null}

    </div>
  );

  // The composer sits inside scrolling, clipped panels; the body is the only
  // place a whole-screen stage can live without being cut off by one of them.
  return createPortal(overlay, document.body);
}
