import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { dispatchApiAnything } from "./api-anything-dispatch.mjs";

// A worker has its own environment: concurrent accounts never share an upstream
// API_ANYTHING_HOME, cookie jar, write ledger, cooldown or cached response.
try {
  const host = await import(pathToFileURL(workerData.bundle).href);
  host.setBundledDir(workerData.sites);
  const result = await dispatchApiAnything(host, workerData.tool, workerData.args, {
    approvedPlan: workerData.approvedPlan, timeoutMs: workerData.timeoutMs,
  });
  await host.closeHost();
  parentPort.postMessage(result);
} catch {
  parentPort.postMessage({ ok: false, class: "unavailable", provider: "api-anything",
    reason: "The embedded website API could not complete this request.",
    fallback: { recommended: !workerData.approvedPlan },
    ...(workerData.approvedPlan ? { verifyBeforeRetry: true } : {}) });
}
