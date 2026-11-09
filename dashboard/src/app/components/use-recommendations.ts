'use client';

import { useEffect, useState } from 'react';
import { usePersonalize } from './use-personalize';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import { RECALL_SETTINGS_CHANGED_EVENT } from './recall-autostart-lifecycle';
import { RECOMMENDATION_REFRESH_EVENT, RECOMMENDATION_TTL_MS, type Recommendation } from '@/lib/recommendations/types';

export function useRecommendations({ gardenSlug, pageTitle, enabled = true, temporary = false, scope = 'mine' }: {
  gardenSlug?: string | null; pageTitle?: string | null; enabled?: boolean;
  temporary?: boolean; scope?: 'mine' | 'public';
} = {}) {
  const [personalize] = usePersonalize();
  const allowed = enabled && personalize && !temporary && scope !== 'public';
  const key = JSON.stringify([gardenSlug, pageTitle, allowed]);
  const [state, setState] = useState<{ key: string; items: Recommendation[] } | null>(null);
  useEffect(() => {
    if (!allowed) return;
    let controller: AbortController | undefined;
    let disposed = false;
    let lastRead = 0;
    let revision = 0;
    let pending = false;
    let needsRefresh = false;
    async function read(refresh = false) {
      refresh ||= needsRefresh;
      if (disposed || pending || document.visibilityState === 'hidden' || (!refresh && Date.now() - lastRead < RECOMMENDATION_TTL_MS)) return;
      pending = true;
      needsRefresh = false;
      const generation = ++revision;
      controller?.abort();
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(27_000)]);
      lastRead = Date.now();
      try {
        const now = new Date();
        const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const localTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const response = await fetch('/api/recommendations', { method:'POST', cache:'no-store',
          headers:{'Content-Type':'application/json'}, signal,
          body:JSON.stringify({gardenSlug,pageTitle,localDate,localTime,timeZone,scope,temporary,personalize:true,refresh}),
        });
        if (!response.ok) throw new Error('Recommendations unavailable');
        const payload = await response.json();
        const items: Recommendation[] = Array.isArray(payload.recommendations) ? payload.recommendations.filter((item: Recommendation) =>
          item && typeof item.prompt === 'string' && item.prompt.length <= 240 && typeof item.sourceLabel === 'string').slice(0,4) : [];
        if (!disposed && !signal.aborted && generation === revision) setState({key,items});
      } catch {
        // A temporary outage should not replace useful cards with generic ones.
        if (!disposed && generation === revision) lastRead = Date.now() - RECOMMENDATION_TTL_MS + 30_000;
      } finally {
        if (generation === revision) pending = false;
      }
    }
    const changed = () => { ++revision; controller?.abort(); pending=false; needsRefresh=true; lastRead=0; setState(null); void read(true); };
    const workChanged = () => { ++revision; controller?.abort(); pending=false; needsRefresh=true; lastRead=0; void read(true); };
    const authChanged = () => { ++revision; controller?.abort(); pending=false; setState(null); lastRead=0; };
    const stored = (event: StorageEvent) => { if (event.key==='breadboard:plan-changed' || event.key==='breadboard:calendar:changed') workChanged(); };
    const visible = () => { void read(); };
    void read();
    // Check often enough to recover from a missed/hidden interval, but bound
    // actual reads to the shared three-minute freshness window.
    const timer = window.setInterval(visible, 30_000);
    window.addEventListener(AUTH_CHANGED_EVENT, authChanged);
    window.addEventListener(RECOMMENDATION_REFRESH_EVENT, changed);
    window.addEventListener(RECALL_SETTINGS_CHANGED_EVENT, changed);
    window.addEventListener('breadboard:calendar:changed', workChanged);
    window.addEventListener('breadboard:plan-changed', workChanged);
    window.addEventListener('storage', stored);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true; controller?.abort(); window.clearInterval(timer);
      window.removeEventListener(AUTH_CHANGED_EVENT, authChanged);
      window.removeEventListener(RECOMMENDATION_REFRESH_EVENT, changed);
      window.removeEventListener(RECALL_SETTINGS_CHANGED_EVENT, changed);
      window.removeEventListener('breadboard:calendar:changed', workChanged);
      window.removeEventListener('breadboard:plan-changed', workChanged);
      window.removeEventListener('storage', stored);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [allowed, key, gardenSlug, pageTitle, scope, temporary]);
  return allowed && state?.key === key ? state.items : [];
}
