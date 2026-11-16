import { spawn } from "node:child_process";
import http from "node:http";
import inspector from "node:inspector";
import path from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { appendDiagnostic, dashboardLogPath, memorySample, observeDashboardErrors, routeClassifier } from "./runtime-v2-dashboard-diagnostics.mjs";

/** A live PID is not proof that the workspace can still accept requests.
 * Run the probe off the server's event loop so a stalled synchronous task
 * cannot also stall recovery. Runtime V2 remains the sole restart owner. */
export function startDashboardWatchdog({ port, intervalMs = 10_000, timeoutMs = 5_000, failureLimit = 6,
  manifestPath = path.resolve(".next-desktop", "routes-manifest.json") }) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid dashboard watchdog port");
  const requests = new SharedArrayBuffer(SLOTS * (12 + SLOT_BYTES));
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { port, intervalMs, timeoutMs, failureLimit, requests, manifestPath, initialMemory: memorySample() },
    execArgv: [],
  });
  const stopTracing = traceRequests(requests);
  const errors = observeDashboardErrors(detail => worker.postMessage({ exception: detail }));
  let previousLoop = performance.eventLoopUtilization();
  const sampler = setInterval(() => {
    const loop = performance.eventLoopUtilization();
    worker.postMessage({ memory: memorySample(), exceptions: errors.count(),
      eventLoopUtilization: performance.eventLoopUtilization(loop, previousLoop).utilization });
    previousLoop = loop;
  }, 10_000);
  sampler.unref();
  worker.once("exit", () => {
    clearInterval(sampler);
    errors.close();
    stopTracing();
  });
  worker.on("error", error => console.error("[dashboard-watchdog] Probe unavailable:", error.message));
  worker.unref();
  return worker;
}

