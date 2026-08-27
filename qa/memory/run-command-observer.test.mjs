import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ABSOLUTE_MIN_FREE_COMMIT_MB,
  COMMIT_RETURN_TOLERANCE_MB,
  MAX_SAFETY_INTERVAL_MS,
  evaluateFinalGates,
  observeCommand,
  parseObserverArguments,
  pathIsWithin,
  processIdentity,
  reserveFor,
  spawnObservedCommand,
} from "./run-command-observer.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const candidateRoot = "C:\\repo\\desktop\\node_modules\\electron\\dist";

function processInfo({
  pid,
  parentPid,
  creationTime,
  creationTimeUnixMs = 1_000,
  name = "node.exe",
  executablePath = "C:\\Program Files\\nodejs\\node.exe",
  privateBytes = 10_000,
  workingSetBytes = 20_000,
}) {
  return {
    pid,
    parentPid,
    creationTime: String(creationTime),
    creationTimeUnixMs,
    name,
    executablePath,
    privateBytes,
    workingSetBytes,
  };
}

function snapshot({ sampledAt, freeCommitMb, commitLimitMb = 20_000, processes = [] }) {
  return {
    sampledAt,
    commitLimitMb,
    commitTotalMb: commitLimitMb - freeCommitMb,
    processCount: processes.length,
    processes,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

function temporaryOutput(t) {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-command-observer-test-"));
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));
  return outputDirectory;
}

function configuration(t, overrides = {}) {
  return {
    command: "node.exe",
    commandArguments: ["qa/electron/run-qa.mjs", "--token=super-secret-value"],
    outputDirectory: temporaryOutput(t),
    settleMs: 0,
    intervalMs: 100,
    reserveMb: 8_000,
    maxRetainedSamples: 2,
    candidateRoots: [{ path: candidateRoot, label: "candidate-root-1" }],
    workingDirectory: "C:\\repo",
    ...overrides,
  };
}

function fakeSampler(samples, onSample = () => {}) {
  let index = 0;
  return {
    closed: false,
    async sample() {
      assert.ok(index < samples.length, "observer requested an unexpected sample");
      const sample = samples[index];
      index += 1;
      onSample(index);
      return sample;
    },
    async identityForPid(pid) {
      const match = samples
        .flatMap((sample) => sample.processes ?? [])
        .find((processInfo) => processInfo.pid === pid && processInfo.creationTime !== null);
      return {
        pid,
        creationTime: match?.creationTime ?? String(pid * 10_000 + 1),
      };
    },
    close() { this.closed = true; },
  };
}

test("passes exact descendant cleanup, treats PID reuse as a different identity, and bounds receipts", async (t) => {
  const exit = deferred();
  const root = processInfo({ pid: 100, parentPid: 50, creationTime: 1_000 });
  const electron = processInfo({
    pid: 101,
    parentPid: 100,
    creationTime: 1_100,
    name: "electron.exe",
    executablePath: `${candidateRoot}\\electron.exe`,
    privateBytes: 30_000,
    creationTimeUnixMs: 12_345,
  });
  const reusedPid = processInfo({
    pid: 101,
    parentPid: 77,
    creationTime: 9_999,
    name: "unrelated.exe",
    executablePath: "C:\\Windows\\System32\\unrelated.exe",
    creationTimeUnixMs: 12_345,
  });
  const sampler = fakeSampler([
    snapshot({ sampledAt: 1_000, freeCommitMb: 10_000 }),
    snapshot({ sampledAt: 1_100, freeCommitMb: 9_600, processes: [root, electron] }),
    snapshot({ sampledAt: 1_200, freeCommitMb: 9_600, processes: [reusedPid] }),
  ], (count) => {
    if (count === 2) queueMicrotask(() => exit.resolve({ code: 0, signal: null }));
  });

  const result = await observeCommand(configuration(t), {
    sampler,
    launch: () => ({ pid: 100, outcome: exit.promise }),
    sleep: async () => {},
    now: () => 1_500,
    platform: "win32",
  });

  assert.equal(result.summary.status, "passed");
  assert.equal(result.summary.processEvidence.capturedIdentityCount, 2);
  assert.equal(result.summary.processEvidence.survivingCapturedIdentityCount, 0);
  assert.equal(result.summary.processEvidence.finalCandidateCount, 0);
  assert.equal(result.summary.sampling.totalSamples, 3);
  assert.equal(result.summary.sampling.retainedSamples, 2);
  assert.equal(result.summary.sampling.droppedSamples, 1);
  assert.equal(sampler.closed, true);

  const samplesText = fs.readFileSync(result.receipts.samples, "utf8");
  const summaryText = fs.readFileSync(result.receipts.summary, "utf8");
  assert.equal(samplesText.trim().split(/\r?\n/u).length, 2);
  assert.doesNotMatch(samplesText, /super-secret-value/u);
  assert.doesNotMatch(summaryText, /super-secret-value/u);
  assert.doesNotMatch(summaryText, /electron\.exe$/mu, "receipt must not contain raw executable paths");
});

