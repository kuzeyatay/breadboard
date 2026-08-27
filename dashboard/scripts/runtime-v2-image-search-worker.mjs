import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 30_000;
const MAX_TEXT_BYTES = 512 * 1024;
const EXPECTED_ENTRY = ["runtime-v2", "toolchains", "google-images", "src", "index.js"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export function validateImageSearchRequest(value) {
  if (
    !exactRecord(value, ["query", "count", "safe", "startIndex"]) ||
    typeof value.query !== "string" ||
    !value.query.trim() ||
    value.query !== value.query.trim() ||
    Buffer.byteLength(value.query, "utf8") > 2_048 ||
    !Number.isSafeInteger(value.count) ||
    value.count < 1 ||
    value.count > 10 ||
    (value.safe !== null && !["off", "medium", "high"].includes(value.safe)) ||
    (value.startIndex !== null &&
      (!Number.isSafeInteger(value.startIndex) || value.startIndex < 1 || value.startIndex > 91))
  ) throw new Error("The canonical Google image-search request is invalid.");
  return value;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function googleEntry() {
  const configuredRoot = process.env.BREADBOARD_DATA_DIR?.trim();
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) {
    throw new Error("The trusted Google image-search data root is unavailable.");
  }
  const root = path.resolve(configuredRoot);
  const expected = path.join(root, ...EXPECTED_ENTRY);
  const metadata = fs.lstatSync(expected);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("The trusted Google image-search entrypoint is unavailable.");
  }
  const canonicalRoot = fs.realpathSync.native(root);
  const canonicalEntry = fs.realpathSync.native(expected);
  if (!samePath(canonicalEntry, expected) || !pathWithin(canonicalRoot, canonicalEntry)) {
    throw new Error("The trusted Google image-search entrypoint is indirect.");
  }
  return { entry: canonicalEntry, cwd: path.dirname(path.dirname(canonicalEntry)) };
}

function secret(name) {
  const value = process.env[name]?.trim() ?? "";
  if (!value || Buffer.byteLength(value, "utf8") > 4_096 || /[\u0000\r\n]/u.test(value)) {
    throw new Error("Google image search is not configured.");
  }
  return value;
}

function parseDimensions(value) {
  if (typeof value !== "string") return {};
  const match = /^(\d+)x(\d+)$/u.exec(value);
  if (!match) return {};
  const w = Number(match[1]);
  const h = Number(match[2]);
  return Number.isSafeInteger(w) && Number.isSafeInteger(h) ? { w, h } : {};
}

function boundedText(value, maximumBytes = 16 * 1024) {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= maximumBytes
    ? value
    : "";
}

function normalizeCloneResult(result, request) {
  const meta = isRecord(result?._meta) && isRecord(result._meta.error)
    ? result._meta.error
    : null;
  if (meta) {
    return {
      ok: false,
      code: "image_search_upstream_error",
      message: boundedText(meta.message, 400) || "Google image search rejected the request.",
    };
  }
  const content = Array.isArray(result?.content) ? result.content : [];
  let parsed = null;
  let examinedBytes = 0;
  for (const item of content) {
    if (item?.type !== "text" || typeof item.text !== "string") continue;
    examinedBytes += Buffer.byteLength(item.text, "utf8");
    if (examinedBytes > MAX_TEXT_BYTES) {
      return {
        ok: false,
        code: "image_search_failed",
        message: "The image search returned too much data.",
      };
    }
    if (!item.text.startsWith('{"imageResults":')) continue;
    try {
      parsed = JSON.parse(item.text).imageResults ?? null;
    } catch {
      parsed = null;
    }
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
    return {
      ok: false,
      code: "image_search_failed",
      message: "The image search returned no readable results.",
    };
  }
  const items = parsed.items.slice(0, request.count).flatMap((item) => {
    if (!isRecord(item)) return [];
    const link = boundedText(item.link);
    if (!/^https?:\/\//iu.test(link)) return [];
    const image = isRecord(item.image) ? item.image : {};
    const thumbnail = isRecord(image.thumbnail) ? image.thumbnail : {};
    return [{
      title: boundedText(item.title, 4_096),
      image: link,
      thumb: boundedText(thumbnail.link),
      page: boundedText(image.contextLink),
      site: boundedText(item.displayLink, 4_096),
      ...parseDimensions(image.dimensions),
    }];
  });
  const summary = isRecord(parsed.summary) ? parsed.summary : {};
  const pagination = isRecord(summary.pagination) ? summary.pagination : {};
  const query = boundedText(summary.query, 2_048) || request.query;
  const next = pagination.nextPageStartIndex;
  return {
    ok: true,
    data: {
      query,
      itemsReturned: items.length,
      ...(Number.isSafeInteger(next) && next >= 1 && next <= 101
        ? { nextPageStartIndex: next }
        : {}),
      display: { query, items },
    },
  };
}

async function executeImageSearch(launch, signal) {
  let trusted;
  try {
    trusted = {
      ...googleEntry(),
      apiKey: secret("BREADBOARD_GOOGLE_IMAGES_API_KEY"),
      searchEngineId: secret("BREADBOARD_GOOGLE_IMAGES_SEARCH_ENGINE_ID"),
    };
  } catch {
    return {
      ok: false,
      code: "image_search_runtime_unavailable",
      message: "The Google image-search runtime is not prepared or configured.",
    };
  }
  const client = new Client(
    { name: "breadboard-runtime-image-search", version: "1" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [trusted.entry],
    cwd: trusted.cwd,
    env: {
      API_KEY: trusted.apiKey,
      SEARCH_ENGINE_ID: trusted.searchEngineId,
    },
    stderr: "ignore",
  });
  try {
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS, signal });
  } catch {
    await client.close().catch(() => undefined);
    if (signal.aborted) {
      return { ok: false, code: "image_search_aborted", message: "The image search was cancelled." };
    }
    return {
      ok: false,
      code: "image_search_launch_failed",
      message: "The image search server could not start.",
    };
  }
  try {
    const request = launch.request;
    const result = await client.callTool({
      name: "search_image",
      arguments: {
        query: request.query,
        count: request.count,
        ...(request.safe === null ? {} : { safe: request.safe }),
        ...(request.startIndex === null ? {} : { startIndex: request.startIndex }),
      },
    }, undefined, { timeout: CALL_TIMEOUT_MS, signal });
    return normalizeCloneResult(result, request);
  } catch {
    if (signal.aborted) {
      return { ok: false, code: "image_search_aborted", message: "The image search was cancelled." };
    }
    return {
      ok: false,
      code: "image_search_failed",
      message: "The image search did not answer. Try again once.",
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

const launchedAsEntry = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (launchedAsEntry) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-image-search-worker",
    validateRequest: validateImageSearchRequest,
    expectedInputCount: () => 0,
    execute: executeImageSearch,
  });
}
