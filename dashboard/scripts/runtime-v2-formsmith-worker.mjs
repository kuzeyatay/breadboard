import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalRuntimeInputAsync,
  runRuntimeV2FiniteMcpWorker,
} from "./runtime-v2-finite-mcp-worker-core.mjs";
import {
  executeFormsmith,
  formsmithExecutionFailure,
} from "./runtime-v2-formsmith-executor.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const PROTOCOL_VERSION = 1;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

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

export function validateRuntimeV2FormsmithRequest(value) {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION) {
    fail("The canonical Formsmith request is invalid.");
  }
  if (value.operation === "probe") {
    if (!exactRecord(value, ["protocolVersion", "operation"])) {
      fail("The canonical Formsmith probe request is invalid.");
    }
    return value;
  }
  if (
    value.operation !== "reconstruct" ||
    !exactRecord(value, ["protocolVersion", "operation", "filename", "sizeBytes"]) ||
    !boundedText(value.filename, 512) ||
    value.filename !== path.basename(value.filename) ||
    /[\\/\u0000]/u.test(value.filename) ||
    !EXTENSIONS.has(path.extname(value.filename).toLowerCase()) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 1 ||
    value.sizeBytes > MAX_IMAGE_BYTES
  ) fail("The canonical Formsmith reconstruction request is invalid.");
  return value;
}

export function validateRuntimeV2FormsmithScope(value) {
  const boundedScope = (item) => boundedText(item, 256);
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    (value.gardenId !== null && !boundedScope(value.gardenId)) ||
    (value.conversationId !== null && !boundedScope(value.conversationId))
  ) fail("Formsmith requires authenticated Runtime scope.");
  return value;
}

export function expectedRuntimeV2FormsmithInputCount(request) {
  return request.operation === "reconstruct" ? 1 : 0;
}

export async function executeRuntimeV2Formsmith(launch, signal, progress, options = {}) {
  if (
    launch.request.operation === "probe" &&
    (launch.executionScope.gardenId !== null || launch.executionScope.conversationId !== null)
  ) fail("The Formsmith probe scope is invalid.");
  if (
    launch.request.operation === "reconstruct" &&
    (!boundedText(launch.executionScope.conversationId, 256) || launch.inputBlobs.length !== 1)
  ) fail("The Formsmith reconstruction scope is invalid.");
  const inputPath = launch.request.operation === "reconstruct"
    ? await canonicalRuntimeInputAsync(launch, 0, signal)
    : null;
  try {
    return await executeFormsmith(launch, signal, progress, inputPath, options);
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    return formsmithExecutionFailure(error);
  }
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-formsmith-worker",
    validateRequest: validateRuntimeV2FormsmithRequest,
    validateExecutionScope: validateRuntimeV2FormsmithScope,
    expectedInputCount: expectedRuntimeV2FormsmithInputCount,
    maximumInputBytes: MAX_IMAGE_BYTES,
    execute: executeRuntimeV2Formsmith,
  });
}
