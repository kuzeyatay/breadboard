import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("workflows are created, taught and listed in Spaces, with no workflows home of their own", () => {
  const home = source("../src/app/spaces/spaces-home.tsx");
  const page = source("../src/app/workflows/page.tsx");
  assert.match(home, /Create workflow/);
  assert.match(home, /Teach workflow/);
  assert.match(home, /"\/workflows\?teach=1"/);
  assert.match(home, /\{ id: "workflows", label: "Workflows" \}/);
  assert.match(page, /if \(!workflowId && value\("teach"\) !== "1"\) redirect\("\/spaces"\)/);
});

test("the workflow editor sits under the Spaces header with the Garden assistant", () => {
  const editor = source("../src/app/workflows/components/canvas-editor.tsx");
  const shell = source("../src/app/spaces/spaces-shell.tsx");
  assert.match(editor, /<SpacesShell/);
  assert.match(editor, /pageKey=\{`workflow:\$\{workflowId\}`\}/);
  assert.doesNotMatch(editor, /All workflows/);
  assert.match(shell, /<GardenAssistantSwitch/);
});

test("starter workflows are seeded once as ordinary rows, with no label setting them apart", () => {
  const starters = source("../src/lib/workflows/starter-workflows.ts");
  const store = source("../src/lib/workflows/store.ts");
  assert.match(store, /ensureStarterWorkflows\(userId\);/);
  assert.match(starters, /INSERT OR IGNORE INTO workflow_starter_seeds/);
  assert.match(starters, /INSERT INTO workflows \(id, user_id, name, description, state\)/);
  assert.equal((starters.match(/^\s{4}name: "/gm) ?? []).length, 5);
  // Names read like any workflow the user would make: nothing marks them as examples.
  assert.doesNotMatch(starters, /^\s{4}name: "[^"]*(?:example|sample|template|demo)/gim);
});

test("a run's result is saved into a workspace from the run's own record", () => {
  const route = source("../src/app/api/workflows/[id]/save-output/route.ts");
  const save = source("../src/lib/workflows/output-to-spaces.ts");
  const drawer = source("../src/app/workflows/components/run-drawer.tsx");
  assert.match(route, /requireUserId/);
  assert.match(save, /JOIN workflows w ON w\.id = r\.workflow_id[\s\S]*w\.user_id = \?/);
  assert.match(save, /saveToSpaces\(/);
  assert.match(drawer, /\/save-output/);
  assert.match(drawer, /Save to a workspace/);
});
