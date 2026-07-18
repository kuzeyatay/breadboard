"use client";

import type { VerificationSummary } from "@/lib/openharness/evidence";

const LABELS: Record<VerificationSummary["state"], string> = {
  verified: "Verified",
  partially_verified: "Partially verified",
  unverified: "Unverified",
  contradicted: "Unsupported claim detected",
  not_applicable: "No external verification needed",
};

export default function EvidencePanel({
  verification,
}: {
  verification: VerificationSummary;
}) {
  return (
    <details className="mt-2 text-xs text-[var(--ink)]">
      <summary className="cursor-pointer font-medium text-[var(--ink-heading)]">
        Evidence · {LABELS[verification.state]}
      </summary>
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
      ) : (
        <p className="mt-2 text-[var(--ink-muted)]">
          No external tool evidence was recorded for this answer.
        </p>
      )}
      {verification.assumptions.length ? (
        <p className="mt-2 text-[var(--ink-muted)]">
          Assumptions: {verification.assumptions.join("; ")}
        </p>
      ) : null}
    </details>
  );
}
