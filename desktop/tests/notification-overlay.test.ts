import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

import {
  createDesktopApi,
  type IpcRendererLike,
} from "../src/preload/preload";
import {
  IPC_CHANNELS,
  isDesktopNotificationToast,
  isNotificationOverlaySize,
  isTabsCommand,
} from "../src/shared/ipc-contract";

class FakeIpcRenderer implements IpcRendererLike {
  readonly calls: Array<{ channel: string; args: unknown[] }> = [];
  readonly listeners = new Map<string, (event: unknown, payload: unknown) => void>();

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    this.calls.push({ channel, args });
    return true;
  }

  on(channel: string, listener: (event: unknown, payload: unknown) => void): void {
    this.listeners.set(channel, listener);
  }
}

test("the notification overlay IPC accepts only bounded card data", () => {
  assert.equal(
    isDesktopNotificationToast({
      title: "Task completed",
      message: "Finished the task.",
      type: "success",
      id: "toast:notification-1",
    }),
    true,
  );
  assert.equal(
    isDesktopNotificationToast({ message: "", type: "success" }),
    false,
  );
  for (const id of ["", 7, "x".repeat(257)]) {
    assert.equal(isDesktopNotificationToast({ id, message: "Finished.", type: "success" }), false);
  }
  assert.equal(
    isDesktopNotificationToast({ message: "Nope", type: "warning" }),
    false,
  );
  assert.equal(
    isDesktopNotificationToast({
      message: "Too much",
      type: "error",
      response: "x".repeat(100_001),
    }),
    false,
  );

  assert.equal(isNotificationOverlaySize({ width: 608, height: 424 }), true);
  assert.equal(isNotificationOverlaySize({ width: -1, height: 424 }), false);
  assert.equal(isNotificationOverlaySize({ width: Infinity, height: 424 }), false);
  assert.equal(
    isTabsCommand({
      type: "notification-toast",
      notice: { message: "Finished.", type: "success" },
    }),
    true,
  );
  assert.equal(
    isTabsCommand({
      type: "notification-overlay-resize",
      size: { width: 608, height: 424 },
    }),
    true,
  );
});

test("the desktop manager owns and repeatedly raises the shared overlay", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/main/tab-manager.ts"),
    "utf8",
  );
  assert.match(source, /NOTIFICATION_OVERLAY_PATH = "\/notification-overlay"/);
  assert.match(source, /notificationOverlay: NotificationOverlay \| null/);
  assert.match(source, /contentView\.addChildView\(overlay\.view\)/);
  assert.match(source, /this\.raiseNotificationOverlay\(host\)/);
  assert.match(source, /this\.layoutNotificationOverlay\(host\)/);
});

test("website permission responses and cards validate the request identity and choice", () => {
  const request = { id: "permission-request", origin: "https://www.youtube.com" };
  assert.equal(isDesktopNotificationToast({ type: "success", message: "Allow notifications?", notificationPermission: request }), true);
  for (const invalid of [{ ...request, id: "" }, { ...request, id: "x".repeat(101) }, { ...request, origin: "file:///tmp/site" }, { ...request, origin: null }]) {
    assert.equal(isDesktopNotificationToast({ type: "success", message: "Allow notifications?", notificationPermission: invalid }), false);
  }
  for (const permission of ["default", "granted", "denied"]) {
    assert.equal(isTabsCommand({ type: "browser-notification-permission-response", id: request.id, permission }), true);
  }
  for (const permission of ["allow", true, undefined, ["granted"]]) {
    assert.equal(isTabsCommand({ type: "browser-notification-permission-response", id: request.id, permission }), false);
  }
  assert.equal(isTabsCommand({ type: "browser-notification-permission-response", id: "", permission: "granted" }), false);
});

test("the preload bridge carries local cards and overlay measurements", async () => {
  const ipc = new FakeIpcRenderer();
  const api = createDesktopApi(ipc);
  const received: unknown[] = [];
  const unsubscribe = api.onNotificationToast((notice) => received.push(notice));
  const notice = { message: "Finished.", type: "success" as const };

  ipc.listeners.get(IPC_CHANNELS.notificationToast)?.({}, notice);
  assert.deepEqual(received, [notice]);
  unsubscribe();
  ipc.listeners.get(IPC_CHANNELS.notificationToast)?.({}, notice);
  assert.deepEqual(received, [notice]);

  await api.publishNotificationToast(notice);
  await api.resizeNotificationOverlay({ width: 608, height: 424 });
  assert.deepEqual(ipc.calls, [
    {
      channel: IPC_CHANNELS.tabsCommand,
      args: [{ type: "notification-toast", notice }],
    },
    {
      channel: IPC_CHANNELS.tabsCommand,
      args: [
        {
          type: "notification-overlay-resize",
          size: { width: 608, height: 424 },
        },
      ],
    },
  ]);
});

test("notification navigation validates bounded destinations and allows clearing tab targets", () => {
  const urls = ["http://127.0.0.1:3000/dashboard?terminalChat=conv_1"];
  assert.equal(isTabsCommand({ type: "notification-open", urls }), true);
  assert.equal(isTabsCommand({ type: "notification-targets", urls }), true);
  assert.equal(isTabsCommand({ type: "notification-targets", urls: [] }), true);
  assert.equal(isTabsCommand({ type: "notification-open", urls: [] }), false);
  for (const type of ["notification-open", "notification-targets"]) {
    for (const invalid of [null, "url", [42], [""], ["x".repeat(8_193)], Array(9).fill(urls[0])]) {
      assert.equal(isTabsCommand({ type, urls: invalid }), false);
    }
  }
});

test("overlay visibility starts silent, replays for late subscribers, and follows native hiding", () => {
  const ipc = new FakeIpcRenderer();
  const api = createDesktopApi(ipc);
  const received: boolean[] = [];
  const unsubscribe = api.onNotificationOverlayVisibility(visible => received.push(visible));
  assert.deepEqual(received, [false]);
  ipc.listeners.get(IPC_CHANNELS.notificationOverlayVisibility)?.({}, true);
  ipc.listeners.get(IPC_CHANNELS.notificationOverlayVisibility)?.({}, false);
  assert.deepEqual(received, [false, true, false]);
  unsubscribe();
  ipc.listeners.get(IPC_CHANNELS.notificationOverlayVisibility)?.({}, true);
  assert.deepEqual(received, [false, true, false]);
  const late: boolean[] = [];
  api.onNotificationOverlayVisibility(visible => late.push(visible));
  assert.deepEqual(late, [true]);
});