// A thread stuck in native code (a long synchronous query) cannot be asked what
// it is doing, so the server notes each request as it arrives in memory this
// thread can read on its own. Arrival order gives context for concurrent work.
const SLOTS = 24, SLOT_BYTES = 192;
function traceRequests(shared) {
  const revisions = new Int32Array(shared, 0, SLOTS);
  const status = new Int32Array(shared, SLOTS * 4, SLOTS);
  const duration = new Int32Array(shared, SLOTS * 8, SLOTS);
  const bytes = new Uint8Array(shared, SLOTS * 12);
  let sequence = 0;
  const encoder = new TextEncoder();
  const emit = http.Server.prototype.emit;
  const tracedEmit = function (event, request, response) {
    if (event === "request") {
      try {
        const pathname = String(request.url).slice(0, 180).split(/[?#]/, 1)[0];
        if (pathname !== "/api/health") {
          const slot = sequence++ % SLOTS, start = slot * SLOT_BYTES;
          const at = Date.now();
          Atomics.add(revisions, slot, 1);
          Atomics.store(status, slot, 0);
          Atomics.store(duration, slot, 0);
          bytes.fill(0, start, start + SLOT_BYTES);
          encoder.encodeInto(`${at} ${request.method} ${pathname}`, bytes.subarray(start, start + SLOT_BYTES - 1));
          const revision = Atomics.add(revisions, slot, 1) + 1;
          response.once("close", () => {
            if (Atomics.load(revisions, slot) !== revision) return;
            Atomics.add(revisions, slot, 1);
            Atomics.store(duration, slot, Math.min(2_147_483_647, Math.max(0, Date.now() - at)));
            Atomics.store(status, slot, response.writableFinished ? response.statusCode : -1);
            Atomics.add(revisions, slot, 1);
          });
        }
      } catch { /* tracing never gets in the way of serving */ }
    }
    return emit.apply(this, arguments);
  };
  http.Server.prototype.emit = tracedEmit;
  return () => { if (http.Server.prototype.emit === tracedEmit) http.Server.prototype.emit = emit; };
}
function recentRequests(shared, classify) {
  const revisions = new Int32Array(shared, 0, SLOTS);
  const status = new Int32Array(shared, SLOTS * 4, SLOTS);
  const duration = new Int32Array(shared, SLOTS * 8, SLOTS);
  const bytes = new Uint8Array(shared, SLOTS * 12), decoder = new TextDecoder();
  const rows = [];
  for (let slot = 0; slot < SLOTS; slot++) {
    const before = Atomics.load(revisions, slot);
    if (!before || before % 2) continue;
    const raw = bytes.slice(slot * SLOT_BYTES, (slot + 1) * SLOT_BYTES);
    const code = Atomics.load(status, slot), durationMs = Atomics.load(duration, slot);
    if (before !== Atomics.load(revisions, slot)) continue;
    const text = decoder.decode(raw.subarray(0, raw.indexOf(0) < 0 ? raw.length : raw.indexOf(0)));
    const [stamp, method, pathname] = text.split(" ");
    if (Number(stamp) && pathname) rows.push({ at: Number(stamp), method, route: classify(pathname),
      outcome: code > 0 ? "finished" : code < 0 ? "aborted" : "in-flight",
      status: code > 0 ? code : null, durationMs: code ? durationMs : null });
  }
  rows.sort((a, b) => a.at - b.at);
  return rows;
}

function responds(port, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      resolve(value);
    };
    const request = http.get({ host: "127.0.0.1", port, path: "/api/health", agent: false }, response => {
      response.resume();
      // An HTTP error still proves the event loop is serving. Do not restart
      // a responsive workspace because another dependency is unhealthy.
      finish(true);
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
    request.on("error", () => finish(false));
  });
}

const mb = bytes => `${Math.round(bytes / 1048576)} MB`;

// Own append-only file, not stderr: worker stdio is relayed by the stuck main
// thread, a full stderr pipe blocks writeSync, and services/dashboard.log is
// atomically rewritten by the runtime.
function record(text) {
  const line = `${new Date().toISOString()} pid=${process.pid} ${text}\n`;
  appendDiagnostic(dashboardLogPath("dashboard-watchdog.log"), line);
}

/** What the stalled main thread is doing. Inspector messages reach a busy
 * JS loop through a V8 interrupt; a thread stuck in native code or GC never
 * answers, which is itself the diagnosis. */
export function mainThreadSnapshot(timeoutMs = 5_000) {
  return new Promise(resolve => {
    let session;
    let finished = false;
    const finish = text => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { session?.disconnect(); } catch { /* already gone */ }
      resolve(text);
    };
    const timer = setTimeout(() => finish(`main thread did not pause within ${timeoutMs} ms (blocked in native code, sync I/O, or GC)`), timeoutMs);
    try {
      session = new inspector.Session();
      session.connectToMainThread();
      const scripts = new Map();
      session.on("Debugger.scriptParsed", ({ params }) => scripts.set(params.scriptId, params.url));
      session.on("Debugger.paused", ({ params }) => {
        if (finished) return;
        session.post("Runtime.getHeapUsage", (_error, heap) => {
          const frames = params.callFrames.slice(0, 25).map(frame =>
            `    at ${frame.functionName || "<anonymous>"} (${frame.url || scripts.get(frame.location.scriptId) || "?"}:${frame.location.lineNumber + 1}:${frame.location.columnNumber + 1})`);
          finish(`${heap ? `main heap used=${mb(heap.usedSize)} total=${mb(heap.totalSize)}\n` : ""}main thread stack:\n${frames.join("\n")}`);
        });
      });
      session.post("Debugger.enable", error => {
        // Disconnecting at the deadline also completes outstanding callbacks.
        if (finished) return;
        if (error) finish(`main thread stack unavailable: ${error.message}`);
        else session.post("Debugger.pause", pauseError => {
          if (pauseError) finish(`main thread stack unavailable: ${pauseError.message}`);
        });
      });
    } catch (error) {
      finish(`main thread stack unavailable: ${error?.message ?? error}`);
    }
  });
}

