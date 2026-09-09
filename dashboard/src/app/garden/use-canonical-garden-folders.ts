'use client';

import { useEffect, type RefObject } from 'react';

/** Rehydrate the Explorer from disk, including folders not yet in static output. */
export function useCanonicalGardenFolders(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  quartzOrigin: string,
  initialCluster?: string,
) {
  useEffect(() => {
    const controller = new AbortController();
    const requests = new Set<string>();
    const clusters = new Set(initialCluster ? [initialCluster] : []);
    const post = (message: object) => iframeRef.current?.contentWindow?.postMessage(message, quartzOrigin || '*');
    const refresh = (cluster: string) => {
      clusters.add(cluster);
      for (const resource of ['folders', 'documents']) {
        const key = `${resource}/${cluster}`;
        if (requests.has(key)) continue;
        requests.add(key);
        void fetch(`/api/${resource}?clusterSlug=${encodeURIComponent(cluster)}`, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        }).then(async (response) => {
          if (!response.ok) return;
          const body = await response.json();
          if (!controller.signal.aborted) post({
            type: `second-brain:${resource}`, cluster, [resource]: body[resource],
          });
        }).catch(() => {
          // Published entries remain usable; focus/load can retry the read.
        }).finally(() => requests.delete(key));
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow ||
          (quartzOrigin && event.origin !== quartzOrigin)) return;
      const data = event.data;
      if (data?.type !== 'second-brain:request-folders' ||
          typeof data.cluster !== 'string' || !data.cluster) return;
      refresh(data.cluster);
    };
    const created = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (typeof detail?.cluster !== 'string' || typeof detail.relPath !== 'string') return;
      post({ type: 'second-brain:documents', cluster: detail.cluster, documents: [detail], reveal: detail.relPath });
      if (detail.folder) post({ type: 'second-brain:folders', cluster: detail.cluster,
        folders: [{ folder: detail.folder, name: detail.folder.split('/').pop() }] });
      refresh(detail.cluster);
    };
    const refreshKnown = () => clusters.forEach(refresh);
    const frame = iframeRef.current;
    frame?.addEventListener('load', refreshKnown);
    window.addEventListener('focus', refreshKnown);
    window.addEventListener('sb:note-created', created);
    window.addEventListener('message', onMessage);
    refreshKnown();
    return () => {
      controller.abort();
      frame?.removeEventListener('load', refreshKnown);
      window.removeEventListener('focus', refreshKnown);
      window.removeEventListener('sb:note-created', created);
      window.removeEventListener('message', onMessage);
    };
  }, [iframeRef, quartzOrigin, initialCluster]);
}
