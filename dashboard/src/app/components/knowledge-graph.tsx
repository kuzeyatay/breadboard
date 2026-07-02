'use client';

import {
  memo,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

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

function labelForType(type: string): string {
  if (type === 'source-document') return 'Source';
  if (type === 'textbook-page') return 'Textbook page';
  if (type === 'internal-concept') return 'ConceptNode';
  if (type === 'knowledge-topic') return 'Legacy topic';
  if (type === 'generated-note') return 'Saved chat page';
  return 'Note';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function noteHref(clusterSlug: string, slug: string): string {
  return `/garden/${clusterSlug}?note=${encodeURIComponent(slug)}`;
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

function KnowledgeGraph({ clusterSlug, refreshKey, sourceLibrary, showInternalConceptGraph = false }: Props) {
  const [data, setData] = useState<GraphResponse | null>(null);
  // Panel width is the single source of truth so it can be dragged open/closed
  // by its inner edge (no toggle button); below the threshold it shows a rail.
  const [panelWidth, setPanelWidth] = useState(MAP_PANEL_DEFAULT);
  const [resizing, setResizing] = useState(false);
  const sidebarOpen = panelWidth >= MAP_PANEL_THRESHOLD;
  const [treeExpanded, setTreeExpanded] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const graph = data ?? emptyResponse;
  const loading = data === null;

  // Window listeners (not pointer capture) so the drag survives the panel
  // swapping between its open and rail render at the collapse threshold.
  function handlePanelResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarOpen ? panelWidth : MAP_PANEL_RAIL;
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (e: PointerEvent) => {
      // The panel sits on the right, so dragging left widens it.
      const next = startWidth + (startX - e.clientX);
      setPanelWidth(Math.min(MAP_PANEL_MAX, Math.max(MAP_PANEL_RAIL, Math.round(next))));
    };
    const handleEnd = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      setResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setPanelWidth((width) =>
        width < MAP_PANEL_THRESHOLD
          ? MAP_PANEL_RAIL
          : Math.min(MAP_PANEL_MAX, Math.max(MAP_PANEL_MIN, width)),
      );
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  }

  const resizeHandle = (
    <div
      onPointerDown={handlePanelResizeStart}
      title="Drag to resize or collapse"
      className="group absolute inset-y-0 left-0 z-20 flex w-2 -translate-x-1/2 cursor-col-resize items-center justify-center"
    >
      <span
        className={`h-10 w-0.5 rounded-full transition-colors ${
          resizing ? 'bg-gray-400' : 'bg-gray-700 group-hover:bg-gray-500'
        }`}
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

  useEffect(() => {
    if (!sidebarOpen || loading || graph.nodes.length === 0) {
      const timer = window.setTimeout(() => {
        setPreviewReady(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      setPreviewReady(true);
    }, 900);

    return () => window.clearTimeout(timer);
  }, [graph.nodes.length, loading, quartzPreviewUrl, sidebarOpen]);

  return (
    <>
      {sidebarOpen ? (
      <aside
        style={{ width: panelWidth } as CSSProperties}
        className="relative hidden lg:flex shrink-0 border-l border-gray-800 flex-col bg-gray-950"
      >
        {resizeHandle}
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                Learning map
              </h2>
              <p className="text-xs text-gray-600 mt-0.5">
                {formatNumber(graph.stats.words)} words across this cluster
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={graphHref(clusterSlug)}
                className="text-xs text-gray-500 hover:text-white underline underline-offset-2 transition-colors"
              >
                Open
              </a>
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
              { value: graph.stats.links, label: 'Links' },
            ].map(({ value, label }) => (
              <div key={label}>
                <p className="text-lg font-semibold text-white tabular-nums">{value}</p>
                <p className="text-[11px] text-gray-600">{label}</p>
              </div>
            ))}
          </div>

          {/* Quartz graph preview */}
          <div
            className="group relative block h-52 overflow-hidden rounded-lg border border-gray-800 bg-gray-900/30 mb-3"
          >
            {loading ? (
              <div className="h-full flex items-center justify-center text-xs text-gray-700">
                Loading...
              </div>
            ) : graph.nodes.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-gray-700 px-8 text-center">
                Upload a source to grow the map.
              </div>
            ) : previewReady ? (
              <>
                <iframe
                  src={quartzPreviewUrl}
                  title="Quartz Learning Map preview"
                  className="pointer-events-none h-full w-full border-0 bg-gray-950"
                  loading="lazy"
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <a
                  href={graphHref(clusterSlug)}
                  className="absolute inset-0 bg-gray-950/10 transition-colors group-hover:bg-gray-950/0"
                  aria-label="Open Quartz Learning Map"
                >
                  <span className="absolute bottom-2 right-2 rounded-md border border-gray-700 bg-gray-950/85 px-2 py-1 text-[11px] font-medium text-gray-300 shadow-sm transition-colors group-hover:text-white">
                    Open Quartz
                  </span>
                </a>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-gray-700">
                Preparing preview...
              </div>
            )}
          </div>
        </div>

        {/* Source tree */}
        <div className="flex-1 overflow-y-auto">
          <div>
            <button
              onClick={() => setTreeExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2">
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
                  />
                </svg>
                 Textbook path
                {graph.tree.length > 0 ? ` (${graph.tree.length})` : ''}
              </div>
              <div className="flex items-center gap-1.5">
                <svg
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${treeExpanded ? '' : 'rotate-180'}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m4.5 15.75 7.5-7.5 7.5 7.5"
                  />
                </svg>
              </div>
            </button>
            {treeExpanded && (
              <div className="px-4 pb-3">
                {graph.tree.length === 0 && graph.orphanTopics.length === 0 ? (
                   <p className="text-xs text-gray-600">No textbook pages yet.</p>
                ) : (
                  <div className="space-y-4">
                    {graph.tree.map(({ source, topics }, sourceIndex) => (
                      <div key={`${source.slug}-${sourceIndex}`}>
                        <a
                          href={noteHref(clusterSlug, source.slug)}
                          className="block text-sm font-medium text-gray-200 hover:text-white truncate"
                          title={source.title}
                        >
                          {source.title}
                        </a>
                        <p className="text-[11px] text-gray-600 mt-0.5">
                          {source.sourceFile || labelForType(source.type)}
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {topics.map((topic, topicIndex) => (
                            <a
                              key={`${topic.slug}-${topicIndex}`}
                              href={noteHref(clusterSlug, topic.slug)}
                              className="block border-l border-gray-800 pl-3 py-1 hover:border-gray-600 transition-colors"
                            >
                              <span className="block text-xs text-gray-300 truncate">{topic.title}</span>
                              <span className="block text-[11px] text-gray-600 truncate">
                                {topic.locations.join(', ') || `${topic.wordCount} words`}
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                    {graph.orphanTopics.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-2">Other textbook pages</p>
                        <div className="space-y-1.5">
                          {graph.orphanTopics.map((topic, topicIndex) => (
                            <a
                              key={`${topic.slug}-${topicIndex}`}
                              href={noteHref(clusterSlug, topic.slug)}
                              className="block text-xs text-gray-300 hover:text-white truncate transition-colors"
                            >
                              {topic.title}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {sourceLibrary}
        </div>
      </aside>
      ) : (
        <aside
          style={{ width: panelWidth } as CSSProperties}
          className="relative hidden lg:flex shrink-0 border-l border-gray-800 flex-col items-center bg-gray-950 py-3"
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
