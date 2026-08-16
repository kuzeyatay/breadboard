import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const gardensApiDir = path.resolve(
  import.meta.dirname,
  "../src/app/api/gardens",
);

test("Garden API routes share one Next dynamic segment identity", () => {
  const dynamicSegments = fs
    .readdirSync(gardensApiDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\[[^\]]+\]$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(
    dynamicSegments,
    ["[gardenId]"],
    "Next rejects sibling dynamic folders that describe the same URL segment with different parameter names",
  );

  for (const route of ["learn/plan/route.ts", "learn/status/route.ts", "settings/route.ts"]) {
    assert.equal(
      fs.existsSync(path.join(gardensApiDir, "[gardenId]", ...route.split("/"))),
      true,
      `missing registered Garden API route: ${route}`,
    );
  }

  const settingsRoute = fs.readFileSync(
    path.join(gardensApiDir, "[gardenId]", "settings", "route.ts"),
    "utf8",
  );
  assert.match(settingsRoute, /params:\s*Promise<\{ gardenId: string \}>/);
  assert.doesNotMatch(settingsRoute, /clusterSlug/);
});
