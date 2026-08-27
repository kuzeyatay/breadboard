import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const repoPackage = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const route = fs.readFileSync(
  new URL("../src/app/api/hermes/health/route.ts", import.meta.url),
  "utf8",
);
const detachedFallback = new URL(
  "../src/lib/hermes/development-runtime.ts",
  import.meta.url,
);

test("Hermes reconnect has one in-product process owner", () => {
  assert.equal(fs.existsSync(detachedFallback), false);
  assert.match(route, /acquireServiceLease\("hermes", "terminal-reconnect"\)/);
  assert.match(route, /releaseSupervisorLease\(lease\)/);
  assert.doesNotMatch(
    route,
    /node:child_process|\bspawn\s*\(|ensureDevelopmentHermesRuntime|start-hermes\.mjs/,
  );
});

test("supported development entry points are explicit and fail closed", () => {
  assert.match(repoPackage.scripts.dev, /desktop:dev:hot/);
  assert.equal(repoPackage.scripts["dev:dashboard"], "npm --prefix dashboard run dev");
  assert.equal(repoPackage.scripts["dev:hermes"], "node scripts/start-hermes.mjs");

  const ensureStart = route.indexOf("if (ensureRuntime)");
  const passiveBranch = route.indexOf("} else {", ensureStart);
  const ensureBlock = route.slice(ensureStart, passiveBranch);
  assert.match(
    ensureBlock,
    /acquireServiceLease\("hermes", "terminal-reconnect"\)/,
  );
  assert.doesNotMatch(ensureBlock, /\breturn\b|\bthrow\b|\bspawn\b/);
  assert.ok(route.indexOf("runtime.health()", passiveBranch) > passiveBranch);
});
