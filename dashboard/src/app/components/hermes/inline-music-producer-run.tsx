"use client";
import { useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import type { ExternalAgentOutcome, ExternalAgentTerminalOutcome } from "@/lib/conversations/external-agent-runs";
import AgentSettingsDialog from "./agent-settings-dialog";
import { MUSIC_PRODUCER_AGENT_ID } from "@/lib/music-producer/identity";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import ArtifactViewer from "./artifact-viewer";
import { dispatchArtifactAiEdit } from "./artifact-ai-edit";
export default function InlineMusicProducerRun({ runId, task, persistedContent = "", persistedOutcome, onTerminal, onRetry }: {
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
  const [liveContent, setContent] = useState(persistedContent);
  const [liveStatus, setStatus] = useState<ExternalAgentOutcome>(persistedOutcome ?? "running");
  const restoredTerminal = Boolean(persistedOutcome && persistedOutcome !== "running");
  const content = restoredTerminal ? persistedContent : liveContent;
  const status = restoredTerminal ? persistedOutcome! : liveStatus;
  const [stage, setStage] = useState("Waiting for resources");
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(false);
  const [reconnect, setReconnect] = useState(0);
  const [artifact, setArtifact] = useState<PresentedArtifact | null>(null);
  const [versions, setVersions] = useState<number[]>([]), [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [viewer, setViewer] = useState(false);
  const audio = /\[Music · version (\d+)\]\((\/api\/hermes\/artifacts\/([A-Za-z0-9_-]+)\/preview\?[^)]+)\)/.exec(content);
  const audioUrl = audio?.[2] ?? "", artifactId = audio?.[3] ?? "", originalVersion = Number(audio?.[1] ?? 0);
  useEffect(() => {
    if (!artifactId || !audioUrl)
      return;
    const controller = new AbortController();
    const query = new URL(audioUrl, window.location.origin).search;
    void Promise.all([
      fetch(`/api/hermes/artifacts/${artifactId}${query}`, { signal: controller.signal }).then(response => {
        if (!response.ok)
          throw Error();
        return response.json();
      }),
      fetch(`/api/hermes/artifacts/${artifactId}/versions${query}`, { signal: controller.signal }).then(response => {
        if (!response.ok)
          throw Error();
        return response.json();
      }),
    ]).then(([detail, history]) => {
      setArtifact(detail.artifact);
      setVersions(history.versions.filter((value: {
        downloadAvailable: boolean;
      }) => value.downloadAvailable).map((value: {
        version: number;
      }) => value.version));
    }).catch(() => { });
    return () => controller.abort();
  }, [artifactId, audioUrl]);
  const cursor = useRef(0), reported = useRef(false), terminal = useRef(onTerminal);
  useEffect(() => { terminal.current = onTerminal; }, [onTerminal]);
  useEffect(() => {
    if (persistedOutcome && persistedOutcome !== "running")
      return;
    if (status !== "running")
      return;
    const source = new EventSource(`/api/music-producer/runs/${encodeURIComponent(runId)}/events?since=${cursor.current}`);
    source.onerror = () => { source.close(); setError("Connection interrupted. Reconnect to check this run without generating again."); };
    const receive = (message: MessageEvent<string>) => {
      if (reported.current)
        return;
      try {
        const event = JSON.parse(message.data) as {
          sequenceNumber: number;
          type: string;
          payload: Record<string, unknown>;
        };
        if (event.sequenceNumber <= cursor.current)
          return;
        cursor.current = event.sequenceNumber;
        if (event.type === "music.stage" && typeof event.payload.message === "string")
          setStage(event.payload.message);
        if (event.type === "music.plan") {
          const request = event.payload.request as {
            duration?: number;
            operation?: string;
          } | undefined;
          if (request?.duration)
            setStage(`Planned one ${request.duration}-second ${request.operation ?? "draft"}`);
        }
        if (["run.completed", "run.failed", "run.aborted"].includes(event.type)) {
          source.close();
          const outcome = event.type.slice(4) as ExternalAgentTerminalOutcome;
          const summary = String(event.payload.summary ?? event.payload.error ?? "Music run ended.");
          setContent(summary);
          setStatus(outcome);
          setError("");
          if (!reported.current) {
            reported.current = true;
            terminal.current?.({ outcome, content: summary });
            if (outcome === "completed")
              notifyTaskCompleted(task);
          }
        }
      }
      catch {
        source.close();
        setError("Could not read the run event. Reconnect to check its status.");
      }
    };
    for (const name of ["music.stage", "music.plan", "music.receipt", "run.completed", "run.failed", "run.aborted"])
      source.addEventListener(name, receive as EventListener);
    return () => source.close();
  }, [persistedOutcome, reconnect, runId, status, task]);
  const version = selectedVersion ?? originalVersion;
  const preview = audioUrl.replace(/([?&])version=\d+/, `$1version=${version}`);
  const revise = (instruction: string) => {
    if (artifact)
      dispatchArtifactAiEdit({ artifact, prompt: `/agents:music-producer ${instruction} --source ${artifact.id}@${version}` });
  };
  return <div className="bb-agent-run-card">
    <div className="bb-agent-run-header"><span className="bb-agent-run-title">Music Producer</span><span className="bb-agent-run-label min-w-0 max-w-full truncate" title={task.split("\n")[0]}>{task.split("\n")[0]}</span></div>
    <div className="space-y-4 px-5 py-4">
      <AssistantResponseMeta active={status === "running"} failed={status === "failed"} agentName="Music Producer" label={status === "running" ? stage : status} />
      {status === "running" ? <div className="flex flex-wrap items-center justify-between gap-3"><span className="bb-agent-run-label">One draft · request values override saved defaults</span><button className="bb-agent-run-action" onClick={async () => {
        try {
          const response = await fetch(`/api/music-producer/runs/${encodeURIComponent(runId)}/abort`, { method: "POST" });
          if (!response.ok)
            throw new Error("Stop request failed.");
          setStage("Stopping collection; provider computation may still be draining");
        }
        catch (cause) {
          setError(cause instanceof Error ? cause.message : "Stop request failed.");
        }
      }}>Stop</button></div> : null}
      {audio ? <div className="bb-agent-run-inset flex flex-col items-start gap-3 p-3">
        <label>Version <select aria-label="Music version" value={version} onChange={event => setSelectedVersion(Number(event.target.value))}>{[...new Set([originalVersion, ...versions])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <audio className="w-full" controls preload="none" src={preview} aria-label={`Music version ${version}`} />
        <a className="bb-agent-run-action" href={preview.replace('/preview?', '/download?')} download>Download WAV · version {version}</a>
        {artifact ? <><button className="bb-agent-run-action" onClick={() => setViewer(true)}>Open artifact</button><div className="flex flex-wrap gap-2"><button className="bb-agent-run-action" onClick={() => revise("Make another variation.")}>Prepare variation</button><button className="bb-agent-run-action" onClick={() => revise("Make this version darker with whole-track cover conditioning.")}>Prepare darker version</button><button className="bb-agent-run-action" onClick={() => revise("Replace 20–35 seconds with a stronger chorus. Preserve samples outside that interval.")}>Prepare interval edit</button></div></> : null}
      </div> : null}
      {content ? <div className="bb-agent-run-text"><ChatMarkdown content={content} /></div> : null}
      {error && status === "running" ? <div role="alert" className="bb-agent-run-row flex flex-wrap items-center gap-3 p-3">{error}<button className="bb-agent-run-action" onClick={() => { setError(""); setReconnect(value => value + 1); }}>Reconnect</button></div> : null}
      <div className="flex flex-wrap gap-2"><button className="bb-agent-run-action" onClick={() => setSettings(true)}>Settings</button>{status !== "running" && onRetry ? <button className="bb-agent-run-action" onClick={onRetry}>Retry as a new run</button> : null}</div>
      {status !== "running" ? <AssistantMessageActions content={content} onRetry={onRetry} /> : null}
      {settings ? <AgentSettingsDialog agentId={MUSIC_PRODUCER_AGENT_ID} onClose={() => setSettings(false)} /> : null}
      {viewer && artifact ? <ArtifactViewer artifact={{ ...artifact, version }} onClose={() => setViewer(false)} /> : null}
    </div>
  </div>;
}
