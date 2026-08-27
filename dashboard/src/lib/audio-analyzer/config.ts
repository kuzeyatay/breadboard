// Where the audio analyzer lives, and what a single analysis may ask for.
//
// The analyzer is a pair of Rust binaries — a CLI and an MCP server — built
// from the `audio-analyzer-rs` checkout or downloaded from its pinned release.
// Breadboard only ever speaks to the MCP server, over stdio, one call per
// process: the analysis is CPU-bound and finishes in seconds, so a long-lived
// server would be a supervised process to keep alive for no gain.
//
// Kept apart from the service so the status read, the tool route and the tests
// resolve the same paths from the same environment without importing a
// child-process module to find out where the binary is.

import path from "node:path";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

/** The upstream release this integration is pinned to. */
export const AUDIO_ANALYZER_VERSION = "v1.0.0";

/**
 * What the model may ask for. Each maps to one tool on the MCP server; `full`
 * is the one the skill reaches for first because it also returns the section
 * map that makes a second, zoomed call worth making.
 */
export const ANALYSIS_KINDS = ["info", "spectral", "harmonic", "rhythm", "full"] as const;
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];

export const ANALYSIS_TOOLS: Record<AnalysisKind, string> = {
  info: "audio_info",
  spectral: "spectral_features",
  harmonic: "harmonic_analysis",
  rhythm: "rhythm_analysis",
  full: "full_analysis",
};

/** Time-series densities the server accepts by name; a bare number is also allowed. */
export const RESOLUTIONS = ["low", "medium", "high"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/**
 * A full analysis of a 60-second track runs in about two seconds, and decoding
 * dominates on a long one. A ten-minute ceiling is generous for an album track
 * and still short enough that a wedged process cannot hold a turn open.
 */
export const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000;

/**
 * The analyzer returns text, and that text goes into a context window. The
 * server caps its own time-series at 800 rows; this is the backstop for
 * everything else it might print.
 */
export const MAX_OUTPUT_CHARS = 200_000;

/** Symphonia decodes the whole file into memory, so the ceiling is real rather than notional. */
export const MAX_ANALYZABLE_BYTES = 512 * 1024 * 1024;

export interface AudioAnalyzerConfig {
  /** The upstream checkout, used when building from source. */
  cloneRoot: string;
  /** The MCP server binary Breadboard actually runs. */
  serverExecutable: string;
  /** The standalone CLI from the same build. Not used at turn time; kept for support. */
  cliExecutable: string;
  /** Where `npm run setup:audio-analyzer` puts a downloaded release. */
  binDirectory: string;
  runTimeoutMs: number;
}

function envString(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

const EXE = process.platform === "win32" ? ".exe" : "";

export function readAudioAnalyzerConfig(): AudioAnalyzerConfig {
  const root = repositoryRoot();
  const cloneRoot = envString("AUDIO_ANALYZER_ROOT") ?? path.join(root, "audio-analyzer-rs");
  const runtimeManaged = process.env.BREADBOARD_RUNTIME_V2_ACTIVE === "true" &&
    envString("BREADBOARD_DATA_DIR") !== null;
  const binDirectory = runtimeManaged
    ? path.join(dashboardDataDir(), "runtime-v2", "audio-analyzer", "bin")
    : envString("AUDIO_ANALYZER_BIN_DIR") ?? path.join(root, ".runtime", "audio-analyzer", "bin");
  return {
    cloneRoot,
    binDirectory,
    // An explicit path wins, then a provisioned download, then a source build.
    // The download is preferred over `target/release` because that is what the
    // setup script produces on a machine with no Rust toolchain, which is most
    // of them.
    // Integrated Runtime V2 intentionally ignores legacy executable overrides:
    // only its sealed data-root profile may select the launched binary.
    serverExecutable: runtimeManaged
      ? path.join(binDirectory, `mcp-server${EXE}`)
      : envString("AUDIO_ANALYZER_SERVER") ?? path.join(binDirectory, `mcp-server${EXE}`),
    cliExecutable: runtimeManaged
      ? path.join(binDirectory, `cli${EXE}`)
      : envString("AUDIO_ANALYZER_CLI") ?? path.join(binDirectory, `cli${EXE}`),
    runTimeoutMs: Number(envString("AUDIO_ANALYZER_TIMEOUT_MS") ?? "") || DEFAULT_RUN_TIMEOUT_MS,
  };
}

/** Where a `cargo build --release` in the checkout leaves the same two binaries. */
export function sourceBuildPaths(cloneRoot: string): { server: string; cli: string } {
  const directory = path.join(cloneRoot, "target", "release");
  return {
    server: path.join(directory, `mcp-server${EXE}`),
    cli: path.join(directory, `cli${EXE}`),
  };
}
