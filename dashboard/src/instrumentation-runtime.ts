import "server-only";

import { startRuntimeMemorySampling } from "./lib/runtime-memory.ts";

// Next owns only its bounded memory sampler. Recurring work and messaging
// gateways are registered with the native Runtime V2 scheduler/service engine;
// instrumentation must never create a background process or timer for them.
startRuntimeMemorySampling();
