import { AppLifecycle } from "./app-lifecycle";

const forceDev = process.argv.includes("--breadboard-dev");
const lifecycle = new AppLifecycle(__dirname, forceDev);

void lifecycle.run().catch((error: unknown) => {
  // A failure this early has no window to report into; write to stderr and
  // exit non-zero so the OS shows the crash instead of a silent zombie.
  console.error("[breadboard-desktop] fatal startup error:", error);
  process.exit(1);
});
