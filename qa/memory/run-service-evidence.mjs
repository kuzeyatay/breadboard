#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SERVICE_EVIDENCE_GATES,
  inventoryEvidenceDefinitions,
  manifestEvidenceDefinitions,
  manifestMandatoryServiceIds,
  publishLatestSuccessfulServiceEvidence,
  readJson,
  serviceEvidenceSourceIdentity,
  sha256File,
  validateServiceEvidenceReceipt,
} from "./service-evidence-contract.mjs";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, "..", "..");
const manifest = readJson(path.join(repoRoot, "desktop", "runtime-v2", "manifests", "services.json"));
const executionInventory = readJson(path.join(repoRoot, "qa", "runtime-v2", "execution-inventory.json"));
const definitions = manifestEvidenceDefinitions(manifest);
const manifestById = new Map(manifest.services.map((service) => [service.id, service]));
const argumentEntries = process.argv.slice(2).map((argument) => {
  const [name, ...rest] = argument.split("=");
  return [name, rest.length === 0 ? "true" : rest.join("=")];
});
const args = new Map(argumentEntries);
if (args.size !== argumentEntries.length) throw new Error("Duplicate service evidence argument.");
const allowedArguments = new Set(["--help", "--suite", "--executable"]);
for (const name of args.keys()) {
  if (!allowedArguments.has(name)) throw new Error(`Unknown service evidence argument ${name}.`);
}

if (args.has("--help")) {
  console.log(
    "Usage: node qa/memory/run-service-evidence.mjs " +
    "--suite=smoke|burn|cancel|restart|all --executable=<absolute Breadboard.exe>",
  );
  process.exit(0);
}

const suite = args.get("--suite") ?? "all";
const suiteProfiles = Object.freeze({
  smoke: { requestIterations: 4, requestWindowMs: 2_000, steadyMs: 2_000, sampleIntervalMs: 500 },
  burn: { requestIterations: 120, requestWindowMs: 15_000, steadyMs: 15_000, sampleIntervalMs: 500 },
  cancel: { requestIterations: 8, requestWindowMs: 2_000, steadyMs: 2_000, sampleIntervalMs: 250 },
  restart: { requestIterations: 8, requestWindowMs: 2_000, steadyMs: 2_000, sampleIntervalMs: 250 },
  all: { requestIterations: 30, requestWindowMs: 5_000, steadyMs: 5_000, sampleIntervalMs: 250 },
});
if (!Object.hasOwn(suiteProfiles, suite)) throw new Error(`Unknown evidence suite ${suite}.`);
if (process.platform !== "win32") {
  throw new Error("Packaged service evidence requires Windows commit and private-byte counters.");
}

const executable = path.resolve(
  args.get("--executable") ?? process.env.BREADBOARD_QA_PACKAGED_EXE ?? "",
);
if (!path.isAbsolute(executable) || path.extname(executable).toLowerCase() !== ".exe") {
  throw new Error("--executable must name an absolute packaged Breadboard .exe.");
}
if (!fs.statSync(executable, { throwIfNoEntry: false })?.isFile()) {
  throw new Error(`Packaged Breadboard executable does not exist: ${executable}`);
}
const executableIdentity = Object.freeze({
  path: executable,
  bytes: fs.statSync(executable).size,
  sha256: sha256File(executable),
});
const sourceIdentity = serviceEvidenceSourceIdentity(repoRoot);

const profile = suiteProfiles[suite];
const token = randomBytes(32).toString("hex");
const runId = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${process.pid}`;
const resultRoot = path.join(repoRoot, ".qa-results", "runtime-v2-services", runId);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-service-evidence-"));
const userData = path.join(temporaryRoot, "user-data");
const endpointReceiptPath = path.join(userData, "Data", "runtime", "endpoints.json");
const receiptPath = path.join(resultRoot, "receipt.json");
fs.mkdirSync(userData, { recursive: true, mode: 0o700 });
fs.mkdirSync(resultRoot, { recursive: true, mode: 0o700 });

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function strictInteger(raw, fallback, label, minimum, maximum) {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/u.test(raw)) throw new Error(`${label} must be a whole number.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

class WindowsSampler {
  child = null;
  pending = [];
  stdout = "";

