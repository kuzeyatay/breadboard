import test from "node:test";
import assert from "node:assert/strict";
import { groupArtifactVersions } from "../src/lib/hermes/artifact-search.ts";

test("an artifact with several versions is one group, newest version first", () => {
  const groups = groupArtifactVersions([
    { id: "b", version: 1 }, { id: "a", version: 2 }, { id: "a", version: 3 }, { id: "a", version: 1 },
  ]);
  assert.deepEqual(groups.map(group => [group.id, group.versions.map(v => v.version)]), [["b", [1]], ["a", [3, 2, 1]]]);
});
