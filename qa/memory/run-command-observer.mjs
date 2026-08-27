#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const qaDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDirectory, "..", "..");

export const COMMIT_RETURN_TOLERANCE_MB = 512;
export const ABSOLUTE_MIN_FREE_COMMIT_MB = 8_192;
export const DEFAULT_SETTLE_MS = 30_000;
export const DEFAULT_INTERVAL_MS = 1_000;
export const MAX_SAFETY_INTERVAL_MS = 2_000;
export const DEFAULT_MAX_RETAINED_SAMPLES = 4_096;
const MAX_RECEIPT_IDENTITIES = 256;
const MAX_SAMPLE_IDENTITIES = 32;
const MAX_TERMINATION_PAYLOAD_BYTES = 1024 * 1024;

function strictInteger(raw, fallback, label, min, max) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const text = String(raw).trim();
  if (!/^\d+$/u.test(text)) throw new Error(`${label} must be a whole number.`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function onlyValue(values, name) {
  if (values.length > 1) throw new Error(`${name} may be supplied only once.`);
  return values[0];
}

function optionValues(argumentsBeforeSeparator, name) {
  const prefix = `${name}=`;
  return argumentsBeforeSeparator
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length));
}

export function parseObserverArguments(
  argv,
  {
    root = repoRoot,
    workingDirectory = process.cwd(),
    environment = process.env,
    now = Date.now,
    uuid = randomUUID,
  } = {},
) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error("usage: run-command-observer.mjs [observer options] -- executable [arguments]");
  }
  const observerArguments = argv.slice(0, separator);
  const workloadArguments = argv.slice(separator + 1);
  const knownPrefixes = [
    "--output-dir=",
    "--settle-ms=",
    "--interval-ms=",
    "--reserve-mb=",
    "--max-samples=",
    "--candidate-root=",
  ];
  const unknown = observerArguments.find(
    (argument) => !knownPrefixes.some((prefix) => argument.startsWith(prefix)),
  );
  if (unknown) throw new Error("an unknown observer option was supplied.");

  const command = workloadArguments[0];
  if (typeof command !== "string" || command.length === 0 || command.includes("\0")) {
    throw new Error("the observed executable is invalid.");
  }
  if (workloadArguments.slice(1).some((argument) => argument.includes("\0"))) {
    throw new Error("an observed argument is invalid.");
  }

  const settleMs = strictInteger(
    onlyValue(optionValues(observerArguments, "--settle-ms"), "--settle-ms"),
    DEFAULT_SETTLE_MS,
    "settle time",
    0,
    10 * 60_000,
  );
  const intervalMs = strictInteger(
    onlyValue(optionValues(observerArguments, "--interval-ms"), "--interval-ms"),
    DEFAULT_INTERVAL_MS,
    "sample interval",
    100,
    MAX_SAFETY_INTERVAL_MS,
  );
  const maxRetainedSamples = strictInteger(
    onlyValue(optionValues(observerArguments, "--max-samples"), "--max-samples"),
    DEFAULT_MAX_RETAINED_SAMPLES,
    "maximum retained samples",
    2,
    10_000,
  );
  const reserveValue = onlyValue(optionValues(observerArguments, "--reserve-mb"), "--reserve-mb")
    ?? environment.BREADBOARD_MIN_FREE_COMMIT_MB;
  const reserveMb = reserveValue === undefined || String(reserveValue).trim() === ""
    ? null
    : strictInteger(reserveValue, null, "minimum free commit reserve", 1_024, 32_768);
  const outputValue = onlyValue(optionValues(observerArguments, "--output-dir"), "--output-dir");
  const outputDirectory = outputValue
    ? path.resolve(workingDirectory, outputValue)
    : path.join(
        root,
        ".qa-results",
        "command-observer",
        `${now()}-${uuid()}`,
      );
  const configuredCandidateRoots = optionValues(observerArguments, "--candidate-root");
  if (configuredCandidateRoots.some((candidate) => candidate.trim() === "")) {
    throw new Error("candidate roots cannot be empty.");
  }
  const candidateRoots = (configuredCandidateRoots.length > 0
    ? configuredCandidateRoots.map((candidate) => path.resolve(workingDirectory, candidate))
    : [
        path.join(root, "desktop", "node_modules", "electron", "dist"),
        path.join(root, "desktop", "build-resources"),
        path.join(root, "desktop", "resources", "bin"),
      ]).map((candidate, index) => Object.freeze({
        path: path.resolve(candidate),
        label: `candidate-root-${index + 1}`,
      }));

  return Object.freeze({
    command,
    commandArguments: Object.freeze(workloadArguments.slice(1)),
    outputDirectory,
    settleMs,
    intervalMs,
    reserveMb,
    maxRetainedSamples,
    candidateRoots: Object.freeze(candidateRoots),
    workingDirectory,
  });
}

function finiteNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`sampler returned invalid ${label}.`);
  return parsed;
}

function optionalInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function exactCreationTime(value) {
  if (typeof value !== "string" || !/^\d{1,20}$/u.test(value)) return null;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n && parsed <= 18_446_744_073_709_551_615n
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function sanitizedName(value) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 128)
    : "unknown";
}

