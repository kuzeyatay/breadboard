"use client";

import type { ReactNode } from "react";
import type {
  VerificationSummary,
  CapabilityKind,
  CapabilityUse,
  EvidenceRecord,
  EvidenceWebsite,
  ExternalAgentCall,
} from "@/lib/hermes/evidence";
import { extractWebsitesFromEvidence, isHttpUrl } from "@/lib/hermes/evidence";

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

/** One heading voice for every section, so the panel reads as a single list. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">
      {children}
    </p>
  );
}

/**
 * The word on a row's right edge — and only when it is worth a word. Every row
 * used to carry one, which put a column of "succeeded" down the whole ledger
 * saying nothing a reader could act on. Silence now means it worked; the two
 * outcomes worth naming are the ones that cost the answer something.
 */
function statusFor(
  item: EvidenceRecord,
): { label: string; tone: string } | null {
  if (!item.success) return { label: "failed", tone: "text-red-700" };
  if (item.kind === "garden" && item.details?.resultCount === 0) {
    return { label: "no results", tone: "text-[var(--ink-muted)]" };
  }
  return null;
}

/**
 * The row's second line: a search's query, a file tool's path. Only a path is
 * set in a monospace face — rendering a search query as code made it read as a
 * filename, which is what kept these rows from looking like one list.
 */
function secondaryLine(
  item: EvidenceRecord,
): { value: string; mono: boolean } | null {
  const value =
    typeof item.location === "string" && item.location.trim()
      ? item.location.trim()
      : typeof item.details?.query === "string" && item.details.query.trim()
        ? item.details.query.trim()
        : typeof item.details?.url === "string" && item.details.url.trim()
          ? item.details.url.trim()
          : "";
  if (!value || isHttpUrl(value)) return null;
  const mono = item.kind !== "web_search" && item.kind !== "garden";
  return { value, mono };
}

function sourceKey(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * Every website the turn touched, listed once. A search and the extraction that
 * followed it report the same pages, so a per-call list showed the same host
 * two or three times over and buried how few distinct sources there really
 * were. Deduping across the whole turn is what makes the count in the header
 * and the list beneath it the same fact.
 */
function collectSources(evidence: EvidenceRecord[]): EvidenceWebsite[] {
  const byKey = new Map<string, EvidenceWebsite>();
  for (const item of evidence) {
    for (const site of extractWebsitesFromEvidence(item)) {
      if (!site.url) continue;
      const key = sourceKey(site.url);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...site });
        continue;
      }
      if (!existing.title && site.title) existing.title = site.title;
      if (!existing.domain && site.domain) existing.domain = site.domain;
    }
  }
  return [...byKey.values()];
}

/**
 * Every page the turn's delegated agents read, listed once.
 *
 * Kept apart from the turn's own sources: which of the two actually opened a
 * page is exactly what a reader checking an answer wants to know, and merging
 * them would erase it.
 */
function collectDelegatedSources(
  agents: ExternalAgentCall[] | undefined,
): EvidenceWebsite[] {
  const byKey = new Map<string, EvidenceWebsite>();
  for (const agent of agents ?? []) {
    for (const site of agent.websites ?? []) {
      if (!site.url) continue;
      const key = sourceKey(site.url);
      if (!byKey.has(key)) byKey.set(key, site);
    }
  }
  return [...byKey.values()];
}

/**
 * One source, one line: the title a reader recognises, and the host they judge
 * it by. Snippets, globes and a link glyph per row all lived here once, and
 * together they turned five sources into a wall the panel could not fit.
 */
function SourceItem({ site }: { site: EvidenceWebsite }) {
  const title = site.title || site.domain || site.url;
  return (
    <li>
      <a
        href={site.url}
        target="_blank"
        rel="noopener noreferrer"
        title={site.url}
        className="flex items-baseline gap-2 py-0.5 text-[var(--ink)] transition-colors hover:text-[var(--ink-heading)]"
      >
        <span className="min-w-0 flex-1 truncate underline decoration-[var(--line-strong)] underline-offset-2">
          {title}
        </span>
        {site.domain ? (
          <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">
            {site.domain}
          </span>
        ) : null}
      </a>
    </li>
  );
}

