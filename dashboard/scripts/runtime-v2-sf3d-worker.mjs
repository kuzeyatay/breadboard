import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  canonicalRuntimeInput,
  runRuntimeV2FiniteMcpWorker,
} from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const MAX_INPUT_BYTES = 24 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

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

function validOptions(value) {
  return exactRecord(value, [
    "textureResolution",
    "remesh",
    "targetVertexCount",
    "removeBackground",
  ]) &&
    [256, 512, 1024, 2048].includes(value.textureResolution) &&
    ["none", "triangle", "quad"].includes(value.remesh) &&
    Number.isInteger(value.targetVertexCount) &&
    (value.targetVertexCount === -1 ||
      (value.targetVertexCount >= 200 && value.targetVertexCount <= 500_000)) &&
    typeof value.removeBackground === "boolean";
}

export function validateRuntimeV2Sf3dRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation", "imageName", "mediaType", "options"]) ||
    value.protocolVersion !== 1 ||
    value.operation !== "reconstruct" ||
    !boundedText(value.imageName, 240) ||
    value.imageName !== path.basename(value.imageName) ||
    /[\\/\u0000]/u.test(value.imageName) ||
    !["image/jpeg", "image/png", "image/webp"].includes(value.mediaType) ||
    !validOptions(value.options)
  ) fail("The canonical Stable Fast 3D request is invalid.");
  return value;
}

export function validateRuntimeV2Sf3dScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    (value.gardenId !== null && !boundedText(value.gardenId, 256)) ||
    !boundedText(value.conversationId, 256)
  ) fail("The Stable Fast 3D worker requires authenticated conversation scope.");
  return value;
}

export function validateRuntimeV2Sf3dEnvironment(environment) {
  const cloneRoot = environment.SF3D_ROOT;
  const python = environment.SF3D_PYTHON;
  if (
    !boundedText(cloneRoot, 2_048) ||
    !path.isAbsolute(cloneRoot) ||
    !boundedText(python, 2_048) ||
    !path.isAbsolute(python)
  ) fail("The sealed Stable Fast 3D runtime paths are unavailable.");
  const timeout = environment.SF3D_TIMEOUT_MS;
  if (timeout !== undefined && timeout !== "") {
    const numeric = Number(timeout);
    if (!Number.isSafeInteger(numeric) || numeric < 30_000 || numeric > 10 * 60_000) {
      fail("The sealed Stable Fast 3D timeout is invalid.");
    }
  }
  const device = environment.SF3D_DEVICE;
  if (device !== undefined && device !== "" && !["cuda", "mps", "cpu"].includes(device)) {
    fail("The sealed Stable Fast 3D device is invalid.");
  }
}

function sourceLayout(dataRoot) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(
    path.join(developmentSourceRoot, "lib", "sf3d", "service.ts"),
  );
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  for (const relativePath of [
    path.join("lib", "runtime-paths.ts"),
    path.join("lib", "model-attachments.ts"),
    path.join("lib", "conversations", "model-inspect.ts"),
    path.join("lib", "sf3d", "config.ts"),
    path.join("lib", "sf3d", "request.ts"),
    path.join("lib", "sf3d", "runtime.ts"),
    path.join("lib", "sf3d", "service.ts"),
  ]) {
    if (!fs.existsSync(path.join(sourceRoot, relativePath))) {
      fail("The staged Stable Fast 3D worker source closure is unavailable.");
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
  const raw = error instanceof Error ? error.message : "The reconstruction failed.";
  const clean = raw.replace(/\p{Cc}+/gu, " ").trim() || "The reconstruction failed.";
  const bytes = Buffer.from(clean, "utf8");
  return (bytes.byteLength <= 32 * 1024 ? bytes : bytes.subarray(0, 32 * 1024))
    .toString("utf8")
    .replace(/\uFFFD+$/u, "") || "The reconstruction failed.";
}

function relativeDataPath(dataRoot, filePath) {
  const relative = path.relative(path.resolve(dataRoot), path.resolve(filePath));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) fail("The Stable Fast 3D output escaped the Runtime data root.");
  return relative.split(path.sep).join("/");
}

