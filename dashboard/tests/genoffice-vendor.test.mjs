import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  GENOFFICE_APPS,
  GENOFFICE_PACKAGES,
  assertGenOfficeVendorDrift,
} from "../scripts/sync-genoffice.mjs";

const PIN = "f68df70e222d47aa08211f9a2d7748c610d1d6aa";
const dashboardRoot = path.resolve(import.meta.dirname, "..");

test("the GenOffice source copy is byte-identical to the pinned clone", async () => {
  assert.deepEqual(GENOFFICE_PACKAGES, [
    "docx-engine",
    "pptx-engine",
    "pptx-render",
    "font-metrics",
    "pdf2docx",
    "ui",
    "i18n",
  ]);
  assert.deepEqual(GENOFFICE_APPS, ["docs"]);
  assert.equal(await assertGenOfficeVendorDrift(), PIN);
});

test("the desktop typecheck uses the materialized GenOffice overrides", () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(dashboardRoot, "tsconfig.desktop.json"), "utf8"),
  );
  for (const generatedSource of [
    "src/vendor-overrides",
    "src/vendor/genoffice/docs/src/renderer/ai",
  ]) {
    assert.ok(config.exclude.includes(generatedSource));
  }

  const relativePanel = "genoffice/docs/src/renderer/ai/AiPanel.tsx";
  const overridePanel = path.join(dashboardRoot, "src/vendor-overrides", relativePanel);
  const vendoredPanel = path.join(dashboardRoot, "src/vendor", relativePanel);
  assert.deepEqual(fs.readFileSync(vendoredPanel), fs.readFileSync(overridePanel));
  assert.ok(fs.existsSync(path.join(path.dirname(vendoredPanel), "tools.ts")));
});
