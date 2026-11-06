import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as path from 'node:path';
import { hardenWindow, type AllowedOrigins } from './security';
import { rendererWebPreferences } from './window-options';
import { dictationPosition, DICTATION_WINDOW_SIZE, type DictationAnchor } from './dictation-position';
import { captureDictationScreen, type DictationScreen } from './dictation-screen';

const READY = 'breadboard:dictation-ready', REPORT = 'breadboard:dictation-report', CONTEXT = 'breadboard:dictation-screen';
type Notice = { type: string; id?: number; message?: string; text?: string; submit?: boolean; anchor?: DictationAnchor; mode?: 'dictate' | 'reply' };

/** A non-focusable microphone owner; only its private renderer can return text. */
export class SystemDictation {
  private window: BrowserWindow | null = null;
  private helper: ChildProcessWithoutNullStreams | null = null;
  private opening: Promise<void> | null = null;
  private target = '';
  private active: { id: number; released: boolean; committing?: boolean; submit?: boolean; mode?: 'dictate' | 'reply'; context?: Promise<DictationScreen> } | null = null;
  private limitTimer?: NodeJS.Timeout;
  private anchor: DictationAnchor | null = null;
  private stopped = false;
  constructor(private readonly options: { dashboardUrl: () => string | null; allowed: AllowedOrigins; log: (line: string) => void }) {
    ipcMain.handle(READY, event => { if (!this.owns(event)) return false; this.startHelper(); return true; });
    ipcMain.handle(CONTEXT, async (event, id: unknown) => {
      const active = this.active;
      if (!this.owns(event) || active?.id !== id || active?.mode !== 'reply' || !active.context) throw new Error('No screen-aware dictation is active.');
      const context = await active.context;
      if (!this.owns(event) || this.active !== active) throw new Error('Screen-aware dictation was cancelled.');
      return context;
    });
    ipcMain.on(REPORT, this.report);
  }
  private owns(event: IpcMainEvent | IpcMainInvokeEvent) {
    return !this.stopped && event.sender === this.window?.webContents
      && event.senderFrame === event.sender.mainFrame && event.senderFrame?.url === this.target;
  }
  async start(): Promise<void> {
    if (process.platform !== 'win32' || this.stopped) return;
    if (this.opening) return this.opening;
    const base = this.options.dashboardUrl();
    if (!base) return;
    const target = new URL('/dictation', base).href;
    if (this.window && !this.window.isDestroyed() && this.target === target) return;
    this.closeWindow();
    this.target = target;
    const window = new BrowserWindow({
      ...DICTATION_WINDOW_SIZE, show: false, frame: false, focusable: false,
      alwaysOnTop: true, skipTaskbar: true, resizable: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, thickFrame: false,
      webPreferences: { ...rendererWebPreferences(path.join(__dirname, '..', 'preload', 'dictation-preload.js')),
        backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    this.window = window;
    window.setMenu(null);
    window.setIgnoreMouseEvents(true);
    hardenWindow(window, this.options.allowed);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event: Electron.Event, url: string) => { if (url !== this.target) event.preventDefault(); };
    window.webContents.on('will-navigate', guard);
    window.webContents.on('will-redirect', guard);
    window.webContents.on('did-start-loading', () => this.cancel());
    window.webContents.on('render-process-gone', () => {
      this.closeWindow();
      this.options.log('[dictation] renderer exited; keyboard hooks released');
    });
    window.on('closed', () => { if (this.window === window) { this.window = null; this.stopHelper(); } });
    this.opening = window.loadURL(target);
    try { await this.opening; } catch (error) { this.closeWindow(); throw error; }
    finally { this.opening = null; }
  }
  private startHelper() {
    if (this.helper || this.stopped || process.platform !== 'win32') return;
    const executable = path.join(__dirname, '..', 'native', 'windows-dictation.exe')
      .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
    const helper = spawn(executable, [], { windowsHide: true, stdio: 'pipe' });
    this.helper = helper;
    const lines = createInterface({ input: helper.stdout });
    lines.on('line', line => {
      if (this.helper !== helper) return;
      try { this.receive(JSON.parse(line) as Notice); }
      catch { this.options.log('[dictation] invalid helper event'); }
    });
    helper.stderr.on('data', () => { /* Never log audio, transcripts or pressed keys. */ });
    helper.stdin.on('error', () => { if (this.helper === helper) this.fail('Dictation lost its keyboard connection. Restart Breadboard.'); });
    helper.once('error', () => { if (this.helper === helper) this.fail('Dictation could not start. Rebuild and restart Breadboard.'); });
    helper.once('exit', () => {
      lines.close();
      if (this.helper !== helper) return;
      this.helper = null;
      this.fail('Dictation stopped. Restart Breadboard to try again.');
    });
  }
  private send(command: Notice) {
    const contents = this.window?.webContents;
    if (!contents || contents.isDestroyed()) return;
    try { contents.send('breadboard:dictation-command', command); }
    catch { /* A crashed renderer cannot receive cancellation; teardown still unhooks. */ }
  }
  private write(command: Notice) {
    if (this.helper && !this.helper.stdin.destroyed) this.helper.stdin.write(JSON.stringify(command) + '\n');
  }
  private show() {
    if (!this.window || this.window.isDestroyed() || !this.anchor || !this.active) return;
    this.positionAtCaret();
    this.window.showInactive();
    this.window.moveTop();
  }
  private updateAnchor(anchor?: DictationAnchor) {
    if (!anchor || ![anchor.x, anchor.y, anchor.width, anchor.height].every(Number.isFinite)
      || anchor.width < 0 || anchor.height <= 0) return;
    this.anchor = screen.screenToDipRect(null, {
      x: Math.round(anchor.x), y: Math.round(anchor.y), width: Math.max(1, Math.round(anchor.width)), height: Math.round(anchor.height),
    });
    this.positionAtCaret();
  }
  private positionAtCaret(caret = this.anchor) {
    if (!this.window || this.window.isDestroyed() || !caret) return;
    const position = dictationPosition(caret, screen.getDisplayNearestPoint(caret).workArea);
    const [x, y] = this.window.getPosition();
    // Keep dimensions explicit when crossing monitors: Windows can resize a
    // frameless window during its DPI transition. Never compound the old size.
    const [width = 0, height = 0] = this.window.getSize();
    // Fractional DPI can round the invisible surface by one DIP. Do not
    // continuously resize an otherwise stationary window to fight rounding.
    if (x !== position.x || y !== position.y || Math.abs(width - DICTATION_WINDOW_SIZE.width) > 1 || Math.abs(height - DICTATION_WINDOW_SIZE.height) > 1)
      this.window.setBounds({ ...position, ...DICTATION_WINDOW_SIZE }, false);
  }
  private captureContext() {
    if (!this.active || this.active.context) return;
    this.active.context = this.anchor ? captureDictationScreen({ ...this.anchor })
      : Promise.reject(new Error('The selected text field has no screen position. Try another field.'));
    void this.active.context.catch(() => {});
  }
  private receive(notice: Notice) {
    if (notice.type === 'ready' || notice.type === 'hooks-restored') {
      this.options.log(notice.type === 'ready' ? '[dictation] keyboard hooks ready' : '[dictation] keyboard hooks restored');
      return;
    }
    if (notice.type === 'start' && Number.isSafeInteger(notice.id)) {
      this.cancel();
      this.active = { id: notice.id!, released: false, mode: notice.mode === 'reply' ? 'reply' : 'dictate' };
      this.anchor = null; this.updateAnchor(notice.anchor);
      if (this.active.mode === 'reply') this.captureContext();
      this.show(); this.send(notice);
      this.limitTimer = setTimeout(() => this.fail('Dictation reached its two-minute limit. Hold Ctrl + Shift to try again.'), 120_000);
    } else if (notice.type === 'error' && (!notice.id || this.active?.id === notice.id || !this.active)) {
      this.fail(notice.message || 'Dictation could not finish.');
    } else if (notice.id === this.active?.id) {
      if (notice.type === 'mode' && notice.mode === 'reply' && !this.active!.released && !this.active!.committing) {
        this.active!.mode = 'reply'; this.captureContext(); this.send(notice);
      } else if (notice.type === 'anchor') {
        this.updateAnchor(notice.anchor); this.show();
      } else if (notice.type === 'stop') {
        this.active!.released = true; clearTimeout(this.limitTimer); this.send(notice);
        // Both transcription and generated replies keep their progress above
        // the caret until the native editor acknowledges the final insertion.
        this.show();
        this.limitTimer = setTimeout(() => this.fail('Transcription took too long. Hold Ctrl + Shift to try again.'), 120_000);
      } else if (notice.type === 'cancel') {
        this.cancel(); this.send({ type: 'status', message: 'Dictation cancelled' });
      } else if (notice.type === 'inserted') {
        const submitted = this.active?.submit;
        this.active = null; clearTimeout(this.limitTimer);
        this.send({ type: 'status', message: submitted ? 'Text inserted · Enter pressed' : 'Text inserted' });
        this.window?.hide();
      }
    }
  }
  private readonly report = (event: IpcMainEvent, value: unknown) => {
    if (!this.owns(event) || !value || typeof value !== 'object') return;
    const notice = value as Notice;
    if (!this.active || notice.id !== this.active.id) return;
    if (notice.type === 'finish' && this.active.mode !== 'reply' && !this.active.committing) {
      this.active.released = true; clearTimeout(this.limitTimer);
      this.show(); this.write({ type: 'finish', id: notice.id });
      this.send({ type: 'stop', id: notice.id });
      this.limitTimer = setTimeout(() => this.fail('Transcription took too long. Hold Ctrl + Shift to try again.'), 120_000);
    } else if (notice.type === 'preview' && !this.active.committing && typeof notice.text === 'string' && notice.text.length <= 32000) {
      this.write({ type: 'preview', id: notice.id, text: notice.text });
    } else if (notice.type === 'result' && this.active.released && !this.active.committing && typeof notice.text === 'string' && notice.text.length <= 32000) {
      this.active.committing = true;
      this.active.submit = this.active.mode !== 'reply' && notice.submit === true;
      this.write({ type: 'insert', id: notice.id, text: notice.text, submit: this.active.submit });
    } else if (notice.type === 'error' && typeof notice.message === 'string') this.fail(notice.message.slice(0, 500));
  };
  private cancel() {
    clearTimeout(this.limitTimer);
    this.window?.hide();
    if (this.active) {
      const command = { type: 'cancel', id: this.active.id };
      this.write(command); this.send(command); this.active = null;
    }
  }
  private fail(message: string) {
    this.options.log(`[dictation] ${message}`);
    this.cancel(); this.send({ type: 'error', message });
  }
  private stopHelper() {
    this.cancel();
    const helper = this.helper; this.helper = null;
    // EOF makes the helper unhook and exit even after an Electron crash.
    helper?.stdin.end();
    if (helper) { const timer = setTimeout(() => helper.kill(), 1500); timer.unref(); }
  }
  private closeWindow() {
    this.stopHelper(); this.anchor = null;
    const window = this.window; this.window = null;
    if (window && !window.isDestroyed()) window.destroy();
  }
  stop() {
    this.stopped = true; this.closeWindow();
    ipcMain.removeHandler(READY); ipcMain.removeHandler(CONTEXT); ipcMain.removeListener(REPORT, this.report);
  }
}
