import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Memory } from "mem0ai/oss";

import { startRuntimeV2GatewayHttpService } from "./runtime-v2-gateway-http.mjs";

const DEFAULT_EMBEDDING_MODEL = "local/bge-small-en-v1.5";
const DEFAULT_EMBEDDING_DIMENSION = 384;
const DEFAULT_CHATMOCK_BASE_URL = "http://127.0.0.1:8765/v1";
const MAX_TEXT_BYTES = 32 * 1024;

function fail(message, status = 500, code = "mem0_request_failed") {
  throw Object.assign(new Error(message), { status, code });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, required, optional = []) {
  if (!isRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function boundedText(value, label, maximumBytes = MAX_TEXT_BYTES) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    /\u0000/u.test(value)
  ) {
    fail(`${label} is invalid.`, 400, "invalid_mem0_request");
  }
  return value;
}

function positiveUserId(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("The semantic-memory user scope is invalid.", 400, "invalid_mem0_scope");
  }
  return value;
}

function normalizeOpenAiBaseUrl(value) {
  const trimmed = value?.trim() ?? "";
  const candidate = trimmed || DEFAULT_CHATMOCK_BASE_URL;
  let url;
  try {
    url = new URL(/^https?:\/\//iu.test(candidate) ? candidate : `http://${candidate}`);
  } catch {
    fail("The semantic-memory model endpoint is invalid.", 500, "invalid_mem0_configuration");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
    fail("The semantic-memory model endpoint is invalid.", 500, "invalid_mem0_configuration");
  }
  const pathname = url.pathname.replace(/\/+$/u, "");
  url.pathname = pathname.endsWith("/v1") ? pathname : `${pathname || ""}/v1`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
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

/**
 * Runtime V2 hands services its canonical data root, which on Windows carries
 * the verbatim `\\?\` prefix that `fs.canonicalize` produces. Node's
 * `realpathSync.native` answers without that prefix, so comparing the two
 * spellings rejected every data root as "indirect" while the directory was
 * perfectly direct. Compare the same spelling on both sides. (Written without
 * backslash literals: the prefix is assembled from character codes.)
 */
function withoutVerbatimPrefix(value) {
  if (process.platform !== "win32") return value;
  const backslash = String.fromCharCode(92);
  const verbatim = `${backslash}${backslash}?${backslash}`;
  if (!value.startsWith(verbatim)) return value;
  const rest = value.slice(verbatim.length);
  const uncMarker = `UNC${backslash}`;
  return rest.slice(0, uncMarker.length).toUpperCase() === uncMarker
    ? `${backslash}${backslash}${rest.slice(uncMarker.length)}`
    : rest;
}

function directDataDirectory() {
  const configured = process.env.BREADBOARD_DATA_DIR?.trim();
  if (!configured) fail("The semantic-memory data root is unavailable.", 500, "invalid_mem0_configuration");
  const root = path.resolve(withoutVerbatimPrefix(configured));
  const metadata = fs.lstatSync(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("The semantic-memory data root is unavailable.", 500, "invalid_mem0_configuration");
  }
  const canonical = fs.realpathSync.native(root);
  if (!samePath(root, canonical)) {
    fail("The semantic-memory data root is indirect.", 500, "invalid_mem0_configuration");
  }
  return canonical;
}

function ensureDirectSubdirectory(root, segments) {
  let current = root;
  for (const segment of segments) {
    const candidate = path.join(current, segment);
    const existing = fs.lstatSync(candidate, { throwIfNoEntry: false });
    if (!existing) fs.mkdirSync(candidate, { recursive: false });
    const metadata = fs.lstatSync(candidate);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(candidate), candidate) ||
      !pathWithin(root, candidate)
    ) {
      fail("The semantic-memory storage directory is indirect.", 500, "invalid_mem0_configuration");
    }
    current = candidate;
  }
  return current;
}

function directMutableFile(root, candidate) {
  if (!pathWithin(root, candidate)) {
    fail("The semantic-memory storage path escaped its data root.", 500, "invalid_mem0_configuration");
  }
  const metadata = fs.lstatSync(candidate, { throwIfNoEntry: false });
  if (metadata && (!metadata.isFile() || metadata.isSymbolicLink())) {
    fail("The semantic-memory database path is indirect.", 500, "invalid_mem0_configuration");
  }
  if (metadata && !samePath(fs.realpathSync.native(candidate), candidate)) {
    fail("The semantic-memory database path is indirect.", 500, "invalid_mem0_configuration");
  }
  return candidate;
}

