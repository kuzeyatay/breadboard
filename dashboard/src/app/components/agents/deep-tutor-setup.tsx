"use client";

// Deep Tutor setup: whether the cloned tutor can run, what it would be allowed
// to read, and the steps only the user can authorize. A run never installs
// anything — the environment is close to a gigabyte of Python, and that is a
// decision worth asking for rather than taking.

import { useCallback, useEffect, useState } from "react";

interface Health {
  available: boolean;
  cloned: boolean;
  root: string | null;
  environmentReady: boolean;
  packageInstalled: boolean;
  mcpInstalled: boolean;
  uvAvailable: boolean;
  version: string | null;
  bridgeFound: boolean;
  fileServerFound: boolean;
  reason: string | null;
  scope: { kind: string; label: string; rootCount: number } | null;
  index: IndexInfo | null;
  embeddings: { available: boolean; model: string; reason: string | null } | null;
}

interface IndexInfo {
  phase: "ready" | "stale" | "missing" | "building" | "unsupported" | "failed";
  documentCount: number;
  chunkCount: number;
  candidateCount: number;
  builtAt: string | null;
  error: string | null;
  progress: { stage: string; percent: number; elapsedSec: number } | null;
}

/** What the index means for the next question, said without jargon. */
function indexLine(index: IndexInfo | null, embeddings: Health["embeddings"]): string {
  if (!index) return "…";
  if (index.phase === "unsupported") {
    return "The Terminal reads files directly, so there is no index to build.";
  }
  if (index.phase === "building") {
    const progress = index.progress;
    const percent = progress?.percent ? ` · ${Math.round(progress.percent)}%` : "";
    return `Indexing now${percent}. Questions still work — they read the files until it finishes.`;
  }
  if (embeddings && !embeddings.available) {
    return embeddings.reason ?? "Retrieval is unavailable.";
  }
  if (index.phase === "ready") {
    return `${index.documentCount} file${index.documentCount === 1 ? "" : "s"} indexed${
      index.chunkCount ? ` in ${index.chunkCount} passages` : ""
    }. Questions are answered by meaning, not just wording.`;
  }
  if (index.phase === "failed") {
    return index.error ?? "The last index attempt failed.";
  }
  if (index.phase === "stale") {
    return `Your notes changed since the index was built. ${index.candidateCount} file${index.candidateCount === 1 ? "" : "s"} will be re-indexed on the next question.`;
  }
  return index.candidateCount
    ? `Not indexed yet. ${index.candidateCount} file${index.candidateCount === 1 ? "" : "s"} will be indexed on the next question.`
    : "There is nothing to index in this Garden yet.";
}

const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Build environment",
    unlocks: "Creates DeepTutor/.venv and installs the tutor. Takes several minutes and about a gigabyte.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls into the existing environment.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks: "Deletes DeepTutor/.venv. Nothing else in the clone is touched.",
  },
  {
    id: "reindex",
    label: "Rebuild index",
    unlocks: "Re-reads every file in this Garden and rebuilds its search index.",
  },
  {
    id: "forget",
    label: "Forget this scope",
    unlocks: "Clears what the tutor remembers about the Garden or workspace you are in.",
  },
] as const;

function statusOf(health: Health | null): { label: string; ready: boolean } {
  if (!health) return { label: "Checking clone", ready: false };
  if (!health.cloned) return { label: "Not cloned", ready: false };
  if (!health.environmentReady) return { label: "Needs setup", ready: false };
  if (!health.packageInstalled) return { label: "Install incomplete", ready: false };
  if (!health.mcpInstalled) return { label: "Cannot read files", ready: false };
  return { label: "Ready", ready: true };
}

