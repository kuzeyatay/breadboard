import {
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

import { startRuntimeV2GatewayHttpService } from "./runtime-v2-gateway-http.mjs";

const PROFILE_REVISION = 1;
const MAX_SAFE_RESULT_BYTES = 1024 * 1024;
const MAX_PROFILE_BYTES = 512 * 1024;
const MAX_LAUNCH_ENVELOPE_BYTES = 512 * 1024;
const MAX_ENVIRONMENT_BYTES = 256 * 1024;
const MAX_EXECUTABLE_BYTES = 1024 * 1024 * 1024;
const MAX_LAUNCH_ENVELOPES_PER_SCOPE = 128;
const TOOL_NAME = /^[A-Za-z0-9_.:/-]{1,200}$/u;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const PROFILE_DIGEST = /^[a-f0-9]{64}$/u;
const SLUG = /^[a-z0-9_-]{1,48}$/u;
const LAUNCH_FILE = /^([a-f0-9]{64})-([a-f0-9]{32})\.json$/u;
const LAUNCH_ENVELOPE_AAD = Buffer.from(
  "breadboard/local-mcp/launch-envelope/v1",
  "utf8",
);

const connections = new Map();
const starting = new Map();

function fail(message, status = 500, code = "local_mcp_broker_failed") {
  throw Object.assign(new Error(message), { status, code });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function directDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail(`${label} is unavailable.`, 409);
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) fail(`${label} is indirect.`, 409);
  return canonical;
}

function readBoundedDirectFile(filePath, maximumBytes, label) {
  const resolved = path.resolve(filePath);
  const before = fs.lstatSync(resolved);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size < 1 ||
    before.size > maximumBytes ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) fail(`${label} is not a bounded direct regular file.`, 409);
  const descriptor = fs.openSync(
    resolved,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size !== before.size) {
      fail(`${label} changed while opening.`, 409);
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      bytes.byteLength !== opened.size ||
      after.nlink !== 1 ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      (opened.ino !== 0 && after.ino !== opened.ino)
    ) fail(`${label} changed while it was read.`, 409);
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function registryRoot(env = process.env) {
  const configured = env.BREADBOARD_LOCAL_MCP_REGISTRY_ROOT?.trim();
  if (!configured || !path.isAbsolute(configured) || /[\u0000\r\n]/u.test(configured)) {
    fail(
      "The local MCP approved-definition registry is not configured.",
      500,
      "invalid_local_mcp_registry",
    );
  }
  return directDirectory(configured, "The local MCP approved-definition registry");
}

function scopedDirectory(root, branch, userId, slug) {
  return directDirectory(
    path.join(root, branch, `user-${userId}`, slug),
    `The local MCP ${branch} scope`,
  );
}

function key(userId, slug) {
  return `${userId}:${slug}`;
}

function scope(body, required) {
  if (!exactRecord(body, required)) {
    fail("The local MCP broker request is invalid.", 400, "invalid_local_mcp_request");
  }
  if (!Number.isSafeInteger(body.userId) || body.userId < 1 || !SLUG.test(body.slug)) {
    fail("The local MCP broker scope is invalid.", 400, "invalid_local_mcp_scope");
  }
  return { userId: body.userId, slug: body.slug };
}

function reference(body) {
  if (body.revision !== PROFILE_REVISION || !PROFILE_DIGEST.test(body.digest)) {
    fail("The local MCP profile reference is invalid.", 400, "invalid_local_mcp_profile_reference");
  }
  return { revision: body.revision, digest: body.digest };
}

