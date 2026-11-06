import { requestForegroundMicrophone, stopForegroundStream } from './clap/audio-focus';
import { decodedRecordingAsWav } from './live-dictation';
import { prepareSpeech, speechErrorMessage } from './prepare-client';
import { requestTranscript } from './dictation-transcript';
import { dictationPreview, parseDictationCommand } from './dictation-command';
import { DICTATION_MICROPHONE, selectDictationProvider } from './dictation-provider';
import { openHeldDictationProvider } from './dictation-provider-cache';
import { bufferDictationAudio, type BufferedDictationAudio } from './dictation-audio-buffer';
import type { SubscriptionVoice } from './subscription-live';
import { holdDictationPriority } from './dictation-priority';

export type DictationNotice = { type: string; id?: number; message?: string; text?: string; submit?: boolean; mode?: 'dictate' | 'reply' };
type LiveVoice = Pick<SubscriptionVoice, 'close' | 'finishTranscript' | 'isHealthy'>;
type Session = { id: number; controller: AbortController; stream?: MediaStream; recorder?: MediaRecorder; chunks: Blob[]; released: boolean;
  buffered?: BufferedDictationAudio; voice?: LiveVoice; live?: Promise<LiveVoice | null>; liveFailed?: boolean; closing?: Promise<void>; preview?: string; commandText?: string;
  command: Promise<string>; completeCommand: (text: string) => void; finalizing?: Promise<string>; releasePriority?: () => void; commands: boolean };
type Dependencies = {
  microphone: () => Promise<MediaStream>;
  stopStream: (stream?: MediaStream) => void;
  recorder: (stream: MediaStream) => MediaRecorder;
  transcribe: (audio: Blob, signal: AbortSignal) => Promise<string>;
  selectProvider?: (signal: AbortSignal) => Promise<boolean>;
  openProvider?: (stream: MediaStream, selected: Promise<boolean>, signal: AbortSignal, disconnected: () => void, onTranscript: (text: string, final?: boolean) => void, onInputReady: () => void) => Promise<LiveVoice | null>;
  buffer?: (stream: MediaStream) => BufferedDictationAudio;
  holdPriority?: () => () => void;
};

async function transcribe(audio: Blob, signal: AbortSignal): Promise<string> {
  const wav = await decodedRecordingAsWav(audio);
  signal.throwIfAborted();
  if (!wav?.size) throw new Error('No audio was captured. Hold Ctrl + Shift and speak after the voice dots appear.');
  await prepareSpeech(signal);
  const text = await requestTranscript(wav, 'dictation.wav', signal, true);
  if (!text) throw new Error('No words were recognized. Hold Ctrl + Shift to try again.');
  return text;
}

const defaults: Dependencies = {
  microphone: () => requestForegroundMicrophone(DICTATION_MICROPHONE),
  stopStream: stopForegroundStream,
  recorder: stream => new MediaRecorder(stream),
  transcribe,
  selectProvider: selectDictationProvider,
  openProvider: (stream, selected, signal, disconnected, onTranscript, onInputReady) => openHeldDictationProvider(stream, selected, signal, onTranscript, disconnected, onInputReady),
  buffer: bufferDictationAudio,
  holdPriority: holdDictationPriority,
};

/** Every async completion belongs to one hold. A cancelled hold can never type. */
export class HoldDictationRecorder {
  private session: Session | null = null;
  private retirement: Promise<void> = Promise.resolve();
  constructor(private readonly report: (notice: DictationNotice) => void,
    private readonly status: (message: string, recording: boolean) => void,
    private readonly deps: Dependencies = defaults,
    private readonly onMicrophone: (stream: MediaStream | null) => void = () => {},
    private readonly onStage: (id: number, stage: string) => void = () => {}) {}

