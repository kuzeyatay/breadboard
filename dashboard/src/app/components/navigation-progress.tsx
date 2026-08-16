'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const NAVIGATION_START_EVENT = 'breadboard:navigation-start';
const MAX_PENDING_PROGRESS = 92;
// A dev-mode route compile routinely takes 20-35s (the dashboard route has been
// measured at 26s), so a short deadline here would abandon navigations that are
// still perfectly alive. This is only a backstop for clicks that never became a
// navigation at all; a real one ends on the route change below.
const ABANDON_AFTER_MS = 120_000;

export function startNavigationProgress(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(NAVIGATION_START_EVENT));
}

function isModifiedClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export default function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const previousRouteRef = useRef(routeKey);
  const progressIntervalRef = useRef<number | null>(null);
  const abandonTimerRef = useRef<number | null>(null);
  const completionTimersRef = useRef<number[]>([]);
  const progressRef = useRef(0);
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pending, setPending] = useState(false);

  // Every write goes through here so the creep interval can read the current
  // value without re-arming itself on each render.
  const applyProgress = useCallback((next: number) => {
    progressRef.current = next;
    setProgress(next);
  }, []);

  const clearProgressTimers = useCallback(() => {
    if (progressIntervalRef.current !== null) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (abandonTimerRef.current !== null) {
      window.clearTimeout(abandonTimerRef.current);
      abandonTimerRef.current = null;
    }
  }, []);

  const clearCompletionTimers = useCallback(() => {
    for (const timer of completionTimersRef.current) window.clearTimeout(timer);
    completionTimersRef.current = [];
  }, []);

  const finishNavigation = useCallback(() => {
    clearProgressTimers();
    clearCompletionTimers();
    setPending(false);
    setVisible(true);
    applyProgress(100);

    completionTimersRef.current = [
      window.setTimeout(() => setVisible(false), 180),
      window.setTimeout(() => applyProgress(0), 420),
    ];
  }, [applyProgress, clearCompletionTimers, clearProgressTimers]);

  // A click that never became a navigation has to release the bar eventually,
  // but it must not claim the page arrived: run the bar out rather than filling
  // it. Completing here is what made a slow navigation look like a dead button —
  // the bar finished and vanished seconds before the page it was tracking.
  const abandonNavigation = useCallback(() => {
    clearProgressTimers();
    clearCompletionTimers();
    setPending(false);
    setVisible(false);
    completionTimersRef.current = [window.setTimeout(() => applyProgress(0), 240)];
  }, [applyProgress, clearCompletionTimers, clearProgressTimers]);

  const beginNavigation = useCallback(() => {
    clearProgressTimers();
    clearCompletionTimers();
    setPending(true);
    setVisible(true);
    const resumed = progressRef.current;
    applyProgress(resumed > 0 && resumed < 100 ? resumed : 8);

    progressIntervalRef.current = window.setInterval(() => {
      const current = progressRef.current;
      if (current >= MAX_PENDING_PROGRESS) {
        // The creep has nothing left to travel. Stop ticking and let the
        // stalled shimmer carry the "still working" signal, however long the
        // route takes to compile and render.
        if (progressIntervalRef.current !== null) {
          window.clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        return;
      }
      const step = Math.max(0.8, (MAX_PENDING_PROGRESS - current) * 0.1);
      applyProgress(Math.min(MAX_PENDING_PROGRESS, current + step));
    }, 260);

    abandonTimerRef.current = window.setTimeout(abandonNavigation, ABANDON_AFTER_MS);
  }, [abandonNavigation, applyProgress, clearCompletionTimers, clearProgressTimers]);

  useEffect(() => {
    if (previousRouteRef.current === routeKey) return;
    previousRouteRef.current = routeKey;
    const timer = window.setTimeout(finishNavigation, 0);
    return () => window.clearTimeout(timer);
  }, [finishNavigation, routeKey]);

  useEffect(() => {
    function shouldBeginForDestination(destination: string): boolean {
      let url: URL;
      try {
        url = new URL(destination, window.location.href);
      } catch {
        return false;
      }
      if (url.origin !== window.location.origin) return false;
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return url.pathname !== window.location.pathname || url.search !== window.location.search;
    }

    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || isModifiedClick(event)) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!target || target.dataset.navigationProgress === 'ignore') return;
      if (target.target && target.target !== '_self') return;
      if (target.hasAttribute('download')) return;
      const href = target.getAttribute('href');
      if (href && shouldBeginForDestination(href)) beginNavigation();
    }

    function handleSubmit(event: SubmitEvent) {
      if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
      const form = event.target;
      if (form.dataset.navigationProgress === 'ignore') return;
      if (form.target && form.target !== '_self') return;
      if (shouldBeginForDestination(form.action || window.location.href)) beginNavigation();
    }

    function handlePopState() {
      beginNavigation();
    }

    window.addEventListener(NAVIGATION_START_EVENT, beginNavigation);
    window.addEventListener('popstate', handlePopState);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('submit', handleSubmit);

    return () => {
      window.removeEventListener(NAVIGATION_START_EVENT, beginNavigation);
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('submit', handleSubmit);
      clearProgressTimers();
      clearCompletionTimers();
    };
  }, [beginNavigation, clearCompletionTimers, clearProgressTimers]);

  // Pinned at the ceiling with the creep stopped, a static bar reads as frozen.
  // The shimmer is the only thing distinguishing "still compiling" from "dead".
  const stalled = pending && progress >= MAX_PENDING_PROGRESS;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[10000] h-[4px] overflow-hidden"
      role="progressbar"
      aria-label="Loading page"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      aria-busy={pending}
      aria-hidden={!visible}
    >
      <div
        className={`h-full bg-[#0969da] shadow-[0_0_8px_rgba(9,105,218,0.7)] will-change-[width,opacity] ${
          stalled ? 'bb-nav-progress-stalled' : ''
        }`}
        style={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
          transition: 'width 220ms ease-out, opacity 160ms ease-out',
        }}
      />
    </div>
  );
}
