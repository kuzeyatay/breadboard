import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";

// The watchdog is the sole writer of each file. Keep the previous segment
// when rotating so the restart that follows an incident cannot erase it.
export function appendDiagnostic(file, line, limit = 4 * 1024 * 1024) {
  try {
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) + Buffer.byteLength(line) > limit) {
      fs.renameSync(file, file + ".1");
    }
    fs.appendFileSync(file, line);
  } catch { /* diagnostic storage is optional during recovery */ }
}

export function memorySample() {
  const { heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
  return { at: Date.now(), heapUsed, heapTotal, external, arrayBuffers, heapLimit: v8.getHeapStatistics().heap_size_limit };
}

// Route patterns come from the local build. Unknown paths, search terms and
// dynamic parameters never enter the crash log.
export function routeClassifier(manifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const pages = new Set(manifest.staticRoutes.map(route => route.page));
    const dynamic = manifest.dynamicRoutes.map(route => ({ page: route.page, pattern: new RegExp(route.regex) }));
    return pathname => {
      if (pages.has(pathname)) return pathname;
      return dynamic.find(route => route.pattern.test(pathname))?.page ?? "[unmatched]";
    };
  } catch {
    return () => "[unknown route]";
  }
}

export function observeDashboardErrors(onException) {
  let count = 0;
  let lastReport = -Infinity;
  // Monitor preserves Node's normal exception handling and exit semantics.
  const monitor = (error, origin) => {
    count++;
    try {
      if (performance.now() - lastReport < 5_000) return;
      lastReport = performance.now();
      const stack = typeof error?.stack === "string" ? error.stack : "";
      const frames = stack.split("\n").filter(line => /^\s+at /.test(line)).slice(0, 15)
        .map(line => line.trim().slice(0, 450));
      const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : null;
      // Write the first exception immediately, even if it terminates Node.
      const detail = {
        at: new Date().toISOString(), pid: process.pid, origin, count, code, frames, memory: memorySample(),
      };
      fs.writeSync(2, "[dashboard-exception] " + JSON.stringify(detail) + "\n");
      onException(detail);
    } catch { /* an exception observer must never throw */ }
  };
  process.on("uncaughtExceptionMonitor", monitor);
  return { count: () => count, close: () => process.off("uncaughtExceptionMonitor", monitor) };
}

export function dashboardLogPath(name) {
  return path.join(process.env.BREADBOARD_DATA_DIR || ".", "logs", name);
}
