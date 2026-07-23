"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ChatMarkdown from "@/app/components/chat-markdown";
import type { PresentedArtifact } from "@/lib/openharness/artifact-types";

interface ArtifactVersion {
  id: string;
  version: number;
  status: string;
  mimeType: string;
  byteSize: number | null;
  previewAvailable: boolean;
  downloadAvailable: boolean;
  error: { code?: string; message?: string } | null;
  createdAt: string;
}

interface ArtifactEventDetail {
  type: string;
  artifactId: string;
  runId: string;
  conversationId: string;
  gardenId: string | null;
  assistantMessageId: string | null;
  status: PresentedArtifact["status"];
  version: number;
  metadata?: Record<string, unknown>;
}

export const ARTIFACT_BROWSER_EVENT = "breadboard:artifact-event";
export const ARTIFACT_REVISE_EVENT = "breadboard:artifact-revise";

export interface ArtifactPanelProps {
  conversationId?: string | null;
  gardenSlug?: string | null;
  legacyChatSessionId?: number | null;
  compact?: boolean;
  onArtifactCreated?: (detail: ArtifactEventDetail) => void;
}

export default function ArtifactPanel({
  conversationId,
  gardenSlug,
  legacyChatSessionId,
  compact = false,
  onArtifactCreated,
}: ArtifactPanelProps) {
  const [artifacts, setArtifacts] = useState<PresentedArtifact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (conversationId) params.set("conversationId", conversationId);
    if (!conversationId && legacyChatSessionId) params.set("chatSessionId", String(legacyChatSessionId));
    if (gardenSlug) params.set("gardenSlug", gardenSlug);
    return params.toString();
  }, [conversationId, gardenSlug, legacyChatSessionId]);

  const refresh = useCallback(async (preferredId?: string) => {
    if (!query) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/openharness/artifacts?${query}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not load artifacts.");
      const next = Array.isArray(data.artifacts) ? data.artifacts as PresentedArtifact[] : [];
      setArtifacts(next);
      setSelectedId((current) => {
        const desired = preferredId ?? current;
        return desired && next.some((item) => item.id === desired) ? desired : next[0]?.id ?? null;
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load artifacts.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const listener = (raw: Event) => {
      const detail = (raw as CustomEvent<ArtifactEventDetail>).detail;
      if (!detail?.artifactId) return;
      if (conversationId && detail.conversationId !== conversationId) return;
      if (gardenSlug && detail.gardenId !== gardenSlug) return;
      if (detail.type === "artifact.created") {
        const metadata = detail.metadata ?? {};
        const optimistic: PresentedArtifact = {
          id: detail.artifactId,
          conversationId: detail.conversationId,
          gardenId: detail.gardenId,
          runId: detail.runId,
          assistantMessageId: detail.assistantMessageId,
          toolCallId: null,
          kind: typeof metadata.kind === "string" ? metadata.kind as PresentedArtifact["kind"] : "unknown",
          renderer: typeof metadata.renderer === "string" ? metadata.renderer : "unknown",
          title: typeof metadata.title === "string" ? metadata.title : "Generating artifact",
          filename: typeof metadata.filename === "string" ? metadata.filename : "artifact",
          mimeType: "application/octet-stream",
          status: detail.status,
          version: detail.version,
          parentArtifactId: null,
          sourceSkill: null,
          sourceMcpServer: null,
          sourceMcpTool: null,
          sourceOpenHarnessTool: "artifact_create",
          previewAvailable: false,
          downloadAvailable: false,
          byteSize: null,
          contentHash: null,
          metadata,
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setArtifacts((current) => [optimistic, ...current.filter((item) => item.id !== optimistic.id)]);
        setSelectedId(detail.artifactId);
        onArtifactCreated?.(detail);
      } else {
        setArtifacts((current) => current.map((item) => item.id === detail.artifactId
          ? { ...item, status: detail.status, version: detail.version, updatedAt: new Date().toISOString() }
          : item));
      }
      void refresh(detail.artifactId);
    };
    window.addEventListener(ARTIFACT_BROWSER_EVENT, listener);
    return () => window.removeEventListener(ARTIFACT_BROWSER_EVENT, listener);
  }, [conversationId, gardenSlug, onArtifactCreated, refresh]);

  const selected = artifacts.find((artifact) => artifact.id === selectedId) ?? null;
  const effectiveConversationId = selected?.conversationId ?? conversationId ?? null;
  const version = selectedVersion ?? selected?.version ?? null;
  const fileQuery = effectiveConversationId && version
    ? new URLSearchParams({ conversationId: effectiveConversationId, version: String(version) }).toString()
    : "";

  useEffect(() => {
    setSelectedVersion(selected?.version ?? null);
    setVersions([]);
    setTextPreview(null);
    if (!selected || !effectiveConversationId) return;
    void fetch(`/api/openharness/artifacts/${encodeURIComponent(selected.id)}/versions?conversationId=${encodeURIComponent(effectiveConversationId)}`)
      .then((response) => response.ok ? response.json() : { versions: [] })
      .then((data) => setVersions(Array.isArray(data.versions) ? data.versions : []))
      .catch(() => undefined);
  }, [selected, effectiveConversationId]);

  useEffect(() => {
    setTextPreview(null);
    if (!selected || !fileQuery || !["text", "markdown", "code", "data"].includes(selected.kind)) return;
    void fetch(`/api/openharness/artifacts/${encodeURIComponent(selected.id)}/preview?${fileQuery}`)
      .then((response) => response.ok ? response.text() : Promise.reject(new Error("Preview unavailable")))
      .then(setTextPreview)
      .catch(() => setTextPreview(null));
  }, [fileQuery, selected]);

  const previewUrl = selected && fileQuery
    ? `/api/openharness/artifacts/${encodeURIComponent(selected.id)}/preview?${fileQuery}`
    : "";
  const downloadUrl = selected && fileQuery
    ? `/api/openharness/artifacts/${encodeURIComponent(selected.id)}/download?${fileQuery}`
    : "";
  const selectedVersionInfo = versions.find((item) => item.version === version);
  const previewAvailable = selectedVersionInfo?.previewAvailable ?? selected?.previewAvailable ?? false;
  const downloadAvailable = selectedVersionInfo?.downloadAvailable ?? selected?.downloadAvailable ?? false;
  const selectedError = selectedVersionInfo?.error ?? selected?.error ?? null;

  return (
    <section className={`flex min-h-0 flex-col bg-[var(--paper-surface)] text-[var(--ink)] ${compact ? "h-full" : "max-h-[62vh]"}`} aria-label="Artifacts">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink-heading)]">Artifacts</h3>
          <p className="text-[10px] text-[var(--ink-muted)]">{artifacts.length} in this scope</p>
        </div>
        <button type="button" onClick={() => void refresh()} className="rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]">Refresh</button>
      </div>
      {error ? <p className="m-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p> : null}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(9rem,0.38fr)_minmax(0,1fr)]">
        <div className="overflow-y-auto border-r border-[var(--line)] p-2">
          {loading && artifacts.length === 0 ? <p className="p-2 text-xs text-[var(--ink-muted)]">Loading…</p> : null}
          {artifacts.length === 0 && !loading ? <p className="p-2 text-xs text-[var(--ink-muted)]">No artifacts yet.</p> : null}
          {artifacts.map((artifact) => (
            <button key={artifact.id} type="button" onClick={() => setSelectedId(artifact.id)} className={`mb-1 w-full rounded-lg px-2.5 py-2 text-left ${selectedId === artifact.id ? "bg-[var(--paper-strong)]" : "hover:bg-[var(--paper-strong)]/60"}`}>
              <span className="block truncate text-xs font-medium text-[var(--ink-heading)]">{artifact.title}</span>
              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--ink-muted)]">
                <span>{artifact.kind}</span><span>·</span><span>v{artifact.version}</span><span>·</span>
                <span className={artifact.status === "failed" ? "text-red-600" : artifact.status === "ready" ? "text-[#4F805E]" : "text-amber-700"}>{artifact.status}</span>
              </span>
              <span className="mt-0.5 block truncate text-[9px] text-[var(--ink-muted)]">
                {new Date(artifact.createdAt).toLocaleString()} · {artifact.previewAvailable ? "preview" : "no preview"} · {artifact.downloadAvailable ? "download" : "not downloadable"}
              </span>
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-col">
          {!selected ? <div className="m-auto p-6 text-center text-xs text-[var(--ink-muted)]">Select an artifact to preview it.</div> : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--ink-heading)]">{selected.title}</p>
                  <p className="truncate text-[10px] text-[var(--ink-muted)]">{selected.filename} · run {selected.runId.slice(0, 8)}{selected.assistantMessageId ? ` · ${selected.assistantMessageId}` : ""}</p>
                </div>
                {versions.length > 0 ? (
                  <select aria-label="Artifact version" value={version ?? selected.version} onChange={(event) => setSelectedVersion(Number(event.target.value))} className="rounded-md border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1 text-xs">
                    {versions.map((item) => <option key={item.id} value={item.version}>v{item.version}</option>)}
                  </select>
                ) : null}
                <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(ARTIFACT_REVISE_EVENT, { detail: selected }))} className="rounded-md border border-[var(--line)] px-2 py-1 text-xs hover:bg-[var(--paper-strong)]">Revise</button>
                {downloadAvailable && downloadUrl ? <a href={downloadUrl} className="rounded-md border border-[var(--line)] px-2 py-1 text-xs hover:bg-[var(--paper-strong)]">Download</a> : null}
              </div>
              {selectedError ? <p className="m-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{selectedError.message}</p> : null}
              <div className="min-h-0 flex-1 overflow-auto p-3">
                {!previewAvailable ? <div className="flex h-full min-h-32 items-center justify-center text-xs text-[var(--ink-muted)]">{selected.status === "failed" ? "Preview failed." : "Generating preview…"}</div>
                  : selected.kind === "markdown" ? <div className="prose max-w-none"><ChatMarkdown content={textPreview ?? ""} compact /></div>
                    : ["text", "code", "data"].includes(selected.kind) ? <pre className="whitespace-pre-wrap break-words rounded-lg bg-[var(--paper-strong)] p-3 text-xs">{textPreview ?? "Loading preview…"}</pre>
                      : selected.kind === "pdf" ? <iframe title={`${selected.title} PDF preview`} src={previewUrl} className="h-full min-h-[24rem] w-full rounded-lg border border-[var(--line)]" />
                        : selected.kind === "html" || selected.kind === "document" ? <iframe title={`${selected.title} sandboxed preview`} sandbox="" referrerPolicy="no-referrer" src={previewUrl} className="h-full min-h-[24rem] w-full rounded-lg border border-[var(--line)]" />
                          : <div className="text-xs text-[var(--ink-muted)]">No preview renderer is available for {selected.kind}.</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
