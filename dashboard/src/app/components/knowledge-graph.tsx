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
import LinkContextMenu from './link-context-menu';
import RailDivider from './hermes/rail-divider';
import ThoughtTopologyLoadingDots from './thought-topology-loading-dots';
import { useRailResize } from './hermes/use-rail-resize';
import { useQuartzViewLease } from '@/app/garden/use-quartz-view-lease';
import {
  APP_THEME_CHANGE_EVENT,
  getStoredAppTheme,
  isAppTheme,
  type AppTheme,
} from '@/lib/app-theme';

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
  revision: string;
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

interface TopologyFreshnessResponse {
  enabled?: boolean;
  mode?: string;
  stale?: boolean;
  topology?: {
    sourceRevision?: string;
    build?: {
      state?: string;
      generatedAt?: string;
      contentFingerprint?: string;
    };
  };
  status?: {
    state?: string;
    progress?: number;
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
  revision: '',
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

function quartzMapPreviewUrl(
  clusterSlug: string,
  refreshKey: string,
  serverRefreshKey: string,
  theme: AppTheme,
): string {
  const params = new URLSearchParams({
    clusterSlug,
    refresh: hashString(`${refreshKey}:${serverRefreshKey}`),
    embed: 'graph',
    theme,
  });
  return `/api/quartz-graph-preview?${params.toString()}`;
}

const MAP_PANEL_DEFAULT = 384;
const MAP_PANEL_MIN = 300;
const MAP_PANEL_MAX = 600;
const MAP_PANEL_THRESHOLD = 180; // below this the panel collapses to a rail
const MAP_PANEL_RAIL = 48;
const MAP_PANEL_WIDTH_KEY = 'breadboard:garden-workspace:map-width';
const MAP_PREVIEW_DEFAULT_HEIGHT = 256;
const MAP_PREVIEW_MIN_HEIGHT = 176;
const MAP_PREVIEW_MAX_HEIGHT = 384;
const MAP_PREVIEW_HEIGHT_RATIO = 0.72;
const MAP_PREVIEW_VIEWPORT_RATIO = 0.42;
const MAP_PREVIEW_FRESHNESS_POLL_MS = 5_000;

function topologyFreshnessKey(payload: TopologyFreshnessResponse): string {
  if (payload.enabled !== true) return `links:${payload.mode ?? 'links'}`;
  const build = payload.topology?.build;
  return [
    payload.topology?.sourceRevision ?? 'pending',
    build?.generatedAt ?? 'pending',
    payload.status?.state ?? build?.state ?? 'ready',
  ].join(':');
}

function topologyIsCurrent(
  payload: TopologyFreshnessResponse,
  gardenRevision: string,
): boolean {
  if (payload.enabled !== true) return true;
  const build = payload.topology?.build;
  if (
    payload.status?.state === 'building' ||
    payload.status?.state === 'stale' ||
    build?.state === 'building'
  ) {
    return false;
  }
  return Boolean(gardenRevision && build?.contentFingerprint === gardenRevision);
}

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
  const previewHostRef = useRef<HTMLDivElement | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const gardenRevisionRef = useRef('');
  const topologyRevisionRef = useRef('');
  const publishedRevisionRef = useRef('');
  const [previewTheme, setPreviewTheme] = useState<AppTheme | null>(null);
  const [previewHeight, setPreviewHeight] = useState(MAP_PREVIEW_DEFAULT_HEIGHT);
  const [gardenRevision, setGardenRevision] = useState('');
  const [topologyRevision, setTopologyRevision] = useState('pending');
  const [publishedRevision, setPublishedRevision] = useState('pending');
  const [serverPreviewCurrent, setServerPreviewCurrent] = useState(false);
  const [previewUpdateLabel, setPreviewUpdateLabel] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>({
    url: '',
    status: 'loading',
  });
  const graph = data ?? emptyResponse;
  const loading = data === null;
  const previewFreshnessReady =
    gardenRevision !== '' &&
    topologyRevision !== 'pending' &&
    publishedRevision !== 'pending' &&
    serverPreviewCurrent;
  const serverRefreshKey = `${gardenRevision}:${topologyRevision}:${publishedRevision}`;
  const quartzLease = useQuartzViewLease(
    sidebarOpen && !loading && graph.nodes.length > 0 && previewTheme !== null && previewFreshnessReady,
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
    const syncTheme = (event?: Event) => {
      const announcedTheme = (event as CustomEvent<unknown> | undefined)?.detail;
      setPreviewTheme(
        isAppTheme(announcedTheme)
          ? announcedTheme
          : getStoredAppTheme(window.localStorage),
      );
    };

    syncTheme();
    window.addEventListener(APP_THEME_CHANGE_EVENT, syncTheme);
    return () => window.removeEventListener(APP_THEME_CHANGE_EVENT, syncTheme);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ clusterSlug });
    if (showInternalConceptGraph) params.set('includeInternalConcepts', '1');
    fetch(`/api/knowledge-graph?${params.toString()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : emptyResponse))
      .then((g: GraphResponse) => {
        if (cancelled) return;
        setData(g);
        if (g.revision) {
          if (gardenRevisionRef.current && gardenRevisionRef.current !== g.revision) {
            setServerPreviewCurrent(false);
          }
          gardenRevisionRef.current = g.revision;
          setGardenRevision(g.revision);
        }
      })
      .catch(() => { if (!cancelled) setData(emptyResponse); });
    return () => { cancelled = true; };
  }, [clusterSlug, refreshKey, showInternalConceptGraph]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const host = previewHostRef.current;
    if (!host) return;

    const resizePreview = () => {
      const width = host.getBoundingClientRect().width;
      if (!width) return;
      const viewportLimit = Math.max(
        MAP_PREVIEW_MIN_HEIGHT,
        Math.floor(window.innerHeight * MAP_PREVIEW_VIEWPORT_RATIO),
      );
      const nextHeight = Math.round(
        Math.max(
          MAP_PREVIEW_MIN_HEIGHT,
          Math.min(
            MAP_PREVIEW_MAX_HEIGHT,
            viewportLimit,
            width * MAP_PREVIEW_HEIGHT_RATIO,
          ),
        ),
      );
      setPreviewHeight((current) => current === nextHeight ? current : nextHeight);
    };

    resizePreview();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(resizePreview);
    observer?.observe(host);
    window.addEventListener('resize', resizePreview);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resizePreview);
    };
  }, [sidebarOpen]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const controller = new AbortController();
    const graphParams = new URLSearchParams({ clusterSlug });
    if (showInternalConceptGraph) graphParams.set('includeInternalConcepts', '1');
    const graphUrl = `/api/knowledge-graph?${graphParams.toString()}`;
    const revisionParams = new URLSearchParams({ clusterSlug, revisionOnly: '1' });
    const revisionUrl = `/api/knowledge-graph?${revisionParams.toString()}`;
    const topologyUrl = `/api/thought-topology?clusterSlug=${encodeURIComponent(clusterSlug)}`;
    const publishedParams = new URLSearchParams({
      clusterSlug,
      asset: 'revision',
    });
    const publishedUrl = `/api/quartz-graph-preview?${publishedParams.toString()}`;

    gardenRevisionRef.current = '';
    topologyRevisionRef.current = '';
    publishedRevisionRef.current = '';
    setGardenRevision('');
    setTopologyRevision('pending');
    setPublishedRevision('pending');
    setServerPreviewCurrent(false);
    setPreviewUpdateLabel(null);

    const checkFreshness = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        let observedGardenRevision = gardenRevisionRef.current;
        const [gardenResult, topologyResult, publishedResult] = await Promise.allSettled([
          fetch(revisionUrl, { cache: 'no-store', signal: controller.signal }),
          fetch(topologyUrl, { cache: 'no-store', signal: controller.signal }),
          fetch(publishedUrl, { cache: 'no-store', signal: controller.signal }),
        ]);

        if (gardenResult.status === 'fulfilled' && gardenResult.value.ok) {
          const payload = await gardenResult.value.json() as { revision?: unknown };
          const revision = typeof payload.revision === 'string' ? payload.revision : '';
          const previousRevision = gardenRevisionRef.current;
          if (revision && revision !== previousRevision) {
            observedGardenRevision = revision;
            gardenRevisionRef.current = revision;
            setGardenRevision(revision);
            if (previousRevision) setServerPreviewCurrent(false);
            if (previousRevision) {
              const response = await fetch(graphUrl, {
                cache: 'no-store',
                signal: controller.signal,
              });
              if (response.ok && !disposed) {
                const freshGraph = await response.json() as GraphResponse;
                setData(freshGraph);
              }
            }
          }
        }

        if (topologyResult.status === 'fulfilled' && topologyResult.value.ok) {
          const payload = await topologyResult.value.json() as TopologyFreshnessResponse;
          const revision = topologyFreshnessKey(payload);
          if (revision !== topologyRevisionRef.current) {
            topologyRevisionRef.current = revision;
            setTopologyRevision(revision);
          }
          setServerPreviewCurrent(topologyIsCurrent(payload, observedGardenRevision));
          const progress = payload.status?.state === 'building'
            ? Math.max(0, Math.min(99, Math.floor(payload.status.progress ?? 0)))
            : null;
          setPreviewUpdateLabel(
            progress === null ? null : `Updating learning map · ${progress}%`,
          );
        } else if (!topologyRevisionRef.current) {
          topologyRevisionRef.current = 'unavailable';
          setTopologyRevision('unavailable');
          setServerPreviewCurrent(true);
        }

        if (publishedResult.status === 'fulfilled' && publishedResult.value.ok) {
          const payload = await publishedResult.value.json() as { revision?: unknown };
          const revision = typeof payload.revision === 'string' ? payload.revision : '';
          if (revision && revision !== publishedRevisionRef.current) {
            publishedRevisionRef.current = revision;
            setPublishedRevision(revision);
          }
        } else if (!publishedRevisionRef.current) {
          publishedRevisionRef.current = 'unavailable';
          setPublishedRevision('unavailable');
        }
      } catch {
        // Keep the last confirmed frame during a transient poll failure. The
        // next interval, focus, visibility or online event retries it.
      } finally {
        inFlight = false;
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') void checkFreshness();
    };
    void checkFreshness();
    const timer = window.setInterval(checkFreshness, MAP_PREVIEW_FRESHNESS_POLL_MS);
    window.addEventListener('focus', checkFreshness);
    window.addEventListener('online', checkFreshness);
    document.addEventListener('visibilitychange', checkWhenVisible);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', checkFreshness);
      window.removeEventListener('online', checkFreshness);
      document.removeEventListener('visibilitychange', checkWhenVisible);
    };
  }, [clusterSlug, showInternalConceptGraph]);

  const quartzPreviewUrl = useMemo(
    () => quartzMapPreviewUrl(
      clusterSlug,
      refreshKey,
      serverRefreshKey,
      previewTheme ?? 'light',
    ),
    [clusterSlug, previewTheme, refreshKey, serverRefreshKey],
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
    if (
      !sidebarOpen ||
      loading ||
      graph.nodes.length === 0 ||
      !previewFreshnessReady ||
      !quartzLease.ready ||
      previewStatus === 'ready'
    ) return;

    const timer = window.setTimeout(() => {
      setPreviewState((current) =>
        current.url === quartzPreviewUrl && current.status === 'ready'
          ? current
          : { url: quartzPreviewUrl, status: 'error' },
      );
    }, 15000);

    return () => window.clearTimeout(timer);
  }, [
    graph.nodes.length,
    loading,
    previewFreshnessReady,
    previewStatus,
    quartzLease.ready,
    quartzPreviewUrl,
    sidebarOpen,
  ]);

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
            ref={previewHostRef}
            className="bb-neu-recessed group relative mb-3 block w-full shrink-0 overflow-hidden rounded-lg border border-gray-800 bg-gray-900/30"
            style={{ height: previewHeight }}
          >
            {loading ? (
              <ThoughtTopologyLoadingDots label="Loading garden preview" />
            ) : graph.nodes.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-gray-700 px-8 text-center">
                Upload a source to grow the map.
              </div>
            ) : (
              <>
                <iframe
                  ref={previewFrameRef}
                  key={quartzPreviewUrl}
                  src={quartzLease.ready && previewFreshnessReady ? quartzPreviewUrl : undefined}
                  title="Garden learning map preview"
                  className={`pointer-events-none h-full w-full border-0 bg-gray-950 transition-opacity duration-300 ${
                    previewStatus === 'ready' ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{
                    colorScheme: previewTheme ?? 'light',
                    backgroundColor: 'var(--paper-bg)',
                  }}
                  loading="eager"
                  tabIndex={-1}
                  aria-hidden="true"
                  onError={() => setPreviewState({ url: quartzPreviewUrl, status: 'error' })}
                />
                {previewStatus !== 'ready' ? (
                  previewStatus === 'error' ? (
                    <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-xs text-gray-600">
                      Preview unavailable.
                    </div>
                  ) : (
                    <ThoughtTopologyLoadingDots
                      label={previewUpdateLabel ?? 'Loading garden preview'}
                    />
                  )
                ) : null}
              </>
            )}
            <LinkContextMenu
              href={graphHref(clusterSlug)}
              label="Explore learning map"
            >
              <Link
                href={graphHref(clusterSlug)}
                prefetch
                className="absolute inset-0"
                aria-label="Explore"
              >
                <span className="neu-button absolute bottom-2 right-2 rounded-md border border-gray-700 bg-gray-950/85 px-3 py-1.5 text-xs font-medium text-gray-300 shadow-sm transition-colors group-hover:text-white">
                  Explore
                </span>
              </Link>
            </LinkContextMenu>
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
          {/* The icon is the rail's visible affordance, so it must open the map
              itself; the resize divider is only an eight-pixel edge target. */}
          <button
            type="button"
            onClick={map.toggle}
            aria-label="Open learning map"
            title="Open learning map"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-gray-700 transition-colors hover:border-gray-700 hover:bg-gray-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8faf9a]"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5M3.75 12h16.5M3.75 18.75h16.5M8.25 8.25 4.5 12l3.75 3.75" />
            </svg>
          </button>
        </aside>
      )}
    </>
  );
}

export default memo(KnowledgeGraph);
