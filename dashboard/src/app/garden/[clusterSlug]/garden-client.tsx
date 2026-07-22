'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import GardenAssistantSwitch from '@/app/components/openharness/garden-assistant-switch';
import { QUARTZ_BASE_URL, quartzUrl } from '@/lib/quartz-url';
import {
  exportFolderPdf,
  type FolderPdfExportMessage,
} from '@/lib/folder-pdf-export-client';

interface Props {
  clusterSlug: string;
  clusterName: string;
  note?: string;
  initialChatOpen?: boolean;
  trackPublicView?: boolean;
}

interface ActiveMarkdown {
  cluster: string;
  slug: string;
  title?: string;
  content?: string;
  loading?: boolean;
}

interface QuartzMessage {
  type?: string;
  slug?: string;
  title?: string;
  body?: string;
  tags?: unknown[];
  path?: string;
  flagColor?: string;
  content?: string;
  fileName?: string;
  mimeType?: string;
  dataUrl?: string;
  cluster?: string;
  toFolder?: string;
  folder?: string;
  requestId?: string;
  folderTitle?: string;
  documents?: FolderPdfExportMessage['documents'];
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

function noteSlugFromQuartzSlug(slug: string, fallbackClusterSlug: string): string {
  const decoded = decodeQuartzSlug(slug);
  const segments = decoded.replace(/^\/+|\/+$/g, '').trim().split('/').filter(Boolean);
  if (segments[0] === 'garden' && segments[1] === fallbackClusterSlug) {
    return segments.slice(2).join('/');
  }
  if (segments[0] === fallbackClusterSlug) {
    return segments.slice(1).join('/');
  }
  return segments.join('/');
}

function clusterFromQuartzSlug(slug: string, fallbackClusterSlug: string): string {
  const decoded = decodeQuartzSlug(slug).replace(/^\/+|\/+$/g, '');
  const parts = decoded.split('/').filter(Boolean);
  if (parts[0] === 'garden' && parts[1]) return parts[1];
  if (parts[0] === fallbackClusterSlug) return fallbackClusterSlug;
  if (parts.length === 1) return fallbackClusterSlug;
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
  const [activeMarkdown, setActiveMarkdown] = useState<ActiveMarkdown | null>(() =>
    note ? { cluster: clusterSlug, slug: note, loading: true } : null,
  );
  const activeMarkdownCluster = activeMarkdown?.cluster;
  const activeMarkdownSlug = activeMarkdown?.slug;
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
      const data = event.data as QuartzMessage;
      if (!data || !data.type) return;
      if (
        quartzOrigin &&
        event.origin !== quartzOrigin &&
        event.source !== iframeRef.current?.contentWindow
      ) {
        return;
      }

      if (data.type === 'second-brain:navigate' && data.slug) {
        const cluster = clusterFromQuartzSlug(data.slug, clusterSlug);
        const slug = noteSlugFromQuartzSlug(data.slug, cluster);
        const nextActiveCluster = cluster || clusterSlug;
        const isMarkdownDocument = isMarkdownDocumentSlug(slug, nextActiveCluster);
        if (cluster) {
          setActiveCluster(cluster);
          window.dispatchEvent(new CustomEvent('sb:active-cluster', { detail: { cluster } }));
        }
        setActiveMarkdown(
          isMarkdownDocument ? { cluster: nextActiveCluster, slug, title: data.title, loading: true } : null,
        );
        window.dispatchEvent(
          new CustomEvent('sb:active-note', {
            detail: {
              cluster: nextActiveCluster,
              slug,
              isMarkdownDocument,
            },
          }),
        );
        return;
      }

      if (
        data.type === 'second-brain:move-note' ||
        data.type === 'second-brain:create-folder' ||
        data.type === 'second-brain:delete-folder'
      ) {
        const postToQuartz = (message: object) => {
          iframeRef.current?.contentWindow?.postMessage(message, quartzOrigin || '*');
        };
        const folderCluster =
          (typeof data.cluster === 'string' && data.cluster) || clusterSlug;
        const reloadGarden = () => {
          window.setTimeout(() => {
            if (iframeRef.current) iframeRef.current.src = quartzUrlWithRefresh(folderCluster);
          }, 700);
        };

        if (data.type === 'second-brain:delete-folder') {
          const folder = typeof data.folder === 'string' ? data.folder : '';
          if (!folder) return;
          fetch('/api/folders', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clusterSlug: folderCluster, folder }),
          })
            .then(async (response) => {
              const responseBody = await response.json().catch(() => ({}));
              const ok = response.ok && responseBody.success;
              postToQuartz({ type: 'second-brain:delete-folder-result', folder, ok, error: responseBody.error });
              if (ok) reloadGarden();
            })
            .catch(() => {
              postToQuartz({
                type: 'second-brain:delete-folder-result',
                folder,
                ok: false,
                error: 'Could not delete folder',
              });
            });
          return;
        }

        if (data.type === 'second-brain:move-note') {
          const moveSlug = typeof data.slug === 'string' ? data.slug : '';
          if (!moveSlug) return;
          fetch('/api/folders', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clusterSlug: folderCluster,
              slug: moveSlug,
              toFolder: typeof data.toFolder === 'string' ? data.toFolder : '',
            }),
          })
            .then(async (response) => {
              const body = await response.json().catch(() => ({}));
              const ok = response.ok && body.success;
              postToQuartz({ type: 'second-brain:move-note-result', slug: moveSlug, ok, error: body.error });
              if (ok) reloadGarden();
            })
            .catch(() => {
              postToQuartz({
                type: 'second-brain:move-note-result',
                slug: moveSlug,
                ok: false,
                error: 'Could not move note',
              });
            });
          return;
        }

        const folder = typeof data.folder === 'string' ? data.folder : '';
        if (!folder) return;
        fetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clusterSlug: folderCluster, folder }),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}));
            const ok = response.ok && body.success;
            postToQuartz({ type: 'second-brain:create-folder-result', folder, ok, error: body.error });
            if (ok) reloadGarden();
          })
          .catch(() => {
            postToQuartz({
              type: 'second-brain:create-folder-result',
              folder,
              ok: false,
              error: 'Could not create folder',
            });
          });
        return;
      }

      if (data.type === 'second-brain:export-folder-pdf') {
        void exportFolderPdf(data, clusterSlug).then((result) => {
          iframeRef.current?.contentWindow?.postMessage(result, quartzOrigin || '*');
        });
        return;
      }

      if (!data.slug) return;

      const effectiveCluster = clusterFromQuartzSlug(data.slug, clusterSlug) || clusterSlug;
      const slug = noteSlugFromQuartzSlug(data.slug, effectiveCluster);
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
              title: typeof body.title === 'string' ? body.title : '',
              tags: Array.isArray(body.tags) ? body.tags : [],
              body: typeof body.body === 'string' ? body.body : '',
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
        // The Quartz editor now sends title/tags/body separately so hidden
        // frontmatter (date, knowledge_type, …) is preserved. Fall back to the
        // legacy full-content payload if an older editor build sends it.
        const patch: Record<string, unknown> =
          typeof data.body === 'string' || typeof data.title === 'string' || Array.isArray(data.tags)
            ? {
                ...(typeof data.title === 'string' ? { title: data.title } : {}),
                ...(Array.isArray(data.tags)
                  ? { tags: data.tags.filter((tag: unknown) => typeof tag === 'string') }
                  : {}),
                ...(typeof data.body === 'string' ? { body: data.body } : {}),
              }
            : { content: typeof data.content === 'string' ? data.content : '' };

        fetch(`/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(effectiveCluster)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
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

  useEffect(() => {
    if (!activeMarkdownSlug || !activeMarkdownCluster) return;

    let cancelled = false;
    const cluster = activeMarkdownCluster;
    const slug = activeMarkdownSlug;

    fetch(`/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(cluster)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok || !body.success || typeof body.content !== 'string') {
          setActiveMarkdown((current) =>
            current?.cluster === cluster && current.slug === slug
              ? { ...current, content: undefined, loading: false }
              : current,
          );
          return;
        }
        setActiveMarkdown((current) =>
          current?.cluster === cluster && current.slug === slug
            ? {
                ...current,
                content: body.content,
                title: typeof body.fileName === 'string' ? body.fileName : slug,
                loading: false,
              }
            : current,
        );
      })
      .catch(() => {
        if (cancelled) return;
        setActiveMarkdown((current) =>
          current?.cluster === cluster && current.slug === slug
            ? { ...current, content: undefined, loading: false }
            : current,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [activeMarkdownCluster, activeMarkdownSlug]);

  useEffect(() => {
    function handleMarkdownUpdated(event: Event) {
      const detail = (event as CustomEvent<Partial<ActiveMarkdown>>).detail;
      if (!detail?.cluster || !detail.slug || detail.cluster !== activeMarkdownCluster) return;
      setActiveMarkdown({
        cluster: detail.cluster,
        slug: detail.slug,
        title: detail.title,
        content: detail.content,
        loading: false,
      });
      window.setTimeout(() => {
        iframeRef.current?.contentWindow?.location.reload();
      }, 300);
    }

    window.addEventListener('sb:markdown-updated', handleMarkdownUpdated);
    return () => window.removeEventListener('sb:markdown-updated', handleMarkdownUpdated);
  }, [activeMarkdownCluster]);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-gray-950">
      <iframe
        ref={iframeRef}
        src={
          note
            ? quartzUrl(clusterSlug, ...note.split('/').filter(Boolean))
            : quartzUrl(clusterSlug)
        }
        className="h-full min-w-0 flex-1 border-0 bg-gray-950"
        title={`${clusterName} garden`}
      />

      <GardenAssistantSwitch
        activeClusterSlug={activeCluster}
        activeClusterName={activeCluster === clusterSlug ? clusterName : activeCluster}
        activeMarkdown={activeMarkdown}
        initialOpen={initialChatOpen}
      />
    </div>
  );
}
