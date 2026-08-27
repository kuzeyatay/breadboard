import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDevEntrypoints } from "./dev-entrypoint-validation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(read(relativePath));
const result = validateDevEntrypoints({
  rootPackage: readJson("package.json"),
  desktopPackage: readJson("desktop/package.json"),
  leanLauncherSource: read("desktop/scripts/dev-fast.mjs"),
  electronLauncherSource: read("desktop/scripts/dev.mjs"),
  runtimePreparerSource: read("desktop/scripts/prepare-hot-dev-runtimes.mjs"),
});

if (!result.ok) {
  process.stderr.write("[runtime-v2] development entrypoint validation failed:\n");
  for (const error of result.errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "[runtime-v2] development entrypoint validation passed (hot Electron is the default; no standalone build is required).\n",
  );
}
