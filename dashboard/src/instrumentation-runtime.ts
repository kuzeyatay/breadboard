import "server-only";

import { startBackgroundCoordinator } from "./lib/background-coordinator-launcher.ts";
import { startRuntimeMemorySampling } from "./lib/runtime-memory.ts";

// Keep Next's instrumentation graph tiny. Long-running schedulers and channel
// gateways execute in a child coordinator, so the compiler does not retain
// their complete module graph in its own heap. The child remains in the
// dashboard process tree, which lets the desktop supervisor account for and
// terminate it with the server it belongs to.
startRuntimeMemorySampling();
startBackgroundCoordinator();