  start() {
    if (this.child) return;
    this.child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path.join(qaDir, "windows-sampler.ps1")],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.consume(chunk));
    this.child.stderr.resume();
    this.child.once("exit", () => {
      for (const pending of this.pending.splice(0)) {
        pending.reject(new Error("Windows memory sampler exited."));
      }
      this.child = null;
    });
  }

  consume(chunk) {
    this.stdout += chunk;
    for (;;) {
      const newline = this.stdout.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (!line) continue;
      const pending = this.pending.shift();
      if (!pending) continue;
      try {
        const value = JSON.parse(line);
        if (value.error) throw new Error(value.error);
        pending.resolve(value);
      } catch (error) {
        pending.reject(error);
      }
    }
  }

  sample() {
    this.start();
    return new Promise((resolve, reject) => {
      const pending = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        const index = this.pending.indexOf(pending);
        if (index >= 0) this.pending.splice(index, 1);
        reject(new Error("Windows memory sample timed out."));
      }, 20_000);
      this.pending.push(pending);
      this.child.stdin.write("sample-with-listeners\n");
    });
  }

  stop() {
    this.child?.stdin.end();
    this.child = null;
  }
}

function processMap(sample) {
  return new Map((sample.processes ?? []).map((processInfo) => [processInfo.pid, processInfo]));
}

function descendantIds(rootPid, sample) {
  const ids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const processInfo of sample.processes ?? []) {
      if (!ids.has(processInfo.pid) && ids.has(processInfo.parentPid)) {
        ids.add(processInfo.pid);
        changed = true;
      }
    }
  }
  return ids;
}

function processDescendsFrom(childPid, ancestorPid, sample) {
  const processes = processMap(sample);
  let current = processes.get(childPid);
  const visited = new Set();
  while (current && current.pid !== ancestorPid) {
    if (visited.has(current.pid)) return false;
    visited.add(current.pid);
    current = processes.get(current.parentPid);
  }
  return current?.pid === ancestorPid;
}

function rootForPort(sample, port, runtimePid) {
  const listeners = (sample.listeningPorts ?? []).filter(
    (listener) => listener.port === port && listener.localAddress === "127.0.0.1",
  );
  if (listeners.length !== 1) {
    throw new Error(
      listeners.length === 0
        ? `NO_RUNTIME_LISTENER: port ${port} has no listener.`
        : `AMBIGUOUS_RUNTIME_LISTENER: port ${port} has ${listeners.length} listeners.`,
    );
  }
  const processes = processMap(sample);
  let current = processes.get(listeners[0].ownerPid);
  const visited = new Set();
  while (current && current.parentPid !== runtimePid) {
    if (visited.has(current.pid)) throw new Error("PROCESS_TREE_CYCLE: listener ancestry is cyclic.");
    visited.add(current.pid);
    current = processes.get(current.parentPid);
  }
  if (!current) {
    throw new Error(
      `EXTERNAL_PROCESS_NOT_RUNTIME_OWNED: listener ${listeners[0].ownerPid} is not a Runtime descendant.`,
    );
  }
  return current.pid;
}

function measurementForIds(sample, ids, rootPid = null) {
  const selected = (sample.processes ?? []).filter((processInfo) => ids.has(processInfo.pid));
  const rootPresent = rootPid !== null && selected.some((processInfo) => processInfo.pid === rootPid);
  return {
    sampledAt: sample.sampledAt,
    commitTotalMb: sample.commitTotalMb,
    commitLimitMb: sample.commitLimitMb,
    freeCommitMb: sample.commitLimitMb - sample.commitTotalMb,
    privateBytes: selected.reduce((total, processInfo) => total + processInfo.privateBytes, 0),
    workingSetBytes: selected.reduce((total, processInfo) => total + processInfo.workingSetBytes, 0),
    processCount: selected.length,
    descendantCount: Math.max(0, selected.length - (rootPresent ? 1 : 0)),
    ...(rootPid === null ? {} : { rootPid }),
  };
}

function serviceMeasurement(sample, port, runtimePid) {
  const rootPid = rootForPort(sample, port, runtimePid);
  return {
    measurement: measurementForIds(sample, descendantIds(rootPid, sample), rootPid),
    rootPid,
    treeIds: descendantIds(rootPid, sample),
  };
}

