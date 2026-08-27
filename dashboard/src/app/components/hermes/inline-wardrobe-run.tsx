"use client";
//
// The Wardrobe run card.
//
// An import is a list of garments, each moving through the same two steps, so
// the card is that list: one row per piece, its own colour beside its name, and
// a state that changes as the cutout and then the modeled photo come back. The
// pictures themselves arrive as artifacts on the turn, which is why the rows
// stay small — they are the progress, not the gallery.
//
// Styling uses the shared run material (bb-agent-run-*) so this reads as the
// same object as every other external-agent run.

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import { closeAgentRunStream, resolveAgentRunStreamError } from "@/lib/agent-run-stream";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type PieceState = "cutting" | "modeling" | "imported" | "cutout" | "failed";

interface Piece {
  jobId: string;
  name: string;
  part: string;
  color: string;
  state: PieceState;
  note: string;
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "service.starting",
  "service.ready",
  "photo.started",
  "photo.detected",
  "photo.capped",
  "photo.failed",
  "item.started",
  "item.stage",
  "item.imported",
  "item.partial",
  "item.failed",
  "run.completed",
  "run.failed",
  "run.aborted",
];

const TERMINAL = new Set(["completed", "failed", "aborted"]);

const PART_LABELS: Record<string, string> = {
  upperbody: "top",
  wholebody_up: "outer layer",
  lowerbody: "bottom",
  accessories_up: "accessory",
  shoes: "shoes",
};

