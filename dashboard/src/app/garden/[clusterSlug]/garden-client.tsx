'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import GardenAssistant from '@/app/garden/garden-assistant';
import { QUARTZ_BASE_URL, quartzUrl } from '@/lib/quartz-url';

interface Props {
  clusterSlug: string;
  clusterName: string;
  note?: string;
  initialChatOpen?: boolean;
  trackPublicView?: boolean;
}

interface QuartzMessage {
  type?: string;
  slug?: string;
  flagColor?: string;
  content?: string;
  fileName?: string;
  mimeType?: string;
  dataUrl?: string;
  images?: Array<{
    fileName?: string;
    mimeType?: string;
    dataUrl?: string;
  }>;
}

function decodeQuartzSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

function noteSlugFromQuartzSlug(slug: string): string {
  const decoded = decodeQuartzSlug(slug);
  return decoded.replace(/^\/+|\/+$/g, '').trim();
}

function clusterFromQuartzSlug(slug: string): string {
  const decoded = decodeQuartzSlug(slug).replace(/^\/+|\/+$/g, '');
  const parts = decoded.split('/').filter(Boolean);
  return parts[0] || '';
}

function isMarkdownDocumentSlug(slug: string, clusterSlug: string): boolean {
  const clean = slug
    .replace(/^\/+|\/+$/g, '')
    .trim()
    .toLowerCase();
  const cleanCluster = clusterSlug.replace(/^\/+|\/+$/g, '').trim().toLowerCase();
  return Boolean(
    clean &&
      clean !== 'index' &&
      clean !== cleanCluster &&
      !clean.endsWith('/index') &&
      !clean.endsWith('/_index') &&
      !clean.startsWith('tags/'),
  );
}

function quartzUrlWithRefresh(...segments: string[]): string {
  const url = new URL(quartzUrl(...segments));
  url.searchParams.set('refresh', Date.now().toString());
  return url.toString();
}

