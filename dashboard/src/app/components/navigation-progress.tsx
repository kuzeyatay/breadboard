'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useDesktopTabs } from './use-desktop-tabs';
import { usePageLoadingPending } from './use-page-loading';

const NAVIGATION_START_EVENT = 'breadboard:navigation-start';
const NAVIGATION_CANCEL_EVENT = 'breadboard:navigation-cancel';
const MAX_PENDING_PROGRESS = 92;
const COMPLETION_SETTLE_MS = 100;
const COMPLETION_DURATION_MS = 220;
const FADE_DURATION_MS = 160;
// A dev-mode route compile routinely takes 20-35s (the dashboard route has been
// measured at 26s), so a short deadline here would abandon navigations that are
// still perfectly alive. This is only a backstop for clicks that never became a
// navigation at all; a real one ends on the route change below.
const ABANDON_AFTER_MS = 120_000;

export function startNavigationProgress(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(NAVIGATION_START_EVENT));
}

export function cancelNavigationProgress(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(NAVIGATION_CANCEL_EVENT));
}

function isModifiedClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export default function NavigationProgress() {
  const desktopNavigationPending = useDesktopTabs()?.navigationPending === true;
  const pageLoadingPending = usePageLoadingPending();
  const trackedNavigationPending = desktopNavigationPending || pageLoadingPending;
  const trackedNavigationPendingRef = useRef(trackedNavigationPending);
  const previousTrackedPendingRef = useRef(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const previousRouteRef = useRef(routeKey);
  const progressIntervalRef = useRef<number | null>(null);
  const abandonTimerRef = useRef<number | null>(null);
  const completionTimersRef = useRef<number[]>([]);
  const progressRef = useRef(0);
  const pendingRef = useRef(false);
  const [cycle, setCycle] = useState(0);
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    trackedNavigationPendingRef.current = trackedNavigationPending;
  }, [trackedNavigationPending]);

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
    if (trackedNavigationPendingRef.current || !pendingRef.current || completionTimersRef.current.length) return;
    // Chromium can stop and immediately restart loading during a redirect.
    // Let those signals settle before completing the current bar.
    completionTimersRef.current = [window.setTimeout(() => {
      clearProgressTimers();
      pendingRef.current = false;
      setPending(false);
      applyProgress(100);
      completionTimersRef.current = [
        window.setTimeout(() => setVisible(false), COMPLETION_DURATION_MS),
        window.setTimeout(() => {
          applyProgress(0);
          completionTimersRef.current = [];
        }, COMPLETION_DURATION_MS + FADE_DURATION_MS),
      ];
    }, COMPLETION_SETTLE_MS)];
  }, [applyProgress, clearProgressTimers]);

  // A click that never became a navigation has to release the bar eventually,
  // but it must not claim the page arrived: run the bar out rather than filling
  // it. Completing here is what made a slow navigation look like a dead button —
  // the bar finished and vanished seconds before the page it was tracking.
  const abandonNavigation = useCallback(() => {
    if (trackedNavigationPendingRef.current || !pendingRef.current) return;
    clearProgressTimers();
    clearCompletionTimers();
    pendingRef.current = false;
    setPending(false);
    setVisible(false);
    completionTimersRef.current = [window.setTimeout(() => {
      applyProgress(0);
      completionTimersRef.current = [];
    }, FADE_DURATION_MS)];
  }, [applyProgress, clearCompletionTimers, clearProgressTimers]);

  const beginNavigation = useCallback(() => {
    clearCompletionTimers();
    if (abandonTimerRef.current !== null) window.clearTimeout(abandonTimerRef.current);
    abandonTimerRef.current = window.setTimeout(abandonNavigation, ABANDON_AFTER_MS);
    // Repeated clicks and overlapping native/page signals belong to the same
    // wait. In particular, don't keep postponing the next progress tick.
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setVisible(true);
    // A fresh element starts at 8% without transitioning backwards from the
    // previous cycle's 100%, even if its completion/fade was interrupted.
    setCycle((current) => current + 1);
    applyProgress(8);

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
  }, [abandonNavigation, applyProgress, clearCompletionTimers]);

  useEffect(() => {
    if (previousTrackedPendingRef.current === trackedNavigationPending) return;
    const timer = window.setTimeout(() => {
      previousTrackedPendingRef.current = trackedNavigationPending;
      if (trackedNavigationPending) beginNavigation();
      else finishNavigation();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [beginNavigation, trackedNavigationPending, finishNavigation]);

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
      // Hash-only history changes don't commit a new route to finish the bar.
      const destination = `${window.location.pathname}?${window.location.search.slice(1)}`;
      if (destination !== previousRouteRef.current) beginNavigation();
    }

    window.addEventListener(NAVIGATION_START_EVENT, beginNavigation);
    window.addEventListener(NAVIGATION_CANCEL_EVENT, abandonNavigation);
    window.addEventListener('popstate', handlePopState);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('submit', handleSubmit);

    return () => {
      window.removeEventListener(NAVIGATION_START_EVENT, beginNavigation);
      window.removeEventListener(NAVIGATION_CANCEL_EVENT, abandonNavigation);
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('submit', handleSubmit);
      clearProgressTimers();
      clearCompletionTimers();
    };
  }, [abandonNavigation, beginNavigation, clearCompletionTimers, clearProgressTimers]);

  // Pinned at the ceiling with the creep stopped, a static bar reads as frozen.
  // The shimmer is the only thing distinguishing "still compiling" from "dead".
  const stalled = pending && progress >= MAX_PENDING_PROGRESS;

  return (
    <div
      className="bb-nav-progress pointer-events-none fixed inset-x-0 top-0 z-[10000] h-[4px] overflow-hidden"
      style={{ opacity: visible ? 1 : 0 }}
      role="progressbar"
      aria-label="Loading page"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      aria-busy={pending}
      aria-hidden={!visible}
    >
      <div
        key={cycle}
        className={`bb-nav-progress-fill h-full w-full bg-[#0969da] shadow-[0_0_8px_rgba(9,105,218,0.7)] will-change-transform ${
          stalled ? 'bb-nav-progress-stalled' : ''
        }`}
        style={{
          transform: `translateX(${progress - 100}%)`,
        }}
      />
    </div>
  );
}
