import { desktopTabsBridge } from '../desktop-browser-tabs';
import type { NotificationSpeechNotice } from './notification-events';
import { activeVoiceChatKey } from './voice-chat-link';
export interface VoiceCompanionBridge {
  state(): Promise<boolean>;
  conversation?(): Promise<string | null>;
  open(): Promise<boolean>;
  close(): Promise<void>;
  setMinimized?(minimized: boolean): Promise<boolean>;
  ready?(): Promise<boolean>;
  onMinimized?(callback: (minimized: boolean) => void): () => void;
  getScreenContextAccess?(): Promise<import('../browser-terminal').BrowserTerminalAccess | null>;
  onOpen(callback: (open: boolean, conversationKey?: string | null) => void): () => void;
  onNotification(callback: (notice: NotificationSpeechNotice) => void): () => void;
}
export function voiceCompanionBridge(): VoiceCompanionBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { voiceCompanion?: VoiceCompanionBridge }).voiceCompanion;
}
export async function openVoiceWindow(conversationKey?: string): Promise<void> {
  conversationKey ??= activeVoiceChatKey();
  const companion = voiceCompanionBridge();
  if (companion) { if (!await companion.open()) throw new Error('Voice could not open. Try again.'); return; }
  const desktop = desktopTabsBridge();
  if (desktop) {
    if (!await desktop.tabs({ type: 'voice-open', ...(conversationKey ? { conversationKey } : {}) })) throw new Error('Voice could not open. Restart Breadboard and try again.');
    return;
  }
  const url = `/voice${conversationKey ? `?chat=${encodeURIComponent(conversationKey)}` : ''}`;
  const popup = window.open(url, 'breadboard-voice', 'popup,width=800,height=480');
  if (popup) { popup.opener = null; popup.focus(); }
  else if (conversationKey) throw new Error('Allow popups to open voice from this chat.');
  else window.location.assign(url);
}
