import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dashboardUrl = process.argv[2];
if (!dashboardUrl) throw new Error("Usage: node tmp-goal-open-attached-desktop.mjs <loopback-dashboard-url>");

const parsed = new URL(dashboardUrl);
if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
  throw new Error("The attached dashboard URL must use loopback HTTP.");
}

const desktopRoot = path.join(root, "desktop");
const electron = path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe");
const child = spawn(electron, ["--disable-gpu", "."], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    BREADBOARD_DESKTOP_ATTACH_DASHBOARD_URL: parsed.toString(),
  },
  stdio: "inherit",
  windowsHide: false,
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  console.log(JSON.stringify({ event: "attached-desktop-exit", code, signal }));
  process.exitCode = code ?? (signal ? 1 : 0);
});
