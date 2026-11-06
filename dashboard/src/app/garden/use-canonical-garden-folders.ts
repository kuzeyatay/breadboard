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
    const requests = new Map<string, AbortController>();
    const reads = new Map<string, Promise<void>>();
    const generations = new Map<string, number>();
    const moves = new Set<string>();
    const deletedSlugs = new Set<string>();
    const clusters = new Set(initialCluster ? [initialCluster] : []);
    const post = (message: object) => iframeRef.current?.contentWindow?.postMessage(message, quartzOrigin || '*');
    const refresh = (cluster: string, invalidate = false) => {
      clusters.add(cluster);
      if (invalidate) {
        generations.set(cluster, (generations.get(cluster) ?? 0) + 1);
        for (const resource of ['folders', 'documents']) {
          const key = `${resource}/${cluster}`;
          requests.get(key)?.abort();
          requests.delete(key);
          reads.delete(key);
        }
      }
      const generation = generations.get(cluster) ?? 0;
      const read = async (resource: string) => {
        const key = `${resource}/${cluster}`;
        if (requests.has(key)) return reads.get(key);
        const request = new AbortController();
        requests.set(key, request);
        const reading = fetch(`/api/${resource}?clusterSlug=${encodeURIComponent(cluster)}`, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, request.signal, AbortSignal.timeout(15_000)]),
        }).then(async (response) => {
          if (!response.ok) return;
          const body = await response.json();
          if (!controller.signal.aborted && !request.signal.aborted) {
            post({ type: `second-brain:${resource}`, cluster, [resource]: body[resource], complete: true });
          }
        }).catch(() => {
          // Published entries remain usable; focus/load can retry the read.
        }).finally(() => {
          if (requests.get(key) === request) { requests.delete(key); reads.delete(key); }
        });
        reads.set(key, reading);
        return reading;
      };
      // Document metadata scans the whole Garden. Deliver the lightweight
      // folder list first so that scan cannot hold up custom folder names.
      void read('folders').then(() => {
        if (!controller.signal.aborted && generation === (generations.get(cluster) ?? 0)) return read('documents');
      });
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow ||
          (quartzOrigin && event.origin !== quartzOrigin)) return;
      const data = event.data;
      if (data?.type === 'second-brain:move-note') {
        if (typeof data.cluster !== 'string' || !data.cluster || typeof data.slug !== 'string' || !data.slug ||
            typeof data.toFolder !== 'string') return;
        const requestId = typeof data.requestId === 'string' ? data.requestId : `${data.cluster}/${data.slug}`;
        if (moves.has(requestId)) return;
        moves.add(requestId);
        const result = { type: 'second-brain:move-note-result', cluster: data.cluster, slug: data.slug, requestId };
        void fetch('/api/folders', {
          method: 'PATCH', priority: 'high', headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
          body: JSON.stringify({ clusterSlug: data.cluster, slug: data.slug, toFolder: data.toFolder }),
        }).then(async response => {
          const body = await response.json();
          if (controller.signal.aborted) return;
          const ok = response.ok && body.success === true;
          post({ ...result, ok, relPath: body.relPath, folder: body.folder, error: body.error });
          refresh(data.cluster, true);
        }).catch(() => {
          if (!controller.signal.aborted) {
            post({ ...result, ok: false, error: 'Could not confirm the move. Refresh the file list before trying again.' });
            refresh(data.cluster, true);
          }
        }).finally(() => moves.delete(requestId));
        return;
      }
      if (data?.type === 'second-brain:copy-folder' || data?.type === 'second-brain:rename-folder') {
        if (typeof data.cluster !== 'string' || !data.cluster || typeof data.folder !== 'string' || !data.folder ||
            typeof data.requestId !== 'string' || !data.requestId) return;
        const copy = data.type === 'second-brain:copy-folder';
        const result = { type: `${data.type}-result`, cluster: data.cluster, folder: data.folder, requestId: data.requestId };
        void fetch('/api/folders', {
          method: copy ? 'POST' : 'PUT',
          priority: 'high',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
          body: JSON.stringify({ clusterSlug: data.cluster, folder: data.folder,
            ...(copy ? { action: 'copy' } : { name: data.name }) }),
        }).then(async response => {
          const body = await response.json().catch(() => ({}));
          const ok = response.ok && body.success === true;
          if (controller.signal.aborted) return;
          post({ ...result, ok, newFolder: body.newFolder, name: copy ? body.name : data.name,
            error: body.error, retryable: body.retryable === true, retryAfterMs: body.retryAfterMs });
          if (ok) refresh(data.cluster, true);
        }).catch(() => {
          if (!controller.signal.aborted) {
            post({ ...result, ok: false, error: `Could not confirm folder ${copy ? 'copy' : 'rename'}. Check the folder list before trying again.` });
            refresh(data.cluster);
          }
        });
        return;
      }
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
      refresh(detail.cluster, true);
    };
    const deleted = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (typeof detail?.cluster !== 'string' || !Array.isArray(detail.slugs)) return;
      for (const slug of detail.slugs) if (typeof slug === 'string') deletedSlugs.add(slug);
      post({ type: 'second-brain:documents-deleted', slugs: [...deletedSlugs] });
      refresh(detail.cluster, true);
    };
    const refreshKnown = () => {
      if (deletedSlugs.size) post({ type: 'second-brain:documents-deleted', slugs: [...deletedSlugs] });
      clusters.forEach(cluster => refresh(cluster));
    };
    const frame = iframeRef.current;
    frame?.addEventListener('load', refreshKnown);
    window.addEventListener('focus', refreshKnown);
    window.addEventListener('sb:note-created', created);
    window.addEventListener('sb:markdown-deleted', deleted);
    window.addEventListener('message', onMessage);
    refreshKnown();
    return () => {
      controller.abort();
      frame?.removeEventListener('load', refreshKnown);
      window.removeEventListener('focus', refreshKnown);
      window.removeEventListener('sb:note-created', created);
      window.removeEventListener('sb:markdown-deleted', deleted);
      window.removeEventListener('message', onMessage);
    };
  }, [iframeRef, quartzOrigin, initialCluster]);
}