export function normalizeSample(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("sampler returned an invalid snapshot.");
  }
  const processes = Array.isArray(raw.processes) ? raw.processes.map((processInfo) => ({
    pid: optionalInteger(processInfo?.pid),
    parentPid: optionalInteger(processInfo?.parentPid) ?? 0,
    creationTime: exactCreationTime(processInfo?.creationTime),
    creationTimeUnixMs: optionalInteger(processInfo?.creationTimeUnixMs),
    name: sanitizedName(processInfo?.name),
    executablePath:
      typeof processInfo?.executablePath === "string" ? processInfo.executablePath : null,
    privateBytes: optionalInteger(processInfo?.privateBytes) ?? 0,
    workingSetBytes: optionalInteger(processInfo?.workingSetBytes) ?? 0,
  })).filter((processInfo) => processInfo.pid !== null) : [];
  return Object.freeze({
    sampledAt: finiteNumber(raw.sampledAt, "sample time"),
    commitTotalMb: finiteNumber(raw.commitTotalMb, "commit total"),
    commitLimitMb: finiteNumber(raw.commitLimitMb, "commit limit"),
    processCount: optionalInteger(raw.processCount) ?? processes.length,
    processes: Object.freeze(processes),
  });
}

export function processIdentity(processInfo) {
  const creationTime = exactCreationTime(processInfo?.creationTime);
  if (!Number.isSafeInteger(processInfo?.pid) || creationTime === null) {
    return null;
  }
  return `${processInfo.pid}@${creationTime}`;
}

function pathApi(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

export function pathIsWithin(candidate, root, platform = process.platform) {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  const api = pathApi(platform);
  const candidatePath = api.resolve(candidate);
  const rootPath = api.resolve(root);
  const relation = api.relative(rootPath, candidatePath);
  if (platform === "win32") {
    const lowerRelation = relation.toLowerCase();
    return lowerRelation === "" || (
      !lowerRelation.startsWith(`..${api.sep}`) &&
      lowerRelation !== ".." &&
      !api.isAbsolute(relation)
    );
  }
  return relation === "" || (
    !relation.startsWith(`..${api.sep}`) && relation !== ".." && !api.isAbsolute(relation)
  );
}

export function candidateProcesses(sample, candidateRoots, platform = process.platform) {
  const matches = [];
  for (const processInfo of sample.processes) {
    const rootIndex = candidateRoots.findIndex((root) =>
      pathIsWithin(processInfo.executablePath, root.path, platform));
    if (rootIndex >= 0) matches.push(Object.freeze({ processInfo, rootIndex }));
  }
  return Object.freeze(matches);
}

function safeIdentity(processInfo, rootIndex = null) {
  return Object.freeze({
    pid: processInfo.pid,
    creationTime: processInfo.creationTime,
    name: sanitizedName(processInfo.name),
    ...(rootIndex === null ? {} : { candidateRoot: `candidate-root-${rootIndex + 1}` }),
  });
}

export class ExactProcessTracker {
  constructor({
    rootPid,
    rootIdentity = null,
    rootCreationTime = null,
    candidateRoots,
    platform = process.platform,
  }) {
    this.rootPid = rootPid;
    this.candidateRoots = candidateRoots;
    this.platform = platform;
    this.rootIdentity = rootIdentity;
    this.rootCreationTime = exactCreationTime(rootCreationTime);
    this.rootIdentityObserved = false;
    this.captured = new Map();
  }

  #capture(processInfo, sampledAt, reason) {
    const key = processIdentity(processInfo);
    if (!key) return;
    const existing = this.captured.get(key);
    if (existing) {
      existing.lastSeenAt = sampledAt;
      existing.name = sanitizedName(processInfo.name);
      existing.reasons.add(reason);
      return;
    }
    this.captured.set(key, {
      pid: processInfo.pid,
      creationTime: processInfo.creationTime,
      creationTimeUnixMs: processInfo.creationTimeUnixMs,
      name: sanitizedName(processInfo.name),
      firstSeenAt: sampledAt,
      lastSeenAt: sampledAt,
      reasons: new Set([reason]),
    });
  }

  observe(sample) {
    const byPid = new Map(sample.processes.map((processInfo) => [processInfo.pid, processInfo]));
    const discovered = new Set();
    for (const processInfo of sample.processes) {
      const key = processIdentity(processInfo);
      if (key && this.captured.has(key)) discovered.add(key);
    }

    if (this.rootIdentity !== null) {
      const currentRoot = byPid.get(this.rootPid);
      if (processIdentity(currentRoot) === this.rootIdentity) {
        this.rootIdentityObserved = true;
        discovered.add(this.rootIdentity);
      }
    }

    const matches = candidateProcesses(sample, this.candidateRoots, this.platform);

    let changed = true;
    while (changed) {
      changed = false;
      for (const processInfo of sample.processes) {
        const key = processIdentity(processInfo);
        if (!key || discovered.has(key)) continue;
        const currentParent = byPid.get(processInfo.parentPid);
        const currentParentIdentity = processIdentity(currentParent);
        if (currentParentIdentity && discovered.has(currentParentIdentity)) {
          discovered.add(key);
          changed = true;
          continue;
        }
      }
    }

    for (const processInfo of sample.processes) {
      const key = processIdentity(processInfo);
      if (!key || !discovered.has(key)) continue;
      const isCandidate = matches.some((match) => match.processInfo === processInfo);
      this.#capture(processInfo, sample.sampledAt, isCandidate ? "candidate" : "descendant");
    }

    const liveCaptured = sample.processes.filter((processInfo) => {
      const key = processIdentity(processInfo);
      return key !== null && this.captured.has(key);
    });
    return Object.freeze({
      liveCaptured: Object.freeze(liveCaptured),
      candidates: matches,
    });
  }

  survivors(sample) {
    return Object.freeze(sample.processes.filter((processInfo) => {
      const key = processIdentity(processInfo);
      return key !== null && this.captured.has(key);
    }));
  }

  identities() {
    return Object.freeze([...this.captured.values()].map((identity) => Object.freeze({
      pid: identity.pid,
      creationTime: identity.creationTime,
      name: identity.name,
    })));
  }

  terminationIdentities() {
    const identities = new Map();
    if (
      this.rootCreationTime !== null &&
      this.rootIdentity === processIdentity({
        pid: this.rootPid,
        creationTime: this.rootCreationTime,
      })
    ) {
      identities.set(this.rootIdentity, Object.freeze({
        pid: this.rootPid,
        creationTime: this.rootCreationTime,
      }));
    }
    for (const identity of this.identities()) {
      identities.set(processIdentity(identity), identity);
    }
    return Object.freeze([...identities.values()]);
  }
}

