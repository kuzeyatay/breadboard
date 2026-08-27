import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateElectronRuntimeOwner } from "./electron-owner-validation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const result = validateElectronRuntimeOwner({
  appLifecycleSource: read("desktop/src/main/app-lifecycle.ts"),
  runtimeProcessSource: read("desktop/src/main/runtime-process.ts"),
});

if (!result.ok) {
  process.stderr.write(
    `[runtime-v2] Electron owner validation failed (${result.counts.forbiddenLegacyOwners} legacy owner patterns):\n`,
  );
  for (const error of result.errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("[runtime-v2] Electron owner validation passed (one Rust runtime owner).\n");
}
