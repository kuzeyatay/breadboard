import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { Session, WebContents } from "electron";
import { atomicWriteFile } from "./runtime-config";

export interface BrowserVpnState { enabled: boolean; status: "off" | "connecting" | "on" | "error" }

const STATE_FILE = "browser-vpn.json";
// The official Cloudflare WARP client's local proxy mode. Breadboard runs no
// servers and does not register unofficial WARP devices: Cloudflare rejects
// those, so the person's own installed client carries the traffic.
const PORT = 40000;
const PROXY = { proxyRules: `socks5://127.0.0.1:${PORT}` };
const RECHECK_MS = 15_000;

/** Runs warp-cli; resolves with its output, or null when it is not installed. */
export type WarpCli = (args: string[]) => Promise<string | null>;

function warpCliPath(): string | null {
  const candidates = process.platform === "win32"
    ? [path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Cloudflare", "Cloudflare WARP", "warp-cli.exe")]
    : ["/usr/local/bin/warp-cli", "/usr/bin/warp-cli"];
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

const systemWarpCli: WarpCli = args => {
  const file = warpCliPath();
  if (!file) return Promise.resolve(null);
  return new Promise((resolve, reject) => execFile(file, ["--accept-tos", ...args], { timeout: 20_000, windowsHide: true },
    (error, stdout) => error ? reject(error) : resolve(stdout)));
};

// WARP is proprietary, so it cannot ship inside Breadboard's installer. winget
// fetches Cloudflare's own signed installer; Windows asks for permission.
const installWarp = (): Promise<void> => new Promise((resolve, reject) => execFile("winget",
  ["install", "--id", "Cloudflare.Warp", "--exact", "--silent", "--disable-interactivity", "--accept-package-agreements", "--accept-source-agreements"],
  { timeout: 600_000, windowsHide: true }, error => error ? reject(error) : resolve()));

const portOpen = (): Promise<boolean> => new Promise(resolve => {
  const socket = net.connect({ host: "127.0.0.1", port: PORT });
  const done = (open: boolean) => { socket.destroy(); resolve(open); };
  socket.setTimeout(1000, () => done(false));
  socket.once("connect", () => done(true));
  socket.once("error", () => done(false));
});

/** Routes every browser tab through WARP's local proxy. While enabled the
 * proxy stays configured even when WARP is down, so pages fail instead of
 * silently loading over the direct connection. The app session is untouched. */
export class BrowserVpn {
  private enabled = false;
  private status: BrowserVpnState["status"] = "off";
  private attempt = 0;
  private timer?: ReturnType<typeof setInterval>;
  private readonly sessions = new Set<Session>();
  private readonly pages = new Set<WebContents>();

  constructor(
    private readonly configDir: string,
    private readonly changed: () => void,
    private readonly log: (message: string) => void = () => {},
    private readonly cli: WarpCli = systemWarpCli,
    private readonly reachable: () => Promise<boolean> = portOpen,
    private readonly settleMs = 500,
    private readonly install: () => Promise<void> = installWarp,
  ) {
    try { this.enabled = JSON.parse(fs.readFileSync(path.join(configDir, STATE_FILE), "utf8")).enabled === true; }
    catch { /* First run: off. */ }
    if (this.enabled) { this.status = "connecting"; void this.connect(); }
  }

  attachSession(target: Session): void {
    if (this.sessions.has(target)) return;
    this.sessions.add(target);
    if (this.enabled) void target.setProxy(PROXY);
  }

  attachPage(contents: WebContents): void {
    this.attachSession(contents.session);
    if (this.pages.has(contents)) return;
    this.pages.add(contents);
    contents.once("destroyed", () => this.pages.delete(contents));
    // Without this WebRTC sends UDP around the proxy and reveals the real address.
    if (this.enabled) contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  }

  snapshot(): BrowserVpnState {
    return { enabled: this.enabled, status: this.status };
  }

  /** Installs WARP first when it is missing; an existing install is used as is.
   * False when it could not be installed or the setting could not be saved. */
  async setEnabled(enabled: boolean): Promise<boolean> {
    if (enabled === this.enabled) return true;
    try {
      if (enabled && await this.cli(["--version"]).catch(() => "") === null) {
        await this.install();
        if (await this.cli(["--version"]).catch(() => "") === null) return false;
      }
      atomicWriteFile(path.join(this.configDir, STATE_FILE), JSON.stringify({ version: 1, enabled }, null, 2));
    } catch (error) { this.log(`VPN setting could not be changed: ${String(error)}`); return false; }
    this.enabled = enabled;
    this.status = enabled ? "connecting" : "off";
    // Route first, connect second: no request leaves directly while WARP starts.
    for (const target of this.sessions) {
      await target.setProxy(enabled ? PROXY : { mode: "direct" });
      await target.closeAllConnections();
    }
    for (const page of this.pages) {
      if (!page.isDestroyed()) page.setWebRTCIPHandlingPolicy(enabled ? "disable_non_proxied_udp" : "default");
    }
    this.changed();
    void this.connect();
    return true;
  }

  private async connect(): Promise<void> {
    const attempt = ++this.attempt;
    clearInterval(this.timer);
    let status: BrowserVpnState["status"] = "off";
    try {
      if (!this.enabled) { await this.cli(["disconnect"]); return; }
      // ponytail: this switches a full-tunnel WARP install to proxy mode.
      // Detect an already-connected full tunnel and leave it alone if people
      // who use WARP system-wide report it.
      if (await this.cli(["registration", "show"]).catch(() => "") === "") await this.cli(["registration", "new"]);
      await this.cli(["mode", "proxy"]);
      await this.cli(["proxy", "port", String(PORT)]);
      if (await this.cli(["connect"]) === null) throw new Error("Cloudflare WARP is not installed");
      status = "error";
      for (let waited = 0; waited < 40 && attempt === this.attempt; waited++) {
        if (await this.reachable()) { status = "on"; break; }
        await new Promise(resolve => setTimeout(resolve, this.settleMs));
      }
    } catch (error) {
      status = this.enabled ? "error" : "off";
      this.log(`VPN could not ${this.enabled ? "connect" : "disconnect"}: ${String(error)}`);
    } finally {
      if (attempt === this.attempt) {
        if (this.status !== status) { this.status = status; this.changed(); }
        if (this.enabled) {
          // WARP can be quit or lose its network later. Keep the label honest
          // and reconnect; the proxy setting itself never falls back to direct.
          this.timer = setInterval(() => void this.recheck(), RECHECK_MS);
          this.timer.unref();
        }
      }
    }
  }

  private async recheck(): Promise<void> {
    const attempt = this.attempt;
    const open = await this.reachable();
    if (attempt !== this.attempt || !this.enabled) return;
    if (!open) return void this.connect();
    if (this.status !== "on") { this.status = "on"; this.changed(); }
  }
}
