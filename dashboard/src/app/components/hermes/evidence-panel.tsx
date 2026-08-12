"use client";

import type { VerificationSummary } from "@/lib/hermes/evidence";

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
  const gardenEvidence = verification.evidence.filter(
    (item) => item.kind === "garden",
  );
  const otherEvidence = verification.evidence.filter(
    (item) => item.kind !== "garden",
  );

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
      <div className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-2">
        <p className="font-medium text-[var(--ink-heading)]">
          Garden grounding
        </p>
        {gardenEvidence.length ? (
          <ul className="mt-1.5 space-y-1.5">
            {gardenEvidence.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block">{item.title}</span>
                  {item.location ? (
                    <a
                      href={item.location}
                      className="mt-0.5 block truncate text-[10px] text-[var(--botanical)] underline underline-offset-2"
                    >
                      Open source page
                    </a>
                  ) : null}
                </span>
                <span
                  className={item.success ? "text-emerald-700" : "text-red-700"}
                >
                  {item.success
                    ? item.details.resultCount === 0
                      ? "searched"
                      : "provided"
                    : "failed"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[var(--ink-muted)]">
            Garden not consulted for this answer.
          </p>
        )}
      </div>
      {verification.unsupportedClaims.length ? (
        <ul className="mt-2 space-y-1 text-red-700">
          {verification.unsupportedClaims.map((claim) => (
            <li key={claim}>{claim}</li>
          ))}
        </ul>
      ) : null}
      {otherEvidence.length ? (
        <ul className="mt-2 space-y-1.5">
          {otherEvidence.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3"
            >
              <span className="min-w-0">
                <span className="block">{item.title}</span>
                {item.location ? (
                  <code className="mt-0.5 block break-all text-[10px] text-[var(--ink-muted)]">
                    {item.location}
                  </code>
                ) : null}
              </span>
              <span
                className={item.success ? "text-emerald-700" : "text-red-700"}
              >
                {item.success ? "succeeded" : "failed"}
              </span>
            </li>
          ))}
        </ul>
      ) : verification.evidence.length === 0 ? (
        <p className="mt-2 text-[var(--ink-muted)]">
          No external tool evidence was recorded for this answer.
        </p>
      ) : null}
      {verification.assumptions.length ? (
        <p className="mt-2 text-[var(--ink-muted)]">
          Assumptions: {verification.assumptions.join("; ")}
        </p>
      ) : null}
    </section>
  );
}
