import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url),
  "utf8",
);

test("new cluster uses the styled dashboard dialog instead of a browser prompt", () => {
  assert.doesNotMatch(source, /window\.prompt\("New cluster name"\)/);
  assert.match(source, /aria-labelledby="new-cluster-title"/);
  assert.match(source, /onSubmit=\{handleCreateClusterFolder\}/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(
    source,
    /disabled=\{isPending \|\| !clusterFolderName\.trim\(\)\}/,
  );
  assert.doesNotMatch(source, /Organize gardens/);
  assert.doesNotMatch(source, /Create a named group for related gardens/);
  assert.doesNotMatch(source, /e\.g\. EE Year 1/);
});
