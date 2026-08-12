"use client";

// The trading desk, live, inside the chat turn that started it.
//
// This card is not a progress report. The instruction it belongs to finishes in
// seconds; the desk it started keeps trading while Breadboard is open. So the card has two
// halves and the second one never ends: the run's own events settle the header,
// and everything below it is polled from the desk itself for as long as the card
// is on screen — which means a reload, a new session, or scrolling back to this
// turn next week all show the portfolio as it is now, not as it was then.
//
// The layout is the arena's own dashboard, kept recognisable: the equity curve
// with its timeframe switch, the asset ranking underneath it, and the four
// tables of the account panel beside them. Two things are Breadboard's own. It
// draws with the chat's tokens rather than the clone's Tailwind theme, so a desk
// sits in a conversation instead of looking like an embedded website. And the
// analysis strip above the tables is new — in the arena a decision simply
// appears, whereas here it is the visible end of a TradingAgents run that has
// been going for several minutes, and saying which coin is being argued over is
// most of what makes the desk legible.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import { paperTraderIntent } from "@/lib/paper-trader/identity.ts";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface DeskStatus {
  enabled: boolean;
  running: boolean;
  starting: boolean;
  accountId: number | null;
  startedAt: string | null;
  accountCapital: number | null;
  capitalChangePending: boolean;
  lastCycleAt: string | null;
  cycleStalled: boolean;
  lastError: string;
}

interface CurvePoint {
  timestamp: number;
  datetime: string;
  accountName: string;
  totalAssets: number;
  profitPercentage: number;
}

interface Position {
  id: number;
  symbol: string;
  quantity: number;
  avgCost: number;
  leverage: number;
  side: string;
  lastPrice: number | null;
  marketValue: number | null;
  unrealisedPnl: number | null;
}

interface Order {
  id: number;
  orderNo: string;
  symbol: string;
  side: string;
  orderType: string;
  price: number | null;
  quantity: number;
  leverage: number;
  filledQuantity: number;
  status: string;
  orderTime: string;
}

interface Trade {
  id: number;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  commission: number;
  tradeTime: string;
}

interface Decision {
  id: number;
  decisionTime: string;
  operation: string;
  symbol: string | null;
  prevPortion: number;
  targetPortion: number;
  totalBalance: number;
  leverage: number;
  executed: boolean;
  reason: string;
}

interface Seat {
  id: string;
  label: string;
  blurb: string;
  enabled: boolean;
  pending: boolean;
  note: string;
  /** The one-line summary the adviser's brief asks it to end with. */
  headline: string;
  error: string;
  updatedAt: string | null;
}

interface RiskState {
  stance: "open" | "reduce-only" | "flat";
  reasons: string[];
  drawdown: number;
  openPositions: number;
}

interface DecisionActivity {
  id: number;
  symbol: string;
  label: string;
  kind: "CRYPTO" | "EQUITY";
  state: string;
  rating: string;
  summary: string;
  error: string;
  requestedAt: string;
  settledAt: string | null;
  mappedVerdict: string;
  mappedConviction: string;
  chairVerdict: string;
  chairConfidence: number | null;
  chairOverrode: boolean;
  chairRationale: string;
  minimumConfidence: number | null;
  marketState: string;
  marketBlocked: boolean;
  riskStance: string;
  riskIntervention: string;
  operation: string;
  direction: string;
  targetPortion: number | null;
  leverage: number | null;
  estimatedNotional: number | null;
  estimatedMargin: number | null;
  reason: string;
  status: "analysing" | "ready" | "failed" | "held" | "filled" | "not-filled" | "sent";
  executedAt: string | null;
}

interface Snapshot {
  desk: DeskStatus;
  committee: Seat[];
  risk: RiskState | null;
  /** Capital plus realised plus unrealised — see the note in the snapshot route. */
  equity: number | null;
  capital: number;
  history: { realised: number; fills: number } | null;
  analysis: {
    symbol: string | null;
    label: string | null;
    kind: "CRYPTO" | "EQUITY" | null;
    since: string | null;
    recent: {
      id: number;
      symbol: string;
      state: string;
      rating: string;
      error: string;
      requestedAt: string;
      settledAt: string | null;
    }[];
    activity: DecisionActivity[];
    rotation: { label: string; detail: string };
  };
  settings: {
    startingCapital: number;
    symbols: string[];
    stocks: string[];
    cycleMinutes: number;
    leverage: number;
    positionSize: number;
  };
  instruments: { symbol: string; kind: "CRYPTO" | "EQUITY"; label: string }[];
  accounts: { id: number; name: string; initialCapital: number; currentCash: number }[];
  overview: {
    totalAssets: number;
    positionsValue: number;
    positionsCount: number;
    pendingOrders: number;
  } | null;
  curve: CurvePoint[];
  positions: Position[];
  orders: Order[];
  trades: Trade[];
  decisions: Decision[];
}

const TERMINAL = new Set(["completed", "failed", "aborted"]);

const TIMEFRAMES = [
  { value: "5m", label: "5 Minutes" },
  { value: "1h", label: "1 Hour" },
  { value: "1d", label: "1 Day" },
] as const;

const TABS = ["Positions", "AI Decisions", "Orders", "Trades"] as const;
type Tab = (typeof TABS)[number];

