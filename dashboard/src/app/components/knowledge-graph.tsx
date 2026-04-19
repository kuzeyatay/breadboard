'use client';

import {
  memo,
  useEffect,
  useMemo,
  useState,
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
    generatedNotes: number;
    links: number;
    words: number;
  };
}

interface Props {
  clusterSlug: string;
  refreshKey: string;
}

const emptyResponse: GraphResponse = {
  nodes: [],
  edges: [],
  tree: [],
  orphanTopics: [],
  stats: { documents: 0, topics: 0, generatedNotes: 0, links: 0, words: 0 },
};

function labelForType(type: string): string {
  if (type === 'source-document') return 'Source';
  if (type === 'knowledge-topic') return 'Topic';
  if (type === 'generated-note') return 'Chat note';
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

function KnowledgeGraph({ clusterSlug, refreshKey }: Props) {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const graph = data ?? emptyResponse;
  const loading = data === null;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/knowledge-graph?clusterSlug=${encodeURIComponent(clusterSlug)}`)
      .then((r) => (r.ok ? r.json() : emptyResponse))
      .then((g: GraphResponse) => { if (!cancelled) setData(g); })
      .catch(() => { if (!cancelled) setData(emptyResponse); });
    return () => { cancelled = true; };
  }, [clusterSlug, refreshKey]);

  const quartzPreviewUrl = useMemo(
    () => quartzMapPreviewUrl(clusterSlug, refreshKey),
    [clusterSlug, refreshKey],
  );

  return (
    <>
      {sidebarOpen ? (
      <aside className="hidden xl:flex w-96 shrink-0 border-l border-gray-800 flex-col bg-gray-950">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Knowledge map
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
              <button
                onClick={() => setSidebarOpen(false)}
                title="Close map panel"
                className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5M3.75 12h16.5M3.75 18.75h16.5M15.75 8.25 19.5 12l-3.75 3.75" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="px-4 pt-3 pb-1 border-b border-gray-800 shrink-0">
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { value: graph.stats.documents, label: 'Sources' },
              { value: graph.stats.topics, label: 'Topics' },
              { value: graph.stats.generatedNotes, label: 'Notes' },
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
            ) : (
              <>
                <iframe
                  src={quartzPreviewUrl}
                  title="Quartz knowledge map preview"
                  className="pointer-events-none h-full w-full border-0 bg-gray-950"
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <a
                  href={graphHref(clusterSlug)}
                  className="absolute inset-0 bg-gray-950/10 transition-colors group-hover:bg-gray-950/0"
                  aria-label="Open Quartz knowledge map"
                >
                  <span className="absolute bottom-2 right-2 rounded-md border border-gray-700 bg-gray-950/85 px-2 py-1 text-[11px] font-medium text-gray-300 shadow-sm transition-colors group-hover:text-white">
                    Open Quartz
                  </span>
                </a>
              </>
            )}
          </div>
        </div>

        {/* Source tree */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Source tree
          </h3>
          {graph.tree.length === 0 && graph.orphanTopics.length === 0 ? (
            <p className="text-xs text-gray-600">No extracted topics yet.</p>
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
                  <p className="text-xs font-medium text-gray-500 mb-2">Standalone notes</p>
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
      </aside>
      ) : (
        <aside className="hidden xl:flex w-12 shrink-0 border-l border-gray-800 flex-col items-center bg-gray-950 py-3">
          <button
            onClick={() => setSidebarOpen(true)}
            title="Open map panel"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-800 text-gray-500 hover:border-gray-700 hover:bg-gray-900 hover:text-white transition-colors"
            aria-label="Open map panel"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5M3.75 12h16.5M3.75 18.75h16.5M15.75 8.25 19.5 12l-3.75 3.75" />
            </svg>
          </button>
        </aside>
      )}
    </>
  );
}

export default memo(KnowledgeGraph);