function validateProfile(value, userId, slug) {
  if (
    !exactRecord(value, [
      "schemaVersion", "scope", "executable", "arguments", "cwd", "environmentNames",
      "timeoutMs",
    ]) ||
    value.schemaVersion !== PROFILE_REVISION ||
    !exactRecord(value.scope, ["userId", "slug"]) ||
    value.scope.userId !== userId ||
    value.scope.slug !== slug ||
    !exactRecord(value.executable, ["path", "sizeBytes", "sha256"]) ||
    typeof value.executable.path !== "string" ||
    !path.isAbsolute(value.executable.path) ||
    Buffer.byteLength(value.executable.path, "utf8") > 4_096 ||
    /[\u0000\r\n]/u.test(value.executable.path) ||
    !Number.isSafeInteger(value.executable.sizeBytes) ||
    value.executable.sizeBytes < 1 ||
    value.executable.sizeBytes > MAX_EXECUTABLE_BYTES ||
    typeof value.executable.sha256 !== "string" ||
    !PROFILE_DIGEST.test(value.executable.sha256) ||
    !Array.isArray(value.arguments) ||
    value.arguments.length > 100 ||
    value.arguments.some((argument) =>
      typeof argument !== "string" ||
      Buffer.byteLength(argument, "utf8") > 2_000 ||
      /[\u0000\r\n]/u.test(argument)) ||
    (value.cwd !== null &&
      (typeof value.cwd !== "string" ||
        !path.isAbsolute(value.cwd) ||
        Buffer.byteLength(value.cwd, "utf8") > 4_096 ||
        /[\u0000\r\n]/u.test(value.cwd))) ||
    !Array.isArray(value.environmentNames) ||
    value.environmentNames.length > 50 ||
    new Set(value.environmentNames).size !== value.environmentNames.length ||
    value.environmentNames.some((name) =>
      typeof name !== "string" || !ENVIRONMENT_NAME.test(name)) ||
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs < 1_000 ||
    value.timeoutMs > 120_000
  ) fail("The approved local MCP profile is invalid.", 409, "invalid_local_mcp_profile");
  return value;
}

function loadProfile(root, userId, slug, profileReference) {
  const directory = scopedDirectory(root, "definitions", userId, slug);
  const filePath = path.join(directory, `${profileReference.digest}.json`);
  const bytes = readBoundedDirectFile(filePath, MAX_PROFILE_BYTES, "The approved local MCP profile");
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  if (actualDigest !== profileReference.digest) {
    fail("The approved local MCP profile digest mismatched.", 409, "local_mcp_profile_mismatch");
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("The approved local MCP profile is invalid.", 409, "invalid_local_mcp_profile");
  }
  return validateProfile(parsed, userId, slug);
}

function tokenKey() {
  const token = process.env.BREADBOARD_LOCAL_MCP_BROKER_TOKEN?.trim();
  const bytes = token ? Buffer.from(token, "utf8") : Buffer.alloc(0);
  if (
    !token ||
    bytes.byteLength < 32 ||
    bytes.byteLength > 1_024 ||
    !bytes.every((byte) => byte >= 0x21 && byte <= 0x7e)
  ) fail("The local MCP launch authority is unavailable.", 500, "invalid_local_mcp_authority");
  return createHash("sha256")
    .update("breadboard/local-mcp/launch-key/v1\0", "utf8")
    .update(token, "utf8")
    .digest();
}

function base64url(value, bytes, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    fail(`${label} is invalid.`, 409, "invalid_local_mcp_launch_envelope");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== bytes || decoded.toString("base64url") !== value) {
    fail(`${label} is invalid.`, 409, "invalid_local_mcp_launch_envelope");
  }
  return decoded;
}

