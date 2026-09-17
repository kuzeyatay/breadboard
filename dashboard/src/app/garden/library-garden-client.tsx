'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import GardenAssistantSwitch from '@/app/components/hermes/garden-assistant-switch';
import { Toaster, useToast } from '@/app/components/toast';
import { quartzUrlWithAppTheme } from '@/lib/quartz-url';
import { exportFolderPdf, type FolderPdfExportMessage } from '@/lib/folder-pdf-export-client';
import {
  quartzAssistantSelectionRequest,
  quartzInlineAnswerStopRequest,
  type QuartzAssistantSelectionRequest,
  type QuartzInlineAnswerStopRequest,
  type QuartzInlineAnswerUpdate,
} from '@/lib/quartz-assistant-selection';
import {
  quartzTopologyInvestigationRequest,
  type QuartzTopologyInvestigationRequest,
} from '@/lib/quartz-topology-investigation';
import { useCanonicalQuartzDocument } from './use-canonical-quartz-document';
import { useCanonicalGardenFolders } from './use-canonical-garden-folders';
import { useQuartzViewLease } from './use-quartz-view-lease';
import { useQuartzReaderLayout } from './use-quartz-reader-layout';
import GardenMarkdownArtifacts from './garden-markdown-artifacts';

interface Props {
  src: string;
  title: string;
  /** View lease already held by the Server Component; null if it could not lease Quartz. */
  quartzViewId?: string | null;
}

interface QuartzMessage {
  action?: string;
  type?: string;
  open?: boolean;
  slug?: string;
  title?: string;
  path?: string;
  cluster?: string;
  toFolder?: string;
  folder?: string;
  requestId?: string;
  clusterSlug?: string;
  folderTitle?: string;
  documents?: FolderPdfExportMessage['documents'];
}

interface ActiveMarkdown {
  cluster: string;
  slug: string;
  title?: string;
  content?: string;
  loading?: boolean;
}

function decodeQuartzSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

function noteSlugFromQuartzSlug(slug: string, clusterSlug: string): string {
  const decoded = decodeQuartzSlug(slug);
  const segments = decoded
    .replace(/^\/+|\/+$/g, '')
    .trim()
    .split('/')
    .filter(Boolean);
  if (segments[0] === 'garden' && segments[1] === clusterSlug) return segments.slice(2).join('/');
  if (segments[0] === clusterSlug) return segments.slice(1).join('/');
  return segments.join('/');
}

function clusterFromQuartzSlug(slug: string): string | null {
  const clean = decodeQuartzSlug(slug)
    .replace(/^\/+|\/+$/g, '')
    .trim();
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
  const cleanCluster = clusterSlug
    .replace(/^\/+|\/+$/g, '')
    .trim()
    .toLowerCase();
  return Boolean(
    clean &&
    clean !== 'index' &&
    clean !== cleanCluster &&
    !clean.endsWith('/index') &&
    !clean.endsWith('/_index') &&
    !clean.startsWith('tags/'),
  );
}

