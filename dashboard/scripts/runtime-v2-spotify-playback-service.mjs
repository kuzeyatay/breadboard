import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { startRuntimeV2GatewayHttpService } from "./runtime-v2-gateway-http.mjs";
import { ensureDirectSpotifyProfile } from "./runtime-v2-spotify-profile.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const VIEW_TTL_MS = 75_000;
const SESSION_IDLE_TTL_MS = 45_000;
const LAUNCH_COOLDOWN_MS = 20_000;
const MAX_BROWSER_SESSIONS = 16;
const MAX_VIEWS_PER_USER = 16;
const MAX_BRIDGE_REQUEST_BYTES = 4 * 1024;
const MAX_DASHBOARD_RESPONSE_BYTES = 64 * 1024;
const DASHBOARD_REQUEST_TIMEOUT_MS = 15_000;

function fail(
  message,
  status = 500,
  code = "spotify_playback_service_failed",
) {
  throw Object.assign(new Error(message), { status, code });
}

function exactRecord(value, required) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === required.length &&
    required.every((key) => Object.hasOwn(value, key))
  );
}

function positiveUserId(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(
      "The Spotify playback user scope is invalid.",
      400,
      "invalid_spotify_playback_scope",
    );
  }
  return value;
}

function viewId(value) {
  const parsed = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(parsed)) {
    fail(
      "The Spotify playback view identity is invalid.",
      400,
      "invalid_spotify_playback_view",
    );
  }
  return parsed;
}

function engineTicket(value) {
  const parsed = typeof value === "string" ? value.trim() : "";
  if (
    Buffer.byteLength(parsed, "utf8") > 4_096 ||
    !/^[A-Za-z0-9_-]{20,4096}\.[A-Za-z0-9_-]{20,128}$/u.test(parsed)
  ) {
    fail(
      "The Spotify playback engine ticket is invalid.",
      400,
      "invalid_spotify_playback_ticket",
    );
  }
  return parsed;
}

function playbackDeviceId(value) {
  const parsed = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,200}$/u.test(parsed)) {
    fail(
      "The Spotify playback device identity is invalid.",
      400,
      "invalid_spotify_playback_device",
    );
  }
  return parsed;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  // Runtime pins trusted Windows roots with the canonical `\\?\` spelling,
  // while Node's native realpath returns the equivalent DOS spelling.
  return process.platform === "win32"
    ? path.toNamespacedPath(a).toLowerCase() ===
        path.toNamespacedPath(b).toLowerCase()
    : a === b;
}

function directDirectory(value, message) {
  const resolved = path.resolve(value);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata || !metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail(message, 500, "invalid_spotify_playback_configuration");
  }
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) {
    fail(message, 500, "invalid_spotify_playback_configuration");
  }
  return canonical;
}

function dashboardOrigin(value) {
  let url;
  try {
    url = new URL(value?.trim() ?? "");
  } catch {
    fail(
      "The Spotify playback dashboard endpoint is invalid.",
      500,
      "invalid_spotify_playback_configuration",
    );
  }
  const loopback =
    url.protocol === "http:" &&
    new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname);
  if (
    (!loopback && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    fail(
      "The Spotify playback dashboard endpoint is invalid.",
      500,
      "invalid_spotify_playback_configuration",
    );
  }
  return url.origin;
}

function directExecutable(candidate) {
  if (!candidate) return null;
  const resolved = path.resolve(candidate);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (
    !metadata ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) {
    return null;
  }
  return resolved;
}

function under(base, ...segments) {
  const root = base?.trim();
  return root ? path.join(root, ...segments) : null;
}

