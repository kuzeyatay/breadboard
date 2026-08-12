"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useYoloMode } from "@/app/components/use-yolo-mode";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import type { GadgetAction } from "@/lib/hermes/gadget-types";

interface Props {
  artifact: PresentedArtifact;
}

const CHANNEL = "breadboard-gadget";

interface BridgeMessage {
  channel?: string;
  id?: number;
  kind?: string;
  binding?: string;
  operation?: string;
  payload?: unknown;
  message?: string;
  height?: number;
}

/**
 * A running gadget, plus everything it is waiting on.
 *
 * This component is the *embedder* in the bridge: the frame has an opaque
 * origin and no credentials, so it postMessages here, and this forwards to the
 * host route with the user's own session. Refusing to forward is therefore a
 * complete revocation, which is why the frame is never given a token.
 *
 * The queue is rendered directly under the gadget rather than in a separate
 * panel, because the decision only makes sense next to the thing that asked.
 */
export default function InlineGadget({ artifact }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(420);
  const [actions, setActions] = useState<GadgetAction[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yoloMode] = useYoloMode();
  const autoApprovedRef = useRef(new Set<string>());

  const documentUrl = `/api/hermes/gadgets/${encodeURIComponent(artifact.id)}/document?conversationId=${encodeURIComponent(artifact.conversationId)}`;

  const refreshActions = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/hermes/gadgets/${encodeURIComponent(artifact.id)}/actions?conversationId=${encodeURIComponent(artifact.conversationId)}`,
      );
      const body = await response.json();
      if (body?.ok) setActions(body.result.actions ?? []);
    } catch {
      // A failed refresh must not tear the gadget down; the next one retries.
    }
  }, [artifact.id, artifact.conversationId]);

  useEffect(() => {
    void refreshActions();
  }, [refreshActions]);

  // Bridge. Every message is checked to come from this gadget's own frame
  // before it is forwarded, so another frame on the page cannot borrow it.
  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const frame = frameRef.current;
      const data = event.data as BridgeMessage | null;
      if (
        !frame ||
        event.source !== frame.contentWindow ||
        event.origin !== "null" ||
        !data ||
        data.channel !== CHANNEL
      ) {
        return;
      }

      if (data.kind === "ready") {
        const next = Number(data.height);
        if (Number.isFinite(next)) setHeight(Math.max(200, Math.min(900, next)));
        return;
      }
      if (data.kind === "log") {
        setLogs((current) => [...current.slice(-19), String(data.message ?? "")]);
        return;
      }
      if (data.kind !== "observe" && data.kind !== "act") return;

      let reply: { id?: number; channel: string; result?: unknown; error?: string };
      try {
        const response = await fetch(
          `/api/hermes/gadgets/${encodeURIComponent(artifact.id)}/host`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId: artifact.conversationId,
              kind: data.kind,
              binding: data.binding,
              operation: data.operation,
              payload: data.payload,
            }),
          },
        );
        const body = await response.json();
        reply = body?.ok
          ? { id: data.id, channel: CHANNEL, result: body.result }
          : { id: data.id, channel: CHANNEL, error: body?.error ?? "The call was refused." };
        // A queued write is new work for the user, so surface it immediately.
        if (body?.ok && data.kind === "act") void refreshActions();
      } catch (cause) {
        reply = {
          id: data.id,
          channel: CHANNEL,
          error: cause instanceof Error ? cause.message : "The call failed.",
        };
      }
      frame.contentWindow?.postMessage(reply, "*");
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [artifact.id, artifact.conversationId, refreshActions]);

  const decide = useCallback(
    async (actionId: string, decision: "approve" | "reject" | "revert" | "retry") => {
      setBusy(actionId);
      setError(null);
      try {
        const response = await fetch(
          `/api/hermes/gadgets/${encodeURIComponent(artifact.id)}/actions/${encodeURIComponent(actionId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: artifact.conversationId, decision }),
          },
        );
        const body = await response.json();
        if (!body?.ok) setError(body?.error ?? "That decision could not be recorded.");
        await refreshActions();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That decision could not be recorded.");
      } finally {
        setBusy(null);
      }
    },
    [artifact.id, artifact.conversationId, refreshActions],
  );

  const pending = actions.filter((action) => action.status === "pending");
  const nextPendingActionId = pending[0]?.id;
  useEffect(() => {
    if (!yoloMode || !nextPendingActionId || busy !== null) return;
    if (autoApprovedRef.current.has(nextPendingActionId)) return;
    autoApprovedRef.current.add(nextPendingActionId);
    void decide(nextPendingActionId, "approve");
  }, [busy, decide, nextPendingActionId, yoloMode]);

  if (artifact.status !== "ready") {
    return (
      <div className="mt-3 flex items-center gap-2 py-2 text-xs text-[var(--ink-muted)]" role="status">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--botanical)]" />
        {artifact.status === "failed"
          ? `${artifact.title} could not be built.`
          : `Building ${artifact.title}…`}
      </div>
    );
  }

  const settled = actions.filter((action) => action.status !== "pending").slice(0, 6);

  return (
    <article className="relative mt-3 min-w-0" aria-label={`${artifact.title} gadget`}>
      <iframe
        ref={frameRef}
        title={`${artifact.title} gadget`}
        sandbox="allow-scripts"
        allow=""
        referrerPolicy="no-referrer"
        src={documentUrl}
        style={{ height }}
        className="block w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)]"
      />

      {pending.length > 0 ? (
        <section
          className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3"
          aria-label="Actions waiting for your approval"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            {pending.length === 1
              ? "This gadget wants to do one thing"
              : `This gadget wants to do ${pending.length} things`}
          </h3>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            None of these have happened yet. Each shows what it would do.
          </p>
          <ul className="mt-3 space-y-3">
            {pending.map((action) => (
              <li key={action.id} className="rounded-lg border border-[var(--line)] p-3">
                <p className="text-sm font-medium text-[var(--ink-heading)]">
                  {action.description.title}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--ink-body)]">
                  {action.description.description}
                </p>

                <details className="mt-2" open>
                  <summary className="cursor-pointer text-xs font-medium text-[var(--ink-muted)]">
                    What would happen
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--ink-body)]">
                    {action.simulation.outcome}
                  </p>
                  {action.simulation.changes.length > 0 ? (
                    <dl className="mt-2 space-y-1">
                      {action.simulation.changes.map((change) => (
                        <div key={change.field} className="flex gap-2 text-xs">
                          <dt className="min-w-24 font-medium text-[var(--ink-muted)]">
                            {change.field}
                          </dt>
                          <dd className="text-[var(--ink-body)]">
                            {change.before === null ? (
                              <span>{change.after}</span>
                            ) : (
                              <>
                                <span className="line-through opacity-60">{change.before}</span>
                                {" → "}
                                <span>{change.after}</span>
                              </>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </details>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy === action.id}
                    onClick={() => void decide(action.id, "approve")}
                    className="neu-button rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-heading)] disabled:opacity-50"
                  >
                    {busy === action.id ? "Working…" : "Do it"}
                  </button>
                  <button
                    type="button"
                    disabled={busy === action.id}
                    onClick={() => void decide(action.id, "reject")}
                    className="neu-button rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-muted)] disabled:opacity-50"
                  >
                    Never mind
                  </button>
                  {action.description.implementsRevert ? (
                    <span className="text-[0.7rem] text-[var(--ink-muted)]">Can be undone</span>
                  ) : (
                    <span className="text-[0.7rem] text-[var(--ink-muted)]">Cannot be undone</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {settled.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-[var(--ink-muted)]">
            Earlier actions ({settled.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {settled.map((action) => (
              <li key={action.id} className="flex items-baseline gap-2 text-xs">
                <span className="text-[var(--ink-muted)]">{action.status}</span>
                <span className="text-[var(--ink-body)]">{action.description.title}</span>
                {action.status === "applied" && action.description.implementsRevert ? (
                  <button
                    type="button"
                    onClick={() => void decide(action.id, "revert")}
                    className="text-[var(--ink-muted)] underline"
                  >
                    undo
                  </button>
                ) : null}
                {action.status === "failed" ? (
                  <button
                    type="button"
                    onClick={() => void decide(action.id, "retry")}
                    className="text-[var(--ink-muted)] underline"
                  >
                    try again
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-[var(--ink-muted)]" role="alert">
          {error}
        </p>
      ) : null}

      {logs.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-[var(--ink-muted)]">
            Gadget log ({logs.length})
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[0.7rem] text-[var(--ink-muted)]">
            {logs.join("\n")}
          </pre>
        </details>
      ) : null}
    </article>
  );
}
