import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const desktopRoot = path.resolve(__dirname, "..", "..");

test("desktop starts Breadboard without a separate connected-app service", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  const source = fs.readFileSync(
    path.join(desktopRoot, "scripts", "dev.mjs"),
    "utf8",
  );

  assert.equal(
    packageJson.scripts["dev"],
    "npm run build && npm run prepare:transcription && node scripts/dev.mjs",
  );
  assert.doesNotMatch(packageJson.scripts["start"] ?? "", /nango|docker/i);
  assert.doesNotMatch(packageJson.scripts["dist:win"] ?? "", /nango|docker/i);
  assert.doesNotMatch(source, /NANGO_|start-nango|nango-local-env|api\.nango\.dev/i);
  assert.doesNotMatch(source, /spawn\([^)]*["']docker["']/i);
});

test("desktop packaging carries only static connected-app provider metadata", () => {
  const source = fs.readFileSync(
    path.join(desktopRoot, "scripts", "prepare-app-resources.mjs"),
    "utf8",
  );
  const verifier = fs.readFileSync(
    path.join(desktopRoot, "scripts", "verify-package.mjs"),
    "utf8",
  );

  assert.match(source, /connected-app provider catalog/);
  assert.match(source, /providers\.yaml/);
  assert.match(source, /template-logos/);
  assert.doesNotMatch(source, /start-nango|docker compose|NANGO_API_KEY/i);
  assert.match(verifier, /connected-app provider catalog/);
});
