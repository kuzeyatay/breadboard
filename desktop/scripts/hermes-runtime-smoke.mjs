import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = path.join(desktopRoot, "build-resources", "runtimes", "python", "python.exe");
const hermesSource = path.join(
  desktopRoot,
  "build-resources",
  "app-services",
  "hermes-agent",
);

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

function waitForSocket(url, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
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

function nextFrame(socket, predicate, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Hermes JSON-RPC response timed out"));
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
    "toolsets:",
    "  - breadboard",
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
  [
    "-m",
    "hermes_cli.main",
    "serve",
    "--isolated",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--no-open",
  ],
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

  const socket = await waitForSocket(
    `${baseUrl.replace("http:", "ws:")}/api/ws?token=${encodeURIComponent(token)}`,
  );
  try {
    await nextFrame(
      socket,
      (frame) => frame?.method === "event" && frame?.params?.type === "gateway.ready",
    );
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
    const response = await nextFrame(socket, (frame) => frame?.id === "smoke-create");
    if (
      response.error ||
      !response.result?.session_id ||
      !response.result?.stored_session_id
    ) {
      throw new Error(`Hermes session creation failed: ${response.error?.message ?? "invalid result"}`);
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
