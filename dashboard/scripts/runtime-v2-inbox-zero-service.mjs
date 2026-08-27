import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startRuntimeV2GatewayHttpService } from "./runtime-v2-gateway-http.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const SERVICE_ID = "inbox-zero-stack";
const TOKEN_ENVIRONMENT = "BREADBOARD_INBOX_ZERO_SERVICE_TOKEN";
const LEASE_ROTATION_MS = 5 * 60_000;
const LEASE_RETRY_MS = 10_000;

function fail(message, status = 500) {
  throw Object.assign(new Error(message), { status });
}

function sourceLayout() {
  const dashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(dashboardRoot);
  const development = fs.existsSync(path.join(dashboardRoot, "src", "lib", "inbox-zero", "service.ts"));
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const sourceRoot = development
    ? path.join(dashboardRoot, "src")
    : path.join(packagedDashboardRoot, "worker-src");
  if (!fs.existsSync(path.join(sourceRoot, "lib", "inbox-zero", "service.ts"))) {
    fail("The staged Inbox Zero service source closure is unavailable.");
  }
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT = development
    ? dashboardRoot
    : packagedDashboardRoot;
  return { dashboardRoot, sourceRoot, appRoot };
}

function moduleUrl(sourceRoot, relativePath) {
  return pathToFileURL(path.join(sourceRoot, ...relativePath.split("/"))).href;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export function validateInboxZeroScope(value) {
  if (!isRecord(value)) fail("A valid Inbox Zero scope is required.", 400);
  const allowed = new Set(["userId", "runId", "conversationPublicId"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail("The Inbox Zero scope is invalid.", 400);
  if (!Number.isSafeInteger(value.userId) || value.userId < 1) fail("A valid Inbox Zero user is required.", 400);
  for (const name of ["runId", "conversationPublicId"]) {
    const item = value[name];
    if (
      item !== undefined &&
      (typeof item !== "string" ||
        !item ||
        Buffer.byteLength(item, "utf8") > 256 ||
        /\p{Cc}/u.test(item))
    ) fail("The Inbox Zero scope is invalid.", 400);
  }
  return value;
}

function boundedText(value, label, maximum, { allowEmpty = false } = {}) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value.trim()) ||
    Buffer.byteLength(value, "utf8") > maximum ||
    /\p{Cc}/u.test(value)
  ) fail(`${label} is invalid.`, 400);
  return value.trim();
}

