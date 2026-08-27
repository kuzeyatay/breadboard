import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const MAX_SOURCE_CHARACTERS = 60_000;
const MAX_REQUEST_BYTES = 512 * 1024;

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

function directFile(candidate) {
  try {
    const metadata = fs.lstatSync(candidate);
    return metadata.isFile() && !metadata.isSymbolicLink() &&
      samePath(fs.realpathSync.native(candidate), candidate);
  } catch {
    return false;
  }
}

function basicOpportunity(value) {
  if (
    !isRecord(value) ||
    !boundedText(value.id, 256) ||
    !boundedText(value.gardenId, 256) ||
    !boundedText(value.learningUnitId, 256) ||
    !boundedText(value.targetPage, 2_048) ||
    !Array.isArray(value.requiredInputs) || value.requiredInputs.length > 64 ||
    !Array.isArray(value.requiredOutputs) || value.requiredOutputs.length > 64 ||
    !Array.isArray(value.sourceAnchorIds) || value.sourceAnchorIds.length > 512
  ) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_REQUEST_BYTES / 2;
  } catch {
    return false;
  }
}

export function validateGeneratedVisualCompilerRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation", "sourceCode", "opportunity"]) ||
    value.protocolVersion !== 1 ||
    value.operation !== "compile-generated-visual" ||
    typeof value.sourceCode !== "string" ||
    value.sourceCode.length === 0 ||
    value.sourceCode.length > MAX_SOURCE_CHARACTERS ||
    Buffer.byteLength(value.sourceCode, "utf8") > MAX_REQUEST_BYTES / 2 ||
    !basicOpportunity(value.opportunity)
  ) fail("The canonical generated-visual compiler request is invalid.");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_REQUEST_BYTES) {
    fail("The generated-visual compiler request exceeds its byte bound.");
  }
  return value;
}

export function validateGeneratedVisualCompilerExecutionScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) || value.userId < 1 ||
    !boundedText(value.gardenId, 256) ||
    value.conversationId !== null
  ) fail("Generated-visual compilation requires authenticated garden scope.");
  return value;
}

function compilerSource() {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSource = path.join(
    developmentDashboardRoot,
    "src",
    "lib",
    "generated-visual-compiler.ts",
  );
  const packagedSource = path.join(
    appRoot,
    "dashboard-standalone",
    "dashboard",
    "worker-src",
    "lib",
    "generated-visual-compiler.ts",
  );
  const selected = directFile(developmentSource) ? developmentSource : packagedSource;
  if (!directFile(selected)) {
    fail("The staged generated-visual compiler source is unavailable.");
  }
  return selected;
}

export async function executeGeneratedVisualCompilerOperation(launch) {
  const scope = validateGeneratedVisualCompilerExecutionScope(launch.executionScope);
  const request = validateGeneratedVisualCompilerRequest(launch.request);
  if (request.opportunity.gardenId !== scope.gardenId) {
    fail("The generated-visual compiler request is outside its garden scope.");
  }
  const loaded = await import(pathToFileURL(compilerSource()).href);
  if (typeof loaded.compileGeneratedVisualization !== "function") {
    fail("The staged generated-visual compiler export is invalid.");
  }
  return loaded.compileGeneratedVisualization(
    request.sourceCode,
    request.opportunity,
  );
}
