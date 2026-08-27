import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  canonicalRuntimeInput,
  runRuntimeV2FiniteMcpWorker,
} from "./runtime-v2-finite-mcp-worker-core.mjs";

const ANALYSIS_TOOLS = {
  info: "audio_info",
  spectral: "spectral_features",
  harmonic: "harmonic_analysis",
  rhythm: "rhythm_analysis",
  full: "full_analysis",
};
const MAX_OUTPUT_CHARS = 200_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function optionalNumber(value, minimum, maximum) {
  return value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum);
}

export function validateAudioAnalyzerRequest(value) {
  if (exactRecord(value, ["operation"]) && value.operation === "compare") return value;
  if (
    !exactRecord(value, [
      "operation",
      "analysis",
      "resolution",
      "startTime",
      "endTime",
      "minBpm",
      "maxBpm",
    ]) ||
    value.operation !== "analyze" ||
    !Object.hasOwn(ANALYSIS_TOOLS, value.analysis) ||
    (value.resolution !== null &&
      (typeof value.resolution !== "string" ||
        !value.resolution ||
        Buffer.byteLength(value.resolution, "utf8") > 32 ||
        (!["low", "medium", "high"].includes(value.resolution) &&
          !(Number.isFinite(Number(value.resolution)) &&
            Number(value.resolution) > 0 &&
            Number(value.resolution) <= 50 &&
            String(Number(value.resolution)) === value.resolution)))) ||
    !optionalNumber(value.startTime, 0, 43_200) ||
    !optionalNumber(value.endTime, 0, 43_200) ||
    !optionalNumber(value.minBpm, 20, 400) ||
    !optionalNumber(value.maxBpm, 20, 400) ||
    (value.startTime !== null && value.endTime !== null && value.endTime <= value.startTime) ||
    (value.minBpm !== null && value.maxBpm !== null && value.maxBpm <= value.minBpm)
  ) throw new Error("The canonical audio-analysis request is invalid.");
  return value;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function analyzerExecutable(launch) {
  const configured = process.env.BREADBOARD_AUDIO_ANALYZER_SERVER?.trim();
  if (!configured) throw new Error("The trusted audio-analyzer executable is unavailable.");
  const resolved = path.resolve(configured);
  if (!pathWithin(launch.dataRoot, resolved)) {
    throw new Error("The trusted audio-analyzer executable escaped the Runtime data root.");
  }
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("The trusted audio-analyzer executable is unavailable.");
  }
  const canonical = fs.realpathSync.native(resolved);
  const same = process.platform === "win32"
    ? canonical.toLowerCase() === resolved.toLowerCase()
    : canonical === resolved;
  if (!same) throw new Error("The trusted audio-analyzer executable is indirect.");
  return canonical;
}

function timeoutMs() {
  const value = Number(process.env.BREADBOARD_AUDIO_ANALYZER_TIMEOUT_MS ?? "");
  return Number.isSafeInteger(value) && value >= 1_000 && value <= 10 * 60_000
    ? value
    : 10 * 60_000;
}

function analyzerArgs(launch) {
  if (launch.request.operation === "compare") {
    return {
      tool: "compare",
      args: {
        path_a: canonicalRuntimeInput(launch, 0),
        path_b: canonicalRuntimeInput(launch, 1),
      },
    };
  }
  const request = launch.request;
  const args = { path: canonicalRuntimeInput(launch, 0) };
  if (request.analysis !== "info") {
    if (request.resolution !== null) args.resolution = request.resolution;
    if (request.startTime !== null) args.start_time = request.startTime;
    if (request.endTime !== null) args.end_time = request.endTime;
    if (request.analysis === "rhythm") {
      if (request.minBpm !== null) args.min_bpm = request.minBpm;
      if (request.maxBpm !== null) args.max_bpm = request.maxBpm;
    }
  }
  return { tool: ANALYSIS_TOOLS[request.analysis], args };
}

function textResult(result) {
  const text = (Array.isArray(result.content) ? result.content : [])
    .map((part) => part?.type === "text" && typeof part.text === "string" ? part.text : "")
    .join("\n")
    .trim();
  if (result.isError) {
    return {
      ok: false,
      code: "audio_analyzer_unreadable",
      message: text.slice(0, 400) || "The analyzer could not read that audio file.",
    };
  }
  if (!text) {
    return { ok: false, code: "audio_analyzer_empty", message: "The analyzer returned nothing for that file." };
  }
  if (/^Error:/iu.test(text) && !text.includes("\n")) {
    return {
      ok: false,
      code: "audio_analyzer_unreadable",
      message: text.replace(/^Error:\s*/iu, "").slice(0, 400) ||
        "The analyzer could not read that audio file.",
    };
  }
  if (text.length > MAX_OUTPUT_CHARS) {
    return {
      ok: false,
      code: "audio_analyzer_output_too_large",
      message: "The analyzer returned more output than an analysis can be.",
    };
  }
  return { ok: true, report: text };
}

async function executeAudioAnalysis(launch, signal) {
  const startedAt = Date.now();
  let executable;
  try {
    executable = analyzerExecutable(launch);
  } catch {
    return {
      ok: false,
      code: "audio_analyzer_unavailable",
      message: "The audio analyzer is not installed on this machine. Run `npm run setup:audio-analyzer` once.",
    };
  }
  const client = new Client(
    { name: "breadboard-runtime-audio-analyzer", version: "1" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: executable,
    args: [],
    stderr: "ignore",
  });
  try {
    await client.connect(transport, { timeout: Math.min(timeoutMs(), 20_000), signal });
  } catch {
    await client.close().catch(() => undefined);
    if (signal.aborted) {
      return { ok: false, code: "audio_analyzer_aborted", message: "The audio analysis was cancelled." };
    }
    return {
      ok: false,
      code: "audio_analyzer_unavailable",
      message: "The audio analyzer could not be started. Run `npm run setup:audio-analyzer` once.",
    };
  }
  try {
    const call = analyzerArgs(launch);
    const result = await client.callTool(
      { name: call.tool, arguments: call.args },
      undefined,
      { timeout: timeoutMs(), signal },
    );
    return { ...textResult(result), durationMs: Date.now() - startedAt };
  } catch (error) {
    if (signal.aborted) {
      return { ok: false, code: "audio_analyzer_aborted", message: "The audio analysis was cancelled." };
    }
    const message = error instanceof Error ? error.message : "";
    if (/timed?\s*out|timeout/iu.test(message)) {
      return {
        ok: false,
        code: "audio_analyzer_timeout",
        message: "The audio analysis did not finish in time. A shorter section, or a shorter file, will.",
      };
    }
    return {
      ok: false,
      code: "audio_analyzer_call_failed",
      message: "The analyzer rejected that request.",
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

const launchedAsEntry = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (launchedAsEntry) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-audio-analyzer-worker",
    validateRequest: validateAudioAnalyzerRequest,
    expectedInputCount: (request) => request.operation === "compare" ? 2 : 1,
    execute: executeAudioAnalysis,
  });
}
