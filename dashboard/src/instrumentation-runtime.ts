import "server-only";

import { startRuntimeMemorySampling } from "./lib/runtime-memory.ts";

// Next owns only its bounded memory sampler. Recurring work and messaging
// gateways are registered with the native Runtime V2 scheduler/service engine;
// instrumentation must never create a background process or timer for them.
startRuntimeMemorySampling();

// One-time handoff of durable physical jobs to their native supervisor owner.
// No printer timer or process is owned by Next or a mounted renderer.
void import("./lib/bambu/server.ts").then(async ({ bambuService }) => {
  bambuService().recoverInspections();
  const { restoreBambuRuntime } = await import("./lib/bambu/runtime-client.ts");
  await restoreBambuRuntime(bambuService().store);
}).catch(() => { /* Jobs remain durable and visibly stale if the native service is unavailable. */ });