test("fails when an exact captured child and an executable-path candidate survive", async (t) => {
  const exit = deferred();
  let terminatedIdentities = null;
  const root = processInfo({ pid: 200, parentPid: 50, creationTime: 2_000 });
  const electron = processInfo({
    pid: 201,
    parentPid: 200,
    creationTime: 2_100,
    name: "electron.exe",
    executablePath: `${candidateRoot}\\electron.exe`,
  });
  const sampler = fakeSampler([
    snapshot({ sampledAt: 2_000, freeCommitMb: 10_000 }),
    snapshot({ sampledAt: 2_100, freeCommitMb: 9_700, processes: [root, electron] }),
    snapshot({ sampledAt: 2_200, freeCommitMb: 9_700, processes: [electron] }),
    snapshot({ sampledAt: 2_300, freeCommitMb: 9_700, processes: [electron] }),
    snapshot({ sampledAt: 2_400, freeCommitMb: 10_000 }),
  ], (count) => {
    if (count === 2) queueMicrotask(() => exit.resolve({ code: 0, signal: null }));
  });

  const result = await observeCommand(configuration(t), {
    sampler,
    launch: () => ({
      pid: 200,
      outcome: exit.promise,
      async terminate(identities) { terminatedIdentities = identities; },
    }),
    sleep: async () => {},
    now: () => 2_500,
    platform: "win32",
  });

  assert.equal(result.summary.status, "failed");
  assert.equal(result.summary.gates.capturedIdentitiesExited, false);
  assert.equal(result.summary.gates.candidateRootsClear, false);
  assert.equal(result.summary.processEvidence.survivingCapturedIdentityCount, 1);
  assert.equal(result.summary.processEvidence.finalCandidateCount, 1);
  assert.equal(result.summary.cleanup.attempts, 2);
  assert.equal(result.summary.cleanup.verification.verifiedClear, true);
  assert.equal(result.summary.cleanup.verification.sampleCount, 2);
  assert.deepEqual(terminatedIdentities.map(({ pid, creationTime }) => ({ pid, creationTime })), [
    { pid: 200, creationTime: "2000" },
    { pid: 201, creationTime: "2100" },
  ]);
  const receipt = fs.readFileSync(result.receipts.summary, "utf8");
  assert.doesNotMatch(receipt, new RegExp(candidateRoot.replaceAll("\\", "\\\\"), "u"));
});

test("refuses to launch when a candidate executable already exists", async (t) => {
  let launches = 0;
  const existing = processInfo({
    pid: 301,
    parentPid: 1,
    creationTime: 3_000,
    name: "runtime-supervisor.exe",
    executablePath: `${candidateRoot}\\runtime-supervisor.exe`,
  });
  const sampler = fakeSampler([
    snapshot({ sampledAt: 3_000, freeCommitMb: 10_000, processes: [existing] }),
    snapshot({ sampledAt: 3_100, freeCommitMb: 10_000 }),
  ]);

  const result = await observeCommand(configuration(t), {
    sampler,
    launch: () => {
      launches += 1;
      throw new Error("must not launch");
    },
    now: () => 3_500,
    platform: "win32",
  });

  assert.equal(launches, 0);
  assert.equal(result.summary.status, "blocked");
  assert.equal(result.summary.workload.launchAttempted, false);
  assert.match(result.summary.errors.join("\n"), /existed before launch/u);
});

