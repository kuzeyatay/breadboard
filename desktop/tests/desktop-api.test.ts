import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDesktopApi,
  PRELOAD_IPC_CHANNELS,
  type IpcRendererLike,
  type StartupStateView,
} from "../src/preload/preload";
import { IPC_CHANNELS } from "../src/shared/ipc-contract";

class FakeIpcRenderer implements IpcRendererLike {
  readonly calls: Array<{ channel: string; args: unknown[] }> = [];
  readonly listeners = new Map<string, (event: unknown, payload: unknown) => void>();

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    this.calls.push({ channel, args });
    if (channel === IPC_CHANNELS.getVersions) return { app: "0.1.0", electron: "33.3.1" };
    if (channel === IPC_CHANNELS.getStartupState) {
      return { phase: "preparing", message: "Preparing", services: [] };
    }
    if (channel === IPC_CHANNELS.retryService) return true;
    if (channel === IPC_CHANNELS.restartApp) return true;
    if (channel === IPC_CHANNELS.openMicrophoneSettings) return true;
    if (channel === IPC_CHANNELS.allowThemeLocation) return true;
    if (channel === IPC_CHANNELS.setTheme) return true;
    if (channel === IPC_CHANNELS.getStartupSound) return false;
    if (channel === IPC_CHANNELS.setStartupSound) return true;
    if (channel === IPC_CHANNELS.getCurrentLocationPreference) return true;
    if (channel === IPC_CHANNELS.setCurrentLocationPreference) return true;
    if (channel === IPC_CHANNELS.getBrowserBookmarks) {
      return [{ url: "https://example.com/", title: "Example", iconUrl: "https://example.com/favicon.ico" }];
    }
    if (channel === IPC_CHANNELS.setBrowserBookmarks) return true;
    if (channel === IPC_CHANNELS.getBrowserShortcuts) return [];
    if (channel === IPC_CHANNELS.setBrowserShortcuts) return true;
    if (channel === IPC_CHANNELS.getClickyState) {
      return {
        supported: true,
        available: true,
        projectAvailable: true,
        status: "ready",
        message: "Clicky is ready.",
      };
    }
    if (channel === IPC_CHANNELS.launchClicky) {
      return {
        ok: true,
        code: "launched",
        message: "Clicky launched.",
        state: {
          supported: true,
          available: true,
          projectAvailable: true,
          status: "ready",
          message: "Clicky is ready.",
        },
      };
    }
    if (channel === IPC_CHANNELS.openClickyProject) {
      return {
        ok: true,
        code: "project_opened",
        message: "The Clicky project opened.",
        state: {
          supported: true,
          available: false,
          projectAvailable: true,
          status: "not_built",
          message: "Build Clicky once.",
        },
      };
    }
    return undefined;
  }

  on(channel: string, listener: (event: unknown, payload: unknown) => void): void {
    this.listeners.set(channel, listener);
  }
}

test("preload API invokes only the declared IPC contract", async () => {
  assert.deepEqual(PRELOAD_IPC_CHANNELS, IPC_CHANNELS);
  const ipc = new FakeIpcRenderer();
  const api = createDesktopApi(ipc);

  assert.deepEqual(await api.getVersions(), { app: "0.1.0", electron: "33.3.1" });
  assert.equal((await api.getStartupState()).phase, "preparing");
  assert.equal(await api.retryService("dashboard"), true);
  await api.openLogsFolder();
  await api.copyDiagnostics();
  await api.quit();
  assert.equal(await api.restartBreadboard(), true);
  await api.pickFolder();
  assert.equal(await api.openMicrophoneSettings(), true);
  assert.equal(await api.allowThemeLocation(), true);
  assert.equal(await api.setTheme("dark"), true);
  assert.equal(await api.getStartupSound(), false);
  assert.equal(await api.setStartupSound(false), true);
  assert.equal(await api.getCurrentLocationPreference(), true);
  assert.equal(await api.setCurrentLocationPreference(true), true);
  assert.equal((await api.getClickyState()).status, "ready");
  assert.equal((await api.launchClicky()).code, "launched");
  assert.equal((await api.openClickyProject()).code, "project_opened");
  await api.continueToDashboard();

  assert.deepEqual(
    ipc.calls.map((call) => call.channel),
    [
      IPC_CHANNELS.getVersions,
      IPC_CHANNELS.getStartupState,
      IPC_CHANNELS.retryService,
      IPC_CHANNELS.openLogs,
      IPC_CHANNELS.copyDiagnostics,
      IPC_CHANNELS.quit,
      IPC_CHANNELS.restartApp,
      IPC_CHANNELS.pickFolder,
      IPC_CHANNELS.openMicrophoneSettings,
      IPC_CHANNELS.allowThemeLocation,
      IPC_CHANNELS.setTheme,
      IPC_CHANNELS.getStartupSound,
      IPC_CHANNELS.setStartupSound,
      IPC_CHANNELS.getCurrentLocationPreference,
      IPC_CHANNELS.setCurrentLocationPreference,
      IPC_CHANNELS.getClickyState,
      IPC_CHANNELS.launchClicky,
      IPC_CHANNELS.openClickyProject,
      IPC_CHANNELS.startupContinue,
    ],
  );
  assert.deepEqual(ipc.calls[2]?.args, ["dashboard"]);
  assert.deepEqual(
    ipc.calls.find((call) => call.channel === IPC_CHANNELS.setTheme)?.args,
    ["dark"],
  );
  assert.deepEqual(
    ipc.calls.find((call) => call.channel === IPC_CHANNELS.setStartupSound)?.args,
    [false],
  );
  assert.deepEqual(
    ipc.calls.find((call) => call.channel === IPC_CHANNELS.setCurrentLocationPreference)?.args,
    [true],
  );
});

