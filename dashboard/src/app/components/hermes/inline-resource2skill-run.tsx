"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type { ExternalAgentOutcome, ExternalAgentTerminalResult } from "@/lib/conversations/external-agent-runs";
import type { ChatTokenUsage } from "@/lib/chat-token-usage";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent { sequenceNumber: number; type: string; payload: Record<string, unknown>; }
interface Artifact { id: string; relativePath: string; name: string; kind: string; size: number; }

const EVENTS = ["run.started", "stage.changed", "model.call", "tool.started", "tool.completed", "log", "artifacts.updated", "run.completed", "run.failed", "run.aborted"];
const TERMINAL = new Set(["completed", "failed", "aborted"]);

function text(value: unknown, fallback = "") { return typeof value === "string" ? value : fallback; }
function artifacts(value: unknown): Artifact[] { return Array.isArray(value) ? (value as Artifact[]).filter((item) => item?.id) : []; }
function size(bytes: number) { return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1_000))} kB` : `${(bytes / 1_000_000).toFixed(1)} MB`; }

export default function InlineResource2SkillRun({
  runId,
  brief,
  persistedContent = "",
  persistedOutcome,
  persistedUsage,
  onTerminal,
  onRetry,
}: {
  runId: string;
  brief: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  persistedUsage?: ChatTokenUsage;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting");
  const [stage, setStage] = useState("preparing");
  const [domain, setDomain] = useState("");
  const [outputs, setOutputs] = useState<Artifact[]>([]);
  const [activity, setActivity] = useState<string[]>([]);
  const [result, setResult] = useState(persistedOutcome === "completed" ? persistedContent : "");
  const [failure, setFailure] = useState(persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "");
  const reported = useRef(false);
  const terminalRef = useRef(onTerminal);
  const base = `/api/resource2skill/runs/${runId}`;
  const replaying = Boolean(persistedOutcome && persistedOutcome !== "running" && persistedContent);

  useEffect(() => { terminalRef.current = onTerminal; }, [onTerminal]);
  useEffect(() => { reported.current = false; }, [runId]);
  const report = useCallback((outcome: "completed" | "failed" | "aborted", content: string) => {
    if (reported.current) return;
    reported.current = true;
    if (outcome === "completed") notifyTaskCompleted(`Resource2Skill — ${brief.slice(0, 80)}`);
    terminalRef.current?.({ outcome, content });
  }, [brief]);

  const applyEvent = useCallback((event: RunEvent) => {
    const payload = event.payload;
    if (event.type === "run.started") {
      setStatus("running"); setDomain(text(payload.domain)); setStage("planning");
    } else if (event.type === "stage.changed") {
      setStage(text(payload.stage, "building"));
    } else if (event.type === "tool.started") {
      setActivity((items) => [...items, `Running ${text(payload.tool, "tool")}`].slice(-12));
    } else if (event.type === "tool.completed") {
      setActivity((items) => [...items, `${text(payload.tool, "tool")} · ${text(payload.status, "completed")}`].slice(-12));
    } else if (event.type === "artifacts.updated") {
      setOutputs(artifacts(payload.artifacts));
    } else if (event.type === "run.completed") {
      const summary = text(payload.summary, "Resource2Skill completed the artifact.");
      setStatus("completed"); setResult(summary); setOutputs(artifacts(payload.artifacts)); report("completed", summary);
    } else if (event.type === "run.failed" || event.type === "run.aborted") {
      const outcome = event.type === "run.aborted" ? "aborted" : "failed";
      const message = text(payload.summary) || text(payload.error) || "Resource2Skill could not complete this run.";
      setStatus(outcome); setFailure(message); setOutputs(artifacts(payload.artifacts)); report(outcome, message);
    }
  }, [report]);

  useEffect(() => {
    if (replaying) return;
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => { try { applyEvent(JSON.parse(message.data) as RunEvent); } catch { /* malformed frame */ } };
    EVENTS.forEach((type) => source.addEventListener(type, handle as EventListener));
    source.onerror = () => source.close();
    return () => source.close();
  }, [applyEvent, base, replaying]);

  useEffect(() => {
    if (!replaying) return;
    void fetch(`${base}/artifacts`).then((response) => response.ok ? response.json() : null).then((data: { artifacts?: unknown } | null) => {
      if (data) setOutputs(artifacts(data.artifacts));
    }).catch(() => undefined);
  }, [base, replaying]);

  const terminal = TERMINAL.has(status);
  const primary = useMemo(() => outputs.find((item) => ["presentation", "spreadsheet", "scene", "audio", "web"].includes(item.kind)) ?? outputs[0], [outputs]);
  const terminalContent = result || failure || "Resource2Skill finished.";
  return (
    <>
      <AssistantResponseMeta active={!terminal} failed={terminal && status !== "completed"} agentName="Resource2Skill" usage={persistedUsage} summary={activity.at(-1)} />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title">Resource2Skill {domain ? <span className="ml-2 font-mono text-[11px] font-normal text-[var(--ink-muted)]">{domain}</span> : null}</p>
          <div className="flex items-center gap-2">
            <span className="bb-agent-run-label capitalize"><span className={`bb-agent-run-led mr-1.5 inline-block h-1.5 w-1.5 ${status === "completed" ? "bg-[var(--botanical)]" : terminal ? "bg-[var(--danger)]" : "animate-pulse bg-[var(--botanical-2)]"}`} />{terminal ? status : stage}</span>
            {!terminal ? <button type="button" className="bb-agent-run-action" onClick={() => void fetch(`${base}/abort`, { method: "POST" })}>Stop</button> : null}
          </div>
        </header>
        <div className="space-y-[13px] p-[21px]">
          {!terminal && activity.length ? <p className="bb-agent-run-text text-[var(--ink-muted)]">{activity.at(-1)}</p> : null}
          {primary ? <a className="bb-agent-run-panel flex items-center justify-between gap-3 p-[13px] hover:text-[var(--botanical)]" href={`${base}/artifacts/${encodeURIComponent(primary.id)}?download=1`} download={primary.name}><span className="min-w-0 truncate font-mono text-[12px]">{primary.relativePath}</span><span className="shrink-0 text-[11px] text-[var(--ink-muted)]">{size(primary.size)} · Download</span></a> : null}
          {outputs.length > 1 ? <ul className="grid gap-1 sm:grid-cols-2">{outputs.filter((item) => item.id !== primary?.id).slice(0, 12).map((item) => <li key={item.id}><a className="bb-agent-run-row flex items-center justify-between gap-2 p-2" href={`${base}/artifacts/${encodeURIComponent(item.id)}?download=1`}><span className="truncate font-mono text-[11px]">{item.relativePath}</span><span className="text-[10px] text-[var(--ink-muted)]">{size(item.size)}</span></a></li>)}</ul> : null}
          {result ? <section className="bb-agent-run-text border-t border-[var(--line)] pt-[13px]"><ChatMarkdown content={result} compact /></section> : failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}
        </div>
      </div>
      {terminal ? <AssistantMessageActions content={terminalContent} onRetry={onRetry} /> : null}
    </>
  );
}
