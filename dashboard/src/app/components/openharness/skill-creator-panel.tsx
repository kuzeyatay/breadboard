"use client";

import { useMemo, useState } from "react";
import {
  validateSkillDraft,
  type SkillReferenceDraft,
} from "@/lib/openharness/skill-authoring.ts";

// Locally authored skills follow Anthropic's skill-creator methodology and the
// exact same review boundary as downloaded skills: creation stages an inactive
// quarantine revision, and only explicit approval below promotes it into the
// command registry.

type CreatorReport = {
  name: string;
  slashCommand?: string;
  files: string[];
  fileHashes: Record<string, string>;
  requestedPermissions: string[];
  risks: string[];
  riskSummary: string;
  integrityVerified: boolean;
  nameCollision: boolean;
  classification: { classification: string };
};

interface Props {
  runtimeSessionId: string | number | null;
  onBack: () => void;
  onInstalledChange?: () => void | Promise<void>;
}

export default function SkillCreatorPanel({ runtimeSessionId, onBack, onInstalledChange }: Props) {
  const [intent, setIntent] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [references, setReferences] = useState<SkillReferenceDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [report, setReport] = useState<CreatorReport | null>(null);
  const [approvedPermissions, setApprovedPermissions] = useState<Set<string>>(new Set());
  const [reviewClass, setReviewClass] = useState<"eligible_general" | "eligible_coding_conditional">("eligible_general");
  const [installedToken, setInstalledToken] = useState<string | null>(null);

  const validation = useMemo(
    () => validateSkillDraft({ name, description, instructions, references }),
    [name, description, instructions, references],
  );

  async function draftWithAi() {
    setDrafting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/openharness/skills/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft", intent }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        draft?: { name: string; description: string; instructions: string; references?: SkillReferenceDraft[] };
        message?: string;
        error?: string;
      };
      if (!response.ok || !payload.draft) throw new Error(payload.message ?? payload.error ?? "Drafting is unavailable.");
      setName(payload.draft.name);
      setDescription(payload.draft.description);
      setInstructions(payload.draft.instructions);
      setReferences(payload.draft.references ?? []);
      setShowIssues(false);
      setMessage("Draft ready. Review and adjust every field before staging it for review.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Drafting is unavailable.");
    } finally {
      setDrafting(false);
    }
  }

  async function stageForReview() {
    if (validation.issues.length) {
      setShowIssues(true);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/openharness/skills/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description, instructions, references }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        report?: CreatorReport;
        message?: string;
        error?: string;
      };
      if (!response.ok || !payload.report) throw new Error(payload.message ?? payload.error ?? "The skill could not enter review.");
      setReport(payload.report);
      setApprovedPermissions(new Set());
      setMessage("Review the staged files, capabilities, and hashes. Nothing runs until you approve.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The skill could not enter review.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "promote" | "reject") {
    if (!report) return;
    setBusy(true);
    try {
      const response = await fetch("/api/openharness/skills/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: report.name,
          decision,
          runtimeSessionId,
          approvedPermissions: [...approvedPermissions],
          classificationOverride: reviewClass,
          overwrite: report.nameCollision,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? `Could not ${decision} the skill.`);
      if (decision === "promote") {
        setInstalledToken(report.slashCommand ?? report.name);
        await onInstalledChange?.();
      } else {
        setReport(null);
        setMessage("The staged revision was discarded. Your draft is unchanged below.");
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `Could not ${decision} the skill.`);
    } finally {
      setBusy(false);
    }
  }

  function updateReference(index: number, patch: Partial<SkillReferenceDraft>) {
    setReferences((current) => current.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  }

  const inputClass = "mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]";

  if (installedToken) {
    return (
      <section className="p-3" aria-label="Skill created">
        <button type="button" onClick={onBack} className="text-xs font-medium text-[var(--botanical)]">← Back to skills</button>
        <h3 className="mt-3 text-sm font-semibold text-[var(--ink-heading)]">Skill installed</h3>
        <p className="mt-2 text-xs text-[var(--ink)]">The approved revision is in the command registry. Type <span className="font-mono font-medium text-[#1e40af]">/{installedToken}</span> in the composer, or pick it from the capability palette.</p>
        <button
          type="button"
          onClick={() => { setInstalledToken(null); setReport(null); setName(""); setDescription(""); setInstructions(""); setReferences([]); setIntent(""); setMessage(null); setShowIssues(false); }}
          className="mt-4 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--ink)]"
        >
          Create another skill
        </button>
      </section>
    );
  }

  return (
    <section className="p-3" aria-label="Create a skill">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="text-xs font-medium text-[var(--botanical)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">← Back to skills</button>
      </div>
      <h3 className="mt-3 text-sm font-semibold text-[var(--ink-heading)]">Create a skill</h3>
      <p className="mt-1 text-xs text-[var(--ink-muted)]">
        Built on Anthropic&apos;s skill-creator practice: a clear name, a description that says what the skill does and when to use it, and lean imperative instructions. Created skills pass the same quarantine review as downloaded ones before they can run.
      </p>

      {report ? (
        <div className="mt-4 border-t border-[var(--line)] pt-4">
          <h4 className="text-sm font-semibold text-[var(--ink-heading)]">Breadboard review</h4>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">{report.riskSummary}</p>
          {report.risks.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--ink)]">{report.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul> : null}
          {report.nameCollision ? <p className="mt-2 text-xs text-[#9a6b19]">Approving replaces the already installed skill with this name.</p> : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-[var(--ink-heading)]">Requested capabilities</p>
              {report.requestedPermissions.length ? report.requestedPermissions.map((permission) => (
                <label key={permission} className="mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={approvedPermissions.has(permission)} onChange={() => setApprovedPermissions((current) => { const next = new Set(current); if (next.has(permission)) next.delete(permission); else next.add(permission); return next; })} />
                  {permission}
                </label>
              )) : <p className="mt-1 text-xs text-[var(--ink-muted)]">None declared or derived.</p>}
            </div>
            <label className="text-xs font-medium text-[var(--ink-heading)]">Runtime category
              <select value={reviewClass} onChange={(event) => setReviewClass(event.target.value as typeof reviewClass)} className="mt-1 block w-full rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-2 text-xs">
                <option value="eligible_general">General guidance</option>
                <option value="eligible_coding_conditional">Coding guidance (permissions still task-scoped)</option>
              </select>
            </label>
          </div>
          <details className="mt-3 border-t border-[var(--line)] pt-3">
            <summary className="cursor-pointer text-xs font-medium">Staged files and SHA-256 ({report.files.length})</summary>
            <ul className="mt-2 max-h-40 overflow-y-auto font-mono text-[10px] text-[var(--ink-muted)]">{report.files.map((file) => <li key={file} className="break-all py-0.5">{file} · {report.fileHashes[file]}</li>)}</ul>
          </details>
          {message ? <p role="status" className="mt-3 rounded-lg bg-[var(--paper-surface)] px-3 py-2 text-xs text-[var(--ink)]">{message}</p> : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button disabled={busy} type="button" onClick={() => setReport(null)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium">Back to editing</button>
            <button disabled={busy} type="button" onClick={() => void decide("reject")} className="rounded-lg border border-[#b87268] px-3 py-2 text-xs font-medium text-[#9a4438]">Discard</button>
            <button disabled={busy || !report.integrityVerified} type="button" onClick={() => void decide("promote")} className="rounded-lg bg-[var(--botanical)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Approve and install</button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] p-3">
            <label className="block text-xs font-medium text-[var(--ink-heading)]">Describe the skill you want (optional)
              <textarea value={intent} onChange={(event) => setIntent(event.target.value)} rows={2} placeholder="Turn my lecture notes into spaced-repetition flashcards with cloze deletions" className={`${inputClass} resize-y bg-[var(--paper-raised)]`} />
            </label>
            <button type="button" disabled={drafting || !intent.trim()} onClick={() => void draftWithAi()} className="mt-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--botanical)] disabled:opacity-40">{drafting ? "Drafting…" : "Draft with AI"}</button>
          </div>

          <label className="mt-4 block text-xs font-medium text-[var(--ink-heading)]">Skill name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="flashcard-builder" className={`${inputClass} font-mono`} />
          </label>
          <p className="mt-1 text-[11px] text-[var(--ink-muted)]">Lowercase letters, digits, and hyphens. This becomes the folder and the slash command.</p>

          <label className="mt-3 block text-xs font-medium text-[var(--ink-heading)]">Description
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} placeholder="Builds spaced-repetition flashcards from notes. Use when the user asks for flashcards, review questions, or self-testing material." className={`${inputClass} resize-y`} />
          </label>
          <p className="mt-1 text-[11px] text-[var(--ink-muted)]">Say what it does and when to use it — this is the only text the assistant always sees, so it decides triggering.</p>

          <label className="mt-3 block text-xs font-medium text-[var(--ink-heading)]">Instructions (SKILL.md body)
            <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={10} placeholder={"## Workflow\n1. Read the source notes…\n2. …\n\n## Output format\n…"} className={`${inputClass} resize-y font-mono text-xs`} />
          </label>
          <p className="mt-1 text-[11px] text-[var(--ink-muted)]">Imperative markdown with a concrete workflow and exact output format. Keep it under 500 lines; move deep detail into reference docs below.</p>

          <div className="mt-3">
            <p className="text-xs font-medium text-[var(--ink-heading)]">Reference docs (optional)</p>
            {references.map((reference, index) => (
              <div key={index} className="mt-2 rounded-lg border border-[var(--line)] p-2">
                <div className="flex items-center gap-2">
                  <input value={reference.filename} onChange={(event) => updateReference(index, { filename: event.target.value })} placeholder="advanced-usage.md" className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5 font-mono text-xs outline-none focus:border-[var(--botanical)]" />
                  <button type="button" onClick={() => setReferences((current) => current.filter((_, at) => at !== index))} className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-[#9a4438]">Remove</button>
                </div>
                <textarea value={reference.contents} onChange={(event) => updateReference(index, { contents: event.target.value })} rows={4} placeholder="Detail loaded only when the instructions point here." className="mt-2 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5 font-mono text-xs outline-none focus:border-[var(--botanical)]" />
              </div>
            ))}
            <button type="button" onClick={() => setReferences((current) => [...current, { filename: "", contents: "" }])} className="mt-2 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--botanical)]">Add reference doc</button>
          </div>

          {showIssues && validation.issues.length ? (
            <ul className="mt-3 list-disc space-y-1 rounded-lg bg-[var(--paper-surface)] py-2 pl-8 pr-3 text-xs text-[#9a4438]">{validation.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          ) : null}
          {validation.warnings.length ? (
            <ul className="mt-3 list-disc space-y-1 rounded-lg bg-[var(--paper-surface)] py-2 pl-8 pr-3 text-xs text-[#9a6b19]">{validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          ) : null}
          {message ? <p role="status" className="mt-3 rounded-lg bg-[var(--paper-surface)] px-3 py-2 text-xs text-[var(--ink)]">{message}</p> : null}

          <div className="mt-4 flex justify-end">
            <button type="button" disabled={busy || !name.trim() || !description.trim() || !instructions.trim()} onClick={() => void stageForReview()} className="rounded-lg bg-[var(--botanical)] px-4 py-2 text-xs font-medium text-white disabled:opacity-40">{busy ? "Staging…" : "Stage for review"}</button>
          </div>
        </>
      )}
    </section>
  );
}
