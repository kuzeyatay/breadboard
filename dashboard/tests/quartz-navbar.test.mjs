import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const quartzPage = fs.readFileSync(
  new URL("../src/app/garden/[clusterSlug]/page.tsx", import.meta.url),
  "utf8",
);
const globalStyles = fs.readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

test("the Quartz page toolbar uses Breadboard's warm paper background", () => {
  assert.match(quartzPage, /<header className="[^"]*breadboard-flower-navbar[^"]*"/);
  assert.match(globalStyles, /--paper-surface:\s*#faf7ef/);
  assert.match(
    globalStyles,
    /\.breadboard-flower-navbar\s*\{\s*background-color:\s*var\(--paper-surface\)/,
  );
});
