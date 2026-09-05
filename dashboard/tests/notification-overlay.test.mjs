import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

test("desktop notifications use one native overlay above every tab surface", () => {
  const toast = source("../src/app/components/toast.tsx");
  const overlay = source(
    "../src/app/notification-overlay/notification-overlay-client.tsx",
  );
  const bridge = source("../src/lib/desktop-notification-overlay.ts");
  const styles = source("../src/app/globals.css");

  assert.match(toast, /publishDesktopNotificationToast\(\{ message, type, title, chatId, response \}\)/);
  assert.match(toast, /!desktopOverlay/);
  assert.match(toast, /mode\?: 'page' \| 'desktop-overlay'/);
  assert.match(toast, /z-\[10000\]/);
  assert.match(toast, /text-\[#fff\]/);
  assert.match(toast, /disabled:text-\[#fff\]/);
  assert.doesNotMatch(toast, /disabled:opacity-45/);

  assert.match(overlay, /onDesktopNotificationToast/);
  assert.match(overlay, /useToast\(\{ desktopOverlay: true \}\)/);
  assert.match(overlay, /resizeDesktopNotificationOverlay/);
  assert.match(overlay, /mode="desktop-overlay"/);
  assert.match(overlay, /onOpenChat=\{openDesktopNotificationTarget\}/);
  assert.match(bridge, /tabs\(\{ type: "open", url \}\)/);
  assert.match(styles, /html\[data-breadboard-desktop="true"\] \.bb-page-toast-host/);
  assert.match(styles, /background: transparent !important/);
});