/**
 * How often the desk is re-read.
 *
 * Only while the card is actually on screen and the window is in front. A
 * conversation can hold several of these cards and a transcript scrolls back
 * through months of them; every one of them polling forever would turn a chat
 * nobody is looking at into steady background load on the app.
 */
const POLL_MS = 8_000;
/** A stopped desk has nothing moving, so it is read at a walking pace. */
const IDLE_POLL_MS = 30_000;

/**
 * Series colours. The first is the chat's own accent so the desk's own line
 * belongs to the page; the rest exist because the arena's chart is a comparison
 * and a second account is always possible.
 */
const SERIES_COLORS = [
  "var(--botanical)",
  "#7c9ee0",
  "#a06fd6",
  "#e0a45c",
  "#5cbfa4",
];

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function money(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

/** Coin or company, for the one column where the difference is worth showing. */
function kindBadge(
  symbol: string,
  instruments: { symbol: string; kind: "CRYPTO" | "EQUITY" }[] | undefined,
): string {
  const found = instruments?.find(
    (instrument) => instrument.symbol === symbol.toUpperCase(),
  );
  return found?.kind === "EQUITY" ? "share" : "coin";
}

function mappedActionLabel(activity: DecisionActivity): string {
  if (!activity.mappedVerdict) return "";
  if (activity.mappedVerdict === "HOLD") return "hold signal";
  const smaller = activity.mappedConviction === "mild" ? "smaller " : "";
  return activity.mappedVerdict === "BUY"
    ? `${smaller}long`
    : `${smaller}short`;
}

function finalActionLabel(activity: DecisionActivity): string {
  switch (activity.status) {
    case "analysing":
      return "analysing";
    case "ready":
      return "ready for next cycle";
    case "failed":
      return "analysis failed";
    case "held":
      return activity.marketBlocked
        ? `no trade · market ${activity.marketState.toLowerCase()}`
        : activity.riskIntervention
          ? "held by risk"
          : activity.chairVerdict === "HOLD"
            ? "held by chair"
            : "no trade";
    case "filled":
      return `${activity.operation === "close" ? "closed" : "opened"}${
        activity.direction ? ` ${activity.direction}` : ""
      } · filled`;
    case "not-filled":
      return "order not filled";
    default:
      return "sent to desk";
  }
}

function activityTone(activity: DecisionActivity): string {
  if (activity.status === "failed" || activity.status === "not-filled") {
    return "var(--danger)";
  }
  if (activity.status === "filled") return "var(--botanical)";
  return "var(--ink-muted)";
}

function quantity(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function clock(value: string): string {
  if (!value) return "—";
  // The clone stores naive UTC strings; the Z is what stops them being read as
  // local time and drawn an hour or more out of place.
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatElapsed(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m ${String(rounded % 60).padStart(2, "0")}s` : `${rounded}s`;
}

function sinceLabel(value: string | null): string {
  if (!value) return "";
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const started = new Date(iso).getTime();
  if (Number.isNaN(started)) return "";
  return formatElapsed((Date.now() - started) / 1_000);
}

/**
 * The equity curve, as an inline SVG.
 *
 * Drawn by hand rather than with a chart library because there is no chart
 * library in the dashboard, and because what this needs is genuinely small: one
 * polyline per account over a shared time axis, with the y-range padded so a
 * portfolio that has barely moved does not render as a flat line pinned to an
 * edge — which, on a desk that has been running for ten minutes, is the normal
 * case.
 */
function EquityChart({ curve }: { curve: CurvePoint[] }) {
  const series = useMemo(() => {
    const byAccount = new Map<string, CurvePoint[]>();
    for (const point of curve) {
      const list = byAccount.get(point.accountName) ?? [];
      list.push(point);
      byAccount.set(point.accountName, list);
    }
    return [...byAccount.entries()].map(([name, points]) => ({
      name,
      points: [...points].sort((left, right) => left.timestamp - right.timestamp),
    }));
  }, [curve]);

  const bounds = useMemo(() => {
    const values = curve.map((point) => point.totalAssets).filter(Number.isFinite);
    const times = curve.map((point) => point.timestamp).filter(Number.isFinite);
    if (!values.length || !times.length) return null;
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    // A range of zero would divide by nothing; a very small one would magnify
    // rounding noise into a mountain range.
    const spread = Math.max(maxValue - minValue, Math.max(maxValue * 0.001, 1));
    const pad = spread * 0.15;
    return {
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      minValue: minValue - pad,
      maxValue: maxValue + pad,
    };
  }, [curve]);

  if (!bounds || !series.length) {
    return (
      <div className="flex h-[168px] items-center justify-center">
        <p className="bb-agent-run-text text-[var(--ink-muted)]">
          The equity curve appears once the desk has been running for a few minutes.
        </p>
      </div>
    );
  }

  const width = 640;
  const height = 168;
  const padding = { top: 10, right: 8, bottom: 20, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const timeSpan = Math.max(bounds.maxTime - bounds.minTime, 1);
  const valueSpan = Math.max(bounds.maxValue - bounds.minValue, 1);

  const x = (timestamp: number) =>
    padding.left + ((timestamp - bounds.minTime) / timeSpan) * plotWidth;
  const y = (value: number) =>
    padding.top + plotHeight - ((value - bounds.minValue) / valueSpan) * plotHeight;

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map(
    (fraction) => bounds.minValue + fraction * valueSpan,
  );

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[168px] w-full min-w-[420px]"
        role="img"
        aria-label="Account equity over time"
      >
        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--line)"
              strokeWidth={0.5}
              opacity={0.6}
            />
            <text
              x={padding.left - 6}
              y={y(value) + 3}
              textAnchor="end"
              fontSize={8}
              fill="var(--ink-muted)"
              fontFamily="var(--font-mono, monospace)"
            >
              {`$${Math.round(value).toLocaleString("en-US")}`}
            </text>
          </g>
        ))}
        {series.map((entry, index) => {
          const color = SERIES_COLORS[index % SERIES_COLORS.length];
          const path = entry.points
            .map(
              (point, pointIndex) =>
                `${pointIndex === 0 ? "M" : "L"}${x(point.timestamp).toFixed(2)},${y(point.totalAssets).toFixed(2)}`,
            )
            .join(" ");
          return (
            <g key={entry.name}>
              <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
              {entry.points.map((point) => (
                <circle
                  key={`${entry.name}-${point.timestamp}`}
                  cx={x(point.timestamp)}
                  cy={y(point.totalAssets)}
                  r={1.6}
                  fill={color}
                />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-[5px] flex flex-wrap items-center gap-[13px]">
        {series.map((entry, index) => (
          <span key={entry.name} className="flex items-center gap-1.5">
            <span
              className="inline-block h-[2px] w-[14px]"
              style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}
            />
            <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
              {entry.name}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function InlinePaperTraderRun({
  runId,
  task,
  persistedContent = "",
  persistedOutcome,
  onTerminal,
  onRetry,
}: {
  runId: string;
  task: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  onTerminal?: (result: {
    outcome: ExternalAgentTerminalOutcome;
    content: string;
  }) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  // The instruction is known before the first event arrives, and "Stopping the
  // desk…" under a card still showing an open portfolio is worth a second of
  // certainty.
  const [phase, setPhase] = useState(
    persistedOutcome && persistedOutcome !== "running"
      ? ""
      : paperTraderIntent(task) === "stop"
        ? "Stopping the desk…"
        : "",
  );
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(persistedOutcome === "completed" ? persistedContent : "");
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [timeframe, setTimeframe] = useState<string>("5m");
  const [tab, setTab] = useState<Tab>("AI Decisions");
  const [controlAction, setControlAction] = useState<"start" | "stop" | "refresh" | null>(null);
  // A control response is authoritative immediately. Keep it in front of the
  // last poll until the next snapshot arrives, otherwise a successful Start can
  // spend another idle-poll interval looking stopped.
  const [controlledDesk, setControlledDesk] = useState<DeskStatus | null>(null);
  // Starts true so the first read happens without waiting for an observer; the
  // observer corrects it immediately if the card is nowhere near the viewport.
  const [onScreen, setOnScreen] = useState(true);
  const [inForeground, setInForeground] = useState(true);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(false);
  const startedRef = useRef(0);
  // A manual refresh and the background poll can overlap. Only the newest
  // request may update the card, otherwise an older response can put the stale
  // balance straight back after Refresh appears to finish.
  const loadGenerationRef = useRef(0);
  const base = `/api/paper-trader/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedRef.current = false;
    startedRef.current = Date.now();
  }, [runId]);

  const applyEvent = useCallback((event: RunEvent) => {
    const payload = event.payload;
    if (event.type === "run.started") {
      setStatus("running");
      setPhase(asString(payload.intent) === "stop" ? "Stopping the desk…" : "");
    }
    if (event.type === "desk.starting") setPhase("Starting the trading desk…");
    if (event.type === "desk.ready") setPhase("");
    if (event.type === "run.completed" || event.type === "run.aborted") {
      const summary = asString(payload.summary);
      setStatus(event.type === "run.completed" ? "completed" : "aborted");
      setResult(summary);
      setPhase("");
      if (!reportedRef.current) {
        reportedRef.current = true;
        onTerminalRef.current?.({
          outcome: event.type === "run.completed" ? "completed" : "aborted",
          content: summary,
        });
        notifyTaskCompleted("Paper Trader — the trading desk is running.");
      }
    }
    if (event.type === "run.failed") {
      const message = asString(payload.error, "The trading desk could not start.");
      setStatus("failed");
      setFailure(message);
      setPhase("");
      if (!reportedRef.current) {
        reportedRef.current = true;
        onTerminalRef.current?.({ outcome: "failed", content: message });
      }
    }
  }, []);

  // The run's own event stream. A restored turn has no run left in memory, which
  // is why a 404 here is not an error: the desk below is the live part.
  useEffect(() => {
    if (persistedOutcome && persistedOutcome !== "running") return;
    const source = new EventSource(`${base}/events`);
    const handler = (event: MessageEvent<string>) => {
      try {
        applyEvent(JSON.parse(event.data) as RunEvent);
      } catch {
        // A malformed frame is not worth failing the card over.
      }
    };
    for (const type of [
      "run.started",
      "desk.starting",
      "desk.ready",
      "run.completed",
      "run.failed",
      "run.aborted",
    ]) {
      source.addEventListener(type, handler as EventListener);
    }
    source.onerror = () => {
      source.close();
      void fetch(`${base}/events?since=0`)
        .then(async (response) => {
          if (response.ok) return;
          setStatus((current) => (TERMINAL.has(current) ? current : "completed"));
        })
        .catch(() => undefined);
    };
    return () => source.close();
  }, [applyEvent, base, persistedOutcome]);

  useEffect(() => {
    if (TERMINAL.has(status)) return;
    const timer = window.setInterval(
      () => setElapsed((Date.now() - startedRef.current) / 1_000),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [status]);

  // The desk itself, for as long as the card is mounted. Independent of the run:
  // a turn from last week polls the same desk this one does.
  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    try {
      const response = await fetch(
        `/api/paper-trader/snapshot?timeframe=${encodeURIComponent(timeframe)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return false;
      const data = (await response.json()) as { ok?: boolean } & Snapshot;
      if (data.ok && generation === loadGenerationRef.current) {
        setSnapshot(data);
        setControlledDesk(null);
      }
      return data.ok === true;
    } catch {
      // A missed poll costs one stale tick; the next one is eight seconds away.
      return false;
    }
  }, [timeframe]);

  useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setOnScreen(entries.some((entry) => entry.isIntersecting)),
      // A little before it scrolls into view, so the first frame already has
      // numbers on it rather than filling in a moment later.
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const read = () => setInForeground(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, []);

  // The first read is scheduled rather than called: an effect body that starts a
  // state update synchronously is the cascading-render pattern the lint rule is
  // there to catch, and a poll is a subscription, not an initialiser.
  useEffect(() => {
    if (!onScreen || !inForeground) return;
    const period = snapshot?.desk?.running ? POLL_MS : IDLE_POLL_MS;
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), period);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load, onScreen, inForeground, snapshot?.desk?.running]);

  const refreshView = async () => {
    setControlAction("refresh");
    setFailure("");
    try {
      if (!(await load())) {
        setFailure("The trading desk view could not be refreshed.");
      }
    } finally {
      setControlAction(null);
    }
  };

  const control = async (action: "start" | "stop") => {
    setControlAction(action);
    setFailure("");
    setPhase(
      action === "start"
        ? "Starting the trading desk…"
        : action === "stop"
          ? "Stopping the desk…"
          : "",
    );
    try {
      const response = await fetch("/api/paper-trader/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        desk?: DeskStatus;
      };
      if (data.desk) setControlledDesk(data.desk);
      if (!response.ok || data.ok !== true) {
        throw new Error(
          typeof data.error === "string" && data.error.trim()
            ? data.error
            : `The trading desk could not ${action}.`,
        );
      }
      setPhase(data.desk?.starting ? "Starting the trading desk…" : "");
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : `The trading desk could not ${action}.`,
      );
      setPhase("");
    } finally {
      setControlAction(null);
    }
  };

  const terminal = TERMINAL.has(status);
  const desk = controlledDesk ?? snapshot?.desk;
  const running = Boolean(desk?.running);
  const starting = controlAction === "start" || Boolean(desk?.starting);
  const overview = snapshot?.overview ?? null;
  const capital = desk?.accountCapital ?? snapshot?.settings.startingCapital ?? null;
  // Not the arena's own total-assets figure: that one counts a leveraged
  // position at its notional value, so a 2x position on a flat market reads as a
  // profit. See the note in the snapshot route.
  const equity = snapshot?.equity ?? null;
  const returnRate = equity !== null && capital ? equity / capital - 1 : null;
  const terminalContent =
    result.trim() || failure.trim() || "The trading desk instruction finished.";

  /**
   * The newest failed analysis, while nothing has succeeded since.
   *
   * Shown rather than counted: every verdict the desk acts on comes from one of
   * these runs, so a string of failures is the whole explanation for a desk that
   * holds and holds. One that has since been followed by a good run is history,
   * not a problem, so it stays out of the way.
   */
  const lastFailure = useMemo(() => {
    const recent = snapshot?.analysis.recent ?? [];
    const newest = recent.find((entry) => entry.state !== "pending");
    return newest?.state === "failed" && newest.error
      ? { symbol: newest.symbol, error: newest.error }
      : null;
  }, [snapshot?.analysis.recent]);

  const ranking = useMemo(() => {
    if (!snapshot) return [];
    // The clone ranks by the last point of each account's curve, which is the
    // only place a *priced* total for another account is available.
    const latest = new Map<string, number>();
    for (const point of snapshot.curve) {
      const current = latest.get(point.accountName);
      if (current === undefined || point.timestamp >= current) {
        latest.set(point.accountName, point.totalAssets);
      }
    }
    const rows = [...latest.entries()].map(([name, total]) => ({ name, total }));
    if (!rows.length && overview) {
      rows.push({ name: "TradingAgents", total: overview.totalAssets });
    }
    return rows.sort((left, right) => right.total - left.total);
  }, [snapshot, overview]);

  const tableHead = (columns: string[]) => (
    <tr className="border-b border-[color-mix(in_srgb,var(--line)_55%,transparent)]">
      {columns.map((column) => (
        <th
          key={column}
          className="whitespace-nowrap px-[8px] py-[6px] text-left font-mono text-[10px] font-normal uppercase tracking-wide text-[var(--ink-muted)]"
        >
          {column}
        </th>
      ))}
    </tr>
  );

  const emptyRow = (columns: number, message: string) => (
    <tr>
      <td colSpan={columns} className="px-[8px] py-[13px] text-center text-[11px] text-[var(--ink-muted)]">
        {message}
      </td>
    </tr>
  );

  const cell = "whitespace-nowrap px-[8px] py-[6px] font-mono text-[11px] text-[var(--ink)]";

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status === "failed"}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={phase || (running ? "Trading desk running" : "Trading desk")}
        agentName="Paper Trader"
      />
      <div ref={cardRef} className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            Paper Trader
            <span className="ml-[8px] font-mono text-[11px] font-normal text-[var(--ink-muted)]">
              decided by TradingAgents
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-[8px]">
            <span className="bb-agent-run-label inline-flex items-center gap-1.5">
              <span
                className={`bb-agent-run-led h-1.5 w-1.5 ${
                  running
                    ? "bg-[var(--botanical)]"
                    : starting || !terminal
                      ? "animate-pulse bg-[var(--botanical-2)]"
                      : status === "failed"
                        ? "bg-[var(--danger)]"
                        : "bg-[var(--ink-muted)]"
                }`}
              />
              {running
                ? "running"
                : starting
                  ? "starting"
                  : terminal
                    ? "stopped"
                    : `working · ${formatElapsed(elapsed)}`}
            </span>
            {/* The card polls slowly when idle and pauses off screen. Refresh is
                intentionally only a fresh snapshot read: process recovery is a
                background responsibility and must not hide behind a harmless-
                looking UI control. */}
            <button
              type="button"
              disabled={controlAction !== null}
              onClick={() => void refreshView()}
              className="bb-agent-run-action"
              title="Refresh balances, positions, decisions, and activity"
            >
              {controlAction === "refresh" ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              disabled={controlAction !== null}
              onClick={() => void control(running ? "stop" : "start")}
              className="bb-agent-run-action"
            >
              {controlAction === "start"
                ? "Starting…"
                : controlAction === "stop"
                  ? "Stopping…"
                  : running
                    ? "Stop"
                    : "Start"}
            </button>
          </div>
        </header>

        <div className="space-y-[13px] p-[21px]">
          {phase ? <p className="bb-agent-run-text text-[var(--ink-muted)]">{phase}</p> : null}
          {failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}
          {!failure && desk?.lastError ? (
            <p className="bb-agent-run-text text-[var(--danger)]">{desk.lastError}</p>
          ) : null}
          {desk?.cycleStalled ? (
            <p className="bb-agent-run-text text-[var(--danger)]">
              The desk is up but has stopped asking for decisions — its trading loop is wedged.
              Stop and start the desk to restart its trading loop.
            </p>
          ) : null}
          {desk?.capitalChangePending ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              The starting capital in settings differs from the one this portfolio was opened with.
              Stopping and starting the desk opens a fresh portfolio on the new amount.
            </p>
          ) : null}

          {/* The numbers that answer "how is it doing" without reading a table. */}
          <section className="grid grid-cols-2 gap-[8px] sm:grid-cols-4">
            {[
              { label: "Balance", value: money(equity ?? capital) },
              {
                label: "Return",
                value: percent(returnRate),
                tone:
                  returnRate === null
                    ? undefined
                    : returnRate >= 0
                      ? "var(--botanical)"
                      : "var(--danger)",
              },
              { label: "Cash", value: money(snapshot?.accounts.find((a) => a.id === desk?.accountId)?.currentCash ?? null) },
              // Positions are read directly from SQLite and remain available
              // when the arena's price-dependent overview request times out.
              { label: "Positions", value: String(snapshot?.positions.length ?? 0) },
            ].map((tile) => (
              <div key={tile.label} className="bb-agent-run-row p-[8px]">
                <p className="bb-agent-run-label">{tile.label}</p>
                <p
                  className="mt-[3px] font-mono text-[13px] text-[var(--ink-heading)]"
                  style={tile.tone ? { color: tile.tone } : undefined}
                >
                  {tile.value}
                </p>
              </div>
            ))}
          </section>

          {/* What TradingAgents is doing right now. A cycle is minutes long, so
              without this the desk looks idle for most of its life. */}
          <section className="bb-agent-run-row p-[8px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <span
                className={`bb-agent-run-led h-1.5 w-1.5 shrink-0 ${
                  snapshot?.analysis.symbol ? "animate-pulse bg-[var(--botanical-2)]" : "bg-[var(--ink-muted)]"
                }`}
              />
              <span className="font-mono text-[11px] text-[var(--ink-heading)]">
                {snapshot?.analysis.symbol
                  ? `Analysing ${snapshot.analysis.label ?? snapshot.analysis.symbol}`
                  : running
                    ? "Waiting for the next cycle"
                    : "Idle"}
              </span>
              {snapshot?.analysis.kind ? (
                <span className="rounded-[2px] border border-[color-mix(in_srgb,var(--line)_60%,transparent)] px-[5px] py-[1px] font-mono text-[9px] uppercase tracking-wide text-[var(--ink-muted)]">
                  {snapshot.analysis.kind === "EQUITY" ? "share" : "coin"}
                </span>
              ) : null}
              {snapshot?.analysis.since ? (
                <span className="font-mono text-[10px] text-[var(--ink-muted)]">
                  {sinceLabel(snapshot.analysis.since)}
                </span>
              ) : null}
              {snapshot ? (
                <span className="ml-auto font-mono text-[10px] text-[var(--ink-muted)]">
                  every {snapshot.settings.cycleMinutes} min ·{" "}
                  dynamic exposure up to {Math.round(snapshot.settings.positionSize * 100)}% at {snapshot.settings.leverage}×
                  {snapshot.settings.stocks?.length
                    ? ` · ${snapshot.settings.stocks.length} pinned share${snapshot.settings.stocks.length === 1 ? "" : "s"}`
                    : ""}
                  {" · U.S. shares auto"}
                </span>
              ) : null}
            </div>
            {/* A desk that never trades is almost always a desk whose analyses
                are dying, and the reason is the one thing worth reading. It was
                a tooltip on a five-character chip, which is the same as not
                showing it — a rate-limited model or a missing vendor key looks
                exactly like a quiet market from the outside. */}
            {lastFailure ? (
              <p className="mt-[6px] text-[11px] leading-[1.5] text-[var(--danger)]">
                {lastFailure.symbol} could not be analysed: {lastFailure.error}
              </p>
            ) : null}
          </section>

          {/* A readable audit trail, rather than making someone mentally join
              the analysis chips, committee prose, decision table and fills tab. */}
          {snapshot?.analysis.activity.length ? (
            <section>
              <div className="mb-[8px] flex flex-wrap items-start justify-between gap-[5px]">
                <p className="bb-agent-run-label">Decision activity</p>
                <p
                  className="max-w-[520px] text-right font-mono text-[10px] text-[var(--ink-muted)]"
                  title={snapshot.analysis.rotation.detail}
                >
                  Rotation: {snapshot.analysis.rotation.label} · shares only during regular hours
                </p>
              </div>
              <ol className="space-y-[5px]">
                {snapshot.analysis.activity.slice(0, 5).map((activity) => {
                  const mapped = mappedActionLabel(activity);
                  const final = finalActionLabel(activity);
                  const showPath = activity.state !== "pending" && activity.state !== "failed";
                  return (
                    <li key={activity.id} className="bb-agent-run-row p-[8px]">
                      <div className="flex flex-wrap items-center gap-[6px] font-mono text-[10px]">
                        <span className="text-[11px] text-[var(--ink-heading)]">{activity.symbol}</span>
                        <span className="rounded-[2px] border border-[color-mix(in_srgb,var(--line)_60%,transparent)] px-[4px] py-px text-[9px] uppercase tracking-wide text-[var(--ink-muted)]">
                          {activity.kind === "EQUITY" ? "share" : "coin"}
                        </span>
                        <span className="text-[var(--ink-muted)]">
                          {activity.rating || (activity.status === "analysing" ? "analysis" : "no rating")}
                        </span>
                        {showPath && mapped ? (
                          <>
                            <span aria-hidden="true" className="text-[var(--ink-muted)]">→</span>
                            <span className="text-[var(--ink)]">{mapped}</span>
                          </>
                        ) : null}
                        <span aria-hidden="true" className="text-[var(--ink-muted)]">→</span>
                        <span style={{ color: activityTone(activity) }}>{final}</span>
                        <span className="ml-auto text-[var(--ink-muted)]">
                          {clock(activity.executedAt ?? activity.settledAt ?? activity.requestedAt)}
                        </span>
                      </div>

                      {activity.summary || activity.error ? (
                        <p
                          className={`mt-[4px] line-clamp-2 text-[11px] leading-[1.45] ${
                            activity.error ? "text-[var(--danger)]" : "text-[var(--ink)]"
                          }`}
                          title={activity.error || activity.summary}
                        >
                          {activity.error || activity.summary}
                        </p>
                      ) : null}

                      <div className="mt-[4px] flex flex-wrap gap-x-[10px] gap-y-[2px] font-mono text-[9px] text-[var(--ink-muted)]">
                        {activity.operation && activity.operation !== "hold" ? (
                          <span>
                            Action: {activity.operation}{activity.direction ? ` ${activity.direction}` : ""}
                            {activity.targetPortion !== null
                              ? ` · ${Math.round(activity.targetPortion * 100)}% exposure`
                              : ""}
                            {activity.estimatedNotional !== null
                              ? ` · about ${money(activity.estimatedNotional)}`
                              : ""}
                            {activity.estimatedMargin !== null && activity.leverage && activity.leverage > 1
                              ? ` · ${money(activity.estimatedMargin)} margin`
                              : ""}
                            {activity.leverage && activity.leverage > 1 ? ` · ${activity.leverage}×` : ""}
                          </span>
                        ) : null}
                        {activity.chairVerdict ? (
                          <span>
                            Chair: {activity.chairVerdict}
                            {activity.chairConfidence !== null
                              ? ` · ${Math.round(activity.chairConfidence * 100)}% confidence`
                              : ""}
                            {activity.chairOverrode ? " · changed signal" : ""}
                          </span>
                        ) : null}
                        {activity.marketState ? (
                          <span>
                            Market: {activity.marketState.toLowerCase()}
                            {activity.marketBlocked ? " · trade blocked" : ""}
                          </span>
                        ) : null}
                        {activity.riskStance ? (
                          <span>Risk: {activity.riskIntervention || activity.riskStance}</span>
                        ) : activity.riskIntervention ? (
                          <span>Risk: {activity.riskIntervention}</span>
                        ) : null}
                      </div>

                      {activity.chairRationale ? (
                        <p
                          className="mt-[3px] line-clamp-2 text-[10px] leading-[1.45] text-[var(--ink-muted)]"
                          title={activity.chairRationale}
                        >
                          Chair: {activity.chairRationale}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {/* Who is deciding. Four Breadboard capabilities around one call, and
              the card says which of them actually contributed — an adviser that
              is switched off or has never answered is not silently missing. */}
          {snapshot?.committee?.length ? (
            <section>
              <p className="bb-agent-run-label mb-[8px]">Desk committee</p>
              <ul className="space-y-[5px]">
                {snapshot.committee.map((seat) => {
                  const risk = seat.id === "risk" ? snapshot.risk : null;
                  const state = !seat.enabled
                    ? "off"
                    : seat.pending
                      ? "asking"
                      : seat.error
                        ? "unavailable"
                        : "ready";
                  const line =
                    seat.id === "risk"
                      ? risk?.reasons.length
                        ? risk.reasons.join(" ")
                        : risk
                          ? `${risk.openPositions} open · ${(risk.drawdown * 100).toFixed(1)}% below starting capital`
                          : seat.blurb
                      : seat.id === "trading-agent"
                        ? snapshot.analysis.symbol
                          ? `Analysing ${snapshot.analysis.label ?? snapshot.analysis.symbol}`
                          : seat.blurb
                        : seat.headline || seat.error || seat.note || seat.blurb;
                  return (
                    <li key={seat.id} className="bb-agent-run-row p-[8px]">
                      <div className="flex items-center gap-[8px]">
                        <span
                          className={`bb-agent-run-led h-1.5 w-1.5 shrink-0 ${
                            state === "asking"
                              ? "animate-pulse bg-[var(--botanical-2)]"
                              : state === "unavailable"
                                ? "bg-[var(--danger)]"
                                : state === "off"
                                  ? "bg-[var(--ink-muted)]"
                                  : risk && risk.stance !== "open"
                                    ? "bg-[var(--danger)]"
                                    : "bg-[var(--botanical)]"
                          }`}
                        />
                        <span className="font-mono text-[11px] text-[var(--ink-heading)]">
                          {seat.label}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                          {seat.id === "risk" && risk && risk.stance !== "open"
                            ? risk.stance
                            : state === "ready"
                              ? seat.updatedAt
                                ? clock(seat.updatedAt)
                                : "standing by"
                              : state}
                        </span>
                      </div>
                      <p className="mt-[3px] line-clamp-2 text-[11px] text-[var(--ink)]" title={seat.note || line}>
                        {line}
                      </p>
                    </li>
                  );
                })}
              </ul>
              {snapshot.history && snapshot.history.fills ? (
                <p className="mt-[6px] font-mono text-[10px] text-[var(--ink-muted)]">
                  Track record: {snapshot.history.fills} fill
                  {snapshot.history.fills === 1 ? "" : "s"}, realised{" "}
                  {snapshot.history.realised >= 0 ? "+" : ""}
                  {money(snapshot.history.realised)}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* The chart, with the clone's own timeframe switch. */}
          <section>
            <div className="mb-[8px] flex items-center gap-[5px]">
              {TIMEFRAMES.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => setTimeframe(entry.value)}
                  className={`rounded-[3px] border px-[8px] py-[3px] font-mono text-[10px] transition-colors ${
                    timeframe === entry.value
                      ? "border-[var(--botanical)] text-[var(--ink-heading)]"
                      : "border-[color-mix(in_srgb,var(--line)_60%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <EquityChart curve={snapshot?.curve ?? []} />
          </section>

          {ranking.length ? (
            <section>
              <p className="bb-agent-run-label mb-[8px]">Account asset ranking</p>
              <div className="flex flex-wrap gap-[8px]">
                {ranking.map((row, index) => (
                  <div key={row.name} className="bb-agent-run-row flex items-center gap-[8px] p-[8px]">
                    <span className="font-mono text-[13px] text-[var(--ink-muted)]">#{index + 1}</span>
                    <span>
                      <span className="block font-mono text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                        {row.name}
                      </span>
                      <span className="block font-mono text-[12px] text-[var(--ink-heading)]">
                        {money(row.total)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* The account panel's four tables, one at a time. */}
          <section>
            <div className="mb-[8px] flex flex-wrap items-center gap-[5px]">
              {TABS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => setTab(entry)}
                  className={`rounded-[3px] border px-[8px] py-[3px] font-mono text-[10px] transition-colors ${
                    tab === entry
                      ? "border-[var(--botanical)] text-[var(--ink-heading)]"
                      : "border-[color-mix(in_srgb,var(--line)_60%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {entry}
                </button>
              ))}
            </div>
            <div className="max-h-72 overflow-auto">
              <table className="w-full border-collapse">
                <thead>
                  {tab === "Positions"
                    ? tableHead(["Symbol", "Side", "Qty", "Avg cost", "Last", "Exposure", "P/L"])
                    : tab === "AI Decisions"
                      ? tableHead([
                          "Time",
                          "Operation",
                          "Symbol",
                          "Prev %",
                          "Target %",
                          "Leverage",
                          "Executed",
                          "Reason",
                        ])
                      : tab === "Orders"
                        ? tableHead(["Time", "Symbol", "Side", "Type", "Qty", "Price", "Status"])
                        : tableHead(["Time", "Symbol", "Side", "Qty", "Price", "Fees"])}
                </thead>
                <tbody>
                  {tab === "Positions"
                    ? snapshot?.positions.length
                      ? snapshot.positions.map((position) => (
                          <tr
                            key={position.id}
                            className="border-b border-[color-mix(in_srgb,var(--line)_35%,transparent)]"
                          >
                            <td className={cell}>
                              {position.symbol}
                              <span className="ml-[5px] text-[9px] uppercase tracking-wide text-[var(--ink-muted)]">
                                {kindBadge(position.symbol, snapshot?.instruments)}
                              </span>
                            </td>
                            <td className={cell}>
                              {position.side}
                              {position.leverage > 1 ? ` ${position.leverage}×` : ""}
                            </td>
                            <td className={cell}>{quantity(position.quantity)}</td>
                            <td className={cell}>{money(position.avgCost)}</td>
                            <td className={cell}>{money(position.lastPrice)}</td>
                            <td className={cell}>{money(position.marketValue)}</td>
                            <td
                              className={cell}
                              style={{
                                color:
                                  position.unrealisedPnl === null
                                    ? undefined
                                    : position.unrealisedPnl >= 0
                                      ? "var(--botanical)"
                                      : "var(--danger)",
                              }}
                            >
                              {money(position.unrealisedPnl)}
                            </td>
                          </tr>
                        ))
                      : emptyRow(7, running ? "No open positions." : "The desk is not running.")
                    : null}

                  {tab === "AI Decisions"
                    ? snapshot?.decisions.length
                      ? snapshot.decisions.map((decision) => (
                          <tr
                            key={decision.id}
                            className="border-b border-[color-mix(in_srgb,var(--line)_35%,transparent)]"
                          >
                            <td className={cell}>{clock(decision.decisionTime)}</td>
                            <td className={cell}>
                              <span className="rounded-[2px] border border-[color-mix(in_srgb,var(--line)_60%,transparent)] px-[5px] py-[1px] uppercase">
                                {decision.operation || "—"}
                              </span>
                            </td>
                            <td className={cell}>{decision.symbol ?? "—"}</td>
                            <td className={cell}>{(decision.prevPortion * 100).toFixed(2)}%</td>
                            <td className={cell}>{(decision.targetPortion * 100).toFixed(2)}%</td>
                            <td className={cell}>{decision.leverage > 1 ? `${decision.leverage}×` : "—"}</td>
                            <td className={cell}>{decision.executed ? "Yes" : "No"}</td>
                            <td className="max-w-[280px] px-[8px] py-[6px] text-[11px] text-[var(--ink)]">
                              <span className="line-clamp-2">{decision.reason}</span>
                            </td>
                          </tr>
                        ))
                      : emptyRow(
                          8,
                          running
                            ? "The first decision lands after TradingAgents finishes its first analysis."
                            : "The desk is not running.",
                        )
                    : null}

                  {tab === "Orders"
                    ? snapshot?.orders.length
                      ? snapshot.orders.map((order) => (
                          <tr
                            key={order.id}
                            className="border-b border-[color-mix(in_srgb,var(--line)_35%,transparent)]"
                          >
                            <td className={cell}>{clock(order.orderTime)}</td>
                            <td className={cell}>{order.symbol}</td>
                            <td className={cell}>{order.side}</td>
                            <td className={cell}>
                              {order.orderType}
                              {order.leverage > 1 ? ` ${order.leverage}×` : ""}
                            </td>
                            <td className={cell}>{quantity(order.quantity)}</td>
                            <td className={cell}>{order.price === null ? "Market" : money(order.price)}</td>
                            <td className={cell}>{order.status}</td>
                          </tr>
                        ))
                      : emptyRow(7, "No orders yet.")
                    : null}

                  {tab === "Trades"
                    ? snapshot?.trades.length
                      ? snapshot.trades.map((trade) => (
                          <tr
                            key={trade.id}
                            className="border-b border-[color-mix(in_srgb,var(--line)_35%,transparent)]"
                          >
                            <td className={cell}>{clock(trade.tradeTime)}</td>
                            <td className={cell}>{trade.symbol}</td>
                            <td className={cell}>{trade.side}</td>
                            <td className={cell}>{quantity(trade.quantity)}</td>
                            <td className={cell}>{money(trade.price)}</td>
                            <td className={cell}>{money(trade.commission, 4)}</td>
                          </tr>
                        ))
                      : emptyRow(6, "No fills yet.")
                    : null}
                </tbody>
              </table>
            </div>
          </section>

          {result.trim() ? (
            <section className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
              <ChatMarkdown content={result} compact />
            </section>
          ) : null}
        </div>
      </div>
      {terminal ? <AssistantMessageActions content={terminalContent} onRetry={onRetry} /> : null}
    </>
  );
}