function validateLaunchPayload(value, userId, slug, profileReference, profile) {
  const now = Date.now();
  if (
    !exactRecord(value, [
      "schemaVersion", "scope", "profile", "createdAtMs", "expiresAtMs", "environment",
    ]) ||
    value.schemaVersion !== PROFILE_REVISION ||
    !exactRecord(value.scope, ["userId", "slug"]) ||
    value.scope.userId !== userId ||
    value.scope.slug !== slug ||
    !exactRecord(value.profile, ["revision", "digest"]) ||
    value.profile.revision !== profileReference.revision ||
    value.profile.digest !== profileReference.digest ||
    !Number.isSafeInteger(value.createdAtMs) ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    value.createdAtMs > now + 5_000 ||
    value.expiresAtMs <= now ||
    value.expiresAtMs - value.createdAtMs !== 60_000 ||
    !isRecord(value.environment)
  ) fail("The local MCP launch envelope is invalid or expired.", 409, "invalid_local_mcp_launch_envelope");
  const approvedNames = new Set(profile.environmentNames);
  if (Object.keys(value.environment).length > approvedNames.size) {
    fail("The local MCP launch environment exceeded the approved definition.", 409, "invalid_local_mcp_launch_envelope");
  }
  let total = 0;
  for (const [name, item] of Object.entries(value.environment)) {
    if (
      !approvedNames.has(name) ||
      !ENVIRONMENT_NAME.test(name) ||
      typeof item !== "string" ||
      /\u0000/u.test(item)
    ) fail("The local MCP launch environment is invalid.", 409, "invalid_local_mcp_launch_envelope");
    total += Buffer.byteLength(name, "utf8") + Buffer.byteLength(item, "utf8");
  }
  if (total > MAX_ENVIRONMENT_BYTES) {
    fail("The local MCP launch environment is too large.", 413, "local_mcp_environment_too_large");
  }
  return value.environment;
}

function decryptLaunchEnvelope(bytes, userId, slug, profileReference, profile) {
  let outer;
  try {
    outer = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("The local MCP launch envelope is invalid.", 409, "invalid_local_mcp_launch_envelope");
  }
  if (
    !exactRecord(outer, ["schemaVersion", "iv", "ciphertext", "tag"]) ||
    outer.schemaVersion !== PROFILE_REVISION ||
    typeof outer.ciphertext !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(outer.ciphertext)
  ) fail("The local MCP launch envelope is invalid.", 409, "invalid_local_mcp_launch_envelope");
  const iv = base64url(outer.iv, 12, "The local MCP launch IV");
  const tag = base64url(outer.tag, 16, "The local MCP launch tag");
  const ciphertext = Buffer.from(outer.ciphertext, "base64url");
  if (
    ciphertext.byteLength < 1 ||
    ciphertext.byteLength > MAX_LAUNCH_ENVELOPE_BYTES / 2 ||
    ciphertext.toString("base64url") !== outer.ciphertext
  ) fail("The local MCP launch ciphertext is invalid.", 409, "invalid_local_mcp_launch_envelope");
  let plaintext;
  try {
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(), iv);
    decipher.setAAD(LAUNCH_ENVELOPE_AAD);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    fail("The local MCP launch envelope authentication failed.", 409, "invalid_local_mcp_launch_envelope");
  }
  let payload;
  try {
    payload = JSON.parse(plaintext.toString("utf8"));
  } catch {
    fail("The local MCP launch envelope payload is invalid.", 409, "invalid_local_mcp_launch_envelope");
  }
  return validateLaunchPayload(payload, userId, slug, profileReference, profile);
}

function consumeLaunchEnvelope(root, userId, slug, profileReference, profile) {
  const directory = scopedDirectory(root, "launch", userId, slug);
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const launchFiles = [];
  for (const entry of entries) {
    const match = entry.isFile() ? LAUNCH_FILE.exec(entry.name) : null;
    if (!match) continue;
    const target = path.join(directory, entry.name);
    const metadata = fs.lstatSync(target);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) continue;
    if (metadata.mtimeMs < Date.now() - 5 * 60_000) {
      fs.rmSync(target, { force: true });
      continue;
    }
    launchFiles.push({ name: entry.name, digest: match[1] });
  }
  if (launchFiles.length > MAX_LAUNCH_ENVELOPES_PER_SCOPE) {
    fail("The local MCP launch-envelope scope exceeded its bound.", 409, "local_mcp_launch_scope_full");
  }
  const candidates = launchFiles
    .filter((entry) => entry.digest === profileReference.digest)
    .map((entry) => entry.name)
    .sort();
  for (const name of candidates) {
    const source = path.join(directory, name);
    const claimed = path.join(
      directory,
      `.${name}.consuming-${process.pid}-${randomBytes(8).toString("hex")}`,
    );
    try {
      const metadata = fs.lstatSync(source);
      if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
      fs.renameSync(source, claimed);
    } catch {
      continue;
    }
    try {
      const bytes = readBoundedDirectFile(
        claimed,
        MAX_LAUNCH_ENVELOPE_BYTES,
        "The local MCP launch envelope",
      );
      return decryptLaunchEnvelope(bytes, userId, slug, profileReference, profile);
    } finally {
      fs.rmSync(claimed, { force: true });
    }
  }
  fail("No one-shot local MCP launch envelope is available.", 409, "local_mcp_launch_envelope_missing");
}

