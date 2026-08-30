import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workspace = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
  "utf8",
);

test("an active garden upload can be dismissed without a redundant background button", () => {
  assert.match(
    workspace,
    /function continueUploadInBackground\(\) \{\s*if \(!isUploading\) return;[\s\S]*?setShowUpload\(false\);\s*\}/,
  );
  assert.doesNotMatch(workspace, /Close &amp; continue in background/);
  assert.doesNotMatch(
    workspace.match(/function continueUploadInBackground\(\)[\s\S]*?\n  \}/)?.[0] ?? "",
    /abort\(/,
  );
});

test("a dismissed upload remains visible and clickable under Documents", () => {
  assert.match(
    workspace,
    /function continueUploadInBackground\(\)[\s\S]*?setSourceDocsExpanded\(true\);[\s\S]*?setShowUpload\(false\);/,
  );
  assert.match(
    workspace,
    /\{isUploading && \([\s\S]*?uploadFiles\.map[\s\S]*?onClick=\{openUploadModal\}[\s\S]*?<Spinner/,
  );
  assert.match(workspace, /View upload progress for \$\{file\.name\}/);
  assert.match(workspace, /step \|\| "Uploading…"/);
  assert.match(workspace, /sourceDocuments\.length === 0 \? \(\s*!isUploading &&/);
});

test("clicking outside an active upload backgrounds it instead of canceling it", () => {
  assert.match(
    workspace,
    /className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"\s*onClick=\{\(e\) => \{\s*if \(e\.target !== e\.currentTarget\) return;\s*if \(isUploading\) continueUploadInBackground\(\);\s*else closeUploadModal\(\);/,
  );
});

test("the live upload can be reopened and reports completion as a success toast", () => {
  assert.match(
    workspace,
    /function openUploadModal\(\) \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if \(isUploading\) \{\s*setShowUpload\(true\);\s*return;/,
  );
  assert.match(
    workspace,
    /`Added \$\{successCount\}[\s\S]*?"success",\s*"Upload complete"/,
  );
  assert.match(
    workspace,
    /<Toaster[\s\S]*?toasts=\{toasts\}[\s\S]*?onDismiss=\{dismissToast\}[\s\S]*?onOpenChat=\{openChatById\}[\s\S]*?\/>/,
  );
});
