import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const fixtureRoot = path.resolve(
  process.env.LEARN_WORKER_TEST_CAPABILITY_FIXTURE_ROOT,
);
const supervisorUrl = pathToFileURL(
  path.join(fixtureRoot, "learn-worker-capability-supervisor.mjs"),
).href;
const executorUrl = pathToFileURL(
  path.join(fixtureRoot, "learn-worker-capability-executor.mjs"),
).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../src/lib/supervisor-control.ts") {
      return { url: supervisorUrl, shortCircuit: true };
    }
    if (specifier === "../src/lib/learn-operation-executor.ts") {
      return { url: executorUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