export default function GardenClient({
  clusterSlug,
  clusterName,
  note,
  initialChatOpen = false,
  trackPublicView = false,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [activeCluster, setActiveCluster] = useState(clusterSlug);
  const quartzOrigin = useMemo(() => {
    try {
      return new URL(QUARTZ_BASE_URL).origin;
    } catch {
      return '';
    }
  }, []);

  useEffect(() => {
    if (!trackPublicView) return;

    fetch(`/api/clusters/${encodeURIComponent(clusterSlug)}/view`, { method: 'POST' }).catch(() => {
      // Popularity is best-effort and should not interrupt reading.
    });
  }, [clusterSlug, trackPublicView]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (quartzOrigin && event.origin !== quartzOrigin) return;

      const data = event.data as QuartzMessage;
      if (!data || !data.type) return;

      if (data.type === 'second-brain:navigate' && data.slug) {
        const cluster = clusterFromQuartzSlug(data.slug);
        const slug = noteSlugFromQuartzSlug(data.slug);
        const nextActiveCluster = cluster || clusterSlug;
        if (cluster) {
          setActiveCluster(cluster);
          window.dispatchEvent(new CustomEvent('sb:active-cluster', { detail: { cluster } }));
        }
        window.dispatchEvent(
          new CustomEvent('sb:active-note', {
            detail: {
              cluster: nextActiveCluster,
              slug,
              isMarkdownDocument: isMarkdownDocumentSlug(slug, nextActiveCluster),
            },
          }),
        );
        return;
      }

      if (!data.slug) return;

      const slug = noteSlugFromQuartzSlug(data.slug);
      const effectiveCluster = clusterFromQuartzSlug(data.slug) || clusterSlug;
      const postToQuartz = (message: object) => {
        iframeRef.current?.contentWindow?.postMessage(message, quartzOrigin || '*');
      };

      if (data.type === 'second-brain:set-flag-color') {
        const flagColor = typeof data.flagColor === 'string' ? data.flagColor : '';

        fetch(`/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(effectiveCluster)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flagColor }),
        })
          .then((response) => {
            const ok = response.ok;
            postToQuartz({ type: 'second-brain:flag-color-result', slug: data.slug, ok });
            if (ok) {
              window.setTimeout(() => {
                iframeRef.current?.contentWindow?.location.reload();
              }, 900);
            }
          })
          .catch(() => {
            postToQuartz({ type: 'second-brain:flag-color-result', slug: data.slug, ok: false });
          });
      }

      if (data.type === 'second-brain:get-markdown') {
        fetch(`/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(effectiveCluster)}`)
          .then(async (response) => {
            const body = await response.json().catch(() => ({}));
            postToQuartz({
              type: 'second-brain:markdown-content-result',
              slug: data.slug,
              ok: response.ok && body.success,
              content: typeof body.content === 'string' ? body.content : '',
              error: body.error,
            });
          })
          .catch(() => {
            postToQuartz({
              type: 'second-brain:markdown-content-result',
              slug: data.slug,
              ok: false,
              error: 'Could not open markdown',
            });
          });
      }

      if (data.type === 'second-brain:save-markdown') {
        const content = typeof data.content === 'string' ? data.content : '';

        fetch(`/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(effectiveCluster)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}));
            const ok = response.ok && body.success;
            postToQuartz({
              type: 'second-brain:markdown-save-result',
              slug: data.slug,
              ok,
              error: body.error,
            });
            if (ok) {
              window.setTimeout(() => {
                iframeRef.current?.contentWindow?.location.reload();
              }, 900);
            }
          })
          .catch(() => {
            postToQuartz({
              type: 'second-brain:markdown-save-result',
              slug: data.slug,
              ok: false,
              error: 'Could not save markdown',
            });
          });
      }

      if (data.type === 'second-brain:upload-markdown-image' || data.type === 'second-brain:upload-markdown-images') {
        fetch('/api/markdown-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clusterSlug: effectiveCluster,
            noteSlug: slug,
            fileName: data.fileName,
            mimeType: data.mimeType,
            dataUrl: data.dataUrl,
            images: data.images,
          }),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}));
            postToQuartz({
              type: 'second-brain:markdown-image-result',
              slug: data.slug,
              ok: response.ok && body.success,
              markdown: typeof body.markdown === 'string' ? body.markdown : '',
              count: typeof body.count === 'number' ? body.count : undefined,
              error: body.error,
            });
          })
          .catch(() => {
            postToQuartz({
              type: 'second-brain:markdown-image-result',
              slug: data.slug,
              ok: false,
              error: 'Could not add image',
            });
          });
      }

      if (data.type === 'second-brain:delete-markdown') {
        fetch(`/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(effectiveCluster)}`, {
          method: 'DELETE',
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}));
            const ok = response.ok && body.success;
            postToQuartz({
              type: 'second-brain:markdown-delete-result',
              slug: data.slug,
              ok,
              error: body.error,
            });
            if (ok) {
              window.setTimeout(() => {
                if (iframeRef.current) iframeRef.current.src = quartzUrlWithRefresh(effectiveCluster);
              }, 700);
            }
          })
          .catch(() => {
            postToQuartz({
              type: 'second-brain:markdown-delete-result',
              slug: data.slug,
              ok: false,
              error: 'Could not delete markdown',
            });
          });
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [clusterSlug, quartzOrigin]);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-gray-950">
      <iframe
        ref={iframeRef}
        src={note ? quartzUrl(clusterSlug, note) : quartzUrl(clusterSlug)}
        className="h-full min-w-0 flex-1 border-0 bg-gray-950"
        title={`${clusterName} garden`}
      />

      <GardenAssistant
        activeClusterSlug={activeCluster}
        activeClusterName={activeCluster === clusterSlug ? clusterName : activeCluster}
        initialOpen={initialChatOpen}
      />
    </div>
  );
}