function peakServiceMeasurement(samples, port, runtimePid) {
  const candidates = [];
  const reasons = [];
  for (const sample of samples) {
    try {
      candidates.push(serviceMeasurement(sample, port, runtimePid));
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (candidates.length === 0) {
    throw new Error(reasons.at(-1) ?? "NO_SERVICE_MEASUREMENT: no attributable process sample.");
  }
  return candidates.reduce((peak, candidate) =>
    candidate.measurement.privateBytes > peak.measurement.privateBytes ? candidate : peak,
  );
}

function packagedProfile(service) {
  return service.launchProfiles?.find((candidate) => candidate.modes?.includes("packaged")) ?? null;
}

function estimateFor(service) {
  const launchProfile = packagedProfile(service);
  const estimate = launchProfile?.resourceLimits?.estimatedColdStartCommitMb;
  if (!Number.isSafeInteger(estimate) || estimate <= 0) {
    throw new Error("PACKAGED_PROFILE_UNAVAILABLE: no packaged cold-start estimate exists.");
  }
  return estimate;
}

function statusFor(payload, serviceId) {
  const matches = Array.isArray(payload?.services)
    ? payload.services.filter((service) => service?.id === serviceId)
    : [];
  if (matches.length !== 1 || typeof matches[0].state !== "string") {
    throw new Error(`${serviceId}: diagnostic status is missing or duplicated.`);
  }
  return matches[0];
}

function readinessUrl(baseUrl, service) {
  return new URL(service.readiness.path, `${baseUrl}/`).href;
}

function isReadyState(state) {
  return state === "ready" || state === "healthy" || state === "busy";
}

function isStoppedState(state) {
  return state === "available-but-stopped" || state === "stopped";
}

function failureReason(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 1_024) || "UNKNOWN_SERVICE_EVIDENCE_FAILURE";
}

const sampler = new WindowsSampler();
const abortController = new AbortController();
let app = null;
let runtimePid = null;
let dashboardBaseUrl = null;
let minimumStartedAt = 0;
let interrupted = false;

process.once("SIGINT", () => {
  interrupted = true;
  abortController.abort();
});
process.once("SIGTERM", () => {
  interrupted = true;
  abortController.abort();
});

async function sampleWindow(operation) {
  const samples = [];
  let sampling = true;
  let samplingError = null;
  const loop = (async () => {
    while (sampling) {
      try {
        samples.push(await sampler.sample());
      } catch (error) {
        samplingError = error;
        sampling = false;
        break;
      }
      if (sampling) await delay(profile.sampleIntervalMs);
    }
  })();
  let value;
  try {
    value = await operation();
  } finally {
    sampling = false;
    await loop;
    if (samplingError) throw samplingError;
    samples.push(await sampler.sample());
  }
  return { value, samples };
}

function appEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("BREADBOARD_QA_")) delete environment[name];
  }
  delete environment.ELECTRON_RUN_AS_NODE;
  environment.BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN = token;
  return environment;
}

async function launchApp() {
  minimumStartedAt = Date.now();
  app = spawn(executable, [`--breadboard-user-data-dir=${userData}`], {
    env: appEnvironment(),
    stdio: "ignore",
    windowsHide: true,
  });
  if (!Number.isSafeInteger(app.pid) || app.pid <= 0) throw new Error("Packaged app returned no PID.");
  const launchPid = app.pid;
  let launchFailure = null;
  app.once("error", (error) => {
    launchFailure = failureReason(error);
  });
  app.once("exit", (code, signal) => {
    launchFailure = `Packaged app exited before evidence readiness (${code ?? signal ?? "unknown"}).`;
  });
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    if (interrupted) throw new Error("QA run interrupted.");
    if (launchFailure) throw new Error(launchFailure);
    if (Date.now() >= deadline) throw new Error("Packaged Runtime endpoint receipt timed out.");
    try {
      const receipt = readJson(endpointReceiptPath);
      const startedAt = Date.parse(receipt.startedAt);
      if (
        Number.isSafeInteger(receipt.pid) &&
        receipt.pid > 0 &&
        Number.isFinite(startedAt) &&
        startedAt >= minimumStartedAt - 2_000 &&
        typeof receipt.urls?.dashboard === "string"
      ) {
        runtimePid = receipt.pid;
        dashboardBaseUrl = new URL(receipt.urls.dashboard).origin;
        const ownershipSample = await sampler.sample();
        if (!processDescendsFrom(runtimePid, launchPid, ownershipSample)) {
          throw new Error("Runtime endpoint receipt PID is not owned by the isolated packaged launch.");
        }
        const status = await evidenceRequest("GET");
        validateDiagnosticStatus(status);
        return { launchPid, runtimePid, status };
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (
          error.message === "Runtime endpoint receipt PID is not owned by the isolated packaged launch." ||
          /(?:HTTP_40[14]|UNAUTHORIZED|invalid schema|drifted from services\.json|omitted a trusted service endpoint)/u.test(
            error.message,
          )
        )
      ) {
        throw error;
      }
      // The receipt is atomic but may not exist yet; bounded polling continues.
    }
    await delay(500);
  }
}

