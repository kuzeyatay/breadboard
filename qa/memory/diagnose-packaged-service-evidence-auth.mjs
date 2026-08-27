#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { assertWindowsCommitHeadroom } from "../../desktop/scripts/commit-preflight.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const target = process.argv[2]?.trim();
const sourceMode = target === "--source";
if (!sourceMode && (!target || !path.isAbsolute(target))) {
  throw new Error("Pass --source or the absolute win-unpacked directory as the only argument.");
}

const packageRoot = sourceMode ? null : target;
const dashboardRoot = sourceMode
  ? path.join(repoRoot, "dashboard")
  : path.join(
      packageRoot,
      "resources",
      "app-services",
      "dashboard-standalone",
      "dashboard",
    );
const nodeExecutable = sourceMode
  ? process.execPath
  : path.join(packageRoot, "resources", "runtimes", "node", "node.exe");
const serverEntrypoint = sourceMode
  ? path.join(dashboardRoot, "node_modules", "next", "dist", "bin", "next")
  : path.join(dashboardRoot, "server.js");
for (const candidate of [nodeExecutable, serverEntrypoint]) {
  if (!fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Packaged dashboard diagnostic input is missing: ${candidate}`);
  }
}
if (sourceMode) {
  assertWindowsCommitHeadroom({
    operation: "source service-evidence auth diagnostic",
    estimateMb: 6_144,
  });
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "desktop", "runtime-v2", "manifests", "services.json"), "utf8"),
);
const serviceIds = manifest.services.map(({ id }) => id);
if (serviceIds.length !== 32 || !serviceIds.includes("gbrain")) {
  throw new Error("The source service manifest is not the mandatory 32-service authority.");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a loopback diagnostic port.")));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      reject(new Error("Packaged standalone dashboard did not exit after diagnostic shutdown."));
    }, timeoutMs);
    timer.unref();
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    child.once("exit", onExit);
  });
}

function terminateChildTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && Number.isSafeInteger(child.pid)) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill();
}

function rawRequestStatus(url, bearer, host = undefined) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${bearer}`,
        ...(host ? { host } : {}),
      },
    });
    request.once("response", (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.once("error", reject);
    request.end();
  });
}

const port = await freePort();
const token = randomBytes(32).toString("hex");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-packaged-auth-diagnostic-"));
const diagnosticDistName = `.next-memory-service-auth-${process.pid}`;
const diagnosticDistRoot = sourceMode ? path.join(dashboardRoot, diagnosticDistName) : null;
const endpoints = serviceIds.map((id, index) => [id, `http://127.0.0.1:${30_000 + index}`]);
const serverArguments = sourceMode
  ? [serverEntrypoint, "dev", "--turbopack", "--hostname", "127.0.0.1", "--port", String(port)]
  : [serverEntrypoint];
const child = spawn(nodeExecutable, serverArguments, {
  cwd: dashboardRoot,
  env: {
    ...process.env,
    NODE_ENV: sourceMode ? "development" : "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    BREADBOARD_DATA_DIR: temporaryRoot,
    BREADBOARD_RUNTIME_V2_ACTIVE: "1",
    BREADBOARD_PACKAGED_SERVICE_EVIDENCE: "1",
    BREADBOARD_PACKAGED_SERVICE_EVIDENCE_ENDPOINTS: JSON.stringify(endpoints),
    BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN: token,
    BREADBOARD_SUPERVISOR_CONTROL_URL: "http://127.0.0.1:1",
    BREADBOARD_SUPERVISOR_CONTROL_TOKEN: randomBytes(32).toString("hex"),
    NEXTAUTH_SECRET: randomBytes(32).toString("hex"),
    NEXTAUTH_URL: `http://127.0.0.1:${port}`,
    ...(sourceMode
      ? {
          BREADBOARD_NEXT_DIST_DIR: diagnosticDistName,
          BREADBOARD_BACKGROUND_COORDINATOR_DISABLED: "1",
        }
      : {}),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let logTail = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    logTail = `${logTail}${chunk}`.slice(-8_192);
  });
}

try {
  const url = `http://127.0.0.1:${port}/api/internal/runtime-service-evidence`;
  const deadline = Date.now() + 90_000;
  let fetchCorrectStatus = null;
  let rawCorrectStatus = null;
  let rawWrongStatus = null;
  let rawLocalhostHostStatus = null;
  let memoryCorrectStatus = null;
  let memoryWrongStatus = null;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Dashboard exited before auth diagnosis: ${logTail}`);
    }
    try {
      const correct = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        redirect: "error",
      });
      fetchCorrectStatus = correct.status;
      await correct.body?.cancel();
      rawCorrectStatus = await rawRequestStatus(url, token);
      rawWrongStatus = await rawRequestStatus(url, "0".repeat(64));
      rawLocalhostHostStatus = await rawRequestStatus(url, token, `localhost:${port}`);
      memoryCorrectStatus = await rawRequestStatus(
        `http://127.0.0.1:${port}/api/internal/runtime-memory`,
        token,
      );
      memoryWrongStatus = await rawRequestStatus(
        `http://127.0.0.1:${port}/api/internal/runtime-memory`,
        "0".repeat(64),
      );
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const result = {
    fetchCorrectTokenStatus: fetchCorrectStatus,
    rawCorrectTokenStatus: rawCorrectStatus,
    rawWrongTokenStatus: rawWrongStatus,
    rawLocalhostHostStatus,
    memoryCorrectTokenStatus: memoryCorrectStatus,
    memoryWrongTokenStatus: memoryWrongStatus,
    authGatePassed:
      fetchCorrectStatus === rawCorrectStatus &&
      rawWrongStatus === 401 &&
      rawLocalhostHostStatus === 401 &&
      memoryCorrectStatus === 200 &&
      memoryWrongStatus === 401 &&
      rawCorrectStatus !== 401 &&
      rawCorrectStatus !== 404,
    target: sourceMode ? "source" : "packaged",
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.authGatePassed) process.exitCode = 1;
} finally {
  terminateChildTree(child);
  await waitForExit(child, 15_000).catch(() => undefined);
  const resolved = path.resolve(temporaryRoot);
  const expectedParent = path.resolve(os.tmpdir());
  if (
    path.dirname(resolved) === expectedParent &&
    path.basename(resolved).startsWith("breadboard-packaged-auth-diagnostic-")
  ) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  if (diagnosticDistRoot) {
    const resolvedDist = path.resolve(diagnosticDistRoot);
    const expectedDashboardRoot = path.resolve(dashboardRoot);
    if (
      path.dirname(resolvedDist) === expectedDashboardRoot &&
      path.basename(resolvedDist).startsWith(".next-memory-service-auth-")
    ) {
      fs.rmSync(resolvedDist, { recursive: true, force: true });
    }
  }
}
