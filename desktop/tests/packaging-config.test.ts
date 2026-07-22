import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const desktopRoot = path.resolve(__dirname, "..", "..");

test("Windows packages embed the Breadboard application icon", () => {
  const config = fs.readFileSync(
    path.join(desktopRoot, "electron-builder.yml"),
    "utf8",
  );
  const iconPath = path.join(desktopRoot, "assets", "icon.ico");
  const icon = fs.readFileSync(iconPath);

  assert.match(config, /^  icon: assets\/icon\.ico$/m);
  assert.match(config, /^  signAndEditExecutable: true$/m);
  assert.equal(icon.readUInt16LE(0), 0, "ICO reserved header must be zero");
  assert.equal(icon.readUInt16LE(2), 1, "asset must be a Windows icon");
  assert.ok(icon.readUInt16LE(4) >= 7, "icon must include the full Windows size set");
});
