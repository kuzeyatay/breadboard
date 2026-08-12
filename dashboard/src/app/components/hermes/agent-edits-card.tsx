"use client";

import { useCallback, useEffect, useState } from "react";
import type { ExternalAgentEdits } from "@/lib/conversations/external-agent-runs.ts";

/**
 * What a coding agent changed, and the way back. The file list and diffs are
 * always fetched fresh from the run's two snapshots, so this stays truthful for
 * as long as the message exists.
 */

interface EditedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
}

interface EditsSummary {
  files: EditedFile[];
  filesChanged: number;
  additions: number;
  deletions: number;
}

const COLLAPSED_FILE_COUNT = 3;

function countLabel(value: number): string {
  return value.toLocaleString("en-US");
}

function splitPath(filePath: string): { directory: string; name: string } {
  const index = filePath.lastIndexOf("/");
  return index === -1
    ? { directory: "", name: filePath }
    : { directory: filePath.slice(0, index + 1), name: filePath.slice(index + 1) };
}

function PatchView({ patch }: { patch: string }) {
  return (
    <pre className="bb-agent-run-inset bb-agent-run-readout mt-[5px] max-h-80 overflow-auto p-[13px]">
      {patch.split("\n").map((line, index) => (
        <div
          key={index}
          className={
            line.startsWith("+") && !line.startsWith("+++")
              ? "text-[var(--botanical)]"
              : line.startsWith("-") && !line.startsWith("---")
                ? "text-[var(--danger)]"
                : "text-[var(--ink-muted)]"
          }
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

export default function AgentEditsCard({
  gardenSlug,
  edits,
  agentName,
}: {
  gardenSlug: string;
  edits: ExternalAgentEdits;
  agentName: string;
}) {
  const [summary, setSummary] = useState<EditsSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [patches, setPatches] = useState<Record<string, string>>({});
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState<{ restored: number; skipped: string[] } | null>(null);
  const [error, setError] = useState("");

  const query = `gardenSlug=${encodeURIComponent(gardenSlug)}&before=${edits.before}&after=${edits.after}`;

  const loadSummary = useCallback(async () => {
    const response = await fetch(`/api/agent-edits?${query}`);
    const data = (await response.json().catch(() => ({}))) as Partial<EditsSummary> & {
      error?: string;
    };
    if (!response.ok || !Array.isArray(data.files)) {
      throw new Error(data.error ?? "The changed files could not be read.");
    }
    return data as EditsSummary;
  }, [query]);

  useEffect(() => {
    let active = true;
    loadSummary()
      .then((next) => {
        if (active) setSummary(next);
      })
      .catch(() => {
        if (active) setSummary(null);
      });
    return () => {
      active = false;
    };
  }, [loadSummary]);

  async function openPatch(filePath: string) {
    setOpenFile((current) => (current === filePath ? null : filePath));
    if (patches[filePath]) return;
    try {
      const response = await fetch(`/api/agent-edits?${query}&path=${encodeURIComponent(filePath)}`);
      const data = (await response.json().catch(() => ({}))) as {
        patch?: string;
        error?: string;
      };
      if (!response.ok || typeof data.patch !== "string") {
        throw new Error(data.error ?? "That diff could not be read.");
      }
      setPatches((current) => ({ ...current, [filePath]: data.patch as string }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That diff could not be read.");
    }
  }

  async function undo() {
    if (undoing) return;
    setUndoing(true);
    setError("");
    try {
      const response = await fetch("/api/agent-edits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "undo", gardenSlug, ...edits }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        restored?: string[];
        skipped?: string[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.restored)) {
        throw new Error(data.error ?? "These changes could not be reverted.");
      }
      setUndone({ restored: data.restored.length, skipped: data.skipped ?? [] });
      setSummary(await loadSummary().catch(() => summary!));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "These changes could not be reverted.");
    } finally {
      setUndoing(false);
    }
  }

  if (!summary || summary.filesChanged === 0) return null;

  const visible = expanded ? summary.files : summary.files.slice(0, COLLAPSED_FILE_COUNT);
  const hidden = summary.files.length - visible.length;

  return (
    <section className="bb-agent-run-card mt-[13px] space-y-[8px] p-[21px] text-[13px]">
      {/* One line: what changed, by how much, and the two things you can do
          about it. The label already says "files", so no icon repeats it. */}
      <header className="flex flex-wrap items-center gap-x-[8px] gap-y-[5px]">
        <p className="bb-agent-run-title min-w-0">
          {undone ? "Reverted" : "Edited"} {countLabel(summary.filesChanged)}{" "}
          {summary.filesChanged === 1 ? "file" : "files"}
          <span className="ml-[8px] font-normal tabular-nums">
            <span className="text-[var(--botanical)]">+{countLabel(summary.additions)}</span>{" "}
            <span className="text-[var(--danger)]">-{countLabel(summary.deletions)}</span>
          </span>
        </p>
        <div className="ml-auto flex items-center gap-[5px]">
          {!undone ? (
            <button
              type="button"
              onClick={undo}
              disabled={undoing}
              className="bb-agent-run-action"
            >
              {undoing ? "Reverting…" : "Undo"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setReviewing((current) => !current);
              setExpanded(true);
            }}
            aria-expanded={reviewing}
            className="bb-agent-run-action"
          >
            {reviewing ? "Close" : "Review"}
          </button>
        </div>
      </header>

      <ul className="space-y-1">
        {visible.map((file) => {
          const { directory, name } = splitPath(file.path);
          const open = openFile === file.path;
          return (
            <li key={file.path}>
              <button
                type="button"
                onClick={() => openPatch(file.path)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-[var(--paper-strong)]"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-[var(--ink-muted)]">{directory}</span>
                  <span className="font-medium text-[var(--ink-heading)]">{name}</span>
                  {file.status !== "modified" ? (
                    <span className="ml-[8px] text-[11px] text-[var(--ink-muted)]">
                      {file.status}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums">
                  {file.binary ? (
                    <span className="text-[var(--ink-muted)]">binary</span>
                  ) : (
                    <>
                      <span className="text-[var(--botanical)]">+{countLabel(file.additions)}</span>{" "}
                      <span className="text-[var(--danger)]">-{countLabel(file.deletions)}</span>
                    </>
                  )}
                </span>
              </button>
              {(open || reviewing) && !file.binary ? (
                patches[file.path] ? (
                  <PatchView patch={patches[file.path]} />
                ) : reviewing && !open ? (
                  <button
                    type="button"
                    onClick={() => openPatch(file.path)}
                    className="bb-agent-run-label px-1 underline-offset-2 hover:underline"
                  >
                    Show diff
                  </button>
                ) : (
                  <p className="bb-agent-run-label px-1">Loading diff…</p>
                )
              ) : null}
            </li>
          );
        })}
      </ul>

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1 px-1 text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-heading)]"
        >
          Show {countLabel(hidden)} more {hidden === 1 ? "file" : "files"}
          <svg aria-hidden className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </button>
      ) : null}

      {undone ? (
        <p className="px-1 text-[var(--ink-muted)]">
          Put back {countLabel(undone.restored)}{" "}
          {undone.restored === 1 ? "file" : "files"} to the state before {agentName} ran.
          {undone.skipped.length
            ? ` Left ${countLabel(undone.skipped.length)} ${
                undone.skipped.length === 1 ? "file" : "files"
              } alone — edited since the run: ${undone.skipped.join(", ")}.`
            : ""}
        </p>
      ) : null}
      {error ? <p className="px-1 text-[var(--danger)]">{error}</p> : null}
    </section>
  );
}
