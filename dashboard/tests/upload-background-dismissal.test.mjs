import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workspace = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
  "utf8",
);
const store = fs.readFileSync(
  new URL("../src/lib/garden-upload-store.ts", import.meta.url),
  "utf8",
);

test("the Documents add action always opens a fresh upload draft", () => {
  const openUploadModal =
    workspace.match(/function openUploadModal\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";

  assert.match(openUploadModal, /selectedUploadTaskIdRef\.current = null/);
  assert.match(openUploadModal, /setSelectedUploadTaskId\(null\)/);
  assert.match(openUploadModal, /setUploadFiles\(\[\]\)/);
  assert.match(openUploadModal, /setShowUpload\(true\)/);
  assert.doesNotMatch(openUploadModal, /if \(isUploading\)/);
});

test("each submission starts an independent concurrent upload task", () => {
  const handleUpload =
    workspace.match(/function handleUpload\(e: React\.FormEvent\) \{[\s\S]*?\n  \}/)?.[0] ?? "";

  assert.match(handleUpload, /if \(uploadFiles\.length === 0\) return/);
  assert.doesNotMatch(handleUpload, /\|\| isUploading/);
  assert.match(handleUpload, /const taskId = startGardenUploadTask\(\{/);
  assert.match(store, /abortControllers\.set\(taskId, abortController\)/);
  assert.match(store, /recoveryRequestIds\.set\(taskId, new Set\(\)\)/);
});

test("upload tasks live outside the page so navigation cannot lose them", () => {
  // The engine and its task list are module state, not component state: the
  // workspace only subscribes while mounted.
  assert.match(store, /let tasks: readonly GardenUploadTask\[\] = \[\]/);
  assert.match(
    workspace,
    /useSyncExternalStore\(\s*subscribeGardenUploads,\s*gardenUploadTasksSnapshot,/,
  );
  assert.doesNotMatch(workspace, /useState<UploadTask\[\]>/);
  assert.doesNotMatch(workspace, /async function runUploadTask/);
  // A task only ends when its files settle or the user cancels; nothing in
  // the store aborts on unmount, and the page hands its notification and
  // refresh hooks to the engine while mounted.
  assert.match(workspace, /registerGardenUploadSink\(clusterSlug, \{/);
  assert.doesNotMatch(store, /addEventListener\("beforeunload"/);
  // The remount recovery pass must not double-attach to jobs the live engine
  // still owns.
  assert.match(
    workspace,
    /if \(hasLiveGardenUploadRequest\(stored\.requestId\)\) continue;/,
  );
});

test("the store persists recovery identity before submitting each file", () => {
  const requestIdentity = store.indexOf("const requestId = crypto.randomUUID()");
  const persisted = store.indexOf("beginRuntimeIngestRecovery({", requestIdentity);
  const submitted = store.indexOf('fetch("/api/ingest"', persisted);
  assert.ok(requestIdentity >= 0 && requestIdentity < persisted);
  assert.ok(persisted < submitted, "recovery identity must persist before POST");
  assert.match(store, /X-Breadboard-Ingest-Cluster-Slug/);
  assert.match(store, /X-Breadboard-Ingest-File-Size/);
  assert.match(store, /X-Breadboard-Ingest-Request-Id/);
});

test("only a loading document row opens that task's status", () => {
  assert.match(
    workspace,
    /\{activeUploadTasks\.flatMap\(\(task\) =>[\s\S]*?task\.files\.map\(\(file\) =>/,
  );
  assert.match(workspace, /onClick=\{\(\) => openUploadTask\(task\.id\)\}/);
  assert.match(workspace, /View upload progress for \$\{file\.name\}/);
  assert.match(workspace, /step \|\| "Uploading…"/);
  assert.doesNotMatch(
    workspace.match(/\{activeUploadTasks\.length > 0[\s\S]*?\n\s*\)\}/)?.[0] ?? "",
    /onClick=\{openUploadModal\}/,
  );
});

test("dismissing one status view backgrounds only that selected task", () => {
  assert.match(
    workspace,
    /function continueUploadInBackground\(\) \{\s*if \(!selectedUploadTaskId\) return;[\s\S]*?setSourceDocsExpanded\(true\);[\s\S]*?setShowUpload\(false\);\s*\}/,
  );
  assert.match(
    workspace,
    /if \(modalIsUploading\) continueUploadInBackground\(\);\s*else closeUploadModal\(\);/,
  );
  assert.doesNotMatch(
    workspace.match(/function continueUploadInBackground\(\)[\s\S]*?\n  \}/)?.[0] ?? "",
    /abort\(/,
  );
});

test("finished concurrent uploads still report success", () => {
  assert.match(
    store,
    /`Added \$\{successCount\}[\s\S]*?type: "success",\s*title: "Upload complete"/,
  );
  // Toasts raised while the page was away queue and deliver on return.
  assert.match(store, /queuedToasts/);
  assert.match(
    workspace,
    /<Toaster[\s\S]*?toasts=\{toasts\}[\s\S]*?onDismiss=\{dismissToast\}[\s\S]*?onOpenChat=\{openChatFromNotification\}[\s\S]*?\/>/,
  );
});
