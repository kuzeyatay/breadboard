#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertWindowsCommitHeadroom } from "../../desktop/scripts/commit-preflight.mjs";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, "..", "..");
const dashboardDir = path.join(repoRoot, "dashboard");
const nextBin = path.join(dashboardDir, "node_modules", "next", "dist", "bin", "next");
const probePath = path.join(dashboardDir, "src", "lib", "runtime-memory-benchmark-probe.ts");
const tsconfigPath = path.join(dashboardDir, "tsconfig.json");
const argumentsMap = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.split("=");
  return [key, rest.join("=") || "true"];
}));

function integerArgument(key, fallback, min, max) {
  const raw = argumentsMap.get(key);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be a whole number`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}`);
  return value;
}

const requestedBundler = argumentsMap.get("--bundler") ?? "turbopack";
if (!new Set(["turbopack", "webpack", "both"]).has(requestedBundler)) {
  throw new Error("--bundler must be turbopack, webpack, or both");
}
const cycles = integerArgument("--cycles", 30, 1, 100);
const settleMs = integerArgument("--settle-ms", 5_000, 0, 120_000);
const outputPath = path.resolve(
  repoRoot,
  argumentsMap.get("--output") ?? path.join("qa", "memory", "latest-dashboard-compiler.json"),
);
const originalProbe = fs.readFileSync(probePath, "utf8");
const originalTsconfig = fs.readFileSync(tsconfigPath, "utf8");
const probePrefix = originalProbe.replace(/export const MEMORY_BENCHMARK_PROBE = \d+;\s*$/, "");
if (probePrefix === originalProbe) throw new Error(`Could not identify benchmark probe in ${probePath}`);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a port"));
      server.close(() => resolve(address.port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, token, timeoutMs = 120_000) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function waitForHealth(origin, child, logTail) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dashboard exited ${child.exitCode}\n${logTail.join("\n")}`);
    }
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return;
    } catch {
      // Compilation and connection refusal are expected during cold start.
    }
    await delay(500);
  }
  throw new Error(`dashboard did not become healthy\n${logTail.join("\n")}`);
}

async function waitForProbe(origin, token, expected) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const body = await fetchJson(
        `${origin}/api/internal/runtime-memory?phase=rebuild-${expected}`,
        token,
      );
      if (body.benchmarkProbe === expected) return body.current;
    } catch {
      // A connection reset/5xx is expected while the route itself recompiles.
    }
    await delay(250);
  }
  throw new Error(`compiler did not publish benchmark probe ${expected}`);
}

function stopTree(child) {
  if (!child?.pid || !Number.isSafeInteger(child.pid) || child.pid <= 0 || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}

function summarize(samples) {
  const warm = samples.find((sample) => sample.phase === "warm") ?? samples[0];
  const rebuilds = samples.filter((sample) => sample.phase.startsWith("rebuild-"));
  const lastRebuild = rebuilds.at(-1) ?? warm;
  const settled = samples.find((sample) => sample.phase === "settled") ?? samples.at(-1);
  const memoryFields = ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers"];
  const delta = (left, right) => Object.fromEntries(
    memoryFields.map((field) => [field, right.memory[field] - left.memory[field]]),
  );
  const peak = (field, source = samples) =>
    Math.max(...source.map((sample) => sample.memory[field]));
  return {
    sampleCount: samples.length,
    warmBytes: warm.memory,
    lastRebuildBytes: lastRebuild.memory,
    settledBytes: settled.memory,
    warmToLastRebuildDeltaBytes: delta(warm, lastRebuild),
    warmToSettledDeltaBytes: delta(warm, settled),
    rebuildPeakBytes: Object.fromEntries(
      memoryFields.map((field) => [field, peak(field, rebuilds.length > 0 ? rebuilds : samples)]),
    ),
    peakBytes: Object.fromEntries(
      memoryFields.map((field) => [field, peak(field)]),
    ),
    rssIncreasePerRebuildBytes:
      (lastRebuild.memory.rss - warm.memory.rss) / Math.max(1, rebuilds.length),
  };
}

function restoreBenchmarkInputs() {
  fs.writeFileSync(probePath, originalProbe, "utf8");
  fs.writeFileSync(tsconfigPath, originalTsconfig, "utf8");
}

async function runBundler(bundler) {
  assertWindowsCommitHeadroom({
    operation: `${bundler} dashboard memory benchmark`,
    estimateMb: bundler === "webpack" ? 11_264 : 6_144,
  });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const token = randomBytes(32).toString("hex");
  const args = [nextBin, "dev"];
  if (bundler === "webpack") args.push("--webpack");
  args.push("--hostname", "127.0.0.1", "--port", String(port));
  const logTail = [];
  const child = spawn(process.execPath, args, {
    cwd: dashboardDir,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_OPTIONS:
        process.env.BREADBOARD_MEMORY_BENCHMARK_NODE_OPTIONS?.trim() ||
        "--max-old-space-size=4096",
      BREADBOARD_NEXT_DIST_DIR: `.next-memory-${bundler}`,
      BREADBOARD_DASHBOARD_BUNDLER: bundler,
      BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN: token,
      BREADBOARD_BACKGROUND_COORDINATOR_DISABLED: "1",
    },
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      process.stdout.write(chunk);
      logTail.push(...chunk.split(/\r?\n/).filter(Boolean));
      if (logTail.length > 120) logTail.splice(0, logTail.length - 120);
    });
  }

  const samples = [];
  try {
    await waitForHealth(origin, child, logTail);
    await fetch(`${origin}/dashboard`, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
    samples.push((await fetchJson(`${origin}/api/internal/runtime-memory?phase=warm`, token)).current);
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      fs.writeFileSync(
        probePath,
        `${probePrefix}export const MEMORY_BENCHMARK_PROBE = ${cycle};\n`,
        "utf8",
      );
      samples.push(await waitForProbe(origin, token, cycle));
      process.stdout.write(
        `[memory-benchmark] ${bundler} rebuild ${cycle}/${cycles}: ` +
          `rss=${Math.round(samples.at(-1).memory.rss / 1048576)}MB ` +
          `heap=${Math.round(samples.at(-1).memory.heapUsed / 1048576)}MB\n`,
      );
    }
    if (settleMs > 0) await delay(settleMs);
    samples.push((await fetchJson(`${origin}/api/internal/runtime-memory?phase=settled`, token)).current);
    return {
      bundler,
      cycles,
      compilerProcessOnly: true,
      nodeOptions: process.env.BREADBOARD_MEMORY_BENCHMARK_NODE_OPTIONS?.trim() || "--max-old-space-size=4096",
      samples,
      summary: summarize(samples),
    };
  } finally {
    stopTree(child);
    restoreBenchmarkInputs();
  }
}

const bundlers = requestedBundler === "both" ? ["turbopack", "webpack"] : [requestedBundler];
const receipt = {
  schemaVersion: 2,
  startedAt: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  cycles,
  results: [],
};

function writeReceipt() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`[memory-benchmark] receipt: ${outputPath}\n`);
}

try {
  for (const bundler of bundlers) receipt.results.push(await runBundler(bundler));
  receipt.completedAt = new Date().toISOString();
  writeReceipt();
} catch (error) {
  receipt.failedAt = new Date().toISOString();
  receipt.failure = {
    code: error && typeof error === "object" && "code" in error ? String(error.code) : null,
    message: error instanceof Error ? error.message : String(error),
  };
  writeReceipt();
  throw error;
} finally {
  restoreBenchmarkInputs();
}
