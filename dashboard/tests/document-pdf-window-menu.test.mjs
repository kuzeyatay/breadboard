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
const sharedMenu = source("../src/app/components/link-context-menu.tsx");
const desktopSecurity = source("../../desktop/src/main/security.ts");
const desktopWindows = source("../../desktop/src/main/window-manager.ts");

test("right-clicking a source document exposes the PDF window action", () => {
  assert.match(menu, /<ContextMenuSurface/);
  assert.match(sharedMenu, /ContextMenuPrimitive\.Trigger asChild/);
  assert.match(workspace, /return isSource \? \(/);
  assert.match(
    workspace,
    /<DocumentContextMenu[\s\S]*?documentTitle=\{displayTitle\}[\s\S]*?pdfHref=\{isPdfSource \? documentHref : null\}/,
  );
  assert.match(workspace, /const isPdfSource = isSource && sourceDisplay\.hasPdf/);
  assert.match(menu, /Open PDF in new window/);
  assert.match(menu, /No PDF for this source/);
});

test("the PDF action uses the dashboard navbar's native popup contract", () => {
  assert.match(menu, /href=\{pdfHref\}/);
  assert.match(menu, /<OpenInNewWindowItem href=\{pdfHref\}/);
  assert.match(sharedMenu, /target="_blank"/);
  assert.match(sharedMenu, /rel="noopener noreferrer"/);
  assert.match(
    desktopSecurity,
    /setWindowOpenHandler[\s\S]*?onOpenLocalWindow\(url\)/,
  );
  assert.match(
    desktopWindows,
    /openPopupWindow\(targetUrl: string[^)]*\)[\s\S]*?loadThroughLoadingScene\(window, targetUrl\)/,
  );
});