test("startup subscriptions receive state and unsubscribe cleanly", () => {
  const ipc = new FakeIpcRenderer();
  const api = createDesktopApi(ipc);
  const received: StartupStateView[] = [];
  const unsubscribe = api.onStartupState((state) => received.push(state));
  const publish = ipc.listeners.get(IPC_CHANNELS.startupState);
  assert.ok(publish);

  const failed: StartupStateView = {
    phase: "failed",
    message: "Dashboard failed",
    services: [],
    failure: {
      serviceId: "dashboard",
      displayName: "Breadboard workspace",
      reason: "process exited",
      logTail: ["exit 1"],
    },
  };
  publish(undefined, failed);
  unsubscribe();
  publish(undefined, { phase: "ready", message: "Ready", services: [] });
  assert.deepEqual(received, [failed]);
});

test("the tabs bridge relays state and commands for browser navigation", async () => {
  const ipc = new FakeIpcRenderer();
  const api = createDesktopApi(ipc);
  const received: unknown[] = [];
  const unsubscribe = api.onTabsState((state) => received.push(state));
  const publish = ipc.listeners.get(IPC_CHANNELS.tabsState);
  assert.ok(publish);
  const state = {
    enabled: true,
    activeId: 1,
    tabs: [{ id: 1, title: "breadboard", url: "http://127.0.0.1:3000/dashboard", loading: false }],
  };
  publish(undefined, state);
  unsubscribe();
  publish(undefined, { ...state, activeId: null });
  assert.deepEqual(received, [state]);

  await api.getTabsState();
  await api.tabs({ type: "open", url: "http://127.0.0.1:3000/garden", background: true });
  await api.getBrowserNavigation();
  await api.setBrowserNavigation(false);
  await api.getBrowserBookmarks("person@example.com");
  await api.setBrowserBookmarks("person@example.com", [{
    url: "https://example.com/",
    title: "Example",
    iconUrl: "https://example.com/favicon.ico",
  }]);
  assert.deepEqual(
    ipc.calls.map((call) => [call.channel, ...call.args]),
    [
      [IPC_CHANNELS.getTabsState],
      [
        IPC_CHANNELS.tabsCommand,
        { type: "open", url: "http://127.0.0.1:3000/garden", background: true },
      ],
      [IPC_CHANNELS.getBrowserNavigation],
      [IPC_CHANNELS.setBrowserNavigation, false],
      [IPC_CHANNELS.getBrowserBookmarks, "person@example.com"],
      [
        IPC_CHANNELS.setBrowserBookmarks,
        "person@example.com",
        [{
          url: "https://example.com/",
          title: "Example",
          iconUrl: "https://example.com/favicon.ico",
        }],
      ],
    ],
  );
});

test("start-page shortcuts use a separate durable collection through preload", async () => {
  const ipc = new FakeIpcRenderer();
  const api = createDesktopApi(ipc);
  const shortcuts = [{ url: "https://example.com/", title: "Example", iconUrl: "https://example.com/favicon.ico" }];
  assert.deepEqual(await api.getBrowserShortcuts("one@example.com"), []);
  assert.equal(await api.setBrowserShortcuts("one@example.com", shortcuts), true);
  assert.deepEqual(ipc.calls, [
    { channel: IPC_CHANNELS.getBrowserShortcuts, args: ["one@example.com"] },
    { channel: IPC_CHANNELS.setBrowserShortcuts, args: ["one@example.com", shortcuts] },
  ]);
});

test("setTheme sends the sun schedule only when the page has one", async () => {
  const ipc = new FakeIpcRenderer();
  const api = createDesktopApi(ipc);
  const schedule = { mode: "sun", sunriseMinutes: 390, sunsetMinutes: 1185 } as const;
  assert.equal(await api.setTheme("light", schedule), true);
  assert.equal(await api.setTheme("voice"), true);
  assert.deepEqual(
    ipc.calls.map((call) => call.args),
    [["light", schedule], ["voice"]],
  );
});
