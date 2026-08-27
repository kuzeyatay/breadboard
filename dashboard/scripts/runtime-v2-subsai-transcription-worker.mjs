import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalRuntimeInputAsync,
  runRuntimeV2FiniteMcpWorker,
} from "./runtime-v2-finite-mcp-worker-core.mjs";
import {
  SUBSAI_MAX_INPUT_BYTES,
  SUBSAI_MAX_OUTPUT_BYTES,
  boundedText,
  directDirectory,
  directFile,
  exactRecord,
  failSubsAiWorker,
  pathWithin,
  prepareRuntimeV2SubsAiLayout,
  runtimeV2SubsAiChildEnvironment,
  samePath,
  validateRuntimeV2SubsAiScope,
} from "./runtime-v2-subsai-worker-layout.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const TRANSCRIBE_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
const DEFAULT_MODEL = "guillaumekln/faster-whisper";
const WHISPER_SIZES = new Set(["tiny", "base", "small", "medium", "large-v3"]);
const SUBTITLE_FORMATS = new Set(["srt", "vtt", "ass", "ssa", "sub", "txt"]);

export function validateRuntimeV2SubsAiTranscriptionRequest(value) {
  const baseKeys = ["protocolVersion", "operation", "size", "language"];
  const keys = value?.operation === "subtitles" ? [...baseKeys, "format"] : baseKeys;
  if (
    !exactRecord(value, keys) ||
    value.protocolVersion !== 1 ||
    !["words", "subtitles"].includes(value.operation) ||
    !WHISPER_SIZES.has(value.size) ||
    !(value.language === null || (
      boundedText(value.language, 64) && value.language.trim() === value.language &&
      value.language.length > 0
    )) ||
    (value.operation === "subtitles" && !SUBTITLE_FORMATS.has(value.format))
  ) failSubsAiWorker("The canonical subsai transcription request is invalid.");
  return value;
}

function relativeDataPath(dataRoot, candidate) {
  const relative = path.relative(dataRoot, candidate);
  if (
    !relative || relative === ".." || relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) failSubsAiWorker("The subsai output escaped Runtime data.");
  return relative.split(path.sep).join("/");
}

function modelConfig(request) {
  const device = process.env.SUBSAI_DEVICE?.trim() || "cpu";
  const computeType = process.env.SUBSAI_COMPUTE_TYPE?.trim() ||
    (device === "cpu" ? "int8" : "default");
  return {
    model_size_or_path: request.size,
    device,
    compute_type: computeType,
    ...(request.operation === "words" ? { word_timestamps: true } : {}),
    ...(request.language ? { language: request.language } : {}),
  };
}

function cleanFailureTail(stderr) {
  return stderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("█") && !/^\s*\d+%/u.test(line))
    .slice(-3)
    .join(" ");
}

export function runRuntimeV2SubsAiPython(layout, args, signal, onProgress) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(layout.python, args, {
        cwd: layout.root,
        windowsHide: true,
        detached: false,
        env: runtimeV2SubsAiChildEnvironment(layout),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        code: null,
        stderr: error instanceof Error ? error.message : "The subtitle process could not start.",
        spawnError: true,
      });
      return;
    }
    let stderr = "";
    let buffered = "";
    let settled = false;
    const consume = (chunk) => {
      buffered += chunk;
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (/download/iu.test(line)) {
          onProgress({ stage: "Downloading the model", detail: line.slice(0, 120) });
        } else if (/transcrib/iu.test(line)) {
          onProgress({ stage: "Transcribing" });
        }
        newline = buffered.indexOf("\n");
      }
      if (Buffer.byteLength(buffered, "utf8") > 100_000) buffered = "";
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", consume);
    child.stderr.on("data", (chunk) => {
      const bytes = Buffer.from(`${stderr}${chunk}`, "utf8");
      stderr = bytes.byteLength <= 8_000
        ? bytes.toString("utf8")
        : bytes.subarray(bytes.byteLength - 8_000).toString("utf8").replace(/^\uFFFD+/u, "");
      consume(chunk);
    });
    const stop = () => {
      try { child.kill("SIGKILL"); } catch { /* The child already exited. */ }
    };
    const timer = setTimeout(stop, TRANSCRIBE_TIMEOUT_MS);
    timer.unref?.();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      resolve(result);
    };
    signal.addEventListener("abort", stop, { once: true });
    child.once("error", (error) => finish({
      code: null,
      stderr: `${stderr}${error.message}`.slice(-8_000),
      spawnError: true,
    }));
    child.once("close", (code) => finish({ code, stderr, spawnError: false }));
    if (signal.aborted) stop();
  });
}