function engineConfig() {
  const embeddingModel = process.env.BREADBOARD_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  const configuredDimension = Number(process.env.BREADBOARD_EMBEDDING_DIMENSIONS ?? "");
  const dimension = process.env.BREADBOARD_EMBEDDING_MODEL?.trim()
    ? Number.isSafeInteger(configuredDimension) && configuredDimension > 0
      ? configuredDimension
      : 0
    : DEFAULT_EMBEDDING_DIMENSION;
  const fingerprint = `${embeddingModel}@${dimension}`;
  const dataRoot = directDataDirectory();
  const canonicalDataDirectory = ensureDirectSubdirectory(dataRoot, ["database", "mem0"]);
  const spaceTag = createHash("sha256").update(fingerprint).digest("hex").slice(0, 12);
  const chatmockBase = normalizeOpenAiBaseUrl(
    process.env.OPENAI_LOCAL_BASE_URL || process.env.OPENAI_BASE_URL,
  );
  const embeddingBase = normalizeOpenAiBaseUrl(
    process.env.BREADBOARD_EMBEDDING_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      process.env.OPENAI_LOCAL_BASE_URL,
  );
  return {
    fingerprint,
    dataDirectory: canonicalDataDirectory,
    vectorStorePath: directMutableFile(
      canonicalDataDirectory,
      path.join(canonicalDataDirectory, `vector-store-${spaceTag}.db`),
    ),
    historyPath: directMutableFile(
      canonicalDataDirectory,
      path.join(canonicalDataDirectory, "history.db"),
    ),
    llmModel: process.env.BREADBOARD_MEM0_LLM_MODEL?.trim() || "default",
    chatmockBase,
    chatmockKey: process.env.CHATMOCK_API_KEY?.trim() || "local",
    embeddingModel,
    embeddingBase,
    embeddingKey:
      process.env.BREADBOARD_EMBEDDING_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      process.env.CHATMOCK_API_KEY?.trim() ||
      "local",
    dimension,
  };
}

function validateFingerprint(body, config) {
  if (body.fingerprint !== config.fingerprint) {
    fail(
      "The semantic-memory vector space changed; retry after the Runtime refreshes the service.",
      409,
      "mem0_fingerprint_mismatch",
    );
  }
}

function metadata(value) {
  if (!isRecord(value)) fail("Semantic-memory metadata is invalid.", 400, "invalid_mem0_request");
  const keys = ["durable_id", "kind", "scope", "scope_id"];
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    fail("Semantic-memory metadata is invalid.", 400, "invalid_mem0_request");
  }
  if (
    !Number.isSafeInteger(value.durable_id) ||
    value.durable_id < 1 ||
    typeof value.kind !== "string" ||
    !value.kind ||
    typeof value.scope !== "string" ||
    !value.scope ||
    (value.scope_id !== null &&
      (typeof value.scope_id !== "string" || Buffer.byteLength(value.scope_id, "utf8") > 256))
  ) {
    fail("Semantic-memory metadata is invalid.", 400, "invalid_mem0_request");
  }
  return value;
}

async function createEngine(config) {
  process.env.MEM0_TELEMETRY ??= "false";
  const dimension = config.dimension > 0 ? config.dimension : undefined;
  return new Memory({
    llm: {
      provider: "openai",
      config: {
        baseURL: config.chatmockBase,
        apiKey: config.chatmockKey,
        model: config.llmModel,
        temperature: 0,
        timeout: 60_000,
      },
    },
    embedder: {
      provider: "openai",
      config: {
        baseURL: config.embeddingBase,
        apiKey: config.embeddingKey,
        model: config.embeddingModel,
        ...(dimension === undefined ? {} : { embeddingDims: dimension }),
      },
    },
    vectorStore: {
      provider: "memory",
      config: {
        collectionName: "breadboard_durable",
        dbPath: config.vectorStorePath,
        ...(dimension === undefined ? {} : { dimension }),
      },
    },
    historyStore: {
      provider: "sqlite",
      config: { historyDbPath: config.historyPath },
    },
  });
}

