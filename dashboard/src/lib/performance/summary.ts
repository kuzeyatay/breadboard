/**
 * Turning interaction records into the report the performance plan asks for
 * (BASE-06, QA-08): p50/p95/worst per milestone, cold kept apart from warm,
 * background refresh kept apart from first display, and every failure,
 * cancellation, and timeout counted rather than quietly dropped.
 */

import {
  INTERACTION_FEATURES,
  type InteractionFeature,
  type InteractionOutcome,
  type InteractionRecord,
} from "./interaction-trace.ts";

export interface LatencySummary {
  readonly samples: number;
  readonly p50: number;
  readonly p95: number;
  readonly worst: number;
}

export interface FeatureSummary {
  readonly feature: InteractionFeature;
  /** Successful first displays, the only samples a budget is judged on. */
  readonly warm: LatencySummary | null;
  /** Reported separately and never averaged into the warm figures. */
  readonly cold: LatencySummary | null;
  readonly background: LatencySummary | null;
  readonly outcomes: Readonly<Record<InteractionOutcome, number>>;
  /** Mean time to each stage, for attributing a regression to a span. */
  readonly marks: readonly { readonly name: string; readonly p50: number }[];
  readonly contention: {
    readonly longTaskMs: number;
    readonly requests: number;
    readonly duplicateRequests: number;
    readonly transferredBytes: number;
    readonly cacheHitRate: number | null;
  };
}

/** The budgets proposed in the plan, in milliseconds at p95. */
export const INTERACTION_BUDGETS_MS: Readonly<
  Partial<Record<InteractionFeature, number>>
> = {
  "tab-input-to-visible": 100,
  "settings-input-to-controls": 100,
  "pdf-input-to-requested-page": 1_000,
  "route-input-to-usable": 200,
};

export interface PerformanceReport {
  readonly features: readonly FeatureSummary[];
  readonly totals: {
    readonly records: number;
    readonly outcomes: Readonly<Record<InteractionOutcome, number>>;
  };
  /** Milestones whose warm p95 is outside the proposed budget. */
  readonly overBudget: readonly {
    readonly feature: InteractionFeature;
    readonly p95: number;
    readonly budgetMs: number;
  }[];
}

/**
 * Nearest-rank percentile: with few samples this reports a value that actually
 * occurred instead of interpolating one that never did.
 */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

function summarize(durations: readonly number[]): LatencySummary | null {
  if (durations.length === 0) return null;
  return {
    samples: durations.length,
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    worst: Math.max(...durations),
  };
}

function emptyOutcomes(): Record<InteractionOutcome, number> {
  return { usable: 0, cancelled: 0, failed: 0, timeout: 0 };
}

function summarizeMarks(
  records: readonly InteractionRecord[],
): { name: string; p50: number }[] {
  const byName = new Map<string, number[]>();
  for (const record of records) {
    for (const mark of record.marks) {
      const values = byName.get(mark.name) ?? [];
      values.push(mark.at);
      byName.set(mark.name, values);
    }
  }
  return [...byName.entries()]
    .map(([name, values]) => ({ name, p50: percentile(values, 0.5) }))
    .sort((left, right) => left.p50 - right.p50);
}

function summarizeFeature(
  feature: InteractionFeature,
  records: readonly InteractionRecord[],
): FeatureSummary {
  const outcomes = emptyOutcomes();
  for (const record of records) {
    if (record.outcome) outcomes[record.outcome] += 1;
  }
  const usable = records.filter(
    (record) => record.outcome === "usable" && record.durationMs !== null,
  );
  const duration = (record: InteractionRecord) => record.durationMs ?? 0;
  const contention = records.reduce(
    (total, record) => ({
      longTaskMs: total.longTaskMs + record.contention.longTaskMs,
      requests: total.requests + record.contention.requests,
      duplicateRequests: total.duplicateRequests + record.contention.duplicateRequests,
      transferredBytes: total.transferredBytes + record.contention.transferredBytes,
      cacheHits: total.cacheHits + record.contention.cacheHits,
      cacheMisses: total.cacheMisses + record.contention.cacheMisses,
    }),
    {
      longTaskMs: 0,
      requests: 0,
      duplicateRequests: 0,
      transferredBytes: 0,
      cacheHits: 0,
      cacheMisses: 0,
    },
  );
  const cacheReads = contention.cacheHits + contention.cacheMisses;
  return {
    feature,
    warm: summarize(
      usable.filter((record) => !record.cold && !record.background).map(duration),
    ),
    cold: summarize(usable.filter((record) => record.cold).map(duration)),
    background: summarize(usable.filter((record) => record.background).map(duration)),
    outcomes,
    marks: summarizeMarks(usable.filter((record) => !record.background)),
    contention: {
      longTaskMs: contention.longTaskMs,
      requests: contention.requests,
      duplicateRequests: contention.duplicateRequests,
      transferredBytes: contention.transferredBytes,
      cacheHitRate: cacheReads > 0 ? contention.cacheHits / cacheReads : null,
    },
  };
}

export function summarizeInteractions(
  records: readonly InteractionRecord[],
): PerformanceReport {
  const totals = emptyOutcomes();
  for (const record of records) {
    if (record.outcome) totals[record.outcome] += 1;
  }
  const features = INTERACTION_FEATURES.map((feature) =>
    summarizeFeature(
      feature,
      records.filter((record) => record.feature === feature),
    ),
  ).filter((summary) =>
    Object.values(summary.outcomes).some((count) => count > 0),
  );
  const overBudget = features.flatMap((summary) => {
    const budgetMs = INTERACTION_BUDGETS_MS[summary.feature];
    if (budgetMs === undefined || !summary.warm) return [];
    return summary.warm.p95 > budgetMs
      ? [{ feature: summary.feature, p95: summary.warm.p95, budgetMs }]
      : [];
  });
  return { features, totals: { records: records.length, outcomes: totals }, overBudget };
}

/** A compact plain-text report for QA output and change descriptions. */
export function formatPerformanceReport(report: PerformanceReport): string {
  if (report.features.length === 0) return "No interactions recorded.";
  const lines: string[] = [];
  for (const summary of report.features) {
    const budget = INTERACTION_BUDGETS_MS[summary.feature];
    const warm = summary.warm
      ? `warm p50 ${summary.warm.p50}ms p95 ${summary.warm.p95}ms worst ${summary.warm.worst}ms (n=${summary.warm.samples})`
      : "warm: no successful samples";
    lines.push(
      `${summary.feature}: ${warm}${budget === undefined ? "" : ` [budget p95 ${budget}ms]`}`,
    );
    if (summary.cold) {
      lines.push(
        `  cold p50 ${summary.cold.p50}ms p95 ${summary.cold.p95}ms (n=${summary.cold.samples})`,
      );
    }
    if (summary.background) {
      lines.push(
        `  background refresh p50 ${summary.background.p50}ms (n=${summary.background.samples})`,
      );
    }
    const failures = Object.entries(summary.outcomes)
      .filter(([outcome, count]) => outcome !== "usable" && count > 0)
      .map(([outcome, count]) => `${outcome} ${count}`);
    if (failures.length > 0) lines.push(`  ${failures.join(", ")}`);
    if (summary.marks.length > 0) {
      lines.push(
        `  stages: ${summary.marks.map((mark) => `${mark.name} ${mark.p50}ms`).join(" → ")}`,
      );
    }
  }
  for (const miss of report.overBudget) {
    lines.push(`OVER BUDGET ${miss.feature}: p95 ${miss.p95}ms > ${miss.budgetMs}ms`);
  }
  return lines.join("\n");
}
