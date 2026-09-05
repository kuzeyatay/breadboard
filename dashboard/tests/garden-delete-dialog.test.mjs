import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dashboard = fs.readFileSync(
  new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url),
  "utf8",
);

test("garden cards use a trash icon for deletion", () => {
  const deleteButton = dashboard.match(
    /<button\s+data-card-action="true"[\s\S]*?title="Delete garden"[\s\S]*?<\/button>/,
  )?.[0];

  assert.ok(deleteButton, "the garden delete button should be present");
  assert.match(deleteButton, /M4 7h16/);
  assert.doesNotMatch(deleteButton, /M6 18 18 6M6 6l12 12/);
});

test("garden deletion opens the shared destructive confirmation dialog", () => {
  assert.match(dashboard, /import \{ ConfirmDialog \}/);
  assert.match(dashboard, /<ConfirmDialog\s+title="Delete garden\?"/);
  assert.match(dashboard, /subject=\{gardenPendingDeletion\.name\}/);
  assert.match(dashboard, /This action cannot be undone\./);
  assert.match(dashboard, /confirmLabel="Delete garden"/);
  assert.doesNotMatch(dashboard, />\s*Delete\?\s*<\/span>/);
});

test("garden deletions run independently and survive page navigation", () => {
  assert.match(dashboard, /const \[deletingIds, setDeletingIds\] = useState<Set<number>>/);
  assert.match(dashboard, /const isDeleting = deletingIds\.has\(cluster\.id\)/);
  assert.match(dashboard, /deletingIdsRef\.current\.has\(clusterId\)/);
  assert.match(dashboard, /method: "DELETE",[\s\S]*?keepalive: true/);
  assert.match(dashboard, /data\?\.deleted !== true \|\| data\.verified !== true/);
  assert.match(dashboard, /backdrop-blur-\[1\.5px\]/);
  assert.match(dashboard, /Deleting in background…/);
  assert.doesNotMatch(dashboard, /disabled=\{isDeleting \|\| isPending\}/);
});
