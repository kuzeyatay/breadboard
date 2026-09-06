import { desktopTabsBridge } from '../desktop-browser-tabs';
export interface VoiceCompanionBridge {
  state(): Promise<boolean>;
  open(): Promise<boolean>;
  close(): Promise<void>;
  onOpen(callback: (open: boolean) => void): () => void;
  onNotification(callback: (notice: { message: string; title?: string; response?: string; dismissed?: boolean }) => void): () => void;
}
export function voiceCompanionBridge(): VoiceCompanionBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { voiceCompanion?: VoiceCompanionBridge }).voiceCompanion;
}
export async function openVoiceWindow(): Promise<void> {
  const companion = voiceCompanionBridge();
  if (companion) { if (!await companion.open()) throw new Error('Voice could not open. Try again.'); return; }
  const desktop = desktopTabsBridge();
  if (desktop) {
    if (!await desktop.tabs({ type: 'voice-open' })) throw new Error('Voice could not open. Restart Breadboard and try again.');
    return;
  }
  const popup = window.open('/voice', 'breadboard-voice', 'popup,width=400,height=240');
  if (popup) { popup.opener = null; popup.focus(); }
  else window.location.assign('/voice');
}
