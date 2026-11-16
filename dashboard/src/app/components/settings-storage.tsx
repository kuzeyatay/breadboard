"use client";

import { useCallback, useEffect, useState } from "react";

interface StorageStatus {
  automatic: boolean; freeBytes: number; compressedPayloadBytesSaved: number;
  chats?: Array<{ folder: string; title: string | null; bytes: number; removableBytes: number; over: boolean }>;
  budget?: { budgetBytes: number; usedBytes: number; overBytes: number; over: boolean; classes: Record<string, number> };
  disposables: { verifiedBytes: number; verifiedFiles: number; complete: boolean };
  database: { reusableBytes: number };
  inventory: null | { complete: boolean; allocatedBytes: number; hardlinkBytesAvoided: number; skippedEntries: number;
    categories: Record<string, number>; largest: Array<{ path: string; bytes: number }> };
  lastResult: null | { finishedAt: number; bytesReleased: number; skipped: string[] };
  protected: string[];
  compaction: null | { phase: string; detail?: string; bytesReleased?: number };
  workspaces?: { files:number; workspaces:number; deduplicatedBytes:number; compressedBytes:number; recoveryCopies:number; archivedWorkspaces:Array<{key:string;files:number}>; skipped:Array<{path:string;reason:string}> };
}
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${Math.round(bytes / 1024)} KiB`;

const CLASS_LABELS: Record<string, string> = {
  content: "Your chats, files and work (kept)",
  regenerable: "Built pages, caches and raw dumps Breadboard can make again",
  redownloadable: "Models, runtimes and source videos that can be fetched again",
  capture: "Recall recordings",
};

export default function SettingsStorage({ active = true }: { active?: boolean }) {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/storage", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Storage details are unavailable.");
      setStatus(body); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Storage details are unavailable."); }
  }, []);
  useEffect(() => { if (!active) return; void load(); const timer = setInterval(() => void load(), 15_000); return () => clearInterval(timer); }, [load, active]);
  const update = async (endpoint: string, method: string, body: unknown) => {
    const previous = status;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Storage maintenance failed.");
      await load();
    } catch (cause) { setStatus(previous); setError(cause instanceof Error ? cause.message : "Storage maintenance failed."); }
    finally { setBusy(false); }
  };
  return <div className="space-y-5 text-sm text-[var(--ink)]">
    <p className="text-[var(--ink-muted)]">Breadboard keeps your chats, attachments and work. Automatic housekeeping clears released temporary files and compresses older chat details without changing their content.</p>
    {error && <p role="alert" className="text-red-500">{error} <button className="underline" onClick={() => void load()}>Retry</button></p>}
    <label className="flex items-center justify-between gap-4">
      <span>Automatic housekeeping</span>
      <input type="checkbox" aria-label="Automatic housekeeping" checked={status?.automatic ?? true} disabled={busy || !status}
        onChange={event => {
          const automatic = event.target.checked;
          setStatus(current => current ? { ...current, automatic } : current);
          void update("/api/storage", "PATCH", { automatic });
        }} />
    </label>
    {status?.budget && <section className="space-y-2" aria-label="Storage budget">
      <label className="flex items-center justify-between gap-4">
        <span>Storage budget</span>
        <span className="flex items-center gap-2">
          <input type="number" min={5} step={5} aria-label="Storage budget in GiB" disabled={busy}
            className="w-20 rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-right tabular-nums"
            defaultValue={Math.round(status.budget.budgetBytes / 1024 ** 3)} key={status.budget.budgetBytes}
            onBlur={event => {
              const budgetBytes = Math.round(Number(event.target.value)) * 1024 ** 3;
              if (budgetBytes !== status.budget?.budgetBytes) void update("/api/storage", "PATCH", { budgetBytes });
            }} />
          <span>GiB</span>
        </span>
      </label>
      <progress className="w-full" max={status.budget.budgetBytes} value={Math.min(status.budget.usedBytes, status.budget.budgetBytes)}
        aria-label="Share of the storage budget in use" />
      <p role="status" className={status.budget.over ? "text-xs text-red-500" : "text-xs text-[var(--ink-muted)]"}>
        {status.inventory ? `${size(status.budget.usedBytes)} of ${size(status.budget.budgetBytes)} measured${status.inventory.complete ? "" : " so far"}.` : "Not yet measured."}
        {status.budget.over && ` Over by ${size(status.budget.overBytes)}: Breadboard is compressing cold workspace files first. Nothing of yours is removed.`}
      </p>
      {!!Object.keys(status.budget.classes).length && <table className="w-full text-left"><caption className="pb-2 text-left font-medium">What the space holds</caption>
        <tbody>{Object.entries(status.budget.classes).sort((a,b) => b[1]-a[1]).map(([name, bytes]) => <tr key={name}>
          <th className="py-1 font-normal">{CLASS_LABELS[name] ?? name}</th><td className="text-right tabular-nums">{size(bytes)}</td></tr>)}</tbody></table>}
    </section>}
    {!!status?.chats?.length && <section className="space-y-2" aria-label="Large chats">
      <p className="font-medium">Large chats</p>
      <p className="text-xs text-[var(--ink-muted)]">A chat&rsquo;s text is tiny. What takes space is the files its tools save in its working folder: downloaded videos, simulation output, renders. A chat is flagged above 2 GiB and will say so itself. Removing only deletes downloads and raw dumps that can be fetched or produced again; reports and deliverables stay.</p>
      <ul className="space-y-2">{status.chats.map(chat => <li key={chat.folder} className="flex items-center gap-3">
        <span className="min-w-0 flex-1 break-words">{chat.title || chat.folder}{chat.over && <span className="text-red-500"> (over the limit)</span>}</span>
        <span className="shrink-0 tabular-nums">{size(chat.bytes)}</span>
        {chat.removableBytes > 0 && <button disabled={busy} className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 disabled:opacity-50"
          onClick={() => { if (window.confirm(`Remove ${size(chat.removableBytes)} of downloads and raw dumps from this chat? This cannot be undone.`)) void update("/api/storage/chats/reclaim", "POST", { folder: chat.folder }); }}>
          Remove {size(chat.removableBytes)}</button>}
      </li>)}</ul>
    </section>}
    {status && <>
      <dl className="grid grid-cols-2 gap-2">
        <dt>Free on the data drive</dt><dd className="text-right tabular-nums">{size(status.freeBytes)}</dd>
        <dt>Measured application files</dt><dd className="text-right tabular-nums">{status.inventory ? size(status.inventory.allocatedBytes) : "Not yet measured"}</dd>
        <dt>Compressed payload savings</dt><dd className="text-right tabular-nums">{size(status.compressedPayloadBytesSaved)}</dd>
        {status.workspaces && <><dt>Cold workspace input savings</dt><dd className="text-right tabular-nums">{size(status.workspaces.deduplicatedBytes)}</dd>
          <dt>Workspace compression released</dt><dd className="text-right tabular-nums">{size(status.workspaces.compressedBytes)}</dd></>}
        <dt>Verified disposable files{status.disposables.complete ? "" : " (partial)"}</dt><dd className="text-right tabular-nums">{size(status.disposables.verifiedBytes)}</dd>
        <dt>Reusable inside the database</dt><dd className="text-right tabular-nums">{size(status.database.reusableBytes)}</dd>
      </dl>
      <p className="text-xs text-[var(--ink-muted)]">{status.inventory?.complete ? "File scan complete." : "The file scan continues in small batches while idle."} Shared hardlinks are counted once. Filesystem metadata is excluded; reusable database space has not yet been returned to the drive.</p>
      {!!status.inventory?.skippedEntries && <p className="text-xs">{status.inventory.skippedEntries} inaccessible or redirected entries were skipped.</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} className="rounded-md border border-[var(--border)] px-3 py-2 disabled:opacity-50"
          onClick={() => void update("/api/storage/maintenance", "POST", { action: "clean" })}>{busy ? "Working…" : "Clean disposable files now"}</button>
        <button disabled={busy} className="rounded-md border border-[var(--border)] px-3 py-2 disabled:opacity-50"
          onClick={() => void update("/api/storage/maintenance", "POST", { action: "scan" })}>Refresh measurements</button>
        <button disabled={busy || status.compaction?.phase === "running" || status.compaction?.phase === "pending"}
          className="rounded-md border border-[var(--border)] px-3 py-2 disabled:opacity-50"
          onClick={() => void update("/api/storage/maintenance", "POST", { action: "compact" })}>Compact databases when idle</button>
      </div>
      <p className="text-xs text-[var(--ink-muted)]">Database compaction uses a separate idle window and briefly restarts Breadboard’s services. It waits for sufficient free space and finishes active work first.</p>
      {status.compaction && <p role="status" className="text-xs">Compaction: {status.compaction.phase}. {status.compaction.detail} {status.compaction.bytesReleased ? `Released ${size(status.compaction.bytesReleased)}.` : ""}</p>}
      {status.inventory && <table className="w-full text-left"><caption className="pb-2 text-left font-medium">Space by category</caption>
        <tbody>{Object.entries(status.inventory.categories).sort((a,b) => b[1]-a[1]).map(([name, bytes]) => <tr key={name}>
          <th className="py-1 font-normal">{name}</th><td className="text-right tabular-nums">{size(bytes)}</td></tr>)}</tbody></table>}
      {!!status.inventory?.largest.length && <details><summary className="cursor-pointer font-medium">Large retained files</summary>
        <ul className="mt-2 space-y-2">{status.inventory.largest.map(file => <li key={file.path} className="flex gap-3">
          <span className="min-w-0 flex-1 break-all">{file.path}</span><span className="shrink-0 tabular-nums">{size(file.bytes)}</span></li>)}</ul></details>}
      <p className="text-xs text-[var(--ink-muted)]">Protected: {status.protected.join("; ")}.</p>
      {status.workspaces && <p className="text-xs text-[var(--ink-muted)]">{status.workspaces.files} cold attachment copies in {status.workspaces.workspaces} workspaces share verified storage. Independent editable copies return when a workspace runs. Other compressed workspace files remain directly readable.</p>}
      {!!status.workspaces?.recoveryCopies && <p className="text-xs">{status.workspaces.recoveryCopies} additional recovery copies are protected.</p>}
      {!!status.workspaces?.archivedWorkspaces.length && <details className="text-xs"><summary className="cursor-pointer">Restore archived workspace inputs</summary>
        {status.workspaces.archivedWorkspaces.map(item=><div key={item.key} className="mt-2 flex items-center gap-2"><span className="min-w-0 flex-1 break-all">{item.key} ({item.files} files)</span>
          <button disabled={busy} className="shrink-0 underline disabled:opacity-50" onClick={()=>void update("/api/storage/workspaces/restore","POST",{workspaceKey:item.key})}>Restore files</button></div>)}</details>}
      {!!status.workspaces?.skipped.length && <details className="text-xs"><summary className="cursor-pointer">Workspace files kept unchanged</summary>
        {status.workspaces.skipped.map(item=><p key={item.path} className="mt-1 break-all">{item.path}: {item.reason}</p>)}</details>}
      {status.lastResult && <div className="space-y-1 text-xs text-[var(--ink-muted)]">
        <p>Last maintenance: {new Date(status.lastResult.finishedAt).toLocaleString()}. Released {size(status.lastResult.bytesReleased)}.</p>
        {status.lastResult.skipped.map(reason => <p key={reason}>{reason}</p>)}
      </div>}
    </>}
  </div>;
}