if (!isMainThread && workerData?.port) {
  const { port, intervalMs, timeoutMs, failureLimit, requests, manifestPath } = workerData;
  const classify = routeClassifier(manifestPath);
  let memory = workerData.initialMemory;
  let exceptions = 0;
  let eventLoopUtilization = null;
  let ready = false;
  let failures = 0;
  let stallStart = null;
  let lastSampleAt = 0;
  function snapshot(event, exception) {
    const at = Date.now();
    const rows = recentRequests(requests, classify);
    appendDiagnostic(dashboardLogPath("dashboard-diagnostics.jsonl"), JSON.stringify({
      at: new Date(at).toISOString(), pid: process.pid, event, ready, failedProbes: failures,
      uptimeSeconds: Math.round(process.uptime()), rssBytes: process.memoryUsage.rss(),
      mainMemory: memory, sampleAgeMs: at - memory.at, exceptions, exception, eventLoopUtilization, recentRequests: rows,
    }) + "\n");
    lastSampleAt = at;
    return rows;
  }
  parentPort.on("message", sample => {
    if (sample.exception) {
      memory = sample.exception.memory;
      exceptions = sample.exception.count;
      snapshot("exception", sample.exception);
    } else {
      memory = sample.memory;
      exceptions = sample.exceptions;
      eventLoopUtilization = sample.eventLoopUtilization;
    }
  });
  snapshot("startup");
  while (true) {
    if (await responds(port, timeoutMs)) {
      const event = failures ? "recovered" : !ready ? "ready" : null;
      ready = true;
      if (failures) record(`probe recovered after ${failures} failed probe(s)`);
      if (event) snapshot(event);
      failures = 0;
      stallStart = null;
    } else if (ready) {
      stallStart ??= { at: Date.now(), cpu: process.cpuUsage() };
      if (++failures === 1) {
        record("probe failed; workspace may be stalling");
        snapshot("probe-failed");
      }
      if (failures >= failureLimit) {
        const seconds = (Date.now() - stallStart.at) / 1000;
        const cpu = process.cpuUsage(stallStart.cpu);
        const cpuPercent = Math.round(((cpu.user + cpu.system) / 1e6 / Math.max(seconds, 1)) * 100);
        // Header first: a 2026-11-14 stall ran 5+ min with no report at all,
        // so nothing after this line may be trusted to finish.
        record(`Workspace stopped accepting HTTP requests for ${Math.round(seconds)} s; exiting for Runtime V2 recovery. ` +
          `process cpu=${cpuPercent}% of one core during the stall, rss=${mb(process.memoryUsage.rss())}`);
        // The first probe waited timeoutMs for its answer, so the server went quiet about that long before stallStart.
        const rows = snapshot("watchdog-restart");
        const stallAt = stallStart.at - timeoutMs;
        record(rows.length ? "recent requests, oldest first:\n" + rows.map(row =>
          `    ${((row.at - stallAt) / 1000).toFixed(1)} s from first missed probe  ${row.method} ${row.route}`).join("\n")
          : "no recent requests recorded");
        // The snapshot talks to the stuck thread. With that thread in native code
        // (a long synchronous query) it has never returned: four stalls out of four
        // by 2026-11-16 logged the header above and then neither a stack nor a kill,
        // the last one for twelve minutes. So the kill is armed first, in a process
        // that shares nothing with this one.
        try {
          spawn(process.execPath, ["-e", `setTimeout(() => { try { process.kill(${process.pid}, "SIGKILL"); } catch {} }, ${timeoutMs + 2_000})`],
            { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }).unref();
        } catch { /* the kill below is still tried */ }
        record(await mainThreadSnapshot(timeoutMs));
        // process.exit in a worker only exits that thread. Terminate this one
        // service process; its existing supervisor reaps it and restarts it.
        process.kill(process.pid, "SIGKILL");
        break;
      }
    }
    if (Date.now() - lastSampleAt >= 60_000) snapshot("sample");
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
