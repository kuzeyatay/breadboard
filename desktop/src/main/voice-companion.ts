import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron';
import * as path from 'node:path';
import { hardenWindow, type AllowedOrigins } from './security';
import { rendererWebPreferences } from './window-options';
import type { DesktopNotificationToast } from '../shared/ipc-contract';

/** Persistent microphone owner, independent of the selected browser tab. */
export class VoiceCompanion {
  private window: BrowserWindow | null = null;
  private opening: Promise<void> | null = null;
  private visible = false;
  private stopping = false;
  private target = '';
  constructor(private readonly options: { dashboardUrl: () => string | null; allowed: AllowedOrigins }) {
    ipcMain.handle('breadboard:voice-state', event => this.owns(event) && this.visible);
    ipcMain.handle('breadboard:voice-show', event => this.owns(event) ? this.launch() : false);
    ipcMain.handle('breadboard:voice-hide', event => { if (this.owns(event)) this.hide(); });
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
    const width = Math.min(400, area.width), height = Math.min(240, area.height);
    const window = new BrowserWindow({ width, height,
      x: area.x + Math.max(0, area.width - width - 20), y: area.y + Math.max(0, area.height - height - 20),
      title: 'Voice', show: false, alwaysOnTop: true, autoHideMenuBar: true,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: true,
      resizable: false, maximizable: false, fullscreenable: false,
      webPreferences: { ...rendererWebPreferences(path.join(__dirname, '..', 'preload', 'voice-preload.js')), backgroundThrottling: false },
    });
    this.window = window; window.setMenu(null); hardenWindow(window, this.options.allowed);
    const guard = (event: Electron.Event, url: string) => { if (url !== this.target) event.preventDefault(); };
    window.webContents.on('will-navigate', guard); window.webContents.on('will-redirect', guard);
    window.on('close', event => { if (!this.stopping) { event.preventDefault(); this.hide(); } });
    window.on('closed', () => { if (this.window === window) this.window = null; });
    try { await window.loadURL(this.target); }
    catch (error) { window.destroy(); throw error; }
  }
  async launch(): Promise<boolean> {
    await this.start();
    const window = this.window;
    if (!window || window.isDestroyed()) return false;
    this.visible = true; window.webContents.send('breadboard:voice-open', true);
    if (window.isMinimized()) window.restore();
    window.show(); window.focus(); return true;
  }
  private hide() {
    this.visible = false;
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('breadboard:voice-open', false); this.window.hide();
  }
  notify(notice: DesktopNotificationToast) {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('breadboard:voice-notification', notice);
  }
  stop() {
    this.stopping = true; this.window?.destroy(); this.window = null;
    for (const channel of ['breadboard:voice-state', 'breadboard:voice-show', 'breadboard:voice-hide']) ipcMain.removeHandler(channel);
  }
}
