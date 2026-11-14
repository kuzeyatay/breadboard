import fs from "node:fs";
import http from "node:http";
import inspector from "node:inspector";
import { isMainThread, Worker, workerData } from "node:worker_threads";

/** A live PID is not proof that the workspace can still accept requests.
 * Run the probe off the server's event loop so a stalled synchronous task
 * cannot also stall recovery. Runtime V2 remains the sole restart owner. */
export function startDashboardWatchdog({ port, intervalMs = 10_000, timeoutMs = 5_000, failureLimit = 6 }) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid dashboard watchdog port");
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { port, intervalMs, timeoutMs, failureLimit },
    execArgv: [],
  });
  worker.on("error", error => console.error("[dashboard-watchdog] Probe unavailable:", error.message));
  worker.unref();
  return worker;
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

/** What the stalled main thread is doing. Inspector messages reach a busy
 * JS loop through a V8 interrupt; a thread stuck in native code or GC never
 * answers, which is itself the diagnosis. */
export function mainThreadSnapshot(timeoutMs = 5_000) {
  return new Promise(resolve => {
    let session;
    const finish = text => {
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
        session.post("Runtime.getHeapUsage", (_error, heap) => {
          const frames = params.callFrames.slice(0, 25).map(frame =>
            `    at ${frame.functionName || "<anonymous>"} (${frame.url || scripts.get(frame.location.scriptId) || "?"}:${frame.location.lineNumber + 1}:${frame.location.columnNumber + 1})`);
          finish(`${heap ? `main heap used=${mb(heap.usedSize)} total=${mb(heap.totalSize)}\n` : ""}main thread stack:\n${frames.join("\n")}`);
        });
      });
      session.post("Debugger.enable", () => session.post("Debugger.pause"));
    } catch (error) {
      finish(`main thread stack unavailable: ${error?.message ?? error}`);
    }
  });
}

if (!isMainThread && workerData?.port) {
  const { port, intervalMs, timeoutMs, failureLimit } = workerData;
  let ready = false;
  let failures = 0;
  let stallStart = null;
  while (true) {
    if (await responds(port, timeoutMs)) {
      ready = true;
      failures = 0;
      stallStart = null;
    } else if (ready) {
      stallStart ??= { at: Date.now(), cpu: process.cpuUsage() };
      if (++failures >= failureLimit) {
        const seconds = (Date.now() - stallStart.at) / 1000;
        const cpu = process.cpuUsage(stallStart.cpu);
        const cpuPercent = Math.round(((cpu.user + cpu.system) / 1e6 / Math.max(seconds, 1)) * 100);
        const snapshot = await mainThreadSnapshot();
        // Worker stdio is relayed through the main thread, which is the one
        // that is stuck; write to the process's stderr fd directly instead.
        fs.writeSync(2,
          `[dashboard-watchdog] Workspace stopped accepting HTTP requests for ${Math.round(seconds)} s; exiting for Runtime V2 recovery.\n` +
          `[dashboard-watchdog] process cpu=${cpuPercent}% of one core during the stall, rss=${mb(process.memoryUsage.rss())}\n` +
          `[dashboard-watchdog] ${snapshot}\n`);
        // process.exit in a worker only exits that thread. Terminate this one
        // service process; its existing supervisor reaps it and restarts it.
        process.kill(process.pid, "SIGKILL");
        break;
      }
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
