#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, "..", "..");
const samplesPath = path.join(qaDir, "latest-samples.ndjson");
const summaryPath = path.join(qaDir, "latest-summary.json");
const reportPath = path.join(qaDir, "MEMORY_QA_REPORT.md");
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.split("=");
  return [key, rest.join("=") || "true"];
}));
const mode = args.get("--mode") ?? "smoke";
if (!new Set(["smoke", "burn-in"]).has(mode)) throw new Error(`Unknown memory QA mode ${mode}`);

function strictInteger(raw, fallback, key, min, max) {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be a whole number.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be between ${min} and ${max}.`);
  }
  return value;
}

class Sampler {
  constructor() {
    this.child = null;
    this.pending = [];
    this.stdout = "";
  }

  start() {
    if (process.platform !== "win32") return;
    this.child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
      path.join(qaDir, "windows-sampler.ps1"),
    ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.consume(chunk));
    this.child.stderr.resume();
    this.child.once("exit", () => {
      for (const pending of this.pending.splice(0)) pending.reject(new Error("memory sampler exited"));
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
        const parsed = JSON.parse(line);
        if (parsed.error) throw new Error(parsed.error);
        pending.resolve(parsed);
      } catch (error) {
        pending.reject(error);
      }
    }
  }

  async sample() {
    if (process.platform !== "win32") {
      const total = os.totalmem() / 1048576;
      const available = os.freemem() / 1048576;
      return {
        sampledAt: Date.now(), commitTotalMb: total - available, commitLimitMb: total,
        physicalTotalMb: total, physicalAvailableMb: available,
        processCount: 0, processes: [], metricSource: "portable-physical-fallback",
      };
    }
    if (!this.child) this.start();
    return new Promise((resolve, reject) => {
      const pending = {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      };
      const timer = setTimeout(() => {
        const index = this.pending.indexOf(pending);
        if (index >= 0) this.pending.splice(index, 1);
        reject(new Error("memory sample timed out"));
      }, 20_000);
      this.pending.push(pending);
      this.child.stdin.write("sample\n");
    });
  }

  stop() {
    this.child?.stdin.end();
    this.child = null;
  }
}

function descendants(rootPid, processes) {
  if (!rootPid) return new Set();
  const result = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const processInfo of processes) {
      if (!result.has(processInfo.pid) && result.has(processInfo.parentPid)) {
        result.add(processInfo.pid);
        changed = true;
      }
    }
  }
  return result;
}

function totalsFor(ids, processes) {
  const selected = processes.filter((processInfo) => ids.has(processInfo.pid));
  return {
    processCount: selected.length,
    privateBytes: selected.reduce((sum, processInfo) => sum + processInfo.privateBytes, 0),
    workingSetBytes: selected.reduce((sum, processInfo) => sum + processInfo.workingSetBytes, 0),
  };
}

async function supervisorStatus() {
  const raw = process.env.BREADBOARD_MEMORY_CONTROL_URL?.trim();
  const token = process.env.BREADBOARD_MEMORY_CONTROL_TOKEN?.trim();
  if (!raw || !token) return null;
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) return null;
  try {
    const response = await fetch(`${url.origin}/v1/status`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function writeReport(summary) {
  const outcome = summary.aborted ? "ABORTED SAFELY" : summary.workloadExitCode === 0 || mode === "smoke" ? "COMPLETED" : "FAILED";
  const report = `# Breadboard Memory QA Report

- Mode: ${mode}
- Workload project: ${summary.workloadProject ?? "sampler-only"}
- Outcome: ${outcome}
- Metric source: ${summary.metricSource}
- Samples: ${summary.sampleCount}
- Initial free commit: ${Math.round(summary.initialFreeCommitMb)} MB
- Minimum free commit: ${Math.round(summary.minimumFreeCommitMb)} MB
- Peak system commit: ${Math.round(summary.peakCommitTotalMb)} MB
- Peak QA-owned private bytes: ${Math.round(summary.peakOwnedPrivateBytes / 1048576)} MB
- Final QA-owned private bytes: ${Math.round(summary.finalOwnedPrivateBytes / 1048576)} MB
- Reserve: ${Math.round(summary.minimumReserveMb)} MB
- Workload exit code: ${summary.workloadExitCode ?? "not launched"}
${summary.reason ? `- Reason: ${summary.reason}\n` : ""}
Raw evidence is in \`latest-samples.ndjson\`; the machine-readable rollup is
in \`latest-summary.json\`. A safe abort is not a memory pass.
`;
  fs.writeFileSync(reportPath, report, "utf8");
}

