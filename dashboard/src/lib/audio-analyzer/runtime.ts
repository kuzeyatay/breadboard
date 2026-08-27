// Whether the audio analyzer could run right now, and if not, the one thing
// that is missing.
//
// A pure read. It only checks the provisioned artifact; opening a panel or a
// turn asking "is this available?" must never start a local process. Runtime V2
// performs the real protocol handshake inside the disposable analysis worker.

import fs from "node:fs";
import path from "node:path";
import { readAudioAnalyzerConfig, AUDIO_ANALYZER_VERSION } from "./config.ts";

export type AudioAnalyzerState =
  /** `npm run setup:audio-analyzer` has not been run. */
  | "not_installed"
  /** The expected path exists but is not a complete regular-file installation. */
  | "incomplete"
  | "ready";

export interface AudioAnalyzerStatus {
  state: AudioAnalyzerState;
  /** One sentence a person can act on. */
  detail: string;
  version: string;
  /** The pinned server identity once the exact provisioned artifact exists. */
  serverInfo?: { name: string; version: string };
}

function directExecutable(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size === 0) return false;
  const canonical = fs.realpathSync.native(resolved);
  return process.platform === "win32"
    ? canonical.toLowerCase() === resolved.toLowerCase()
    : canonical === resolved;
}

export async function audioAnalyzerStatus(): Promise<AudioAnalyzerStatus> {
  const config = readAudioAnalyzerConfig();
  const base = {
    version: AUDIO_ANALYZER_VERSION,
  };
  if (!fs.existsSync(config.serverExecutable)) {
    return {
      ...base,
      state: "not_installed",
      detail:
        "The audio analyzer is not installed yet. Run `npm run setup:audio-analyzer` once to " +
        "provision it; it is a single self-contained binary.",
    };
  }
  if (!directExecutable(config.serverExecutable)) {
    return {
      ...base,
      state: "incomplete",
      detail:
        "The audio analyzer installation is incomplete. Re-run " +
        "`npm run setup:audio-analyzer` to replace it.",
    };
  }
  const serverInfo = { name: "audio-analyzer-rs", version: AUDIO_ANALYZER_VERSION };
  return {
    ...base,
    state: "ready",
    serverInfo,
    detail: `Ready (${serverInfo.name} ${serverInfo.version}).`,
  };
}

/** The cheap half of the status: true when a call is worth attempting at all. */
export function audioAnalyzerInstalled(): boolean {
  return directExecutable(readAudioAnalyzerConfig().serverExecutable);
}
