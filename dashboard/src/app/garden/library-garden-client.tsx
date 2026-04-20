'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import GardenAssistant from './garden-assistant';
import { QUARTZ_BASE_URL } from '@/lib/quartz-url';

interface Props {
  src: string;
  title: string;
}

interface QuartzMessage {
  type?: string;
  slug?: string;
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

function clusterFromQuartzSlug(slug: string): string | null {
  const clean = decodeQuartzSlug(slug).replace(/^\/+|\/+$/g, '').trim();
  if (!clean || clean === 'index' || clean.startsWith('tags/')) return null;
  if (clean === 'public-library' || clean.startsWith('public-library/')) return null;
  if (clean === 'private-library' || clean.startsWith('private-library/')) return null;

  const parts = clean.split('/').filter(Boolean);
  return parts[0] || null;
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

export default function LibraryGardenClient({ src, title }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeCluster, setActiveCluster] = useState<string | null>(null);
  const quartzOrigin = useMemo(() => {
    try {
      return new URL(QUARTZ_BASE_URL).origin;
    } catch {
      return '';
    }
  }, []);

  const isLoaded = loadedSource === src && !loadFailed;

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (quartzOrigin && event.origin !== quartzOrigin) return;

      const data = event.data as QuartzMessage;
      if (data?.type !== 'second-brain:navigate' || !data.slug) return;

      const cluster = clusterFromQuartzSlug(data.slug);
      if (!cluster) {
        setActiveCluster(null);
        window.dispatchEvent(
          new CustomEvent('sb:active-note', {
            detail: {
              cluster: '',
              slug: '',
              isMarkdownDocument: false,
            },
          }),
        );
        return;
      }

      const slug = noteSlugFromQuartzSlug(data.slug);
      setActiveCluster(cluster);
      window.dispatchEvent(new CustomEvent('sb:active-cluster', { detail: { cluster } }));
      window.dispatchEvent(
        new CustomEvent('sb:active-note', {
          detail: {
            cluster,
            slug,
            isMarkdownDocument: isMarkdownDocumentSlug(slug, cluster),
          },
        }),
      );
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [quartzOrigin]);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-gray-950">
      <div className="relative min-h-0 flex-1 bg-gray-950">
        {!isLoaded && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-gray-950">
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-none bg-gray-600 animate-pulse"
                    style={{ animationDelay: `${i * 200}ms` }}
                  />
                ))}
              </div>
              <span className="text-xs tracking-widest text-gray-700 uppercase">
                {loadFailed ? 'Quartz did not respond' : title}
              </span>
              {loadFailed && (
                <a
                  href={src}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                >
                  Open Quartz directly
                </a>
              )}
            </div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          key={src}
          src={src}
          className="block h-full w-full border-0 bg-gray-950"
          title={title}
          onLoad={() => {
            setLoadFailed(false);
            setLoadedSource(src);
          }}
          onError={() => setLoadFailed(true)}
        />
      </div>

      <GardenAssistant
        activeClusterSlug={activeCluster}
        activeClusterName={activeCluster ?? undefined}
      />
    </div>
  );
}
