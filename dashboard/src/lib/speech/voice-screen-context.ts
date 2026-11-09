import { currentBrowserTerminalAccess, parseBrowserTerminalAccess, type BrowserTerminalAccess } from '../browser-terminal.ts';
import { parseVoiceOpenerContext, type VoiceOpenerContext } from './voice-opener-context.ts';

/** Per-turn metadata, never part of the spoken text or saved transcript. Null
 * explicitly clears the originating chat's old browser connection. */
export interface VoiceScreenContext { browserAccess?: BrowserTerminalAccess | null; voiceOpener?: VoiceOpenerContext }

export function parseVoiceScreenContext(value: unknown): VoiceScreenContext {
  if (!value || typeof value !== 'object') return {};
  const access = (value as VoiceScreenContext).browserAccess;
  const voiceOpener = parseVoiceOpenerContext((value as VoiceScreenContext).voiceOpener);
  return { ...('browserAccess' in value ? { browserAccess: parseBrowserTerminalAccess(access) ?? null } : {}),
    ...(voiceOpener ? { voiceOpener } : {}) };
}

export async function currentVoiceScreenContext(): Promise<VoiceScreenContext> {
  if (typeof window === 'undefined') return {};
  const desktopWindow = window as Window & { voiceCompanion?: {
    getScreenContextAccess?: () => Promise<BrowserTerminalAccess | null>;
  }; breadboardDesktop?: { getBrowserTerminalAccess?: () => Promise<BrowserTerminalAccess | null> } };
  if (!desktopWindow.voiceCompanion?.getScreenContextAccess && !desktopWindow.breadboardDesktop?.getBrowserTerminalAccess) return {};
  return parseVoiceScreenContext({ browserAccess: await currentBrowserTerminalAccess() ?? null });
}
