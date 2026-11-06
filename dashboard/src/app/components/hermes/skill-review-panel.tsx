"use client";

import SkillAccessReview from "./skill-access-review";
import { useState, type FormEvent } from "react";
import type { SkillContinuation } from "./use-agent-session";

type SkillCandidate = {
  upstreamId: string;
  name: string;
  package: string;
  repository: string;
  source: string;
  detailsUrl: string;
  installs?: string;
};

type QuarantineReport = {
  name: string;
  package: string;
  source: string;
  exactVersion?: string;
  files: string[];
  fileHashes: Record<string, string>;
  requestedPermissions: string[];
  discoveredScripts: string[];
  externalNetworkRequirements: string[];
  installedAt: string;
  risks: string[];
  riskSummary: string;
  integrityVerified: boolean;
};

interface Props {
  runtimeSessionId: string | number | null;
  onClose: () => void;
  onResume?: (continuation: SkillContinuation) => Promise<void>;
  onApproved?: () => void | Promise<void>;
  appearance?: "full" | "embedded";
}

function responseError(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === "object" &&
    typeof (body as { error?: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  return fallback;
}

export default function SkillReviewPanel({
  runtimeSessionId,
  onClose,
  onResume,
  onApproved,
  appearance = "full",
}: Props) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<SkillCandidate[]>([]);
  const [report, setReport] = useState<QuarantineReport | null>(null);
  const [approvedPermissions, setApprovedPermissions] = useState<Set<string>>(
    new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/hermes/skills/search?q=${encodeURIComponent(value)}`,
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(responseError(body, "Skill search failed."));
      setCandidates(Array.isArray(body.candidates) ? body.candidates : []);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Skill search failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function quarantine(candidate: SkillCandidate) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/hermes/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upstreamId: candidate.upstreamId,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(responseError(body, "Quarantine download failed."));
      setReport(body.report as QuarantineReport);
      setApprovedPermissions(new Set());
      setNotice(
        "Check the requested access, then install this skill.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Quarantine download failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "promote" | "reject") {
    if (!report) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/hermes/skills/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: report.name,
          decision,
          runtimeSessionId,
          approvedAgents: ["breadboard-workbench"],
          approvedPermissions: [...approvedPermissions],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          responseError(body, `Could not ${decision} the skill.`),
        );
      setReport(null);
      setNotice(
        decision === "promote"
          ? "Skill installed."
          : "Installation cancelled.",
      );
      if (decision === "promote") await onApproved?.();
      if (decision === "promote" && body.continuation && onResume) {
        try {
          await onResume(body.continuation as SkillContinuation);
        } catch {
          setError(
            "The skill was approved, but the parent task could not resume automatically.",
          );
        }
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : `Could not ${decision} the skill.`,
      );
    } finally {
      setBusy(false);
    }
  }



  return (
    <div
      className={`${appearance === "embedded" ? "rounded-xl p-3" : "min-h-0 flex-1 overflow-y-auto p-4"} bg-[#0b0f14] text-sm text-gray-200`}
    >
      <div className="mx-auto max-w-4xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              Skill discovery and review
            </h2>
            <p className="mt-1 text-xs text-gray-400">
              Downloaded skills stay inactive until you review and approve their files and permissions.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-gray-700 px-2 py-1 text-xs hover:bg-gray-800"
          >
            Close
          </button>
        </div>

        <form onSubmit={search} className="mt-4 flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Capability, e.g. PDF extraction"
            className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-950 px-3 py-2 outline-none focus:border-[#8faf9a]"
          />
          <button
            disabled={busy || !query.trim()}
            className="rounded bg-[#8faf9a] px-3 py-2 font-medium text-[#102018] disabled:opacity-50"
          >
            Search
          </button>
        </form>

        {error ? (
          <p className="mt-3 rounded border border-red-900 bg-red-950/50 p-2 text-xs text-red-200">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 rounded border border-emerald-900 bg-emerald-950/30 p-2 text-xs text-emerald-200">
            {notice}
          </p>
        ) : null}

        {!report && candidates.length ? (
          <div className="mt-4 space-y-2">
            {candidates.map((candidate) => (
              <div
                key={candidate.package}
                className="flex items-center gap-3 rounded border border-gray-800 bg-gray-950/60 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-white">
                    {candidate.package}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {candidate.installs
                      ? `${candidate.installs} installs · `
                      : ""}
                    {candidate.repository}
                  </p>
                </div>
                <a
                  href={candidate.detailsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-sky-300 hover:underline"
                >
                  Details
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void quarantine(candidate)}
                  className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-200 hover:bg-amber-950/50 disabled:opacity-50"
                >
                  Install skill
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {report ? (
          <div className="mt-4 space-y-4 rounded border border-amber-800/70 bg-gray-950/70 p-4">
            <div>
              <p className="font-mono text-sm text-white">{report.package}</p>
              <p className="mt-1 break-all text-xs text-gray-400">
                Source: {report.source}
              </p>
            </div>

            <div className="[--ink:#e5e7eb] [--ink-heading:#fff] [--ink-muted:#9ca3af] [--line:#374151]">
              <SkillAccessReview report={report} approved={approvedPermissions} onChange={setApprovedPermissions} disabled={busy} />
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-800 pt-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide("reject")}
                className="rounded border border-red-800 px-3 py-1.5 text-xs text-red-200 hover:bg-red-950/50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !report.integrityVerified || report.requestedPermissions.some(permission => !approvedPermissions.has(permission))}
                onClick={() => void decide("promote")}
                className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                Install
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
