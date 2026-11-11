"use client";
// Components the installer leaves out because they would not fit a Windows
// installer: each row says what it is, how big it is, whether it is installed,
// and offers the one action that changes that. The Runtime runs the job, so a
// long download keeps going if this page is closed.
import { useCallback, useEffect, useState } from "react";

interface ComponentRow {
  id: string;
  name: string;
  detail: string;
  installed: boolean | null;
}

interface JobStatus {
  jobId: string;
  done: boolean;
  ok: boolean | null;
  message: string;
}

const POLL_MS = 2_000;

export function OptionalComponentsSection() {
  const [rows, setRows] = useState<ComponentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, JobStatus>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/optional-components");
      const data = (await response.json()) as { ok: boolean; components?: ComponentRow[]; error?: string };
      if (!response.ok || !data.ok || !data.components) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setRows(data.components);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // One poller per running job; it ends on the first terminal answer.
  useEffect(() => {
    const running = Object.values(jobs).filter((job) => !job.done);
    if (running.length === 0) return;
    const timer = setTimeout(async () => {
      for (const job of running) {
        try {
          const response = await fetch(`/api/optional-components?job=${encodeURIComponent(job.jobId)}`);
          const data = (await response.json()) as { ok: boolean; job?: JobStatus; error?: string };
          if (!response.ok || !data.ok || !data.job) throw new Error(data.error ?? `HTTP ${response.status}`);
          setJobs((current) => ({ ...current, [componentOf(current, job.jobId)]: data.job! }));
          if (data.job.done) void load();
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          setJobs((current) => ({
            ...current,
            [componentOf(current, job.jobId)]: { ...job, done: true, ok: false, message },
          }));
        }
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [jobs, load]);

  async function start(id: string, action: "install" | "remove") {
    if (action === "remove" && !window.confirm("Remove this component? It can be installed again later.")) return;
    setJobs((current) => ({ ...current, [id]: { jobId: "", done: false, ok: null, message: "Starting…" } }));
    try {
      const response = await fetch("/api/optional-components", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = (await response.json()) as { ok: boolean; jobId?: string; error?: string };
      if (!response.ok || !data.ok || !data.jobId) throw new Error(data.error ?? `HTTP ${response.status}`);
      setJobs((current) => ({ ...current, [id]: { jobId: data.jobId!, done: false, ok: null, message: action === "install" ? "Installing…" : "Removing…" } }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setJobs((current) => ({ ...current, [id]: { jobId: "", done: true, ok: false, message } }));
    }
  }

  return (
    <section className="neu-surface-raised mt-4 rounded-2xl border border-gray-800 p-5">
      <h3 className="text-sm font-semibold text-white">Optional components</h3>
      <p className="mt-1 text-xs text-gray-500">
        Large models and environments that are not part of the installer. Each one
        is downloaded once, into Breadboard&apos;s data folder, when you ask for it.
      </p>
      {error && <p className="mt-3 text-xs text-red-400">Could not read component state: {error}</p>}
      <ul className="mt-4 divide-y divide-gray-800">
        {(rows ?? []).map((row) => {
          const job = jobs[row.id];
          const busy = job !== undefined && !job.done;
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-200">{row.name}</p>
                <p className="text-xs text-gray-500">{row.detail}</p>
                {job && (
                  <p className={`mt-1 text-xs ${job.ok === false ? "text-red-400" : "text-gray-400"}`}>
                    {job.message}
                  </p>
                )}
              </div>
              <span className="text-xs text-gray-500">
                {row.installed === null ? "Runtime offline" : row.installed ? "Installed" : "Not installed"}
              </span>
              <button
                type="button"
                disabled={busy || row.installed === null}
                onClick={() => void start(row.id, row.installed ? "remove" : "install")}
                className="neu-button rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:text-white disabled:opacity-50"
              >
                {busy ? "Working…" : row.installed ? "Remove" : "Install"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function componentOf(jobs: Record<string, JobStatus>, jobId: string): string {
  return Object.entries(jobs).find(([, job]) => job.jobId === jobId)?.[0] ?? jobId;
}
