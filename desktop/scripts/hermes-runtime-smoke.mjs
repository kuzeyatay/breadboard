import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = path.join(desktopRoot, "build-resources", "runtimes", "python", "python.exe");
const development = process.argv.includes("--dev");
const appRoot = development
  ? path.resolve(desktopRoot, "..")
  : path.join(desktopRoot, "build-resources", "app-services");
const hermesSource = path.join(appRoot, "hermes-agent");
const serviceManifest = JSON.parse(fs.readFileSync(
  path.join(desktopRoot, "runtime-v2", "manifests", "services.json"), "utf8",
));
const launchProfile = serviceManifest.services.find(({ id }) => id === "hermes")
  .launchProfiles.find(({ modes }) => modes.includes(development ? "lean" : "packaged"));

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function waitForSocket(url, timeoutMs = 15_000, onSocket = () => {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    onSocket(socket);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Hermes WebSocket timed out"));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Hermes WebSocket connection failed"));
    }, { once: true });
  });
}

function nextFrame(socket, predicate, label, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Hermes JSON-RPC response timed out: ${label}`));
    }, timeoutMs);
    const onMessage = (event) => {
      let frame;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!predicate(frame)) return;
      cleanup();
      resolve(frame);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Hermes WebSocket closed before the expected frame"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose, { once: true });
  });
}

async function waitForHealthy(baseUrl, child, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Hermes exited before readiness (code ${child.exitCode})`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/status`, {
        signal: AbortSignal.timeout(2_000),
      });
      const body = await response.json();
      if (response.ok && typeof body.version === "string") return;
    } catch {
      // Retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Hermes readiness timed out");
}

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

if (!fs.existsSync(python) || !fs.existsSync(path.join(hermesSource, "hermes_cli", "main.py"))) {
  throw new Error("Assemble runtimes and app resources before running the Hermes smoke test");
}

const sourceProbe = spawnSync(python, [path.join(hermesSource, "breadboard_runtime.py"), "--check-source"], {
  cwd: hermesSource, encoding: "utf8", windowsHide: true, timeout: 30_000,
});
if (sourceProbe.status !== 0) throw new Error(`Hermes source preflight failed: ${sourceProbe.stderr}`);
const expectedSource = JSON.parse(sourceProbe.stdout);

const port = await allocatePort();
const baseUrl = `http://127.0.0.1:${port}`;
const token = crypto.randomBytes(32).toString("base64url");
const toolSecret = crypto.randomBytes(32).toString("base64url");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hermes-smoke-"));
fs.chmodSync(tempRoot, 0o700);
fs.writeFileSync(
  path.join(tempRoot, "config.yaml"),
  [
    "model:",
    '  default: "gpt-5.6-sol"',
    "  provider: custom",
    '  base_url: "http://127.0.0.1:8765/v1"',
    "  context_length: 256000",
    "toolsets:",
    "  - breadboard",
    "  - web",
    "web:",
    "  search_backend: ddgs",
    "  extract_backend: fetch",
    "memory:",
    "  memory_enabled: false",
    "  user_profile_enabled: false",
    "tools:",
    "  tool_search:",
    "    enabled: on",
    "",
  ].join("\n"),
  { encoding: "utf8", mode: 0o600 },
);

const logChunks = [];
const child = spawn(
  python,
  launchProfile.arguments.map((argument) => {
    if (argument.kind === "literal") return argument.value;
    if (argument.kind === "app-path") return path.join(appRoot, argument.path);
    if (argument.kind === "runtime-value" && argument.value === "service-port") return String(port);
    throw new Error(`Unsupported Hermes launch argument: ${argument.kind}`);
  }),
  {
    cwd: hermesSource,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HERMES_HOME: tempRoot,
      HERMES_DESKTOP: "1",
      HERMES_SERVE_HEADLESS: "1",
      HERMES_DASHBOARD_SESSION_TOKEN: token,
      BREADBOARD_INTERNAL_URL: "http://127.0.0.1:3000",
      BREADBOARD_HERMES_TOOL_SECRET: toolSecret,
      OPENAI_BASE_URL: "http://127.0.0.1:8765/v1",
      OPENAI_API_KEY: "local",
    },
  },
);
for (const stream of [child.stdout, child.stderr]) {
  stream?.on("data", (chunk) => {
    if (logChunks.join("").length < 16_384) logChunks.push(String(chunk));
  });
}

