#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

const sourceRoot = process.env.BREADBOARD_LEARN_SOURCE_ROOT?.trim();
if (!sourceRoot) {
  process.stderr.write("[background-coordinator] BREADBOARD_LEARN_SOURCE_ROOT is required\n");
  process.exit(2);
}

process.title = "breadboard-background-coordinator";
process.once("disconnect", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
process.once("SIGINT", () => process.exit(0));

try {
  // instrumentation-node is now the coordinator payload, not Next's
  // instrumentation entry. Keeping the established startup code in one file
  // avoids two subtly different scheduler contracts.
  await import(pathToFileURL(path.join(sourceRoot, "instrumentation-node.ts")).href);
  process.send?.({ type: "ready", pid: process.pid });
  process.stdout.write(`[background-coordinator] ready pid=${process.pid}\n`);
} catch (error) {
  process.stderr.write(
    `[background-coordinator] startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exit(1);
}
