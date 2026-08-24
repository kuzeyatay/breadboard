import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const executorUrl = pathToFileURL(
  path.resolve(
    process.env.LEARN_WORKER_TEST_FIXTURE_ROOT,
    "learn-worker-parent-death-executor.mjs",
  ),
).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../src/lib/learn-operation-executor.ts") {
      return { url: executorUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