function connectionUrl(value, label) {
  const text = boundedText(value, label, 2_048);
  let url;
  try {
    url = new URL(text);
  } catch {
    fail(`${label} is invalid.`, 400);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) fail(`${label} must use credential-free HTTP.`, 400);
  return url.toString().replace(/\/$/u, "");
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateSealedInboxZeroPaths(
  config,
  appRoot,
  env = process.env,
) {
  const sealedAppRoot = path.resolve(env.BREADBOARD_REPO_ROOT?.trim() || appRoot);
  const sealedDataRoot = path.resolve(
    env.BREADBOARD_DATA_DIR?.trim() || path.join(appRoot, "dashboard"),
  );
  if (!inside(sealedAppRoot, config.cloneRoot) && !inside(sealedDataRoot, config.cloneRoot)) {
    fail("Inbox Zero clone root escaped its sealed app/data roots.");
  }
  if (
    !inside(sealedDataRoot, config.stateDir) ||
    !inside(config.stateDir, config.overrideFile) ||
    !inside(config.stateDir, config.credentialsFile)
  ) fail("Inbox Zero mutable state escaped its sealed data root.");
  if (config.projectName !== "breadboard-inbox-zero") {
    fail("Inbox Zero Compose project identity is not sealed.");
  }
  let appUrl;
  try {
    appUrl = new URL(config.baseUrl);
  } catch {
    fail("Inbox Zero web origin is invalid.");
  }
  if (
    appUrl.protocol !== "http:" ||
    !new Set(["127.0.0.1", "[::1]", "localhost"]).has(appUrl.hostname) ||
    appUrl.username ||
    appUrl.password ||
    appUrl.pathname !== "/" ||
    appUrl.search ||
    appUrl.hash
  ) fail("Inbox Zero web origin escaped loopback.");
  if (
    !exactRecord(config.ports, ["web", "postgres", "redis", "redisHttp"]) ||
    !["web", "postgres", "redis", "redisHttp"].every((name) =>
      Number.isSafeInteger(config.ports[name]) &&
      config.ports[name] > 0 &&
      config.ports[name] <= 65_535) ||
    new Set(Object.values(config.ports)).size !== 4 ||
    Number(appUrl.port || 80) !== config.ports.web
  ) fail("Inbox Zero published ports are invalid.");
}

function controlTarget() {
  const raw = process.env.BREADBOARD_SUPERVISOR_CONTROL_URL?.trim();
  const token = process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN?.trim();
  if (!raw || !token) return null;
  const bytes = Buffer.from(token, "utf8");
  if (
    bytes.byteLength < 32 ||
    bytes.byteLength > 1024 ||
    !bytes.every((byte) => byte >= 0x21 && byte <= 0x7e)
  ) fail("Inbox Zero Runtime admission capability is invalid.");
  const url = new URL(raw);
  if (
    url.protocol !== "http:" ||
    !new Set(["127.0.0.1", "[::1]"]).has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) fail("Inbox Zero Runtime admission control is not exact loopback HTTP.");
  return { origin: url.origin, token };
}

async function readBoundedJson(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 64 * 1024) fail("Runtime admission response was oversized.");
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 64 * 1024) {
      await reader.cancel().catch(() => undefined);
      fail("Runtime admission response was oversized.");
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8");
  try {
    const value = text ? JSON.parse(text) : {};
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

async function acquireResidentLease() {
  const target = controlTarget();
  if (!target) return null;
  const response = await fetch(`${target.origin}/v1/services/${SERVICE_ID}/lease`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ reason: "inbox-zero-stack-resident" }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await readBoundedJson(response);
  if (!response.ok) {
    if (body.code === "BREADBOARD_RESOURCE_EXHAUSTED") {
      fail("BREADBOARD_RESOURCE_EXHAUSTED: Inbox Zero stack admission was denied.", 503);
    }
    fail("Inbox Zero stack admission was denied.", 503);
  }
  if (
    typeof body.leaseId !== "string" ||
    !body.leaseId ||
    body.serviceId !== SERVICE_ID
  ) fail("Inbox Zero stack admission escaped its service binding.");
  return body.leaseId;
}

async function releaseLeaseId(leaseId) {
  const target = controlTarget();
  if (!target || !leaseId) return;
  await fetch(`${target.origin}/v1/leases/${encodeURIComponent(leaseId)}/release`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.token}`,
      "content-type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
}

let residentLease = null;
let residentLeaseTransition = Promise.resolve();

function serializeResidentLease(operation) {
  const transition = residentLeaseTransition.then(operation, operation);
  residentLeaseTransition = transition.then(
    () => undefined,
    () => undefined,
  );
  return transition;
}

function scheduleResidentLeaseRotation(delay = LEASE_ROTATION_MS) {
  if (!residentLease || residentLease.closed) return;
  residentLease.timer = setTimeout(() => {
    void serializeResidentLease(async () => {
      const current = residentLease;
      if (!current || current.closed) return;
      try {
        const replacement = await acquireResidentLease();
        if (!replacement) throw new Error("runtime control unavailable");
        const previous = current.id;
        current.id = replacement;
        await releaseLeaseId(previous);
        scheduleResidentLeaseRotation();
      } catch {
        scheduleResidentLeaseRotation(LEASE_RETRY_MS);
      }
    });
  }, delay);
  residentLease.timer.unref?.();
}

async function holdResidentLease() {
  await serializeResidentLease(async () => {
    if (residentLease) return;
    const id = await acquireResidentLease();
    if (!id) return;
    residentLease = { id, timer: null, closed: false };
    scheduleResidentLeaseRotation();
  });
}

async function releaseResidentLease() {
  await serializeResidentLease(async () => {
    const current = residentLease;
    residentLease = null;
    if (!current) return;
    current.closed = true;
    if (current.timer) clearTimeout(current.timer);
    await releaseLeaseId(current.id);
  });
}

async function loadModules(sourceRoot) {
  const [config, stack, session, service] = await Promise.all([
    import(moduleUrl(sourceRoot, "lib/inbox-zero/config.ts")),
    import(moduleUrl(sourceRoot, "lib/inbox-zero/stack.ts")),
    import(moduleUrl(sourceRoot, "lib/inbox-zero/session.ts")),
    import(moduleUrl(sourceRoot, "lib/inbox-zero/service.ts")),
  ]);
  return { config, stack, session, service };
}

async function statusProjection(modules, config) {
  const installed = modules.stack.cloneInstalled(config);
  const setup = await modules.service.setupStatus(config);
  const credentials = installed ? modules.stack.ensureCredentials(config) : null;
  if (setup.stack?.reachable) await holdResidentLease();
  return {
    available: config.mode !== "disabled" && installed,
    installed,
    mode: config.mode,
    baseUrl: config.baseUrl,
    cloneRoot: config.cloneRoot,
    oauth: {
      google: Boolean(credentials?.googleClientId && credentials.googleClientSecret),
      microsoft: Boolean(credentials?.microsoftClientId && credentials.microsoftClientSecret),
      configured: credentials ? modules.stack.hasEmailProvider(credentials) : false,
    },
    setup,
  };
}

function ensureOptions(value) {
  if (!exactRecord(value, ["chatmockBaseUrl", "chatmockApiKey", "model", "preferredEmail"])) {
    fail("Inbox Zero ensure options are invalid.", 400);
  }
  return {
    chatmockBaseUrl: connectionUrl(value.chatmockBaseUrl, "ChatMock URL"),
    chatmockApiKey: boundedText(value.chatmockApiKey, "ChatMock key", 1_024),
    model: boundedText(value.model, "Model", 256),
    ...(value.preferredEmail === null
      ? {}
      : { preferredEmail: boundedText(value.preferredEmail, "Preferred mailbox", 320) }),
  };
}

async function ensureFor(modules, config, body) {
  if (!exactRecord(body, ["scope", "options"])) fail("The Inbox Zero ensure request is invalid.", 400);
  validateInboxZeroScope(body.scope);
  const options = ensureOptions(body.options);
  await holdResidentLease();
  const ready = await modules.service.ensureReady({
    scopeUserId: body.scope.userId,
    allowStart: true,
    ...options,
    config,
  });
  if (!ready.ok && !(await modules.stack.webReachable(config))) {
    await releaseResidentLease();
  }
  return {
    ok: ready.ok,
    setup: ready.setup,
    baseUrl: config.baseUrl,
    ...(ready.session ? { session: ready.session } : {}),
  };
}

function oauthValue(value, label) {
  return boundedText(value, label, 4_096, { allowEmpty: true });
}

async function setupFor(modules, config, body) {
  if (!exactRecord(body, ["scope", "input"]) || !isRecord(body.input)) {
    fail("The Inbox Zero setup request is invalid.", 400);
  }
  validateInboxZeroScope(body.scope);
  const input = body.input;
  const action = boundedText(input.action, "Setup action", 64);

  if (action === "save_oauth") {
    if (!exactRecord(input, [
      "action",
      "googleClientId",
      "googleClientSecret",
      "microsoftClientId",
      "microsoftClientSecret",
    ])) fail("The Inbox Zero OAuth request is invalid.", 400);
    const credentials = modules.stack.ensureCredentials(config);
    modules.stack.writeCredentials(config, {
      ...credentials,
      googleClientId: oauthValue(input.googleClientId, "Google client ID") || credentials.googleClientId,
      googleClientSecret: oauthValue(input.googleClientSecret, "Google client secret") || credentials.googleClientSecret,
      microsoftClientId: oauthValue(input.microsoftClientId, "Microsoft client ID") || credentials.microsoftClientId,
      microsoftClientSecret: oauthValue(input.microsoftClientSecret, "Microsoft client secret") || credentials.microsoftClientSecret,
    });
    return { ok: true, restartRequired: true, setup: await modules.service.setupStatus(config) };
  }

  if (action === "clear_oauth") {
    if (!exactRecord(input, ["action"])) fail("The Inbox Zero setup request is invalid.", 400);
    const credentials = modules.stack.ensureCredentials(config);
    modules.stack.writeCredentials(config, {
      ...credentials,
      googleClientId: "",
      googleClientSecret: "",
      microsoftClientId: "",
      microsoftClientSecret: "",
    });
    return { ok: true, setup: await modules.service.setupStatus(config) };
  }

  if (action === "start") {
    if (!exactRecord(input, ["action", "chatmockBaseUrl", "chatmockApiKey", "model"])) {
      fail("The Inbox Zero start request is invalid.", 400);
    }
    const options = {
      chatmockBaseUrl: connectionUrl(input.chatmockBaseUrl, "ChatMock URL"),
      chatmockApiKey: boundedText(input.chatmockApiKey, "ChatMock key", 1_024),
      model: boundedText(input.model, "Model", 256),
    };
    const credentials = modules.stack.ensureCredentials(config);
    await holdResidentLease();
    const result = await modules.stack.startStack({
      config,
      credentials,
      model: modules.stack.containerModelSettings(options),
    });
    if (!result.started && !(await modules.stack.webReachable(config))) {
      await releaseResidentLease();
    }
    return {
      ok: result.started,
      state: result.status.state,
      reason: result.status.reason ?? null,
      log: result.log.slice(-8_000),
      setup: await modules.service.setupStatus(config),
    };
  }

  if (action === "stop") {
    if (!exactRecord(input, ["action"])) fail("The Inbox Zero setup request is invalid.", 400);
    modules.service.forgetSession();
    const stopped = await modules.stack.stopStack(config);
    if (stopped) await releaseResidentLease();
    return { ok: stopped, setup: await modules.service.setupStatus(config) };
  }

  if (action === "disconnect") {
    if (!exactRecord(input, ["action"])) fail("The Inbox Zero setup request is invalid.", 400);
    modules.service.forgetSession();
    const credentials = modules.stack.ensureCredentials(config);
    let revoked = 0;
    try {
      revoked = await modules.session.revokeMintedSessions(config, credentials);
    } catch {
      // The stack can be down; forgetting the cached session is still exact.
    }
    return { ok: true, revoked, setup: await modules.service.setupStatus(config) };
  }

  fail("Unknown Inbox Zero setup action.", 400);
}

async function main() {
  const { dashboardRoot, sourceRoot, appRoot } = sourceLayout();
  await import(pathToFileURL(path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs")).href);
  const modules = await loadModules(sourceRoot);
  const config = modules.config.resolveInboxZeroConfig();
  validateSealedInboxZeroPaths(config, appRoot);

  const route = async ({ method, path: routePath, body }) => {
    if (method !== "POST") fail("Unsupported Inbox Zero service method.", 405);
    if (routePath === "/v1/status") {
      if (!exactRecord(body, ["scope"])) fail("The Inbox Zero status request is invalid.", 400);
      validateInboxZeroScope(body.scope);
      return statusProjection(modules, config);
    }
    if (routePath === "/v1/ensure") return ensureFor(modules, config, body);
    if (routePath === "/v1/setup") return setupFor(modules, config, body);
    fail("Unknown Inbox Zero service request.", 404);
  };

  await startRuntimeV2GatewayHttpService({
    name: "inbox-zero-stack-service",
    tokenEnvironmentName: TOKEN_ENVIRONMENT,
    route,
    onStop: async () => {
      // Existing semantics keep Inbox Zero's cron/queue stack alive until the
      // user explicitly stops it. Never run Compose down from Runtime shutdown,
      // and never use --volumes, prune, or global WSL shutdown.
      await releaseResidentLease();
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  void main().catch((error) => {
    process.stderr.write(`[runtime-v2-inbox-zero-service] startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