async function evidenceRequest(method, body = null, timeoutMs = 5 * 60_000) {
  if (!dashboardBaseUrl) throw new Error("Packaged Dashboard endpoint is unavailable.");
  const response = await fetch(`${dashboardBaseUrl}/api/internal/runtime-service-evidence`, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(body === null ? {} : { "content-type": "application/json" }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(timeoutMs)]),
  });
  const value = await boundedResponseText(response, 256 * 1024)
    .then((text) => JSON.parse(text))
    .catch(() => null);
  if (!response.ok || value?.ok !== true) {
    const code = typeof value?.code === "string" ? value.code : `HTTP_${response.status}`;
    const detail = [
      code,
      Number.isFinite(value?.requiredHeadroomMb) ? `required=${value.requiredHeadroomMb}MB` : null,
      Number.isFinite(value?.availableHeadroomMb) ? `available=${value.availableHeadroomMb}MB` : null,
    ].filter(Boolean).join(" ");
    throw new Error(detail);
  }
  return value;
}

function validateDiagnosticStatus(status) {
  if (status?.schemaVersion !== 1 || status.packaged !== true) {
    throw new Error("Packaged service evidence route returned an invalid schema.");
  }
  if (JSON.stringify(status.definitions) !== JSON.stringify(definitions)) {
    throw new Error("Packaged service evidence route drifted from services.json.");
  }
  const endpointIds = status.endpoints && typeof status.endpoints === "object"
    ? Object.keys(status.endpoints)
    : [];
  if (
    endpointIds.length !== definitions.length ||
    definitions.some(({ id }) => typeof status.endpoints[id] !== "string")
  ) {
    throw new Error("Packaged service evidence route omitted a trusted service endpoint.");
  }
  if (!definitions.some(({ id }) => id === "gbrain")) {
    throw new Error("GBrain is absent from the mandatory packaged service set.");
  }
}

async function serviceStatus(serviceId) {
  const payload = await evidenceRequest("GET", null, 10_000);
  validateDiagnosticStatus(payload);
  return { payload, snapshot: statusFor(payload, serviceId) };
}

async function waitForState(service, predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    const status = await serviceStatus(service.id);
    latest = status.snapshot;
    if (predicate(latest.state)) return status;
    if (latest.state === "installation-unavailable" || latest.state === "resource-blocked" || latest.state === "failed") {
      throw new Error(`${latest.state.toUpperCase()}: ${service.id} cannot reach ${label}.`);
    }
    await delay(service.readiness.pollIntervalMs);
  }
  throw new Error(`STATE_TIMEOUT: ${service.id} did not reach ${label}; last state ${latest?.state ?? "unknown"}.`);
}

