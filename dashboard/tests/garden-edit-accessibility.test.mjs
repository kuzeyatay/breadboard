import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(
  new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url),
  "utf8",
);

test("the edit-garden modal exposes a named dialog and associated fields", () => {
  assert.match(
    workspace,
    /role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="edit-garden-title"/,
  );
  assert.match(workspace, /id="edit-garden-title"[\s\S]*?>\s*Edit garden/);
  assert.match(
    workspace,
    /htmlFor="edit-garden-name"[\s\S]*?>\s*Name\s*<\/label>[\s\S]*?<input\s+id="edit-garden-name"/,
  );
  assert.match(
    workspace,
    /htmlFor="edit-garden-description"[\s\S]*?>\s*Description\s*<\/label>[\s\S]*?<textarea\s+id="edit-garden-description"/,
  );
});
