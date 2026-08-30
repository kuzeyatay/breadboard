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
    if (channel === IPC_CHANNELS.openMicrophoneSettings) return true;
    if (channel === IPC_CHANNELS.allowThemeLocation) return true;
    if (channel === IPC_CHANNELS.setTheme) return true;
    if (channel === IPC_CHANNELS.getStartupSound) return false;
    if (channel === IPC_CHANNELS.setStartupSound) return true;
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
  await api.pickFolder();
  assert.equal(await api.openMicrophoneSettings(), true);
  assert.equal(await api.allowThemeLocation(), true);
  assert.equal(await api.setTheme("dark"), true);
  assert.equal(await api.getStartupSound(), false);
  assert.equal(await api.setStartupSound(false), true);
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
      IPC_CHANNELS.pickFolder,
      IPC_CHANNELS.openMicrophoneSettings,
      IPC_CHANNELS.allowThemeLocation,
      IPC_CHANNELS.setTheme,
      IPC_CHANNELS.getStartupSound,
      IPC_CHANNELS.setStartupSound,
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
