import { app, BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent, type Rectangle, type WebContents } from 'electron';
import * as path from 'node:path';
import { hardenWindow, type AllowedOrigins } from './security';
import { rendererWebPreferences } from './window-options';
import type { DesktopNotificationToast } from '../shared/ipc-contract';
import { BrowserTerminalBridge, type BrowserTerminalAccess } from './browser-terminal';

/** Persistent microphone owner, independent of the selected browser tab. */
export class VoiceCompanion {
  private window: BrowserWindow | null = null;
  private returnFocus: BrowserWindow | null = null;
  private opening: Promise<void> | null = null;
  private visible = false;
  private expandedBounds: Rectangle | null = null;
  private conversationKey: string | null = null;
  private stopping = false;
  private target = '';
  private rendererReady = false;
  private pendingNotifications: DesktopNotificationToast[] = [];
  private static readonly maxPendingNotifications = 64;
  private readonly screenBridge = new BrowserTerminalBridge();
  private screenAccess: { access: BrowserTerminalAccess; expires: number } | null = null;
  private contextGeneration = 0;
  private readonly trackFocus = (_event: Electron.Event, window: BrowserWindow) => {
    if (this.visible && window !== this.window) this.returnFocus = window;
  };
  constructor(private readonly options: { dashboardUrl: () => string | null; allowed: AllowedOrigins;
    contextTargets?: (window: BrowserWindow) => { page: WebContents; app: WebContents } | null }) {
    ipcMain.handle('breadboard:voice-state', event => this.owns(event) && this.visible);
    ipcMain.handle('breadboard:voice-conversation', event => this.owns(event) && this.visible ? this.conversationKey : null);
    ipcMain.handle('breadboard:voice-show', event => this.owns(event) ? this.launch() : false);
    ipcMain.handle('breadboard:voice-hide', event => { if (this.owns(event)) this.hide(); });
    ipcMain.handle('breadboard:voice-minimize', (event, minimized: unknown) =>
      this.owns(event) && typeof minimized === 'boolean' ? this.setMinimized(minimized) : false);
    ipcMain.handle('breadboard:voice-screen-context', event => this.owns(event) && this.visible ? this.contextAccess() : null);
    ipcMain.handle('breadboard:voice-ready', event => {
      if (!this.owns(event)) return false;
      this.rendererReady = true;
      this.flushNotifications();
      return true;
    });
    app.on('browser-window-focus', this.trackFocus);
  }
  private contextTargets() {
    return this.visible && this.returnFocus && !this.returnFocus.isDestroyed()
      ? this.options.contextTargets?.(this.returnFocus) ?? null : null;
  }
  private revokeContext() {
    this.contextGeneration++;
    if (this.screenAccess) this.screenBridge.revoke(this.screenAccess.access);
    this.screenAccess = null;
  }
  private async contextAccess() {
    if (!this.contextTargets()) return null;
    if (this.screenAccess && this.screenAccess.expires > Date.now()) return this.screenAccess.access;
    this.revokeContext();
    const generation = this.contextGeneration;
    const access = await this.screenBridge.grant(() => this.contextTargets()?.page ?? null,
      { source: 'voice', appTarget: () => this.contextTargets()?.app ?? null });
    if (generation !== this.contextGeneration || !this.contextTargets()) { this.screenBridge.revoke(access); return null; }
    this.screenAccess = { access, expires: Date.now() + 20 * 60_000 };
    return access;
  }
  private owns(event: IpcMainInvokeEvent) {
    return event.sender === this.window?.webContents && event.senderFrame === event.sender.mainFrame && event.sender.getURL() === this.target;
  }
  async start(): Promise<void> {
    if (this.opening) return this.opening;
    const dashboardUrl = this.options.dashboardUrl();
    if (this.window && dashboardUrl && this.target !== new URL('/voice', dashboardUrl).toString()) { this.window.destroy(); this.window = null; }
    if (this.window && !this.window.isDestroyed()) return;
    this.opening = this.create();
    try { await this.opening; } finally { this.opening = null; }
  }
  private async create() {
    const dashboardUrl = this.options.dashboardUrl();
    if (!dashboardUrl) throw new Error('Breadboard is still starting.');
    this.target = new URL('/voice', dashboardUrl).toString();
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    // Double both dimensions for four times the area, scaling down together on
    // smaller displays so the conversation keeps the same proportions.
    const scale = Math.min(1, area.width / 800, area.height / 480);
    const width = Math.round(800 * scale), height = Math.round(480 * scale);
    const window = new BrowserWindow({ width, height,
      x: area.x + Math.max(0, area.width - width - 20), y: area.y + Math.max(0, area.height - height - 20),
      title: 'Voice', show: false, alwaysOnTop: true, autoHideMenuBar: true,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: true,
      resizable: false, maximizable: false, fullscreenable: false,
      webPreferences: { ...rendererWebPreferences(path.join(__dirname, '..', 'preload', 'voice-preload.js')),
        backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    this.window = window; this.rendererReady = false; this.expandedBounds = null; window.setMenu(null); hardenWindow(window, this.options.allowed);
    const guard = (event: Electron.Event, url: string) => { if (url !== this.target) event.preventDefault(); };
    window.webContents.on('will-navigate', guard); window.webContents.on('will-redirect', guard);
    window.on('close', event => { if (!this.stopping) { event.preventDefault(); this.hide(); } });
    window.on('closed', () => { if (this.window === window) { this.window = null; this.rendererReady = false; this.visible = false; this.revokeContext(); } });
    try { await window.loadURL(this.target); }
    catch (error) { window.destroy(); throw error; }
  }
  async launch(conversationKey?: string): Promise<boolean> {
    const source = BrowserWindow.getFocusedWindow();
    await this.start();
    const window = this.window;
    if (!window || window.isDestroyed()) return false;
    if (source && source !== window) this.returnFocus = source;
    this.conversationKey = conversationKey ?? null;
    this.setMinimized(false);
    this.visible = true; window.webContents.send('breadboard:voice-open', true, this.conversationKey);
    if (window.isMinimized()) window.restore();
    window.show(); window.focus(); return true;
  }
  private setMinimized(minimized: boolean): boolean {
    const window = this.window;
    if (!window || window.isDestroyed()) return false;
    if (minimized === Boolean(this.expandedBounds)) return minimized;
    const current = window.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    const target = minimized ? { width: 240, height: 72 } : this.expandedBounds!;
    const width = Math.min(target.width, area.width), height = Math.min(target.height, area.height);
    // Keep the bottom-right corner in place, including after the widget moves.
    const x = Math.max(area.x, Math.min(current.x + current.width - width, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(current.y + current.height - height, area.y + area.height - height));
    this.expandedBounds = minimized ? current : null;
    window.setBounds({ x, y, width, height });
    window.webContents.send('breadboard:voice-minimized', minimized);
    return minimized;
  }
  private hide() {
    this.visible = false;
    this.conversationKey = null;
    this.revokeContext();
    const window = this.window, source = this.returnFocus;
    this.returnFocus = null;
    if (!window || window.isDestroyed()) return;
    const restoreFocus = window.isFocused();
    window.webContents.send('breadboard:voice-open', false); window.hide();
    this.setMinimized(false);
    // Windows does not return focus after hiding this persistent widget. The
    // originating window must be active again for its clap listener to resume.
    if (restoreFocus && source && !source.isDestroyed() && !source.isMinimized()) {
      source.show(); source.focus();
    }
  }
  notify(notice: DesktopNotificationToast) {
    const window = this.window;
    if (!window || window.isDestroyed() || !this.rendererReady) {
      this.pendingNotifications = this.pendingNotifications.filter(item => item.id !== notice.id);
      this.pendingNotifications.push(notice);
      if (this.pendingNotifications.length > VoiceCompanion.maxPendingNotifications) this.pendingNotifications.shift();
      return;
    }
    try { window.webContents.send('breadboard:voice-notification', notice); }
    catch { this.pendingNotifications.push(notice); }
  }
  private flushNotifications() {
    const window = this.window;
    if (!window || window.isDestroyed() || !this.rendererReady || !this.pendingNotifications.length) return;
    const pending = this.pendingNotifications;
    this.pendingNotifications = [];
    for (let index = 0; index < pending.length; index++) {
      try { window.webContents.send('breadboard:voice-notification', pending[index]); }
      catch { this.pendingNotifications = pending.slice(index); break; }
    }
  }
  stop() {
    this.visible = false; this.revokeContext();
    app.removeListener('browser-window-focus', this.trackFocus);
    void this.screenBridge.close();
    this.stopping = true; this.window?.destroy(); this.window = null; this.rendererReady = false; this.pendingNotifications = []; this.returnFocus = null;
    for (const channel of ['breadboard:voice-state', 'breadboard:voice-conversation', 'breadboard:voice-show', 'breadboard:voice-hide', 'breadboard:voice-minimize', 'breadboard:voice-screen-context', 'breadboard:voice-ready']) ipcMain.removeHandler(channel);
  }
}
