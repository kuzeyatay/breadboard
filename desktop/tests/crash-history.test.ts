import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { readDashboardCrashHistory } from "../src/main/crash-history";
import { writeDiagnosticBundle } from "../src/main/diagnostic-bundle";

test("crash history correlates samples by process lifetime and reads legacy reconnects", t => {
  const logs = fs.mkdtempSync(path.join(os.tmpdir(), "bb-crash-history-"));
  t.after(() => fs.rmSync(logs, { recursive: true, force: true }));
  fs.mkdirSync(path.join(logs, "services"));
  const before = readDashboardCrashHistory(logs);
  assert.deepEqual(before.recentExits, []);
  assert.equal(before.latestWatchdogSample, null);
  const write = (name: string, lines: unknown[]) => fs.writeFileSync(path.join(logs, name),
    lines.map(line => typeof line === "string" ? line : JSON.stringify(line)).join("\n") + "\n");
  write("dashboard-diagnostics.jsonl.1", [{ at: new Date(900).toISOString(), pid: 4 },
    { at: new Date(1100).toISOString(), pid: 4, rssBytes: 150 }]);
  write("dashboard-diagnostics.jsonl", [{ at: new Date(1550).toISOString(), pid: 4 }, "{partial"]);
  write("services/dashboard.exits.jsonl", [
    { generation: 8, timestampMs: 1400, uptimeMs: 400, pid: 4 },
    { generation: 9, timestampMs: 1500, uptimeMs: 50, pid: 4 },
  ]);
  write("services/dashboard.log", ["[service=dashboard generation=7 stream=stderr] FATAL ERROR: Zone Allocation failed - process out of memory",
    "[service=dashboard generation=8 stream=stderr] ⨯ uncaughtException: TypeError: Invalid state: Controller is already closed"]);
  write("desktop.log", ["2026-11-16T11:45:44.899Z [tabs] page lost in a tab; showing the reconnect scene and waiting for http://localhost/gardens/private?chat=secret"]);
  const report = readDashboardCrashHistory(logs);
  assert.equal(report.recentExits[0]?.lastWatchdogSample, null);
  assert.equal(report.recentExits[1]?.lastWatchdogSample?.rssBytes, 150);
  assert.equal(report.observedErrors[0]?.closedStreamExceptions, 1);
  assert.equal(report.observedErrors[1]?.v8FatalOom, true);
  assert.deepEqual(report.recentWorkspaceEvents[0], { at: "2026-11-16T11:45:44.899Z", event: "workspace tab disconnected" });
  assert.doesNotMatch(JSON.stringify(report), /private|secret/);
});

test("the diagnostic zip includes the dashboard report and its supporting files", { skip: process.platform !== "win32" }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-crash-bundle-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logsDir = path.join(dir, "logs");
  fs.mkdirSync(path.join(logsDir, "services"), { recursive: true });
  const exit = { service: "dashboard", generation: 12, classification: "resource-exhausted" };
  fs.writeFileSync(path.join(logsDir, "services", "dashboard.exits.jsonl"), JSON.stringify(exit) + "\n");
  const bundle = await writeDiagnosticBundle({
    destination: path.join(dir, "diagnostics.zip"), logsDir, crashDumpsDir: path.join(dir, "dumps"),
    report: { dashboardCrashHistory: readDashboardCrashHistory(logsDir) },
  });
  const tar = path.join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe");
  const read = (file: string) => JSON.parse(execFileSync(tar, ["-xOf", bundle.path, file], { encoding: "utf8" }));
  assert.equal(read("./diagnostics.json").dashboardCrashHistory.recentExits[0].classification, "resource-exhausted");
  assert.deepEqual(read("./logs/services/dashboard.exits.jsonl"), exit);
});