test("blocks before launch when free commit is at the absolute floor", async (t) => {
  let launches = 0;
  const sampler = fakeSampler([
    snapshot({ sampledAt: 3_300, freeCommitMb: ABSOLUTE_MIN_FREE_COMMIT_MB }),
    snapshot({ sampledAt: 3_400, freeCommitMb: ABSOLUTE_MIN_FREE_COMMIT_MB }),
  ]);

  const result = await observeCommand(configuration(t, { reserveMb: 7_000 }), {
    sampler,
    launch: () => {
      launches += 1;
      throw new Error("must not launch");
    },
    now: () => 3_500,
    platform: "win32",
  });

  assert.equal(launches, 0);
  assert.equal(result.summary.status, "blocked");
  assert.equal(result.summary.workload.launchAttempted, false);
  assert.equal(result.summary.gates.minimumReservePreserved, false);
  assert.match(result.summary.errors.join("\n"), /at or below the mandatory reserve/u);
});

test("terminates the owned workload if authoritative sampling fails", async (t) => {
  const exit = deferred();
  let samples = 0;
  let terminations = 0;
  const sampler = {
    async sample() {
      samples += 1;
      if (samples === 1) return snapshot({ sampledAt: 3_500, freeCommitMb: 10_000 });
      throw new Error("synthetic sampler failure");
    },
    async identityForPid(pid) {
      return { pid, creationTime: "3500001" };
    },
    async close() {},
  };
  const result = await observeCommand(configuration(t), {
    sampler,
    launch: () => ({
      pid: 350,
      outcome: exit.promise,
      async terminate() {
        terminations += 1;
        exit.resolve({ code: 1, signal: null });
      },
    }),
    now: () => 3_600,
    platform: "win32",
  });
  assert.equal(terminations, 1);
  assert.equal(result.summary.status, "failed");
  assert.match(result.summary.errors.join("\n"), /authoritative sample sequence/u);
});

test("enforces both the fixed 512 MiB return threshold and the reserve", () => {
  const common = {
    workloadExit: { code: 0, signal: null, spawnError: false },
    rootIdentityObserved: true,
    survivors: [],
    finalCandidates: [],
    preFreeCommitMb: 10_000,
    minimumReserveMarginMb: 1_700,
  };
  const returnFailure = evaluateFinalGates({
    ...common,
    postFreeCommitMb: 10_000 - COMMIT_RETURN_TOLERANCE_MB - 1,
    postReserveMb: 8_000,
  });
  assert.equal(returnFailure.gates.commitReturnedWithinTolerance, false);
  assert.equal(returnFailure.gates.reservePreserved, true);

  const reserveFailure = evaluateFinalGates({
    ...common,
    preFreeCommitMb: 9_400,
    minimumReserveMarginMb: 100,
    postFreeCommitMb: 9_300,
    postReserveMb: 9_500,
  });
  assert.equal(reserveFailure.gates.commitReturnedWithinTolerance, true);
  assert.equal(reserveFailure.gates.reservePreserved, false);
});

test("enforces the absolute 8192 MiB floor and treats equality as unsafe", () => {
  assert.equal(reserveFor(40_221, null), ABSOLUTE_MIN_FREE_COMMIT_MB);
  assert.equal(reserveFor(50_000, null), 10_000);
  assert.equal(reserveFor(40_000, 7_000), ABSOLUTE_MIN_FREE_COMMIT_MB);
  assert.equal(reserveFor(40_000, 9_000), 9_000);

  const equality = evaluateFinalGates({
    workloadExit: { code: 0, signal: null, spawnError: false },
    rootIdentityObserved: true,
    survivors: [],
    finalCandidates: [],
    preFreeCommitMb: 10_000,
    minimumReserveMarginMb: 0,
    postFreeCommitMb: ABSOLUTE_MIN_FREE_COMMIT_MB,
    postReserveMb: ABSOLUTE_MIN_FREE_COMMIT_MB,
  });
  assert.equal(equality.gates.minimumReservePreserved, false);
  assert.equal(equality.gates.reservePreserved, false);
});

