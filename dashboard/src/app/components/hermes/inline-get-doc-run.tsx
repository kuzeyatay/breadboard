"use client";

// In-chat run card for a Get Doc search — the whole Get Doc surface.
//
// The host creates the run before this mounts; this component observes
// /api/get-doc/runs/<id>/events and then owns one interaction the other inline
// cards do not have: a Download button per document, which saves the paper into
// the conversation's artifacts.
//
// A reopened transcript matters here more than elsewhere, because the list is
// the deliverable. So instead of trusting the persisted text, a finished run
// re-reads its own event log once: if the run is still held server-side the
// rows and their buttons come back exactly as they were, and only when it has
// expired does the card fall back to the written list.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import {
  useInlineArtifactScope,
  useInlineArtifactViewer,
  useRegisterInlineArtifact,
} from "./inline-artifact-cards";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import type { DocumentHit, SourceReport } from "@/lib/get-doc/types";
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

const ChatMarkdown = dynamic(() => import("@/app/components/chat-markdown"), { ssr: false });

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface SavedDocument {
  artifactId: string;
  filename: string;
  byteSize: number;
  savedAt: string;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);

const STREAMED_EVENT_TYPES = [
  "run.started",
  "plan.started",
  "plan.completed",
  "search.started",
  "search.progress",
  "search.completed",
  "source.completed",
  "describe.started",
  "documents.ready",
  "document.saved",
  "run.usage",
  "run.completed",
  "run.failed",
  "run.aborted",
];

const SOURCE_NAMES: Record<string, string> = {
  openalex: "OpenAlex",
  arxiv: "arXiv",
  europepmc: "Europe PMC",
  semanticscholar: "Semantic Scholar",
  crossref: "Crossref",
  core: "CORE",
  unpaywall: "Unpaywall",
};

const ERROR_TEXT: Record<string, string> = {
  run_not_found: "This search is no longer available — the dashboard restarted or it expired.",
  model_not_configured: "No model is configured, so the request could not be read.",
  internal_error: "The document search failed.",
};

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function citation(document: DocumentHit): string {
  const authors =
    document.authors.length > 3
      ? `${document.authors.slice(0, 3).join(", ")} et al.`
      : document.authors.join(", ");
  return [authors, document.year ? String(document.year) : "", document.venue ?? ""]
    .filter(Boolean)
    .join(" · ");
}

function parseDocuments(value: unknown): DocumentHit[] {
  return Array.isArray(value) ? (value as DocumentHit[]) : [];
}

