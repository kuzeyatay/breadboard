import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(relativeUrl) {
  return fs.readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

const workspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const menu = source("../src/app/components/document-context-menu.tsx");
const desktopSecurity = source("../../desktop/src/main/security.ts");
const desktopWindows = source("../../desktop/src/main/window-manager.ts");

test("right-clicking a source document exposes the PDF window action", () => {
  assert.match(menu, /ContextMenuPrimitive\.Trigger asChild/);
  assert.match(workspace, /return isSource \? \(/);
  assert.match(
    workspace,
    /<DocumentContextMenu[\s\S]*?documentTitle=\{displayTitle\}[\s\S]*?pdfHref=\{isPdfSource \? documentHref : null\}/,
  );
  assert.match(menu, /Open PDF viewer in new window/);
  assert.match(menu, /PDF viewer unavailable/);
});

test("the PDF action uses the dashboard navbar's native popup contract", () => {
  assert.match(menu, /href=\{pdfHref\}/);
  assert.match(menu, /target="_blank"/);
  assert.match(menu, /rel="noopener noreferrer"/);
  assert.match(
    desktopSecurity,
    /setWindowOpenHandler[\s\S]*?onOpenLocalWindow\(url\)/,
  );
  assert.match(
    desktopWindows,
    /openPopupWindow\(targetUrl: string\)[\s\S]*?loadThroughLoadingScene\(window, targetUrl\)/,
  );
});
