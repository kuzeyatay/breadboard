import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const buildSource = fs.readFileSync(
  new URL("../scripts/build-dashboard.mjs", import.meta.url),
  "utf8",
);

test("every direct standalone dashboard build preserves Windows commit headroom", () => {
  assert.match(
    buildSource,
    /import \{ assertWindowsCommitHeadroom \} from "\.\/commit-preflight\.mjs";/u,
  );
  assert.match(
    buildSource,
    /assertWindowsCommitHeadroom\(\{\s*operation: "standalone dashboard build",\s*estimateMb: 11_264,\s*\}\);/u,
  );
  assert.ok(
    buildSource.indexOf("assertWindowsCommitHeadroom") <
      buildSource.indexOf("beginDashboardBuild(repoRoot)"),
    "resource admission must precede any managed build-tree mutation",
  );
});