function EvidenceRow({ item }: { item: EvidenceRecord }) {
  const secondary = secondaryLine(item);
  const status = statusFor(item);
  const isGardenPage = item.kind === "garden" && Boolean(secondary);

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate" title={item.title}>
          {item.title}
        </span>
        {status ? (
          <span className={`shrink-0 text-[10px] ${status.tone}`}>
            {status.label}
          </span>
        ) : null}
      </div>

      {secondary ? (
        isGardenPage ? (
          <a
            href={item.location}
            className="mt-0.5 block truncate text-[10px] text-[var(--botanical)] underline underline-offset-2"
            title={secondary.value}
          >
            Open source page
          </a>
        ) : (
          <p
            className={`mt-0.5 truncate text-[10px] text-[var(--ink-muted)] ${
              secondary.mono ? "font-mono" : ""
            }`}
            title={secondary.value}
          >
            {secondary.value}
          </p>
        )
      ) : null}
    </li>
  );
}

/**
 * The four kinds, in the order a reader cares about them. Skills first because
 * that is where the surprises live — a skill the person never typed is the one
 * thing in this panel they could not have predicted from their own message.
 */
const CAPABILITY_GROUPS: Array<{ kind: CapabilityKind; title: string }> = [
  { kind: "skill", title: "Skills" },
  { kind: "connection", title: "Connections" },
  { kind: "workflow", title: "Automations" },
  { kind: "integration", title: "Breadboard tools" },
];

/**
 * Who put this capability in the turn. Stated plainly rather than as jargon:
 * "selected automatically" is the whole point of the row, and softening it into
 * something like "smart routing" would hide exactly what the user needs to see.
 */
const SELECTION_LABELS: Record<CapabilityUse["selection"], string> = {
  requested: "you asked for it",
  automatic: "selected automatically",
  agent: "the agent chose it",
};

/** What the row says on its right edge, in the same voice the evidence rows use. */
function capabilityStatus(use: CapabilityUse): { label: string; tone: string } {
  if (use.calls === 0) {
    // Selected and never called. Worth saying: it means the capability was in
    // play — its guidance was in the prompt — without having produced anything.
    return { label: "not used", tone: "text-[var(--ink-muted)]" };
  }
  if (use.failures >= use.calls) {
    return { label: use.calls === 1 ? "failed" : "all failed", tone: "text-red-700" };
  }
  if (use.failures > 0) {
    return {
      label: `${use.calls} calls · ${use.failures} failed`,
      tone: "text-amber-700",
    };
  }
  return {
    label: use.calls === 1 ? "1 call" : `${use.calls} calls`,
    tone: "text-emerald-700",
  };
}

function CapabilityRow({ use }: { use: CapabilityUse }) {
  const status = capabilityStatus(use);
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate" title={use.label}>
          {use.label}
        </span>
        <span className={`shrink-0 text-[10px] ${status.tone}`}>
          {status.label}
        </span>
      </div>
      {/*
        Provenance, the command and the reason on one muted line. They were
        three stacked paragraphs, which gave a single skill row more vertical
        weight than the sources the answer was actually built from. The reason
        is still never dropped: an automatic selection is the one case where the
        person is owed one, because they did not ask for it.
      */}
      <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">
        {SELECTION_LABELS[use.selection]}
        {use.command ? <span className="ml-1.5">{use.command}</span> : null}
        {use.reason ? ` — ${use.reason}` : null}
      </p>
      {use.actions?.length ? (
        <p
          className="mt-0.5 truncate font-mono text-[10px] text-[var(--ink-muted)]"
          title={use.actions.join(", ")}
        >
          {use.actions.join(", ")}
        </p>
      ) : null}
    </li>
  );
}

