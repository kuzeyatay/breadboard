import assert from "node:assert/strict";
import test from "node:test";

import {
  GENOFFICE_APPS,
  GENOFFICE_PACKAGES,
  assertGenOfficeVendorDrift,
} from "../scripts/sync-genoffice.mjs";

const PIN = "f68df70e222d47aa08211f9a2d7748c610d1d6aa";

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