export default function InlineGetDocRun({
  runId,
  query,
  persistedContent = "",
  persistedOutcome,
  persistedUsage,
  onTerminal,
  onRetry,
}: {
  runId: string;
  query: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  persistedUsage?: ChatTokenUsage;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState<string>(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "running",
  );
  const [stage, setStage] = useState<string>("Reading the request");
  const [documents, setDocuments] = useState<DocumentHit[]>([]);
  const [reports, setReports] = useState<SourceReport[]>([]);
  const [saved, setSaved] = useState<Record<string, SavedDocument>>({});
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string | null>(
    persistedOutcome === "completed" ? persistedContent || null : null,
  );
  const [failure, setFailure] = useState<string | null>(
    persistedOutcome === "failed" || persistedOutcome === "aborted"
      ? persistedContent || null
      : null,
  );
  const [expired, setExpired] = useState(false);
  const [contactMissing, setContactMissing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [usage, setUsage] = useState<ChatTokenUsage | undefined>(persistedUsage);
  const [openAbstract, setOpenAbstract] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const summaryRef = useRef(summary);
  const failureRef = useRef(failure);
  const usageRef = useRef(usage);
  const onTerminalRef = useRef(onTerminal);
  const reportedTerminalRef = useRef(false);

  const artifactScope = useInlineArtifactScope();
  const openArtifact = useInlineArtifactViewer();
  const registerArtifact = useRegisterInlineArtifact();

  const base = `/api/get-doc/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedTerminalRef.current = false;
  }, [runId]);

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      if (event.type === "plan.started") setStage("Reading the request");
      if (event.type === "plan.completed") {
        const queries = Array.isArray(payload.queries) ? (payload.queries as string[]) : [];
        setStage(queries[0] ? `Searching for “${queries[0]}”` : "Searching the catalogs");
      }
      if (event.type === "search.started" && typeof payload.query === "string") {
        setStage(`Searching for “${payload.query}”`);
      }
      if (event.type === "search.progress" && payload.stage === "resolving") {
        setStage(`Finding free full texts — ${payload.detail ?? ""}`.trim());
      }
      if (event.type === "source.completed") {
        const report = payload as unknown as SourceReport;
        setReports((current) => [
          ...current.filter((entry) => entry.source !== report.source),
          report,
        ]);
      }
      if (event.type === "describe.started") setStage("Describing what it found");
      if (event.type === "documents.ready") {
        setDocuments(parseDocuments(payload.documents));
        if (Array.isArray(payload.reports)) setReports(payload.reports as SourceReport[]);
        setContactMissing(payload.contactConfigured === false && payload.unpaywallSkipped === true);
      }
      if (event.type === "document.saved" && typeof payload.documentId === "string") {
        const record = payload as unknown as SavedDocument & { documentId: string };
        setSaved((current) => ({
          ...current,
          [record.documentId]: {
            artifactId: record.artifactId,
            filename: record.filename,
            byteSize: record.byteSize,
            savedAt: record.savedAt,
          },
        }));
      }
      if (event.type === "run.usage") {
        const next = normalizeChatTokenUsage(payload);
        if (next) {
          usageRef.current = next;
          setUsage(next);
        }
      }
      if (event.type === "run.failed") {
        const code = typeof payload.error === "string" ? payload.error : null;
        const message =
          (code && ERROR_TEXT[code]) ??
          (typeof payload.error === "string" ? payload.error : "The document search failed.");
        failureRef.current = message;
        setFailure(message);
      }
      if (
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.aborted"
      ) {
        const outcome = event.type.replace("run.", "") as ExternalAgentTerminalResult["outcome"];
        if (typeof payload.summary === "string" && payload.summary.trim()) {
          summaryRef.current = payload.summary;
          setSummary(payload.summary);
        }
        setStatus(outcome);
        setStage("");
        eventSourceRef.current?.close();
        if (!reportedTerminalRef.current) {
          reportedTerminalRef.current = true;
          const content =
            outcome === "completed"
              ? summaryRef.current ?? "The document search finished."
              : outcome === "aborted"
                ? "The document search was stopped."
                : failureRef.current ?? "The document search failed.";
          if (outcome === "completed") notifyTaskCompleted(query);
          onTerminalRef.current?.({
            outcome,
            content,
            ...(usageRef.current ? { usage: usageRef.current } : {}),
          });
        }
      }
    },
    [query],
  );

  // A finished run is replayed rather than streamed: the rows and their saved
  // state are worth more than the persisted prose, and they only exist here.
  useEffect(() => {
    if (!persistedOutcome || persistedOutcome === "running") return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${base}/events?since=0`);
        if (!response.ok) {
          if (!cancelled) setExpired(true);
          return;
        }
        const data = (await response.json()) as { events?: RunEvent[] };
        if (cancelled) return;
        const events = data.events ?? [];
        if (!events.length) {
          setExpired(true);
          return;
        }
        // Terminal events are dropped on replay: this turn already reported its
        // outcome, and reporting it again would re-save the same message.
        reportedTerminalRef.current = true;
        for (const event of events) applyEvent(event);
      } catch {
        if (!cancelled) setExpired(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyEvent, base, persistedOutcome]);

  useEffect(() => {
    if (persistedOutcome && persistedOutcome !== "running") return;
    const eventSource = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        /* ignore malformed frame */
      }
    };
    eventSource.onmessage = handle;
    STREAMED_EVENT_TYPES.forEach((type) =>
      eventSource.addEventListener(type, handle as EventListener),
    );
    eventSource.onerror = () => {
      void (async () => {
        try {
          const response = await fetch(`${base}/events?since=0`);
          if (response.ok) return; // transient drop; the stream reconnects itself
          eventSource.close();
          setStatus("failed");
          setFailure(ERROR_TEXT.run_not_found);
        } catch {
          /* offline: leave the stream retrying */
        }
      })();
    };
    eventSourceRef.current = eventSource;
    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [applyEvent, base, persistedOutcome]);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(status)) return;
    const started = Date.now();
    const timer = setInterval(
      () => setElapsedSeconds(Math.round((Date.now() - started) / 1000)),
      1_000,
    );
    return () => clearInterval(timer);
  }, [status]);

  const stop = async () => {
    try {
      await fetch(`${base}/abort`, { method: "POST" });
      setStage("Stopping…");
    } catch {
      /* the stream reports the real state */
    }
  };

  const download = useCallback(
    async (document: DocumentHit) => {
      const conversationId = artifactScope?.conversationId;
      if (!conversationId) {
        setDownloadErrors((current) => ({
          ...current,
          [document.id]: "This chat has no artifact workspace yet — send a message first.",
        }));
        return;
      }
      setDownloading((current) => ({ ...current, [document.id]: true }));
      setDownloadErrors((current) => {
        const next = { ...current };
        delete next[document.id];
        return next;
      });
      try {
        const response = await fetch(`${base}/documents/${document.id}/download`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          saved?: SavedDocument;
          artifact?: PresentedArtifact;
          error?: string;
          message?: string;
        };
        if (!response.ok || !data.ok || !data.saved) {
          throw new Error(
            data.message ?? ERROR_TEXT[data.error ?? ""] ?? "The download failed.",
          );
        }
        setSaved((current) => ({ ...current, [document.id]: data.saved! }));
        // The artifact card appears beside this one straight away rather than
        // on the next poll, which is what makes the click feel finished.
        if (data.artifact) registerArtifact?.(data.artifact);
      } catch (error) {
        setDownloadErrors((current) => ({
          ...current,
          [document.id]:
            error instanceof Error ? error.message : "The download failed.",
        }));
      } finally {
        setDownloading((current) => {
          const next = { ...current };
          delete next[document.id];
          return next;
        });
      }
    },
    [artifactScope?.conversationId, base, registerArtifact],
  );

  const terminal = TERMINAL_STATUSES.has(status);
  const downloadable = documents.filter((document) => document.pdfUrl).length;
  const statusDot = terminal
    ? status === "completed"
      ? "bg-[var(--botanical)]"
      : "bg-[var(--danger)]"
    : "animate-pulse bg-[var(--botanical-2)]";
  const searchedCatalogs = reports.filter((report) => report.status === "ok").length;
  const terminalContent =
    summary?.trim() || failure?.trim() || "The document search finished.";

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        responseDurationMs={
          !terminal || elapsedSeconds > 0 ? elapsedSeconds * 1_000 : undefined
        }
        usage={usage}
        agentName="Get Doc"
      />
      <div className="bb-agent-run-card overflow-hidden">
        <div className="bb-agent-run-header">
          <span className="bb-agent-run-title truncate">Get Doc</span>
          <div className="flex shrink-0 items-center gap-[8px]">
            <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
              <span className={`bb-agent-run-led h-1.5 w-1.5 ${statusDot}`} />
              {terminal ? status : `searching · ${formatDuration(elapsedSeconds)}`}
            </span>
            {!terminal && (
              <button type="button" onClick={stop} className="bb-agent-run-action">
                Stop
              </button>
            )}
          </div>
        </div>

        <div className="space-y-[13px] p-[21px]">
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(89px,1fr))] gap-x-[21px] gap-y-[13px]">
            {(
              [
                [
                  "Progress",
                  terminal
                    ? status === "completed"
                      ? "Complete"
                      : status === "aborted"
                        ? "Stopped"
                        : "Failed"
                    : "Searching",
                ],
                ["Catalogs", searchedCatalogs ? String(searchedCatalogs) : "—"],
                ["Found", documents.length ? String(documents.length) : "—"],
                ["Downloadable", documents.length ? String(downloadable) : "—"],
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="bb-agent-run-label">{label}</dt>
                <dd className="text-[13px] font-medium leading-[1.4] text-[var(--ink-heading)]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {!terminal && stage ? (
            <p className="bb-agent-run-text break-words text-[var(--ink-muted)]">{stage}</p>
          ) : null}

          {failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}

          {contactMissing ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              Some papers could not be checked for a free copy: set GET_DOC_CONTACT_EMAIL to let
              Unpaywall answer.
            </p>
          ) : null}

          {documents.length > 0 ? (
            <ul className="space-y-[13px]">
              {documents.map((document) => {
                const savedDocument = saved[document.id];
                const busy = downloading[document.id];
                const error = downloadErrors[document.id];
                return (
                  <li key={document.id} className="bb-agent-run-inset p-[13px]">
                    <div className="flex items-start justify-between gap-[13px]">
                      <div className="min-w-0 space-y-[5px]">
                        <p className="text-[13px] font-medium leading-[1.4] text-[var(--ink-heading)]">
                          {document.title}
                        </p>
                        <p className="bb-agent-run-label truncate">{citation(document)}</p>
                        {document.description ? (
                          <p className="bb-agent-run-text text-[var(--ink)]">
                            {document.description}
                          </p>
                        ) : null}
                        <p className="flex flex-wrap items-center gap-x-[13px] gap-y-[3px] text-[11px] leading-[1.618] text-[var(--ink-muted)]">
                          {document.pdfUrl ? (
                            <a
                              href={document.pdfUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--botanical)] hover:underline"
                            >
                              PDF
                            </a>
                          ) : null}
                          {document.landingPage ? (
                            <a
                              href={document.landingPage}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--botanical)] hover:underline"
                            >
                              Page
                            </a>
                          ) : null}
                          {document.doi ? (
                            <a
                              href={`https://doi.org/${document.doi}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--botanical)] hover:underline"
                            >
                              doi:{document.doi}
                            </a>
                          ) : null}
                          {document.citationCount !== null ? (
                            <span>{document.citationCount} citations</span>
                          ) : null}
                          <span>
                            {document.sources
                              .map((source) => SOURCE_NAMES[source] ?? source)
                              .join(", ")}
                          </span>
                          {document.abstract ? (
                            <button
                              type="button"
                              className="bb-agent-run-action"
                              onClick={() =>
                                setOpenAbstract((current) =>
                                  current === document.id ? null : document.id,
                                )
                              }
                              aria-expanded={openAbstract === document.id}
                            >
                              {openAbstract === document.id ? "Hide abstract" : "Abstract"}
                            </button>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-[5px]">
                        {savedDocument ? (
                          <button
                            type="button"
                            className="bb-agent-run-action"
                            onClick={() =>
                              openArtifact
                                ? void openArtifact(savedDocument.artifactId)
                                : undefined
                            }
                            title={savedDocument.filename}
                          >
                            Saved · open
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="bb-agent-run-action"
                            onClick={() => void download(document)}
                            disabled={busy || !document.pdfUrl || expired}
                            title={
                              document.pdfUrl
                                ? "Download the PDF into this chat's artifacts"
                                : "No free full text was found for this paper"
                            }
                          >
                            {busy ? "Downloading…" : document.pdfUrl ? "Download" : "No free PDF"}
                          </button>
                        )}
                        {savedDocument ? (
                          <span className="bb-agent-run-label">
                            {formatBytes(savedDocument.byteSize)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {openAbstract === document.id && document.abstract ? (
                      <p className="bb-agent-run-text mt-[8px] text-[var(--ink-muted)]">
                        {document.abstract}
                      </p>
                    ) : null}
                    {error ? (
                      <p className="bb-agent-run-text mt-[8px] text-[var(--danger)]">{error}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {/* Only when the rows are gone: an expired run still has its written
              list, and every link in it still works. */}
          {terminal && expired && summary ? (
            <div className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
              <p className="bb-agent-run-label mb-[8px]">
                This search has expired, so it can no longer download. Run it again to save any of
                these.
              </p>
              <ChatMarkdown content={summary} compact />
            </div>
          ) : null}

          {terminal && !documents.length && !summary && !failure ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              No documents matched that description.
            </p>
          ) : null}

          {reports.some((report) => report.status === "error" || report.status === "skipped") ? (
            <details>
              <summary className="bb-agent-run-label cursor-pointer hover:text-[var(--ink)]">
                Catalogs that did not answer
              </summary>
              <ul className="mt-[8px] space-y-[5px]">
                {reports
                  .filter((report) => report.status === "error" || report.status === "skipped")
                  .map((report) => (
                    <li key={report.source} className="text-[11px] leading-[1.618] text-[var(--ink-muted)]">
                      {SOURCE_NAMES[report.source] ?? report.source}
                      {report.note ? ` — ${report.note}` : ""}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