  async start(id: number, commands = true): Promise<void> {
    this.cancel();
    let completeCommand!: (text: string) => void;
    const command = new Promise<string>(resolve => { completeCommand = resolve; });
    const session: Session = { id, controller: new AbortController(), chunks: [], released: false, command, completeCommand,
      releasePriority: this.deps.holdPriority?.(), commands };
    this.session = session;
    this.status('Preparing microphone…', false);
    try {
      const selected = this.deps.selectProvider?.(session.controller.signal);
      void selected?.catch(() => {});
      const stream = await this.deps.microphone();
      if (this.session !== session || session.released) { this.deps.stopStream(stream); return; }
      this.onStage(id, 'microphone-ready');
      session.stream = stream;
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
        if (!session.released) this.fail(session, new Error('The microphone was disconnected. Reconnect it and try again.'));
      }, { once: true });
      // Keep a complete backup while live transcription runs during the hold.
      // Queued PCM protects the first words during connection startup.
      const recorder = this.deps.recorder(stream); session.recorder = recorder;
      recorder.ondataavailable = event => { if (event.data.size) session.chunks.push(event.data); };
      recorder.onerror = () => this.fail(session, new Error('The microphone stopped recording. Hold Ctrl + Shift to try again.'));
      recorder.onstop = () => { void this.finish(session); };
      recorder.start(250);
      if (selected && this.deps.openProvider && this.deps.buffer) {
        try {
          session.buffered = this.deps.buffer(stream);
          const buffered = session.buffered;
          session.live = Promise.all([this.retirement, buffered.ready]).then(() => {
            session.controller.signal.throwIfAborted();
            this.onStage(id, 'provider-opening');
            return this.deps.openProvider!(buffered.stream, selected, session.controller.signal,
              () => { session.liveFailed = true; }, text => {
                if (this.session !== session || session.controller.signal.aborted || session.liveFailed || session.commandText) return;
                // The spoken command is the endpoint. Waiting for turn.done
                // can stall Enter long after the complete command is visible.
                if (session.commands && parseDictationCommand(text).submit) {
                  session.commandText = text;
                  session.completeCommand(text);
                  this.onStage(session.id, 'voice-command');
                  this.report({ type: 'finish', id: session.id });
                  this.stop(session.id);
                  session.buffered?.close();
                  // Do not wait for connection setup, buffered audio, the
                  // recorder's stop event or remote cleanup to submit text
                  // that has already arrived on the live transcript channel.
                  this.complete(session, text);
                  void this.retire(session).finally(() => this.releasePriority(session));
                  return;
                }
                const preview = dictationPreview(text);
                if (session.preview === preview || (session.preview === undefined && !preview)) return;
                if (session.preview === undefined) this.onStage(id, 'first-transcript');
                session.preview = preview;
                this.report({ type: 'preview', id: session.id, text: preview });
              }, () => { if (this.session === session && !session.controller.signal.aborted) { this.onStage(id, 'provider-ready'); buffered.start(); } });
          }).then(async voice => {
              if (this.session !== session || session.controller.signal.aborted) { await voice?.close(); return null; }
              if (!voice) { buffered.close(); this.onStage(id, 'recording-ready'); return null; }
              session.voice = voice; buffered.start(); return voice;
            }).catch(error => {
              buffered.close();
              // Recording a fallback cannot cure a confirmed capacity denial.
              // Surface it now instead of inviting speech and failing again.
              if (error?.status === 429) this.fail(session, error);
              else if (this.session === session && !session.released) this.onStage(id, 'recording-ready');
              return null;
            });
          await buffered.ready;
          this.onStage(id, 'capture-ready');
        } catch { session.buffered?.close(); this.onStage(id, 'recording-ready'); /* The complete recording remains available if Web Audio is unavailable. */ }
      } else this.onStage(id, 'recording-ready');
      if (this.session !== session || session.released) return;
      this.onMicrophone(stream);
      this.status('Listening — release Ctrl + Shift to insert', true);
    } catch (error) { this.fail(session, error); }
  }
  disableCommands(id: number) { if (this.session?.id === id) this.session.commands = false; }
  stop(id: number) {
    const session = this.session;
    if (!session || session.id !== id || session.released) return;
    session.released = true;
    this.onStage(id, 'keys-released');
    if (!session.recorder || session.recorder.state === 'inactive') {
      this.fail(session, new Error('Hold Ctrl + Shift until the voice dots appear, then speak.'));
      return;
    }
    this.status('Transcribing…', false);
    session.buffered?.stopCapture();
    session.recorder.stop();
    this.deps.stopStream(session.stream);
    this.onMicrophone(null);
  }
  cancel(id?: number) {
    const session = this.session;
    if (!session || (id !== undefined && session.id !== id)) return;
    this.session = null;
    session.controller.abort();
    session.buffered?.close();
    void this.retire(session).finally(() => this.releasePriority(session));
    if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
    this.deps.stopStream(session.stream);
    this.onMicrophone(null);
    session.chunks.length = 0;
  }
  private retire(session: Session): Promise<void> {
    if (!session.closing) {
      const closeVoice = async (voice: LiveVoice) => {
        // An explicit command already supplied its text. Close immediately;
        // waiting to finalize it also stalls the next hold and voice resume.
        await voice.close();
      };
      // The next hold may capture immediately, but cannot allocate another
      // provider connection until this hold (including late setup) releases it.
      session.closing = (session.voice ? closeVoice(session.voice)
        : session.live?.then(voice => voice ? closeVoice(voice) : undefined) ?? Promise.resolve()).then(() => {}, () => {});
      this.retirement = Promise.all([this.retirement, session.closing]).then(() => {});
    }
    return session.closing;
  }
  private releasePriority(session: Session) {
    session.releasePriority?.(); session.releasePriority = undefined;
  }
  private complete(session: Session, text: string) {
    if (this.session !== session || session.controller.signal.aborted) return;
    this.session = null;
    session.chunks.length = 0;
    this.report({ type: 'result', id: session.id, ...(session.commands ? parseDictationCommand(text) : { text, submit: false }) });
  }
  private async finish(session: Session) {
    if (this.session !== session || !session.released) return;
    try {
      const audio = new Blob(session.chunks, { type: session.recorder?.mimeType || 'audio/webm' });
      session.chunks.length = 0;
      if (!audio.size && !session.commandText) throw new Error('No audio was captured. Hold Ctrl + Shift to try again.');
      let text = '';
      const voice = await session.live;
      if (this.session !== session || session.controller.signal.aborted) return;
      if (!session.commandText && voice && !session.liveFailed && voice.isHealthy()) {
        try {
          await session.buffered?.finish();
          session.controller.signal.throwIfAborted();
          this.onStage(session.id, 'audio-drained');
          session.finalizing = voice.finishTranscript({ settleFinal: true });
          // A completed voice command is already an explicit endpoint. It can
          // arrive after key-up while finalization waits for media/relay state.
          // Submit it now; retire() owns the remaining provider cleanup.
          text = await Promise.race([session.finalizing, session.command]);
          if (!session.commandText) this.onStage(session.id, text.trim() ? 'provider-final' : 'provider-empty');
          if (session.liveFailed || !voice.isHealthy()) text = '';
        } catch { /* Retry the complete backup, never insert a partial live result. */ }
      }
      // A confirmed send command ends the utterance immediately, including
      // when it arrives after physical release. Never wait for more speech or
      // replay the backup after that explicit endpoint.
      text = session.commandText ?? text;
      session.buffered?.close();
      const closing = this.retire(session);
      if (this.session !== session || session.controller.signal.aborted) return;
      // Local audio stops synchronously; remote cleanup must not delay typing.
      // A retry does wait for the old connection to release its provider slot.
      if (!text.trim()) {
        await closing;
        session.controller.signal.throwIfAborted();
        this.onStage(session.id, 'fallback-started');
        text = await this.deps.transcribe(audio, session.controller.signal);
        this.onStage(session.id, 'fallback-finished');
      }
      if (this.session !== session || session.controller.signal.aborted) return;
      this.complete(session, text);
    } catch (error) { this.fail(session, error); }
    finally {
      // The backup is also a voice operation. Keep conversations paused until
      // it finishes, even though the failed live connection has already closed.
      void this.retire(session).finally(() => this.releasePriority(session));
    }
  }
  private fail(session: Session, error: unknown) {
    if (this.session !== session) return;
    this.cancel();
    const denied = error instanceof Error && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
    const message = denied ? 'Allow microphone access for Breadboard in Windows Settings, then try Ctrl + Shift again.'
      : speechErrorMessage(error, 'Dictation could not start. Check Voice settings and try again.');
    this.status(message, false);
    this.report({ type: 'error', id: session.id, message });
  }
}
