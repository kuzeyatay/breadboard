"use client";

// Where the model usage went: ChatMock's usage ledger, one row per finished
// upstream call. The profile page already says which brains answered and what
// that cost at list price; this card answers the question those leave open
// when a plan window closes — which signed-in account paid, for which
// feature, at what time, and how many tokens each request took. The ledger is
// ChatMock's, not this page's: `/api/chatmock/usage-ledger` proxies
// `GET /v1/usage/ledger`, and a proxy that has no ledger says so instead of
// reporting an empty bill.

import { useCallback, useEffect, useMemo, useState } from "react";
import Badge, { type BadgeTone } from "./badge";
import { formatAssistantModelName } from "@/lib/ai-models";

type Tokens = {
  input: number;
  output: number;
  reasoning: number;
  cached: number;
  total: number;
};

type LedgerAccount = {
  provider: string;
  key: string;
  label: string;
  email: string | null;
  plan: string | null;
};

type LedgerOrigin = {
  source: string;
  purpose: string | null;
  taskType: string | null;
  sentinel: string | null;
  tools: boolean;
  gardenId: string | null;
  pageId: string | null;
  client: string | null;
};

type LedgerRow = {
  at: string;
  startedAt: string | null;
  requestId: string | null;
  kind: string;
  endpoint: string;
  provider: string;
  model: string | null;
  requestedModel: string | null;
  account: LedgerAccount | null;
  origin: LedgerOrigin | null;
  tokens: Tokens | null;
  outcome: string;
  statusCode: number | null;
  error: string | null;
  elapsedSeconds: number | null;
  fallback: boolean;
  extra?: Record<string, string | number | boolean | null>;
};

type Bucket = {
  key: string;
  label: string;
  requests: number;
  succeeded: number;
  failed: number;
  tokens: Tokens;
  lastAt: string | null;
  firstAt: string | null;
  provider?: string;
  plan?: string | null;
  email?: string | null;
  source?: string;
  taskType?: string | null;
  kind?: string;
  windows?: {
    fiveHours: { requests: number; tokens: Tokens };
    sevenDays: { requests: number; tokens: Tokens };
  };
  origins?: Bucket[];
};

type AccountState = {
  key: string;
  email: string | null;
  plan: string | null;
  primary: boolean;
  serving: boolean;
  available: boolean;
  cooldownSeconds: number;
  cooldownReason: string | null;
};

type LedgerReport = {
  generatedAt: string | null;
  since: string | null;
  rows: LedgerRow[];
  truncated: boolean;
  summary: {
    requests: number;
    tokens: Tokens | null;
    byAccount: Bucket[];
    byOrigin: Bucket[];
    byModel: Bucket[];
  };
  accounts: AccountState[];
  unavailable?: boolean;
};

const RANGES: { id: string; label: string }[] = [
  { id: "5h", label: "5 hours" },
  { id: "24h", label: "Today" },
  { id: "7d", label: "Week" },
  { id: "30d", label: "Month" },
];

const SOURCE_LABELS: Record<string, string> = {
  chat: "Chat",
  "agent-turn": "Chat (agent turn)",
  learn: "Learn",
  "page-assistant": "Page assistant",
  ocr: "OCR",
  extraction: "Extraction",
  evolution: "Prompt evolution",
  "council-task": "Council task",
  background: "Background job",
  direct: "Direct call",
  voice: "Voice",
  "thought-topology": "Thought Topology",
};

function compact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

function clock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

