'use client';

import { requestForegroundMicrophone, stopForegroundStream } from '@/lib/speech/clap/audio-focus';

/**
 * Voice mode — the whole screen, one drawn ring, and the chat underneath.
 *
 * Double-tapping the composer's microphone opens this. Spoken turns, except
 * requests to close voice mode, go through the host's ordinary chat send, so the
 * conversation is already in the transcript the moment the screen is closed:
 * this is a way to talk to the same chat, not a second one.
 */

import { speechRequest } from "@/lib/speech/request-client";
import { connectSubscriptionVoice, subscriptionSelected, type SubscriptionVoice } from "@/lib/speech/subscription-live";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { encodePcm16Wav } from '@/lib/speech/live-dictation';
import { describeMicrophoneBlock, type MicrophoneFix } from '@/lib/speech/microphone-access';
import { playSpeechBlob, stopSpeechPlayback } from '@/lib/speech/playback';
import { playVoicePassages } from '@/lib/speech/voice-playback';
import { createReadingPosition } from '@/lib/speech/reading-position';
import { prepareLocalSpeech, speechErrorMessage } from '@/lib/speech/prepare-client';
import { holdClapWake } from '@/lib/speech/clap-wake';
import { desktopTabsBridge } from '@/lib/desktop-browser-tabs';
import { nextVoiceGreeting, speakVoiceGreeting } from '@/lib/speech/voice-greeting';
import { voiceCompanionBridge } from '@/lib/speech/voice-window';
import VoiceResponse from './voice-response';
import { useVoiceMiniDrag } from './use-voice-mini-drag';
import {
  advanceVoiceTurn,
  createVoiceNarrationQueue,
  frameLevel,
  haloRings,
  initialVoiceTurn,
  inkRingPath,
  inkUnderlinePath,
  isVoiceExitRequest,
  latestAssistantReply,
  scribbleRings,
  speakableText,
  speechThreshold,
  stageLabel,
  voiceTranscriptMessages,
  voiceTurnVerdict,
  type VoiceMessage,
  type VoiceStage,
  type VoiceTranscriptQuestion,
} from '@/lib/speech/voice-conversation';

/** The desktop shell, where one exists: it paints the window's own chrome. */
interface DesktopWindowBridge {
  setTheme?: (surface: 'light' | 'dark' | 'voice') => Promise<boolean>;
}

