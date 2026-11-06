'use client';

// ChatGPT voice: talk to ChatGPT's own voice, at ChatGPT's own speed, in the
// chatgpt.com page Breadboard drives. Nothing here listens or speaks; the page
// does. This screen starts the conversation with the chat so far as context,
// copies every exchange into the chat as it happens, and hangs up. The
// answers are ChatGPT's, not Breadboard's assistant's.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  chatgptVoiceContext,
  pairSpokenMessages,
  type SpokenExchange,
  type SpokenMessage,
} from '@/lib/speech/chatgpt-voice';
import {
  frameLevel, haloRings, initialVoiceTurn, inkRingPath, inkUnderlinePath, scribbleRings, speechThreshold, stageLabel,
  voiceTranscriptMessages, type VoiceMessage, type VoiceStage,
} from '@/lib/speech/voice-conversation';
import { requestForegroundMicrophone, stopForegroundStream } from '@/lib/speech/clap/audio-focus';
import VoiceResponse from './voice-response';
import { useVoiceMiniDrag } from './use-voice-mini-drag';
import { useVoiceStageChrome } from './use-voice-stage-chrome';
import { voiceCompanionBridge } from '@/lib/speech/voice-window';

const POLL_MS = 1_000;
// Polls in a row that may fail (a slow page, a dropped request) before the
// session is started again.
const POLL_FAILURES = 4;
// Waits between attempts to start it again, growing to the last.
const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
// The same ring as voice mode, drawn the same way.
const RING_VIEWBOX = 200;
const RING_RADIUS = 62;
const CENTRE = RING_VIEWBOX / 2;

type Stage = 'starting' | 'reconnecting' | 'live' | 'ending' | 'ended';

// Which of voice mode's stages each one shows as, label and all: this is
// voice mode, so it reads exactly as voice mode does.
const STAGE_LOOK: Record<Stage, VoiceStage> = {
  starting: 'opening',
  reconnecting: 'opening',
  live: 'listening',
  ending: 'listening',
  ended: 'listening',
};

function spoken(value: unknown): SpokenMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is SpokenMessage =>
    Boolean(row) && typeof row.id === 'string' && (row.role === 'user' || row.role === 'assistant') && typeof row.text === 'string');
}

async function failure(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === 'string' && body.error.trim() ? body.error.trim() : fallback;
}

// Answers are ChatGPT's own; nothing in them sends a turn back.
const noSend = () => {};

// As in voice mode: the halo stays out this long past the last loud frame.
const VOICING_HOLD_MS = 420;

