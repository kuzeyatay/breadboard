import { app } from "electron";
import { AppLifecycle } from "./app-lifecycle";
import { parseStartupOptions } from "./startup-options";

const options = parseStartupOptions(process.argv);
if (options.userDataDir) app.setPath("userData", options.userDataDir);
if (process.platform === "win32") app.setAppUserModelId("com.breadboard.desktop");
const lifecycle = new AppLifecycle(__dirname, options.forceDev);

void lifecycle.run().catch((error: unknown) => {
  // A failure this early has no window to report into; write to stderr and
  // exit non-zero so the OS shows the crash instead of a silent zombie.
  console.error("[breadboard-desktop] fatal startup error:", error);
  process.exit(1);
});
