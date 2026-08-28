"use client";

import { externalRunStartedAtMs } from "./external-run-clock";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import { closeAgentRunStream, resolveAgentRunStreamError } from "@/lib/agent-run-stream";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface GraphNode {
  id: string;
  label: string;
  title: string;
  category: string;
  path: string;
}

interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}

interface InvestigationStep {
  key: string;
  depth: number;
  step: number;
  objective: string;
  action: string;
  observation: string;
  elapsedSec: number;
}

interface Artifact {
  id: string;
  name: string;
  path: string;
  kind: string;
  size: number;
  preview: string;
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "trace",
  "step.completed",
  "graph.updated",
  "artifacts.updated",
  "run.completed",
  "run.failed",
  "run.aborted",
];
const TERMINAL = new Set(["completed", "failed", "aborted"]);
const GRAPH_COLORS = ["#617d5c", "#9a7f52", "#6f8187", "#8b6b72", "#738462", "#92735a"];

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatElapsed(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m ${String(rounded % 60).padStart(2, "0")}s` : `${rounded}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} kB`;
}

function categoryColor(category: string): string {
  let hash = 0;
  for (let index = 0; index < category.length; index += 1) {
    hash = (hash * 31 + category.charCodeAt(index)) >>> 0;
  }
  return GRAPH_COLORS[hash % GRAPH_COLORS.length];
}

function OpenPlanterGraph({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const positions = useMemo(() => {
    const result = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, index) => {
      const angle = index * 2.3999632297 - Math.PI / 2;
      const radius = 36 + Math.sqrt(index / Math.max(nodes.length - 1, 1)) * 92;
      result.set(node.id, {
        x: 210 + Math.cos(angle) * radius * 1.55,
        y: 135 + Math.sin(angle) * radius,
      });
    });
    return result;
  }, [nodes]);
  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  return (
    <section className="bb-agent-run-panel overflow-hidden">
      <div className="flex items-center justify-between gap-[13px] border-b border-[color-mix(in_srgb,var(--line)_55%,transparent)] px-[13px] py-[8px]">
        <p className="bb-agent-run-title">Knowledge graph</p>
        <p className="bb-agent-run-label tabular-nums">
          {nodes.length} sources · {edges.length} connections
        </p>
      </div>
      {nodes.length ? (
        <div className="grid min-h-64 grid-cols-1 sm:grid-cols-[minmax(0,1fr)_150px]">
          <svg
            className="h-64 w-full"
            viewBox="0 0 420 270"
            role="img"
            aria-label="OpenPlanter knowledge graph"
          >
            <defs>
              <filter id="openplanter-node-shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="1.5" dy="2" stdDeviation="2.5" floodColor="#4e4437" floodOpacity="0.22" />
              </filter>
            </defs>
            {edges.map((edge, index) => {
              const source = positions.get(edge.source);
              const target = positions.get(edge.target);
              if (!source || !target) return null;
              return (
                <line
                  key={`${edge.source}-${edge.target}-${index}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="rgba(91,83,68,0.24)"
                  strokeWidth="1"
                />
              );
            })}
            {nodes.map((node) => {
              const position = positions.get(node.id);
              if (!position) return null;
              const selectedNode = selectedId === node.id;
              return (
                <g
                  key={node.id}
                  transform={`translate(${position.x} ${position.y})`}
                  onClick={() => setSelectedId((current) => (current === node.id ? null : node.id))}
                  className="cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId((current) => (current === node.id ? null : node.id));
                    }
                  }}
                  aria-label={node.label}
                >
                  <circle
                    r={selectedNode ? 8.5 : 6.5}
                    fill={categoryColor(node.category)}
                    stroke={selectedNode ? "#fffdf8" : "rgba(255,255,255,0.62)"}
                    strokeWidth={selectedNode ? 3 : 1.5}
                    filter="url(#openplanter-node-shadow)"
                  />
                  <title>{`${node.label} · ${node.category}`}</title>
                </g>
              );
            })}
          </svg>
          <div className="border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] p-[13px] sm:border-l sm:border-t-0">
            {selected ? (
              <>
                <span
                  className="mb-[8px] block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: categoryColor(selected.category) }}
                />
                <p className="bb-agent-run-title">{selected.title}</p>
                <p className="bb-agent-run-label mt-[5px] break-words capitalize">
                  {selected.category.replaceAll("-", " ")}
                </p>
                <p className="bb-agent-run-readout mt-[8px] break-all">{selected.path}</p>
              </>
            ) : (
              <p className="bb-agent-run-label">
                Select a node to inspect the source represented in OpenPlanter&apos;s wiki.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-36 items-center justify-center text-[11px] text-[var(--ink-muted)]">
          Building the source map…
        </div>
      )}
    </section>
  );
}

