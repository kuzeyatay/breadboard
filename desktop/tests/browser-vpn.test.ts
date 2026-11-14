import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import type { Session, WebContents } from "electron";
import { BrowserVpn, type WarpCli } from "../src/main/browser-vpn";
import { isTabsCommand } from "../src/shared/ipc-contract";

function fixture(installed = true, reachable = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-vpn-unit-"));
  const calls: string[] = [], proxies: unknown[] = [], policies: string[] = [];
  const state = { reachable, changes: 0, installed, installs: 0, installable: false };
  const cli: WarpCli = async args => { calls.push(args.join(" ")); return state.installed ? "ok" : null; };
  const install = async () => { state.installs++; if (!state.installable) throw new Error("declined"); state.installed = true; };
  const session = { setProxy: async (config: unknown) => { proxies.push(config); }, closeAllConnections: async () => {} } as unknown as Session;
  const page = Object.assign(new EventEmitter(), {
    session, isDestroyed: () => false, setWebRTCIPHandlingPolicy: (policy: string) => { policies.push(policy); },
  }) as unknown as WebContents;
  const make = () => new BrowserVpn(dir, () => { state.changes++; }, undefined, cli, async () => state.reachable, 0, install);
  const settled = async (vpn: BrowserVpn) => {
    for (let i = 0; i < 1000 && vpn.snapshot().status === "connecting"; i++) await new Promise(resolve => setTimeout(resolve, 5));
  };
  return { dir, calls, proxies, policies, state, page, make, settled, cleanup() {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  } };
}

test("turning the VPN on routes tabs through WARP before connecting, and off restores the direct connection", async t => {
  const f = fixture(); t.after(f.cleanup);
  const vpn = f.make();
  vpn.attachPage(f.page);
  assert.deepEqual(f.proxies, [], "off by default: the session is left alone");
  assert.equal(await vpn.setEnabled(true), true);
  assert.deepEqual(f.proxies, [{ proxyRules: "socks5://127.0.0.1:40000" }]);
  assert.deepEqual(f.policies, ["disable_non_proxied_udp"], "WebRTC cannot send UDP around the proxy");
  await f.settled(vpn);
  assert.deepEqual(vpn.snapshot(), { enabled: true, status: "on" });
  assert.deepEqual(f.calls.slice(1), ["registration show", "mode proxy", "proxy port 40000", "connect"]);

  // A restart keeps the setting and applies the proxy to sessions as they attach.
  const restarted = f.make();
  restarted.attachPage(f.page);
  assert.deepEqual(f.proxies.at(-1), { proxyRules: "socks5://127.0.0.1:40000" });
  await f.settled(restarted);
  assert.equal(await restarted.setEnabled(false), true);
  assert.deepEqual(f.proxies.at(-1), { mode: "direct" });
  assert.equal(f.policies.at(-1), "default");
  assert.deepEqual(restarted.snapshot(), { enabled: false, status: "off" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.at(-1), "disconnect");
});

test("a WARP that never comes up reports an error and keeps the proxy in place", async t => {
  const f = fixture(true, false); t.after(f.cleanup);
  const vpn = f.make();
  vpn.attachPage(f.page);
  assert.equal(await vpn.setEnabled(true), true);
  await f.settled(vpn);
  assert.deepEqual(vpn.snapshot(), { enabled: true, status: "error" });
  assert.deepEqual(f.proxies, [{ proxyRules: "socks5://127.0.0.1:40000" }], "no fallback to the direct connection");
  await vpn.setEnabled(false);
});

test("a missing WARP app is installed on first switch-on; an existing one is never reinstalled", async t => {
  const f = fixture(false); t.after(f.cleanup);
  f.state.installable = true;
  const vpn = f.make();
  vpn.attachPage(f.page);
  assert.equal(await vpn.setEnabled(true), true);
  await f.settled(vpn);
  assert.deepEqual(vpn.snapshot(), { enabled: true, status: "on" });
  await vpn.setEnabled(false);
  await vpn.setEnabled(true);
  await f.settled(vpn);
  assert.equal(f.state.installs, 1);
  await vpn.setEnabled(false);
});

test("when WARP cannot be installed the VPN refuses to turn on and changes nothing", async t => {
  const f = fixture(false); t.after(f.cleanup);
  const vpn = f.make();
  vpn.attachPage(f.page);
  assert.equal(await vpn.setEnabled(true), false);
  assert.deepEqual(vpn.snapshot(), { enabled: false, status: "off" });
  assert.deepEqual(f.proxies, []);
  assert.equal(fs.existsSync(path.join(f.dir, "browser-vpn.json")), false);
});

test("the VPN command requires a boolean", () => {
  for (const enabled of [null, undefined, "true", 1]) assert.equal(isTabsCommand({ type: "browser-vpn-enabled", enabled }), false);
  assert.equal(isTabsCommand({ type: "browser-vpn-enabled", enabled: true }), true);
});