function verifyExecutable(profile) {
  const executable = path.resolve(profile.executable.path);
  const metadata = fs.lstatSync(executable);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== profile.executable.sizeBytes ||
    !samePath(fs.realpathSync.native(executable), executable)
  ) fail("The approved local MCP executable changed after approval.", 409, "local_mcp_executable_changed");
  const descriptor = fs.openSync(
    executable,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = fs.fstatSync(descriptor);
    const digest = createHash("sha256");
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const count = fs.readSync(descriptor, chunk, 0, chunk.byteLength, null);
      if (count === 0) break;
      digest.update(chunk.subarray(0, count));
    }
    const after = fs.fstatSync(descriptor);
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      digest.digest("hex") !== profile.executable.sha256
    ) fail("The approved local MCP executable changed after approval.", 409, "local_mcp_executable_changed");
  } finally {
    fs.closeSync(descriptor);
  }
  if (profile.cwd !== null) directDirectory(profile.cwd, "The approved local MCP working directory");
  return executable;
}

function safeTool(tool) {
  if (!isRecord(tool) || typeof tool.name !== "string" || !TOOL_NAME.test(tool.name)) {
    fail("The local MCP server returned an invalid tool list.", 502, "invalid_local_mcp_tools");
  }
  return {
    name: tool.name,
    ...(typeof tool.description === "string" ? { description: tool.description.slice(0, 16_000) } : {}),
    inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : { type: "object" },
    ...(isRecord(tool.annotations) ? { annotations: tool.annotations } : {}),
  };
}

async function closeConnection(connection) {
  if (!connection) return;
  connections.delete(key(connection.userId, connection.slug));
  await connection.client.close().catch(() => undefined);
}

