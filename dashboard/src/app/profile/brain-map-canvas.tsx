"use client";

import { useSurfaceTheme } from "../components/effects/use-surface-theme";
import KnowledgeIcon from "../components/knowledge-icon";
import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";

import {
  filterTopologyPayload,
  projectBrainGraphToQuartzTopology,
  shortestTopologyPath,
} from "@/lib/quartz-brain-graph/topology-adapter.ts";
import type {
  BrainGraphResponse,
  BrainScopeOption,
} from "@/lib/profile/brain-graph-types.ts";
import {
  renderThoughtTopology,
  type D3Config,
  type FullSlug,
} from "@/vendor/quartz-thought-topology/renderer.ts";

const QUARTZ_HOME_GRAPH: D3Config = {
  mode: "thought-topology",
  drag: true,
  zoom: true,
  depth: -1,
  scope: "all",
  clickToNavigate: true,
  scale: 0.82,
  repelForce: 2.8,
  centerForce: 0.035,
  linkDistance: 175,
  fontSize: 0.82,
  opacityScale: 1,
  removeTags: [],
  showTags: true,
  focusOnHover: true,
  enableRadial: false,
};

type PageOption = { id: string; label: string; title: string; garden: string; href?: string; topic?: string };

export default function BrainMapCanvas({
  graph,
  scopeKey,
  scopeOptions,
  loading,
  onScopeChange,
  onOpen,
  onFailure,
}: {
  graph: BrainGraphResponse;
  scopeKey: string;
  scopeOptions: BrainScopeOption[];
  loading: boolean;
  onScopeChange: (scope: string) => void;
  onOpen: (href: string) => void;
  onFailure: () => void;
}) {
  const surfaceTheme = useSurfaceTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [topicFilter, setTopicFilter] = useState<number | null>(null);
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [path, setPath] = useState<string[] | null>(null);
  const [pathMessage, setPathMessage] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const latestCallbacksRef = useRef({ onOpen, onFailure });
  const projection = useMemo(() => projectBrainGraphToQuartzTopology(graph), [graph]);

  // Topic chips, in the renderer's color order.
  const topics = useMemo(() => {
    const byIndex = new Map<number, { index: number; label: string; count: number }>();
    for (const node of projection.payload.nodes) {
      if (!node.topic) continue;
      const entry = byIndex.get(node.topic.index) ?? { ...node.topic, count: 0 };
      entry.count += 1;
      byIndex.set(node.topic.index, entry);
    }
    return [...byIndex.values()].sort((left, right) => left.index - right.index);
  }, [projection]);

  // Every page, named "Title (Garden)" so equal titles in two Gardens stay apart.
  const pages = useMemo(() => {
    const gardenTitle = new Map(
      graph.nodes.filter((node) => node.kind === "garden").map((node) => [node.gardenSlug, node.label]),
    );
    const brainById = new Map(graph.nodes.map((node) => [node.id, node]));
    const seen = new Map<string, number>();
    return projection.payload.nodes
      .map((node): PageOption => {
        const brain = brainById.get(node.id);
        const garden = gardenTitle.get(brain?.gardenSlug) ?? "Garden";
        const base = `${node.title} (${garden})`;
        const repeat = (seen.get(base) ?? 0) + 1;
        seen.set(base, repeat);
        return {
          id: node.id,
          label: repeat === 1 ? base : `${base} ${repeat}`,
          title: node.title,
          garden,
          href: brain?.href,
          topic: node.topic?.label,
        };
      })
      .sort((left, right) => left.garden.localeCompare(right.garden) || left.title.localeCompare(right.title));
  }, [graph, projection]);
  const pageById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);

  // The canvas shows the found path, else the chosen topic, else everything.
  const view = useMemo(() => {
    if (path) return { ...filterTopologyPayload(projection.payload, new Set(path)), isPagePath: true };
    if (topicFilter === null) return projection.payload;
    return filterTopologyPayload(
      projection.payload,
      new Set(projection.payload.nodes.filter((node) => node.topic?.index === topicFilter).map((node) => node.id)),
    );
  }, [path, projection, topicFilter]);

  useEffect(() => {
    latestCallbacksRef.current = { onOpen, onFailure };
  }, [onFailure, onOpen]);

  // A new graph (scope change, refresh) can drop a page the path ran through.
  useEffect(() => {
    setPath(null);
    setPathMessage(null);
  }, [projection]);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [expanded]);

  useEffect(() => {
    const host = hostRef.current;
    if (!surfaceTheme || !host || projection.gardenCount === 0) return;
    let disposed = false;
    let destroy: (() => void) | undefined;

    void renderThoughtTopology(
      host,
      "profile" as FullSlug,
      QUARTZ_HOME_GRAPH,
      view,
      {
        scopeCluster: view.garden.slug,
        scopeFolderPath: null,
        configuredDepth: -1,
        onNavigate: (nodeId) => {
          const href = projection.hrefByNodeId.get(nodeId);
          if (href) latestCallbacksRef.current.onOpen(href);
        },
      },
    )
      .then((cleanup) => {
        if (disposed) cleanup();
        else destroy = cleanup;
      })
      .catch(() => {
        if (!disposed) latestCallbacksRef.current.onFailure();
      });

    return () => {
      disposed = true;
      destroy?.();
    };
  }, [projection, view, surfaceTheme]);

  const findPath = (event: FormEvent) => {
    event.preventDefault();
    const byLabel = new Map(pages.map((page) => [page.label, page.id]));
    const from = byLabel.get(pathFrom.trim());
    const to = byLabel.get(pathTo.trim());
    if (!from || !to) {
      setPath(null);
      setPathMessage("Pick both pages from the list.");
      return;
    }
    const found = shortestTopologyPath(projection.payload.edges.filter(edge =>
      pageById.has(edge.source) && pageById.has(edge.target)), from, to);
    setPath(found);
    setPathMessage(found ? null : "These pages are not connected, even through other pages.");
  };

  const clearPath = () => {
    setPath(null);
    setPathMessage(null);
  };

  const openLink = (href: string | undefined) => (event: MouseEvent) => {
    if (!href) return;
    event.preventDefault();
    onOpen(href);
  };

  return (
    <section
      aria-label="Private Thought Topology"
      className="graph home-knowledge-graph profile-quartz-topology"
      data-active-mode="thought-topology"
    >
      <div className="thought-topology-meta">
        <div className="thought-topology-heading">
          <h2>Thought Topology</h2>
          <p className="thought-topology-analysis" hidden />
        </div>
        <label className="profile-quartz-topology-scope">
          <span className="sr-only">Thought Topology scope</span>
          <select
            aria-label="Thought Topology scope"
            value={scopeKey}
            onChange={(event) => onScopeChange(event.target.value)}
          >
            {scopeOptions.map((option) => (
              <option key={option.id} value={option.organizationId ?? option.id}>
                {option.kind === "all" ? "Knowledge" : option.label}
              </option>
            ))}
          </select>
        </label>
        {graph.warnings.length > 0 && (
          <details className="profile-quartz-topology-warnings">
            <summary>Garden status ({graph.warnings.length})</summary>
            {graph.warnings.map((warning) => (
              <p key={`${warning.source}:${warning.code}:${warning.message}`}>{warning.message}</p>
            ))}
          </details>
        )}
        {loading && <p className="profile-quartz-topology-refresh">Updating Thought Topology…</p>}
      </div>

      {(topics.length > 0 || pages.length > 1) && <details className="knowledge-map-explore">
        <summary>Topics and paths{topicFilter !== null ? " · Topic selected" : path ? " · Path selected" : ""}</summary>
      {topics.length > 0 && (
        <div className="profile-quartz-topology-topics" role="group" aria-label="Topics">
          <button
            type="button"
            aria-pressed={topicFilter === null}
            onClick={() => { setTopicFilter(null); clearPath(); }}
          >
            All topics
          </button>
          {topics.map((topic) => (
            <button
              key={topic.index}
              type="button"
              aria-pressed={topicFilter === topic.index}
              onClick={() => { setTopicFilter(topicFilter === topic.index ? null : topic.index); clearPath(); }}
            >
              <span
                className="profile-quartz-topology-swatch"
                style={{ background: `var(--topology-topic-${topic.index})` }}
                aria-hidden="true"
              />
              {topic.label}
              <span className="profile-quartz-topology-count">{topic.count}</span>
            </button>
          ))}
        </div>
      )}

      {pages.length > 1 && (
        <form className="profile-quartz-topology-path" onSubmit={findPath} aria-label="Find a path between two pages">
          <datalist id="knowledge-pages">
            {pages.map((page) => <option key={page.id} value={page.label} />)}
          </datalist>
          <input
            list="knowledge-pages"
            value={pathFrom}
            onChange={(event) => setPathFrom(event.target.value)}
            placeholder="From page"
            aria-label="Path from page"
          />
          <input
            list="knowledge-pages"
            value={pathTo}
            onChange={(event) => setPathTo(event.target.value)}
            placeholder="To page"
            aria-label="Path to page"
          />
          <button type="submit">Find path</button>
          {(path || pathMessage) && <button type="button" onClick={clearPath}>Show whole map</button>}
          {pathMessage && <p role="status">{pathMessage}</p>}
          {path && (
            <ol aria-label="Path">
              {path.map((id) => {
                const page = pageById.get(id);
                return (
                  <li key={id}>
                    <a href={page?.href} onClick={openLink(page?.href)}>{page?.title ?? id}</a>
                  </li>
                );
              })}
            </ol>
          )}
        </form>
      )}

      </details>}

      <div className="graph-outer" data-expanded={expanded ? "true" : undefined}>
        {projection.gardenCount > 0 ? (
          <div
            ref={hostRef}
            className="graph-container"
            data-active-mode="thought-topology"
            aria-label={`Interactive Thought Topology with ${projection.gardenCount} gardens, ${view.nodes.length} pages, and ${view.edges.length} weighted relationships. The page list below the map has the same pages.`}
            role="img"
          />
        ) : (
          <div className="profile-quartz-topology-empty">
            <p>Your accessible Thought Topology is empty.</p>
            <span>Create a Garden to add the first connection.</span>
          </div>
        )}
        {projection.gardenCount > 0 && (
          <button
            type="button"
            className={expanded ? "global-graph-close" : "global-graph-icon"}
            aria-label={expanded ? "Close Graph" : "Expand Graph"}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <CloseGraphIcon /> : <KnowledgeIcon />}
          </button>
        )}
        <div className="thought-callout" role="status" aria-live="polite" aria-hidden="true" />
      </div>

      {pages.length > 0 && (
        <details
          className="profile-quartz-topology-list"
          onToggle={(event) => setListOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>Browse all {pages.length} pages as a list</summary>
          {/* Rendered only while open: a large map lists thousands of pages. */}
          {listOpen && <PageList pages={pages} openLink={openLink} />}
        </details>
      )}
    </section>
  );
}

function PageList({
  pages,
  openLink,
}: {
  pages: PageOption[];
  openLink: (href: string | undefined) => (event: MouseEvent) => void;
}) {
  const byGarden = new Map<string, PageOption[]>();
  for (const page of pages) {
    const list = byGarden.get(page.garden);
    if (list) list.push(page);
    else byGarden.set(page.garden, [page]);
  }
  return (
    <div>
      {[...byGarden].map(([garden, entries]) => (
        <section key={garden} aria-label={garden}>
          <h3>{garden}</h3>
          <ul>
            {entries.map((page) => (
              <li key={page.id}>
                <a href={page.href} onClick={openLink(page.href)}>{page.title}</a>
                {page.topic && <span>{page.topic}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CloseGraphIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
