"use client";

import { skillPermissionLabel } from "@/lib/hermes/skill-presentation";

export default function SkillAccessReview({ report, approved, onChange, disabled = false }: {
  report: {
    requestedPermissions: string[]; risks: string[]; riskSummary: string; integrityVerified: boolean;
    files: string[]; fileHashes: Record<string, string>;
    discoveredScripts?: string[]; externalNetworkRequirements?: string[];
    exactVersion?: string | null; installedAt?: string;
  };
  approved: Set<string>;
  onChange: (permissions: Set<string>) => void;
  disabled?: boolean;
}) {
  return <div className="space-y-3 text-xs text-[var(--ink)]">
    <p className="text-[var(--ink-muted)]">Check the access this skill needs before installing. Your existing workspace and connection limits still apply.</p>
    <fieldset disabled={disabled}>
      <legend className="font-medium text-[var(--ink-heading)]">Allow access</legend>
      {report.requestedPermissions.length ? report.requestedPermissions.map(permission => (
        <label key={permission} className="mt-2 flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={approved.has(permission)} onChange={() => {
            const next = new Set(approved);
            if (next.has(permission)) next.delete(permission); else next.add(permission);
            onChange(next);
          }} />
          <span>{skillPermissionLabel(permission)}</span>
        </label>
      )) : <p className="mt-1 text-[var(--ink-muted)]">No additional access requested.</p>}
    </fieldset>
    {report.risks.length ? <div><p className="font-medium text-[var(--ink-heading)]">Before you install</p><ul className="mt-1 list-disc space-y-1 pl-4">{report.risks.map(risk => <li key={risk}>{risk}</li>)}</ul></div> : null}
    {!report.integrityVerified ? <p role="alert" className="text-[#9a4438]">The downloaded files could not be verified. Installation is unavailable.</p> : null}
    <details className="border-t border-[var(--line)] pt-3">
      <summary className="cursor-pointer font-medium">Technical details · {report.files.length} files</summary>
      <p className="mt-2 text-[var(--ink-muted)]">{report.riskSummary}</p>
      {report.exactVersion ? <p className="mt-2 break-all">Reviewed revision: {report.exactVersion}</p> : null}
      {report.installedAt ? <p className="mt-1">Downloaded: {report.installedAt}</p> : null}
      {report.discoveredScripts?.length ? <p className="mt-2 break-all">Scripts: {report.discoveredScripts.join(", ")}</p> : null}
      {report.externalNetworkRequirements?.length ? <p className="mt-2 break-all">Network references: {report.externalNetworkRequirements.join(", ")}</p> : null}
      <p className="mt-2 font-medium">Reviewed files and SHA-256</p>
      <ul className="mt-1 max-h-40 overflow-auto font-mono text-[10px] text-[var(--ink-muted)]">{report.files.map(file => <li key={file} className="break-all py-0.5">{file} · {report.fileHashes[file]}</li>)}</ul>
    </details>
  </div>;
}
