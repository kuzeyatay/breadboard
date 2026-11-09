import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url),
  "utf8",
);

test("new garden only shows a pending state after its own form is submitted", () => {
  assert.match(
    source,
    /const \[isCreatingGarden, setIsCreatingGarden\] = useState\(false\);/,
  );

  const createHandler = source.slice(
    source.indexOf("function handleCreate("),
    source.indexOf("function handleUpdateCluster("),
  );
  assert.match(createHandler, /creatingGardenRef\.current \|\| !name\.trim\(\)/);
  assert.match(createHandler, /setIsCreatingGarden\(true\)/);
  assert.match(createHandler, /finally \{[\s\S]*setIsCreatingGarden\(false\)/);
  assert.match(createHandler, /fetch\("\/api\/clusters"/);
  assert.match(createHandler, /setMyClusters\(/);
  assert.doesNotMatch(createHandler, /router\.refresh\(/);
  assert.doesNotMatch(createHandler, /startTransition\(async \(\) =>/);

  const createDialog = source.slice(
    source.indexOf("{modalOpen && ("),
    source.indexOf("{editingCluster && ("),
  );
  assert.match(
    createDialog,
    /disabled=\{isCreatingGarden \|\| !name\.trim\(\)\}/,
  );
  assert.match(
    createDialog,
    /\{isCreatingGarden \? "Creating\.\.\." : "Create"\}/,
  );
  assert.doesNotMatch(createDialog, /\bisPending\b/);
});