export default function InlineOpenPlanterRun({
  runId,
  task,
  persistedContent = "",
  persistedOutcome,
  onTerminal,
  onRetry,
}: {
  runId: string;
  task: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  onTerminal?: (result: {
    outcome: ExternalAgentTerminalOutcome;
    content: string;
  }) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [steps, setSteps] = useState<InvestigationStep[]>([]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [result, setResult] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [model, setModel] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [metrics, setMetrics] = useState({
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    maxDepth: 0,
  });
  const [usageReported, setUsageReported] = useState(false);
  const [expandedArtifact, setExpandedArtifact] = useState<string | null>(null);
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(false);
  const startedRef = useRef(0);
  const base = `/api/openplanter/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedRef.current = false;
    startedRef.current = externalRunStartedAtMs(runId);
    setElapsed(Math.max(0, (Date.now() - startedRef.current) / 1_000));
  }, [runId]);

  const applyEvent = useCallback((event: RunEvent) => {
    const payload = event.payload;
    if (event.type === "run.started") {
      setStatus("running");
      if (typeof payload.model === "string") setModel(payload.model);
    }
    if (event.type === "graph.updated") {
      if (Array.isArray(payload.nodes)) setNodes(payload.nodes as unknown as GraphNode[]);
      if (Array.isArray(payload.edges)) setEdges(payload.edges as unknown as GraphEdge[]);
    }
    if (event.type === "artifacts.updated" && Array.isArray(payload.artifacts)) {
      setArtifacts(payload.artifacts as unknown as Artifact[]);
    }
    if (event.type === "step.completed") {
      const action =
        payload.action && typeof payload.action === "object"
          ? String((payload.action as { name?: unknown }).name ?? "model")
          : "model";
      setSteps((current) => [
        ...current,
        {
          key: `${event.sequenceNumber}`,
          depth: asNumber(payload.depth),
          step: asNumber(payload.step),
          objective: typeof payload.objective === "string" ? payload.objective : "",
          action,
          observation: typeof payload.observation === "string" ? payload.observation : "",
          elapsedSec: asNumber(payload.elapsedSec),
        },
      ].slice(-50));
      setMetrics({
        steps: asNumber(payload.steps),
        inputTokens: asNumber(payload.inputTokens),
        outputTokens: asNumber(payload.outputTokens),
        maxDepth: asNumber(payload.maxDepth),
      });
      if (
        typeof payload.inputTokens === "number" ||
        typeof payload.outputTokens === "number"
      ) {
        setUsageReported(true);
      }
    }
    if (event.type === "run.completed") {
      const summary =
        typeof payload.summary === "string" ? payload.summary : "OpenPlanter completed.";
      setStatus("completed");
      setResult(summary);
      setElapsed(asNumber(payload.elapsedSec));
      if (Array.isArray(payload.artifacts)) {
        setArtifacts(payload.artifacts as unknown as Artifact[]);
      }
      setMetrics({
        steps: asNumber(payload.steps),
        inputTokens: asNumber(payload.inputTokens),
        outputTokens: asNumber(payload.outputTokens),
        maxDepth: asNumber(payload.maxDepth),
      });
      if (
        typeof payload.inputTokens === "number" ||
        typeof payload.outputTokens === "number"
      ) {
        setUsageReported(true);
      }
      if (!reportedRef.current) {
        reportedRef.current = true;
        notifyTaskCompleted(task);
        onTerminalRef.current?.({ outcome: "completed", content: summary });
      }
    }
    if (event.type === "run.failed" || event.type === "run.aborted") {
      const outcome = event.type === "run.aborted" ? "aborted" : "failed";
      const message =
        typeof payload.summary === "string"
          ? payload.summary
          : typeof payload.error === "string"
            ? payload.error
            : outcome === "aborted"
              ? "OpenPlanter investigation stopped."
              : "OpenPlanter could not complete the investigation.";
      setStatus(outcome);
      setFailure(message);
      if (!reportedRef.current) {
        reportedRef.current = true;
        onTerminalRef.current?.({ outcome, content: message });
      }
    }
  }, [task]);

  useEffect(() => {
    if (persistedOutcome && persistedOutcome !== "running" && persistedContent) return;
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        // Ignore malformed event frames and keep the remaining stream usable.
      }
    };
    STREAMED_EVENT_TYPES.forEach((type) =>
      source.addEventListener(type, handle as EventListener),
    );
    source.onerror = () => {
      resolveAgentRunStreamError({
        source,
        base,
        replayEnding: applyEvent,
        onUnavailable: (reason) => {
          setStatus("failed");
          setFailure(
            reason === "run_not_found"
              ? "This OpenPlanter run is no longer live, but its saved result remains below."
              : "The OpenPlanter event stream is unavailable.",
          );
        },
      });
    };
    return () => closeAgentRunStream(source);
  }, [applyEvent, base, persistedContent, persistedOutcome]);

  useEffect(() => {
    if (TERMINAL.has(status)) return;
    const timer = window.setInterval(
      () => setElapsed((Date.now() - startedRef.current) / 1000),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [status]);

  const stop = () => {
    void fetch(`${base}/abort`, { method: "POST" }).catch(() => undefined);
  };
  const terminal = TERMINAL.has(status);
  const metricsRows = [
    ["Steps", metrics.steps],
    ["Depth", metrics.maxDepth],
    ["Input", metrics.inputTokens.toLocaleString()],
    ["Output", metrics.outputTokens.toLocaleString()],
  ];
  const terminalContent =
    result.trim() ||
    failure.trim() ||
    (status === "aborted"
      ? "OpenPlanter investigation stopped."
      : status === "failed"
        ? "OpenPlanter could not complete the investigation."
        : "OpenPlanter completed the investigation.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        totalTokens={
          usageReported ? metrics.inputTokens + metrics.outputTokens : undefined
        }
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={steps.at(-1)?.observation}
        agentName="OpenPlanter"
      />
      <div className="bb-agent-run-card overflow-hidden">
      {/* The task is the user's own message directly above this card, so the
          header carries the agent, its model, and the state of the run. */}
      <header className="bb-agent-run-header">
        <p className="bb-agent-run-title min-w-0 truncate">
          OpenPlanter
          {model ? (
            <span className="ml-[8px] font-mono text-[11px] font-normal text-[var(--ink-muted)]">
              {model}
            </span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-[8px]">
          <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
            <span
              className={`bb-agent-run-led h-1.5 w-1.5 ${
                status === "completed"
                  ? "bg-[var(--botanical)]"
                  : terminal
                    ? "bg-[var(--danger)]"
                    : "animate-pulse bg-[var(--botanical-2)]"
              }`}
            />
            {terminal ? status : `investigating · ${formatElapsed(elapsed)}`}
          </span>
          {!terminal ? (
            <button type="button" onClick={stop} className="bb-agent-run-action">
              Stop
            </button>
          ) : null}
        </div>
      </header>

      <div className="space-y-[13px] p-[21px]">
      {/* What the investigation has cost and covered so far. */}
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(89px,1fr))] gap-x-[21px] gap-y-[13px]">
        {metricsRows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="bb-agent-run-label">{label}</dt>
            <dd className="text-[13px] font-medium leading-[1.4] tabular-nums text-[var(--ink-heading)]">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <OpenPlanterGraph nodes={nodes} edges={edges} />

      <div className="grid gap-[13px] lg:grid-cols-[1.618fr_1fr]">
        <section>
          <p className="bb-agent-run-label mb-[8px]">
            Investigation trail{steps.length ? ` · ${steps.length}` : ""}
          </p>
          {steps.length ? (
            <ol className="max-h-64 space-y-[5px] overflow-y-auto pr-1">
              {steps.map((step) => (
                <li
                  key={step.key}
                  className="bb-agent-run-row p-[8px]"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] tabular-nums text-[var(--botanical)]">
                      D{step.depth}
                    </span>
                    <span className="truncate font-mono text-[11px] text-[var(--ink-heading)]">
                      {step.action === "_model_turn" ? "model turn" : step.action}
                    </span>
                    <span className="ml-auto text-[11px] tabular-nums text-[var(--ink-muted)]">
                      {formatElapsed(step.elapsedSec)}
                    </span>
                  </div>
                  {step.observation ? (
                    <p className="bb-agent-run-text mt-[5px] line-clamp-2 text-[var(--ink-muted)]">
                      {step.observation}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="bb-agent-run-label">
              The first structured step will appear here.
            </p>
          )}
        </section>

        <section>
          <p className="bb-agent-run-label mb-[8px]">
            Outputs{artifacts.length ? ` · ${artifacts.length}` : ""}
          </p>
          {artifacts.length ? (
            <ul className="max-h-64 space-y-[8px] overflow-y-auto pr-1">
              {artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedArtifact((current) => (current === artifact.id ? null : artifact.id))
                    }
                    className="bb-agent-run-row flex w-full items-center gap-[8px] p-[8px] text-left transition-colors hover:text-[var(--ink-heading)]"
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--ink-heading)]">
                      {artifact.name}
                    </span>
                    <span className="text-[11px] tabular-nums text-[var(--ink-muted)]">
                      {formatBytes(artifact.size)}
                    </span>
                  </button>
                  {expandedArtifact === artifact.id ? (
                    <div className="mt-[5px] px-[8px]">
                      <pre className="bb-agent-run-readout max-h-32 overflow-auto whitespace-pre-wrap">
                        {artifact.preview}
                      </pre>
                      <a
                        href={`${base}/artifacts/${encodeURIComponent(artifact.id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-[8px] inline-block text-[11px] text-[var(--botanical)] hover:underline"
                      >
                        Open full output
                      </a>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="bb-agent-run-label">
              Generated reports and patches will appear here.
            </p>
          )}
        </section>
      </div>

      {/* The result needs no "Investigation result" caption: it is the last
          thing in a card whose header already says what ran. */}
      {result ? (
        <section className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
          <ChatMarkdown content={result} compact />
        </section>
      ) : failure ? (
        <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p>
      ) : terminal ? (
        <p className="bb-agent-run-text text-[var(--ink-muted)]">{terminalContent}</p>
      ) : null}
      </div>
      </div>
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
