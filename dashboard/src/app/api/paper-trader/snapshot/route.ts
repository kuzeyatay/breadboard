// Everything the card draws, in one read.
//
// One endpoint rather than five because the card polls: a desk on screen asks
// again every few seconds, and five round trips per tick would be five chances
// for the panels to disagree with each other about which moment they are showing.
//
// The chart's timeframe is the caller's, because it is a control on the card.
// Everything else is whatever is true now.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import {
  accountOverview,
  assetCurve,
  listAccounts,
  livePrices,
  pricePositions,
  publicArenaAccounts,
  readTables,
  readTradeHistory,
  type ArenaDecision,
} from "@/lib/paper-trader/arena.ts";
import { SEATS, tailLine } from "@/lib/paper-trader/committee.ts";
import {
  kindOf,
  PAPER_TRADER_AGENT_ID,
  symbolLabel,
  type Instrument,
} from "@/lib/paper-trader/identity.ts";
import { assessRisk, readHistory } from "@/lib/paper-trader/risk.ts";
import { getPaperTraderStore } from "@/lib/paper-trader/instance.ts";
import type { DecisionRecord } from "@/lib/paper-trader/store.ts";
import { instrumentsOf, paperTraderSettingsFrom } from "@/lib/paper-trader/settings.ts";
import { deskBaseUrl, deskStatus } from "@/lib/paper-trader/supervisor.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The clone's own vocabulary for the chart's x-axis. */
const TIMEFRAMES = new Set(["5m", "1h", "1d"]);

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
}

function numberOf(record: Record<string, unknown> | null, key: string): number | null {
  const value = Number(record?.[key]);
  return Number.isFinite(value) ? value : null;
}