test("aborts and terminates immediately when a live sample reaches the reserve", async (t) => {
  const exit = deferred();
  let terminations = 0;
  let terminatedIdentities = null;
  const root = processInfo({ pid: 375, parentPid: 50, creationTime: 3_750 });
  const sampler = fakeSampler([
    snapshot({ sampledAt: 3_700, freeCommitMb: 10_000 }),
    snapshot({
      sampledAt: 3_750,
      freeCommitMb: ABSOLUTE_MIN_FREE_COMMIT_MB,
      processes: [root],
    }),
    snapshot({ sampledAt: 3_800, freeCommitMb: 9_500 }),
  ]);

  const result = await observeCommand(configuration(t, {
    reserveMb: 7_000,
  }), {
    sampler,
    launch: () => ({
      pid: 375,
      outcome: exit.promise,
      async terminate(identities) {
        terminations += 1;
        terminatedIdentities = identities;
        exit.resolve({ code: 1, signal: null });
      },
    }),
    sleep: async () => {},
    now: () => 3_900,
    platform: "win32",
  });

  assert.equal(result.summary.status, "aborted");
  assert.equal(terminations, 2);
  assert.equal(result.summary.gates.minimumReservePreserved, false);
  assert.equal(result.summary.memory.minimumFreeCommitMb, ABSOLUTE_MIN_FREE_COMMIT_MB);
  assert.equal(result.summary.memory.reserveBreach.phase, "running");
  assert.deepEqual(terminatedIdentities.map(({ pid, creationTime }) => ({ pid, creationTime })), [
    { pid: 375, creationTime: "3750" },
  ]);
});

test("retains exact cleanup authority when sampling fails after the root exits", async (t) => {
  const exit = deferred();
  let sampleCount = 0;
  let terminatedIdentities = null;
  const root = processInfo({ pid: 380, parentPid: 50, creationTime: 3_800 });
  const child = processInfo({
    pid: 381,
    parentPid: 380,
    creationTime: 3_810,
    name: "electron.exe",
    executablePath: `${candidateRoot}\\electron.exe`,
  });
  const sampler = {
    async sample() {
      sampleCount += 1;
      if (sampleCount === 1) return snapshot({ sampledAt: 3_790, freeCommitMb: 10_000 });
      if (sampleCount === 2) {
        queueMicrotask(() => exit.resolve({ code: 0, signal: null }));
        return snapshot({ sampledAt: 3_810, freeCommitMb: 9_500, processes: [root, child] });
      }
      throw new Error("synthetic final sampler failure");
    },
    async identityForPid(pid) {
      return { pid, creationTime: root.creationTime };
    },
    async close() {},
  };

  const result = await observeCommand(configuration(t), {
    sampler,
    launch: () => ({
      pid: 380,
      outcome: exit.promise,
      async terminate(identities) { terminatedIdentities = identities; },
    }),
    sleep: async () => {},
    now: () => 3_900,
    platform: "win32",
  });

  assert.equal(result.summary.status, "failed");
  assert.equal(result.summary.cleanup.attempts, 1);
  assert.deepEqual(terminatedIdentities.map(({ pid, creationTime }) => ({ pid, creationTime })), [
    { pid: 380, creationTime: "3800" },
    { pid: 381, creationTime: "3810" },
  ]);
});

test("raises the live reserve when the Windows commit limit expands and aborts immediately", async (t) => {
  const exit = deferred();
  const root = processInfo({ pid: 410, parentPid: 50, creationTime: "410000001" });
  let terminations = 0;
  const sampler = fakeSampler([
    snapshot({
      sampledAt: 4_000,
      commitLimitMb: 40_221,
      freeCommitMb: 10_500,
    }),
    snapshot({
      sampledAt: 4_100,
      commitLimitMb: 50_000,
      freeCommitMb: 9_999,
      processes: [root],
    }),
    snapshot({
      sampledAt: 4_200,
      commitLimitMb: 50_000,
      freeCommitMb: 10_500,
    }),
  ]);

  const result = await observeCommand(configuration(t, { reserveMb: null }), {
    sampler,
    launch: () => ({
      pid: root.pid,
      outcome: exit.promise,
      async terminate() {
        terminations += 1;
        exit.resolve({ code: 1, signal: null });
      },
    }),
    sleep: async () => {},
    now: () => 4_500,
    platform: "win32",
  });

  assert.equal(result.summary.status, "aborted");
  assert.equal(terminations, 2);
  assert.equal(result.summary.thresholds.initialReserveMb, ABSOLUTE_MIN_FREE_COMMIT_MB);
  assert.equal(result.summary.thresholds.maximumObservedReserveMb, 10_000);
  assert.equal(result.summary.memory.reserveBreach.effectiveReserveMb, 10_000);
  assert.equal(result.summary.memory.minimumReserveMarginMb, -1);
  assert.equal(result.summary.cleanup.verification.verifiedClear, true);
});