async function startConnection(userId, slug, profileReference, profile, environment, environmentDigest) {
  const connectionKey = key(userId, slug);
  const wanted = `${profileReference.digest}:${environmentDigest}`;
  const existing = connections.get(connectionKey);
  if (existing?.signature === wanted) return existing;
  await closeConnection(existing);

  const executable = verifyExecutable(profile);
  const client = new Client(
    { name: "breadboard-runtime-local-mcp-broker", version: "1.0.0" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: executable,
    args: profile.arguments,
    ...(profile.cwd ? { cwd: profile.cwd } : {}),
    env: {
      ...getDefaultEnvironment(),
      ...environment,
    },
    // A local server may print provider settings. Runtime containment owns the
    // child tree, but secrets still must not enter service logs.
    stderr: "ignore",
  });
  try {
    await client.connect(transport, { timeout: profile.timeoutMs });
    const listed = await client.listTools({}, { timeout: profile.timeoutMs });
    const tools = (listed.tools ?? []).slice(0, 1_000).map(safeTool);
    if (Buffer.byteLength(JSON.stringify(tools), "utf8") > MAX_SAFE_RESULT_BYTES) {
      fail("The local MCP tool list exceeded Breadboard's safe output limit.", 502, "local_mcp_tools_too_large");
    }
    const connection = {
      userId,
      slug,
      signature: wanted,
      profileDigest: profileReference.digest,
      timeoutMs: profile.timeoutMs,
      client,
      tools,
    };
    connections.set(connectionKey, connection);
    return connection;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

async function connect(userId, slug, profileReference) {
  const root = registryRoot();
  const profile = loadProfile(root, userId, slug, profileReference);
  const environment = consumeLaunchEnvelope(root, userId, slug, profileReference, profile);
  const environmentDigest = createHash("sha256")
    .update(JSON.stringify(environment))
    .digest("hex");
  const connectionKey = key(userId, slug);
  const wanted = `${profileReference.digest}:${environmentDigest}`;
  while (true) {
    const existing = connections.get(connectionKey);
    if (existing?.signature === wanted) return existing;
    const inFlight = starting.get(connectionKey);
    if (inFlight) {
      await inFlight.catch(() => undefined);
      continue;
    }
    const attempt = startConnection(
      userId,
      slug,
      profileReference,
      profile,
      environment,
      environmentDigest,
    );
    starting.set(connectionKey, attempt);
    try {
      return await attempt;
    } finally {
      if (starting.get(connectionKey) === attempt) starting.delete(connectionKey);
    }
  }
}

function failedStatus(error) {
  const message = error instanceof Error ? error.message : "";
  return /unauthori[sz]ed|authentication|required.*auth/iu.test(message)
    ? { status: "needs_auth" }
    : { status: "failed", error: "The MCP connection could not be started." };
}

async function main() {
  // Fail startup before accepting authority if the native fixed registry root
  // is absent, indirect, or outside the service's closed environment.
  registryRoot();
  const route = async ({ method, path: requestPath, body, signal }) => {
    if (method !== "POST") fail("Unsupported local MCP broker method.", 405, "method_not_allowed");

    if (requestPath === "/v1/add") {
      const { userId, slug } = scope(body, ["userId", "slug", "revision", "digest"]);
      const profileReference = reference(body);
      try {
        const connection = await connect(userId, slug, profileReference);
        return { status: { status: "connected" }, tools: connection.tools };
      } catch (error) {
        return { status: failedStatus(error), tools: [] };
      }
    }

    if (requestPath === "/v1/disconnect") {
      const { userId, slug } = scope(body, ["userId", "slug"]);
      await closeConnection(connections.get(key(userId, slug)));
      return { disconnected: true };
    }

    if (requestPath === "/v1/call") {
      const { userId, slug } = scope(body, [
        "userId", "slug", "revision", "digest", "tool", "args",
      ]);
      const profileReference = reference(body);
      if (!TOOL_NAME.test(body.tool) || !isRecord(body.args)) {
        fail("The local MCP tool request is invalid.", 400, "invalid_local_mcp_call");
      }
      const argsBytes = Buffer.byteLength(JSON.stringify(body.args), "utf8");
      if (argsBytes > 256 * 1024) {
        fail("The local MCP tool arguments are too large.", 413, "local_mcp_arguments_too_large");
      }
      const connection = await connect(userId, slug, profileReference);
      const declared = connection.tools.find((tool) => tool.name === body.tool);
      if (!declared) fail("The MCP tool is not available.", 403, "local_mcp_tool_denied");
      let result;
      try {
        result = await connection.client.callTool(
          { name: declared.name, arguments: body.args },
          undefined,
          { timeout: connection.timeoutMs, signal },
        );
      } catch {
        fail("The local MCP tool call failed.", 502, "local_mcp_call_failed");
      }
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_SAFE_RESULT_BYTES) {
        fail("The MCP tool response exceeded Breadboard's safe output limit.", 502, "local_mcp_result_too_large");
      }
      return { result };
    }

    fail("Unknown local MCP broker request.", 404, "local_mcp_route_not_found");
  };

  await startRuntimeV2GatewayHttpService({
    name: "local-mcp-broker",
    tokenEnvironmentName: "BREADBOARD_LOCAL_MCP_BROKER_TOKEN",
    route,
    maximumRequestBytes: 512 * 1024,
    maximumResponseBytes: 1024 * 1024 + 64 * 1024,
    onStop: async () => {
      const boundedExit = setTimeout(() => process.exit(0), 1_000);
      await Promise.allSettled([...connections.values()].map(closeConnection));
      clearTimeout(boundedExit);
      process.exit(0);
    },
  });
}

void main().catch((error) => {
  process.stderr.write(
    `[runtime-v2-local-mcp-broker] startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
