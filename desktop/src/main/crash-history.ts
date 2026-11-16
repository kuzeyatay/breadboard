import * as fs from "node:fs";
import * as path from "node:path";

// Called on explicit diagnostics requests. Bound the read even for older
// installations whose original watchdog log could grow indefinitely.
function tail(file: string, limit = 512 * 1024): string[] {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - limit);
    const buffer = Buffer.alloc(Math.min(size, limit));
    const length = fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8", 0, length).split("\n");
    if (start) lines.shift();
    return lines;
  } catch { return []; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function records(file: string): Record<string, unknown>[] {
  return tail(file).flatMap(line => {
    try {
      const value = JSON.parse(line);
      return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
    } catch { return []; }
  });
}

export function readDashboardCrashHistory(logsDir: string) {
  const services = path.join(logsDir, "services");
  const diagnostics = path.join(logsDir, "dashboard-diagnostics.jsonl");
  const newestSamples = [...records(diagnostics + ".1"), ...records(diagnostics)].reverse();
  const exits = records(path.join(services, "dashboard.exits.jsonl")).slice(-12).reverse();
  const recentExits = exits.map(exit => {
    const end = Number(exit.timestampMs);
    const start = end - Number(exit.uptimeMs);
    const sample = newestSamples.find(row => {
      const at = Date.parse(String(row.at));
      return typeof exit.pid === "number" && row.pid === exit.pid && at >= start && at <= end;
    });
    return { ...exit, lastWatchdogSample: sample ?? null };
  });

  // Old service logs have no wall clock or exit receipt. Keep the observed
  // errors under their generation instead of guessing the cause of an exit.
  const observed = new Map<number, { generation: number; v8FatalOom: boolean; closedStreamExceptions: number }>();
  for (const line of tail(path.join(services, "dashboard.log"))) {
    const match = /\[service=dashboard generation=(\d+) stream=stderr\] (.*)/.exec(line);
    if (!match) continue;
    const oom = /^FATAL ERROR:.*out of memory/i.test(match[2] ?? "");
    const closed = /uncaughtException:.*Controller is already closed/.test(match[2] ?? "");
    if (!oom && !closed) continue;
    const generation = Number(match[1]);
    const row = observed.get(generation) ?? { generation, v8FatalOom: false, closedStreamExceptions: 0 };
    row.v8FatalOom ||= oom;
    if (closed) row.closedStreamExceptions++;
    observed.set(generation, row);
  }
  // Older reconnect messages contain complete URLs. Only project known
  // event fields into the report, including when reading historical logs.
  const recentWorkspaceEvents = [];
  for (const line of tail(path.join(logsDir, "desktop.log"))) {
    const match = /^(\S+) \[(?:tabs|desktop)\] (.*)/.exec(line);
    if (!match) continue;
    const [, at, message = ""] = match;
    const reconnect = /^reconnect (?:started contents=\d+ surface=[\w-]+ trigger=[\w-]+ errorCode=(?:-?\d+|unknown)|ended contents=\d+ outcome=[\w-]+ probes=\d+ elapsedMs=\d+)/.exec(message);
    if (reconnect) recentWorkspaceEvents.push({ at, event: reconnect[0] });
    else if (message.startsWith("page lost in a tab;")) recentWorkspaceEvents.push({ at, event: "workspace tab disconnected" });
    else if (message.startsWith("renderer gone:")) {
      const renderer = /^renderer gone: contents=\d+ reason=[\w-]+ exitCode=-?\d+/.exec(message);
      if (renderer) recentWorkspaceEvents.push({ at, event: renderer[0] });
    } else {
      const failure = /^(?:child gone: type=[\w -]+ reason=[\w-]+ exitCode=-?\d+|Runtime stopped with (?:exit code|signal) [\w-]+|main process exception: origin=\w+ pid=\d+ uptimeSeconds=\d+ rssBytes=\d+)/.exec(message);
      if (failure) recentWorkspaceEvents.push({ at, event: failure[0] });
    }
  }
  return {
    recentExits,
    observedErrors: [...observed.values()].slice(-12).reverse(),
    latestWatchdogSample: newestSamples[0] ?? null,
    recentWorkspaceEvents: recentWorkspaceEvents.slice(-12).reverse(),
  };
}
