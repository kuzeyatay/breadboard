// One analysis, one process.
//
// The analyzer is an MCP server that speaks JSON-RPC over stdio. Breadboard
// starts it, performs the handshake, makes a single `tools/call`, reads the
// text back and lets the process go. That is deliberate: an analysis is CPU
// work that finishes in seconds, so a resident server would be one more thing
// to supervise, restart and reason about while adding nothing — and a crash in
// the middle of one track cannot then affect the next.
//
// Nothing here knows what a track is or where it came from. It is handed an
// absolute path that the caller has already established the user owns.

import { spawn } from "node:child_process";
import { MAX_OUTPUT_CHARS } from "./config.ts";

export class AudioAnalyzerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AudioAnalyzerError";
    this.code = code;
  }
}

/** The protocol revision the pinned server implements. */
const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcResponse {
  id?: number;
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code?: number; message?: string };
}

export interface McpCallInput {
  executable: string;
  tool: string;
  args: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Call one tool and return the text it produced.
 *
 * Failures are separated by cause because they need different sentences: a
 * server that will not start is an installation problem, a server that answers
 * `isError` is usually an unreadable file, and a timeout is a file too long for
 * the budget rather than anything being broken.
 */
export function callAnalyzerTool(input: McpCallInput): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const child = spawn(input.executable, [], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });

    const finish = (outcome: { text: string } | { error: AudioAnalyzerError }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      child.kill();
      if ("text" in outcome) resolve(outcome.text);
      else reject(outcome.error);
    };

    const timer = setTimeout(() => {
      finish({
        error: new AudioAnalyzerError(
          "audio_analyzer_timeout",
          "The audio analysis did not finish in time. A shorter section, or a shorter file, will.",
        ),
      });
    }, input.timeoutMs);

    const onAbort = () =>
      finish({
        error: new AudioAnalyzerError("audio_analyzer_aborted", "The audio analysis was cancelled."),
      });
    input.signal?.addEventListener("abort", onAbort, { once: true });

    const send = (message: Record<string, unknown>) => {
      if (child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      // A malfunctioning server flooding stdout must not be read to the end of
      // memory; the cap is well above anything a real analysis prints.
      if (buffer.length > MAX_OUTPUT_CHARS * 2) {
        finish({
          error: new AudioAnalyzerError(
            "audio_analyzer_output_too_large",
            "The analyzer returned more output than an analysis can be.",
          ),
        });
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message: JsonRpcResponse;
        try {
          message = JSON.parse(line) as JsonRpcResponse;
        } catch {
          continue; // Not every line a server writes is a response.
        }
        if (message.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: input.tool, arguments: input.args },
          });
          continue;
        }
        if (message.id !== 2) continue;
        if (message.error) {
          finish({
            error: new AudioAnalyzerError(
              "audio_analyzer_call_failed",
              message.error.message?.slice(0, 400) || "The analyzer rejected that request.",
            ),
          });
          return;
        }
        const text = (message.result?.content ?? [])
          .map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("\n")
          .trim();
        if (message.result?.isError) {
          finish({
            error: new AudioAnalyzerError(
              "audio_analyzer_unreadable",
              text.slice(0, 400) || "The analyzer could not read that audio file.",
            ),
          });
          return;
        }
        if (!text) {
          finish({
            error: new AudioAnalyzerError(
              "audio_analyzer_empty",
              "The analyzer returned nothing for that file.",
            ),
          });
          return;
        }
        // The pinned server reports a failed decode as ordinary content —
        // `Error: Failed to probe audio format…` with no `isError` flag — so a
        // file it cannot read would otherwise reach the model as a successful
        // analysis whose text happens to be an error. One line beginning with
        // `Error:` is that case; a report that merely mentions the word is not.
        if (/^Error:/i.test(text) && !text.includes("\n")) {
          finish({
            error: new AudioAnalyzerError(
              "audio_analyzer_unreadable",
              text.replace(/^Error:\s*/i, "").slice(0, 400) ||
                "The analyzer could not read that audio file.",
            ),
          });
          return;
        }
        finish({ text: text.slice(0, MAX_OUTPUT_CHARS) });
      }
    });

    child.on("error", () => {
      finish({
        error: new AudioAnalyzerError(
          "audio_analyzer_unavailable",
          "The audio analyzer could not be started. Run `npm run setup:audio-analyzer` once.",
        ),
      });
    });
    child.on("close", () => {
      finish({
        error: new AudioAnalyzerError(
          "audio_analyzer_exited",
          "The audio analyzer stopped before it answered.",
        ),
      });
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "breadboard", version: "1" },
      },
    });
  });
}
