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
    async function read(refresh = false) {
      if (disposed || document.visibilityState === 'hidden' || (!refresh && Date.now() - lastRead < RECOMMENDATION_TTL_MS)) return;
      const generation = ++revision;
      controller?.abort();
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(27_000)]);
      lastRead = Date.now();
      try {
        const now = new Date();
        const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const response = await fetch('/api/recommendations', { method:'POST', cache:'no-store',
          headers:{'Content-Type':'application/json'}, signal,
          body:JSON.stringify({gardenSlug,pageTitle,localDate,scope,temporary,personalize:true,refresh}),
        });
        if (!response.ok) throw new Error('Recommendations unavailable');
        const payload = await response.json();
        const items: Recommendation[] = Array.isArray(payload.recommendations) ? payload.recommendations.filter((item: Recommendation) =>
          item && typeof item.prompt === 'string' && item.prompt.length <= 240 && typeof item.sourceLabel === 'string').slice(0,4) : [];
        if (!disposed && !signal.aborted && generation === revision) setState({key,items});
      } catch {
        if (!disposed && !signal.aborted && generation === revision) setState({key,items:[]});
      }
    }
    const changed = () => { ++revision; controller?.abort(); lastRead = 0; setState(null); void read(true); };
    const authChanged = () => { ++revision; controller?.abort(); setState(null); lastRead = 0; };
    const visible = () => { void read(); };
    void read();
    const timer = window.setInterval(visible, RECOMMENDATION_TTL_MS);
    window.addEventListener(AUTH_CHANGED_EVENT, authChanged);
    window.addEventListener(RECOMMENDATION_REFRESH_EVENT, changed);
    window.addEventListener(RECALL_SETTINGS_CHANGED_EVENT, changed);
    window.addEventListener('breadboard:calendar:changed', changed);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true; controller?.abort(); window.clearInterval(timer);
      window.removeEventListener(AUTH_CHANGED_EVENT, authChanged);
      window.removeEventListener(RECOMMENDATION_REFRESH_EVENT, changed);
      window.removeEventListener(RECALL_SETTINGS_CHANGED_EVENT, changed);
      window.removeEventListener('breadboard:calendar:changed', changed);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [allowed, key, gardenSlug, pageTitle, scope, temporary]);
  return allowed && state?.key === key ? state.items : [];
}