test("retries a failed reserve-breach termination and authoritatively verifies cleanup", async (t) => {
  const exit = deferred();
  const root = processInfo({ pid: 420, parentPid: 50, creationTime: "420000001" });
  let terminations = 0;
  const sampler = fakeSampler([
    snapshot({ sampledAt: 4_600, freeCommitMb: 10_000 }),
    snapshot({
      sampledAt: 4_700,
      freeCommitMb: ABSOLUTE_MIN_FREE_COMMIT_MB,
      processes: [root],
    }),
    snapshot({ sampledAt: 4_800, freeCommitMb: 10_000 }),
  ]);

  const result = await observeCommand(configuration(t), {
    sampler,
    launch: () => ({
      pid: root.pid,
      outcome: exit.promise,
      async terminate() {
        terminations += 1;
        if (terminations === 1) throw new Error("synthetic cleanup failure");
        exit.resolve({ code: 1, signal: null });
      },
    }),
    sleep: async () => {},
    now: () => 4_900,
    platform: "win32",
  });

  assert.equal(result.summary.status, "aborted");
  assert.equal(terminations, 2);
  assert.equal(result.summary.cleanup.failedAttempts, 1);
  assert.equal(result.summary.cleanup.successfulAttempts, 1);
  assert.equal(result.summary.cleanup.verification.authoritative, true);
  assert.equal(result.summary.cleanup.verification.verifiedClear, true);
});

test("a post-launch candidate outside the exact lineage is evidence but never kill authority", async (t) => {
  const exit = deferred();
  const root = processInfo({ pid: 500, parentPid: 50, creationTime: "500000001" });
  const unrelatedCandidate = processInfo({
    pid: 501,
    parentPid: 77,
    creationTime: "501000001",
    name: "unrelated-candidate.exe",
    executablePath: `${candidateRoot}\\unrelated-candidate.exe`,
  });
  const terminationRequests = [];
  const sampler = fakeSampler([
    snapshot({ sampledAt: 5_000, freeCommitMb: 10_000 }),
    snapshot({ sampledAt: 5_100, freeCommitMb: 9_700, processes: [root] }),
    snapshot({ sampledAt: 5_200, freeCommitMb: 10_000, processes: [unrelatedCandidate] }),
    snapshot({ sampledAt: 5_300, freeCommitMb: 10_000, processes: [unrelatedCandidate] }),
    snapshot({ sampledAt: 5_400, freeCommitMb: 10_000, processes: [unrelatedCandidate] }),
  ], (count) => {
    if (count === 2) queueMicrotask(() => exit.resolve({ code: 0, signal: null }));
  });

  const result = await observeCommand(configuration(t), {
    sampler,
    launch: () => ({
      pid: root.pid,
      outcome: exit.promise,
      async terminate(identities) {
        terminationRequests.push(identities.map(({ pid, creationTime }) => ({ pid, creationTime })));
      },
    }),
    sleep: async () => {},
    now: () => 5_500,
    platform: "win32",
  });

  assert.equal(result.summary.status, "failed");
  assert.equal(result.summary.gates.candidateRootsClear, false);
  assert.equal(result.summary.processEvidence.capturedIdentityCount, 1);
  assert.equal(result.summary.processEvidence.finalCandidateCount, 1);
  assert.equal(result.summary.cleanup.verification.verifiedClear, false);
  assert.equal(terminationRequests.length, 2);
  assert.deepEqual(terminationRequests.flat(), [
    { pid: root.pid, creationTime: root.creationTime },
    { pid: root.pid, creationTime: root.creationTime },
  ]);
  assert.equal(terminationRequests.flat().some(({ pid }) => pid === unrelatedCandidate.pid), false);
});

