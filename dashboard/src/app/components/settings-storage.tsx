"use client";

import { useCallback, useEffect, useState } from "react";

interface StorageStatus {
  automatic: boolean; freeBytes: number; compressedPayloadBytesSaved: number;
  disposables: { verifiedBytes: number; verifiedFiles: number; complete: boolean };
  database: { reusableBytes: number };
  inventory: null | { complete: boolean; allocatedBytes: number; hardlinkBytesAvoided: number; skippedEntries: number;
    categories: Record<string, number>; largest: Array<{ path: string; bytes: number }> };
  lastResult: null | { finishedAt: number; bytesReleased: number; skipped: string[] };
  protected: string[];
  compaction: null | { phase: string; detail?: string; bytesReleased?: number };
}
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${Math.round(bytes / 1024)} KiB`;

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
    {status && <>
      <dl className="grid grid-cols-2 gap-2">
        <dt>Free on the data drive</dt><dd className="text-right tabular-nums">{size(status.freeBytes)}</dd>
        <dt>Measured application files</dt><dd className="text-right tabular-nums">{status.inventory ? size(status.inventory.allocatedBytes) : "Not yet measured"}</dd>
        <dt>Compressed payload savings</dt><dd className="text-right tabular-nums">{size(status.compressedPayloadBytesSaved)}</dd>
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
      {status.lastResult && <div className="space-y-1 text-xs text-[var(--ink-muted)]">
        <p>Last maintenance: {new Date(status.lastResult.finishedAt).toLocaleString()}. Released {size(status.lastResult.bytesReleased)}.</p>
        {status.lastResult.skipped.map(reason => <p key={reason}>{reason}</p>)}
      </div>}
    </>}
  </div>;
}