function browserExecutable() {
  const configured = process.env.BREADBOARD_SPOTIFY_BROWSER_PATH?.trim();
  const candidates = [
    configured,
    process.platform === "win32"
      ? under(
          process.env["PROGRAMFILES(X86)"],
          "Microsoft",
          "Edge",
          "Application",
          "msedge.exe",
        )
      : null,
    process.platform === "win32"
      ? under(
          process.env.PROGRAMFILES,
          "Microsoft",
          "Edge",
          "Application",
          "msedge.exe",
        )
      : null,
    process.platform === "win32"
      ? under(
          process.env.LOCALAPPDATA,
          "Microsoft",
          "Edge",
          "Application",
          "msedge.exe",
        )
      : null,
    process.platform === "win32"
      ? under(
          process.env.PROGRAMFILES,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
    process.platform === "darwin"
      ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      : null,
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : null,
    process.platform === "linux" ? "/usr/bin/microsoft-edge" : null,
    process.platform === "linux" ? "/usr/bin/google-chrome" : null,
    process.platform === "linux" ? "/usr/bin/chromium" : null,
  ];
  for (const candidate of candidates) {
    const executable = directExecutable(candidate);
    if (executable) return executable;
  }
  fail(
    "Microsoft Edge or Google Chrome is required for protected Spotify playback.",
    503,
    "spotify_browser_unavailable",
  );
}

function childEnvironment() {
  const allowed = [
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "LOCALAPPDATA",
    "APPDATA",
    "ProgramData",
    "USERPROFILE",
    "HOME",
    "LANG",
    "LC_ALL",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
  ];
  const env = {};
  for (const name of allowed) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  env.NO_PROXY = "127.0.0.1,localhost";
  env.no_proxy = env.NO_PROXY;
  return env;
}

function runtimeConfiguration() {
  if (process.env.BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED !== "1") {
    fail(
      "The Spotify playback service may only run in Runtime-managed mode.",
      500,
      "invalid_spotify_playback_configuration",
    );
  }
  const configuredDataRoot = process.env.BREADBOARD_DATA_DIR?.trim();
  if (!configuredDataRoot) {
    fail(
      "The Spotify playback data root is unavailable.",
      500,
      "invalid_spotify_playback_configuration",
    );
  }
  const dataRoot = directDirectory(
    configuredDataRoot,
    "The Spotify playback data root is unavailable.",
  );
  return {
    dataRoot,
    dashboardOrigin: dashboardOrigin(
      process.env.BREADBOARD_SPOTIFY_DASHBOARD_ORIGIN,
    ),
  };
}

function playerPage() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Breadboard Spotify Player</title></head>
<body>
<script>
let deviceId=null;
async function register(){
  if(!deviceId)return;
  await fetch("/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({deviceId}),cache:"no-store"}).catch(()=>{});
}
window.onSpotifyWebPlaybackSDKReady=()=>{
  const player=new Spotify.Player({
    name:"Breadboard",
    volume:0.7,
    getOAuthToken:callback=>{
      fetch("/token",{cache:"no-store"}).then(response=>response.json()).then(payload=>callback(payload.accessToken));
    }
  });
  player.addListener("ready",value=>{deviceId=value.device_id;void register();});
  player.addListener("not_ready",()=>{deviceId=null;});
  player.connect();
  setInterval(()=>void register(),5000);
};
</script>
<script src="https://sdk.scdn.co/spotify-player.js"></script>
</body></html>`;
}

function send(response, status, contentType, bytes, extraHeaders = {}) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": String(bytes.byteLength),
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(bytes);
}

function sendJson(response, status, value) {
  send(
    response,
    status,
    "application/json; charset=utf-8",
    Buffer.from(`${JSON.stringify(value)}\n`, "utf8"),
  );
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

function sameOriginBrowserRequest(request, origin) {
  if (request.headers.host !== new URL(origin).host) return false;
  if (request.headers["sec-fetch-site"] !== "same-origin") return false;
  const referer = request.headers.referer;
  if (typeof referer !== "string") return false;
  try {
    const url = new URL(referer);
    return url.origin === origin && url.pathname === "/player";
  } catch {
    return false;
  }
}

function readJsonBody(request, maximumBytes) {
  return new Promise((resolve, reject) => {
    const declared = request.headers["content-length"];
    if (
      typeof declared === "string" &&
      (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)
    ) {
      reject(new Error("request too large"));
      request.destroy();
      return;
    }
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.byteLength;
      if (total > maximumBytes) {
        reject(new Error("request too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("end", () => {
      try {
        const bytes = Buffer.concat(chunks, total);
        resolve(bytes.byteLength ? JSON.parse(bytes.toString("utf8")) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
  });
}

async function readBoundedDashboardJson(response) {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) ||
      Number(declared) > MAX_DASHBOARD_RESPONSE_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    fail("Spotify returned an invalid response.", 502, "invalid_spotify_response");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    fail("Spotify returned an invalid response.", 502, "invalid_spotify_response");
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_DASHBOARD_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        fail(
          "Spotify returned an invalid response.",
          502,
          "invalid_spotify_response",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 1) {
    fail("Spotify returned an invalid response.", 502, "invalid_spotify_response");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid object");
    }
    return value;
  } catch {
    fail("Spotify returned an invalid response.", 502, "invalid_spotify_response");
  }
}

async function dashboardRequest(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    DASHBOARD_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const value = await readBoundedDashboardJson(response);
    if (!response.ok) {
      fail(
        "Spotify sign-in expired.",
        response.status === 409 ? 409 : 502,
        "spotify_token_unavailable",
      );
    }
    return value;
  } catch (error) {
    if (error && typeof error === "object" && Number.isInteger(error.status)) {
      throw error;
    }
    fail("Spotify sign-in expired.", 502, "spotify_token_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

function dashboardEngineUrl(configuration) {
  return new URL(
    "/api/hermes/connections/spotify/engine",
    configuration.dashboardOrigin,
  );
}

async function proxyToken(configuration, session) {
  const value = await dashboardRequest(
    dashboardEngineUrl(configuration),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: session.ticket, operation: "token" }),
    },
  );
  if (
    typeof value.accessToken !== "string" ||
    value.accessToken.length < 1 ||
    Buffer.byteLength(value.accessToken, "utf8") > 8_192 ||
    (value.expiresAt !== null &&
      value.expiresAt !== undefined &&
      (typeof value.expiresAt !== "string" || value.expiresAt.length > 256))
  ) {
    fail("Spotify returned an invalid token.", 502, "invalid_spotify_response");
  }
  return {
    accessToken: value.accessToken,
    expiresAt: value.expiresAt ?? null,
  };
}

async function proxyRegistration(configuration, session, deviceId) {
  const value = await dashboardRequest(
    dashboardEngineUrl(configuration),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: session.ticket, deviceId }),
    },
  );
  if (value.ok !== true) {
    fail(
      "Spotify rejected the protected-audio browser.",
      502,
      "spotify_registration_failed",
    );
  }
}

async function createPlayerBridge(configuration, session) {
  let origin = "";
  const pageBytes = Buffer.from(playerPage(), "utf8");
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", origin);
      if (request.method === "GET" && requestUrl.pathname === "/player") {
        if (request.headers.host !== new URL(origin).host) {
          sendError(response, 403, "Player origin rejected.");
          return;
        }
        send(
          response,
          200,
          "text/html; charset=utf-8",
          pageBytes,
          {
            "content-security-policy":
              "default-src 'self' https://sdk.scdn.co https://*.spotify.com https://*.scdn.co blob: data:; script-src 'self' 'unsafe-inline' https://sdk.scdn.co blob:; connect-src 'self' https://*.spotify.com wss://*.spotify.com; media-src blob: https://*.spotify.com https://*.scdn.co; worker-src blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
            "referrer-policy": "same-origin",
          },
        );
        return;
      }
      if (!sameOriginBrowserRequest(request, origin)) {
        sendError(response, 403, "Player request rejected.");
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/token") {
        sendJson(response, 200, await proxyToken(configuration, session));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/register") {
        const body = await readJsonBody(request, MAX_BRIDGE_REQUEST_BYTES);
        if (!exactRecord(body, ["deviceId"])) {
          sendError(response, 400, "Player registration rejected.");
          return;
        }
        await proxyRegistration(
          configuration,
          session,
          playbackDeviceId(body.deviceId),
        );
        sendJson(response, 200, { ok: true });
        return;
      }
      sendError(response, 404, "Player route not found.");
    } catch {
      sendError(response, 502, "Player request failed.");
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(() => resolve()));
    fail(
      "Breadboard could not create its protected-audio bridge.",
      503,
      "spotify_bridge_unavailable",
    );
  }
  origin = `http://${LOOPBACK_HOST}:${address.port}`;
  return { server, origin };
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    const spawned = () => {
      child.off("error", errored);
      resolve();
    };
    const errored = (error) => {
      child.off("spawn", spawned);
      reject(error);
    };
    child.once("spawn", spawned);
    child.once("error", errored);
  });
}

