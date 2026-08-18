"use client";

import type { VerificationSummary } from "@/lib/hermes/evidence";

/**
 * Why the research stopped, in the user's terms. "Budget" is deliberately not
 * softened: a run that ran out of room covered less than one that finished, and
 * hiding which of the two happened is exactly the kind of quiet reassurance
 * this panel exists to replace.
 */
const STOP_REASONS: Record<string, string> = {
  coverage_sufficient: "the requested details were covered.",
  saturated_and_exhausted:
    "no further sources were turning up, and every open detail had been searched every way available.",
  budget_exhausted:
    "the research budget ran out. Anything still unresolved was not searched to exhaustion.",
  not_stopping: "the research was still in progress.",
};

const LABELS: Record<VerificationSummary["state"], string> = {
  verified: "Verified",
  partially_verified: "Partially verified",
  unverified: "Unverified",
  contradicted: "Unsupported claim detected",
  not_applicable: "No external verification needed",
};

export default function EvidencePanel({
  verification,
  onClose,
}: {
  verification: VerificationSummary;
  onClose: () => void;
}) {
  return (
    <section
      role="dialog"
      aria-label="Response evidence"
      className="neu-popover w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-3 text-xs text-[var(--ink)]"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium text-[var(--ink-heading)]">Evidence</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
          aria-label="Close evidence"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <p className="mt-1 font-medium text-[var(--ink-muted)]">
        {LABELS[verification.state]}
      </p>
      {verification.unsupportedClaims.length ? (
        <ul className="mt-2 space-y-1 text-red-700">
          {verification.unsupportedClaims.map((claim) => (
            <li key={claim}>{claim}</li>
          ))}
        </ul>
      ) : null}
      {verification.evidence.length ? (
        <ul className="mt-2 space-y-1.5">
          {verification.evidence.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3"
            >
              <span className="min-w-0">
                <span className="block">{item.title}</span>
                {item.location ? (
                  item.kind === "garden" ? (
                    <a
                      href={item.location}
                      className="mt-0.5 block truncate text-[10px] text-[var(--botanical)] underline underline-offset-2"
                    >
                      Open source page
                    </a>
                  ) : (
                    <code className="mt-0.5 block break-all text-[10px] text-[var(--ink-muted)]">
                      {item.location}
                    </code>
                  )
                ) : null}
              </span>
              <span
                className={item.success ? "text-emerald-700" : "text-red-700"}
              >
                {!item.success
                  ? "failed"
                  : item.kind === "garden"
                    ? item.details.resultCount === 0
                      ? "searched"
                      : "provided"
                    : "succeeded"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[var(--ink-muted)]">
          No external tool evidence was recorded for this answer.
        </p>
      )}
      {/*
        For an exhaustive research turn the question the prose cannot answer
        about itself is how much of what was asked is actually settled. Showing
        the counts — and the incomplete rows — is what lets a reader judge the
        answer's completeness instead of taking its word for it. Rendered only
        for a turn that ran the tracked pipeline.
      */}
      {verification.researchCoverage ? (
        <div className="mt-2 border-t border-[var(--line)] pt-2">
          <p className="font-medium text-[var(--ink-heading)]">
            Research coverage
          </p>
          <p className="mt-1 text-[var(--ink-muted)]">
            {verification.researchCoverage.settled} of{" "}
            {verification.researchCoverage.total} requested details settled
            across {verification.researchCoverage.entities}{" "}
            {verification.researchCoverage.entities === 1 ? "entity" : "entities"}
            {", "}
            after {verification.researchCoverage.searches}{" "}
            {verification.researchCoverage.searches === 1 ? "search" : "searches"}.
          </p>
          <ul className="mt-1 space-y-0.5 text-[10px] text-[var(--ink-muted)]">
            <li>{verification.researchCoverage.verified} verified</li>
            {verification.researchCoverage.conflicting > 0 ? (
              <li>
                {verification.researchCoverage.conflicting} left with sources in
                conflict
              </li>
            ) : null}
            {/*
              The distinction the whole pipeline exists to protect, stated where
              the user can see it: searched out is a finding, still open is not.
            */}
            {verification.researchCoverage.exhausted > 0 ? (
              <li>
                {verification.researchCoverage.exhausted} searched out — not
                publicly available
              </li>
            ) : null}
            {verification.researchCoverage.open > 0 ? (
              <li className="text-amber-700">
                {verification.researchCoverage.open} still unresolved — not
                established, rather than absent
              </li>
            ) : null}
          </ul>
          {verification.researchCoverage.openRows.length ? (
            <ul className="mt-1 space-y-0.5">
              {verification.researchCoverage.openRows.map((row) => (
                <li
                  key={row}
                  className="truncate text-[10px] text-[var(--ink-muted)]"
                  title={row}
                >
                  {row}
                </li>
              ))}
              {verification.researchCoverage.openRowsTruncated > 0 ? (
                <li className="text-[10px] text-[var(--ink-muted)]">
                  …and {verification.researchCoverage.openRowsTruncated} more
                  incomplete.
                </li>
              ) : null}
            </ul>
          ) : null}
          {verification.researchCoverage.stopReason ? (
            <p className="mt-1 text-[10px] text-[var(--ink-muted)]">
              Stopped because{" "}
              {STOP_REASONS[verification.researchCoverage.stopReason]}
            </p>
          ) : (
            <p className="mt-1 text-[10px] text-amber-700">
              The research did not reach a stopping point.
            </p>
          )}
        </div>
      ) : null}
      {/*
        Delegation is provenance too: an answer partly produced by a runtime
        agent should say so. Rendered only when the field exists, because a
        summary persisted before external agents were recorded cannot honestly
        claim that none were called.
      */}
      {verification.externalAgents ? (
        verification.externalAgents.length ? (
          <div className="mt-2 border-t border-[var(--line)] pt-2">
            <p className="font-medium text-[var(--ink-heading)]">
              External agents
            </p>
            <ul className="mt-1 space-y-1.5">
              {verification.externalAgents.map((agent) => (
                <li
                  key={`${agent.agentId}-${agent.requestedAt}`}
                  className="flex items-start justify-between gap-3"
                >
                  <span className="min-w-0">
                    <span className="block">{agent.agentName}</span>
                    <code className="mt-0.5 block break-all text-[10px] text-[var(--ink-muted)]">
                      {agent.command}
                    </code>
                  </span>
                  <span className="shrink-0 text-[var(--ink-muted)]">
                    {agent.requiresApproval ? "needs approval" : "delegated"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-2 border-t border-[var(--line)] pt-2 text-[var(--ink-muted)]">
            No external agent was called.
          </p>
        )
      ) : null}
      {verification.assumptions.length ? (
        <p className="mt-2 text-[var(--ink-muted)]">
          Assumptions: {verification.assumptions.join("; ")}
        </p>
      ) : null}
    </section>
  );
}