const STATE_LABELS: Record<PieceState, string> = {
  cutting: "cutting out",
  modeling: "modelling",
  imported: "added",
  cutout: "cutout only",
  failed: "skipped",
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatElapsed(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m ${String(rounded % 60).padStart(2, "0")}s` : `${rounded}s`;
}

function isColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export default function InlineWardrobeRun({
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
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [stage, setStage] = useState("Starting the wardrobe");
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [galleryUrl, setGalleryUrl] = useState("");
  const [summary, setSummary] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [elapsed, setElapsed] = useState(0);
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(false);
  // Stamped in the effect below rather than here: reading the clock during
  // render is impure, and a re-render would move the run's start time.
  const startedRef = useRef(0);
  const base = `/api/wardrobe/runs/${runId}`;
  const replaying = Boolean(
    persistedOutcome && persistedOutcome !== "running" && persistedContent,
  );

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedRef.current = false;
    startedRef.current = Date.now();
  }, [runId]);

  const reportTerminal = useCallback(
    (outcome: "completed" | "failed" | "aborted", content: string) => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      if (outcome === "completed") notifyTaskCompleted(`Wardrobe — ${task.slice(0, 80)}`);
      onTerminalRef.current?.({ outcome, content });
    },
    [task],
  );

  const updatePiece = useCallback((jobId: string, patch: Partial<Piece>) => {
    setPieces((current) =>
      current.map((piece) => (piece.jobId === jobId ? { ...piece, ...patch } : piece)),
    );
  }, []);

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      switch (event.type) {
        case "run.started":
          setStatus("running");
          setStage("Starting the wardrobe");
          break;
        case "service.starting":
          setStage("Starting the wardrobe");
          break;
        case "service.ready":
          setGalleryUrl(asString(payload.galleryUrl));
          break;
        case "photo.started": {
          const index = asNumber(payload.index);
          const total = asNumber(payload.total);
          setStage(total > 1 ? `Reading photo ${index} of ${total}` : "Reading the photo");
          break;
        }
        case "photo.detected": {
          const taking = asNumber(payload.taking);
          setStage(taking ? `Found ${taking} piece${taking === 1 ? "" : "s"}` : "No clothes found");
          break;
        }
        case "photo.failed":
          setStage("A photo could not be read");
          break;
        case "item.started": {
          const jobId = asString(payload.jobId);
          if (!jobId) break;
          setPieces((current) =>
            current.some((piece) => piece.jobId === jobId)
              ? current
              : [
                  ...current,
                  {
                    jobId,
                    name: asString(payload.name, "New piece"),
                    part: asString(payload.part),
                    color: "",
                    state: "cutting",
                    note: "",
                  },
                ],
          );
          break;
        }
        case "item.stage": {
          const jobId = asString(payload.jobId);
          const which = asString(payload.stage);
          if (!jobId) break;
          updatePiece(jobId, { state: which === "modeled" ? "modeling" : "cutting" });
          setStage(
            which === "modeled"
              ? `Modelling ${asString(payload.name, "a piece")}`
              : `Cutting out ${asString(payload.name, "a piece")}`,
          );
          break;
        }
        case "item.partial": {
          const jobId = asString(payload.jobId);
          if (!jobId) break;
          // The piece is already in the wardrobe at this point — only its
          // modeled photo failed — so the note says which half is missing
          // rather than reading as a lost garment.
          updatePiece(jobId, { note: asString(payload.error) });
          break;
        }
        case "item.imported": {
          const jobId = asString(payload.jobId);
          if (!jobId) break;
          updatePiece(jobId, {
            state: payload.modeled === true ? "imported" : "cutout",
            name: asString(payload.name, "New piece"),
            part: asString(payload.part),
            color: asString(payload.color),
          });
          break;
        }
        case "item.failed": {
          const jobId = asString(payload.jobId);
          if (!jobId) break;
          updatePiece(jobId, { state: "failed", note: asString(payload.error) });
          break;
        }
        case "run.completed": {
          const content = asString(payload.summary);
          setStatus("completed");
          setGalleryUrl(asString(payload.galleryUrl) || galleryUrl);
          if (content) setSummary(content);
          reportTerminal("completed", content);
          break;
        }
        case "run.failed":
        case "run.aborted": {
          const outcome = event.type === "run.aborted" ? "aborted" : "failed";
          const message =
            asString(payload.summary) ||
            asString(payload.error) ||
            (outcome === "aborted" ? "The import was stopped." : "The wardrobe import failed.");
          setStatus(outcome);
          setFailure(message);
          reportTerminal(outcome, message);
          break;
        }
        default:
          break;
      }
    },
    [galleryUrl, reportTerminal, updatePiece],
  );

  useEffect(() => {
    // A finished run is gone from the manager's memory and its endpoint answers
    // with an error, so a replayed turn must never open a stream.
    if (replaying) return;
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        // Ignore malformed frames and keep the rest of the stream usable.
      }
    };
    STREAMED_EVENT_TYPES.forEach((type) =>
      source.addEventListener(type, handle as EventListener),
    );
    // EventSource reconnects on error by default, forever. Closing here is what
    // keeps a restored turn from hammering a dead endpoint.
    source.onerror = () => {
      resolveAgentRunStreamError({
        source,
        base,
        replayEnding: applyEvent,
        onUnavailable: (reason) => {
          setStatus("failed");
          setFailure(
            reason === "run_not_found"
              ? "This import is no longer live, but its saved result remains below."
              : "The Wardrobe event stream is unavailable.",
          );
        },
      });
    };
    return () => closeAgentRunStream(source);
  }, [applyEvent, base, replaying]);

  const terminal = TERMINAL.has(status);

  useEffect(() => {
    if (terminal) return;
    const timer = window.setInterval(
      () => setElapsed((Date.now() - startedRef.current) / 1_000),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [terminal]);

  const added = pieces.filter(
    (piece) => piece.state === "imported" || piece.state === "cutout",
  ).length;
  const terminalContent =
    summary.trim() ||
    failure.trim() ||
    (status === "aborted" ? "The import was stopped." : "The import finished.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        agentName="Wardrobe"
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={terminal ? undefined : stage}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            Wardrobe
            <span className="ml-[8px] text-[11px] font-normal text-[var(--ink-muted)]">
              {task}
            </span>
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
              {terminal ? status : `${added} added · ${formatElapsed(elapsed)}`}
            </span>
            {!terminal ? (
              <button
                type="button"
                className="bb-agent-run-action"
                onClick={() => {
                  void fetch(`${base}/abort`, { method: "POST" }).catch(() => undefined);
                }}
              >
                Stop
              </button>
            ) : null}
          </div>
        </header>

        <div className="space-y-[13px] p-[21px]">
          {/* Detection and the first cutout both take a while, and an empty card
              for a minute reads as a run that died. */}
          {!terminal && !pieces.length ? (
            <p className="bb-agent-run-label">{stage}…</p>
          ) : null}

          {pieces.length ? (
            <section className="bb-agent-run-panel p-[13px]">
              <p className="bb-agent-run-label mb-[8px]">
                Pieces · {pieces.length}
              </p>
              <ul className="space-y-[5px]">
                {pieces.map((piece) => (
                  <li
                    key={piece.jobId}
                    className="bb-agent-run-row flex items-center gap-[8px] p-[8px]"
                  >
                    <span
                      aria-hidden
                      className="h-3 w-3 shrink-0 rounded-full border border-[var(--line)]"
                      style={
                        isColor(piece.color)
                          ? { backgroundColor: piece.color }
                          : { backgroundColor: "transparent" }
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--ink-heading)]">
                      {piece.name}
                      {piece.part ? (
                        <span className="ml-[6px] text-[var(--ink-muted)]">
                          {PART_LABELS[piece.part] ?? piece.part}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`shrink-0 text-[11px] ${
                        piece.state === "failed"
                          ? "text-[var(--danger)]"
                          : "text-[var(--ink-muted)]"
                      }`}
                      title={piece.note || undefined}
                    >
                      {STATE_LABELS[piece.state]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {summary ? (
            <section className="bb-agent-run-text">
              <ChatMarkdown content={summary} compact />
            </section>
          ) : null}

          {failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}

          {/* The gallery is the clone's own app on a local port, so it is offered
              as a plain link rather than framed: it is a second window the
              person owns, not a panel of this one. */}
          {galleryUrl && added ? (
            <p className="bb-agent-run-label">
              <a
                className="underline transition-colors hover:text-[var(--ink-heading)]"
                href={galleryUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open the wardrobe
              </a>
            </p>
          ) : null}
        </div>
      </div>
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
