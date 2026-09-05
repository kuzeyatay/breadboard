import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CURRENT_LOCATION_PREFERENCE_STATE_FILE,
  readCurrentLocationPreference,
  writeCurrentLocationPreference,
} from "../src/main/current-location-preference";

test("desktop current-location consent persists and distinguishes no choice", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-current-location-"));
  try {
    assert.equal(readCurrentLocationPreference(fixture), null);

    writeCurrentLocationPreference(fixture, true);
    assert.equal(readCurrentLocationPreference(fixture), true);

    writeCurrentLocationPreference(fixture, false);
    assert.equal(readCurrentLocationPreference(fixture), false);

    fs.writeFileSync(
      path.join(fixture, CURRENT_LOCATION_PREFERENCE_STATE_FILE),
      JSON.stringify({ enabled: "true" }),
    );
    assert.equal(readCurrentLocationPreference(fixture), null);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
