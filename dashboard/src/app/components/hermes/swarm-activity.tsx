"use client";

import { useEffect, useState } from "react";
import type { SwarmSnapshot } from "@/lib/swarm/types.ts";

function evidenceUrl(reference: string, conversationId: string): string | null {
  const artifact = /^artifact:(art_[a-zA-Z0-9_-]+):(\d+)$/u.exec(reference);
  if (artifact) return `/api/hermes/artifacts/${encodeURIComponent(artifact[1])}/preview?conversationId=${encodeURIComponent(conversationId)}&version=${artifact[2]}`;
  try { const url = new URL(reference); return ["https:", "http:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export function SwarmActivity({ conversationId, onActiveChange }: { conversationId: string | number | null | undefined; onActiveChange?: (active: boolean) => void }) {
  const [team, setTeam] = useState<SwarmSnapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    onActiveChange?.(Boolean(team && ["running", "verifying", "cancelling"].includes(team.run.status)));
  }, [team, onActiveChange]);
  useEffect(() => {
    setTeam(null); setError("");
    if (!conversationId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(`/api/swarm?conversationId=${encodeURIComponent(conversationId)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Team progress could not be loaded.");
        const data = await response.json() as { team: SwarmSnapshot | null };
        if (!stopped) { setTeam(data.team); setError(""); }
      } catch (failure) { if (!stopped && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Progress is unavailable."); }
      if (!stopped) timer = setTimeout(refresh, document.visibilityState === "visible" ? 3_000 : 15_000);
    };
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); onActiveChange?.(false); };
  }, [conversationId, onActiveChange]);
  if (!team) return null;
  const done = team.tasks.filter(task => task.status === "completed").length;
  const terminal = ["completed", "cancelled", "failed"].includes(team.run.status);
  const action = async (value: string, taskKey?: string) => {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/swarm", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: team.run.id, action: value, taskKey }) });
      const data = await response.json() as { team?: SwarmSnapshot; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The team action failed.");
      if (data.team) setTeam(data.team);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The team action failed."); }
    finally { setPending(false); }
  };
  const button = "rounded px-2 py-1 text-xs hover:bg-emerald-100 disabled:opacity-50 dark:hover:bg-emerald-950";
  return <details className="mx-auto mb-2 w-full max-w-5xl rounded-lg border border-emerald-800/20 bg-[var(--background)] text-sm" data-swarm-id={team.run.id}>
    <summary className="cursor-pointer px-3 py-2" aria-label={`Team progress: ${done} of ${team.tasks.length} complete`}>
      <span className="font-medium">Team · {done}/{team.tasks.length}</span>
      <span className="ml-2 text-xs opacity-70">{team.run.status.replaceAll("_", " ")}</span>
      <span className="ml-2 text-xs opacity-70">{team.run.chargedTokens.toLocaleString()} / {team.run.limits.maxTokens.toLocaleString()} tokens</span>
    </summary>
    <div className="max-h-80 overflow-y-auto border-t border-emerald-800/10 p-3">
      <p className="font-medium">{team.run.objective}</p>
      <p className="mt-1 text-xs opacity-70">{team.run.reason}</p>
      <p className="mt-1 text-xs opacity-70">{team.run.reservedTokens.toLocaleString()} tokens reserved · {team.run.limits.maxParallel} parallel assignments · {team.run.limits.maxWorkerSlots} scheduling slots</p>
      {!terminal && <div className="my-2 flex gap-2">
        <button className={button} disabled={pending || team.run.status === "budget_limited" || team.run.status === "cancelling"} onClick={() => void action(team.run.status === "paused" ? "resume" : "pause")}>{team.run.status === "paused" ? "Resume" : "Pause new work"}</button>
        <button className={button} disabled={pending || team.run.status === "cancelling"} onClick={() => void action("stop")}>Stop team</button>
      </div>}
      {error && <p role="alert" className="my-2 text-red-700">{error}</p>}
      <ol className="mt-3 space-y-3">
        {team.tasks.map(task => <li key={task.key} className="border-t border-emerald-800/10 pt-2">
          <div className="flex items-center justify-between gap-2"><strong className="font-medium">{task.title}</strong><span className="text-xs opacity-70">{task.status.replaceAll("_", " ")}</span></div>
          <p className="text-xs opacity-70">{task.executor.kind}: {task.executor.id}{task.dependsOn.length ? ` · after ${task.dependsOn.join(", ")}` : ""}</p>
          {task.error && <p className="mt-1 text-xs">{task.error}</p>}
          {task.summary && <p className="mt-1 whitespace-pre-wrap text-xs">{task.summary.slice(0, 2_000)}</p>}
          <details className="mt-1 text-xs"><summary className="cursor-pointer">Assignment and evidence</summary>
            <p className="my-1 whitespace-pre-wrap">{task.brief}</p>
            <ul>{task.acceptance.map(criterion => <li key={criterion}>• {criterion}</li>)}</ul>
            {team.evidence.filter(item => item.taskKey === task.key && item.attemptId === task.activeAttemptId).map(item => {
              const href = evidenceUrl(item.reference, team.run.authority.conversationPublicId);
              return <p key={item.id} className="mt-2 whitespace-pre-wrap break-words"><strong>{item.title}</strong> ({item.kind})<br />{item.summary.slice(0, 3_000)}<br />{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline">Open evidence</a> : <code>{item.reference}</code>}</p>;
            })}
          </details>
          {task.status === "awaiting_approval" && <button className={button} disabled={pending} onClick={() => void action("approve", task.key)}>Approve assignment</button>}
        </li>)}
      </ol>
    </div>
  </details>;
}
