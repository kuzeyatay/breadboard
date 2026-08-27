import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
const QUALITIES = new Set(["draft", "standard", "high"]);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function boundedText(value, maximumBytes) {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value);
}

function canonicalText(value, maximumCharacters) {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maximumCharacters;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function validateRuntimeV2ManimRequest(value) {
  if (
    !exactRecord(value, [
      "protocolVersion",
      "operation",
      "title",
      "description",
      "code",
      "sceneName",
      "quality",
      "sourceHash",
    ]) ||
    value.protocolVersion !== 1 ||
    value.operation !== "render" ||
    !canonicalText(value.title, 240) ||
    !canonicalText(value.description, 1_000) ||
    typeof value.code !== "string" ||
    !value.code.endsWith("\n") ||
    Buffer.byteLength(value.code, "utf8") > MAX_SOURCE_BYTES + 1 ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(value.sceneName) ||
    !QUALITIES.has(value.quality) ||
    !/^[a-f0-9]{64}$/u.test(value.sourceHash) ||
    createHash("sha256").update(value.code, "utf8").digest("hex") !== value.sourceHash
  ) fail("The canonical Manim Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2ManimScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    (value.gardenId !== null && !boundedText(value.gardenId, 256)) ||
    !boundedText(value.conversationId, 256)
  ) fail("The Manim worker requires authenticated conversation scope.");
  return value;
}

export function validateRuntimeV2ManimEnvironment(environment) {
  if (
    !boundedText(environment.MANIM_DOCKER_BIN, 2_048) ||
    !path.isAbsolute(environment.MANIM_DOCKER_BIN) ||
    !boundedText(environment.MANIM_DOCKER_IMAGE, 512) ||
    !/^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,511}$/u.test(environment.MANIM_DOCKER_IMAGE)
  ) fail("The sealed Manim Docker runtime is unavailable.");
  const timeout = Number(environment.MANIM_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeout) || timeout < 30_000 || timeout > 6 * 60_000) {
    fail("The sealed Manim timeout is invalid.");
  }
}

function sourceLayout(dataRoot) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(
    path.join(developmentSourceRoot, "lib", "manim", "service.ts"),
  );
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  for (const relativePath of [
    path.join("lib", "runtime-paths.ts"),
    path.join("lib", "manim", "config.ts"),
    path.join("lib", "manim", "request.ts"),
    path.join("lib", "manim", "service.ts"),
  ]) {
    if (!fs.existsSync(path.join(sourceRoot, relativePath))) {
      fail("The staged Manim worker source closure is unavailable.");
    }
  }
  const historicalDevelopmentData = development && samePath(dataRoot, appRoot);
  process.env.BREADBOARD_DATA_DIR = historicalDevelopmentData ? "" : dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = development ? dashboardRoot : "";
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_REPO_ROOT = appRoot;
  process.env.NODE_ENV = development ? "development" : "production";
  process.chdir(dashboardRoot);
  return sourceRoot;
}

function boundedFailure(error) {
  const raw = error instanceof Error ? error.message : "The Manim render failed.";
  const clean = raw.replace(/\p{Cc}+/gu, " ").trim() || "The Manim render failed.";
  const bytes = Buffer.from(clean, "utf8");
  return (bytes.byteLength <= 32 * 1024 ? bytes : bytes.subarray(0, 32 * 1024))
    .toString("utf8")
    .replace(/\uFFFD+$/u, "") || "The Manim render failed.";
}

function relativeDataPath(dataRoot, filePath) {
  const relative = path.relative(path.resolve(dataRoot), path.resolve(filePath));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) fail("The Manim output escaped the Runtime data root.");
  return relative.split(path.sep).join("/");
}

function writeVideo(stageRoot, video) {
  if (!(video instanceof Uint8Array) || video.byteLength < 12 || video.byteLength > MAX_OUTPUT_BYTES) {
    fail("Manim produced an invalid video size.");
  }
  if (Buffer.from(video.buffer, video.byteOffset + 4, 4).toString("ascii") !== "ftyp") {
    fail("Manim produced a file that is not MP4 video.");
  }
  fs.mkdirSync(stageRoot, { recursive: false });
  const output = path.join(stageRoot, "animation.mp4");
  const descriptor = fs.openSync(output, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, video);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return output;
}

export async function executeRuntimeV2Manim(launch, signal, progress) {
  validateRuntimeV2ManimRequest(launch.request);
  validateRuntimeV2ManimScope(launch.executionScope);
  validateRuntimeV2ManimEnvironment(process.env);
  const sourceRoot = sourceLayout(launch.dataRoot);
  process.env.TMP = launch.workspacePath;
  process.env.TEMP = launch.workspacePath;
  await import(
    pathToFileURL(path.join(path.dirname(ENTRYPOINT), "learn-worker-import-hook.mjs")).href
  );
  const service = await import(
    pathToFileURL(path.join(sourceRoot, "lib", "manim", "service.ts")).href
  );
  if (
    typeof service.runManim !== "function" ||
    typeof service.validateManimRequest !== "function"
  ) fail("The staged Manim executor is unavailable.");

  try {
    progress.checkpoint({ stage: "rendering", percent: 5 });
    const request = service.validateManimRequest({
      title: launch.request.title,
      description: launch.request.description,
      code: launch.request.code,
      sceneName: launch.request.sceneName,
      quality: launch.request.quality,
    });
    if (JSON.stringify(request) !== JSON.stringify({
      title: launch.request.title,
      description: launch.request.description,
      code: launch.request.code,
      sceneName: launch.request.sceneName,
      quality: launch.request.quality,
    })) fail("The canonical Manim source changed during worker validation.");
    const result = await service.runManim(request, signal);
    if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    if (result.sourceHash !== launch.request.sourceHash) {
      fail("The Manim renderer returned a different source identity.");
    }
    const stageRoot = path.join(launch.workspacePath, "manim-stage");
    if (!pathWithin(launch.workspacePath, stageRoot) || samePath(launch.workspacePath, stageRoot)) {
      fail("The Manim output stage is invalid.");
    }
    const output = writeVideo(stageRoot, result.video);
    progress.checkpoint({ stage: "complete", percent: 100 });
    return {
      ok: true,
      operation: "render",
      outputRelativePath: relativeDataPath(launch.dataRoot, output),
      sizeBytes: fs.statSync(output).size,
      image: result.image,
      durationSeconds: result.durationSeconds,
      sourceHash: result.sourceHash,
    };
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    const candidate = error && typeof error === "object" && typeof error.code === "string"
      ? error.code.slice(0, 128)
      : "manim_render_failed";
    return {
      ok: false,
      operation: "render",
      errorCode: /^[a-z][a-z0-9_]{0,127}$/u.test(candidate) ? candidate : "manim_render_failed",
      message: boundedFailure(error),
    };
  }
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-manim-worker",
    validateRequest: validateRuntimeV2ManimRequest,
    validateExecutionScope: validateRuntimeV2ManimScope,
    expectedInputCount: () => 0,
    execute: executeRuntimeV2Manim,
  });
}
