import { currentBrowserTerminalAccess, parseBrowserTerminalAccess, type BrowserTerminalAccess } from '../browser-terminal.ts';
import { parseVoiceOpenerContext, type VoiceOpenerContext } from './voice-opener-context.ts';
import type { ChatAttachment } from '../chat-attachments.ts';

/** Per-turn metadata, never part of the spoken text or saved transcript. Null
 * explicitly clears the originating chat's old browser connection. */
export interface VoiceScreenContext {
  browserAccess?: BrowserTerminalAccess | null;
  voiceOpener?: VoiceOpenerContext;
  /** Stills of the camera and shared screen taken as the person stopped talking. */
  attachments?: ChatAttachment[];
}

const MAX_FRAMES = 2;
const MAX_FRAME_CHARS = 4_000_000;

/** Only JPEG/PNG data URLs from voice mode's own capture, bounded in count and size. */
export function voiceFrames(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { type: 'image'; name: string; dataUrl: string; sizeBytes?: number } =>
    !!item && typeof item === 'object' && (item as { type?: unknown }).type === 'image' &&
    typeof (item as { name?: unknown }).name === 'string' && typeof (item as { dataUrl?: unknown }).dataUrl === 'string' &&
    /^data:image\/(?:jpeg|png);base64,/.test((item as { dataUrl: string }).dataUrl) &&
    (item as { dataUrl: string }).dataUrl.length <= MAX_FRAME_CHARS)
    .slice(0, MAX_FRAMES)
    .map(item => ({ type: 'image' as const, name: item.name.slice(0, 80), dataUrl: item.dataUrl,
      ...(typeof item.sizeBytes === 'number' ? { sizeBytes: item.sizeBytes } : {}) }));
}

export function parseVoiceScreenContext(value: unknown): VoiceScreenContext {
  if (!value || typeof value !== 'object') return {};
  const access = (value as VoiceScreenContext).browserAccess;
  const voiceOpener = parseVoiceOpenerContext((value as VoiceScreenContext).voiceOpener);
  const attachments = voiceFrames((value as VoiceScreenContext).attachments);
  return { ...('browserAccess' in value ? { browserAccess: parseBrowserTerminalAccess(access) ?? null } : {}),
    ...(voiceOpener ? { voiceOpener } : {}), ...(attachments.length ? { attachments } : {}) };
}

export async function currentVoiceScreenContext(): Promise<VoiceScreenContext> {
  if (typeof window === 'undefined') return {};
  const desktopWindow = window as Window & { voiceCompanion?: {
    getScreenContextAccess?: () => Promise<BrowserTerminalAccess | null>;
  }; breadboardDesktop?: { getBrowserTerminalAccess?: () => Promise<BrowserTerminalAccess | null> } };
  if (!desktopWindow.voiceCompanion?.getScreenContextAccess && !desktopWindow.breadboardDesktop?.getBrowserTerminalAccess) return {};
  return parseVoiceScreenContext({ browserAccess: await currentBrowserTerminalAccess() ?? null });
}