interface Props {
  open: boolean;
  compact?: boolean;
  /** A dedicated voice tab stays open when another tab is selected. */
  closeOnTabChange?: boolean;
  notice?: React.ReactNode;
  greetOnOpen?: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
  /** Sends one spoken turn through the host's normal chat send. */
  onSend: (text: string) => void | Promise<void>;
  /** The host's live chat messages — where the answer to read out comes from. */
  messages: readonly VoiceMessage[];
  /** True while the host is generating an answer. */
  busy: boolean;
  /** Ask-question tools must be spoken before listening for their answer. */
  clarification?: { requestId: string; question: string } | null;
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
  compact = false,
  closeOnTabChange = true,
  notice,
  greetOnOpen = false,
  onClose,
  onOpenSettings,
  onSend,
  messages,
  busy,
  clarification = null,
}: Props) {
  const [stage, setStage] = useState<VoiceStage>('opening');
  const [heard, setHeard] = useState('');
  const [liveHeard, setLiveHeard] = useState('');
  const [questions, setQuestions] = useState<VoiceTranscriptQuestion[]>([]);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<MicrophoneFix | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [greeting, setGreeting] = useState<string | null>(null);
  const greetingAbortRef = useRef<AbortController | null>(null);

  const stageNodeRef = useRef<HTMLDivElement | null>(null);
  const miniDrag = useVoiceMiniDrag(open && minimized && !voiceCompanionBridge()?.setMinimized, stageNodeRef);
  const ringButtonRef = useRef<HTMLButtonElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLDivElement | null>(null);
  const narratedTextRef = useRef<HTMLDivElement | null>(null);
  const narrationProgressRef = useRef(0);
  const [spokenReply, setSpokenReply] = useState('');
  const followTranscriptRef = useRef(true);
  const spokenQuestionRef = useRef<string | null>(null);
  const captureRef = useRef<{
    stream: MediaStream;
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    sink: GainNode;
  } | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const subscriptionRef = useRef<SubscriptionVoice | null>(null);
  const recoveryControllerRef = useRef<AbortController | null>(null);
  const recoveryAttemptsRef = useRef(0);
  const subscriptionErrorRef = useRef<unknown>(null);
  const recoverSubscriptionRef = useRef<(error: unknown) => Promise<void>>(async () => {});
  const openingSessionRef = useRef<number | null>(null);
  const turnRef = useRef(initialVoiceTurn());
  const listeningRef = useRef(false);
  const levelRef = useRef(0);
  const smoothedRef = useRef(0);
  const stageRef = useRef<VoiceStage>('opening');
  const awaitingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const narrationRef = useRef<ReturnType<typeof createVoiceNarrationQueue> | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const deferredFinishRef = useRef<number | null>(null);
  const resumeListeningRef = useRef<number | null>(null);
  const requestAbortRef = useRef<Set<AbortController>>(new Set());
  /** The chat has recorded this particular spoken turn. */
  const dispatchedRef = useRef(false);
  const sentMessageCountRef = useRef(0);
  const sentTurnRef = useRef<{ text: string; questionId?: string } | null>(null);
  /** Bumped on every close, so audio callbacks from a past session go nowhere. */
  const sessionRef = useRef(0);
  const messagesRef = useRef(messages);
  const onSendRef = useRef(onSend);
  const clarificationRef = useRef(clarification);

  messagesRef.current = messages;
  onSendRef.current = onSend;
  clarificationRef.current = clarification;

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
    recoveryControllerRef.current?.abort();
    recoveryControllerRef.current = null;
    void subscriptionRef.current?.close();
    subscriptionRef.current = null;
    listeningRef.current = false;
    const capture = captureRef.current;
    captureRef.current = null;
    chunksRef.current = [];
    if (!capture) return;
    capture.processor.onaudioprocess = null;
    capture.source.disconnect();
    capture.processor.disconnect();
    capture.sink.disconnect();
    stopForegroundStream(capture.stream);
    void capture.context.close();
  }, []);

  const stopNarration = useCallback(() => {
    narrationRef.current?.cancel();
    narrationRef.current = null;
    stopSpeechPlayback();
    subscriptionRef.current?.stopSpeaking();
  }, []);

  const beginTurn = useCallback(() => {
    if (recoveryControllerRef.current) return;
    if (subscriptionRef.current?.isHealthy?.() === false) {
      void recoverSubscriptionRef.current(subscriptionErrorRef.current);
      return;
    }
    stopNarration();
    setLiveHeard('');
    if (resumeListeningRef.current !== null) {
      window.clearTimeout(resumeListeningRef.current);
      resumeListeningRef.current = null;
    }
    chunksRef.current = [];
    turnRef.current = initialVoiceTurn();
    subscriptionRef.current?.resetTranscript();
    subscriptionRef.current?.setListening(true);
    listeningRef.current = true;
    enterStage('listening');
  }, [enterStage, stopNarration]);

  const startNarration = useCallback((range?: { startIndex: number; initialMessage?: VoiceMessage }) => {
    stopNarration();
    // Connect silently during model work. A failed warmup is retried by speak;
    // it must not interrupt a healthy microphone or delay sending the turn.
    void subscriptionRef.current?.prepareSpeaker?.().catch(() => {});
    let readingDelay = 0;
    narrationRef.current = createVoiceNarrationQueue({
      startIndex: sentMessageCountRef.current,
      ...range,
      async speak({ text, kind }, signal) {
        const spoken = await speakableText(text, signal);
        signal.throwIfAborted();
        if (!spoken) {
          if (kind === 'answer') setReply(text);
          return;
        }
        narrationProgressRef.current = 0;
        setSpokenReply(spoken);
        followTranscriptRef.current = true;
        setReply(text);
        enterStage('speaking');
        listeningRef.current = false;
        const voice = subscriptionRef.current;
        const onProgress = (progress: number) => {
          if (!signal.aborted) narrationProgressRef.current = progress;
        };
        voice?.setListening(false);
        if (voice) {
          const stop = () => voice.stopSpeaking();
          signal.addEventListener('abort', stop, { once: true });
          try { await voice.speak(spoken, true, onProgress); }
          finally { signal.removeEventListener('abort', stop); }
          return;
        }
        await playVoicePassages(spoken, {
          signal, onProgress,
          async synthesize(text, signal) {
            const response = await speechRequest('/api/speech/synthesize', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text }), signal,
            });
            if (!response.ok) throw new Error(await responseMessage(response, 'That message could not be spoken.'));
            return response.blob();
          },
          async play(blob, signal, onProgress) {
            signal.throwIfAborted();
            const stop = () => stopSpeechPlayback();
            signal.addEventListener('abort', stop, { once: true });
            try {
              // Await actual playout, not just the media element starting.
              await new Promise<void>((resolve, reject) => {
                void playSpeechBlob(blob, error => error ? reject(error) : resolve(), onProgress).catch(reject);
              });
            } finally {
              signal.removeEventListener('abort', stop);
            }
          },
        });
      },
      onError(caught, item) {
        setNote(caught instanceof Error ? caught.message : 'That message could not be spoken.');
        if (item.kind === 'answer') {
          readingDelay = Math.min(9_000, 1_500 + item.text.length * 25);
        }
      },
      onIdle(answered) {
        if (!answered) {
          enterStage('thinking');
          return;
        }
        if (readingDelay) {
          resumeListeningRef.current = window.setTimeout(() => {
            resumeListeningRef.current = null;
            beginTurn();
          }, readingDelay);
        } else {
          beginTurn();
        }
      },
    });
  }, [beginTurn, enterStage, stopNarration]);

  /** Spoken input and widget follow-ups use the same turn and narration queue. */
  const sendText = useCallback((text: string) => {
    listeningRef.current = false;
    subscriptionRef.current?.setListening(false);
    chunksRef.current = [];
    setNote(null);
    setHeard(text);
    setLiveHeard('');
    setReply('');
    const questionId = clarificationRef.current?.requestId;
    if (questionId) setQuestions(current => current.map(question =>
      question.requestId === questionId ? { ...question, answer: text } : question,
    ));
    sentMessageCountRef.current = messagesRef.current.length;
    sentTurnRef.current = { text, questionId };
    const continuingIndex = clarificationRef.current
      ? messagesRef.current.findLastIndex(message => message.role === 'assistant') : -1;
    startNarration(continuingIndex < 0 ? undefined : {
      startIndex: continuingIndex,
      initialMessage: messagesRef.current[continuingIndex],
    });
    dispatchedRef.current = false;
    awaitingRef.current = true;
    enterStage('thinking');
    clearWatchdog();
    const session = sessionRef.current;
    const sentTurn = sentTurnRef.current;
    const deliveryFailed = () => {
      if (session !== sessionRef.current || !awaitingRef.current) return;
      if (sentTurn !== sentTurnRef.current || dispatchedRef.current) return;
      awaitingRef.current = false;
      clearWatchdog();
      setNote('The chat has not confirmed your answer. Please try again.');
      beginTurn();
    };
    watchdogRef.current = window.setTimeout(deliveryFailed, DISPATCH_WATCHDOG_MS);
    // Microphone callbacks live for the whole voice session. The host's send
    // handler can change when a question arrives, so always use the latest one.
    try { void Promise.resolve(onSendRef.current(text)).catch(deliveryFailed); }
    catch { deliveryFailed(); }
  }, [beginTurn, clearWatchdog, enterStage, startNarration]);

  /** Transcribe the buffered utterance and hand it to the chat. */
  const finishTurn = useCallback(
    async (session: number) => {
      const capture = captureRef.current;
      const chunks = chunksRef.current;
      const voice = subscriptionRef.current;
      chunksRef.current = [];
      if (!capture || (!voice && chunks.length === 0)) return;
      enterStage('transcribing');

      const controller = new AbortController();
      requestAbortRef.current.add(controller);
      try {
        let response: Response;
        if (voice) {
          response = Response.json({ text: await voice.finishTranscript() });
        } else {
          const form = new FormData();
          form.set('file', encodePcm16Wav(chunks, capture.context.sampleRate), 'voice-turn.wav');
          response = await speechRequest('/api/speech/transcribe', {
            method: 'POST', body: form, signal: controller.signal,
          });
        }
        if (session !== sessionRef.current) return;
        if (response.status === 202) {
          setNote('Voicebox is still downloading the transcription model. Say that again in a moment.');
          beginTurn();
          return;
        }
        if (!response.ok) {
          const message = await responseMessage(response, 'That could not be transcribed.');
          setNote(message);
          if ([401, 403, 409].includes(response.status)) {
            releaseMicrophone();
            enterStage('unavailable');
            return;
          }
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

        // Closing voice is a local control: do not ask the model to respond or
        // leave the microphone active while waiting for the host to close.
        if (isVoiceExitRequest(text)) {
          awaitingRef.current = false;
          clearWatchdog();
          stopNarration();
          releaseMicrophone();
          onCloseRef.current();
          return;
        }
        recoveryAttemptsRef.current = 0;

        sendText(text);
      } catch (caught) {
        if (session !== sessionRef.current || controller.signal.aborted) return;
        if (subscriptionRef.current) {
          await recoverSubscriptionRef.current(caught);
        } else {
          setNote(speechErrorMessage(caught, 'That could not be transcribed. Please try again.'));
          beginTurn();
        }
      } finally {
        requestAbortRef.current.delete(controller);
      }
    },
    [beginTurn, clearWatchdog, enterStage, releaseMicrophone, sendText, stopNarration],
  );

  const openSubscription = useCallback((stream: MediaStream, signal: AbortSignal, session: number) =>
    connectSubscriptionVoice({
      microphone: stream, listening: false, signal,
      onTranscript: text => {
        if (!signal.aborted && session === sessionRef.current && listeningRef.current) setLiveHeard(text);
      },
      onDisconnect: caught => {
        if (signal.aborted || session !== sessionRef.current) return;
        subscriptionErrorRef.current = caught;
        // In-flight transcription/narration handles its own failure. An idle
        // microphone must also recover, without waiting for another utterance.
        if (stageRef.current === 'listening' || stageRef.current === 'paused') {
          void recoverSubscriptionRef.current(caught);
        }
      },
    }), []);

  const recoverSubscription = useCallback(async (caught: unknown) => {
    if (recoveryControllerRef.current) return;
    const capture = captureRef.current;
    if (!capture) return;
    const session = sessionRef.current;
    const paused = stageRef.current === 'paused';
    if (recoveryAttemptsRef.current >= 2) {
      setNote(speechErrorMessage(caught, 'Voice could not reconnect. Please retry voice.'));
      releaseMicrophone();
      enterStage('unavailable');
      return;
    }
    recoveryAttemptsRef.current++;
    const controller = new AbortController();
    recoveryControllerRef.current = controller;
    listeningRef.current = false;
    chunksRef.current = [];
    clearDeferredWork();
    requestAbortRef.current.add(controller);
    setNote('Reconnecting voice…');
    enterStage('opening');
    const previous = subscriptionRef.current;
    try {
      // Release the old server session before allocating its replacement.
      await previous?.close();
      if (session !== sessionRef.current || controller.signal.aborted) return;
      const voice = await openSubscription(capture.stream, controller.signal, session);
      if (session !== sessionRef.current || controller.signal.aborted) { await voice.close(); return; }
      subscriptionRef.current = voice;
      subscriptionErrorRef.current = null;
      recoveryControllerRef.current = null;
      setNote(paused ? null : 'Voice reconnected. Please say that again.');
      if (paused) enterStage('paused');
      else beginTurn();
    } catch (error) {
      if (session !== sessionRef.current || controller.signal.aborted) return;
      setNote(speechErrorMessage(error, 'Voice could not reconnect. Please retry voice.'));
      releaseMicrophone();
      enterStage('unavailable');
    } finally {
      requestAbortRef.current.delete(controller);
      if (recoveryControllerRef.current === controller) recoveryControllerRef.current = null;
    }
  }, [beginTurn, clearDeferredWork, enterStage, openSubscription, releaseMicrophone]);
  recoverSubscriptionRef.current = recoverSubscription;

  const openMicrophone = useCallback(async (greet = greetOnOpen) => {
    if (openingSessionRef.current === sessionRef.current && stageRef.current === 'opening') return;
    const session = ++sessionRef.current;
    openingSessionRef.current = session;
    recoveryAttemptsRef.current = 0;
    subscriptionErrorRef.current = null;
    const previous = subscriptionRef.current;
    clearWatchdog();
    clearDeferredWork();
    stopNarration();
    releaseMicrophone();
    awaitingRef.current = false;
    let serviceReady = false;
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
      await previous?.close();
      if (session !== sessionRef.current) return;
      setNote('Preparing speech…');
      const cloudController = new AbortController();
      requestAbortRef.current.add(cloudController);
      const cloud = await subscriptionSelected(cloudController.signal);
      // The cloud connection validates its own credentials. A separate status
      // request here delays adoption of the already prepared media session.
      if (!cloud) await prepareLocalSpeech(cloudController.signal);
      if (session !== sessionRef.current) return;
      serviceReady = true;
      setNote(null);
      const greetingController = new AbortController();
      greetingAbortRef.current = greetingController;
      requestAbortRef.current.add(greetingController);
      const welcome = async (voice?: SubscriptionVoice) => {
        if (!greet || session !== sessionRef.current || greetingController.signal.aborted) return;
        const text = nextVoiceGreeting();
        setGreeting(text);
        try {
          await speakVoiceGreeting(text, greetingController.signal, voice);
        } catch (caught) {
          if (session !== sessionRef.current) return;
          // A greeting uses a separate reader. Its failure or a click to skip
          // it must not tear down a healthy conversation microphone.
          if (voice?.isHealthy() === false) throw caught;
          if (!greetingController.signal.aborted) {
            setNote(`${speechErrorMessage(caught, 'The greeting could not play.')} You can still speak.`);
          }
        } finally {
          requestAbortRef.current.delete(greetingController);
          if (greetingAbortRef.current === greetingController) greetingAbortRef.current = null;
          if (session === sessionRef.current) setGreeting(null);
        }
      };
      // Voicebox speaks before capture. OpenAI greets in the same duplex session,
      // with its microphone input muted until beginTurn below.
      if (!cloud) await welcome();
      if (session !== sessionRef.current) return;
      const stream = await requestForegroundMicrophone({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      openingStream = stream;
      if (session !== sessionRef.current) {
        stopForegroundStream(stream);
        return;
      }
      const context = new AudioContextClass();
      openingContext = context;
      if (context.state === 'suspended') await context.resume();
      if (session !== sessionRef.current) {
        stopForegroundStream(stream);
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

        // Subscription audio is already streaming over WebRTC. Buffer PCM
        // only for providers that need a file after the utterance finishes.
        if (!cloud) chunksRef.current.push(new Float32Array(input));
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
      if (cloud) {
        serviceReady = false;
        const voice = await openSubscription(stream, cloudController.signal, session);
        serviceReady = true;
        if (session !== sessionRef.current) { await voice.close(); return; }
        subscriptionRef.current = voice;
        await welcome(voice);
      }
      requestAbortRef.current.delete(cloudController);
      requestAbortRef.current.delete(greetingController);
      if (session !== sessionRef.current) return;
      openingStream = null;
      openingContext = null;
      beginTurn();
    } catch (caught) {
      stopForegroundStream(openingStream);
      void openingContext?.close();
      if (session !== sessionRef.current) return;
      releaseMicrophone();
      if (caught instanceof DOMException && caught.name === 'NotAllowedError') {
        setBlocked(await describeMicrophoneBlock(caught));
      } else if (!serviceReady) {
        setNote(speechErrorMessage(caught, 'The selected voice provider could not start.'));
        enterStage('unavailable');
        return;
      } else {
        setNote(caught instanceof Error ? caught.message : 'The microphone could not be opened.');
      }
      enterStage('blocked');
    } finally {
      if (openingSessionRef.current === session) openingSessionRef.current = null;
    }
  }, [beginTurn, clearDeferredWork, clearWatchdog, enterStage, finishTurn, openSubscription, releaseMicrophone, stopNarration, greetOnOpen]);

  /* --- session lifecycle ------------------------------------------------- */
  const resizeVoice = useCallback(async (value: boolean) => {
    const companion = voiceCompanionBridge();
    try {
      setMinimized(companion?.setMinimized ? await companion.setMinimized(value) : value);
    } catch {
      setNote('The voice window could not resize. Try again.');
    }
  }, []);

  useEffect(() => voiceCompanionBridge()?.onMinimized?.(setMinimized), []);

  useEffect(() => {
    if (!open || !minimized) return;
    const root = document.documentElement;
    root.dataset.voiceMinimized = 'true';
    if (voiceCompanionBridge()?.setMinimized) root.dataset.voiceMiniWindow = 'true';
    return () => {
      delete root.dataset.voiceMinimized;
      delete root.dataset.voiceMiniWindow;
    };
  }, [open, minimized]);

  useEffect(() => {
    if (!open) return;
    sessionRef.current += 1;
    const releaseWake = holdClapWake();
    setHeard('');
    setLiveHeard('');
    setQuestions([]);
    setReply('');
    setNote(null);
    setShowTranscript(false);
    setMinimized(false);
    spokenQuestionRef.current = null;
    followTranscriptRef.current = true;
    awaitingRef.current = false;
    setGreeting(null);
    void openMicrophone(greetOnOpen);
    return () => {
      sessionRef.current += 1;
      greetingAbortRef.current?.abort();
      greetingAbortRef.current = null;
      awaitingRef.current = false;
      clearWatchdog();
      clearDeferredWork();
      stopNarration();
      stopSpeechPlayback();
      releaseMicrophone();
      releaseWake();
    };
    // openMicrophone is stable for the life of an open session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Voice mode fills the window, so it takes the window's own chrome with it:
  // the desktop shell's caption strip and the native buttons in it would
  // otherwise sit on top of the terracotta as a cream band. The window goes
  // back to the app's theme on close.
  useEffect(() => {
    if (!open || minimized) return;
    const root = document.documentElement;
    root.dataset.voiceStage = 'open';
    const tabs = desktopTabsBridge();
    const shell = (window as Window & { breadboardDesktop?: DesktopWindowBridge })
      .breadboardDesktop;
    let shellVoice = false;
    let disposed = false;
    const paintShell = (active: boolean) => {
      if (shellVoice === active) return;
      shellVoice = active;
      void tabs?.tabs({ type: 'voice-overlay', open: active });
      if (active) void shell?.setTheme?.('voice');
      else void shell?.setTheme?.(root.dataset.theme === 'dark' ? 'dark' : 'light');
    };
    const syncTab = (state: { selfId?: number | null; activeId: number | null; navigationPending?: boolean }) => {
      if (disposed) return;
      const active = state.selfId === state.activeId && !state.navigationPending;
      if (closeOnTabChange) { if (!active) onCloseRef.current(); }
      else paintShell(active);
    };
    if (closeOnTabChange || !tabs) paintShell(true);
    // A standalone page can first load in a background tab. Wait for its own
    // activation before changing the window's native controls to voice colors.
    let receivedTabState = false;
    const unsubscribe = tabs?.onTabsState(state => { receivedTabState = true; syncTab(state); });
    if (!closeOnTabChange && tabs) void tabs.getTabsState().then(state => {
      if (!receivedTabState) syncTab(state);
    }).catch(() => {});
    return () => {
      disposed = true;
      unsubscribe?.();
      paintShell(false);
      delete root.dataset.voiceStage;
    };
  }, [open, closeOnTabChange, minimized]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (minimized && !stageNodeRef.current?.contains(event.target as Node)) return;
        // A chat image opens its own portalled viewer above voice mode.
        if (event.defaultPrevented || document.querySelector('.bb-viewer-overlay')) return;
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    if (!minimized) document.body.style.overflow = 'hidden';
    // Keyboard focus follows the screen, so Tab and Enter act on the ring
    // rather than on the composer still mounted behind it.
    const focusFrame = window.requestAnimationFrame(() => ringButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, minimized]);

  /* --- progress narration and the answer --------------------------------- */

  useEffect(() => {
    if (!open || !clarification || !captureRef.current || greeting || stage === 'opening') return;
    if (spokenQuestionRef.current === clarification.requestId) return;
    spokenQuestionRef.current = clarification.requestId;
    const messageIndex = messagesRef.current.findLastIndex(message => message.role === 'assistant');
    const contentBefore = messagesRef.current[messageIndex]?.content ?? '';
    setQuestions(current => [...current, {
      requestId: clarification.requestId,
      question: clarification.question,
      messageIndex,
      contentBefore,
    }]);
    awaitingRef.current = false;
    clearWatchdog();
    if (resumeListeningRef.current !== null) {
      window.clearTimeout(resumeListeningRef.current);
      resumeListeningRef.current = null;
    }
    // The run is waiting for input, so its question is a complete spoken turn
    // even though the host still reports the run as active. Interrupt progress
    // narration, read the question once, then the queue resumes the microphone.
    startNarration({ startIndex: 0 });
    narrationRef.current?.update([{ role: 'assistant', content: clarification.question }], false);
  }, [clarification, clearWatchdog, greeting, open, stage, startNarration]);

  useEffect(() => {
    if (!open || !awaitingRef.current) return;
    // A question keeps its host busy before the answer arrives. Only a matching
    // user row acknowledges delivery; ongoing work and unrelated rows do not.
    const sent = sentTurnRef.current;
    const received = sent && messages.some((message, index) =>
      message.role === 'user' && message.content.trim() === sent.text.trim() &&
      (sent.questionId ? message.clientMessageId === `clarify:${sent.questionId}`
        : index >= sentMessageCountRef.current),
    );
    if (received) {
      if (!dispatchedRef.current) {
        dispatchedRef.current = true;
        clearWatchdog();
      }
    }
    const narration = narrationRef.current;
    if (!narration) return;
    if (!dispatchedRef.current) return;
    // Sealed progress notes can play during generation. The answer is queued
    // only once it settles, behind any progress already being spoken.
    const answered = narration.update(messages, busy);
    if (busy && !narration.speaking) {
      const streaming = latestAssistantReply(messages);
      if (streaming) setReply(streaming);
    }
    if (answered) {
      awaitingRef.current = false;
      clearWatchdog();
    }
  }, [busy, clearWatchdog, messages, open]);

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
    () => voiceTranscriptMessages(messages, questions).slice(-12),
    [messages, questions],
  );

  const pendingHeard = liveHeard || (heard && spokenTurns.findLast(message => message.role === 'user')?.content.trim() !== heard ? heard : '');
  const pendingQuestion = clarification && !questions.some(question => question.requestId === clarification.requestId)
    ? clarification.question : '';
  const narrating = stage === 'speaking' && Boolean(reply);
  const narratedIndex = narrating
    ? spokenTurns.findLastIndex(message => message.role === 'assistant' && message.content.endsWith(reply.trim()))
    : -1;

  useEffect(() => {
    // A settled answer may arrive all at once, or stream ahead of a progress
    // note being spoken. Playback owns the viewport until narration finishes.
    if (stageRef.current === 'speaking') return;
    const transcript = transcriptRef.current;
    if (transcript && followTranscriptRef.current) transcript.scrollTop = transcript.scrollHeight;
  }, [spokenTurns, pendingHeard, pendingQuestion, open, stage, minimized]);

  useEffect(() => {
    if (!open || !narrating || minimized) return;
    let frame = 0;
    let firstFrame = true;
    let readingText: HTMLElement | null = null;
    let readingPosition: ReturnType<typeof createReadingPosition> | null = null;
    const observer = new MutationObserver(() => { readingPosition = null; });
    const spoken = spokenReply;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const followReading = () => {
      const viewport = compact ? transcriptRef.current : captionRef.current;
      const text = narratedTextRef.current;
      if (viewport && text) {
        if (text !== readingText) {
          observer.disconnect();
          observer.observe(text, { childList: true, characterData: true, subtree: true });
          readingText = text;
          readingPosition = null;
        }
        readingPosition ??= createReadingPosition(text, spoken);
        const bounds = text.getBoundingClientRect();
        const viewportTop = viewport.getBoundingClientRect().top;
        const start = viewport.scrollTop + bounds.top - viewportTop;
        const progress = narrationProgressRef.current;
        const word = progress > 0 ? readingPosition(progress) : null;
        const target = word ? Math.max(start, viewport.scrollTop + word.top - viewportTop - viewport.clientHeight * 0.45) : start;
        // Reset immediately for each utterance. Follow media progress smoothly
        // without React renders or restarting a browser smooth-scroll animation.
        const next = firstFrame || motionPreference.matches ? target : viewport.scrollTop + (target - viewport.scrollTop) * 0.18;
        viewport.scrollTop = Math.abs(target - next) < 1 ? target : next;
        firstFrame = false;
      }
      frame = window.requestAnimationFrame(followReading);
    };
    frame = window.requestAnimationFrame(followReading);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [compact, narrating, open, spokenReply, minimized]);

  if (!open || typeof document === 'undefined') return null;

  // Keep the last reply visible while listening or paused. A new transcribed
  // user turn clears it when that turn is sent, rather than replaying old input
  // as soon as the assistant finishes speaking.
  const showingReply = Boolean(reply);
  const latestResponse = spokenTurns.at(-1)?.role === 'assistant' ? spokenTurns.at(-1) : undefined;
  const captionResources = greeting ? undefined : latestResponse?.uiResources;
  const caption = greeting ?? (showingReply ? reply : captionResources?.length ? '' : heard);
  const captionRole = greeting || showingReply || captionResources?.length ? 'reply' : 'heard';

  function handleRingClick() {
    if (greeting) {
      greetingAbortRef.current?.abort();
      return;
    }
    if (stage === 'speaking') {
      awaitingRef.current = false;
      clearWatchdog();
      beginTurn();
      return;
    }
    if (stage === 'listening') {
      subscriptionRef.current?.setListening(false);
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
    if (stage === 'blocked' || stage === 'unavailable') {
      void openMicrophone(false);
    }
  }

  const overlay = (
    <div
      ref={stageNodeRef}
      {...miniDrag}
      className={`voice-stage${compact ? ' voice-stage-compact' : ''}${minimized ? ' voice-stage-minimized' : ''}`}
      data-stage={stage}
      role={minimized ? 'region' : 'dialog'}
      aria-modal={minimized ? undefined : true}
      aria-label="Voice conversation"
    >
      <div className="voice-stage-wash" aria-hidden />

      <header className="voice-stage-header">
        <div className="voice-stage-header-actions">
          {!compact && <button
            type="button"
            className="voice-chip"
            onClick={() => setShowTranscript((current) => !current)}
            aria-pressed={showTranscript}
          >
            {showTranscript ? 'Hide chat' : 'Chat'}
          </button>}
          <button type="button" className={compact ? 'voice-widget-close' : 'voice-chip'} onClick={() => void resizeVoice(true)} aria-label="Minimize voice assistant" title="Minimize voice assistant">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M4 8h8" /></svg>
          </button>
          <button type="button" className={compact ? 'voice-widget-close' : 'voice-chip'} onClick={onClose} aria-label="Close voice mode" title="Close voice mode (Esc)">
            {compact ? <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="m4 4 8 8M12 4l-8 8" /></svg> : <>Close<span className="voice-chip-hint">Esc</span></>}
          </button>
        </div>
      </header>

      <div className="voice-stage-centre">
        <button
          ref={ringButtonRef}
          type="button"
          className="voice-ring-button"
          onClick={handleRingClick}
          title={greeting ? 'Skip greeting and listen' : undefined}
          aria-label={
            greeting
              ? 'Skip greeting and listen'
              : stage === 'listening'
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

        {minimized && <>
          <span className="voice-mini-status" role="status" title="Drag to move">
            {greeting ? 'Hello' : stageLabel(stage)}
          </span>
          <button type="button" className="voice-mini-expand voice-widget-close"
            onClick={() => void resizeVoice(false)} aria-label="Expand voice assistant" title="Expand">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M9 3h4v4M13 3 8.5 7.5M7 13H3V9M3 13l4.5-4.5" />
            </svg>
          </button>
        </>}

        <p className="voice-stage-state">{greeting ? 'Hello' : stageLabel(stage)}</p>
        {compact && <div
          ref={transcriptRef}
          className="voice-widget-transcript"
          role="log"
          aria-label="Conversation transcript"
          aria-live="polite"
          onScroll={event => {
            if (stageRef.current === 'speaking') return;
            const node = event.currentTarget;
            followTranscriptRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
          }}
        >
          {spokenTurns.map((message, index) => <div key={`${message.role}-${index}`} className={`voice-widget-message voice-widget-message-${message.role}`}>
            {message.role === 'assistant' ? <div ref={index === narratedIndex ? narratedTextRef : undefined}
              className={index === narratedIndex ? 'voice-narrated-text' : undefined}>
              <VoiceResponse message={message} onSend={sendText} />
            </div> : <p>{message.content}</p>}
          </div>)}
          {narrating && narratedIndex < 0 && <div className="voice-widget-message voice-widget-message-assistant">
            <div ref={narratedTextRef} className="voice-narrated-text"><VoiceResponse message={{ role: 'assistant', content: reply }} onSend={sendText} /></div>
          </div>}
          {pendingQuestion && !(narrating && pendingQuestion === reply) && <div className="voice-widget-message voice-widget-message-assistant">
            <p>{pendingQuestion}</p>
          </div>}
          {pendingHeard && <div className="voice-widget-message voice-widget-message-user">
            <p>{pendingHeard}</p>
          </div>}
          {greeting && spokenTurns.length === 0 && <div className="voice-widget-message voice-widget-message-assistant">
            <p>{greeting}</p>
          </div>}
        </div>}

        {!compact && (caption || captionResources?.length) ? (
          <div className={`voice-caption voice-caption-${captionRole}`}>
            {/* The text scrolls, the rule does not — otherwise a long answer
                scrolls underneath it and the rule reads as a strikethrough. */}
            <div ref={captionRef} className="voice-caption-text">
              <div ref={narrating ? narratedTextRef : undefined} className={narrating ? 'voice-narrated-text' : undefined}>
                {captionRole === 'reply' || captionResources?.length
                  ? <VoiceResponse message={{ role: 'assistant', content: caption, uiResources: captionResources }} onSend={sendText} />
                  : <p>{caption}</p>}
              </div>
            </div>
            <svg className="voice-caption-rule" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
              <path d={underlinePath} />
            </svg>
          </div>
        ) : null}

        {notice}

        {blocked ? (
          <div className="voice-blocked" role="alert">
            <p className="voice-blocked-headline">{blocked.headline}</p>
            <ol className="voice-blocked-steps">
              {blocked.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <button type="button" className="voice-action" onClick={() => void openMicrophone(false)}>
              {blocked.retryLabel ?? 'Try again'}
            </button>
          </div>
        ) : null}

        {note ? (
          <p className="voice-note" role="status">
            {note}
          </p>
        ) : null}
        {stage === 'unavailable' && <div className="mt-4 flex flex-wrap justify-center gap-3">
          <button type="button" className="voice-chip" onClick={() => void openMicrophone(false)}>Retry voice</button>
          {onOpenSettings && <button type="button" className="voice-chip" onClick={onOpenSettings}>Voice settings</button>}
        </div>}
      </div>

      {!compact && showTranscript ? (
        <div className="voice-transcript">
          {spokenTurns.length === 0 ? (
            <p className="voice-transcript-empty">Nothing said yet.</p>
          ) : (
            spokenTurns.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`voice-transcript-line voice-transcript-${message.role}`}
              >
                {message.role === 'assistant' ? <VoiceResponse message={message} onSend={sendText} /> : <p>{message.content}</p>}
              </div>
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