async function boundedResponseText(response, maximumBytes = 64 * 1024) {
  if (!response.body) throw new Error("READINESS_EMPTY_BODY: service returned no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("readiness response exceeded its evidence bound");
        throw new Error(
          `READINESS_BODY_TOO_LARGE: response exceeded ${Math.ceil(maximumBytes / 1024)} KiB.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function probeReadiness(service, baseUrl) {
  const response = await fetch(readinessUrl(baseUrl, service), {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.any([
      abortController.signal,
      AbortSignal.timeout(service.readiness.requestTimeoutMs),
    ]),
  });
  const text = await boundedResponseText(response);
  if (!response.ok) throw new Error(`READINESS_HTTP_${response.status}: ${service.id} request failed.`);
  if (service.readiness.expectedBodyContains !== null && !text.includes(service.readiness.expectedBodyContains)) {
    throw new Error(`READINESS_BODY_MISMATCH: ${service.id} response omitted its manifest marker.`);
  }
}

async function activate(serviceId) {
  const result = await evidenceRequest("POST", { action: "acquire", serviceId });
  if (result.serviceId !== serviceId || result.action !== "acquire" || result.acquired !== true) {
    throw new Error(`${serviceId}: activation response escaped its service binding.`);
  }
  return result;
}

async function deactivate(serviceId) {
  const result = await evidenceRequest("POST", { action: "release", serviceId });
  if (result.serviceId !== serviceId || result.action !== "release" || result.released !== true) {
    throw new Error(`${serviceId}: cancellation did not release its exact evidence authority.`);
  }
  const status = await serviceStatus(serviceId);
  if (status.payload.heldServiceIds?.includes(serviceId)) {
    throw new Error(`${serviceId}: released evidence authority remains held.`);
  }
  return result;
}

async function requestPeak(service, baseUrl) {
  const deadline = Date.now() + profile.requestWindowMs;
  let index = 0;
  while (index < profile.requestIterations || Date.now() < deadline) {
    await probeReadiness(service, baseUrl);
    index += 1;
    await delay(25);
  }
}

function reserveMb(sample) {
  const fallback = Math.min(12_288, Math.max(1_536, Math.round(sample.commitLimitMb * 0.2)));
  return strictInteger(
    process.env.BREADBOARD_MIN_FREE_COMMIT_MB,
    fallback,
    "BREADBOARD_MIN_FREE_COMMIT_MB",
    1_024,
    32_768,
  );
}

async function assertServiceHeadroom(service) {
  const sample = await sampler.sample();
  const estimateMb = estimateFor(service);
  const reserve = reserveMb(sample);
  const free = sample.commitLimitMb - sample.commitTotalMb;
  if (free < reserve + estimateMb) {
    throw new Error(
      `BREADBOARD_RESOURCE_EXHAUSTED: ${service.id} needs ${reserve}MB reserve + ` +
      `${estimateMb}MB cold-start estimate; ${Math.round(free)}MB is free.`,
    );
  }
  return sample;
}

function fillFailure(gates, reason) {
  for (const gate of SERVICE_EVIDENCE_GATES) {
    if (!gates.has(gate)) gates.set(gate, { gate, status: "fail", reason });
  }
}

function pass(gates, gate, measurement, detail = undefined) {
  gates.set(gate, { gate, status: "pass", measurement, ...(detail ? { detail } : {}) });
}

function fail(gates, gate, error) {
  gates.set(gate, { gate, status: "fail", reason: failureReason(error) });
}

async function waitForTreeExit(service, treeIds) {
  const timeoutMs = (service.idleTtlMs ?? 0) + service.gracefulShutdownMs + 30_000;
  await waitForState(service, isStoppedState, "stopped", Math.max(30_000, timeoutMs));
  const deadline = Date.now() + Math.max(30_000, service.gracefulShutdownMs + 15_000);
  while (Date.now() < deadline) {
    const sample = await sampler.sample();
    const measurement = measurementForIds(sample, treeIds);
    if (measurement.processCount === 0) return measurement;
    await delay(500);
  }
  throw new Error(`${service.id}: prior Runtime-owned process tree survived shutdown.`);
}

async function exerciseOnDemandService(service, definition, initialStatus) {
  const gates = new Map();
  let firstTree = null;
  let finalState = initialStatus.state;
  let activated = false;
  const port = Number(new URL((await serviceStatus(service.id)).payload.endpoints[service.id]).port);
  try {
    await assertServiceHeadroom(service);
    const cold = await sampleWindow(() => activate(service.id));
    activated = true;
    await waitForState(service, isReadyState, "ready", service.readiness.startupTimeoutMs + 15_000);
    const coldPeak = peakServiceMeasurement(cold.samples, port, runtimePid);
    firstTree = coldPeak;
    if (isStoppedState(initialStatus.state)) {
      pass(gates, "cold-start", coldPeak.measurement);
    } else {
      fail(
        gates,
        "cold-start",
        new Error(`${service.id}: initial state ${initialStatus.state} was not an isolated cold state.`),
      );
    }

    const startup = serviceMeasurement(await sampler.sample(), port, runtimePid);
    firstTree = startup;
    pass(gates, "startup-ready", startup.measurement);

    try {
      const steady = await sampleWindow(() => delay(profile.steadyMs));
      pass(gates, "steady", peakServiceMeasurement(steady.samples, port, runtimePid).measurement);
    } catch (error) {
      fail(gates, "steady", error);
    }

    try {
      const baseUrl = (await serviceStatus(service.id)).payload.endpoints[service.id];
      const requests = await sampleWindow(() => requestPeak(service, baseUrl));
      pass(gates, "request-peak", peakServiceMeasurement(requests.samples, port, runtimePid).measurement);
    } catch (error) {
      fail(gates, "request-peak", error);
    }

    try {
      const descendants = serviceMeasurement(await sampler.sample(), port, runtimePid);
      firstTree = descendants;
      pass(gates, "descendants", descendants.measurement);
    } catch (error) {
      fail(gates, "descendants", error);
    }

    try {
      const cancelled = await sampleWindow(() => deactivate(service.id));
      activated = false;
      pass(gates, "cancel", peakServiceMeasurement(cancelled.samples, port, runtimePid).measurement);
    } catch (error) {
      fail(gates, "cancel", error);
      await deactivate(service.id).then(() => {
        activated = false;
      }).catch(() => undefined);
    }

    if (!firstTree) throw new Error(`${service.id}: no Runtime-owned process tree was attributable.`);
    await waitForTreeExit(service, firstTree.treeIds);

    try {
      await assertServiceHeadroom(service);
      const restarted = await sampleWindow(() => activate(service.id));
      activated = true;
      await waitForState(service, isReadyState, "ready after restart", service.readiness.startupTimeoutMs + 15_000);
      const restartPeak = peakServiceMeasurement(restarted.samples, port, runtimePid);
      if (restartPeak.rootPid === firstTree.rootPid) {
        throw new Error(`${service.id}: restart reused the prior process root.`);
      }
      pass(gates, "restart", restartPeak.measurement);
      firstTree = restartPeak;
    } catch (error) {
      fail(gates, "restart", error);
      await deactivate(service.id).then(() => {
        activated = false;
      }).catch(() => undefined);
    }

    if (activated) {
      await deactivate(service.id);
      activated = false;
    }
    if (firstTree) {
      try {
        const shutdown = await waitForTreeExit(service, firstTree.treeIds);
        pass(gates, "shutdown", shutdown);
        await delay(Math.max(2_000, service.readiness.pollIntervalMs * 2));
        const idle = measurementForIds(await sampler.sample(), firstTree.treeIds);
        if (idle.processCount !== 0) throw new Error(`${service.id}: process tree returned after idle shutdown.`);
        pass(gates, "post-idle", idle);
      } catch (error) {
        fail(gates, "shutdown", error);
        fail(gates, "post-idle", error);
      }
    }
    finalState = (await serviceStatus(service.id)).snapshot.state;
  } catch (error) {
    const reason = failureReason(error);
    await deactivate(service.id).then(() => {
      activated = false;
    }).catch(() => undefined);
    fillFailure(gates, reason);
    finalState = await serviceStatus(service.id).then(({ snapshot }) => snapshot.state).catch(() => "failed");
  }
  return {
    serviceId: service.id,
    policy: definition.policy,
    initialState: initialStatus.state,
    finalState,
    gates,
    firstTree,
  };
}

async function exerciseEagerService(service, definition, initialStatus, coldSamples) {
  const gates = new Map();
  let firstTree = null;
  const port = Number(new URL((await serviceStatus(service.id)).payload.endpoints[service.id]).port);
  try {
    await waitForState(service, isReadyState, "ready", service.readiness.startupTimeoutMs + 15_000);
    const cold = peakServiceMeasurement(coldSamples, port, runtimePid);
    firstTree = cold;
    pass(gates, "cold-start", cold.measurement, "Captured from the isolated packaged cold generation.");
    const startup = serviceMeasurement(await sampler.sample(), port, runtimePid);
    firstTree = startup;
    pass(gates, "startup-ready", startup.measurement);
    const steady = await sampleWindow(() => delay(profile.steadyMs));
    pass(gates, "steady", peakServiceMeasurement(steady.samples, port, runtimePid).measurement);
    const baseUrl = (await serviceStatus(service.id)).payload.endpoints[service.id];
    const requests = await sampleWindow(() => requestPeak(service, baseUrl));
    pass(gates, "request-peak", peakServiceMeasurement(requests.samples, port, runtimePid).measurement);
    const descendants = serviceMeasurement(await sampler.sample(), port, runtimePid);
    firstTree = descendants;
    pass(gates, "descendants", descendants.measurement);
    await activate(service.id);
    const cancelled = await sampleWindow(() => deactivate(service.id));
    pass(gates, "cancel", peakServiceMeasurement(cancelled.samples, port, runtimePid).measurement);
  } catch (error) {
    fillFailure(gates, failureReason(error));
  }
  return {
    serviceId: service.id,
    policy: definition.policy,
    initialState: initialStatus.state,
    finalState: initialStatus.state,
    gates,
    firstTree,
    port,
  };
}

function descendantsAreGone(sample, treeIds) {
  const live = new Set((sample.processes ?? []).map(({ pid }) => pid));
  return [...treeIds].every((pid) => !live.has(pid));
}

async function closeOwnedApp() {
  if (!app?.pid) return;
  const exactPid = app.pid;
  const exactRuntimePid = runtimePid;
  if (!Number.isSafeInteger(exactPid) || exactPid <= 0) throw new Error("Invalid owned app PID.");
  app.kill();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const sample = await sampler.sample();
    if (!(sample.processes ?? []).some(({ pid }) => pid === exactPid || pid === runtimePid)) {
      app = null;
      return;
    }
    await delay(500);
  }
  spawnSync("taskkill.exe", ["/F", "/T", "/PID", String(exactPid)], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (Number.isSafeInteger(exactRuntimePid) && exactRuntimePid > 0) {
    spawnSync("taskkill.exe", ["/F", "/T", "/PID", String(exactRuntimePid)], {
      windowsHide: true,
      encoding: "utf8",
    });
  }
  await delay(1_000);
  const finalSample = await sampler.sample();
  if ((finalSample.processes ?? []).some(({ pid }) => pid === exactPid || pid === exactRuntimePid)) {
    throw new Error("Exact packaged app or Runtime PID survived forced cleanup.");
  }
  app = null;
}

async function completeEagerLifecycle(eagerResults) {
  if (eagerResults.length === 0) return;
  const oldRuntimePid = runtimePid;
  await closeOwnedApp();
  const shutdownSample = await sampler.sample();
  for (const result of eagerResults) {
    if (!result.firstTree) continue;
    const measurement = measurementForIds(shutdownSample, result.firstTree.treeIds);
    if (measurement.processCount === 0) pass(result.gates, "shutdown", measurement);
    else fail(result.gates, "shutdown", new Error(`${result.serviceId}: tree survived packaged shutdown.`));
  }
  await delay(2_000);
  const idleSample = await sampler.sample();
  for (const result of eagerResults) {
    if (!result.firstTree) continue;
    const measurement = measurementForIds(idleSample, result.firstTree.treeIds);
    if (measurement.processCount === 0) pass(result.gates, "post-idle", measurement);
    else fail(result.gates, "post-idle", new Error(`${result.serviceId}: tree survived packaged post-idle.`));
  }

  const restartLaunch = await sampleWindow(() => launchApp());
  if (runtimePid === oldRuntimePid) throw new Error("Packaged restart reused the prior Runtime PID.");
  for (const result of eagerResults) {
    const service = manifestById.get(result.serviceId);
    try {
      await waitForState(service, isReadyState, "ready after packaged restart", service.readiness.startupTimeoutMs + 15_000);
      const restarted = peakServiceMeasurement(restartLaunch.samples, result.port, runtimePid);
      if (result.firstTree && restarted.rootPid === result.firstTree.rootPid) {
        throw new Error(`${result.serviceId}: packaged restart reused the prior service root.`);
      }
      pass(result.gates, "restart", restarted.measurement);
      result.restartTree = restarted;
      result.finalState = "ready";
    } catch (error) {
      fail(result.gates, "restart", error);
    }
  }

  await closeOwnedApp();
  await delay(2_000);
  const finalSample = await sampler.sample();
  for (const result of eagerResults) {
    result.finalState = "stopped";
    if (result.restartTree && !descendantsAreGone(finalSample, result.restartTree.treeIds)) {
      fail(result.gates, "post-idle", new Error(`${result.serviceId}: restarted tree survived final shutdown.`));
    }
  }
}

const startedAt = new Date().toISOString();
const results = [];
let outcome = "FAIL";
let appCleanupFailure = null;

try {
  sampler.start();
  const initial = await sampler.sample();
  const initialFreeCommitMb = initial.commitLimitMb - initial.commitTotalMb;
  const requiredCoreEstimateMb = manifest.services
    .filter((service) => service.startupPolicy === "eager")
    .reduce((total, service) => total + estimateFor(service), 0);
  const reserve = reserveMb(initial);
  if (initialFreeCommitMb < reserve + requiredCoreEstimateMb) {
    throw new Error(
      `BREADBOARD_RESOURCE_EXHAUSTED: packaged core start needs ${reserve}MB reserve + ` +
      `${requiredCoreEstimateMb}MB estimates; ${Math.round(initialFreeCommitMb)}MB is free.`,
    );
  }

  const coldLaunch = await sampleWindow(() => launchApp());
  for (const definition of definitions) {
    if (interrupted) throw new Error("QA run interrupted.");
    const service = manifestById.get(definition.id);
    const initialStatus = (await serviceStatus(service.id)).snapshot;
    console.log(`[service-evidence] ${service.id}: ${service.startupPolicy}`);
    const result = service.startupPolicy === "eager"
      ? await exerciseEagerService(service, definition, initialStatus, coldLaunch.samples)
      : await exerciseOnDemandService(service, definition, initialStatus);
    results.push(result);
  }
  await completeEagerLifecycle(results.filter((result) => manifestById.get(result.serviceId).startupPolicy === "eager"));
  outcome = results.every((result) =>
    SERVICE_EVIDENCE_GATES.every((gate) => result.gates.get(gate)?.status === "pass"),
  ) ? "PASS" : "FAIL";
} catch (error) {
  console.error(`[service-evidence] ${failureReason(error)}`);
  const completed = new Set(results.map(({ serviceId }) => serviceId));
  for (const definition of definitions) {
    if (completed.has(definition.id)) continue;
    const reason = `RUN_ABORTED: ${failureReason(error)}`;
    results.push({
      serviceId: definition.id,
      policy: definition.policy,
      initialState: "failed",
      finalState: "failed",
      gates: new Map(SERVICE_EVIDENCE_GATES.map((gate) => [gate, { gate, status: "fail", reason }])),
    });
  }
} finally {
  await closeOwnedApp().catch((error) => {
    appCleanupFailure = failureReason(error);
  });
  sampler.stop();
}

const receipt = {
  schemaVersion: 1,
  runId,
  runtimeMode: "packaged",
  suite,
  startedAt,
  finishedAt: new Date().toISOString(),
  outcome,
  executable: executableIdentity,
  sourceIdentity,
  mandatoryServiceIds: manifestMandatoryServiceIds(manifest),
  ownershipCoverage: inventoryEvidenceDefinitions(executionInventory, manifest),
  services: definitions.map((definition) => {
    const result = results.find(({ serviceId }) => serviceId === definition.id);
    return {
      serviceId: definition.id,
      policy: definition.policy,
      initialState: result?.initialState ?? "failed",
      finalState: result?.finalState ?? "failed",
      gates: SERVICE_EVIDENCE_GATES.map((gate) =>
        result?.gates.get(gate) ?? {
          gate,
          status: "fail",
          reason: "MISSING_GATE_RESULT: runner produced no disposition.",
        },
      ),
    };
  }),
};
const finalExecutableIdentity = {
  path: executable,
  bytes: fs.statSync(executable, { throwIfNoEntry: false })?.size ?? -1,
  sha256: fs.statSync(executable, { throwIfNoEntry: false })?.isFile()
    ? sha256File(executable)
    : "",
};
const finalSourceIdentity = serviceEvidenceSourceIdentity(repoRoot);
if (
  JSON.stringify(finalExecutableIdentity) !== JSON.stringify(executableIdentity) ||
  JSON.stringify(finalSourceIdentity) !== JSON.stringify(sourceIdentity)
) {
  receipt.outcome = "FAIL";
  receipt.provenanceFailure =
    "The packaged executable or all-service runner sources changed during evidence collection.";
}
const validation = validateServiceEvidenceReceipt(receipt, manifest, executionInventory);
if (!validation.ok) {
  receipt.outcome = "FAIL";
  receipt.validationErrors = validation.errors;
}
if (appCleanupFailure) {
  receipt.outcome = "FAIL";
  receipt.appCleanupFailure = appCleanupFailure;
}
const temporaryParent = path.resolve(os.tmpdir());
const resolvedTemporaryRoot = path.resolve(temporaryRoot);
try {
  if (
    path.dirname(resolvedTemporaryRoot) !== temporaryParent ||
    !path.basename(resolvedTemporaryRoot).startsWith("breadboard-service-evidence-")
  ) {
    throw new Error("Temporary evidence root escaped its fixed OS-temporary boundary.");
  }
  fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
} catch (error) {
  receipt.outcome = "FAIL";
  receipt.cleanupFailure = failureReason(error);
}
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`[service-evidence] receipt: ${receiptPath}`);

if (receipt.outcome === "PASS" && suite === "burn") {
  try {
    const binding = publishLatestSuccessfulServiceEvidence({
      repoRoot,
      receiptPath,
      serviceManifest: manifest,
      executionInventory,
    });
    console.log(`[service-evidence] latest success: ${binding.pointerPath}`);
  } catch (error) {
    receipt.outcome = "FAIL";
    receipt.publicationFailure = failureReason(error);
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    console.error(`[service-evidence] canonical success publication failed: ${receipt.publicationFailure}`);
  }
}

process.exitCode = receipt.outcome === "PASS" ? 0 : 1;
