'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const NAVIGATION_START_EVENT = 'breadboard:navigation-start';
const MAX_PENDING_PROGRESS = 92;

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
  const safetyTimerRef = useRef<number | null>(null);
  const completionTimersRef = useRef<number[]>([]);
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  const clearProgressTimers = useCallback(() => {
    if (progressIntervalRef.current !== null) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (safetyTimerRef.current !== null) {
      window.clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  const clearCompletionTimers = useCallback(() => {
    for (const timer of completionTimersRef.current) window.clearTimeout(timer);
    completionTimersRef.current = [];
  }, []);

  const finishNavigation = useCallback(() => {
    clearProgressTimers();
    clearCompletionTimers();
    setVisible(true);
    setProgress(100);

    completionTimersRef.current = [
      window.setTimeout(() => setVisible(false), 180),
      window.setTimeout(() => setProgress(0), 420),
    ];
  }, [clearCompletionTimers, clearProgressTimers]);

  const beginNavigation = useCallback(() => {
    clearProgressTimers();
    clearCompletionTimers();
    setVisible(true);
    setProgress((current) => (current > 0 && current < 100 ? current : 8));

    progressIntervalRef.current = window.setInterval(() => {
      setProgress((current) => {
        if (current >= MAX_PENDING_PROGRESS) return current;
        const step = Math.max(0.8, (MAX_PENDING_PROGRESS - current) * 0.1);
        return Math.min(MAX_PENDING_PROGRESS, current + step);
      });
    }, 260);

    safetyTimerRef.current = window.setTimeout(finishNavigation, 20_000);
  }, [clearCompletionTimers, clearProgressTimers, finishNavigation]);

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

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[10000] h-[3px] overflow-hidden"
      role="progressbar"
      aria-label="Loading page"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      aria-hidden={!visible}
    >
      <div
        className="h-full bg-[#0969da] will-change-[width,opacity]"
        style={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
          transition: 'width 220ms ease-out, opacity 160ms ease-out',
        }}
      />
    </div>
  );
}
