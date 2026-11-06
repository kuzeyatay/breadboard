import type { DictationNotice, HoldDictationRecorder } from './hold-dictation';
import type { DictationScreen } from './dictation-reply';

type Recorder = Pick<HoldDictationRecorder, 'start' | 'stop' | 'cancel' | 'disableCommands'>;
type Session = { id: number; mode: 'dictate' | 'reply'; controller: AbortController; context?: Promise<DictationScreen>; answering?: boolean };

/** Keeps raw instructions out of the field and rejects every stale AI result. */
export class DictationSession {
  private active?: Session;
  readonly recorder: Recorder;
  constructor(private readonly options: {
    recorder: (report: (notice: DictationNotice) => void) => Recorder;
    report: (notice: DictationNotice) => void;
    screen: (id: number) => Promise<DictationScreen>;
    reply: (text: string, screen: DictationScreen, signal: AbortSignal, onText: (text: string) => void) => Promise<string>;
    answering: () => void;
  }) { this.recorder = options.recorder(notice => this.receive(notice)); }
  start(id: number, mode: 'dictate' | 'reply' = 'dictate') {
    this.cancel();
    const session: Session = { id, mode, controller: new AbortController() }; this.active = session;
    if (mode === 'reply') this.capture(session);
    void this.recorder.start(id, mode !== 'reply');
  }
  promote(id: number) {
    const session = this.active;
    if (!session || session.id !== id || session.mode === 'reply' || session.answering) return;
    session.mode = 'reply'; this.recorder.disableCommands(id);
    // Clear only this hold's owned preview if Shift was pressed a little later.
    this.options.report({ type: 'preview', id, text: '' });
    this.capture(session);
  }
  stop(id: number) { if (this.active?.id === id) this.recorder.stop(id); }
  cancel(id?: number) {
    if (!this.active || (id !== undefined && this.active.id !== id)) return;
    const previous = this.active; this.active = undefined;
    previous.controller.abort(); this.recorder.cancel(previous.id);
  }
  private capture(session: Session) {
    session.context = Promise.resolve().then(() => this.options.screen(session.id));
    void session.context.catch(error => this.fail(session, error));
  }
  private fail(session: Session, error: unknown) {
    if (this.active !== session) return;
    this.cancel(session.id);
    this.options.report({ type: 'error', id: session.id, message: error instanceof Error ? error.message : 'Screen-aware dictation could not finish.' });
  }
  private receive(notice: DictationNotice) {
    const session = this.active;
    if (!session || notice.id !== session.id) return;
    if (notice.type === 'error') { this.fail(session, new Error(notice.message)); return; }
    if (session.mode === 'dictate') { this.options.report(notice); return; }
    if (notice.type !== 'result' || session.answering) return;
    session.answering = true; this.options.answering();
    void (async () => {
      const screen = await session.context!;
      session.controller.signal.throwIfAborted();
      const text = await this.options.reply(notice.text || '', screen, session.controller.signal, text => {
        if (this.active === session) this.options.report({ type: 'preview', id: session.id, text });
      });
      if (this.active !== session) return;
      this.options.report({ type: 'result', id: session.id, text, submit: false });
      this.active = undefined;
    })().catch(error => this.fail(session, error));
  }
}