function waitForExit(child, milliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const sessions = new Map();
const failures = new Map();
const operations = new Map();
const launchingUsers = new Set();

async function serialize(userId, operation) {
  const previous = operations.get(userId);
  const current = (async () => {
    if (previous) await previous.catch(() => undefined);
    return operation();
  })();
  operations.set(userId, current);
  try {
    return await current;
  } finally {
    if (operations.get(userId) === current) operations.delete(userId);
  }
}

async function closeSession(session) {
  if (session.stopping) return;
  session.stopping = true;
  sessions.delete(session.userId);
  await closeServer(session.bridge.server).catch(() => undefined);
  const child = session.child;
  if (child && child.exitCode === null && child.signalCode === null) {
    try {
      child.kill();
    } catch {
      // Rust owns the complete service Job Object and applies the force bound.
    }
    await waitForExit(child, 3_000);
  }
}

function recordFailure(userId, message) {
  failures.set(userId, { at: Date.now(), message });
  while (failures.size > 128) {
    const oldest = failures.keys().next().value;
    if (oldest === undefined) break;
    failures.delete(oldest);
  }
}

function sessionStatus(userId) {
  const session = sessions.get(userId);
  if (session && !session.stopping) return { status: "starting", error: null };
  const failure = failures.get(userId);
  if (failure && Date.now() - failure.at < LAUNCH_COOLDOWN_MS) {
    return { status: "unavailable", error: failure.message };
  }
  if (failure) failures.delete(userId);
  return { status: "starting", error: null };
}

async function launchSession(configuration, input) {
  return serialize(input.userId, async () => {
    let session = sessions.get(input.userId);
    if (session && !session.stopping) {
      if (
        !session.views.has(input.viewId) &&
        session.views.size >= MAX_VIEWS_PER_USER
      ) {
        fail("Too many active Spotify players.", 429, "too_many_spotify_views");
      }
      session.ticket = input.ticket;
      session.views.set(input.viewId, Date.now() + VIEW_TTL_MS);
      session.idleSince = null;
      return sessionStatus(input.userId);
    }

    const recentFailure = failures.get(input.userId);
    if (
      recentFailure &&
      Date.now() - recentFailure.at < LAUNCH_COOLDOWN_MS
    ) {
      fail(recentFailure.message, 503, "spotify_browser_launch_failed");
    }
    failures.delete(input.userId);
    if (
      sessions.size + launchingUsers.size >= MAX_BROWSER_SESSIONS &&
      !launchingUsers.has(input.userId)
    ) {
      fail("Too many active Spotify players.", 429, "too_many_spotify_sessions");
    }

    launchingUsers.add(input.userId);
    try {
      const executable = browserExecutable();
      const profile = ensureDirectSpotifyProfile(configuration.dataRoot, [
        "database",
        "spotify-browser-player",
        `user-${input.userId}`,
      ]);
      session = {
        userId: input.userId,
        ticket: input.ticket,
        views: new Map([[input.viewId, Date.now() + VIEW_TTL_MS]]),
        child: null,
        bridge: null,
        stopping: false,
        idleSince: null,
      };
      const bridge = await createPlayerBridge(configuration, session);
      session.bridge = bridge;
      let child;
      try {
        child = spawn(
          executable,
          [
            "--headless=new",
            `--user-data-dir=${profile}`,
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-sync",
            "--disable-background-mode",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--autoplay-policy=no-user-gesture-required",
            `${bridge.origin}/player`,
          ],
          {
            detached: false,
            shell: false,
            stdio: "ignore",
            windowsHide: true,
            env: childEnvironment(),
          },
        );
      } catch {
        await closeServer(bridge.server).catch(() => undefined);
        recordFailure(
          input.userId,
          "Breadboard could not start its protected-audio browser.",
        );
        fail(
          "Breadboard could not start its protected-audio browser.",
          503,
          "spotify_browser_launch_failed",
        );
      }
      session.child = child;
      sessions.set(input.userId, session);
      try {
        await waitForSpawn(child);
      } catch {
        recordFailure(
          input.userId,
          "Breadboard could not start its protected-audio browser.",
        );
        await closeSession(session);
        fail(
          "Breadboard could not start its protected-audio browser.",
          503,
          "spotify_browser_launch_failed",
        );
      }

      child.once("error", () => {
        void serialize(input.userId, async () => {
          if (sessions.get(input.userId) !== session || session.stopping) return;
          recordFailure(
            input.userId,
            "Breadboard's protected-audio browser stopped unexpectedly.",
          );
          await closeSession(session);
        });
      });
      child.once("exit", () => {
        void serialize(input.userId, async () => {
          if (sessions.get(input.userId) !== session || session.stopping) return;
          recordFailure(
            input.userId,
            "Breadboard's protected-audio browser stopped unexpectedly.",
          );
          await closeSession(session);
        });
      });
      return sessionStatus(input.userId);
    } finally {
      launchingUsers.delete(input.userId);
    }
  });
}

async function releaseView(userId, releasedViewId) {
  await serialize(userId, async () => {
    const session = sessions.get(userId);
    if (!session || session.stopping) return;
    session.views.delete(releasedViewId);
    if (session.views.size === 0 && session.idleSince === null) {
      session.idleSince = Date.now();
    }
  });
}

async function expireViews() {
  const now = Date.now();
  await Promise.all(
    [...sessions.keys()].map((userId) =>
      serialize(userId, async () => {
        const session = sessions.get(userId);
        if (!session || session.stopping) return;
        for (const [id, expiresAt] of session.views) {
          if (expiresAt <= now) session.views.delete(id);
        }
        if (session.views.size > 0) {
          session.idleSince = null;
        } else {
          session.idleSince ??= now;
          if (now - session.idleSince >= SESSION_IDLE_TTL_MS) {
            await closeSession(session);
          }
        }
      }),
    ),
  );
}

async function main() {
  const configuration = runtimeConfiguration();
  const expiryTimer = setInterval(() => void expireViews(), 5_000);
  expiryTimer.unref?.();

  await startRuntimeV2GatewayHttpService({
    name: "spotify-playback",
    tokenEnvironmentName: "BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_TOKEN",
    maximumRequestBytes: 8 * 1024,
    maximumResponseBytes: 8 * 1024,
    route: async ({ method, path: routePath, body }) => {
      if (method !== "POST") {
        fail("Unsupported Spotify playback method.", 405, "method_not_allowed");
      }
      if (routePath === "/v1/ensure") {
        if (!exactRecord(body, ["userId", "viewId", "ticket"])) {
          fail(
            "The Spotify playback request is invalid.",
            400,
            "invalid_spotify_playback_request",
          );
        }
        return launchSession(configuration, {
          userId: positiveUserId(body.userId),
          viewId: viewId(body.viewId),
          ticket: engineTicket(body.ticket),
        });
      }
      if (routePath === "/v1/release") {
        if (!exactRecord(body, ["userId", "viewId"])) {
          fail(
            "The Spotify playback release is invalid.",
            400,
            "invalid_spotify_playback_request",
          );
        }
        await releaseView(positiveUserId(body.userId), viewId(body.viewId));
        return { released: true };
      }
      if (routePath === "/v1/status") {
        if (!exactRecord(body, ["userId"])) {
          fail(
            "The Spotify playback status request is invalid.",
            400,
            "invalid_spotify_playback_request",
          );
        }
        return sessionStatus(positiveUserId(body.userId));
      }
      fail("Unknown Spotify playback route.", 404, "route_not_found");
    },
    onStop: async () => {
      clearInterval(expiryTimer);
      await Promise.all([...sessions.values()].map(closeSession));
    },
  });
}

void main().catch((error) => {
  process.stderr.write(
    `[runtime-v2-spotify-playback] startup failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