const sampler = new Sampler();
sampler.start();
fs.writeFileSync(samplesPath, "", "utf8");
let workload = null;
let interrupted = false;
let workloadExitCode = null;
process.on("SIGINT", () => { interrupted = true; });
const intervalMs = strictInteger(
  args.get("--interval-ms") ?? process.env.BREADBOARD_MEMORY_SAMPLE_INTERVAL_MS,
  5_000, "sample interval", 1_000, 300_000,
);
const durationMs = strictInteger(
  args.get("--duration-ms"), mode === "smoke" ? 20_000 : 30 * 60_000,
  "duration", 5_000, 6 * 60 * 60_000,
);

try {
  const initial = await sampler.sample();
  const defaultReserve = Math.min(12_288, Math.max(1_536, Math.round(initial.commitLimitMb * 0.2)));
  const minimumReserveMb = strictInteger(
    process.env.BREADBOARD_MIN_FREE_COMMIT_MB, defaultReserve,
    "BREADBOARD_MIN_FREE_COMMIT_MB", 1_024, 32_768,
  );
  const coldStartEstimateMb = mode === "burn-in" ? strictInteger(
    process.env.BREADBOARD_MEMORY_QA_COLD_START_MB, 6_144,
    "BREADBOARD_MEMORY_QA_COLD_START_MB", 512, 16_384,
  ) : 0;
  const workloadProject = process.env.BREADBOARD_MEMORY_QA_PROJECT?.trim() || "exploratory";
  if (!new Set(["critical", "exploratory", "hermes"]).has(workloadProject)) {
    throw new Error("BREADBOARD_MEMORY_QA_PROJECT must be critical, exploratory, or hermes.");
  }
  const initialFreeCommitMb = initial.commitLimitMb - initial.commitTotalMb;
  const summary = {
    schemaVersion: 1,
    mode,
    startedAt: new Date().toISOString(),
    metricSource: process.platform === "win32" ? "GetPerformanceInfo" : initial.metricSource,
    minimumReserveMb,
    coldStartEstimateMb,
    initialFreeCommitMb,
    minimumFreeCommitMb: initialFreeCommitMb,
    peakCommitTotalMb: initial.commitTotalMb,
    peakOwnedPrivateBytes: 0,
    finalOwnedPrivateBytes: 0,
    sampleCount: 0,
    aborted: false,
    workloadExitCode: null,
    workloadProject: mode === "burn-in" ? workloadProject : null,
  };

  if (mode === "burn-in" && initialFreeCommitMb < minimumReserveMb + coldStartEstimateMb) {
    const initialSample = {
      sampledAt: initial.sampledAt,
      commitTotalMb: initial.commitTotalMb,
      commitLimitMb: initial.commitLimitMb,
      freeCommitMb: initialFreeCommitMb,
      physicalUsedMb: initial.physicalTotalMb - initial.physicalAvailableMb,
      physicalTotalMb: initial.physicalTotalMb,
      systemProcessCount: initial.processCount,
      workloadRootPid: null,
      owned: { processCount: 0, privateBytes: 0, workingSetBytes: 0 },
      ownedProcesses: [],
      services: [],
      activeJobs: [],
      dockerWsl: totalsFor(
        new Set(initial.processes
          .filter((item) => /^(?:vmmem|vmmemwsl|com\.docker\.backend|docker desktop|wslservice)$/i.test(item.name))
          .map((item) => item.pid)),
        initial.processes,
      ),
    };
    fs.appendFileSync(samplesPath, `${JSON.stringify(initialSample)}\n`, "utf8");
    summary.sampleCount = 1;
    summary.aborted = true;
    summary.reason = `startup denied: ${Math.round(initialFreeCommitMb)} MB free commit cannot preserve the ${minimumReserveMb} MB reserve plus ${coldStartEstimateMb} MB cold-start estimate`;
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    writeReport(summary);
    process.exitCode = 2;
  } else {
    if (mode === "burn-in") {
      workload = spawn(process.execPath, [
        path.join(repoRoot, "qa", "electron", "run-qa.mjs"),
        `--project=${workloadProject}`,
      ], {
        cwd: repoRoot,
        env: { ...process.env, BREADBOARD_QA_DASHBOARD_MODE: "standalone" },
        stdio: "inherit",
        windowsHide: true,
      });
      workload.once("exit", (code) => { workloadExitCode = code ?? 1; });
    }

    const deadline = Date.now() + durationMs;
    do {
      const raw = await sampler.sample();
      const status = await supervisorStatus();
      const ownedIds = descendants(workload?.pid, raw.processes);
      const owned = totalsFor(ownedIds, raw.processes);
      const services = (status?.services ?? []).map((service) => {
        const ids = descendants(service.pid, raw.processes);
        return { ...service, ...totalsFor(ids, raw.processes), descendantPids: [...ids].slice(1) };
      });
      const dockerNames = /^(?:vmmem|vmmemwsl|com\.docker\.backend|docker desktop|wslservice)$/i;
      const dockerWslIds = new Set(raw.processes.filter((item) => dockerNames.test(item.name)).map((item) => item.pid));
      const sample = {
        sampledAt: raw.sampledAt,
        commitTotalMb: raw.commitTotalMb,
        commitLimitMb: raw.commitLimitMb,
        freeCommitMb: raw.commitLimitMb - raw.commitTotalMb,
        physicalUsedMb: raw.physicalTotalMb - raw.physicalAvailableMb,
        physicalTotalMb: raw.physicalTotalMb,
        systemProcessCount: raw.processCount,
        workloadRootPid: workload?.pid ?? null,
        owned,
        ownedProcesses: raw.processes.filter((item) => ownedIds.has(item.pid)),
        services,
        activeJobs: status?.activeJobs ?? [],
        dockerWsl: totalsFor(dockerWslIds, raw.processes),
      };
      fs.appendFileSync(samplesPath, `${JSON.stringify(sample)}\n`, "utf8");
      summary.sampleCount += 1;
      summary.minimumFreeCommitMb = Math.min(summary.minimumFreeCommitMb, sample.freeCommitMb);
      summary.peakCommitTotalMb = Math.max(summary.peakCommitTotalMb, sample.commitTotalMb);
      summary.peakOwnedPrivateBytes = Math.max(summary.peakOwnedPrivateBytes, owned.privateBytes);
      summary.finalOwnedPrivateBytes = owned.privateBytes;
      if (sample.freeCommitMb < minimumReserveMb) {
        summary.aborted = true;
        summary.reason = `emergency reserve crossed at ${Math.round(sample.freeCommitMb)} MB`;
        break;
      }
      if (mode === "burn-in" && workloadExitCode !== null) break;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } while (!interrupted);

    if (interrupted && !summary.aborted) {
      summary.aborted = true;
      summary.reason = "memory QA interrupted by the operator";
    }

    if (workload && workloadExitCode === null) {
      if (process.platform === "win32") {
        await new Promise((resolve) => {
          const killer = spawn("taskkill.exe", ["/PID", String(workload.pid), "/T", "/F"], { windowsHide: true });
          killer.once("exit", resolve);
        });
      } else workload.kill("SIGTERM");
      workloadExitCode = summary.aborted ? 2 : 124;
    }
    summary.workloadExitCode = workloadExitCode;
    summary.finishedAt = new Date().toISOString();
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    writeReport(summary);
    if (summary.aborted || (mode === "burn-in" && workloadExitCode !== 0)) process.exitCode = 1;
  }
} finally {
  sampler.stop();
}
