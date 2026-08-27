'use client';

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import RailDivider from './hermes/rail-divider';
import { useRailResize } from './hermes/use-rail-resize';
import { useQuartzViewLease } from '@/app/garden/use-quartz-view-lease';

interface GraphNode {
  slug: string;
  title: string;
  type: string;
  sourceFile: string;
  locations: string[];
  wordCount: number;
  excerpt: string;
}

interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

interface TreeItem {
  source: GraphNode;
  topics: GraphNode[];
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  tree: TreeItem[];
  orphanTopics: GraphNode[];
  stats: {
    documents: number;
    topics: number;
    textbookPages: number;
    conceptNodes: number;
    learningPages: number;
    generatedNotes: number;
    links: number;
    words: number;
  };
}

interface Props {
  clusterSlug: string;
  refreshKey: string;
  sourceLibrary?: ReactNode;
  showInternalConceptGraph?: boolean;
  savedLinkCount?: number;
}

type PreviewStatus = 'loading' | 'ready' | 'error';

interface PreviewState {
  url: string;
  status: PreviewStatus;
}

const emptyResponse: GraphResponse = {
  nodes: [],
  edges: [],
  tree: [],
  orphanTopics: [],
  stats: {
    documents: 0,
    topics: 0,
    textbookPages: 0,
    conceptNodes: 0,
    learningPages: 0,
    generatedNotes: 0,
    links: 0,
    words: 0,
  },
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function graphHref(clusterSlug: string): string {
  return `/garden/${clusterSlug}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function quartzMapPreviewUrl(clusterSlug: string, refreshKey: string): string {
  const params = new URLSearchParams({
    clusterSlug,
    refresh: hashString(refreshKey),
  });
  return `/api/quartz-graph-preview?${params.toString()}`;
}

const MAP_PANEL_DEFAULT = 384;
const MAP_PANEL_MIN = 300;
const MAP_PANEL_MAX = 600;
const MAP_PANEL_THRESHOLD = 180; // below this the panel collapses to a rail
const MAP_PANEL_RAIL = 48;
const MAP_PANEL_WIDTH_KEY = 'breadboard:garden-workspace:map-width';

function KnowledgeGraph({
  clusterSlug,
  refreshKey,
  sourceLibrary,
  showInternalConceptGraph = false,
  savedLinkCount,
}: Props) {
  const [data, setData] = useState<GraphResponse | null>(null);
  // Panel width is the single source of truth: the inner edge drags it to any
  // width and clicks it between the rail and the width it was last opened to.
  // Drag was all it had for a long time, which meant putting the map away took
  // a deliberate haul across most of the panel; the click came from the chat
  // rail on the other side of the page, along with the edge itself.
  const map = useRailResize({
    side: 'right',
    defaultWidth: MAP_PANEL_DEFAULT,
    min: MAP_PANEL_MIN,
    max: MAP_PANEL_MAX,
    railWidth: MAP_PANEL_RAIL,
    threshold: MAP_PANEL_THRESHOLD,
    storageKey: MAP_PANEL_WIDTH_KEY,
  });
  const panelWidth = map.width;
  const sidebarOpen = !map.collapsed;
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>({
    url: '',
    status: 'loading',
  });
  const graph = data ?? emptyResponse;
  const loading = data === null;
  const quartzLease = useQuartzViewLease(
    sidebarOpen && !loading && graph.nodes.length > 0,
  );

  // The edge sits on the panel's own left border rather than beside it in the
  // row, because the panel is the last thing in the layout and a sibling would
  // widen it by its own two pixels at every width.
  const resizeHandle = (
    <div className="absolute inset-y-0 left-0 z-20 flex -translate-x-1/2 items-stretch">
      <RailDivider
        collapsed={map.collapsed}
        onToggle={map.toggle}
        name="Toggle the learning map"
        moves="the learning map"
        onPointerDown={map.onPointerDown}
        dragging={map.dragging}
      />
    </div>
  );

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ clusterSlug });
    if (showInternalConceptGraph) params.set('includeInternalConcepts', '1');
    fetch(`/api/knowledge-graph?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : emptyResponse))
      .then((g: GraphResponse) => { if (!cancelled) setData(g); })
      .catch(() => { if (!cancelled) setData(emptyResponse); });
    return () => { cancelled = true; };
  }, [clusterSlug, refreshKey, showInternalConceptGraph]);

  const quartzPreviewUrl = useMemo(
    () => quartzMapPreviewUrl(clusterSlug, refreshKey),
    [clusterSlug, refreshKey],
  );

  const previewStatus: PreviewStatus = quartzLease.failed
    ? 'error'
    : previewState.url === quartzPreviewUrl
      ? previewState.status
      : 'loading';

  useEffect(() => {
    const handlePreviewMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== previewFrameRef.current?.contentWindow) return;
      if (!event.data || event.data.type !== 'breadboard:quartz-graph-preview') return;

      if (event.data.status === 'ready' || event.data.status === 'error') {
        setPreviewState({ url: quartzPreviewUrl, status: event.data.status });
      }
    };

    window.addEventListener('message', handlePreviewMessage);
    return () => window.removeEventListener('message', handlePreviewMessage);
  }, [quartzPreviewUrl]);

  useEffect(() => {
    if (!sidebarOpen || loading || graph.nodes.length === 0 || previewStatus === 'ready') return;

    const timer = window.setTimeout(() => {
      setPreviewState((current) =>
        current.url === quartzPreviewUrl && current.status === 'ready'
          ? current
          : { url: quartzPreviewUrl, status: 'error' },
      );
    }, 15000);

    return () => window.clearTimeout(timer);
  }, [graph.nodes.length, loading, previewStatus, quartzPreviewUrl, sidebarOpen]);

  return (
    <>
      {sidebarOpen ? (
      <aside
        style={{ width: panelWidth } as CSSProperties}
        className={`bb-neu-sidebar-right neu-surface-subtle relative hidden lg:flex shrink-0 border-l border-gray-800 flex-col bg-gray-950 ${
          map.dragging ? '' : 'bb-rail-travel'
        }`}
      >
        {resizeHandle}
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                Learning map
              </h2>
              <p className="text-xs text-gray-600 mt-0.5">
                {formatNumber(graph.stats.words)} words across this cluster
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="px-4 pt-3 pb-1 border-b border-gray-800 shrink-0">
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { value: graph.stats.documents, label: 'Sources' },
              { value: graph.stats.textbookPages ?? graph.stats.topics, label: 'Pages' },
              { value: graph.stats.conceptNodes ?? 0, label: 'Concepts' },
              { value: savedLinkCount ?? graph.stats.links, label: 'Links' },
            ].map(({ value, label }) => (
              <div key={label}>
                <p className="text-lg font-semibold text-white tabular-nums">{value}</p>
                <p className="text-[11px] text-gray-600">{label}</p>
              </div>
            ))}
          </div>

          {/* Quartz graph preview */}
          <div
            className="bb-neu-recessed group relative block h-52 overflow-hidden rounded-lg border border-gray-800 bg-gray-900/30 mb-3"
          >
            {loading ? (
              <div className="h-full flex items-center justify-center text-xs text-gray-700">
                Loading...
              </div>
            ) : graph.nodes.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-gray-700 px-8 text-center">
                Upload a source to grow the map.
              </div>
            ) : (
              <>
                <iframe
                  ref={previewFrameRef}
                  key={quartzPreviewUrl}
                  src={quartzLease.ready ? quartzPreviewUrl : undefined}
                  title="Garden learning map preview"
                  className={`pointer-events-none h-full w-full border-0 bg-gray-950 transition-opacity duration-300 ${
                    previewStatus === 'ready' ? 'opacity-100' : 'opacity-0'
                  }`}
                  loading="eager"
                  tabIndex={-1}
                  aria-hidden="true"
                  onError={() => setPreviewState({ url: quartzPreviewUrl, status: 'error' })}
                />
                {previewStatus !== 'ready' ? (
                  <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-xs text-gray-600">
                    {previewStatus === 'error' ? 'Preview unavailable.' : 'Loading garden preview...'}
                  </div>
                ) : null}
                <Link
                  href={graphHref(clusterSlug)}
                  prefetch
                  className="absolute inset-0"
                  aria-label="Explore"
                >
                  <span className="neu-button absolute bottom-2 right-2 rounded-md border border-gray-700 bg-gray-950/85 px-2 py-1 text-[11px] font-medium text-gray-300 shadow-sm transition-colors group-hover:text-white">
                    Explore
                  </span>
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Source tree */}
        <div className="flex-1 overflow-y-auto">
          {sourceLibrary}
        </div>
      </aside>
      ) : (
        <aside
          style={{ width: panelWidth } as CSSProperties}
          className={`bb-neu-sidebar-right neu-surface-subtle relative hidden lg:flex shrink-0 border-l border-gray-800 flex-col items-center bg-gray-950 py-3 ${
            map.dragging ? '' : 'bb-rail-travel'
          }`}
        >
          {resizeHandle}
          <svg
            className="h-4 w-4 text-gray-700"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5M3.75 12h16.5M3.75 18.75h16.5M8.25 8.25 4.5 12l3.75 3.75" />
          </svg>
        </aside>
      )}
    </>
  );
}

export default memo(KnowledgeGraph);
