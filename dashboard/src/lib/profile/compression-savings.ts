/**
 * What tool-output compression saved, priced.
 *
 * The Hermes runtime compresses oversized tool results before they reach the
 * model and records what it dropped, per model, in a small rolled-up file
 * under its home directory. It records tokens, not dollars — pricing lives
 * here, where the profile cost card already has a rate table, so there is one
 * copy of the rates rather than two.
 *
 * The number this produces is money not spent: tokens that would have been
 * billed as input on the next request had the full output gone into context.
 * It is deliberately partial in the same way the cost card is — a model
 * nobody has published a rate for is counted and named, never priced at zero.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { priceUsd } from "./model-pricing.ts";

/** One model's share of what compression saved. */
export interface CompressionByModel {
  model: string;
  savedTokens: number;
  /** USD this model would have been billed, or null when it has no rate. */
  savedUsd: number | null;
}

export interface CompressionSavings {
  /** Tool results that were compressed rather than truncated. */
  compressions: number;
  /** Characters of tool output that never reached a model. */
  savedChars: number;
  savedTokens: number;
  /** Summed across the models that have a rate. */
  savedUsd: number;
  /** Saved tokens on models with no published rate — the caveat on the total. */
  unpricedTokens: number;
  /** Share of the original tool output that was dropped, 0–1. */
  ratio: number;
  byModel: CompressionByModel[];
  /** Which compressor did the work, biggest saver first. */
  byFormat: Array<{ format: string; savedTokens: number }>;
  lastAt: number | null;
}

interface RawBucket {
  compressions?: number;
  savedChars?: number;
  savedTokens?: number;
}

interface RawSummary {
  compressions?: number;
  originalChars?: number;
  keptChars?: number;
  savedChars?: number;
  savedTokens?: number;
  byFormat?: Record<string, RawBucket>;
  byModel?: Record<string, RawBucket>;
  lastAt?: number | null;
}

export const EMPTY_COMPRESSION_SAVINGS: CompressionSavings = {
  compressions: 0,
  savedChars: 0,
  savedTokens: 0,
  savedUsd: 0,
  unpricedTokens: 0,
  ratio: 0,
  byModel: [],
  byFormat: [],
  lastAt: null,
};

function trimmedEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** The savings file the Hermes runtime writes, following the active profile. */
export function compressionSavingsFile(): string {
  const configured = trimmedEnv("BREADBOARD_TOKENJUICE_SAVINGS_FILE");
  if (configured) return path.resolve(configured);
  const hermesHome = trimmedEnv("HERMES_HOME");
  const base = hermesHome ? path.resolve(hermesHome) : path.join(os.homedir(), ".hermes");
  return path.join(base, "tokenjuice", "savings.json");
}

function positive(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

/**
 * Read and price the savings summary.
 *
 * Returns the empty summary rather than throwing when the file is absent —
 * which is the normal state until the first oversized tool result, and the
 * permanent state for an install whose runtime is not Hermes.
 */
export function readCompressionSavings(): CompressionSavings {
  let raw: RawSummary;
  try {
    raw = JSON.parse(fs.readFileSync(compressionSavingsFile(), "utf8")) as RawSummary;
  } catch {
    return EMPTY_COMPRESSION_SAVINGS;
  }
  if (!raw || typeof raw !== "object") return EMPTY_COMPRESSION_SAVINGS;

  const savedTokens = positive(raw.savedTokens);
  if (savedTokens <= 0) return EMPTY_COMPRESSION_SAVINGS;

  const byModel: CompressionByModel[] = [];
  let savedUsd = 0;
  let unpricedTokens = 0;

  for (const [model, bucket] of Object.entries(raw.byModel ?? {})) {
    const tokens = positive(bucket?.savedTokens);
    if (tokens <= 0) continue;
    // Compressed output would have been billed as input tokens on the next
    // request, so that is the rate to apply — not the output rate, and not a
    // blend of the two.
    const priced =
      model === "unknown" ? null : priceUsd(model, { inputTokens: tokens, outputTokens: 0 });
    if (priced === null) {
      unpricedTokens += tokens;
    } else {
      savedUsd += priced;
    }
    byModel.push({ model, savedTokens: tokens, savedUsd: priced });
  }
  byModel.sort((a, b) => b.savedTokens - a.savedTokens || a.model.localeCompare(b.model));

  const byFormat = Object.entries(raw.byFormat ?? {})
    .map(([format, bucket]) => ({ format, savedTokens: positive(bucket?.savedTokens) }))
    .filter((entry) => entry.savedTokens > 0)
    .sort((a, b) => b.savedTokens - a.savedTokens);

  const originalChars = positive(raw.originalChars);
  const savedChars = positive(raw.savedChars);

  return {
    compressions: positive(raw.compressions),
    savedChars,
    savedTokens,
    savedUsd,
    unpricedTokens,
    ratio: originalChars > 0 ? Math.min(1, savedChars / originalChars) : 0,
    byModel,
    byFormat,
    lastAt: typeof raw.lastAt === "number" ? raw.lastAt : null,
  };
}