function cleanDecisionText(value: string, limit = 360): string {
  const clean = value
    .replace(/^#+\s.*$/gm, " ")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}

/** The first paragraph the analyst deliberately labelled for a decision-maker. */
function analysisSummary(reasoning: string): string {
  const executive = /\*\*Executive Summary\*\*:\s*([\s\S]*?)(?=\n\s*\n\*\*|$)/i.exec(reasoning)?.[1];
  return cleanDecisionText(executive || reasoning);
}

function sectionAfter(value: string, marker: string, stops: string[]): string {
  const at = value.indexOf(marker);
  if (at < 0) return "";
  const start = at + marker.length;
  const ends = stops
    .map((stop) => value.indexOf(stop, start))
    .filter((end) => end >= 0);
  const end = ends.length ? Math.min(...ends) : value.length;
  return cleanDecisionText(value.slice(start, end), 300);
}

function mappedRating(rating: string): { verdict: string; conviction: string } | null {
  switch (rating.trim().toUpperCase()) {
    case "BUY":
      return { verdict: "BUY", conviction: "strong" };
    case "OVERWEIGHT":
      return { verdict: "BUY", conviction: "mild" };
    case "UNDERWEIGHT":
      return { verdict: "SELL", conviction: "mild" };
    case "SELL":
      return { verdict: "SELL", conviction: "strong" };
    case "HOLD":
      return { verdict: "HOLD", conviction: "strong" };
    default:
      return null;
  }
}

/**
 * One human-readable audit row per expensive analysis.
 *
 * The arena logs every five-minute HOLD while an analysis is running, so its raw
 * decision table is useful for diagnostics but noisy as an explanation. The
 * Breadboard row is the stable spine: analyst rating, committee/risk path, then
 * the matching arena execution when one exists.
 */
function decisionActivity(
  records: DecisionRecord[],
  executions: ArenaDecision[],
  instruments: Instrument[],
) {
  return records.map((record) => {
    const decision = record.decision;
    const audit = recordOf(decision?.audit);
    const reason = textOf(decision, "reason");
    const operation = textOf(decision, "operation").toLowerCase();
    const mapped = mappedRating(record.rating);
    const matchingExecution = reason
      ? executions.find(
          (entry) =>
            entry.reason === reason ||
            (entry.reason.length >= 160 && reason.startsWith(entry.reason.slice(0, 160))),
        ) ?? null
      : null;
    const marketFromReason = /The market for \S+ is ([^,.;]+).*nothing was traded/i.exec(
      reason,
    )?.[1];
    const riskFromReason = sectionAfter(reason, "Risk officer:", []);
    const chairRationale =
      textOf(audit, "chairRationale") ||
      sectionAfter(reason, "Chair:", ["The market for", "Risk officer:"]);
    const marketState = textOf(audit, "marketState") || marketFromReason || "";
    const auditedMarketBlocked =
      typeof audit?.marketBlocked === "boolean" ? audit.marketBlocked : null;
    const marketBlocked =
      auditedMarketBlocked ??
      Boolean(
        marketFromReason &&
          marketState.toUpperCase() !== "REGULAR" &&
          operation === "hold",
      );
    const riskIntervention = textOf(audit, "riskIntervention") || riskFromReason;
    const targetPortion = numberOf(decision, "target_portion_of_balance");
    const leverage = numberOf(decision, "leverage");
    const estimatedNotional =
      operation === "open" && matchingExecution && targetPortion !== null
        ? matchingExecution.totalBalance * targetPortion
        : null;
    const estimatedMargin =
      estimatedNotional !== null && leverage !== null && leverage > 0
        ? estimatedNotional / leverage
        : null;
    const status =
      record.state === "pending"
        ? "analysing"
        : record.state === "ready"
          ? "ready"
          : record.state === "failed"
            ? "failed"
            : operation === "hold"
              ? "held"
              : matchingExecution?.executed
                ? "filled"
                : matchingExecution
                  ? "not-filled"
                  : "sent";

    return {
      id: record.id,
      symbol: record.symbol,
      label: symbolLabel(record.symbol),
      kind: kindOf(record.symbol, instruments),
      state: record.state,
      rating: record.rating,
      summary: analysisSummary(record.reasoning),
      error: record.error,
      requestedAt: record.requestedAt,
      settledAt: record.settledAt,
      mappedVerdict: textOf(audit, "mappedVerdict") || mapped?.verdict || "",
      mappedConviction: textOf(audit, "mappedConviction") || mapped?.conviction || "",
      chairVerdict: textOf(audit, "chairVerdict"),
      chairConfidence: numberOf(audit, "chairConfidence"),
      chairOverrode: audit?.chairOverrode === true,
      chairRationale,
      minimumConfidence: numberOf(audit, "minimumConfidence"),
      marketState,
      marketBlocked,
      riskStance: textOf(audit, "riskStance"),
      riskIntervention,
      operation,
      direction: textOf(decision, "direction").toLowerCase(),
      targetPortion,
      leverage,
      estimatedNotional,
      estimatedMargin,
      reason: cleanDecisionText(reason, 520),
      status,
      executedAt: matchingExecution?.decisionTime ?? null,
    };
  });
}

function visibleInstruments(
  configured: Instrument[],
  records: DecisionRecord[],
  observed: string[] = [],
): Instrument[] {
  const symbols = new Set([
    ...configured.map((instrument) => instrument.symbol.toUpperCase()),
    ...records.map((record) => record.symbol.toUpperCase()),
    ...observed.map((symbol) => symbol.toUpperCase()),
  ]);
  return [...symbols].map((symbol) => {
    const known = configured.find((instrument) => instrument.symbol === symbol);
    return (
      known ?? {
        symbol,
        kind: kindOf(symbol, configured),
        label: symbolLabel(symbol),
      }
    );
  });
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const requested = url.searchParams.get("timeframe") ?? "5m";
    const timeframe = TIMEFRAMES.has(requested) ? requested : "5m";

    const store = getPaperTraderStore();
    const state = store.state();
    const settings =
      state.enabled && state.runSettings
        ? state.runSettings
        : paperTraderSettingsFrom(agentSettingsFor(userId, PAPER_TRADER_AGENT_ID));
    const status = deskStatus(settings);
    const base = deskBaseUrl();

    // The committee, as the card lists it: every seat, whether it is switched
    // on, and what it last said. A seat with nothing to say still appears —
    // "not consulted" is information about how the desk is deciding.
    const board = store.advice();
    const committee = SEATS.map((seat) => {
      const enabled =
        seat.id === "vibe-trading"
          ? settings.consultVibeTrading
          : seat.id === "stock-analyst"
            ? settings.consultStockAnalyst
            : true;
      const record = board.find((entry) => entry.seat === seat.id) ?? null;
      return {
        id: seat.id,
        label: seat.label,
        blurb: seat.blurb,
        enabled,
        pending: record?.pending ?? false,
        note: record?.note ?? "",
        headline:
          seat.id === "vibe-trading"
            ? tailLine(record?.note ?? "", /^\s*REGIME:\s*/i)
            : seat.id === "stock-analyst"
              ? tailLine(record?.note ?? "", /^\s*RISK APPETITE:\s*/i)
              : "",
        error: record?.error ?? "",
        updatedAt: record?.updatedAt ?? null,
      };
    });

    const pending = store.pendingDecision();
    const recentRecords = store.recentDecisions(8);
    const configuredInstruments = instrumentsOf(settings);
    const instruments = visibleInstruments(configuredInstruments, recentRecords);
    const analysis = {
      /** The coin or company TradingAgents is working on right now, if any. */
      symbol: pending ? pending.symbol : null,
      label: pending ? symbolLabel(pending.symbol) : null,
      kind: pending ? kindOf(pending.symbol, configuredInstruments) : null,
      since: pending ? pending.requestedAt : null,
      recent: recentRecords.slice(0, 6).map((record) => ({
        id: record.id,
        symbol: record.symbol,
        state: record.state,
        rating: record.rating,
        error: record.error,
        requestedAt: record.requestedAt,
        settledAt: record.settledAt,
      })),
      activity: decisionActivity(recentRecords, [], configuredInstruments),
      rotation: {
        label: "Crypto ↔ U.S. shares",
        detail:
          "The desk alternates crypto with automatically selected U.S. companies during regular stock-market hours; crypto continues while shares are closed.",
      },
    };

    if (!base || status.accountId === null) {
      return NextResponse.json({
        ok: true,
        desk: status,
        analysis,
        committee,
        risk: null,
        equity: null,
        capital: settings.startingCapital,
        history: null,
        settings: {
          startingCapital: settings.startingCapital,
          symbols: settings.symbols,
          stocks: settings.stocks,
          cycleMinutes: settings.cycleMinutes,
          leverage: settings.leverage,
          positionSize: settings.positionSize,
        },
        instruments,
        timeframe,
        accounts: [],
        overview: null,
        curve: [],
        positions: [],
        orders: [],
        trades: [],
        decisions: [],
      });
    }

    const tables = readTables(status.accountId, 20);
    const symbols = [
      ...new Set([
        ...tables.positions.map((position) => position.symbol.toUpperCase()),
        ...settings.symbols,
      ]),
    ];

    // The three network reads are independent; a slow price lookup should not
    // hold the chart back, and a failure in any one of them costs its own panel
    // rather than the card.
    const [accounts, overview, curve, prices] = await Promise.all([
      listAccounts(base).catch(() => []),
      accountOverview(base, status.accountId).catch(() => null),
      assetCurve(base, timeframe).catch(() => []),
      livePrices(base, symbols).catch(() => ({}) as Record<string, number>),
    ]);

    const positions = pricePositions(tables.positions, prices);
    const visible = visibleInstruments(configuredInstruments, recentRecords, [
      ...tables.positions.map((position) => position.symbol),
      ...tables.orders.map((order) => order.symbol),
      ...tables.trades.map((trade) => trade.symbol),
      ...tables.decisions.flatMap((decision) => (decision.symbol ? [decision.symbol] : [])),
    ]);
    // Keep the visible fill table short, but build balance and risk from every
    // fill this account has ever made. A display limit is not an accounting
    // boundary.
    const history = readHistory(readTradeHistory(status.accountId));
    const capital = status.accountCapital ?? settings.startingCapital;
    const unrealised = positions.reduce(
      (total, position) => total + (position.unrealisedPnl ?? 0),
      0,
    );
    // Equity from the desk's own books, not the arena's overview.
    //
    // `/api/account/:id/overview` reports total assets as cash plus the
    // *notional* value of the positions, so a 2× position counts twice what it
    // is worth and a desk that has not made a penny reads as up thirty percent.
    // Capital plus realised plus unrealised is the same number the risk officer
    // works from and the same one the clone's own equity curve draws.
    const equity = capital + history.realised + unrealised;
    const risk = assessRisk({ equity, capital, positions, settings });

    return NextResponse.json({
      ok: true,
      desk: status,
      analysis: {
        ...analysis,
        activity: decisionActivity(recentRecords, tables.decisions, configuredInstruments),
      },
      committee,
      risk,
      equity,
      capital,
      history: {
        realised: history.realised,
        fills: history.fills,
        bySymbol: history.bySymbol,
      },
      settings: {
        startingCapital: settings.startingCapital,
        symbols: settings.symbols,
        stocks: settings.stocks,
        cycleMinutes: settings.cycleMinutes,
        leverage: settings.leverage,
        positionSize: settings.positionSize,
      },
      instruments: visible,
      timeframe,
      // listAccounts includes the arena's callback URL and bearer token. Only a
      // deliberately reduced account summary may cross into the browser.
      accounts: publicArenaAccounts(accounts),
      overview,
      curve,
      prices,
      positions,
      orders: tables.orders,
      trades: tables.trades,
      decisions: tables.decisions,
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
