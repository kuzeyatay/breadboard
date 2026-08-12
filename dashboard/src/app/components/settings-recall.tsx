"use client";

// Settings → Recall: the local record of what happened on this computer, and
// the limits on it.
//
// This tab is unusual among Settings sections in that switching something on
// here starts recording the user's screen. So it is written to be answerable at
// a glance in the order a person actually worries: is it recording right now,
// what is it forbidden to see, and what can the agent read back. The preview
// search at the bottom exists for the same reason — "what can my agent see
// about me" should be answerable by looking, not by trusting this copy.

import { useCallback, useEffect, useMemo, useState } from "react";

const ACTIVE_POLL_MS = 3_000;
const INSTALL_POLL_MS = 2_000;

const fieldClass =
  "neu-inset w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--botanical)]/15";
const secondaryButton =
  "neu-button rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-45";

type ControlMode = "ask" | "allow" | "never";

interface RecallSettingsPayload {
  captureEnabled: boolean;
  autoStartCapture: boolean;
  captureAudio: boolean;
  agentAccess: boolean;
  agentControl: ControlMode;
  excludedWindows: string[];
  defaultLookbackHours: number;
  maxResults: number;
}

interface RecallStatusPayload {
  enabled: boolean;
  supported: boolean;
  install: { installed: boolean; version: string | null; pinnedVersion: string; supported: boolean };
  installStatus: { phase: string; message: string; stalled: boolean } | null;
  process: { running: boolean; startedAt: string | null; managed: boolean };
  reachable: boolean;
  health: {
    status: string;
    frameStatus?: string;
    audioStatus?: string;
    lastFrameTimestamp?: string | null;
    lastAudioTimestamp?: string | null;
  } | null;
  settings: RecallSettingsPayload;
  logTail: string[];
}

interface RecallSearchHit {
  kind: string;
  timestamp: string | null;
  app: string | null;
  window: string | null;
  speaker: string | null;
  text: string;
}

/** A clock face in the same line weight as the other Settings icons. */
export function RecallIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}

function relativeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const seconds = Math.round((Date.now() - parsed) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function SettingsRecall() {
  const [status, setStatus] = useState<RecallStatusPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exclusionDraft, setExclusionDraft] = useState<string | null>(null);
  const [previewQuery, setPreviewQuery] = useState("");
  const [preview, setPreview] = useState<{ summary: string; hits: RecallSearchHit[] } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/recall/status", { cache: "no-store" });
      if (!response.ok) return null;
      const payload = (await response.json()) as { status?: RecallStatusPayload };
      if (payload.status) setStatus(payload.status);
      return payload.status ?? null;
    } catch {
      return null;
    }
  }, []);

  const installing = status?.installStatus?.phase === "installing" && !status.installStatus.stalled;

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const next = await refresh();
      if (cancelled) return next;
      return next;
    };
    void tick();
    // While npm is downloading, poll faster so the phase message actually moves.
    const timer = setInterval(() => void tick(), installing ? INSTALL_POLL_MS : ACTIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh, installing]);

  const patchSettings = useCallback(
    async (patch: Partial<RecallSettingsPayload>, label: string) => {
      setBusy(label);
      setError(null);
      try {
        const response = await fetch("/api/recall/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(payload.error ?? "That did not work.");
          return;
        }
        await refresh();
      } catch {
        setError("Breadboard could not save that.");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const post = useCallback(
    async (url: string, body: Record<string, unknown> | undefined, label: string) => {
      setBusy(label);
      setError(null);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(payload.error ?? "That did not work.");
          return false;
        }
        await refresh();
        return true;
      } catch {
        setError("Breadboard could not reach the capture engine.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const runPreview = useCallback(async () => {
    setBusy("preview");
    setError(null);
    try {
      const response = await fetch("/api/recall/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: previewQuery.trim() || undefined, limit: 5 }),
      });
      const payload = (await response.json()) as {
        error?: string;
        result?: { summary: string; hits: RecallSearchHit[] };
      };
      if (!response.ok || !payload.result) {
        setError(payload.error ?? "That search did not work.");
        setPreview(null);
        return;
      }
      setPreview(payload.result);
    } catch {
      setError("Breadboard could not reach the capture engine.");
    } finally {
      setBusy(null);
    }
  }, [previewQuery]);

  const settings = status?.settings;
  const exclusionsValue = useMemo(
    () => exclusionDraft ?? (settings?.excludedWindows ?? []).join("\n"),
    [exclusionDraft, settings?.excludedWindows],
  );

  if (status === null) {
    return <p className="py-8 text-center text-sm text-[var(--ink-muted)]">Checking…</p>;
  }
  if (!status.enabled) {
    return (
      <p className="rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-3 text-sm text-[var(--ink-muted)]">
        Recall is switched off in this build (RECALL_ENABLED).
      </p>
    );
  }
  if (!status.supported) {
    return (
      <p className="rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-3 text-sm text-[var(--ink-muted)]">
        Recall has no capture engine for this operating system, so there is nothing to
        record with here.
      </p>
    );
  }

  const recording = status.reachable && status.health?.status !== "unhealthy";
  const lastFrame = relativeTime(status.health?.lastFrameTimestamp);
  const lastAudio = relativeTime(status.health?.lastAudioTimestamp);

  return (
    <div className="space-y-5">
      {/* --- What is happening right now ---------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
            recording
              ? "border-[rgba(79,128,94,0.45)] text-[#315c40]"
              : status.installStatus?.stalled
                ? "border-[color-mix(in_srgb,var(--danger)_40%,var(--line))] text-[var(--danger)]"
                : "border-[var(--line)] text-[var(--ink-muted)]"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              recording ? "bg-[#4F805E]" : "bg-[var(--ink-muted)]"
            }`}
          />
          {recording ? "Recording" : status.process.running ? "Starting" : "Not recording"}
        </span>
        {recording && lastFrame ? (
          <span className="text-xs text-[var(--ink-muted)]">
            Last screen capture {lastFrame}
            {lastAudio ? ` · last audio ${lastAudio}` : ""}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_32%,var(--line))] bg-[var(--paper-raised)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {/* --- Install, then start ------------------------------------------ */}
      {!status.install.installed ? (
        <section className="space-y-3 rounded-2xl border border-[var(--line)] p-4">
          <div>
            <h3 className="text-sm font-medium text-[var(--ink-heading)]">
              Install the capture engine
            </h3>
            <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
              About 130 MB, downloaded once and kept inside Breadboard&rsquo;s own folder.
              Nothing is recorded until you switch capture on below.
            </p>
          </div>
          {status.installStatus ? (
            <p
              className={`text-xs ${
                status.installStatus.stalled ? "text-[var(--danger)]" : "text-[var(--ink-muted)]"
              }`}
            >
              {status.installStatus.stalled
                ? "The install stopped responding. Try again."
                : status.installStatus.message}
            </p>
          ) : null}
          <button
            type="button"
            className={secondaryButton}
            disabled={busy !== null || installing}
            onClick={() => void post("/api/recall/install", undefined, "install")}
          >
            {installing ? "Installing…" : "Install"}
          </button>
        </section>
      ) : null}

      {/* --- Capture ------------------------------------------------------- */}
      <section className="space-y-3 rounded-2xl border border-[var(--line)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-[var(--ink-heading)]">Capture</h3>
            <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
              Records this computer&rsquo;s screen and microphone to a local index. Nothing
              leaves the machine, and stopping capture leaves what was already recorded
              in place.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Allow capture"
            aria-checked={settings?.captureEnabled ?? false}
            disabled={busy !== null || !status.install.installed}
            onClick={() =>
              void patchSettings({ captureEnabled: !settings?.captureEnabled }, "captureEnabled")
            }
            className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition ${
              settings?.captureEnabled ? "bg-[var(--botanical)]" : "bg-[var(--line-strong)]"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform ${
                settings?.captureEnabled ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={secondaryButton}
            disabled={busy !== null || !settings?.captureEnabled || status.process.running}
            onClick={() => void post("/api/recall/control", { action: "start" }, "start")}
          >
            Start recording
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={busy !== null || !status.process.running}
            onClick={() => void post("/api/recall/control", { action: "stop" }, "stop")}
          >
            Stop recording
          </button>
          <label className="ml-auto inline-flex items-center gap-2 text-xs text-[var(--ink-muted)]">
            <input
              type="checkbox"
              checked={settings?.captureAudio ?? true}
              disabled={busy !== null}
              onChange={(event) =>
                void patchSettings({ captureAudio: event.target.checked }, "captureAudio")
              }
            />
            Record audio too
          </label>
        </div>

        <label className="flex items-start gap-2 text-xs text-[var(--ink-muted)]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings?.autoStartCapture ?? false}
            disabled={busy !== null || !settings?.captureEnabled}
            onChange={(event) =>
              void patchSettings({ autoStartCapture: event.target.checked }, "autoStartCapture")
            }
          />
          <span>
            Start recording whenever Breadboard opens
            {settings?.captureEnabled ? (
              ", without asking again."
            ) : (
              <> &mdash; available once capture is switched on above.</>
            )}
          </span>
        </label>

        {status.process.running && settings ? (
          <p className="text-xs text-[var(--ink-muted)]">
            Changes to audio and exclusions apply the next time capture starts.
          </p>
        ) : null}

        {!status.reachable && status.logTail.length > 0 ? (
          <details className="text-xs text-[var(--ink-muted)]">
            <summary className="cursor-pointer">The engine started but is not answering</summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] leading-4">
              {status.logTail.join("\n")}
            </pre>
          </details>
        ) : null}
      </section>

      {/* --- Never record -------------------------------------------------- */}
      <section className="space-y-3 rounded-2xl border border-[var(--line)] p-4">
        <div>
          <h3 className="text-sm font-medium text-[var(--ink-heading)]">Never record</h3>
          <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
            One app or window per line. Matched anywhere in the app name or window title;
            write <code>Slack::#hr</code> to exclude a single channel, or{" "}
            <code>1Password</code> to exclude an app entirely. Anything listed here is also
            filtered out of past recordings when the agent reads them back.
          </p>
        </div>
        <textarea
          className={`${fieldClass} min-h-[5.5rem] font-mono text-xs`}
          value={exclusionsValue}
          spellCheck={false}
          onChange={(event) => setExclusionDraft(event.target.value)}
          placeholder={"1Password\nSlack::#hr\nBank"}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={secondaryButton}
            disabled={busy !== null || exclusionDraft === null}
            onClick={() => {
              const next = (exclusionDraft ?? "")
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
              setExclusionDraft(null);
              void patchSettings({ excludedWindows: next }, "excludedWindows");
            }}
          >
            Save exclusions
          </button>
          {exclusionDraft !== null ? (
            <button
              type="button"
              className="text-xs text-[var(--ink-muted)] underline"
              onClick={() => setExclusionDraft(null)}
            >
              Discard
            </button>
          ) : null}
        </div>
      </section>

      {/* --- What the agent may do ----------------------------------------- */}
      <section className="space-y-3 rounded-2xl border border-[var(--line)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-[var(--ink-heading)]">Your agent</h3>
            <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
              Lets chats answer questions about your own day &mdash; what you were working
              on, what someone said in a meeting. Turning this off takes effect on the very
              next question.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Let the agent read Recall history"
            aria-checked={settings?.agentAccess ?? false}
            disabled={busy !== null}
            onClick={() =>
              void patchSettings({ agentAccess: !settings?.agentAccess }, "agentAccess")
            }
            className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition ${
              settings?.agentAccess ? "bg-[var(--botanical)]" : "bg-[var(--line-strong)]"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform ${
                settings?.agentAccess ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs text-[var(--ink-muted)]">
            Starting and stopping capture
            <select
              className={`${fieldClass} mt-1`}
              value={settings?.agentControl ?? "ask"}
              disabled={busy !== null}
              onChange={(event) =>
                void patchSettings(
                  { agentControl: event.target.value as ControlMode },
                  "agentControl",
                )
              }
            >
              <option value="ask">Ask me first</option>
              <option value="allow">Allow without asking</option>
              <option value="never">Never</option>
            </select>
          </label>
          <label className="text-xs text-[var(--ink-muted)]">
            Default window searched
            <select
              className={`${fieldClass} mt-1`}
              value={String(settings?.defaultLookbackHours ?? 24)}
              disabled={busy !== null}
              onChange={(event) =>
                void patchSettings(
                  { defaultLookbackHours: Number(event.target.value) },
                  "defaultLookbackHours",
                )
              }
            >
              <option value="1">Last hour</option>
              <option value="8">Last 8 hours</option>
              <option value="24">Last day</option>
              <option value="168">Last week</option>
              <option value="720">Last month</option>
            </select>
          </label>
          <label className="text-xs text-[var(--ink-muted)]">
            Results per answer
            <select
              className={`${fieldClass} mt-1`}
              value={String(settings?.maxResults ?? 10)}
              disabled={busy !== null}
              onChange={(event) =>
                void patchSettings({ maxResults: Number(event.target.value) }, "maxResults")
              }
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </label>
        </div>
      </section>

      {/* --- See it for yourself -------------------------------------------- */}
      <section className="space-y-3 rounded-2xl border border-[var(--line)] p-4">
        <div>
          <h3 className="text-sm font-medium text-[var(--ink-heading)]">
            See what your agent would see
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
            Runs exactly the search a chat would run, with the same limits and exclusions.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            className={fieldClass}
            value={previewQuery}
            placeholder="Leave empty for everything in the window"
            onChange={(event) => setPreviewQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void runPreview();
            }}
          />
          <button
            type="button"
            className={secondaryButton}
            disabled={busy !== null || !status.reachable}
            onClick={() => void runPreview()}
          >
            Search
          </button>
        </div>
        {preview ? (
          <div className="space-y-2">
            <p className="text-xs text-[var(--ink-muted)]">{preview.summary}</p>
            {preview.hits.map((hit, index) => (
              <div
                key={`${hit.timestamp ?? "?"}-${index}`}
                className="rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2"
              >
                <p className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">
                  {hit.kind === "audio" ? "Audio" : "Screen"}
                  {hit.app ? ` · ${hit.app}` : ""}
                  {hit.speaker ? ` · ${hit.speaker}` : ""}
                  {hit.timestamp ? ` · ${relativeTime(hit.timestamp) ?? hit.timestamp}` : ""}
                </p>
                <p className="mt-1 line-clamp-4 text-xs leading-5 text-[var(--ink)]">{hit.text}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
