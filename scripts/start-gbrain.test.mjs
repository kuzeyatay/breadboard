import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the focused GBrain launcher and package defaults use the reviewed Node entrypoint", () => {
  const launcher = fs.readFileSync(path.join(repositoryRoot, "scripts", "start-gbrain.mjs"), "utf8");
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  const adapterPackage = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "gbrain-adapter", "package.json"), "utf8"),
  );

  assert.equal(rootPackage.scripts["dev:gbrain"], "node scripts/start-gbrain.mjs");
  assert.match(launcher, /"gbrain-adapter", "src", "node-entrypoint\.mjs"/u);
  assert.match(
    launcher,
    /spawn\(\s*process\.execPath,\s*\["--no-warnings", "--experimental-transform-types", adapterEntry\]/u,
  );
  assert.match(launcher, /GBRAIN_ADAPTER_HOST:\s*"127\.0\.0\.1"/u);
  assert.doesNotMatch(launcher, /spawn\(\s*(?:bun|"bun(?:\.exe)?")/u);

  assert.equal(adapterPackage.scripts.start, adapterPackage.scripts["start:node"]);
  assert.equal(adapterPackage.scripts["start:bun"], "bun run src/server.ts");
});
