'use client';

import { useEffect, useRef } from 'react';
import { desktopTabsBridge } from '@/lib/desktop-browser-tabs';

/** The desktop shell, where one exists: it paints the window's own chrome. */
interface DesktopWindowBridge {
  setTheme?: (surface: 'light' | 'dark' | 'voice') => Promise<boolean>;
}

/**
 * Voice mode fills the window, so it takes the window's own chrome with it:
 * the desktop shell's caption strip and the native buttons in it would
 * otherwise sit on top of the terracotta as a cream band. The window goes
 * back to the app's theme on close. `active` is the whole screen showing.
 */
export function useVoiceStageChrome(active: boolean, closeOnTabChange: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.dataset.voiceStage = 'open';
    const tabs = desktopTabsBridge();
    const shell = (window as Window & { breadboardDesktop?: DesktopWindowBridge })
      .breadboardDesktop;
    let shellVoice = false;
    let disposed = false;
    const paintShell = (on: boolean) => {
      if (shellVoice === on) return;
      shellVoice = on;
      void tabs?.tabs({ type: 'voice-overlay', open: on });
      if (on) void shell?.setTheme?.('voice');
      else void shell?.setTheme?.(root.dataset.theme === 'dark' ? 'dark' : 'light');
    };
    const syncTab = (state: { selfId?: number | null; activeId: number | null; navigationPending?: boolean }) => {
      if (disposed) return;
      const selected = state.selfId === state.activeId && !state.navigationPending;
      if (closeOnTabChange) { if (!selected) onCloseRef.current(); }
      else paintShell(selected);
    };
    if (closeOnTabChange || !tabs) paintShell(true);
    // A standalone page can first load in a background tab. Wait for its own
    // activation before changing the window's native controls to voice colors.
    let receivedTabState = false;
    const unsubscribe = tabs?.onTabsState(state => { receivedTabState = true; syncTab(state); });
    if (!closeOnTabChange && tabs) void tabs.getTabsState().then(state => {
      if (!receivedTabState) syncTab(state);
    }).catch(() => {});
    return () => {
      disposed = true;
      unsubscribe?.();
      paintShell(false);
      delete root.dataset.voiceStage;
    };
  }, [active, closeOnTabChange]);
}