async function producedFile(stage, format) {
  const entries = await fsp.readdir(stage);
  if (entries.length > 256) {
    failSubsAiWorker("The subsai output directory exceeded its file bound.");
  }
  const name = entries.find((entry) => entry.toLowerCase().endsWith(`.${format}`));
  if (!name) return null;
  const candidate = path.join(stage, name);
  if (!pathWithin(stage, candidate)) return null;
  return directFile(candidate, stage, "The subsai output is indirect.");
}

function failure(errorCode, message) {
  return { ok: false, operation: "transcribe", errorCode, message };
}

export async function executeRuntimeV2SubsAiTranscription(
  launch,
  signal,
  progress,
  dependencies = {},
) {
  const request = validateRuntimeV2SubsAiTranscriptionRequest(launch.request);
  validateRuntimeV2SubsAiScope(launch.executionScope);
  progress.checkpoint({ stage: "preparing" });
  const layout = prepareRuntimeV2SubsAiLayout(ENTRYPOINT, launch, { createModelCache: true });
  if (!layout.root) {
    return failure("environment_missing", "The subsai clone was not found next to the dashboard.");
  }
  if (!layout.python) {
    return failure(
      "environment_missing",
      layout.uv
        ? "Subtitles need an environment of their own. Build it from Video Use's settings."
        : "Subtitles need an environment of their own, and uv was not found to build it.",
    );
  }
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const inputPath = await (dependencies.canonicalInput ?? canonicalRuntimeInputAsync)(
    launch,
    0,
    signal,
  );
  const stage = path.join(layout.workspace, "subsai-stage");
  fs.mkdirSync(stage, { recursive: false, mode: 0o700 });
  directDirectory(stage, layout.workspace, "The private subsai output stage is indirect.");
  let keepStage = false;
  try {
    const format = request.operation === "words" ? "srt" : request.format;
    const args = [
      "-m", "subsai.cli",
      inputPath,
      "--model", DEFAULT_MODEL,
      "--model-configs", JSON.stringify(modelConfig(request)),
      "--format", format,
      "--destination-folder", stage,
    ];
    progress.checkpoint({ stage: "starting" });
    const launched = await (dependencies.runPython ?? runRuntimeV2SubsAiPython)(
      layout,
      args,
      signal,
      (value) => progress.checkpoint(value),
    );
    if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    if (launched.spawnError) {
      return failure("spawn_failed", launched.stderr || "The subtitle process could not start.");
    }
    if (launched.code !== 0) {
      const detail = cleanFailureTail(launched.stderr);
      return failure(
        "transcribe_failed",
        detail
          ? `Subtitles could not be generated: ${detail}`
          : "Subtitles could not be generated.",
      );
    }
    const output = await producedFile(stage, format);
    if (!output) {
      return failure("no_output", "Transcription finished without writing a subtitle file.");
    }
    const metadata = fs.lstatSync(output);
    if (metadata.size < 1 || metadata.size > SUBSAI_MAX_OUTPUT_BYTES) {
      return failure("output_too_large", "The generated subtitle file exceeded its size limit.");
    }
    keepStage = true;
    progress.checkpoint({ stage: "complete" });
    return {
      ok: true,
      operation: "transcribe",
      mode: request.operation,
      format,
      outputRelativePath: relativeDataPath(layout.dataRoot, output),
      sizeBytes: metadata.size,
    };
  } finally {
    if (!keepStage) fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-subsai-transcription-worker",
    validateRequest: validateRuntimeV2SubsAiTranscriptionRequest,
    validateExecutionScope: validateRuntimeV2SubsAiScope,
    expectedInputCount: () => 1,
    maximumInputBytes: SUBSAI_MAX_INPUT_BYTES,
    execute: executeRuntimeV2SubsAiTranscription,
  });
}