function writeMesh(stageRoot, mesh) {
  if (!(mesh instanceof Uint8Array) || mesh.byteLength < 1 || mesh.byteLength > MAX_OUTPUT_BYTES) {
    fail("Stable Fast 3D produced an invalid mesh size.");
  }
  if (Buffer.from(mesh.buffer, mesh.byteOffset, Math.min(mesh.byteLength, 4)).toString("ascii") !== "glTF") {
    fail("Stable Fast 3D produced a file that is not binary glTF.");
  }
  fs.mkdirSync(stageRoot, { recursive: false });
  const output = path.join(stageRoot, "mesh.glb");
  const descriptor = fs.openSync(output, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, mesh);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return output;
}

export async function executeRuntimeV2Sf3d(launch, signal, progress) {
  validateRuntimeV2Sf3dRequest(launch.request);
  validateRuntimeV2Sf3dScope(launch.executionScope);
  validateRuntimeV2Sf3dEnvironment(process.env);
  const blob = launch.inputBlobs[0];
  if (
    blob.displayName !== launch.request.imageName ||
    blob.mediaType !== launch.request.mediaType ||
    blob.sizeBytes > MAX_INPUT_BYTES
  ) fail("The sealed Stable Fast 3D image metadata is inconsistent.");

  const imagePath = canonicalRuntimeInput(launch, 0);
  progress.checkpoint({ stage: "loading", percent: 1 });
  const sourceRoot = sourceLayout(launch.dataRoot);
  process.env.TMP = launch.workspacePath;
  process.env.TEMP = launch.workspacePath;
  await import(
    pathToFileURL(path.join(path.dirname(ENTRYPOINT), "learn-worker-import-hook.mjs")).href
  );
  const [service, inspector] = await Promise.all([
    import(pathToFileURL(path.join(sourceRoot, "lib", "sf3d", "service.ts")).href),
    import(pathToFileURL(path.join(sourceRoot, "lib", "conversations", "model-inspect.ts")).href),
  ]);
  if (typeof service.runImageTo3d !== "function" || typeof inspector.inspectModelUpload !== "function") {
    fail("The staged Stable Fast 3D executor is unavailable.");
  }

  try {
    progress.checkpoint({ stage: "reconstructing", percent: 5 });
    const image = fs.readFileSync(imagePath);
    const result = await service.runImageTo3d({
      image,
      imageName: launch.request.imageName,
      options: launch.request.options,
      signal,
    });
    if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    let summary = {};
    try {
      summary = inspector.inspectModelUpload(result.mesh, "glb");
    } catch {
      summary = {};
    }
    const stageRoot = path.join(launch.workspacePath, "sf3d-stage");
    if (!pathWithin(launch.workspacePath, stageRoot) || samePath(launch.workspacePath, stageRoot)) {
      fail("The Stable Fast 3D output stage is invalid.");
    }
    const output = writeMesh(stageRoot, result.mesh);
    progress.checkpoint({ stage: "complete", percent: 100 });
    return {
      ok: true,
      operation: "reconstruct",
      outputRelativePath: relativeDataPath(launch.dataRoot, output),
      sizeBytes: fs.statSync(output).size,
      device: result.device,
      durationSeconds: result.durationSeconds,
      peakMemoryMb: result.peakMemoryMb,
      options: result.options,
      summary,
    };
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    return {
      ok: false,
      operation: "reconstruct",
      errorCode:
        error && typeof error === "object" && typeof error.code === "string"
          ? error.code.slice(0, 128)
          : "sf3d_reconstruction_failed",
      message: boundedFailure(error),
    };
  }
}

if (
  typeof process.argv[1] === "string" &&
  samePath(process.argv[1], ENTRYPOINT)
) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-sf3d-worker",
    validateRequest: validateRuntimeV2Sf3dRequest,
    validateExecutionScope: validateRuntimeV2Sf3dScope,
    expectedInputCount: () => 1,
    execute: executeRuntimeV2Sf3d,
  });
}