function ago(value: string | null): string {
  if (!value) return "never";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h`;
}

function originLabel(origin: LedgerOrigin | null, kind: string): string {
  if (!origin) return kind;
  if (origin.purpose) return origin.purpose;
  if (origin.taskType) return `${SOURCE_LABELS[origin.source] ?? origin.source} · ${origin.taskType.replace(/_/g, " ")}`;
  return SOURCE_LABELS[origin.source] ?? origin.source;
}

function bucketLabel(bucket: Bucket): string {
  if (bucket.taskType) {
    return `${SOURCE_LABELS[bucket.source ?? ""] ?? bucket.source ?? ""} · ${bucket.taskType.replace(/_/g, " ")}`;
  }
  return SOURCE_LABELS[bucket.source ?? bucket.label] ?? bucket.label;
}

function outcomeTone(outcome: string): BadgeTone {
  if (outcome === "succeeded") return "neutral";
  if (outcome === "quota_exhausted") return "warn";
  if (outcome === "aborted") return "neutral";
  return "warn";
}

function outcomeLabel(row: LedgerRow): string {
  switch (row.outcome) {
    case "succeeded":
      return "ok";
    case "quota_exhausted":
      return "limit";
    case "aborted":
      return "cut off";
    default:
      return row.statusCode ? `failed ${row.statusCode}` : "failed";
  }
}

function modelLabel(row: LedgerRow): string {
  const id = row.model ?? row.requestedModel;
  if (!id) return "—";
  if (id === "codex-realtime") return "Codex voice";
  try {
    return formatAssistantModelName(id);
  } catch {
    return id;
  }
}

function accountKey(account: LedgerAccount | null, provider: string): string {
  if (!account) return provider;
  return `${account.provider}:${account.key}`;
}

/** A labelled proportional bar, sized against the row's own maximum. */
function Bar({
  label,
  value,
  share,
  meta,
}: {
  label: string;
  value: string;
  share: number;
  meta?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="truncate text-gray-300">{label}</span>
        <span className="shrink-0 tabular-nums text-gray-400">
          {value}
          {meta && <span className="ml-1.5 text-gray-600">{meta}</span>}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-800/70">
        <div
          className="h-full rounded-full bg-[var(--botanical)]/70"
          style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }}
        />
      </div>
    </div>
  );
}

export default function UsageLedgerPanel() {
  const [range, setRange] = useState<string>("24h");
  const [report, setReport] = useState<LedgerReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async (since: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/chatmock/usage-ledger?since=${encodeURIComponent(since)}&limit=400`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("The usage ledger could not be read.");
      const payload = (await response.json()) as LedgerReport;
      setReport(payload);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The usage ledger could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") void load(range);
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load, range]);

  const accounts = useMemo(() => report?.summary.byAccount ?? [], [report]);
  const cooldowns = useMemo(() => {
    const byEmail = new Map<string, AccountState>();
    for (const state of report?.accounts ?? []) {
      byEmail.set(state.key, state);
      if (state.email) byEmail.set(state.email, state);
    }
    return byEmail;
  }, [report]);

  const rows = useMemo(() => {
    const all = report?.rows ?? [];
    if (!accountFilter) return all;
    return all.filter((row) => accountKey(row.account, row.provider) === accountFilter);
  }, [report, accountFilter]);

  const origins = useMemo(() => {
    if (!accountFilter) return report?.summary.byOrigin ?? [];
    return accounts.find((bucket) => bucket.key === accountFilter)?.origins ?? [];
  }, [report, accounts, accountFilter]);
  const originMax = origins.reduce((best, bucket) => Math.max(best, bucket.tokens.total), 0);
  const visibleRows = expanded ? rows : rows.slice(0, 12);
  const total = report?.summary.tokens;

  return (
    <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Where the usage went</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {report?.unavailable
              ? "ChatMock has no usage ledger yet — restart it to start recording."
              : total
                ? `${report?.summary.requests ?? 0} requests · ${compact(total.total)} tokens (${compact(total.output)} written) across ${accounts.length} account${accounts.length === 1 ? "" : "s"}.`
                : loading
                  ? "Reading the ledger…"
                  : "Nothing was spent in this window."}
          </p>
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Usage window">
          {RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={range === option.id}
              onClick={() => setRange(option.id)}
              className={`neu-button rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
                range === option.id
                  ? "border-[var(--botanical)]/50 text-[var(--botanical)]"
                  : "border-gray-800 text-gray-500 hover:text-gray-300"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="mb-3 text-xs text-[#a45f56]">{error}</p>}

      {/* ------------------------------------------------ account badges */}
      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {accounts.map((bucket) => {
            const state = cooldowns.get(bucket.email ?? "") ?? cooldowns.get(bucket.key.split(":").slice(1).join(":"));
            const resting = state && !state.available;
            const active = accountFilter === bucket.key;
            return (
              <button
                key={bucket.key}
                type="button"
                onClick={() => setAccountFilter(active ? null : bucket.key)}
                title={
                  resting
                    ? `${state?.cooldownReason ?? "Resting"} · back in ${duration(state?.cooldownSeconds ?? 0)}`
                    : `Last request ${ago(bucket.lastAt)}`
                }
                className={`neu-surface flex min-w-[10rem] flex-1 flex-col items-start gap-1 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                  active ? "border-[var(--botanical)]/50" : "border-gray-800 hover:border-gray-600"
                }`}
              >
                <div className="flex w-full items-center gap-2">
                  <span className="truncate text-xs font-medium text-white">{bucket.label}</span>
                  {bucket.plan && <Badge tone="neutral">{bucket.plan}</Badge>}
                  {state?.serving && <Badge tone="active">serving</Badge>}
                  {resting && (
                    <Badge tone="warn" title={state?.cooldownReason ?? undefined}>
                      resting {duration(state?.cooldownSeconds ?? 0)}
                    </Badge>
                  )}
                </div>
                <div className="text-lg font-semibold leading-tight text-white">
                  {compact(bucket.tokens.total)}
                  <span className="ml-1 text-[11px] font-normal text-gray-500">tokens</span>
                </div>
                <div className="text-[11px] text-gray-500">
                  {bucket.requests} request{bucket.requests === 1 ? "" : "s"}
                  {bucket.failed > 0 && <span className="text-[#a45f56]"> · {bucket.failed} failed</span>}
                  {bucket.windows && bucket.provider === "chatgpt" && (
                    <>
                      {" · "}
                      {compact(bucket.windows.fiveHours.tokens.total)} in 5 h ·{" "}
                      {compact(bucket.windows.sevenDays.tokens.total)} in 7 d
                    </>
                  )}
                </div>
                <div className="text-[11px] text-gray-600">last {ago(bucket.lastAt)}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------------ by origin */}
      {origins.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
            {accountFilter ? "What this account paid for" : "What asked for it"}
          </h3>
          <div className="space-y-2">
            {origins.slice(0, 8).map((bucket) => (
              <Bar
                key={bucket.key}
                label={bucketLabel(bucket)}
                value={`${compact(bucket.tokens.total)} tokens`}
                share={originMax === 0 ? 0 : bucket.tokens.total / originMax}
                meta={`${bucket.requests} req`}
              />
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- requests */}
      {rows.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
            Requests{accountFilter ? " on this account" : ""}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-gray-600">
                <tr>
                  <th className="pb-1.5 pr-3 font-medium">When</th>
                  <th className="pb-1.5 pr-3 font-medium">What</th>
                  <th className="pb-1.5 pr-3 font-medium">Model</th>
                  <th className="pb-1.5 pr-3 font-medium">Account</th>
                  <th className="pb-1.5 pr-3 text-right font-medium">In</th>
                  <th className="pb-1.5 pr-3 text-right font-medium">Out</th>
                  <th className="pb-1.5 pr-3 text-right font-medium">Total</th>
                  <th className="pb-1.5 font-medium"></th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {visibleRows.map((row, index) => (
                  <tr
                    key={`${row.requestId ?? "row"}-${row.at}-${index}`}
                    className="border-t border-gray-800/70"
                    title={[
                      row.origin?.client ? `client: ${row.origin.client}` : null,
                      row.elapsedSeconds != null ? `${row.elapsedSeconds.toFixed(1)} s` : null,
                      row.error ?? null,
                      row.extra?.mode ? `voice mode: ${String(row.extra.mode)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums text-gray-500">{clock(row.at)}</td>
                    <td className="max-w-[14rem] truncate py-1.5 pr-3">
                      {originLabel(row.origin, row.kind)}
                      {row.kind === "council" && <span className="ml-1 text-gray-600">seat</span>}
                      {row.fallback && <span className="ml-1 text-gray-600">stand-in</span>}
                    </td>
                    <td className="max-w-[10rem] truncate py-1.5 pr-3 text-gray-400">{modelLabel(row)}</td>
                    <td className="max-w-[12rem] truncate py-1.5 pr-3 text-gray-400">
                      {row.account?.label ?? row.provider}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-400">
                      {row.tokens ? compact(row.tokens.input) : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-400">
                      {row.tokens ? compact(row.tokens.output) : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-white">
                      {row.tokens ? compact(row.tokens.total) : "—"}
                    </td>
                    <td className="py-1.5">
                      <Badge tone={outcomeTone(row.outcome)}>{outcomeLabel(row)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 12 && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-2 text-[11px] text-gray-500 hover:text-gray-300"
            >
              {expanded ? "Show fewer" : `Show all ${rows.length}${report?.truncated ? "+" : ""}`}
            </button>
          )}
        </div>
      )}

      {!loading && !error && !report?.unavailable && rows.length === 0 && accounts.length === 0 && (
        <p className="text-xs text-gray-600">
          No request finished in this window. Rows appear as soon as a chat, council seat, Learn task or voice session completes.
        </p>
      )}
    </section>
  );
}
