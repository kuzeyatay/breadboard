import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startRuntimeV2GatewayHttpService } from "./runtime-v2-gateway-http.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const AGENTS = new Set(["openwork", "openscience", "money-printer", "wardrobe"]);
const TOKENS = {
  openwork: "BREADBOARD_OPENWORK_SERVICE_TOKEN",
  openscience: "BREADBOARD_OPENSCIENCE_SERVICE_TOKEN",
  "money-printer": "BREADBOARD_MONEY_PRINTER_SERVICE_TOKEN",
  wardrobe: "BREADBOARD_WARDROBE_SERVICE_TOKEN",
};

function fail(message, status = 500) {
  throw Object.assign(new Error(message), { status });
}

function parseArguments(argv) {
  if (
    argv.length !== 4 ||
    argv[0] !== "--agent" ||
    !AGENTS.has(argv[1]) ||
    argv[2] !== "--port" ||
    !/^\d{1,5}$/u.test(argv[3])
  ) {
    fail("The Runtime V2 agent service requires bounded --agent and --port arguments.");
  }
  const port = Number(argv[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) fail("The agent service port is invalid.");
  return { agent: argv[1], port };
}

function sourceLayout(agent) {
  const dashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(dashboardRoot);
  const development = fs.existsSync(path.join(dashboardRoot, "src", "lib", agent, "service.ts"));
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const sourceRoot = development
    ? path.join(dashboardRoot, "src")
    : path.join(packagedDashboardRoot, "worker-src");
  if (!fs.existsSync(path.join(sourceRoot, "lib", agent, "service.ts"))) {
    fail(`The staged ${agent} service source closure is unavailable.`);
  }
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT = development
    ? dashboardRoot
    : packagedDashboardRoot;
  const configuredStateRoot = process.env.BREADBOARD_AGENT_SERVICE_STATE_ROOT?.trim();
  const stateRoot = configuredStateRoot
    ? path.resolve(configuredStateRoot)
    : path.join(dashboardRoot, ".runtime", "agent-services");
  return { dashboardRoot, sourceRoot, stateRoot };
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

function scope(value) {
  if (!isRecord(value)) fail("A valid agent scope is required.", 400);
  const allowed = new Set(["userId", "runId", "conversationPublicId"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail("The agent scope is invalid.", 400);
  if (!Number.isSafeInteger(value.userId) || value.userId < 1) fail("A valid user is required.", 400);
  for (const name of ["runId", "conversationPublicId"]) {
    const item = value[name];
    if (item !== undefined && (typeof item !== "string" || !item || Buffer.byteLength(item) > 256 || /\p{Cc}/u.test(item))) {
      fail("The agent scope is invalid.", 400);
    }
  }
  return value;
}

function boundedText(value, label, maximum = 4_096) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > maximum || /\p{Cc}/u.test(value)) {
    fail(`${label} is invalid.`, 400);
  }
  return value;
}

function readOpenworkProfile(stateRoot, rawScope) {
  if (!exactRecord(rawScope, ["userId", "runId"])) {
    fail("The OpenWork ensure scope is invalid.", 400);
  }
  const validatedScope = scope(rawScope);
  if (
    typeof validatedScope.runId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(validatedScope.runId)
  ) {
    fail("The OpenWork ensure scope is invalid.", 400);
  }
  const digest = createHash("sha256")
    .update(`${validatedScope.userId}\0${validatedScope.runId}`, "utf8")
    .digest("hex");
  const target = path.join(
    stateRoot,
    "openwork",
    `${validatedScope.userId}-${digest}.json`,
  );
  let descriptor;
  try {
    const linkMetadata = fs.lstatSync(target);
    if (
      !linkMetadata.isFile() ||
      linkMetadata.isSymbolicLink() ||
      linkMetadata.size < 2 ||
      linkMetadata.size > 16 * 1024
    ) {
      fail("The OpenWork service profile is invalid.", 409);
    }
    descriptor = fs.openSync(
      target,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size !== linkMetadata.size) {
      fail("The OpenWork service profile is invalid.", 409);
    }
    const profile = JSON.parse(fs.readFileSync(descriptor, "utf8"));
    if (
      !exactRecord(profile, ["schemaVersion", "serviceId", "scope", "options"]) ||
      profile.schemaVersion !== 1 ||
      profile.serviceId !== "openwork" ||
      !exactRecord(profile.scope, ["userId", "runId"]) ||
      profile.scope.userId !== validatedScope.userId ||
      profile.scope.runId !== validatedScope.runId ||
      !exactRecord(profile.options, ["baseUrl", "apiKey", "model", "prompt"]) ||
      !exactRecord(profile.options.prompt, ["deliverFiles", "allowCommands"]) ||
      typeof profile.options.prompt.deliverFiles !== "boolean" ||
      typeof profile.options.prompt.allowCommands !== "boolean"
    ) {
      fail("The OpenWork service profile is invalid.", 409);
    }
    return {
      baseUrl: connectionUrl(profile.options.baseUrl, "ChatMock URL"),
      apiKey: boundedText(profile.options.apiKey, "ChatMock key", 1_024),
      model: boundedText(profile.options.model, "Model", 256),
      prompt: profile.options.prompt,
    };
  } catch (error) {
    if (error?.status) throw error;
    fail("The OpenWork service profile is unavailable.", 409);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function connectionUrl(value, label) {
  const text = boundedText(value, label, 2_048);
  const url = new URL(text);
  if (url.protocol !== "http:" || !new Set(["127.0.0.1", "[::1]"]).has(url.hostname) || url.username || url.password) {
    fail(`${label} must use credential-free loopback HTTP.`, 400);
  }
  return url.toString().replace(/\/$/u, "");
}

function serviceProjection(value) {
  if (!value) return null;
  const output = {};
  for (const key of [
    "engineUrl",
    "serverUrl",
    "token",
    "hostToken",
    "workspaceId",
    "workspacePath",
    "baseUrl",
    "url",
    "root",
    "model",
    "startedAt",
    "models",
  ]) {
    if (value[key] !== undefined) output[key] = value[key];
  }
  return output;
}

async function loadAgent(agent, sourceRoot) {
  const [service, setup, runtime] = await Promise.all([
    import(moduleUrl(sourceRoot, `lib/${agent}/service.ts`)),
    import(moduleUrl(sourceRoot, `lib/${agent}/setup.ts`)),
    import(moduleUrl(sourceRoot, `lib/${agent}/runtime.ts`)),
  ]);
  if (agent === "money-printer") {
    const [credentials, configFile] = await Promise.all([
      import(moduleUrl(sourceRoot, "lib/money-printer/credentials.ts")),
      import(moduleUrl(sourceRoot, "lib/money-printer/config-file.ts")),
    ]);
    return { service, setup, runtime, credentials, configFile };
  }
  if (agent === "wardrobe") {
    const bridge = await import(moduleUrl(sourceRoot, "lib/wardrobe/bridge.ts"));
    return { service, setup, runtime, bridge };
  }
  return { service, setup, runtime };
}

async function statusFor(agent, modules, refresh = false) {
  if (agent === "money-printer") {
    const root = modules.runtime.resolveMoneyPrinterRoot()?.root ?? null;
    const inClone = root ? modules.configFile.configuredFootageSources(root) : [];
    const health = await modules.runtime.health({
      force: refresh,
      availableSources: () => [...new Set([...modules.credentials.availableFootageSources(), ...inClone])],
    });
    return {
      availability: health,
      setup: null,
      service: serviceProjection(modules.service.currentService()),
      log: modules.service.serviceLog(),
    };
  }
  return {
    availability: modules.runtime.runtimeAvailability(),
    setup: modules.setup.setupStatus(),
    service: serviceProjection(modules.service.currentService()),
  };
}

async function ensureFor(agent, modules, body) {
  if (agent === "openscience") {
    if (!exactRecord(body, ["scope"])) fail("The OpenScience ensure request is invalid.", 400);
    scope(body.scope);
    return serviceProjection(await modules.service.ensureService());
  }
  if (agent === "openwork") {
    if (!exactRecord(body, ["scope"])) fail("The OpenWork ensure request is invalid.", 400);
    return serviceProjection(
      await modules.service.ensureService(readOpenworkProfile(modules.stateRoot, body.scope)),
    );
  }
  if (!exactRecord(body, ["scope", "options"])) fail("The ensure request is invalid.", 400);
  scope(body.scope);
  if (!isRecord(body.options)) fail("The ensure options are invalid.", 400);
  if (agent === "money-printer") {
    if (!exactRecord(body.options, ["baseUrl", "apiKey", "model"])) fail("The MoneyPrinter options are invalid.", 400);
    return serviceProjection(await modules.service.ensureService({
      baseUrl: connectionUrl(body.options.baseUrl, "ChatMock URL"),
      apiKey: boundedText(body.options.apiKey, "ChatMock key", 1_024),
      model: boundedText(body.options.model, "Model", 256),
    }));
  }
  if (!exactRecord(body.options, ["upstreamUrl", "model", "quality"])) fail("The Wardrobe options are invalid.", 400);
  return serviceProjection(await modules.service.ensureService({
    upstreamUrl: connectionUrl(body.options.upstreamUrl, "ChatMock URL"),
    model: boundedText(body.options.model, "Model", 256),
    quality: boundedText(body.options.quality, "Image quality", 64),
  }));
}

function optionsFile(stateRoot, agent, userId) {
  return path.join(stateRoot, `${agent}-${userId}-last-options.json`);
}

function persistOptions(stateRoot, agent, userId, options) {
  const bytes = Buffer.from(`${JSON.stringify(options)}\n`, "utf8");
  if (bytes.byteLength > 16 * 1024) fail("The agent launch shape exceeded its durable bound.");
  fs.mkdirSync(stateRoot, { recursive: true });
  const target = optionsFile(stateRoot, agent, userId);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function readOptions(stateRoot, agent, userId) {
  const target = optionsFile(stateRoot, agent, userId);
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size < 2 || stat.size > 16 * 1024) fail("No reusable agent launch shape is available.", 409);
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  if (!isRecord(value)) fail("The reusable agent launch shape is invalid.", 409);
  return value;
}

async function setupFor(agent, modules, body) {
  if (!exactRecord(body, ["scope", "action"])) fail("The setup request is invalid.", 400);
  scope(body.scope);
  boundedText(body.action, "Setup action", 64);
  if (["openwork", "openscience", "money-printer", "wardrobe"].includes(agent)) {
    fail(`${agent} setup is owned by the Runtime V2 managed-setup job.`, 409);
  }
  fail("Unknown setup action.", 400);
}

async function main() {
  const { agent, port } = parseArguments(process.argv.slice(2));
  const { dashboardRoot, sourceRoot, stateRoot } = sourceLayout(agent);
  await import(pathToFileURL(path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs")).href);
  const modules = { ...(await loadAgent(agent, sourceRoot)), stateRoot };
  const route = async ({ method, path: routePath, body }) => {
    if (method !== "POST") fail("Unsupported agent service method.", 405);
    if (routePath === "/v1/status") {
      if (!exactRecord(body, ["scope"]) && !exactRecord(body, ["scope", "refresh"])) {
        fail("The status request is invalid.", 400);
      }
      scope(body.scope);
      if (body.refresh !== undefined && typeof body.refresh !== "boolean") fail("The status refresh flag is invalid.", 400);
      return await statusFor(agent, modules, body.refresh === true);
    }
    if (routePath === "/v1/ensure") {
      const result = await ensureFor(agent, modules, body);
      // Only Wardrobe exposes a durable browser link that has to reopen after
      // the Runtime retires this adapter. Its launch shape contains no provider
      // or supervisor capability; the other agents carry API keys and are
      // always restarted from their still-authenticated run record instead.
      if (agent === "wardrobe") {
        persistOptions(stateRoot, agent, body.scope.userId, body.options);
      }
      return result;
    }
    if (routePath === "/v1/reopen") {
      if (!exactRecord(body, ["scope"])) fail("The reopen request is invalid.", 400);
      scope(body.scope);
      if (agent !== "wardrobe") fail("This agent does not expose a reusable service link.", 404);
      return await ensureFor(agent, modules, {
        scope: body.scope,
        options: readOptions(stateRoot, agent, body.scope.userId),
      });
    }
    if (routePath === "/v1/stop") {
      if (!exactRecord(body, ["scope"])) fail("The stop request is invalid.", 400);
      scope(body.scope);
      await modules.service.stopService();
      if (agent === "money-printer") modules.runtime.invalidateHealth();
      if (agent === "wardrobe") modules.bridge.closeImagesBridge();
      return { stopped: true };
    }
    if (routePath === "/v1/setup") return await setupFor(agent, modules, body);
    fail("Unknown agent service request.", 404);
  };
  await startRuntimeV2GatewayHttpService({
    name: `${agent}-agent-service`,
    tokenEnvironmentName: TOKENS[agent],
    route,
    argv: ["--port", String(port)],
    onStop: async () => {
      await modules.service.stopService();
      if (agent === "wardrobe") modules.bridge.closeImagesBridge();
      // Some imported agent modules retain durable database handles. Once the
      // owned child tree and bridge are closed, do not let those handles turn a
      // graceful Runtime stop into a supervisor timeout and forced kill.
      setTimeout(() => process.exit(0), 0);
    },
  });
}

void main().catch((error) => {
  process.stderr.write(`[runtime-v2-agent-service] startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
