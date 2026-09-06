'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { desktopTabsBridge, type DesktopTabsState } from '@/lib/desktop-browser-tabs';
import { captureClaps, type ClapGesture } from '@/lib/speech/clap/capture';
import { AUDIO_FOCUS_EVENT, AUDIO_LOCK, audioFocusChannel, foregroundAudioActive, holdForegroundAudio } from '@/lib/speech/clap/audio-focus';
import { clapSnapshot, clapServerSnapshot, gestureSettings, loadClapControls, subscribeClapControls, updateClapRuntime } from '@/lib/speech/clap/client';
import { controlQuery, trustedClapPath, type GestureControl } from '@/lib/speech/clap/preferences';
import { dispatchClapSpeech } from '@/lib/speech/clap/targets';
import { actionForGesturePrompt } from '@/lib/profile/clap-action';
import { openGestureAction, takeGestureLaunch, waitForGesturePlayer, type GestureLaunch } from '@/lib/speech/clap/action-launch';
import { describeMicrophoneBlock } from '@/lib/speech/microphone-access';
import { gestureForegroundPresence } from '@/lib/speech/clap/foreground-presence';

/** Application lifetime; notification/preview surfaces never authenticate or capture. */
export default function ClapListenerProvider() {
  const pathname = usePathname(); const router = useRouter();
  const allowed = trustedClapPath(pathname);
  const snapshot = useSyncExternalStore(subscribeClapControls, clapSnapshot, clapServerSnapshot);
  const [notice, setNotice] = useState<string | null>(null);
  const actionControl = useRef<GestureControl>('clap');
  const routeRef = useRef(pathname); routeRef.current = pathname;
  const syncRef = useRef<() => void>(() => {});
  const actionController = useRef<AbortController | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    actionController.current?.abort();
    syncRef.current();
  }, [pathname]);

  useEffect(() => {
    // The native notification renderer shares cookies but is never an input owner.
    if (window.top !== window || !trustedClapPath(routeRef.current)) return;
    let alive = true; let owner: AbortController | null = null; let signature = '';
    let timer: number | undefined; let settlingUntil = 0; let receiving = false;
    const lifecycle = new AbortController();
    const desktop = desktopTabsBridge();
    let desktopState: DesktopTabsState | null = null;
    const eligible = () => trustedClapPath(routeRef.current) && (desktop
      ? desktopState !== null && desktopState.selfId !== null && desktopState.selfId === desktopState.activeId && desktopState.windowFocused !== false && !desktopState.navigationPending
      : document.visibilityState !== 'hidden' && document.hasFocus());
    const stop = () => { owner?.abort(); owner = null; };
    const presence = gestureForegroundPresence(() => {
      const s = clapSnapshot();
      const candidates = (['clap', 'snap'] as const).filter(control => s.mode === 'actions' ? gestureSettings(s, control).active : s.testControl === control);
      return { userId: s.userId, foreground: Boolean(s.loaded && s.userId && eligible() &&
        candidates.some(control => !foregroundAudioActive() || gestureSettings(s, control).preferences.allowConcurrentListening)) };
    }, () => sync());
    function restriction(control: GestureControl): string | null {
      const s = clapSnapshot(), parallel = gestureSettings(s, control).preferences.allowConcurrentListening;
      if (s.mode !== 'actions' && s.testControl !== control) return 'Paused while the other gesture is being tested';
      if (!trustedClapPath(routeRef.current) || (desktop && (!desktopState || desktopState.selfId == null || desktopState.navigationPending))) return 'Paused during navigation';
      if (!eligible()) {
        if (!parallel) return 'Paused while this tab or window is inactive';
        if (presence.hasForegroundPeer()) return 'Listening in another tab or window';
      }
      if (foregroundAudioActive() && !parallel) return 'Paused during other audio';
      return null;
    }

    async function gesture(event: ClapGesture) {
      const current = clapSnapshot();
      const control = event.control ?? 'clap';
      const binding = gestureSettings(current, control);
      if (restriction(control)) return;
      if (current.mode !== 'actions' && current.testControl !== control) return;
      if (current.mode === 'calibration' && event.audioTime < 2200) return;
      const gestures = binding.gestures + 1, weakestImpulse = Math.min(binding.weakestImpulse ?? Infinity, event.impulseRms ?? Infinity);
      updateClapRuntime(control === 'snap' ? { snapGestures: gestures, snapWeakestImpulse: weakestImpulse } : { gestures, weakestImpulse });
      if (current.mode !== 'actions' || busy.current || !binding.active) return;
      // Consume once in the capture layer, then suspend before invoking any action.
      busy.current = true; stop();
      const controller = new AbortController(); actionController.current = controller;
      actionControl.current = control;
      try {
        const saved = binding.action.action;
        const action = saved.kind === 'assistant' ? actionForGesturePrompt(saved.prompt) : saved;
        setNotice(null);
        await openGestureAction({ userId: current.userId, control, eventId: event.id, action: saved }, action);
      } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'The gesture action could not open.'); }
      finally { busy.current = false; signature = ''; settlingUntil = performance.now() + 1500; if (alive) sync(); }
    }

    async function receive(launch: GestureLaunch) {
      busy.current = true; receiving = true; stop();
      const controller = new AbortController(); actionController.current = controller;
      actionControl.current = launch.control;
      try {
        const saved = gestureSettings(clapSnapshot(), launch.control).action.action;
        if (JSON.stringify(saved) !== JSON.stringify(launch.action)) throw new Error('Your gesture action changed. Try your gesture again.');
        const action = saved.kind === 'assistant' ? actionForGesturePrompt(saved.prompt) : saved;
        if (action.kind === 'voice' || action.kind === 'dictation') {
          if (!await dispatchClapSpeech(action.kind, controller.signal, { waitForTarget: true }) && !controller.signal.aborted)
            throw new Error('The speech controls could not load. Try your gesture again.');
        } else if (action.kind === 'music' || action.kind === 'assistant') {
          if (action.kind === 'music') await waitForGesturePlayer(controller.signal);
          const response = await fetch(`/api/profile/clap-action/execute${controlQuery(launch.control)}`, { method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: launch.eventId, expectedAction: saved }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'The gesture action could not run.');
          if (!controller.signal.aborted) {
            if (typeof result.href === 'string' && /^\/dashboard\?terminalChat=conv_[A-Za-z0-9_-]+$/.test(result.href)) router.replace(result.href);
            else if (result.failed) throw new Error(result.message);
            if (action.kind === 'music') window.dispatchEvent(new Event('breadboard:spotify-playback-changed'));
          }
        }
      } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'The clap action could not run.'); }
      finally { busy.current = false; receiving = false; signature = ''; settlingUntil = performance.now() + 1500; if (alive) sync(); }
    }

    function sync() {
      if (!alive) return;
      const s = clapSnapshot();
      presence.publish();
      if (s.loaded && s.userId && eligible() && !busy.current) {
        const launch = takeGestureLaunch(s.userId);
        if (launch) { void receive(launch); return; }
      }
      const active = s.active || s.snapActive;
      const clapWanted = s.mode === 'actions' ? s.active : s.testControl === 'clap';
      const snapWanted = s.mode === 'actions' ? s.snapActive : s.testControl === 'snap';
      const pauseReason = s.active || clapWanted ? restriction('clap') : null;
      const snapPauseReason = s.snapActive || snapWanted ? restriction('snap') : null;
      const clapEnabled = clapWanted && !pauseReason, snapEnabled = snapWanted && !snapPauseReason;
      const wanted = s.loaded && s.userId && (clapEnabled || snapEnabled);
      if ((!receiving && (!gestureSettings(s, actionControl.current).active || s.mode !== 'actions')) ||
        (receiving ? !eligible() : restriction(actionControl.current))) actionController.current?.abort();
      const sharedAudio = (clapEnabled && s.preferences.allowConcurrentListening) || (snapEnabled && s.snapPreferences.allowConcurrentListening);
      const key = JSON.stringify([wanted, busy.current, sharedAudio, pauseReason, snapPauseReason, s.userId, s.preferences.deviceId, s.preferences.sensitivity, s.preferences.pattern,
        clapEnabled, snapEnabled, s.snapPreferences.sensitivity, s.snapPreferences.pattern, s.mode, s.testControl]);
      if (key === signature) return;
      signature = key; window.clearTimeout(timer); stop();
      updateClapRuntime({ pauseReason, snapPauseReason });
      if (!wanted || busy.current) { updateClapRuntime({ status: active || s.mode !== 'actions' ? 'paused' : 'off' }); return; }
      if (performance.now() < settlingUntil) {
        updateClapRuntime({ status: 'paused' }); signature = '';
        timer = window.setTimeout(sync, settlingUntil - performance.now()); return;
      }
      if (!navigator.locks || !navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
        updateClapRuntime({ status: 'error', issue: 'Clap controls need a secure browser with AudioWorklet and Web Locks support.' }); return;
      }
      const controller = new AbortController(); owner = controller;
      updateClapRuntime({ status: 'paused' });
      void navigator.locks.request(`breadboard:clap-owner:${s.userId}`, { signal: controller.signal }, async () => {
        await navigator.locks.request(AUDIO_LOCK, { signal: controller.signal, mode: sharedAudio ? 'shared' : 'exclusive' }, async () => {
          controller.signal.throwIfAborted();
          await captureClaps(controller.signal, s.preferences, {
            status: status => { if (!controller.signal.aborted) updateClapRuntime({ status }); },
            meter: meter => updateClapRuntime(meter.control === 'snap' ? { snapMeter: meter } : { meter }), gesture: e => { void gesture(e); },
          }, { clapEnabled, snapEnabled,
            snapSensitivity: s.snapPreferences.sensitivity, snapPattern: s.snapPreferences.pattern });
        });
      }).catch(async error => {
        if (controller.signal.aborted || !alive) return;
        const fix = error instanceof DOMException && error.name === 'NotAllowedError' ? await describeMicrophoneBlock(error) : null;
        if (!alive || controller.signal.aborted) return;
        updateClapRuntime({ status: 'error', fix, issue: error?.name === 'OverconstrainedError' || error?.name === 'NotFoundError'
          ? 'The selected microphone is unavailable. Choose a microphone in Clap controls.'
          : error instanceof Error ? error.message : 'Microphone capture failed. Retry in Clap controls.' });
      });
    }
    const focusChanged = () => { if (!owner) settlingUntil = performance.now() + 650; sync(); };
    const audioChanged = () => { if (!owner) settlingUntil = performance.now() + 650; sync(); };
    const playback = new Map<HTMLMediaElement, () => void>();
    const mediaChanged = (event: Event) => {
      const media = event.target;
      if (!(media instanceof HTMLMediaElement)) return;
      if (!media.paused && !media.ended && !media.muted && media.volume > 0) {
        if (!playback.has(media)) playback.set(media, holdForegroundAudio());
      } else { playback.get(media)?.(); playback.delete(media); }
    };
    for (const type of ['play', 'pause', 'ended', 'volumechange', 'emptied']) document.addEventListener(type, mediaChanged, true);
    for (const media of document.querySelectorAll('audio,video')) mediaChanged({ target: media } as unknown as Event);
    audioFocusChannel();
    const unsubscribe = subscribeClapControls(sync);
    const updateDesktop = (state: DesktopTabsState) => { desktopState = state; sync(); };
    const unsubscribeDesktop = desktop?.onTabsState(updateDesktop);
    if (desktop) void desktop.getTabsState().then(updateDesktop);
    const refresh = () => { void loadClapControls(lifecycle.signal).catch(error => {
      if (alive && !lifecycle.signal.aborted) updateClapRuntime({ status: 'error', issue: String(error.message || error) });
    }); };
    syncRef.current = sync; refresh();
    const authTimer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', focusChanged);
    window.addEventListener('focus', focusChanged); window.addEventListener('blur', focusChanged);
    window.addEventListener(AUDIO_FOCUS_EVENT, audioChanged);
    window.addEventListener('breadboard:clap-action-changed', refresh);
    return () => {
      alive = false; lifecycle.abort(); stop(); actionController.current?.abort();
      presence.close();
      unsubscribe(); unsubscribeDesktop?.(); window.clearTimeout(timer); window.clearInterval(authTimer);
      document.removeEventListener('visibilitychange', focusChanged); window.removeEventListener(AUDIO_FOCUS_EVENT, audioChanged);
      window.removeEventListener('focus', focusChanged); window.removeEventListener('blur', focusChanged);
      window.removeEventListener('breadboard:clap-action-changed', refresh); syncRef.current = () => {};
      for (const type of ['play', 'pause', 'ended', 'volumechange', 'emptied']) document.removeEventListener(type, mediaChanged, true);
      for (const release of playback.values()) release();
    };
  }, [router, allowed]);

  if (!trustedClapPath(pathname) || !snapshot.userId) return null;
  return <>
    {notice && <div className="clap-notice" role="alert"><p>{notice}</p><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss gesture error">×</button></div>}
  </>;
}
