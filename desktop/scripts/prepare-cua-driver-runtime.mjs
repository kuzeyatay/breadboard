import path from "node:path";
import { fileURLToPath } from "node:url";

import { stagePinnedCuaDriverRuntime } from "./cua-driver-runtime-artifact.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
for (const argument of args) {
  if (argument !== "--offline") {
    throw new Error(`Unknown Computer Use preparation argument: ${argument}`);
  }
}

await stagePinnedCuaDriverRuntime({
  targetRoot: path.join(desktopRoot, "resources", "bin", "cua-driver"),
  licensesRoot: path.join(desktopRoot, "build-resources", "licenses"),
  suppliedPaths: {
    archive: process.env.BREADBOARD_CUA_DRIVER_ARCHIVE,
    notices: {
      "cua-driver-LICENSE.txt": process.env.BREADBOARD_CUA_DRIVER_LICENSE,
      "cua-driver-node-runtime-NOTICE.txt": process.env.BREADBOARD_CUA_DRIVER_NODE_NOTICE,
    },
  },
  offline: args.has("--offline"),
  log: (message) => console.log(`[prepare-computer-use] ${message}`),
});

console.log("[prepare-computer-use] exact immutable Hermes Computer Use runtime assembled");
