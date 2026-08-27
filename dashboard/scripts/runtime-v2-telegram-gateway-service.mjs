import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startRuntimeV2GatewayHttpService } from "./runtime-v2-gateway-http.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);

function sourceLayout() {
  const dashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(dashboardRoot);
  const development = fs.existsSync(path.join(dashboardRoot, "src", "lib", "telegram", "service.ts"));
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const sourceRoot = development
    ? path.join(dashboardRoot, "src")
    : path.join(packagedDashboardRoot, "worker-src");
  if (!fs.existsSync(path.join(sourceRoot, "lib", "telegram", "service.ts"))) {
    throw new Error("The staged Telegram gateway source closure is unavailable.");
  }
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT = development ? dashboardRoot : packagedDashboardRoot;
  return { sourceRoot };
}

function moduleUrl(sourceRoot, relativePath) {
  return pathToFileURL(path.join(sourceRoot, ...relativePath.split("/"))).href;
}

function exactRecord(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function positiveUserId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw Object.assign(new Error("A valid user is required."), { status: 400 });
  return value;
}

async function main() {
  const { sourceRoot } = sourceLayout();
  await import(pathToFileURL(path.join(path.dirname(ENTRYPOINT), "learn-worker-import-hook.mjs")).href);
  const [{ getTelegramGateway }, { getTelegramStore }, service, { telegramStatus }, credentials, { telegramFeatureEnabled }] = await Promise.all([
    import(moduleUrl(sourceRoot, "lib/telegram/gateway.ts")),
    import(moduleUrl(sourceRoot, "lib/telegram/instance.ts")),
    import(moduleUrl(sourceRoot, "lib/telegram/service.ts")),
    import(moduleUrl(sourceRoot, "lib/telegram/status.ts")),
    import(moduleUrl(sourceRoot, "lib/telegram/credentials.ts")),
    import(moduleUrl(sourceRoot, "lib/telegram/config.ts")),
  ]);
  const gateway = getTelegramGateway();
  const store = getTelegramStore();
  const route = async ({ method, path: routePath, body }) => {
    if (method !== "POST") throw Object.assign(new Error("Unsupported gateway method."), { status: 405 });
    if (routePath === "/v1/status") {
      if (!exactRecord(body, ["userId"])) throw Object.assign(new Error("Invalid status request."), { status: 400 });
      return telegramStatus(positiveUserId(body.userId), gateway.snapshot());
    }
    if (routePath !== "/v1/action" || !exactRecord(body, ["userId", "action", "value"])) {
      throw Object.assign(new Error("Unknown Telegram gateway request."), { status: 404 });
    }
    const userId = positiveUserId(body.userId);
    store.requireOwner(userId);
    switch (body.action) {
      case "link":
        if (typeof body.value !== "string") throw Object.assign(new Error("A bot token is required."), { status: 400 });
        await service.linkTelegramBot(userId, body.value);
        break;
      case "connect":
        if (body.value !== null) throw Object.assign(new Error("Invalid connect request."), { status: 400 });
        store.claimOwner(userId);
        await service.startTelegramGateway();
        break;
      case "disconnect":
        if (body.value !== null) throw Object.assign(new Error("Invalid disconnect request."), { status: 400 });
        await service.stopTelegramGateway();
        break;
      case "unlink":
        if (body.value !== null) throw Object.assign(new Error("Invalid unlink request."), { status: 400 });
        await service.unlinkTelegramBot();
        break;
      case "allow":
        if (typeof body.value !== "string") throw Object.assign(new Error("A sender id is required."), { status: 400 });
        store.claimOwner(userId);
        store.allowSender(body.value);
        gateway.clearBlockedSender(body.value);
        break;
      default:
        throw Object.assign(new Error("Unknown Telegram action."), { status: 400 });
    }
    return telegramStatus(userId, gateway.snapshot());
  };
  await startRuntimeV2GatewayHttpService({
    name: "telegram-gateway",
    tokenEnvironmentName: "BREADBOARD_TELEGRAM_GATEWAY_TOKEN",
    route,
    onStarted: async () => {
      const settings = store.settings();
      if (telegramFeatureEnabled() && settings.autostart && settings.ownerUserId !== null && credentials.hasBotToken()) {
        await service.startTelegramGateway().catch(() => undefined);
      }
    },
    onStop: () => service.stopTelegramGateway(),
  });
}

void main().catch((error) => {
  process.stderr.write(`[runtime-v2-telegram-gateway] startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
