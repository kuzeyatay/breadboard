// Whether the audio analyzer could run right now, and if not, the one thing
// that is missing.
//
// A pure read. It starts the server, completes a handshake and stops it — it
// never builds, downloads or installs, because a panel opening or a turn asking
// "is this available?" must not provision anything as a side effect.

import fs from "node:fs";
import { spawn } from "node:child_process";
import { readAudioAnalyzerConfig, AUDIO_ANALYZER_VERSION } from "./config.ts";

export type AudioAnalyzerState =
  /** `npm run setup:audio-analyzer` has not been run. */
  | "not_installed"
  /** The binary is there but does not speak the protocol — a partial or stale install. */
  | "incomplete"
  | "ready";

export interface AudioAnalyzerStatus {
  state: AudioAnalyzerState;
  /** One sentence a person can act on. */
  detail: string;
  version: string;
  serverExecutable: string;
  /** The server's own identification, once the handshake succeeded. */
  serverInfo?: { name: string; version: string };
}

/** Long enough for a cold start from a spinning disk, short enough not to hang a panel. */
const PROBE_TIMEOUT_MS = 20_000;

function handshake(executable: string, signal?: AbortSignal): Promise<{ name: string; version: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { name: string; version: string } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const child = spawn(executable, [], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);

    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (buffer.length < 64 * 1024) buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const message = JSON.parse(buffer.slice(0, newline)) as {
          result?: { serverInfo?: { name?: string; version?: string } };
        };
        const info = message.result?.serverInfo;
        finish(info?.name ? { name: info.name, version: info.version ?? "" } : null);
      } catch {
        finish(null);
      }
    });
    child.on("error", () => finish(null));
    child.on("close", () => finish(null));
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "breadboard", version: "1" },
        },
      })}\n`,
    );
  });
}

export async function audioAnalyzerStatus(signal?: AbortSignal): Promise<AudioAnalyzerStatus> {
  const config = readAudioAnalyzerConfig();
  const base = {
    version: AUDIO_ANALYZER_VERSION,
    serverExecutable: config.serverExecutable,
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
  const serverInfo = await handshake(config.serverExecutable, signal);
  if (!serverInfo) {
    return {
      ...base,
      state: "incomplete",
      detail:
        "The audio analyzer binary is present but did not answer. Re-run " +
        "`npm run setup:audio-analyzer` to replace it.",
    };
  }
  return {
    ...base,
    state: "ready",
    serverInfo,
    detail: `Ready (${serverInfo.name} ${serverInfo.version}).`,
  };
}

/** The cheap half of the status: true when a call is worth attempting at all. */
export function audioAnalyzerInstalled(): boolean {
  return fs.existsSync(readAudioAnalyzerConfig().serverExecutable);
}
