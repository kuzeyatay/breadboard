import path from "node:path";
import { readDashboardCrashHistory } from "../desktop/src/main/crash-history.ts";

const args = process.argv.slice(2);
const data = args.find(arg => arg !== "--json") || process.env.BREADBOARD_DATA_DIR ||
  (process.env.APPDATA && path.join(process.env.APPDATA, "breadboard-desktop", "Data"));
if (data) {
  const logs = path.resolve(data, "logs");
  const report = readDashboardCrashHistory(logs);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ logs, ...report }, null, 2));
  } else {
    console.log("Breadboard dashboard crash history\n" + logs);
    const localTime = value => new Date(value).toLocaleString();
    for (const exit of report.recentExits) {
      const details = [exit.classification, exit.guardTerminationReason, exit.failureCode,
        exit.v8FatalOomObserved && "V8 out of memory",
        exit.targetExitCode != null && `exit code ${exit.targetExitCode}`,
        exit.peakCommitBytes != null && `peak commit ${Math.round(exit.peakCommitBytes / 1048576)} MiB`];
      console.log(`${localTime(exit.timestampMs)}  generation ${exit.generation}  ${details.filter(Boolean).join(", ")}`);
    }
    if (!report.recentExits.length) console.log("No confirmed dashboard exit records yet.");
    for (const row of report.observedErrors) {
      const details = [row.v8FatalOom && "V8 out of memory",
        row.closedStreamExceptions && `${row.closedStreamExceptions} closed-stream exception(s)`];
      console.log(`Service log, generation ${row.generation}  ${details.filter(Boolean).join(", ")}`);
    }
    for (const row of report.recentWorkspaceEvents.slice(0, 6)) console.log(`${localTime(row.at)}  ${row.event}`);
    const sample = report.latestWatchdogSample;
    if (sample) console.log(`Latest watchdog sample ${localTime(sample.at)}  PID ${sample.pid}  ${sample.event}  RSS ${Math.round(sample.rssBytes / 1048576)} MiB`);
    console.log("Use --json for the available memory, request and exit details.");
  }
} else {
  console.error("Pass the Breadboard data directory or set BREADBOARD_DATA_DIR.");
  process.exitCode = 1;
}