try {
  await waitForHealthy(baseUrl, child);
  const sourceResponse = await fetch(`${baseUrl}/api/runtime/source`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000),
  });
  const runningSource = sourceResponse.ok ? await sourceResponse.json() : null;
  if (runningSource?.sourceRoot !== expectedSource.sourceRoot ||
      runningSource?.sourceSha256 !== expectedSource.sourceSha256) {
    throw new Error("Healthy Hermes loaded the wrong or outdated source; refusing to accept the runtime.");
  }
  const publicSource = await fetch(`${baseUrl}/api/runtime/source`, { signal: AbortSignal.timeout(5_000) });
  if (publicSource.status !== 401) throw new Error("Hermes source identity must require authentication.");

  // The gateway rejects a client without the unguessable server-only token.
  let unauthorizedRejected = false;
  try {
    const unauthorized = await waitForSocket(
      `${baseUrl.replace("http:", "ws:")}/api/ws`,
    );
    const unauthorizedClose = await new Promise((resolve) => {
      unauthorized.addEventListener("close", (event) => resolve(event.code), {
        once: true,
      });
    });
    if (unauthorizedClose !== 4401) {
      throw new Error(
        `Hermes accepted an unauthenticated WebSocket (${unauthorizedClose})`,
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Hermes WebSocket connection failed"
    ) {
      unauthorizedRejected = true;
    } else {
      throw error;
    }
  }
  if (!unauthorizedRejected) {
    // The server accepted then immediately closed with its explicit 4401.
  }

  let ready;
  const socket = await waitForSocket(
    `${baseUrl.replace("http:", "ws:")}/api/ws?token=${encodeURIComponent(token)}`,
    15_000,
    (connectingSocket) => {
      ready = nextFrame(connectingSocket,
        (frame) => frame?.method === "event" && frame?.params?.type === "gateway.ready",
        "gateway.ready");
      // A failed handshake is reported by waitForSocket; don't leak an
      // unhandled rejection from its companion readiness listener.
      ready.catch(() => {});
    },
  );
  try {
    await ready;
    const created = nextFrame(socket, (frame) => frame?.id === "smoke-create", "session.create");
    const initialized = nextFrame(socket,
      (frame) => frame?.method === "event" && ["session.info", "error"].includes(frame?.params?.type),
      "agent initialization");
    initialized.catch(() => {});
    socket.send(JSON.stringify({
      jsonrpc: "2.0",
      id: "smoke-create",
      method: "session.create",
      params: {
        source: "breadboard",
        title: "Breadboard Hermes smoke",
        cwd: tempRoot,
        messages: [],
        model: "gpt-5.6-sol",
        provider: "custom",
        enabled_toolsets: ["breadboard", "web"],
        system_prompt: "Smoke test.",
        close_on_disconnect: false,
      },
    }));
    const response = await created;
    if (
      response.error ||
      !response.result?.session_id ||
      !response.result?.stored_session_id
    ) {
      throw new Error(`Hermes session creation failed: ${response.error?.message ?? "invalid result"}`);
    }
    // Creation is lazy. Until session.info arrives, tools.list would inspect
    // the default CLI toolsets rather than this Breadboard session's toolsets.
    const initialization = await initialized;
    if (initialization.params.type === "error") {
      throw new Error(`Hermes initialization failed: ${initialization.params.payload?.message}`);
    }
    const toolsResponse = nextFrame(socket, (frame) => frame?.id === "smoke-tools", "tools.list");
    socket.send(JSON.stringify({
      jsonrpc: "2.0",
      id: "smoke-tools",
      method: "tools.list",
      params: { session_id: response.result.session_id },
    }));
    const available = await toolsResponse;
    // tools.show intentionally omits deferred schemas. The enabled toolset's
    // resolved catalog is the source searched by the tool_search bridge.
    const toolNames = (available.result?.toolsets ?? [])
      .filter(({ name, enabled }) => name === "breadboard" && enabled)
      .flatMap(({ tools }) => tools);
    if (available.error || !toolNames.includes("weather_forecast")) {
      throw new Error(available.error
        ? `Hermes tool discovery failed: ${available.error.message}`
        : `The running Hermes session is missing weather_forecast (${toolNames.length} tools); check its app-source authority.`);
    }
  } finally {
    socket.close();
  }
  console.log("[hermes-runtime-smoke] OK");
} catch (error) {
  const safeLog = logChunks
    .join("")
    .split(token).join("[redacted]")
    .split(toolSecret).join("[redacted]")
    .slice(-4_000);
  if (safeLog.trim()) console.error(safeLog);
  throw error;
} finally {
  killTree(child);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