test("a later orphan sharing only a historical parent PID is not captured", async (t) => {
  const exit = deferred();
  const root = processInfo({ pid: 600, parentPid: 50, creationTime: "600000001" });
  const unprovenOrphan = processInfo({
    pid: 601,
    parentPid: root.pid,
    creationTime: "601000001",
    executablePath: "C:\\Windows\\System32\\unproven.exe",
  });
  const sampler = fakeSampler([
    snapshot({ sampledAt: 6_000, freeCommitMb: 10_000 }),
    snapshot({ sampledAt: 6_100, freeCommitMb: 9_800, processes: [root] }),
    snapshot({ sampledAt: 6_200, freeCommitMb: 10_000, processes: [unprovenOrphan] }),
  ], (count) => {
    if (count === 2) queueMicrotask(() => exit.resolve({ code: 0, signal: null }));
  });

  const result = await observeCommand(configuration(t), {
    sampler,
    launch: () => ({ pid: root.pid, outcome: exit.promise }),
    sleep: async () => {},
    now: () => 6_500,
    platform: "win32",
  });

  assert.equal(result.summary.status, "passed");
  assert.equal(result.summary.processEvidence.capturedIdentityCount, 1);
  assert.equal(result.summary.processEvidence.survivingCapturedIdentityCount, 0);
  assert.equal(
    result.summary.processEvidence.capturedIdentities.some(({ pid }) => pid === unprovenOrphan.pid),
    false,
  );
});

test("the bound root FILETIME must match the sampled root exactly", async (t) => {
  const exit = deferred();
  const sampledRoot = processInfo({ pid: 700, parentPid: 50, creationTime: "700000002" });
  const sampler = fakeSampler([
    snapshot({ sampledAt: 7_000, freeCommitMb: 10_000 }),
    snapshot({ sampledAt: 7_100, freeCommitMb: 9_900, processes: [sampledRoot] }),
    snapshot({ sampledAt: 7_200, freeCommitMb: 10_000 }),
  ], (count) => {
    if (count === 2) queueMicrotask(() => exit.resolve({ code: 0, signal: null }));
  });
  sampler.identityForPid = async (pid) => ({ pid, creationTime: "700000001" });

  const result = await observeCommand(configuration(t), {
    sampler,
    launch: () => ({ pid: sampledRoot.pid, outcome: exit.promise }),
    sleep: async () => {},
    now: () => 7_500,
    platform: "win32",
  });

  assert.equal(result.summary.status, "failed");
  assert.equal(result.summary.gates.rootIdentityObserved, false);
  assert.equal(result.summary.processEvidence.capturedIdentityCount, 0);
});

test("SIGINT aborts, retries exact cleanup, verifies the tree, and removes listeners", async (t) => {
  const exit = deferred();
  const signalEmitter = new EventEmitter();
  const root = processInfo({ pid: 800, parentPid: 50, creationTime: "800000001" });
  const child = processInfo({ pid: 801, parentPid: root.pid, creationTime: "801000001" });
  const terminationRequests = [];
  const sampler = fakeSampler([
    snapshot({ sampledAt: 8_000, freeCommitMb: 10_000 }),
    snapshot({ sampledAt: 8_100, freeCommitMb: 9_800, processes: [root, child] }),
    snapshot({ sampledAt: 8_200, freeCommitMb: 10_000 }),
  ], (count) => {
    if (count === 2) signalEmitter.emit("SIGINT");
  });

  const result = await observeCommand(configuration(t), {
    sampler,
    launch: () => ({
      pid: root.pid,
      outcome: exit.promise,
      async terminate(identities) {
        terminationRequests.push(identities.map(({ pid, creationTime }) => ({ pid, creationTime })));
        exit.resolve({ code: 1, signal: "SIGTERM" });
      },
    }),
    sleep: async () => {},
    now: () => 8_500,
    platform: "win32",
    signalEmitter,
  });

  assert.equal(result.summary.status, "aborted");
  assert.match(result.summary.errors.join("\n"), /SIGINT/u);
  assert.equal(result.summary.cleanup.verification.verifiedClear, true);
  assert.equal(result.summary.containment.killOnObserverProcessExit, false);
  assert.ok(terminationRequests.length >= 2);
  assert.deepEqual(terminationRequests[0], [
    { pid: root.pid, creationTime: root.creationTime },
  ]);
  assert.deepEqual(terminationRequests.at(-1), [
    { pid: root.pid, creationTime: root.creationTime },
    { pid: child.pid, creationTime: child.creationTime },
  ]);
  assert.equal(signalEmitter.listenerCount("SIGINT"), 0);
  assert.equal(signalEmitter.listenerCount("SIGTERM"), 0);
});

