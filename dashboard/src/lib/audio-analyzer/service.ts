// What a caller may ask the analyzer for, and what it gets back.
//
// Every bound lives here rather than in the route, so the one module that knows
// what the analyzer accepts is the one that decides what a request may contain.
// Paths are never part of that: they arrive already resolved from a stored
// attachment, because a tool that reads any path the model writes is a tool
// that reads the user's whole disk.

import fs from "node:fs";
import {
  ANALYSIS_KINDS,
  ANALYSIS_TOOLS,
  MAX_ANALYZABLE_BYTES,
  RESOLUTIONS,
  readAudioAnalyzerConfig,
  type AnalysisKind,
} from "./config.ts";
import { AudioAnalyzerError, callAnalyzerTool } from "./mcp-client.ts";
import { audioAnalyzerInstalled } from "./runtime.ts";

export { AudioAnalyzerError } from "./mcp-client.ts";

export interface AnalysisOptions {
  analysis: AnalysisKind;
  /** Time-series density: a named step, a number of rows per second, or summary only. */
  resolution: string | null;
  startTime: number | null;
  endTime: number | null;
  /** Tempo search bounds, which matter for music that reports half or double time. */
  minBpm: number | null;
  maxBpm: number | null;
}

/** Twelve hours: past this a "start time" is a typo rather than a request. */
const MAX_TIME_SECONDS = 12 * 60 * 60;

function optionalNumber(
  value: unknown,
  field: string,
  range: { min: number; max: number },
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new AudioAnalyzerError("audio_analyzer_invalid_arguments", `${field} must be a number.`);
  }
  if (parsed < range.min || parsed > range.max) {
    throw new AudioAnalyzerError(
      "audio_analyzer_invalid_arguments",
      `${field} must be between ${range.min} and ${range.max}.`,
    );
  }
  return parsed;
}

export function parseAnalysisOptions(args: Record<string, unknown>): AnalysisOptions {
  const rawAnalysis = typeof args.analysis === "string" ? args.analysis.trim().toLowerCase() : "full";
  if (!(ANALYSIS_KINDS as readonly string[]).includes(rawAnalysis)) {
    throw new AudioAnalyzerError(
      "audio_analyzer_invalid_arguments",
      `analysis must be one of ${ANALYSIS_KINDS.join(", ")}.`,
    );
  }
  const analysis = rawAnalysis as AnalysisKind;

  let resolution: string | null = null;
  if (args.resolution !== undefined && args.resolution !== null && args.resolution !== "") {
    const raw = String(args.resolution).trim().toLowerCase();
    const numeric = Number(raw);
    if ((RESOLUTIONS as readonly string[]).includes(raw)) {
      resolution = raw;
    } else if (Number.isFinite(numeric) && numeric > 0 && numeric <= 50) {
      // The server accepts rows-per-second as a number; it caps the row count
      // itself, so the ceiling here only rejects the obviously mistyped.
      resolution = String(numeric);
    } else {
      throw new AudioAnalyzerError(
        "audio_analyzer_invalid_arguments",
        `resolution must be ${RESOLUTIONS.join(", ")}, or a number of rows per second.`,
      );
    }
  }

  const startTime = optionalNumber(args.startTime ?? args.start_time, "startTime", {
    min: 0,
    max: MAX_TIME_SECONDS,
  });
  const endTime = optionalNumber(args.endTime ?? args.end_time, "endTime", {
    min: 0,
    max: MAX_TIME_SECONDS,
  });
  if (startTime !== null && endTime !== null && endTime <= startTime) {
    throw new AudioAnalyzerError(
      "audio_analyzer_invalid_arguments",
      "endTime must be later than startTime.",
    );
  }
  const minBpm = optionalNumber(args.minBpm ?? args.min_bpm, "minBpm", { min: 20, max: 400 });
  const maxBpm = optionalNumber(args.maxBpm ?? args.max_bpm, "maxBpm", { min: 20, max: 400 });
  if (minBpm !== null && maxBpm !== null && maxBpm <= minBpm) {
    throw new AudioAnalyzerError(
      "audio_analyzer_invalid_arguments",
      "maxBpm must be greater than minBpm.",
    );
  }

  return { analysis, resolution, startTime, endTime, minBpm, maxBpm };
}

/**
 * The arguments the MCP tool actually takes. Only the ones that tool declares
 * are sent: the tempo bounds mean something to `rhythm_analysis` and nothing to
 * the others, and a full analysis takes no bounds at all.
 */
function toolArguments(path: string, options: AnalysisOptions): Record<string, unknown> {
  const args: Record<string, unknown> = { path };
  if (options.analysis === "info") return args;
  if (options.resolution !== null) args.resolution = options.resolution;
  if (options.startTime !== null) args.start_time = options.startTime;
  if (options.endTime !== null) args.end_time = options.endTime;
  if (options.analysis === "rhythm") {
    if (options.minBpm !== null) args.min_bpm = options.minBpm;
    if (options.maxBpm !== null) args.max_bpm = options.maxBpm;
  }
  return args;
}

function assertReadable(path: string): number {
  const stats = fs.statSync(path, { throwIfNoEntry: false });
  if (!stats?.isFile() || stats.size === 0) {
    throw new AudioAnalyzerError(
      "audio_analyzer_file_missing",
      "That track's stored file could not be opened.",
    );
  }
  if (stats.size > MAX_ANALYZABLE_BYTES) {
    throw new AudioAnalyzerError(
      "audio_analyzer_file_too_large",
      "That file is larger than the analyzer will decode into memory.",
    );
  }
  return stats.size;
}

function assertInstalled(): void {
  if (!audioAnalyzerInstalled()) {
    throw new AudioAnalyzerError(
      "audio_analyzer_unavailable",
      "The audio analyzer is not installed on this machine. Run `npm run setup:audio-analyzer` once.",
    );
  }
}

export interface AnalysisResult {
  report: string;
  analysis: AnalysisKind;
  durationMs: number;
}

export async function runAudioAnalysis(input: {
  path: string;
  options: AnalysisOptions;
  signal?: AbortSignal;
}): Promise<AnalysisResult> {
  assertInstalled();
  assertReadable(input.path);
  const config = readAudioAnalyzerConfig();
  const startedAt = Date.now();
  const report = await callAnalyzerTool({
    executable: config.serverExecutable,
    tool: ANALYSIS_TOOLS[input.options.analysis],
    args: toolArguments(input.path, input.options),
    timeoutMs: config.runTimeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return {
    report,
    analysis: input.options.analysis,
    durationMs: Date.now() - startedAt,
  };
}

export async function runAudioComparison(input: {
  pathA: string;
  pathB: string;
  signal?: AbortSignal;
}): Promise<{ report: string; durationMs: number }> {
  assertInstalled();
  assertReadable(input.pathA);
  assertReadable(input.pathB);
  const config = readAudioAnalyzerConfig();
  const startedAt = Date.now();
  const report = await callAnalyzerTool({
    executable: config.serverExecutable,
    tool: "compare",
    args: { path_a: input.pathA, path_b: input.pathB },
    timeoutMs: config.runTimeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return { report, durationMs: Date.now() - startedAt };
}
