#!/usr/bin/env node
import { runRuntimeV2OuterAgentWorker } from "./runtime-v2-outer-agent-worker-core.mjs";

await runRuntimeV2OuterAgentWorker("meeting-notes");
