import { test } from "node:test";
import assert from "node:assert/strict";
import { openMicrophoneSettings } from "../src/main/microphone-settings";

test("Windows opens the microphone privacy settings page", async () => {
  const opened: string[] = [];
  const result = await openMicrophoneSettings({
    platform: "win32",
    openExternal: async (url) => {
      opened.push(url);
    },
  });
  assert.equal(result, true);
  assert.deepEqual(opened, ["ms-settings:privacy-microphone"]);
});

test("macOS asks again before falling back to the microphone privacy pane", async () => {
  const opened: string[] = [];
  const result = await openMicrophoneSettings({
    platform: "darwin",
    requestMacAccess: async () => false,
    openExternal: async (url) => {
      opened.push(url);
    },
  });
  assert.equal(result, true);
  assert.match(opened[0] ?? "", /Privacy_Microphone/);
});

test("platforms without a stable microphone settings URI report the fallback", async () => {
  assert.equal(
    await openMicrophoneSettings({
      platform: "linux",
      openExternal: async () => assert.fail("Linux should not guess a desktop-specific URI"),
    }),
    false,
  );
});
