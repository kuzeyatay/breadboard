import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const quartzPage = fs.readFileSync(
  new URL("../src/app/garden/[clusterSlug]/page.tsx", import.meta.url),
  "utf8",
);

test("the Quartz page toolbar uses Breadboard's warm paper background", () => {
  assert.match(
    quartzPage,
    /<header className="[^"]*bg-\[#faf7ef\][^"]*"/,
  );
});
