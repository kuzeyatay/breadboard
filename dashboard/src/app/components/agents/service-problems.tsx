"use client";

// Local services the Runtime has given up on (a crash that used up its restart
// budget, a missing install, a memory limit) stay failed until someone retries
// them explicitly. This is that explicit Retry, shown wherever agent settings
// open. It renders nothing while every service is fine.

import { useCallback, useEffect, useState } from "react";

interface ServiceProblem { id: string; name: string; reason: string }
type DesktopRetryBridge = { retryService?: (serviceId: string) => Promise<boolean> };

const buttonClass = "neu-button rounded-xl border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45";

function desktopBridge(): DesktopRetryBridge | undefined {
  return (window as Window & { breadboardDesktop?: DesktopRetryBridge }).breadboardDesktop;
}

export default function ServiceProblems() {
  const [problems, setProblems] = useState<ServiceProblem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/runtime-services/problems", { cache: "no-store" });
      const body = await response.json().catch(() => null) as { problems?: ServiceProblem[] } | null;
      setProblems(response.ok && Array.isArray(body?.problems) ? body.problems : []);
    } catch {
      setProblems([]);
    }
  }, []);

  useEffect(() => {
    setCanRetry(typeof desktopBridge()?.retryService === "function");
    void load();
  }, [load]);

  const retry = async (problem: ServiceProblem) => {
    const retryService = desktopBridge()?.retryService;
    if (!retryService) return;
    setBusy(problem.id);
    setNotice(null);
    try {
      const accepted = await retryService(problem.id);
      setNotice(accepted
        ? `${problem.name} will start again the next time it's needed.`
        : `${problem.name} could not be reset. Restart Breadboard to clear it.`);
    } catch {
      setNotice(`${problem.name} could not be reset. Restart Breadboard to clear it.`);
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (problems.length === 0 && !notice) return null;
  return (
    <section className="space-y-2" aria-live="polite">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
        Local services
      </h3>
      {problems.map((problem) => (
        <div key={problem.id} className="neu-surface-subtle flex items-start gap-3 rounded-xl border border-[var(--line)] p-3">
          <div className="min-w-0 flex-1 text-xs text-[var(--ink)]">
            <p className="font-medium">{problem.name} isn&apos;t running</p>
            <p className="mt-0.5 text-[var(--ink-muted)]">Reason: {problem.reason}</p>
          </div>
          {canRetry ? (
            <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void retry(problem)}>
              {busy === problem.id ? "Retrying…" : "Retry"}
            </button>
          ) : null}
        </div>
      ))}
      {!canRetry && problems.length > 0 ? (
        <p className="text-xs text-[var(--ink-muted)]">Restart Breadboard to try these again.</p>
      ) : null}
      {notice ? <p className="text-xs text-[var(--ink-muted)]">{notice}</p> : null}
    </section>
  );
}
