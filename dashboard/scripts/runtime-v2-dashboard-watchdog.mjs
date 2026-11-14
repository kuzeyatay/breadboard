import http from "node:http";
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

if (!isMainThread) {
  const { port, intervalMs, timeoutMs, failureLimit } = workerData;
  let ready = false;
  let failures = 0;
  while (true) {
    if (await responds(port, timeoutMs)) {
      ready = true;
      failures = 0;
    } else if (ready && ++failures >= failureLimit) {
      process.stderr.write("[dashboard-watchdog] Workspace stopped accepting HTTP requests; exiting for Runtime V2 recovery.\n");
      // process.exit in a worker only exits that thread. Terminate this one
      // service process; its existing supervisor reaps it and restarts it.
      process.kill(process.pid, "SIGKILL");
      break;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