test("a signal during root binding waits for exact authority before cleanup", async (t) => {
  const exit = deferred();
  const binding = deferred();
  const signalEmitter = new EventEmitter();
  const root = processInfo({ pid: 850, parentPid: 50, creationTime: "850000001" });
  const terminationRequests = [];
  const sampler = fakeSampler([
    snapshot({ sampledAt: 8_500, freeCommitMb: 10_000 }),
    snapshot({ sampledAt: 8_600, freeCommitMb: 9_900, processes: [root] }),
    snapshot({ sampledAt: 8_700, freeCommitMb: 10_000 }),
  ]);
  sampler.identityForPid = () => binding.promise;

  const result = await observeCommand(configuration(t), {
    sampler,
    launch: () => {
      queueMicrotask(() => {
        signalEmitter.emit("SIGTERM");
        queueMicrotask(() => binding.resolve({
          pid: root.pid,
          creationTime: root.creationTime,
        }));
      });
      return {
        pid: root.pid,
        outcome: exit.promise,
        async terminate(identities) {
          terminationRequests.push(identities.map(({ pid, creationTime }) => ({
            pid,
            creationTime,
          })));
          exit.resolve({ code: 1, signal: "SIGTERM" });
        },
      };
    },
    sleep: async () => {},
    now: () => 8_900,
    platform: "win32",
    signalEmitter,
  });

  assert.equal(result.summary.status, "aborted");
  assert.ok(terminationRequests.length >= 2);
  assert.deepEqual(terminationRequests[0], [
    { pid: root.pid, creationTime: root.creationTime },
  ]);
  assert.equal(terminationRequests.some((identities) => identities.length === 0), false);
  assert.equal(result.summary.cleanup.verification.verifiedClear, true);
});

test("FILETIME identity keys are canonical raw UInt64 strings", () => {
  assert.equal(processIdentity({ pid: 900, creationTime: "000123" }), "900@123");
  assert.equal(processIdentity({ pid: 900, creationTime: "123" }), "900@123");
  assert.equal(processIdentity({
    pid: 900,
    creationTime: "18446744073709551616",
  }), null);
});

test("rejects a safety sampling cadence above two seconds", () => {
  assert.throws(() => parseObserverArguments([
    `--interval-ms=${MAX_SAFETY_INTERVAL_MS + 1}`,
    "--",
    "node.exe",
  ]), /sample interval/u);
});

test("parses observer options before the delimiter and preserves workload arguments exactly", () => {
  const parsed = parseObserverArguments([
    "--settle-ms=0",
    "--interval-ms=100",
    "--reserve-mb=9000",
    "--max-samples=10",
    "--candidate-root=C:\\repo\\candidate",
    "--",
    "node.exe",
    "script.mjs",
    "--value=a b&c",
    "--token=do-not-log",
  ], {
    root: "C:\\repo",
    workingDirectory: "C:\\repo",
    environment: {},
    now: () => 1,
    uuid: () => "receipt",
  });
  assert.equal(parsed.command, "node.exe");
  assert.deepEqual(parsed.commandArguments, [
    "script.mjs",
    "--value=a b&c",
    "--token=do-not-log",
  ]);
  assert.equal(parsed.settleMs, 0);
  assert.equal(parsed.reserveMb, 9_000);
  assert.throws(() => parseObserverArguments([
    `--interval-ms=${MAX_SAFETY_INTERVAL_MS + 1}`,
    "--",
    "node.exe",
  ]), /sample interval/u);
  assert.throws(() => parseObserverArguments([
    "--interval-ms=60000",
    "--",
    "node.exe",
  ]), /sample interval/u);
  assert.throws(() => parseObserverArguments(["node.exe"]), /usage/u);
});

test("spawns the exact executable and argument vector with shell interpolation disabled", async () => {
  const child = new EventEmitter();
  child.pid = 444;
  let invocation;
  const observed = spawnObservedCommand("tool.exe", ["a b", "&", "--token=secret"], {
    workingDirectory: "C:\\repo",
    spawnImplementation(command, arguments_, options) {
      invocation = { command, arguments_, options };
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    },
  });
  assert.equal(observed.pid, 444);
  assert.deepEqual(invocation.arguments_, ["a b", "&", "--token=secret"]);
  assert.equal(invocation.command, "tool.exe");
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.stdio, "inherit");
  assert.deepEqual(await observed.outcome, { code: 0, signal: null, spawnError: false });
});