export default function LibraryGardenClient({ src, title, quartzViewId = null }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const topologyRequestsRef = useRef(new Set<string>());
  const quartzLease = useQuartzViewLease(true, quartzViewId);
  const { toasts, dismissToast } = useToast();
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeCluster, setActiveCluster] = useState<string | null>(null);
  const [activeMarkdown, setActiveMarkdown] = useState<ActiveMarkdown | null>(null);
  const [assistantSelection, setAssistantSelection] = useState<QuartzAssistantSelectionRequest | null>(null);
  const [topologyInvestigation, setTopologyInvestigation] =
    useState<QuartzTopologyInvestigationRequest | null>(null);
  const [assistantInlineStop, setAssistantInlineStop] = useState<QuartzInlineAnswerStopRequest | null>(null);
  const [markdownEditorOpen, setMarkdownEditorOpen] = useState(false);
  // The Server Component resolved `src` against the Quartz port of this
  // launch; the client bundle's own QUARTZ_BASE_URL is a build-time constant
  // and may point at a dead port, so the frame's origin must come from `src`.
  const quartzOrigin = useMemo(() => {
    try {
      return new URL(src).origin;
    } catch {
      return '';
    }
  }, [src]);
  const { readerLayoutStyle, setAssistantWidth } = useQuartzReaderLayout(iframeRef, quartzOrigin);

  function postInlineAnswer(update: QuartzInlineAnswerUpdate) {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'second-brain:assistant-inline-answer', ...update },
      quartzOrigin || '*',
    );
  }

  const quartzUnavailable = loadFailed || quartzLease.failed;

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data as QuartzMessage;
      if (!data || !data.type) return;
      if (data.type === 'breadboard:thought-topology-request') {
        if (event.source !== iframeRef.current?.contentWindow) return;
        if (!quartzOrigin || event.origin !== quartzOrigin) return;
        if (
          typeof data.requestId !== 'string' ||
          data.requestId.length > 128 ||
          typeof data.clusterSlug !== 'string' ||
          !/^[a-z0-9][a-z0-9-]{0,127}$/i.test(data.clusterSlug)
        )
          return;
        const requestId = data.requestId;
        const clusterSlug = data.clusterSlug;
        if (topologyRequestsRef.current.has(requestId)) return;
        topologyRequestsRef.current.add(requestId);
        void fetch(`/api/thought-topology?clusterSlug=${encodeURIComponent(clusterSlug)}`, {
          method: data.action === 'retry' ? 'POST' : 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
        })
          .then(async (response) => {
            const payload = await response.json().catch(() => ({ enabled: false, mode: 'links' }));
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: 'breadboard:thought-topology-response',
                requestId,
                ok: response.ok,
                payload,
              },
              quartzOrigin,
            );
          })
          .catch(() => {
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: 'breadboard:thought-topology-response',
                requestId,
                ok: false,
                payload: { enabled: false, mode: 'links' },
              },
              quartzOrigin,
            );
          })
          .finally(() => topologyRequestsRef.current.delete(requestId));
        return;
      }
      if (quartzOrigin && event.origin !== quartzOrigin && event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      if (data.type === 'second-brain:markdown-editor-state') {
        if (event.source !== iframeRef.current?.contentWindow) return;
        setMarkdownEditorOpen(data.open === true);
        return;
      }

      const selectionRequest = quartzAssistantSelectionRequest(data);
      if (selectionRequest) {
        if (event.source !== iframeRef.current?.contentWindow) return;
        setAssistantSelection(selectionRequest);
        return;
      }

      const investigationRequest = quartzTopologyInvestigationRequest(data);
      if (investigationRequest) {
        if (event.source !== iframeRef.current?.contentWindow) return;
        if (!quartzOrigin || event.origin !== quartzOrigin) return;
        setActiveCluster(investigationRequest.clusterSlug);
        setTopologyInvestigation(investigationRequest);
        return;
      }

      const stopRequest = quartzInlineAnswerStopRequest(data);
      if (stopRequest) {
        if (event.source !== iframeRef.current?.contentWindow) return;
        setAssistantInlineStop(stopRequest);
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
        const folderCluster = typeof data.cluster === 'string' ? data.cluster : '';
        if (!folderCluster) return;
        const reloadGarden = () => {
          window.setTimeout(() => {
            iframeRef.current?.contentWindow?.location.reload();
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
              postToQuartz({
                type: 'second-brain:delete-folder-result',
                folder,
                ok,
                error: responseBody.error,
              });
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
              postToQuartz({
                type: 'second-brain:move-note-result',
                slug: moveSlug,
                ok,
                error: body.error,
              });
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
          signal: AbortSignal.timeout(15_000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clusterSlug: folderCluster, folder }),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}));
            const ok = response.ok && body.success;
            postToQuartz({
              type: 'second-brain:create-folder-result',
              cluster: folderCluster,
              folder,
              normalizedFolder: body.folder,
              ok,
              error: body.error,
              retryable: body.retryable === true,
              retryAfterMs: body.retryAfterMs,
            });
          })
          .catch(() => {
            postToQuartz({
              type: 'second-brain:create-folder-result',
              cluster: folderCluster,
              folder,
              ok: false,
              error: 'Could not confirm folder creation. Try again; an existing folder will be reused.',
            });
          });
        return;
      }

      if (data.type === 'second-brain:export-folder-pdf') {
        void exportFolderPdf(data).then((result) => {
          iframeRef.current?.contentWindow?.postMessage(result, quartzOrigin || '*');
        });
        return;
      }

      if (data.type !== 'second-brain:navigate' || !data.slug) return;
      setMarkdownEditorOpen(false);

      const cluster = clusterFromQuartzSlug(data.slug);
      if (!cluster) {
        setActiveCluster(null);
        setActiveMarkdown(null);
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

      const slug = noteSlugFromQuartzSlug(data.slug, cluster);
      const isMarkdownDocument = isMarkdownDocumentSlug(slug, cluster);
      setActiveCluster(cluster);
      setActiveMarkdown(isMarkdownDocument ? { cluster, slug, title: data.title, loading: true } : null);
      window.dispatchEvent(new CustomEvent('sb:active-cluster', { detail: { cluster } }));
      window.dispatchEvent(
        new CustomEvent('sb:active-note', {
          detail: {
            cluster,
            slug,
            isMarkdownDocument,
          },
        }),
      );
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [quartzOrigin]);

  const canonicalReader = useCanonicalQuartzDocument(iframeRef, quartzOrigin, activeMarkdown, setActiveMarkdown);
  useCanonicalGardenFolders(iframeRef, quartzOrigin);


  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-gray-950 lg:pr-[var(--garden-assistant-space)]"
      style={readerLayoutStyle}
    >
      {canonicalReader.error ? <p role="alert" className="absolute left-3 top-3 z-20 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--danger)]">{canonicalReader.error}<button type="button" className="ml-2 underline" onClick={() => void canonicalReader.retry()}>Retry</button></p> : null}
      <div className="relative min-h-0 min-w-0 flex-1 bg-gray-950">
        {quartzUnavailable && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-gray-950">
            <div className="flex flex-col items-center gap-4">
              <span className="text-xs tracking-widest text-gray-700 uppercase">
                Quartz did not respond
              </span>
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                className="neu-button rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
              >
                Open Quartz directly
              </a>
            </div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          key={src}
          src={quartzLease.ready ? quartzUrlWithAppTheme(src) : undefined}
          className="block h-full w-full border-0 bg-gray-950"
          title={title}
          onLoad={() => {
            if (!quartzLease.ready) return;
            setMarkdownEditorOpen(false);
            setLoadFailed(false);
          }}
          onError={() => setLoadFailed(true)}
        />
      </div>

      <GardenAssistantSwitch
        activeClusterSlug={activeCluster}
        activeClusterName={activeCluster ?? undefined}
        activeMarkdown={activeMarkdown}
        selectedTextRequest={assistantSelection}
        topologyInvestigationRequest={topologyInvestigation}
        inlineAnswerStopRequest={assistantInlineStop}
        onInlineAnswerUpdate={postInlineAnswer}
        launcherHidden={markdownEditorOpen}
        onPanelWidthChange={setAssistantWidth}
        quartzIframeRef={iframeRef}
        quartzOrigin={quartzOrigin}
      />

      <Toaster toasts={toasts} onDismiss={dismissToast} />
      <GardenMarkdownArtifacts iframeRef={iframeRef} quartzOrigin={quartzOrigin} />
    </div>
  );
}