async function main() {
  const config = engineConfig();
  const engine = await createEngine(config);
  const route = async ({ method, path: routePath, body }) => {
    if (method !== "POST") fail("Unsupported semantic-memory method.", 405, "method_not_allowed");
    validateFingerprint(body, config);

    if (routePath === "/v1/index") {
      if (!exactRecord(body, ["fingerprint", "text", "userId"], ["metadata"])) {
        fail("The semantic-memory index request is invalid.", 400, "invalid_mem0_request");
      }
      const text = boundedText(body.text, "Semantic-memory text", 4_000);
      const userTag = `bb-user-${positiveUserId(body.userId)}`;
      const added = await engine.add([{ role: "user", content: text }], {
        userId: userTag,
        infer: false,
        ...(body.metadata === undefined ? {} : { metadata: metadata(body.metadata) }),
      });
      let mem0Id = added.results?.[0]?.id ?? null;
      if (!mem0Id) {
        const hits = await engine.search(text, {
          filters: { user_id: userTag },
          topK: 3,
        });
        mem0Id = hits.results?.find((item) => item.memory === text)?.id ?? null;
      }
      return { mem0Id };
    }

    if (routePath === "/v1/search") {
      if (!exactRecord(body, ["fingerprint", "query", "userId", "topK"])) {
        fail("The semantic-memory search request is invalid.", 400, "invalid_mem0_request");
      }
      const topK = body.topK;
      if (!Number.isSafeInteger(topK) || topK < 1 || topK > 100) {
        fail("The semantic-memory result limit is invalid.", 400, "invalid_mem0_request");
      }
      const found = await engine.search(
        boundedText(body.query, "Semantic-memory query"),
        {
          filters: { user_id: `bb-user-${positiveUserId(body.userId)}` },
          topK,
        },
      );
      return (found.results ?? []).flatMap((item) => {
        if (!item.id || typeof item.memory !== "string") return [];
        const score = typeof item.score === "number" ? item.score : 0;
        return [{
          mem0Id: item.id,
          text: item.memory,
          similarity: Math.max(0, Math.min(1, score)),
        }];
      });
    }

    if (routePath === "/v1/extract") {
      if (!exactRecord(body, ["fingerprint", "messages", "userId"]) ||
          !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 2) {
        fail("The semantic-memory extraction request is invalid.", 400, "invalid_mem0_request");
      }
      const messages = body.messages.map((message) => {
        if (!exactRecord(message, ["role", "content"]) ||
            !new Set(["user", "assistant"]).has(message.role)) {
          fail("The semantic-memory extraction request is invalid.", 400, "invalid_mem0_request");
        }
        return {
          role: message.role,
          content: boundedText(message.content, "Semantic-memory message", 4_000),
        };
      });
      const added = await engine.add(messages, {
        userId: `bb-user-${positiveUserId(body.userId)}`,
      });
      return (added.results ?? []).flatMap((item) =>
        item.id && typeof item.memory === "string" && item.memory.trim()
          ? [{ mem0Id: item.id, text: item.memory }]
          : [],
      );
    }

    if (routePath === "/v1/remove") {
      if (!exactRecord(body, ["fingerprint", "mem0Id"])) {
        fail("The semantic-memory removal request is invalid.", 400, "invalid_mem0_request");
      }
      try {
        await engine.delete(boundedText(body.mem0Id, "Semantic-memory id", 512));
      } catch {
        // Deleting an entry that is already gone is success.
      }
      return { removed: true };
    }

    fail("Unknown semantic-memory request.", 404, "mem0_route_not_found");
  };

  await startRuntimeV2GatewayHttpService({
    name: "mem0-semantic-engine",
    tokenEnvironmentName: "BREADBOARD_MEM0_SERVICE_TOKEN",
    route,
    // mem0 exposes no close method for its native SQLite handles.
    onStop: async () => { setTimeout(() => process.exit(0), 0); },
  });
}

void main().catch((error) => {
  process.stderr.write(
    `[runtime-v2-mem0-service] startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