test("opens the exact tree before using the retained root handle as fallback", async () => {
  const child = new EventEmitter();
  child.pid = 444;
  const ordering = [];
  child.kill = () => {
    ordering.push("root-handle-fallback");
    queueMicrotask(() => child.emit("exit", 1, "SIGTERM"));
    return true;
  };
  const observed = spawnObservedCommand("tool.exe", [], {
    workingDirectory: "C:\\repo",
    platform: "win32",
    spawnImplementation() { return child; },
    async exactTerminationImplementation(identities) {
      ordering.push("exact-tree-helper");
      assert.deepEqual(identities, [{ pid: 444, creationTime: "444000001" }]);
      return {
        status: "complete",
        requestedCount: 1,
        matchedCount: 1,
        terminatedCount: 1,
        survivingCount: 0,
        ownedProcessCount: 1,
        discoveryRoundCount: 2,
        postTerminationStableScan: true,
      };
    },
  });

  const result = await observed.terminate([{ pid: 444, creationTime: "444000001" }]);
  assert.deepEqual(ordering, ["exact-tree-helper", "root-handle-fallback"]);
  assert.equal(result.rootHandleKillAttempted, true);
  await observed.outcome;
});

test("terminates captured identities exactly even after the workload root has exited", async () => {
  const child = new EventEmitter();
  child.pid = 444;
  const helperInvocations = [];
  let helperInput = "";
  const observed = spawnObservedCommand("tool.exe", [], {
    workingDirectory: "C:\\repo",
    platform: "win32",
    spawnImplementation() {
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    },
    terminationSpawnImplementation(command, arguments_, options) {
      helperInvocations.push({ command, arguments_, options });
      const helper = new EventEmitter();
      helper.stdout = new EventEmitter();
      helper.stdout.setEncoding = () => {};
      helper.stdin = new EventEmitter();
      helper.stdin.end = (value) => {
        helperInput += value;
        queueMicrotask(() => {
          helper.stdout.emit("data", JSON.stringify({
            status: "complete",
            requestedCount: 1,
            matchedCount: 1,
            terminatedCount: 1,
            survivingCount: 0,
            ownedProcessCount: 1,
            discoveryRoundCount: 2,
            postTerminationStableScan: true,
          }));
          helper.emit("exit", 0, null);
        });
      };
      helper.kill = () => {};
      return helper;
    },
  });

  await observed.outcome;
  const result = await observed.terminate([{ pid: 445, creationTime: "4450" }]);
  assert.equal(helperInvocations.length, 1);
  assert.equal(helperInvocations[0].command, "powershell.exe");
  assert.equal(helperInvocations[0].arguments_.includes("terminate-exact-trees"), true);
  assert.equal(helperInvocations[0].options.shell, false);
  assert.equal(result.rootHandleKillAttempted, false);
  assert.deepEqual(JSON.parse(helperInput), [{ pid: 445, creationTime: "4450" }]);
});

test("uses Windows case-insensitive root containment without accepting sibling prefixes", () => {
  assert.equal(pathIsWithin(
    "c:\\REPO\\desktop\\node_modules\\electron\\dist\\electron.exe",
    candidateRoot,
    "win32",
  ), true);
  assert.equal(pathIsWithin(
    "C:\\repo\\desktop\\node_modules\\electron\\dist-evil\\electron.exe",
    candidateRoot,
    "win32",
  ), false);
});

test("the Windows sampler requests no command lines or environment data", () => {
  const source = fs.readFileSync(
    path.join(testDirectory, "windows-command-observer-sampler.ps1"),
    "utf8",
  );
  assert.match(source, /GetPerformanceInfo/u);
  assert.match(source, /TryGetCreationFileTime/u);
  assert.match(source, /TryGetParentProcessId/u);
  assert.match(source, /Get-BreadboardExactProcessSnapshot/u);
  assert.match(source, /TerminateProcess\(\$entry\.handle/u);
  assert.doesNotMatch(source, /CommandLine/u);
  assert.doesNotMatch(source, /EnvironmentVariables|Win32_Environment/u);
  assert.doesNotMatch(source, /taskkill/u);
});
