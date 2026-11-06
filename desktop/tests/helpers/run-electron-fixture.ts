import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** Verify the fixture's assertion receipt, then tear down the isolated native
 * application. Chromium shutdown itself is outside this functional test. */
export async function runElectronFixture(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, visible = false) {
  return new Promise<{ status: number | null; error?: Error; output: string }>(resolve => {
    const outputPath = path.join(args[args.length - 1]!, "electron-output.log");
    const descriptor = fs.openSync(outputPath, "w");
    const child = spawn(executable, args, { cwd, env, windowsHide: !visible, stdio: ["ignore", descriptor, descriptor] });
    fs.closeSync(descriptor);
    const receiptPath = path.join(args[args.length - 1]!, "passed.json");
    let completed = false;
    let failure: Error | undefined;
    let settled = false;
    let stopping: Promise<void> | undefined;
    const stop = () => {
      if (stopping) return stopping;
      stopping = new Promise<void>(done => {
        if (process.platform !== "win32" || !child.pid) { child.kill(); done(); return; }
        // The renderer/GPU processes own profile files too. Killing only the
        // browser leaves them alive and contaminates later memory measurements.
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("exit", () => done());
        killer.once("error", () => { child.kill(); done(); });
      });
      return stopping;
    };
    const finish = (status: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      resolve({ status: completed && !failure ? 0 : status, error: error ?? failure, output: fs.readFileSync(outputPath, "utf8").slice(0, 1000000) });
    };
    const poll = setInterval(() => {
      if (completed || !fs.existsSync(receiptPath)) return;
      try { completed = JSON.parse(fs.readFileSync(receiptPath, "utf8")).passed === true; } catch { return; }
      if (completed) void stop();
    }, 50);
    const timer = setTimeout(() => { failure = new Error("Electron fixture timed out before verification"); void stop(); }, timeoutMs);
    child.once("error", error => finish(null, error));
    child.once("exit", status => {
      void (stopping ?? Promise.resolve()).then(() => finish(status, !completed && !failure ? new Error("Electron exited without completing the assertions") : undefined));
    });
  });
}
