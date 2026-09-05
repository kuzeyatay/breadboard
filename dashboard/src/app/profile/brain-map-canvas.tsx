"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { projectBrainGraphToQuartzTopology } from "@/lib/quartz-brain-graph/topology-adapter.ts";
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const latestCallbacksRef = useRef({ onOpen, onFailure });
  const projection = useMemo(() => projectBrainGraphToQuartzTopology(graph), [graph]);

  useEffect(() => {
    latestCallbacksRef.current = { onOpen, onFailure };
  }, [onFailure, onOpen]);

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
    if (!host || projection.gardenCount === 0) return;
    let disposed = false;
    let destroy: (() => void) | undefined;

    void renderThoughtTopology(
      host,
      "profile" as FullSlug,
      QUARTZ_HOME_GRAPH,
      projection.payload,
      {
        scopeCluster: projection.payload.garden.slug,
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
  }, [projection]);

  return (
    <section
      aria-label="Private Thought Topology"
      className="graph home-knowledge-graph profile-quartz-topology"
      data-active-mode="thought-topology"
    >
      <div className="thought-topology-meta">
        <div className="thought-topology-heading">
          <h2>Thought Topology</h2>
          <p>How the ideas in your gardens are organized and connected.</p>
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
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {graph.warnings.length > 0 && (
          <div className="profile-quartz-topology-warnings" role="status">
            {graph.warnings.map((warning) => (
              <p key={`${warning.source}:${warning.code}:${warning.message}`}>{warning.message}</p>
            ))}
          </div>
        )}
        {loading && <p className="profile-quartz-topology-refresh">Updating Thought Topology…</p>}
      </div>

      <div className="graph-outer" data-expanded={expanded ? "true" : undefined}>
        {projection.gardenCount > 0 ? (
          <div
            ref={hostRef}
            className="graph-container"
            data-active-mode="thought-topology"
            aria-label={`Interactive Thought Topology with ${projection.gardenCount} gardens, ${projection.payload.nodes.length} pages, and ${projection.payload.edges.length} weighted relationships`}
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
            {expanded ? <CloseGraphIcon /> : <ExpandGraphIcon />}
          </button>
        )}
        <div className="thought-callout" role="status" aria-live="polite" aria-hidden="true" />
      </div>
    </section>
  );
}

function ExpandGraphIcon() {
  return (
    <svg viewBox="0 0 55 55" fill="currentColor" aria-hidden="true">
      <path d="M49,0c-3.309,0-6,2.691-6,6c0,1.035.263,2.009.726,2.86l-9.829,9.829C32.542,17.634,30.846,17,29,17s-3.542.634-4.898,1.688l-7.669-7.669C16.785,10.424,17,9.74,17,9c0-2.206-1.794-4-4-4S9,6.794,9,9s1.794,4,4,4c.74,0,1.424-.215,2.019-.567l7.669,7.669C21.634,21.458,21,23.154,21,25s.634,3.542,1.688,4.897L10.024,42.562C8.958,41.595,7.549,41,6,41c-3.309,0-6,2.691-6,6s2.691,6,6,6s6-2.691,6-6c0-1.035-.263-2.009-.726-2.86l12.829-12.829c1.106.86,2.44,1.436,3.898,1.619v10.16c-2.833.478-5,2.942-5,5.91c0,3.309,2.691,6,6,6s6-2.691,6-6c0-2.967-2.167-5.431-5-5.91v-10.16c1.458-.183,2.792-.759,3.898-1.619l7.669,7.669C41.215,39.576,41,40.26,41,41c0,2.206,1.794,4,4,4s4-1.794,4-4s-1.794-4-4-4c-.74,0-1.424.215-2.019.567l-7.669-7.669C36.366,28.542,37,26.846,37,25s-.634-3.542-1.688-4.897l9.665-9.665C46.042,11.405,47.451,12,49,12c3.309,0,6-2.691,6-6S52.309,0,49,0ZM11,9c0-1.103.897-2,2-2s2,.897,2,2s-.897,2-2,2S11,10.103,11,9ZM6,51c-2.206,0-4-1.794-4-4s1.794-4,4-4s4,1.794,4,4S8.206,51,6,51Zm27-2c0,2.206-1.794,4-4,4s-4-1.794-4-4s1.794-4,4-4S33,46.794,33,49Zm-4-18c-3.309,0-6-2.691-6-6s2.691-6,6-6s6,2.691,6,6S32.309,31,29,31Zm18,10c0,1.103-.897,2-2,2s-2-.897-2-2s.897-2,2-2S47,39.897,47,41Zm2-31c-2.206,0-4-1.794-4-4s1.794-4,4-4s4,1.794,4,4S51.206,10,49,10Z" />
    </svg>
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