export default function DeepTutorSetup({ gardenSlug }: { gardenSlug?: string | null }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const query = gardenSlug ? `?gardenSlug=${encodeURIComponent(gardenSlug)}` : "";

  const load = useCallback(
    async (refresh = false, signal?: AbortSignal) => {
      try {
        const separator = query ? "&" : "?";
        const response = await fetch(
          `/api/deep-tutor/health${query}${refresh ? `${separator}force=1` : ""}`,
          { cache: "no-store", signal },
        );
        const payload = (await response.json()) as Partial<Health>;
        if (!response.ok) throw new Error("Deep Tutor status is unavailable.");
        setHealth({
          available: payload.available === true,
          cloned: payload.cloned === true,
          root: typeof payload.root === "string" ? payload.root : null,
          environmentReady: payload.environmentReady === true,
          packageInstalled: payload.packageInstalled === true,
          mcpInstalled: payload.mcpInstalled === true,
          uvAvailable: payload.uvAvailable === true,
          version: typeof payload.version === "string" ? payload.version : null,
          bridgeFound: payload.bridgeFound === true,
          fileServerFound: payload.fileServerFound === true,
          reason: typeof payload.reason === "string" ? payload.reason : null,
          scope: payload.scope ?? null,
          index: payload.index ?? null,
          embeddings: payload.embeddings ?? null,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHealth({
          available: false,
          cloned: false,
          root: null,
          environmentReady: false,
          packageInstalled: false,
          mcpInstalled: false,
          uvAvailable: false,
          version: null,
          bridgeFound: false,
          fileServerFound: false,
          reason: error instanceof Error ? error.message : "Deep Tutor status is unavailable.",
          scope: null,
          index: null,
          embeddings: null,
        });
      }
    },
    [query],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  // An index build runs for minutes in the background. Without this the panel
  // would sit on "Indexing now" until the dialog was reopened.
  useEffect(() => {
    if (health?.index?.phase !== "building") return;
    const timer = window.setInterval(() => void load(), 4_000);
    return () => window.clearInterval(timer);
  }, [health?.index?.phase, load]);

  async function runSetup(action: (typeof SETUP_ACTIONS)[number]) {
    setRunning(action.id);
    setNotice(
      action.id === "install"
        ? "Building the environment. This takes several minutes — you can close this panel."
        : `${action.label}…`,
    );
    setDetail("");
    try {
      const response = await fetch("/api/deep-tutor/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: action.id, gardenSlug: gardenSlug ?? "" }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: { ok?: boolean; message?: string; detail?: string };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "That setup step could not run.");
      }
      setNotice(payload.result?.message ?? `${action.label} finished.`);
      setDetail(payload.result?.ok === false ? (payload.result.detail ?? "") : "");
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That setup step could not run.");
    } finally {
      setRunning(null);
    }
  }

  const status = statusOf(health);
  const scope = health?.scope;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] ${
            status.ready
              ? "bg-[var(--paper-strong)] text-[var(--botanical)]"
              : "bg-[#f5e8df] text-[#9a4e43] dark:bg-[#4c302c] dark:text-[#efb4aa]"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${status.ready ? "bg-[var(--botanical)]" : "bg-current"}`}
          />
          {status.label}
        </span>
        <span className="text-[11px] text-[var(--ink-muted)]">
          {health?.version ? `DeepTutor ${health.version}` : "Cloned DeepTutor"}
        </span>
      </div>

      {/* What the tutor would be allowed to read from here. This is the whole
          point of the agent, so it is stated before anything technical. */}
      <p className="neu-surface-subtle rounded-xl px-3 py-2 text-[11px] leading-5 text-[var(--ink-muted)]">
        <span className="font-medium text-[var(--ink-heading)]">Reads</span>{" "}
        {scope
          ? scope.rootCount === 0
            ? `nothing yet — ${scope.label} has no files on disk.`
            : scope.kind === "garden"
              ? `${scope.label} — its notes, folders and files, and nothing outside it.`
              : `${scope.label} — the whole Breadboard workspace${scope.rootCount > 1 ? ` and ${scope.rootCount - 1} granted folder${scope.rootCount === 2 ? "" : "s"}` : ""}.`
          : "…"}
      </p>

      {/* Retrieval is the other half of "what can it read": the scope says
          which files, this says whether it can search them by meaning. */}
      <p className="neu-surface-subtle rounded-xl px-3 py-2 text-[11px] leading-5 text-[var(--ink-muted)]">
        <span className="font-medium text-[var(--ink-heading)]">Search index</span>{" "}
        {indexLine(health?.index ?? null, health?.embeddings ?? null)}
      </p>

      {health?.root ? (
        <p className="neu-surface-subtle truncate rounded-xl px-3 py-2 text-[11px] text-[var(--ink-muted)]">
          <span className="font-medium text-[var(--ink-heading)]">Clone</span> {health.root}
        </p>
      ) : null}

      {health?.reason ? (
        <p className="text-[11px] leading-5 text-[#9a4e43] dark:text-[#efb4aa]">{health.reason}</p>
      ) : null}
      {health?.cloned && !health.uvAvailable && !health.environmentReady ? (
        <p className="text-[11px] leading-5 text-[var(--ink-muted)]">
          Building the environment needs uv, because the tutor requires Python 3.11–3.13 and uv
          fetches a matching one. Install it from docs.astral.sh/uv, then reopen this panel.
        </p>
      ) : null}

      {health?.cloned ? (
        <div className="flex flex-wrap gap-2">
          {SETUP_ACTIONS.map((action) => {
            const done = action.id === "install" && health.packageInstalled && health.mcpInstalled;
            const hidden = action.id === "remove" && !health.environmentReady;
            if (hidden) return null;
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => void runSetup(action)}
                disabled={Boolean(running)}
                title={action.unlocks}
                className="neu-button rounded-xl px-3 py-2 text-xs text-[var(--ink-heading)] disabled:opacity-50"
              >
                {running === action.id ? "Working…" : done ? `${action.label} ✓` : action.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {notice ? (
        <p className="text-[11px] leading-5 text-[var(--botanical)]" role="status">
          {notice}
        </p>
      ) : null}
      {detail ? (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--paper-strong)] p-2 text-[10px] leading-4 text-[var(--ink-muted)]">
          {detail}
        </pre>
      ) : null}
    </div>
  );
}
