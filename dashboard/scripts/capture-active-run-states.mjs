import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nextEnv from "@next/env";
import Database from "better-sqlite3";
import nextAuthJwt from "next-auth/jwt";

const { loadEnvConfig } = nextEnv;
const { encode } = nextAuthJwt;

const EDGE_PATH =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const DEBUG_PORT = 9223;
const PROFILE_PREFIX = "breadboard-edge-";
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
const screenshotPath = path.join(
  process.cwd(),
  "test-results",
  "active-run-composer",
);
fs.mkdirSync(screenshotPath, { recursive: true });

const edge = spawn(
  EDGE_PATH,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profilePath}`,
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForDebugger() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${DEBUG_PORT}/json/list`,
      );
      if (response.ok) return response.json();
    } catch {
      // The browser is still starting.
    }
    await delay(100);
  }
  throw new Error("Edge debugging endpoint did not start.");
}

async function createLocalSessionToken() {
  loadEnvConfig(process.cwd());
  if (!process.env.NEXTAUTH_SECRET) {
    throw new Error("NEXTAUTH_SECRET is unavailable.");
  }
  const authDb = new Database(path.join(process.cwd(), "db", "brain.db"), {
    readonly: true,
  });
  const user = authDb
    .prepare("SELECT id, username, email FROM users ORDER BY id LIMIT 1")
    .get();
  authDb.close();
  if (!user) {
    throw new Error("No local user is available for authenticated UI checks.");
  }
  return encode({
    token: {
      id: String(user.id),
      sub: String(user.id),
      name: user.username ?? user.email,
      email: user.email,
    },
    secret: process.env.NEXTAUTH_SECRET,
    maxAge: 60 * 60,
  });
}

async function capture() {
  const [targets, sessionToken] = await Promise.all([
    waitForDebugger(),
    createLocalSessionToken(),
  ]);
  const target = targets.find((candidate) => candidate.type === "page");
  if (!target) throw new Error("No Edge page target was found.");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const eventWaiters = new Map();
  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(String(message.data));
    if (payload.id && pending.has(payload.id)) {
      const waiter = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) waiter.reject(new Error(payload.error.message));
      else waiter.resolve(payload.result ?? {});
      return;
    }
    if (payload.method && eventWaiters.has(payload.method)) {
      const waiters = eventWaiters.get(payload.method);
      eventWaiters.delete(payload.method);
      for (const resolve of waiters) resolve(payload.params ?? {});
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const waitEvent = (method, timeoutMilliseconds = 10_000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for ${method}.`)),
        timeoutMilliseconds,
      );
      const wrapped = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      eventWaiters.set(method, [
        ...(eventWaiters.get(method) ?? []),
        wrapped,
      ]);
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.text ?? "Browser evaluation failed.",
      );
    }
    return result.result?.value;
  };
  const waitFor = async (expression, timeoutMilliseconds = 15_000) => {
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  };
  const screenshot = async (name) => {
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    fs.writeFileSync(path.join(screenshotPath, name), data, "base64");
  };
  const setComposer = async (value) => {
    await evaluate(`(() => {
      const node = document.querySelector('textarea');
      if (!node) return false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      ).set;
      setter.call(node, ${JSON.stringify(value)});
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.focus();
      return true;
    })()`);
    await delay(35);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Network.setCookie", {
    name: "next-auth.session-token",
    value: sessionToken,
    url: "http://localhost:3000",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  });
  await send("Page.navigate", { url: "http://localhost:3000/dashboard" });
  await waitFor("document.readyState === 'complete'", 20_000);
  await evaluate(
    "localStorage.setItem('breadboard:knowledge-terminal-height', '680'); location.reload()",
  );
  await waitFor("document.readyState === 'complete'", 20_000);
  await waitFor("Boolean(document.querySelector('textarea'))", 20_000);
  await delay(1_200);
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'New chat')?.click()",
  );
  await delay(100);
  await screenshot("idle.png");

  await setComposer(
    "Compare the major themes across my gardens, inspect the available evidence carefully, and produce a detailed synthesis with citations.",
  );
  await evaluate("document.querySelector('button[title=\"Send\"]')?.click()");
  await waitFor(
    "Boolean(document.querySelector('button[title=\"Stop\"]'))",
    15_000,
  );
  await waitFor(
    "Boolean(document.querySelector('[aria-label=\"Run status: running\"]'))",
    15_000,
  );
  await screenshot("running.png");

  await setComposer(
    "Prioritize contradictions and unresolved evidence before writing the synthesis.",
  );
  await waitFor(
    "Boolean(Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Steer' && !button.disabled))",
    3_000,
  );
  await send("Fetch.enable", {
    patterns: [
      {
        urlPattern: "*/api/openharness/sessions/*/steer",
        requestStage: "Request",
      },
    ],
  });
  const steerPaused = waitEvent("Fetch.requestPaused");
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Steer')?.click()",
  );
  const steerRequest = await steerPaused;
  await delay(180);
  await screenshot("steering.png");
  await send("Fetch.continueRequest", { requestId: steerRequest.requestId });
  await send("Fetch.disable");
  await waitFor(
    "Boolean(document.querySelector('button[title=\"Stop\"]'))",
    10_000,
  );

  await send("Fetch.enable", {
    patterns: [
      {
        urlPattern: "*/api/openharness/sessions/*/abort",
        requestStage: "Request",
      },
    ],
  });
  const stopPaused = waitEvent("Fetch.requestPaused");
  await evaluate("document.querySelector('button[title=\"Stop\"]')?.click()");
  const stopRequest = await stopPaused;
  await delay(180);
  await screenshot("stopping.png");
  await send("Fetch.continueRequest", { requestId: stopRequest.requestId });
  await send("Fetch.disable");
  await delay(800);
  await send("Browser.close").catch(() => undefined);
  socket.close();
}

try {
  await capture();
  process.stdout.write(
    "Captured idle, running, steering, and stopping UI states.\n",
  );
} finally {
  edge.kill();
  const resolvedProfile = path.resolve(profilePath);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (
    resolvedProfile.startsWith(resolvedTemp) &&
    path.basename(resolvedProfile).startsWith(PROFILE_PREFIX)
  ) {
    await delay(1_000);
    fs.rmSync(resolvedProfile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 250,
    });
  }
}