export default function ChatgptVoiceScreen({ messages, onRecord, onClose, compact = false, dictationPaused = false }: {
  /** The chat so far, told to ChatGPT before the voice starts, and the
   * transcript the Chat button shows, as in voice mode. */
  messages: readonly VoiceMessage[];
  /** Saves one exchange into the chat. */
  onRecord?: (exchange: SpokenExchange) => Promise<void>;
  onClose: () => void;
  /** Voice mode's small window layout (the voice window, the widget page). */
  compact?: boolean;
  dictationPaused?: boolean;
}) {
  const [stage, setStage] = useState<Stage>('starting');
  const [lines, setLines] = useState<SpokenMessage[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  // From each poll: ChatGPT's voice is coming in, and the site's mute is on.
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted); mutedRef.current = muted;
  const resumeMicrophone = useRef(false);
  const dictationPausedRef = useRef(dictationPaused); dictationPausedRef.current = dictationPaused;
  const microphoneChanges = useRef(Promise.resolve());
  // The session the ring acts on, and when it was last pressed: a poll that
  // began before the press must not undo it on screen.
  const sessionIdRef = useRef<string | null>(null);
  const pressedAtRef = useRef(0);
  // Voice mode's minimize: the same small, draggable widget.
  // In the voice window the window itself shrinks to the widget, as in voice mode.
  const [minimized, setMinimized] = useState(false);
  const stageNodeRef = useRef<HTMLDivElement | null>(null);
  const miniDrag = useVoiceMiniDrag(minimized && !voiceCompanionBridge()?.setMinimized, stageNodeRef);
  const resize = async (value: boolean) => {
    const companion = voiceCompanionBridge();
    try {
      setMinimized(companion?.setMinimized ? await companion.setMinimized(value) : value);
    } catch {
      setNote('The voice window could not resize. Try again.');
    }
  };
  useEffect(() => voiceCompanionBridge()?.onMinimized?.(setMinimized), []);
  useEffect(() => {
    if (!minimized) return;
    const root = document.documentElement;
    root.dataset.voiceMinimized = 'true';
    if (voiceCompanionBridge()?.setMinimized) root.dataset.voiceMiniWindow = 'true';
    return () => {
      delete root.dataset.voiceMinimized;
      delete root.dataset.voiceMiniWindow;
    };
  }, [minimized]);
  const ringPath = useMemo(() => inkRingPath(11, CENTRE, CENTRE, RING_RADIUS, 0.035, 18), []);
  const echoPath = useMemo(() => inkRingPath(29, CENTRE, CENTRE, RING_RADIUS, 0.055, 16), []);
  const scribblePaths = useMemo(() => scribbleRings(CENTRE, CENTRE, RING_RADIUS), []);
  const halo = useMemo(() => haloRings(CENTRE, CENTRE, RING_RADIUS), []);
  const ringButtonRef = useRef<HTMLButtonElement | null>(null);
  // The chat as it was, then this call as it is heard: the copies reach the
  // chat only once each exchange is complete.
  const [history] = useState(() => voiceTranscriptMessages(messages, []));
  const spokenTurns = useMemo(() => [
    ...history,
    ...lines.map((line): VoiceMessage => ({ role: line.role, content: line.text })),
  ].slice(-12), [history, lines]);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  // As in voice mode, the newest words stay in view.
  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [spokenTurns, minimized]);
  // The call never ends on a tab change, so the window only wears voice
  // colors while this tab is showing.
  useVoiceStageChrome(!minimized, false, onClose);
  const underlinePath = useMemo(() => inkUnderlinePath(43), []);
  const [chat] = useState(() => messages.map(({ role, content }) => ({ role, content })));
  const recordRef = useRef(onRecord);
  const endRef = useRef<() => Promise<void>>(async () => {});
  useLayoutEffect(() => { recordRef.current = onRecord; });

  // The ring's halo follows the person speaking, as in voice mode. ChatGPT's
  // page has the call's microphone; this only measures loudness from a second
  // capture of it, so the call itself is untouched.
  const lookRef = useRef<VoiceStage>('opening');
  useEffect(() => {
    if (dictationPaused) return;
    let disposed = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;
    void (async () => {
      try {
        stream = await requestForegroundMicrophone({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (disposed) { stopForegroundStream(stream); return; }
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const threshold = speechThreshold(initialVoiceTurn().noiseFloor);
        let smoothed = 0;
        let lastLoudAt = 0;
        let voicing = false;
        const tick = () => {
          analyser.getFloatTimeDomainData(samples);
          const listening = lookRef.current === 'listening';
          smoothed = smoothed * 0.8 + (listening ? frameLevel(samples) : 0) * 0.2;
          const node = stageNodeRef.current;
          node?.style.setProperty('--voice-level', Math.min(1, smoothed * 6).toFixed(3));
          const now = performance.now();
          if (listening && smoothed >= threshold) lastLoudAt = now;
          const next = listening && now - lastLoudAt < VOICING_HOLD_MS;
          if (next !== voicing && node) { voicing = next; node.dataset.voicing = next ? 'true' : 'false'; }
          frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
      } catch {
        // No meter, no halo: the call goes on regardless.
      }
    })();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      stopForegroundStream(stream);
      void context?.close();
    };
  }, [dictationPaused]);

  useEffect(() => {
    let alive = true;
    let id: string | null = null;
    let ended = false;
    let pending: SpokenMessage[] = [];
    let saving = Promise.resolve();

    const take = (incoming: SpokenMessage[], final = false) => {
      if (incoming.length && alive) setLines(current => [...current, ...incoming]);
      const paired = pairSpokenMessages(pending, incoming, final);
      pending = paired.pending;
      for (const exchange of paired.exchanges) {
        // In order, one at a time: each is a turn appended to the chat.
        saving = saving.then(() => recordRef.current?.(exchange)).catch((error: unknown) => {
          if (alive) setNote(error instanceof Error ? error.message : 'Part of the conversation could not be saved.');
        });
      }
    };

    // The presence requests below; aborted once the call is over.
    const presence = new AbortController();
    const end = async () => {
      if (ended) return;
      ended = true;
      sessionIdRef.current = null;
      presence.abort();
      if (alive) setStage('ending');
      let remaining: SpokenMessage[] = [];
      if (id) {
        const response = await fetch(`/api/speech/web-live/${id}`, { method: 'DELETE' }).catch(() => null);
        if (response?.ok) remaining = spoken(((await response.json().catch(() => ({}))) as { messages?: unknown }).messages);
      }
      take(remaining, true);
      await saving;
      if (!alive) return;
      setStage('ended');
    };
    endRef.current = () => end();

    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    // Held open while this screen shows the call. A tab can close without
    // running any of this code; its connection still drops, and ChatMock
    // hangs up. Timers in a hidden tab slow down; an open request does not.
    const hold = (session: string) => void (async () => {
      while (!ended && id === session) {
        const response = await fetch(`/api/speech/web-live/${session}/presence`, { cache: 'no-store', signal: presence.signal }).catch(() => null);
        if (response?.status === 404) return;
        await response?.body?.pipeTo(new WritableStream()).catch(() => {});
        if (!response?.ok && !ended) await wait(2_000);
      }
    })();
    const said: SpokenMessage[] = [];

    // Only closing the screen ends the call. ChatGPT's own voice switching
    // off is restarted by ChatMock; a session that is gone or stops answering
    // is started again here, knowing what has been said so far.
    const begin = async (): Promise<string> => {
      const context = chatgptVoiceContext([...chat, ...said.map(line => ({ role: line.role, content: line.text }))]);
      const started = await fetch('/api/speech/web-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      });
      if (!started.ok) throw new Error(await failure(started, 'ChatGPT voice could not start.'));
      const body = (await started.json()) as { id?: unknown };
      if (typeof body.id !== 'string') throw new Error('ChatGPT voice did not start.');
      return body.id;
    };

    void (async () => {
      let attempt = 0;
      while (!ended) {
        try {
          while (dictationPausedRef.current && !ended) await wait(50);
          if (ended) return;
          const started = await begin();
          // Closed while it was starting: hang up straight away.
          if (ended) {
            void fetch(`/api/speech/web-live/${started}`, { method: 'DELETE' }).catch(() => {});
            return;
          }
          id = started;
          sessionIdRef.current = started;
          hold(started);
          attempt = 0;
          if (alive) { setStage('live'); setNote(null); setMuted(false); setSpeaking(false); }
          let failures = 0;
          while (!ended && failures < POLL_FAILURES) {
            await wait(POLL_MS);
            if (ended) return;
            const polled = await fetch(`/api/speech/web-live/${id}`, { cache: 'no-store' }).catch(() => null);
            if (polled?.status === 404) break;
            if (!polled?.ok) { failures += 1; continue; }
            failures = 0;
            const news = (await polled.json()) as { active?: unknown; messages?: unknown; speaking?: unknown; muted?: unknown };
            if (alive) {
              setSpeaking(news.speaking === true);
              if (!dictationPausedRef.current && Date.now() - pressedAtRef.current > 3_000) setMuted(news.muted === true);
            }
            const incoming = spoken(news.messages);
            said.push(...incoming);
            take(incoming);
            // ChatMock gave the session up (its page stopped answering).
            if (news.active === false) break;
          }
        } catch (error) {
          if (alive) setNote(error instanceof Error ? error.message : 'ChatGPT voice failed.');
        }
        if (ended) return;
        if (id) {
          // Whatever the old session heard but no poll collected.
          const gone = await fetch(`/api/speech/web-live/${id}`, { method: 'DELETE' }).catch(() => null);
          const left = gone?.ok ? spoken(((await gone.json().catch(() => ({}))) as { messages?: unknown }).messages) : [];
          said.push(...left);
          take(left);
        }
        if (ended) return;
        id = null;
        sessionIdRef.current = null;
        if (alive) { setStage('reconnecting'); setNote(current => current ?? 'Reconnecting voice…'); }
        await wait(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
        attempt += 1;
      }
    })();

    // A closing window cannot wait for the copy; it still hangs up.
    const leave = () => {
      if (id && !ended) {
        ended = true;
        void fetch(`/api/speech/web-live/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
      }
    };
    window.addEventListener('pagehide', leave);
    return () => {
      alive = false;
      window.removeEventListener('pagehide', leave);
      // Leaving the chat still copies what was said into it.
      void end();
    };
  }, [chat]);

  useEffect(() => {
    const session = sessionIdRef.current;
    if (stage !== 'live' || !session) return;
    // A new hold can arrive while the previous resume request is in flight.
    // Its temporary mute must not become the user's manual mute preference.
    if (dictationPaused) resumeMicrophone.current ||= !mutedRef.current;
    else if (!resumeMicrophone.current) return;
    const on = !dictationPaused;
    pressedAtRef.current = Date.now();
    // Keep quick pause/resume requests ordered at the site's microphone button.
    microphoneChanges.current = microphoneChanges.current.catch(() => {}).then(async () => {
      if (sessionIdRef.current !== session) return;
      const response = await fetch(`/api/speech/web-live/${session}/microphone`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }),
      });
      if (!response.ok) throw Error(await failure(response, 'Voice could not pause for dictation.'));
      if (sessionIdRef.current === session) {
        pressedAtRef.current = Date.now();
        setMuted(!on);
        if (on && !dictationPausedRef.current) resumeMicrophone.current = false;
      }
    }).catch(error => setNote(error.message));
  }, [dictationPaused, stage]);

  // Closes at once: the hang-up and the last copy into the chat finish
  // behind it, as when the screen is left any other way.
  const close = () => {
    void endRef.current();
    onClose();
  };
  const closeRef = useRef(close);
  useLayoutEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Minimized, Esc belongs to whatever page is under the widget.
      if (minimized && !stageNodeRef.current?.contains(event.target as Node)) return;
      // A chat image opens its own portalled viewer above voice mode.
      if (event.defaultPrevented || document.querySelector('.bb-viewer-overlay')) return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    if (!minimized) document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => ringButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [minimized]);

  const latest = lines.at(-1);
  const look: VoiceStage = dictationPaused ? 'paused' : stage !== 'live' ? STAGE_LOOK[stage] : muted ? 'paused' : speaking ? 'speaking' : 'listening';
  lookRef.current = look;
  // Voice mode's ring: pause and resume listening, by the site's own mute.
  const pressRing = () => {
    if (dictationPaused) return;
    const session = sessionIdRef.current;
    if (!session || stage !== 'live') return;
    const on = muted;
    pressedAtRef.current = Date.now();
    setMuted(!on);
    void fetch(`/api/speech/web-live/${session}/microphone`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }),
    }).then(async response => {
      if (response.ok) return;
      setMuted(on);
      setNote(await failure(response, 'The microphone could not be switched.'));
    }).catch(() => setMuted(on));
  };
  const screen = (
    <div ref={stageNodeRef} {...miniDrag} className={`voice-stage${compact ? ' voice-stage-compact' : ''}${minimized ? ' voice-stage-minimized' : ''}`}
      data-stage={look} data-dictation-paused={dictationPaused || undefined} role={minimized ? 'region' : 'dialog'} aria-modal={minimized ? undefined : true} aria-label="Voice conversation">
      <div className="voice-stage-wash" aria-hidden />

      <header className="voice-stage-header">
        <div className="voice-stage-header-actions">
          {!compact && <button type="button" className="voice-chip" onClick={() => setShowTranscript(current => !current)} aria-pressed={showTranscript}>
            {showTranscript ? 'Hide chat' : 'Chat'}
          </button>}
          <button type="button" className={compact ? 'voice-widget-close' : 'voice-chip'} onClick={() => void resize(true)} aria-label="Minimize voice assistant" title="Minimize voice assistant">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M4 8h8" /></svg>
          </button>
          <button type="button" className={compact ? 'voice-widget-close' : 'voice-chip'} onClick={close} aria-label="Close voice mode" title="Close voice mode (Esc)">
            {compact ? <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="m4 4 8 8M12 4l-8 8" /></svg> : <>Close<span className="voice-chip-hint">Esc</span></>}
          </button>
        </div>
      </header>

      <div className="voice-stage-centre">
        {/* ChatGPT's page listens and speaks; the ring pauses its microphone. */}
        <button ref={ringButtonRef} type="button" className="voice-ring-button" onClick={pressRing}
          disabled={dictationPaused} aria-label={dictationPaused ? 'Paused for dictation' : look === 'paused' ? 'Start listening' : look === 'listening' || look === 'speaking' ? 'Pause listening' : stageLabel(look)}>
          <svg className="voice-ring" viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`} aria-hidden>
            <g className="voice-halo">
              {halo.map(ring => (
                <path key={ring.id} className="voice-halo-ring" d={ring.path}
                  style={{ '--halo-spread': `${ring.spread}`, '--halo-opacity': `${ring.opacity}`, '--halo-width': `${ring.width}` } as React.CSSProperties} />
              ))}
            </g>
            <g className="voice-ring-line">
              <path className="voice-ring-glow" d={ringPath} pathLength={1} />
              {scribblePaths.map((path, index) => (
                <path key={path} className="voice-ring-scribble" d={path} pathLength={1}
                  style={{ '--scribble-delay': `${index * 940}ms` } as React.CSSProperties} />
              ))}
              <path className="voice-ring-ink" d={ringPath} pathLength={1} />
            </g>
            <path className="voice-ring-echo" d={echoPath} pathLength={1} />
          </svg>
        </button>

        {minimized && <>
          <span className="voice-mini-status" role="status" title="Drag to move">{stageLabel(look)}</span>
          <button type="button" className="voice-mini-expand voice-widget-close"
            onClick={() => void resize(false)} aria-label="Expand voice assistant" title="Expand">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M9 3h4v4M13 3 8.5 7.5M7 13H3V9M3 13l4.5-4.5" />
            </svg>
          </button>
        </>}

        <p className="voice-stage-state">{stageLabel(look)}</p>

        {compact && <div ref={transcriptRef} className="voice-widget-transcript" role="log" aria-label="Conversation transcript" aria-live="polite">
          {spokenTurns.map((message, index) => <div key={`${message.role}-${index}`} className={`voice-widget-message voice-widget-message-${message.role}`}>
            {message.role === 'assistant' ? <VoiceResponse message={message} onSend={noSend} /> : <p>{message.content}</p>}
          </div>)}
        </div>}

        {!compact && latest ? (
          <div className={`voice-caption voice-caption-${latest.role === 'assistant' ? 'reply' : 'heard'}`}>
            <div className="voice-caption-text">
              {latest.role === 'assistant'
                ? <VoiceResponse message={{ role: 'assistant', content: latest.text }} onSend={noSend} />
                : <p>{latest.text}</p>}
            </div>
            <svg className="voice-caption-rule" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
              <path d={underlinePath} />
            </svg>
          </div>
        ) : null}

        {dictationPaused || note ? <p className="voice-note" role="status">{dictationPaused ? 'Paused for dictation. Voice resumes when dictation finishes.' : note}</p> : null}
      </div>

      {!compact && showTranscript ? (
        <div className="voice-transcript">
          {spokenTurns.length === 0 ? (
            <p className="voice-transcript-empty">Nothing said yet.</p>
          ) : spokenTurns.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`voice-transcript-line voice-transcript-${message.role}`}>
              {message.role === 'assistant' ? <VoiceResponse message={message} onSend={noSend} /> : <p>{message.content}</p>}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(screen, document.body);
}