export class BoundedSampleRecords {
  constructor(maximum) {
    this.maximum = maximum;
    this.records = [];
    this.total = 0;
    this.dropped = 0;
  }

  add(record) {
    this.total += 1;
    if (this.records.length < this.maximum) {
      this.records.push(record);
      return;
    }
    this.records.splice(1, 1);
    this.records.push(record);
    this.dropped += 1;
  }
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function sampleRecord(
  sequence,
  phase,
  sample,
  observation,
  capturedCount,
  effectiveReserveMb,
) {
  const live = observation.liveCaptured;
  const freeCommitMb = sample.commitLimitMb - sample.commitTotalMb;
  return Object.freeze({
    sequence,
    phase,
    sampledAt: sample.sampledAt,
    commitTotalMb: sample.commitTotalMb,
    commitLimitMb: sample.commitLimitMb,
    freeCommitMb,
    effectiveReserveMb,
    reserveMarginMb: freeCommitMb - effectiveReserveMb,
    systemProcessCount: sample.processCount,
    capturedIdentityCount: capturedCount,
    liveCapturedProcessCount: live.length,
    liveCapturedPrivateBytes: sum(live.map((processInfo) => processInfo.privateBytes)),
    liveCapturedWorkingSetBytes: sum(live.map((processInfo) => processInfo.workingSetBytes)),
    candidateProcessCount: observation.candidates.length,
    liveCapturedIdentities: live.slice(0, MAX_SAMPLE_IDENTITIES).map((processInfo) =>
      safeIdentity(processInfo)),
    liveCapturedIdentitiesTruncated: live.length > MAX_SAMPLE_IDENTITIES,
  });
}

export function reserveFor(commitLimitMb, explicitReserveMb) {
  const configuredOrDerived = explicitReserveMb !== null
    ? explicitReserveMb
    : Math.min(12_288, Math.max(1_536, Math.round(commitLimitMb * 0.2)));
  return Math.max(ABSOLUTE_MIN_FREE_COMMIT_MB, configuredOrDerived);
}

export function evaluateFinalGates({
  workloadExit,
  rootIdentityObserved,
  survivors,
  finalCandidates,
  preFreeCommitMb,
  minimumReserveMarginMb,
  postFreeCommitMb,
  postReserveMb,
}) {
  const gates = Object.freeze({
    workloadExitedSuccessfully:
      workloadExit?.spawnError !== true && workloadExit?.code === 0 && workloadExit?.signal === null,
    rootIdentityObserved,
    capturedIdentitiesExited: survivors.length === 0,
    candidateRootsClear: finalCandidates.length === 0,
    commitReturnedWithinTolerance:
      postFreeCommitMb >= preFreeCommitMb - COMMIT_RETURN_TOLERANCE_MB,
    minimumReservePreserved: minimumReserveMarginMb > 0,
    reservePreserved: postFreeCommitMb > postReserveMb,
  });
  const errors = [];
  if (!gates.workloadExitedSuccessfully) errors.push("the observed workload did not exit successfully.");
  if (!gates.rootIdentityObserved) errors.push("the workload root identity was not observed.");
  if (!gates.capturedIdentitiesExited) {
    errors.push(`${survivors.length} captured process identity or identities survived the settle window.`);
  }
  if (!gates.candidateRootsClear) {
    errors.push(`${finalCandidates.length} executable-path candidate or candidates survived the settle window.`);
  }
  if (!gates.commitReturnedWithinTolerance) {
    errors.push("free commit did not return to within 512 MiB of the pre-run sample.");
  }
  if (!gates.minimumReservePreserved) {
    errors.push("free commit reached or fell below the mandatory reserve during observation.");
  }
  if (!gates.reservePreserved) {
    errors.push("post-run free commit is at or below the mandatory reserve.");
  }
  return Object.freeze({ gates, errors: Object.freeze(errors) });
}

function receiptPaths(outputDirectory) {
  return Object.freeze({
    samples: path.join(outputDirectory, "samples.ndjson"),
    summary: path.join(outputDirectory, "summary.json"),
  });
}

function prepareReceiptDirectory(outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const receipts = receiptPaths(outputDirectory);
  for (const candidate of Object.values(receipts)) {
    if (fs.existsSync(candidate)) throw new Error("the observer refuses to overwrite an existing receipt.");
  }
  return receipts;
}

function writeReceipts(receipts, records, summary) {
  const ndjson = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(receipts.samples, ndjson.length > 0 ? `${ndjson}\n` : "", {
    encoding: "utf8",
    flag: "wx",
  });
  fs.writeFileSync(receipts.summary, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function normalizedTerminationIdentities(identities) {
  if (!Array.isArray(identities)) return Object.freeze([]);
  const unique = new Map();
  for (const identity of identities) {
    const pid = optionalInteger(identity?.pid);
    const creationTime = exactCreationTime(identity?.creationTime);
    if (pid === null || pid === 0 || creationTime === null) continue;
    unique.set(`${pid}@${creationTime}`, Object.freeze({ pid, creationTime }));
  }
  return Object.freeze([...unique.values()]);
}

function exactTerminationPayload(identities) {
  const payload = JSON.stringify(normalizedTerminationIdentities(identities));
  if (Buffer.byteLength(payload, "utf8") > MAX_TERMINATION_PAYLOAD_BYTES) {
    throw new Error("the exact-identity termination request is oversized.");
  }
  return payload;
}

function validateTerminationResult(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    raw.status !== "complete" ||
    optionalInteger(raw.survivingCount) !== 0 ||
    raw.postTerminationStableScan !== true
  ) {
    throw new Error("exact-identity process-tree termination did not complete.");
  }
  return Object.freeze({
    status: "complete",
    requestedCount: optionalInteger(raw.requestedCount) ?? 0,
    matchedCount: optionalInteger(raw.matchedCount) ?? 0,
    terminatedCount: optionalInteger(raw.terminatedCount) ?? 0,
    survivingCount: 0,
    ownedProcessCount: optionalInteger(raw.ownedProcessCount) ?? 0,
    discoveryRoundCount: optionalInteger(raw.discoveryRoundCount) ?? 0,
    postTerminationStableScan: true,
  });
}

async function runExactTerminationHelper(
  identities,
  { spawnImplementation = spawn } = {},
) {
  const normalized = normalizedTerminationIdentities(identities);
  if (normalized.length === 0) {
    return Object.freeze({
      status: "complete",
      requestedCount: 0,
      matchedCount: 0,
      terminatedCount: 0,
      survivingCount: 0,
      ownedProcessCount: 0,
      discoveryRoundCount: 0,
      postTerminationStableScan: true,
    });
  }
  const payload = exactTerminationPayload(normalized);
  return await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImplementation(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-File",
          path.join(qaDirectory, "windows-command-observer-sampler.ps1"),
          "-Mode",
          "terminate-exact-trees",
        ],
        { stdio: ["pipe", "pipe", "ignore"], shell: false, windowsHide: true },
      );
    } catch {
      reject(new Error("the exact-identity termination helper could not start."));
      return;
    }
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      fail("the exact-identity termination helper timed out.");
    }, 20_000);
    const fail = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(message));
    };
    child.stdout?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 64 * 1024) {
        stdout = "";
        try { child.kill(); } catch {}
        fail("the exact-identity termination helper returned oversized output.");
      }
    });
    child.stdin?.once?.("error", () => {
      try { child.kill(); } catch {}
      fail("the exact-identity termination helper input failed.");
    });
    child.once("error", () => {
      fail("the exact-identity termination helper failed.");
    });
    child.once("exit", (code) => {
      if (settled) return;
      const line = stdout.split(/\r?\n/u).map((value) => value.trim()).findLast(Boolean);
      if (code !== 0 || !line) {
        fail("the exact-identity termination helper did not complete.");
        return;
      }
      try {
        const result = validateTerminationResult(JSON.parse(line));
        settled = true;
        clearTimeout(timer);
        resolve(result);
      } catch {
        fail("the exact-identity termination helper returned an invalid result.");
      }
    });
    try {
      child.stdin.end(`${payload}\n`);
    } catch {
      try { child.kill(); } catch {}
      fail("the exact-identity termination helper input failed.");
    }
  });
}