function CapabilitiesSection({
  capabilities,
}: {
  capabilities: NonNullable<VerificationSummary["capabilities"]>;
}) {
  const { used } = capabilities;
  return (
    <div className="mb-2.5">
      <SectionLabel>Capabilities used</SectionLabel>
      {/*
        What was on the table is deliberately not reported. A super-agent turn
        is handed the whole catalogue, so "24 skills were available" describes
        the mode the user switched on, not this answer — and it sat at the top
        of the panel saying so on every single turn. Only what actually came off
        the table is listed below.
      */}
      {CAPABILITY_GROUPS.map(({ kind, title }) => {
        const rows = used.filter((use) => use.kind === kind);
        if (!rows.length) return null;
        return (
          <div key={kind} className="mt-1.5">
            <p className="text-[10px] text-[var(--ink-muted)]">{title}</p>
            <ul className="mt-1 space-y-1.5">
              {rows.map((use) => (
                <CapabilityRow key={`${use.kind}:${use.id}`} use={use} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function EvidencePanel({
  verification,
  onClose,
  maxHeight,
}: {
  verification: VerificationSummary;
  onClose: () => void;
  /**
   * The room the trigger actually has above or below itself, measured by the
   * caller. Without it the panel claimed 70% of the viewport from wherever it
   * was anchored and ran its own header — the close button included — off the
   * top of the screen.
   */
  maxHeight?: number;
}) {
  const sources = collectSources(verification.evidence);
  // A delegated agent searched in its own process, so none of it is in the rows
  // above. Counting only those made the header say "no sources" about an answer
  // built entirely from pages a worker read — the one turn where the count
  // mattered most was the one where it was wrong. Deduped against the turn's
  // own list so a page both of them opened is one source, not two.
  const delegatedSources = collectDelegatedSources(verification.externalAgents);
  const sourceCount = new Set(
    [...sources, ...delegatedSources].map((site) => sourceKey(site.url)),
  ).size;
  // A capability section with nothing in it is a heading plus a denial; the
  // absence of the section says the same thing without spending three lines.
  // Super agent alone no longer opens it: with the inventory line gone there is
  // nothing left for a turn that used none of what it was offered to show.
  const capabilities = verification.capabilities?.used.length
    ? verification.capabilities
    : null;
  const agents = verification.externalAgents?.length
    ? verification.externalAgents
    : null;
  const carriedAgent = agents?.find((agent) => agent.carried) ?? null;
  // The verdict describes the claims in the answer against this turn's own
  // evidence, and a hand-back turn has none: it made no calls, it reported a
  // worker's finished run. "No external verification needed" is the wrong thing
  // to say about that answer, so name what actually produced it. The state
  // itself is left alone — it is a fact about the turn, not a headline.
  const title =
    carriedAgent && verification.state === "not_applicable"
      ? `Answered by ${carriedAgent.agentName}`
      : LABELS[verification.state];

  return (
    <section
      role="dialog"
      aria-label="Response evidence"
      style={maxHeight ? { maxHeight } : undefined}
      className="neu-popover flex max-h-[70vh] w-96 max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] text-xs text-[var(--ink)]"
    >
      {/*
        The verdict is the title. A separate "Evidence" heading above it said
        only what the panel already is.
      */}
      <div className="flex shrink-0 items-baseline justify-between gap-3 border-b border-[var(--line)] px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-[var(--ink-heading)]">
            {title}
          </h3>
          {verification.evidence.length ? (
            <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">
              {verification.evidence.length}{" "}
              {verification.evidence.length === 1 ? "tool call" : "tool calls"}
              {sourceCount
                ? ` · ${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`
                : " · no sources"}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 shrink-0 rounded-md p-1 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
          aria-label="Close evidence"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      {/*
        One scroll region for everything below the verdict. An exhaustive
        research turn produces dozens of rows, and before this the panel simply
        grew until its top ran off the screen. Nothing inside scrolls on its
        own either: a list nested in a scroller trapped the wheel over half the
        panel's height.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {/*
          Above the call-by-call ledger on purpose. "Which of my capabilities
          did this answer use" is the question a reader arrives with; making
          them scroll past thirty tool rows to find out is how the `/watch`
          nobody typed stayed invisible.
        */}
        {capabilities ? <CapabilitiesSection capabilities={capabilities} /> : null}
        {/*
          The web-grounding shortfall, stated in the panel rather than in place
          of the answer. This notice is the whole remedy now: the gate used to
          overwrite the reply with a refusal, which destroyed correct answers
          every time the pre-dispatch classifier misread the request. Marking an
          answer unverified leaves the reader with both the answer and the
          caveat; deleting it left them with neither.
        */}
        {verification.webGrounding?.notice ? (
          <p className="mb-2.5 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900">
            {verification.webGrounding.notice}
          </p>
        ) : null}
        {verification.unsupportedClaims.length ? (
          <ul className="mb-2.5 space-y-1 text-red-700">
            {verification.unsupportedClaims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        ) : null}

        {/*
          The sources of the whole turn, in one place, rather than repeated
          under every call that happened to touch them.
        */}
        {sources.length ? (
          <div className="mb-2.5">
            {/* Unnumbered: the header line above already counted them. */}
            <SectionLabel>Sources</SectionLabel>
            <ul className="mt-1">
              {sources.map((site) => (
                <SourceItem key={site.url} site={site} />
              ))}
            </ul>
          </div>
        ) : null}

        {verification.evidence.length ? (
          <div>
            <SectionLabel>Tool calls</SectionLabel>
            <ul className="mt-1 space-y-1.5">
              {verification.evidence.map((item) => (
                <EvidenceRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[var(--ink-muted)]">
            {/*
              A hand-back turn makes no calls of its own, and flatly denying
              evidence on one hid the fact that everything it says came out of
              a runtime agent's run. Name where the calls actually live.
            */}
            {agents?.some((agent) => agent.carried)
              ? "This turn made no calls of its own — the work was done by the runtime agent below, and its tool calls belong to that run."
              : "No external tool evidence was recorded for this answer."}
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
          <div className="mt-2.5 border-t border-[var(--line)] pt-2">
            <SectionLabel>Research coverage</SectionLabel>
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
          agent should say so. A turn that delegated nothing now says nothing —
          the line denying it was on every other turn in the app.
        */}
        {agents ? (
          <div className="mt-2.5 border-t border-[var(--line)] pt-2">
            <SectionLabel>External agents</SectionLabel>
            <ul className="mt-1 space-y-1.5">
              {agents.map((agent) => (
                <li
                  key={`${agent.agentId}-${agent.requestedAt}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{agent.agentName}</span>
                    <span className="mt-0.5 block break-all text-[10px] text-[var(--ink-muted)]">
                      {agent.command}
                    </span>
                  </span>
                  {/*
                    A carried delegation is the one this answer is made of: the
                    worker ran on the previous turn and this turn exists to
                    report it. Saying "delegated" there would describe a launch
                    this turn never made.
                  */}
                  <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">
                    {agent.carried
                      ? "answered by"
                      : agent.requiresApproval
                        ? "needs approval"
                        : "delegated"}
                  </span>
                </li>
              ))}
            </ul>
            {/*
              What each agent read, under the agent that read it. A delegated
              run searches in its own process, so these pages appear nowhere in
              the tool calls above — without this the panel names the worker and
              then shows nothing it looked at.
            */}
            {agents
              .filter((agent) => agent.websites?.length)
              .map((agent) => (
                <div key={`${agent.agentId}-${agent.requestedAt}-sources`} className="mt-2">
                  <SectionLabel>
                    {`${agent.agentName} read ${agent.websites!.length} ${
                      agent.websites!.length === 1 ? "page" : "pages"
                    }`}
                  </SectionLabel>
                  <ul className="mt-1">
                    {agent.websites!.map((site) => (
                      <SourceItem key={site.url} site={site} />
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        ) : null}

        {verification.assumptions.length ? (
          <p className="mt-2.5 text-[10px] text-[var(--ink-muted)]">
            Assumptions: {verification.assumptions.join("; ")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
