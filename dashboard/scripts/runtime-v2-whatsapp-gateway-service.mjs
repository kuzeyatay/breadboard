import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startRuntimeV2GatewayHttpService } from "./runtime-v2-gateway-http.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);

function sourceLayout() {
  const dashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(dashboardRoot);
  const development = fs.existsSync(path.join(dashboardRoot, "src", "lib", "whatsapp", "service.ts"));
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const sourceRoot = development
    ? path.join(dashboardRoot, "src")
    : path.join(packagedDashboardRoot, "worker-src");
  if (!fs.existsSync(path.join(sourceRoot, "lib", "whatsapp", "service.ts"))) {
    throw new Error("The staged WhatsApp gateway source closure is unavailable.");
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
  const [{ getWhatsAppBridge }, { getWhatsAppStore }, service, { whatsAppStatus }, { whatsAppFeatureEnabled }] = await Promise.all([
    import(moduleUrl(sourceRoot, "lib/whatsapp/bridge.ts")),
    import(moduleUrl(sourceRoot, "lib/whatsapp/instance.ts")),
    import(moduleUrl(sourceRoot, "lib/whatsapp/service.ts")),
    import(moduleUrl(sourceRoot, "lib/whatsapp/status.ts")),
    import(moduleUrl(sourceRoot, "lib/whatsapp/config.ts")),
  ]);
  const bridge = getWhatsAppBridge();
  const store = getWhatsAppStore();
  const route = async ({ method, path: routePath, body }) => {
    if (method !== "POST") throw Object.assign(new Error("Unsupported gateway method."), { status: 405 });
    if (routePath === "/v1/status") {
      if (!exactRecord(body, ["userId"])) throw Object.assign(new Error("Invalid status request."), { status: 400 });
      return whatsAppStatus(positiveUserId(body.userId), bridge.snapshot());
    }
    if (routePath === "/v1/settings") {
      if (!exactRecord(body, ["userId", "settings"]) || !body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) {
        throw Object.assign(new Error("Invalid WhatsApp settings request."), { status: 400 });
      }
      const userId = positiveUserId(body.userId);
      store.requireOwner(userId);
      store.updateSettings(body.settings);
      if (bridge.currentState() === "connected") await service.startWhatsAppGateway().catch(() => undefined);
      return whatsAppStatus(userId, bridge.snapshot());
    }
    if (routePath === "/v1/send") {
      if (!exactRecord(body, ["userId", "chatId", "text"]) || typeof body.chatId !== "string" || typeof body.text !== "string") {
        throw Object.assign(new Error("Invalid WhatsApp send request."), { status: 400 });
      }
      const userId = positiveUserId(body.userId);
      store.requireOwner(userId);
      await bridge.sendMessage(body.chatId, body.text);
      return { sent: true };
    }
    if (routePath === "/v1/send-media") {
      if (
        !exactRecord(body, ["userId", "chatId", "file"]) ||
        typeof body.chatId !== "string" ||
        !exactRecord(body.file, ["filePath", "fileName", "caption", "mediaType"]) ||
        typeof body.file.filePath !== "string" ||
        (body.file.fileName !== null && typeof body.file.fileName !== "string") ||
        (body.file.caption !== null && typeof body.file.caption !== "string") ||
        (body.file.mediaType !== null && typeof body.file.mediaType !== "string")
      ) {
        throw Object.assign(new Error("Invalid WhatsApp media request."), { status: 400 });
      }
      const userId = positiveUserId(body.userId);
      store.requireOwner(userId);
      await bridge.sendMedia(body.chatId, {
        filePath: body.file.filePath,
        fileName: body.file.fileName ?? undefined,
        caption: body.file.caption ?? undefined,
        mediaType: body.file.mediaType ?? undefined,
      });
      return { sent: true };
    }
    if (routePath !== "/v1/action" || !exactRecord(body, ["userId", "action"])) {
      throw Object.assign(new Error("Unknown WhatsApp gateway request."), { status: 404 });
    }
    const userId = positiveUserId(body.userId);
    store.requireOwner(userId);
    switch (body.action) {
      case "pair":
        await service.startWhatsAppPairing(userId);
        break;
      case "cancel-pair":
        await service.cancelWhatsAppPairing();
        break;
      case "connect":
        store.claimOwner(userId);
        await service.startWhatsAppGateway();
        break;
      case "disconnect":
        await service.stopWhatsAppGateway();
        break;
      case "unlink":
        await service.unlinkWhatsApp();
        break;
      default:
        throw Object.assign(new Error("Unknown WhatsApp action."), { status: 400 });
    }
    return whatsAppStatus(userId, bridge.snapshot());
  };
  await startRuntimeV2GatewayHttpService({
    name: "whatsapp-gateway",
    tokenEnvironmentName: "BREADBOARD_WHATSAPP_GATEWAY_TOKEN",
    route,
    onStarted: async () => {
      const settings = store.settings();
      if (whatsAppFeatureEnabled() && settings.autostart && settings.ownerUserId !== null && bridge.snapshot().paired) {
        await service.startWhatsAppGateway().catch(() => undefined);
      }
    },
    onStop: async () => {
      await service.cancelWhatsAppPairing().catch(() => undefined);
      await service.stopWhatsAppGateway().catch(() => undefined);
    },
  });
}

void main().catch((error) => {
  process.stderr.write(`[runtime-v2-whatsapp-gateway] startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