export class WindowsCommandObserverSampler {
  constructor({ spawnImplementation = spawn } = {}) {
    if (process.platform !== "win32") {
      throw new Error("the command observer requires Windows GetPerformanceInfo.");
    }
    this.pending = [];
    this.stdout = "";
    this.closed = false;
    this.exited = false;
    this.exitPromise = new Promise((resolve) => { this.resolveExit = resolve; });
    this.child = spawnImplementation(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        path.join(qaDirectory, "windows-command-observer-sampler.ps1"),
      ],
      { stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true },
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#consume(chunk));
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.#stop(
      "the Windows sampler input failed.",
      { kill: true },
    ));
    this.child.once("error", () => {
      this.#stop("the Windows sampler stopped before returning a response.");
      this.exited = true;
      this.resolveExit();
    });
    this.child.once("exit", () => {
      this.#stop("the Windows sampler stopped before returning a response.");
      this.exited = true;
      this.resolveExit();
    });
  }

  #stop(message, { kill = false } = {}) {
    this.closed = true;
    for (const pending of this.pending.splice(0)) pending.reject(new Error(message));
    if (kill && !this.exited) {
      try { this.child.kill(); } catch {}
    }
  }

  #consume(chunk) {
    this.stdout += chunk;
    if (this.stdout.length > 8 * 1024 * 1024) {
      this.stdout = "";
      this.#stop("the Windows sampler returned an oversized response.", { kill: true });
      return;
    }
    for (;;) {
      const newline = this.stdout.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (!line) continue;
      const pending = this.pending.shift();
      if (!pending) {
        this.#stop("the Windows sampler returned an unexpected response.", { kill: true });
        return;
      }
      try {
        const parsed = JSON.parse(line);
        if (parsed?.error) throw new Error("the Windows sampler rejected the request.");
        pending.resolve(parsed);
      } catch {
        pending.reject(new Error("the Windows sampler returned an invalid response."));
        this.#stop("the Windows sampler protocol failed.", { kill: true });
        return;
      }
    }
  }

  #request(line) {
    if (this.closed) return Promise.reject(new Error("the Windows sampler is closed."));
    return new Promise((resolve, reject) => {
      const request = { resolve, reject };
      const timer = setTimeout(() => {
        this.#stop("the Windows sampler timed out.", { kill: true });
      }, 20_000);
      request.resolve = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      request.reject = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      this.pending.push(request);
      try {
        this.child.stdin.write(`${line}\n`, (error) => {
          if (error) this.#stop("the Windows sampler input failed.", { kill: true });
        });
      } catch {
        this.#stop("the Windows sampler input failed.", { kill: true });
      }
    });
  }

  sample() {
    return this.#request("sample");
  }

  async identityForPid(pid) {
    const exactPid = optionalInteger(pid);
    if (exactPid === null || exactPid === 0) {
      throw new Error("the Windows sampler received an invalid identity request.");
    }
    const result = await this.#request(`identity ${exactPid}`);
    if (result?.status === "not-found") return null;
    const creationTime = exactCreationTime(result?.creationTime);
    if (result?.status !== "found" || result?.pid !== exactPid || creationTime === null) {
      throw new Error("the Windows sampler returned an invalid process identity.");
    }
    return Object.freeze({ pid: exactPid, creationTime });
  }

  async terminateExactIdentities(identities) {
    const payload = exactTerminationPayload(identities);
    return validateTerminationResult(await this.#request(`terminate ${payload}`));
  }

  async close() {
    if (!this.closed) {
      this.closed = true;
      try { this.child.stdin.end("close\n"); } catch {
        try { this.child.kill(); } catch {}
      }
    }
    if (this.exited) return;
    await Promise.race([
      this.exitPromise,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (!this.exited) {
      try { this.child.kill(); } catch {}
      await Promise.race([
        this.exitPromise,
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
  }
}

export function spawnObservedCommand(
  command,
  commandArguments,
  {
    workingDirectory = process.cwd(),
    spawnImplementation = spawn,
    terminationSpawnImplementation = spawn,
    exactTerminationImplementation = null,
    platform = process.platform,
  } = {},
) {
  const child = spawnImplementation(command, commandArguments, {
    cwd: workingDirectory,
    env: process.env,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  let finished = false;
  const outcome = new Promise((resolve) => {
    const finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(Object.freeze(value));
    };
    child.once("error", () => finish({ code: null, signal: null, spawnError: true }));
    child.once("exit", (code, signal) => finish({
      code: Number.isInteger(code) ? code : null,
      signal: typeof signal === "string" ? signal : null,
      spawnError: false,
    }));
  });
  const pid = optionalInteger(child.pid);
  const terminate = async (capturedIdentities = []) => {
    const identities = normalizedTerminationIdentities(capturedIdentities);
    if (platform !== "win32") {
      if (!finished && pid !== null) child.kill("SIGTERM");
      return Object.freeze({ exactIdentityCount: 0, rootHandleKillAttempted: !finished });
    }

    let rootHandleKillAttempted = false;
    let exactResult = null;
    try {
      if (identities.length > 0) {
        if (exactTerminationImplementation) {
          try {
            exactResult = validateTerminationResult(
              await exactTerminationImplementation(identities),
            );
          } catch {
            exactResult = await runExactTerminationHelper(identities, {
              spawnImplementation: terminationSpawnImplementation,
            });
          }
        } else {
          exactResult = await runExactTerminationHelper(identities, {
            spawnImplementation: terminationSpawnImplementation,
          });
        }
      }
    } finally {
      if (!finished && pid !== null) rootHandleKillAttempted = child.kill();
    }
    return Object.freeze({
      exactIdentityCount: identities.length,
      exactResult,
      rootHandleKillAttempted,
    });
  };
  return Object.freeze({ pid, outcome, terminate });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function observeCommand(
  configuration,
  {
    sampler = null,
    launch = null,
    sleep = delay,
    now = Date.now,
    platform = process.platform,
    signalEmitter = process,
  } = {},
) {
  if (
    !Number.isSafeInteger(configuration?.intervalMs) ||
    configuration.intervalMs < 100 ||
    configuration.intervalMs > MAX_SAFETY_INTERVAL_MS
  ) {
    throw new Error(
      `sample interval must be between 100 and ${MAX_SAFETY_INTERVAL_MS}.`,
    );
  }
  const receipts = prepareReceiptDirectory(configuration.outputDirectory);
  const activeSampler = sampler ?? new WindowsCommandObserverSampler();
  const launchWorkload = launch ?? ((command, commandArguments) =>
    spawnObservedCommand(command, commandArguments, {
      workingDirectory: configuration.workingDirectory,
      exactTerminationImplementation:
        typeof activeSampler.terminateExactIdentities === "function"
          ? (identities) => activeSampler.terminateExactIdentities(identities)
          : null,
    }));
  const retained = new BoundedSampleRecords(configuration.maxRetainedSamples);
  const startedAt = now();
  let sequence = 0;
  let minimumFreeCommitMb = Number.POSITIVE_INFINITY;
  let tracker = null;
  let workload = null;
  let workloadExit = null;
  let initial = null;
  let finalSample = null;
  let lastObservedSample = null;
  let initialReserveMb = null;
  let maximumObservedReserveMb = 0;
  let minimumReserveMarginMb = Number.POSITIVE_INFINITY;
  let reserveBreach = null;
  let interruptedSignal = null;
  let launchAttempted = false;
  let baselineErrors = [];
  let summary;

  const cleanupState = {
    attempts: 0,
    successfulAttempts: 0,
    failedAttempts: 0,
    reasons: new Set(),
    verification: {
      attempted: false,
      authoritative: false,
      verifiedClear: false,
      sampleCount: 0,
      survivingCapturedIdentityCount: null,
      candidateCount: null,
    },
  };
  const cleanupSummary = () => Object.freeze({
    attempts: cleanupState.attempts,
    successfulAttempts: cleanupState.successfulAttempts,
    failedAttempts: cleanupState.failedAttempts,
    reasons: Object.freeze([...cleanupState.reasons]),
    verification: Object.freeze({ ...cleanupState.verification }),
  });
  const terminateTrackedWorkload = async (reason) => {
    if (!workload || typeof workload.terminate !== "function") return false;
    cleanupState.attempts += 1;
    cleanupState.reasons.add(reason);
    try {
      await workload.terminate(tracker?.terminationIdentities() ?? Object.freeze([]));
      cleanupState.successfulAttempts += 1;
      return true;
    } catch {
      cleanupState.failedAttempts += 1;
      return false;
    }
  };

  let resolveInterruption;
  const interruptionPromise = new Promise((resolve) => { resolveInterruption = resolve; });
  let signalCleanupPromise = Promise.resolve(false);
  const handleInterruption = (signal) => {
    if (interruptedSignal !== null) return;
    interruptedSignal = signal;
    resolveInterruption(signal);
    signalCleanupPromise = tracker === null
      ? Promise.resolve(false)
      : terminateTrackedWorkload(`observer-${signal.toLowerCase()}`);
  };
  const signalHandlers = Object.freeze([
    Object.freeze({ signal: "SIGINT", handler: () => handleInterruption("SIGINT") }),
    Object.freeze({ signal: "SIGTERM", handler: () => handleInterruption("SIGTERM") }),
  ]);
  for (const { signal, handler } of signalHandlers) signalEmitter.on?.(signal, handler);

  const takeSample = async (phase, enforceReserve = false) => {
    const sample = normalizeSample(await activeSampler.sample());
    lastObservedSample = sample;
    const freeCommitMb = sample.commitLimitMb - sample.commitTotalMb;
    const effectiveReserveMb = reserveFor(sample.commitLimitMb, configuration.reserveMb);
    maximumObservedReserveMb = Math.max(maximumObservedReserveMb, effectiveReserveMb);
    minimumReserveMarginMb = Math.min(
      minimumReserveMarginMb,
      freeCommitMb - effectiveReserveMb,
    );
    minimumFreeCommitMb = Math.min(
      minimumFreeCommitMb,
      freeCommitMb,
    );
    const observation = tracker
      ? tracker.observe(sample)
      : Object.freeze({ liveCaptured: Object.freeze([]), candidates: candidateProcesses(
          sample,
          configuration.candidateRoots,
          platform,
        ) });
    retained.add(sampleRecord(
      sequence,
      phase,
      sample,
      observation,
      tracker?.captured.size ?? 0,
      effectiveReserveMb,
    ));
    sequence += 1;
    if (
      enforceReserve &&
      freeCommitMb <= effectiveReserveMb &&
      reserveBreach === null
    ) {
      reserveBreach = Object.freeze({
        phase,
        sampledAt: sample.sampledAt,
        freeCommitMb,
        effectiveReserveMb,
      });
      await terminateTrackedWorkload("reserve-breach");
    }
    return Object.freeze({ sample, observation });
  };

  const verifyTrackedCleanup = async (reason) => {
    cleanupState.verification.attempted = true;
    let latest = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const observed = await takeSample("cleanup", false);
      latest = observed.sample;
      const surviving = tracker?.survivors(observed.sample) ?? Object.freeze([]);
      const candidates = candidateProcesses(
        observed.sample,
        configuration.candidateRoots,
        platform,
      );
      cleanupState.verification.authoritative = true;
      cleanupState.verification.sampleCount += 1;
      cleanupState.verification.survivingCapturedIdentityCount = surviving.length;
      cleanupState.verification.candidateCount = candidates.length;
      if (surviving.length === 0 && candidates.length === 0) {
        cleanupState.verification.verifiedClear = true;
        return latest;
      }
      if (attempt === 0) await terminateTrackedWorkload(`${reason}-retry`);
    }
    return latest;
  };

  try {
    const baseline = await takeSample("baseline", false);
    initial = baseline.sample;
    const launchReserveMb = reserveFor(initial.commitLimitMb, configuration.reserveMb);
    initialReserveMb = launchReserveMb;
    const launchFreeCommitMb = initial.commitLimitMb - initial.commitTotalMb;
    const launchCandidates = baseline.observation.candidates;
    baselineErrors = [];
    if (launchCandidates.length > 0) {
      baselineErrors.push(
        `${launchCandidates.length} executable-path candidate or candidates existed before launch.`,
      );
    }
    if (launchFreeCommitMb <= launchReserveMb) {
      baselineErrors.push("pre-run free commit is at or below the mandatory reserve.");
    }

    if (baselineErrors.length === 0 && interruptedSignal === null) {
      launchAttempted = true;
      workload = launchWorkload(configuration.command, configuration.commandArguments);
      if (!workload || !Number.isSafeInteger(workload.pid) || !workload.outcome) {
        workloadExit = Object.freeze({ code: null, signal: null, spawnError: true });
      } else {
        let outcomeSettled = false;
        const outcomePromise = Promise.resolve(workload.outcome).then((outcome) => {
          outcomeSettled = true;
          workloadExit = Object.freeze({
            code: Number.isInteger(outcome?.code) ? outcome.code : null,
            signal: typeof outcome?.signal === "string" ? outcome.signal : null,
            spawnError: outcome?.spawnError === true,
          });
          return workloadExit;
        });

        if (typeof activeSampler.identityForPid !== "function") {
          await terminateTrackedWorkload("root-binding-unavailable");
          throw new Error("the Windows sampler cannot bind an exact workload root identity.");
        }
        let boundRootIdentity = null;
        let boundRootCreationTime = null;
        const binding = await Promise.race([
          activeSampler.identityForPid(workload.pid).then((identity) => ({
            kind: "identity",
            identity,
          })),
          outcomePromise.then(() => ({ kind: "exit", identity: null })),
        ]);
        if (binding.kind === "identity" && binding.identity !== null) {
          boundRootIdentity = processIdentity(binding.identity);
          boundRootCreationTime = exactCreationTime(binding.identity.creationTime);
        }
        if (binding.kind === "identity" && boundRootIdentity === null && !outcomeSettled) {
          await terminateTrackedWorkload("root-binding-failure");
          throw new Error("the workload root could not be bound to an exact process identity.");
        }
        tracker = new ExactProcessTracker({
          rootPid: workload.pid,
          rootIdentity: boundRootIdentity,
          rootCreationTime: boundRootCreationTime,
          candidateRoots: configuration.candidateRoots,
          platform,
        });

        await takeSample("running", true);
        while (
          !outcomeSettled &&
          reserveBreach === null &&
          interruptedSignal === null
        ) {
          await Promise.race([
            outcomePromise,
            sleep(configuration.intervalMs),
            interruptionPromise,
          ]);
          if (!outcomeSettled && interruptedSignal === null) {
            await takeSample("running", true);
          }
        }
        if (!outcomeSettled && (reserveBreach !== null || interruptedSignal !== null)) {
          await signalCleanupPromise;
          if (interruptedSignal !== null) {
            await terminateTrackedWorkload("observer-signal-retry");
          }
          await Promise.race([outcomePromise, sleep(2_000)]);
        }
        if (outcomeSettled) {
          await outcomePromise;
        } else {
          workloadExit = Object.freeze({ code: null, signal: null, spawnError: false });
        }

        if (reserveBreach === null && interruptedSignal === null) {
          const settleDeadline = now() + configuration.settleMs;
          while (
            now() < settleDeadline &&
            reserveBreach === null &&
            interruptedSignal === null
          ) {
            await Promise.race([
              sleep(Math.min(configuration.intervalMs, Math.max(0, settleDeadline - now()))),
              interruptionPromise,
            ]);
            if (now() < settleDeadline && interruptedSignal === null) {
              await takeSample("settling", true);
            }
          }
        }
        if (reserveBreach === null && interruptedSignal === null) {
          finalSample = (await takeSample("final", true)).sample;
        } else {
          finalSample = lastObservedSample;
        }
      }
    }

    if (!finalSample) finalSample = (await takeSample("final", false)).sample;
    const preFreeCommitMb = initial.commitLimitMb - initial.commitTotalMb;
    const finalCandidates = candidateProcesses(finalSample, configuration.candidateRoots, platform);
    const survivors = tracker?.survivors(finalSample) ?? Object.freeze([]);
    let postSample = finalSample;
    if (
      workload &&
      (
        reserveBreach !== null ||
        interruptedSignal !== null ||
        survivors.length > 0 ||
        finalCandidates.length > 0
      )
    ) {
      await signalCleanupPromise;
      await terminateTrackedWorkload(
        reserveBreach !== null
          ? "reserve-breach-retry"
          : interruptedSignal !== null ? "observer-signal-final" : "final-survivors",
      );
      postSample = await verifyTrackedCleanup(
        reserveBreach !== null
          ? "reserve-breach"
          : interruptedSignal !== null ? "observer-signal" : "final-survivors",
      ) ?? postSample;
    }
    const postFreeCommitMb = postSample.commitLimitMb - postSample.commitTotalMb;
    const postReserveMb = reserveFor(postSample.commitLimitMb, configuration.reserveMb);
    const evaluation = evaluateFinalGates({
      workloadExit,
      rootIdentityObserved: tracker?.rootIdentityObserved === true,
      survivors,
      finalCandidates,
      preFreeCommitMb,
      minimumReserveMarginMb,
      postFreeCommitMb,
      postReserveMb,
    });
    const interruptionErrors = interruptedSignal === null
      ? []
      : [`the observer received ${interruptedSignal} and aborted the workload.`];
    const errors = Object.freeze([
      ...baselineErrors,
      ...interruptionErrors,
      ...evaluation.errors,
    ]);
    const capturedIdentities = tracker?.identities() ?? Object.freeze([]);
    summary = Object.freeze({
      schemaVersion: 1,
      status: reserveBreach !== null || interruptedSignal !== null
        ? "aborted"
        : baselineErrors.length > 0 ? "blocked" : errors.length === 0 ? "passed" : "failed",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(now()).toISOString(),
      metricSource: "GetPerformanceInfo",
      thresholds: Object.freeze({
        settleMs: configuration.settleMs,
        intervalMs: configuration.intervalMs,
        absoluteMinimumFreeCommitMb: ABSOLUTE_MIN_FREE_COMMIT_MB,
        initialReserveMb,
        maximumObservedReserveMb,
        postReserveMb,
        commitReturnToleranceMb: COMMIT_RETURN_TOLERANCE_MB,
      }),
      workload: Object.freeze({
        launchAttempted,
        exit: workloadExit,
      }),
      containment: Object.freeze({
        strategy: "exact-process-handles-plus-graceful-signal-cleanup",
        gracefulSignals: Object.freeze(["SIGINT", "SIGTERM"]),
        killOnObserverProcessExit: false,
        limitation:
          "An ungraceful observer termination is not contained by a Windows kill-on-close Job.",
      }),
      memory: Object.freeze({
        preFreeCommitMb,
        minimumFreeCommitMb,
        minimumReserveMarginMb,
        postFreeCommitMb,
        reserveBreach,
      }),
      sampling: Object.freeze({
        totalSamples: retained.total,
        retainedSamples: retained.records.length,
        droppedSamples: retained.dropped,
        maximumRetainedSamples: retained.maximum,
      }),
      processEvidence: Object.freeze({
        rootPid: workload?.pid ?? null,
        rootIdentityBound: tracker?.rootIdentity !== null,
        rootIdentityObserved: tracker?.rootIdentityObserved === true,
        capturedIdentityCount: capturedIdentities.length,
        capturedIdentities: capturedIdentities.slice(0, MAX_RECEIPT_IDENTITIES),
        capturedIdentitiesTruncated: capturedIdentities.length > MAX_RECEIPT_IDENTITIES,
        survivingCapturedIdentityCount: survivors.length,
        survivingCapturedIdentities: survivors.slice(0, MAX_RECEIPT_IDENTITIES).map((processInfo) =>
          safeIdentity(processInfo)),
        survivingCapturedIdentitiesTruncated: survivors.length > MAX_RECEIPT_IDENTITIES,
        finalCandidateCount: finalCandidates.length,
        finalCandidates: finalCandidates.slice(0, MAX_RECEIPT_IDENTITIES).map(({ processInfo, rootIndex }) =>
          safeIdentity(processInfo, rootIndex)),
        finalCandidatesTruncated: finalCandidates.length > MAX_RECEIPT_IDENTITIES,
      }),
      gates: evaluation.gates,
      cleanup: cleanupSummary(),
      errors,
      receiptFiles: Object.freeze({ samples: "samples.ndjson", summary: "summary.json" }),
    });
  } catch {
    await signalCleanupPromise;
    await terminateTrackedWorkload("observer-failure");
    const finishedAt = now();
    const capturedIdentities = tracker?.identities() ?? Object.freeze([]);
    summary = Object.freeze({
      schemaVersion: 1,
      status: reserveBreach !== null || interruptedSignal !== null ? "aborted" : "failed",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      metricSource: "GetPerformanceInfo",
      containment: Object.freeze({
        strategy: "exact-process-handles-plus-graceful-signal-cleanup",
        gracefulSignals: Object.freeze(["SIGINT", "SIGTERM"]),
        killOnObserverProcessExit: false,
        limitation:
          "An ungraceful observer termination is not contained by a Windows kill-on-close Job.",
      }),
      sampling: Object.freeze({
        totalSamples: retained.total,
        retainedSamples: retained.records.length,
        droppedSamples: retained.dropped,
        maximumRetainedSamples: retained.maximum,
      }),
      processEvidence: Object.freeze({
        rootPid: workload?.pid ?? null,
        rootIdentityBound: tracker?.rootIdentity !== null,
        rootIdentityObserved: tracker?.rootIdentityObserved === true,
        capturedIdentityCount: capturedIdentities.length,
        capturedIdentities: capturedIdentities.slice(0, MAX_RECEIPT_IDENTITIES),
        capturedIdentitiesTruncated: capturedIdentities.length > MAX_RECEIPT_IDENTITIES,
      }),
      cleanup: cleanupSummary(),
      errors: Object.freeze([
        ...(reserveBreach === null
          ? []
          : ["free commit reached or fell below the mandatory reserve; the workload was aborted."]),
        ...(interruptedSignal === null
          ? []
          : [`the observer received ${interruptedSignal} and aborted the workload.`]),
        "the observer could not complete an authoritative sample sequence.",
      ]),
      receiptFiles: Object.freeze({ samples: "samples.ndjson", summary: "summary.json" }),
    });
  } finally {
    try {
      await activeSampler.close?.();
    } finally {
      for (const { signal, handler } of signalHandlers) signalEmitter.off?.(signal, handler);
    }
  }

  writeReceipts(receipts, retained.records, summary);
  return Object.freeze({ summary, receipts });
}

async function main() {
  let configuration;
  try {
    configuration = parseObserverArguments(process.argv.slice(2));
    const result = await observeCommand(configuration);
    const label = result.summary.status === "passed"
      ? "PASS"
      : result.summary.status === "aborted"
        ? "ABORTED"
        : result.summary.status === "blocked" ? "BLOCKED" : "FAIL";
    process.stdout.write(`[command-observer] ${label}; summary: ${result.receipts.summary}\n`);
    if (result.summary.status !== "passed") process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "the observer failed.";
    process.stderr.write(`[command-observer] ${message}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
