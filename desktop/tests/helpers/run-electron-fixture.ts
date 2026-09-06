import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** Verify the fixture's assertion receipt, then tear down the isolated native
 * application. Chromium shutdown itself is outside this functional test. */
export async function runElectronFixture(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number) {
  return new Promise<{ status: number | null; error?: Error; output: string }>(resolve => {
    const outputPath = path.join(args[args.length - 1]!, "electron-output.log");
    const descriptor = fs.openSync(outputPath, "w");
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ["ignore", descriptor, descriptor] });
    fs.closeSync(descriptor);
    const receiptPath = path.join(args[args.length - 1]!, "passed.json");
    let completed = false;
    let failure: Error | undefined;
    let settled = false;
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
      if (completed) child.kill();
    }, 50);
    const timer = setTimeout(() => { failure = new Error("Electron fixture timed out before verification"); child.kill(); }, timeoutMs);
    child.once("error", error => finish(null, error));
    child.once("exit", status => finish(status, !completed && !failure ? new Error("Electron exited without completing the assertions") : undefined));
  });
}
