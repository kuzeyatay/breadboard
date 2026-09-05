import assert from "node:assert/strict";
import test from "node:test";

import { childProcessPath } from "./child-process-path.mjs";

test("Windows child paths remove only supported verbatim prefixes", () => {
  assert.equal(
    childProcessPath(String.raw`\\?\C:\Users\Breadboard\voicebox`, "win32"),
    String.raw`C:\Users\Breadboard\voicebox`,
  );
  assert.equal(
    childProcessPath(String.raw`\\?\UNC\server\share\voicebox`, "win32"),
    String.raw`\\server\share\voicebox`,
  );
  assert.throws(
    () => childProcessPath(String.raw`\\?\GLOBALROOT\Device\HarddiskVolume1`, "win32"),
    /no supported child-process spelling/u,
  );
  assert.equal(
    childProcessPath(String.raw`\\?\C:\voicebox`, "linux"),
    String.raw`\\?\C:\voicebox`,
  );
});

test("child paths reject missing values", () => {
  assert.throws(() => childProcessPath("", "win32"), /non-empty string/u);
});
