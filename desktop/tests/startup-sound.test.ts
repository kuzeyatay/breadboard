import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  STARTUP_SOUND_STATE_FILE,
  readStartupSoundEnabled,
  writeStartupSoundEnabled,
} from "../src/main/startup-sound";

test("the startup chime is on until it is switched off, and stays off", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-startup-sound-"));
  try {
    // An install that has never touched the setting still has a chime.
    assert.equal(readStartupSoundEnabled(fixture), true);

    writeStartupSoundEnabled(fixture, false);
    assert.equal(readStartupSoundEnabled(fixture), false);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(fixture, STARTUP_SOUND_STATE_FILE), "utf8")),
      { enabled: false },
    );

    writeStartupSoundEnabled(fixture, true);
    assert.equal(readStartupSoundEnabled(fixture), true);

    // Only an explicit `false` mutes. Anything unreadable leaves the sound on,
    // because a corrupted file is not a decision somebody made.
    for (const contents of ["{}", '{"enabled":"no"}', "not json at all"]) {
      fs.writeFileSync(path.join(fixture, STARTUP_SOUND_STATE_FILE), contents);
      assert.equal(readStartupSoundEnabled(fixture), true, contents);
    }

    fs.rmSync(path.join(fixture, STARTUP_SOUND_STATE_FILE));
    assert.equal(readStartupSoundEnabled(fixture), true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("the preference is written into a config folder that does not exist yet", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "bb-startup-sound-new-"));
  const configDir = path.join(parent, "config");
  try {
    writeStartupSoundEnabled(configDir, false);
    assert.equal(readStartupSoundEnabled(configDir), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
