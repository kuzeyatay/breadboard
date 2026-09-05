import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(
  new URL("../src/app/garden/page.tsx", import.meta.url),
  "utf8",
);
const client = fs.readFileSync(
  new URL("../src/app/garden/library-garden-client.tsx", import.meta.url),
  "utf8",
);
const index = fs.readFileSync(
  new URL("../src/lib/quartz-garden-index.ts", import.meta.url),
  "utf8",
);
const dashboard = fs.readFileSync(
  new URL("../src/app/dashboard/dashboard-page-shell.tsx", import.meta.url),
  "utf8",
);

test("library routes publish a stale account index before resolving navigation", () => {
  assert.match(page, /preparePrivateQuartzIndex\(userId\)/);
  assert.match(page, /preparePublicQuartzIndex\(\)/);
  assert.match(page, /prepareOrganizationQuartzIndex\(userId\)/);
  assert.match(
    page,
    /if \(preparedIndex\?\.publishRequired\) \{[\s\S]*await waitForQuartzPublicationInFlight\(\)[\s\S]*prepareRequestedIndex\(\)[\s\S]*await publishQuartzAfterMutation\([\s\S]*requireSuccess: true/,
  );
  assert.match(index, /writeIndexIfChanged\(sourcePath, content\)/);
  assert.match(index, /output\.mtimeMs >= sourceModifiedAt/);
  assert.match(index, /path\.join\(publicRoot, pageSlug, "index\.html"\)/);
  assert.match(index, /path\.join\(publicRoot, `\$\{pageSlug\}\.html`\)/);
});

test("a dashboard cluster gets its own subtree-scoped Quartz index", () => {
  assert.match(page, /preparePrivateClusterQuartzIndex\(userId, rawCluster\)/);
  assert.match(page, /const viewTitle = preparedIndex\?\.title \?\? VIEW_TITLES\[view\]/);
  assert.match(index, /export function preparePrivateClusterQuartzIndex/);
  assert.match(index, /isInSubtree\(row\.folder, cleanFolder\)/);
  assert.match(index, /cluster-\$\{scopeToken\}/);
});

test("dashboard publication materializes every cluster view before navigation", () => {
  assert.match(index, /export function preparePrivateQuartzIndexes/);
  assert.match(index, /for \(const folder of listFolders\(db, userId\)\)/);
  assert.match(
    index,
    /refreshPrivateQuartzIndex\(userId: number\)[\s\S]*preparePrivateQuartzIndexes\(userId\)/,
  );
  assert.match(dashboard, /preparePrivateQuartzIndexes\(userId\)/);
  assert.match(dashboard, /publishQuartzIndexesIfIdle\("prepare dashboard cluster garden indexes", userId\)/);
});

test("My garden delegates pending navigation feedback to the global blue bar", () => {
  assert.doesNotMatch(client, /\[0, 1, 2\]\.map/);
  assert.doesNotMatch(client, /animate-pulse/);
  assert.doesNotMatch(client, /loadedSource|isLoaded/);
  assert.match(client, /\{quartzUnavailable && \(/);
  assert.match(client, /Quartz did not respond/);
});
