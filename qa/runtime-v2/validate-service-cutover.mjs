import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateServiceCutover } from "./service-cutover-validation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const inventory = JSON.parse(
  fs.readFileSync(path.join(here, "execution-inventory.json"), "utf8"),
);
const serviceManifest = JSON.parse(
  fs.readFileSync(
    path.join(root, "desktop", "runtime-v2", "manifests", "services.json"),
    "utf8",
  ),
);
const result = validateServiceCutover({ inventory, serviceManifest });

process.stdout.write(
  `[runtime-v2-services] ${result.counts.completed}/${result.counts.inventoryServices} ` +
    `Breadboard-owned service/schedule rows prove Runtime V2 cutover; ` +
    `${result.counts.manifestServices} trusted service manifests.\n`,
);

if (!result.ok) {
  for (const error of result.errors) process.stderr.write(`[runtime-v2-services] ${error}\n`);
  process.exitCode = 1;
}
