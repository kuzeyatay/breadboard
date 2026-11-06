import * as fs from "node:fs";
import * as path from "node:path";
import { app, ipcMain, protocol, type IpcMainEvent, type OnBeforeRequestListenerDetails, type Session, type WebContents } from "electron";
import type { IBackgroundCallback, IMessageFromBackground } from "@ghostery/adblocker-content";
import { FiltersEngine, Request } from "./browser-adblocker-engine";
import { atomicWriteFile } from "./runtime-config";

export interface BrowserAdBlockState {
  enabled: boolean;
  available: boolean;
  site: string | null;
  siteEnabled: boolean;
  blocked: number;
}

interface Settings { enabled: boolean; allowedSites: string[] }
interface Page { contents: WebContents; url: string; blocked: number }
const STATE_FILE = "browser-adblocker.json";
const CHANNEL = "breadboard:adblock";
const RESOURCE_SCHEME = "breadboard-adblock";
// Chromium 130 aborts webRequest redirects to data: URLs. Serve the engine's
// bundled replacements through a restricted in-memory protocol instead.
if (protocol && !app.isReady()) protocol.registerSchemesAsPrivileged([{
  scheme: RESOURCE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);
const owners = new Map<number, BrowserAdBlocker>();
const inactive = (): IMessageFromBackground => ({ active: false, styles: "", scripts: [], extended: [] });
let listening = false;

// Session preloads also run in background/extension pages. Always answer the
// synchronous startup message, but only registered browser tabs receive rules.
function installIPC(): void {
  if (listening || !ipcMain) return;
  listening = true;
  ipcMain.on(`${CHANNEL}:start`, event => {
    try { event.returnValue = owners.get(event.sender.id)?.pageFilters(event) ?? inactive(); }
    catch { event.returnValue = inactive(); }
  });
  ipcMain.handle(`${CHANNEL}:dom`, (event, features: unknown) => {
    try { return owners.get(event.sender.id)?.pageFilters(event, features) ?? inactive(); }
    catch { return inactive(); }
  });
}

function domFeatures(value: unknown): Pick<IBackgroundCallback, "classes" | "ids" | "hrefs"> {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const strings = (key: string) => Array.isArray(input[key]) ? input[key].slice(0, 512)
    .filter((item: unknown): item is string => typeof item === "string" && item.length <= 1024) : [];
  return { classes: strings("classes"), ids: strings("ids"), hrefs: strings("hrefs") };
}

export function adBlockSite(input: string): string | null {
  try {
    const url = new URL(input);
    return /^https?:$/.test(url.protocol) ? url.hostname.toLowerCase().replace(/\.$/, "") : null;
  } catch { return null; }
}

function normalizeSettings(value: unknown): Settings {
  const data = value && typeof value === "object" ? value as Partial<Settings> : {};
  return {
    enabled: typeof data.enabled === "boolean" ? data.enabled : true,
    allowedSites: Array.isArray(data.allowedSites) ? [...new Set(data.allowedSites.filter(site =>
      typeof site === "string" && site.length <= 253 && adBlockSite(`https://${site}`) === site,
    ))].slice(0, 1000) : [],
  };
}

/** One network hook per browser session. Does not touch the app session or the
 * PDF redirect's onHeadersReceived hook. No browsing URLs or counts are saved. */
export class BrowserAdBlocker {
  private settings: Settings;
  private engine: FiltersEngine | null = null;
  private initialized = false;
  private readonly sessions = new WeakSet<Session>();
  private readonly privateSettings = new WeakMap<Session, Settings>();
  private readonly pages = new Map<number, Page>();
  private readonly replacements = new Map<string, { body: Buffer; contentType: string }>();
  private notificationTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly configDir: string,
    private readonly changed: () => void,
    private readonly log: (message: string) => void = () => {},
    engine?: FiltersEngine,
  ) {
    installIPC();
    this.engine = engine ?? null;
    this.initialized = Boolean(engine);
    try { this.settings = normalizeSettings(JSON.parse(fs.readFileSync(path.join(configDir, STATE_FILE), "utf8"))); }
    catch { this.settings = normalizeSettings(null); }
  }

  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.engine = FiltersEngine.deserialize(fs.readFileSync(path.join(__dirname, "adblocker.bin")));
    } catch (error) {
      this.log(`Ad blocker unavailable: ${String(error)}`);
    }
  }

  attachSession(target: Session, privateBrowsing = false): void {
    if (this.sessions.has(target)) return;
    this.initialize();
    this.sessions.add(target);
    // Preserve other session preloads. Unlike the product preload this runs
    // without exposing privileged APIs to the website.
    const preload = path.join(__dirname, "../preload/browser-adblocker-preload.js");
    target.setPreloads([...new Set([...target.getPreloads(), preload])]);
    target.protocol.handle(RESOURCE_SCHEME, request => {
      const url = new URL(request.url);
      const resource = url.hostname === "resources" && this.replacements.get(url.pathname.slice(1));
      if (!resource) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(resource.body), { headers: {
        "Content-Type": resource.contentType, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store",
      } });
    });
    if (privateBrowsing) this.privateSettings.set(target, { ...this.settings, allowedSites: [...this.settings.allowedSites] });
    target.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => {
      let response: { cancel?: boolean; redirectURL?: string } = { cancel: false };
      try { response = this.filterRequest(target, details); }
      catch { /* A failed rule must never strand Chromium's request callback. */ }
      callback(response);
    });
  }

  attachPage(contents: WebContents, privateBrowsing = false): void {
    this.attachSession(contents.session, privateBrowsing);
    if (this.pages.has(contents.id)) return;
    const page: Page = { contents, url: contents.getURL(), blocked: 0 };
    this.pages.set(contents.id, page);
    owners.set(contents.id, this);
    contents.on("did-start-navigation", (_event, url, inPlace, isMainFrame) => {
      if (!isMainFrame || inPlace) return;
      page.url = url;
      page.blocked = 0;
      this.notify();
    });
    contents.on("did-redirect-navigation", (_event, url, _inPlace, isMainFrame) => {
      if (isMainFrame) page.url = url;
    });
    contents.on("did-navigate", (_event, url) => { page.url = url; });
    contents.once("destroyed", () => {
      owners.delete(contents.id);
      this.pages.delete(contents.id);
      if (!this.pages.size && this.notificationTimer) {
        clearTimeout(this.notificationTimer);
        this.notificationTimer = undefined;
      }
    });
  }

  private currentSettings(target?: Session): Settings {
    return (target && this.privateSettings.get(target)) || this.settings;
  }

  private filterRequest(target: Session, details: OnBeforeRequestListenerDetails): { cancel?: boolean; redirectURL?: string } {
    const allow = { cancel: false };
    if (!this.engine || details.resourceType === "mainFrame") return allow;
    const settings = this.currentSettings(target);
    if (!settings.enabled) return allow;
    const page = details.webContentsId === undefined ? undefined : this.pages.get(details.webContentsId);
    // An unregistered WebContents is an extension/background page, not a browser
    // tab. Session service-worker requests have no WebContents and use referrer.
    if (!page && (details.webContentsId ?? 0) > 0) return allow;
    const topUrl = page?.url || details.referrer;
    const site = adBlockSite(topUrl);
    if (!site || settings.allowedSites.includes(site)) return allow;
    const { match, redirect, rewrite } = this.engine.match(Request.fromRawDetails({
      url: details.url,
      sourceUrl: details.referrer || topUrl,
      type: details.resourceType,
    }));
    if ((match || redirect) && page) { page.blocked += 1; this.notify(); }
    // A replacement SDK can complete the player's callbacks instead of leaving
    // it waiting forever for a cancelled advertising script.
    if (redirect) {
      const key = encodeURIComponent(redirect.filename);
      if (!this.replacements.has(key)) {
        const separator = redirect.dataUrl.indexOf(",");
        const encoded = redirect.dataUrl.slice(separator + 1);
        this.replacements.set(key, {
          body: redirect.dataUrl.slice(0, separator).endsWith(";base64") ? Buffer.from(encoded, "base64") : Buffer.from(decodeURIComponent(encoded)),
          contentType: redirect.contentType,
        });
      }
      return { redirectURL: `${RESOURCE_SCHEME}://resources/${key}` };
    }
    if (match) return { cancel: true };
    if (rewrite?.url && rewrite.url !== details.url && details.method === "GET") {
      // Query stripping must never redirect credentials to a different origin.
      try { if (new URL(rewrite.url).origin === new URL(details.url).origin) return { redirectURL: rewrite.url }; }
      catch { /* Invalid rewrite: leave the original request intact. */ }
    }
    return allow;
  }

  pageFilters(event: Pick<IpcMainEvent, "sender" | "senderFrame">, features?: unknown): IMessageFromBackground {
    const page = this.pages.get(event.sender.id);
    const frame = event.senderFrame;
    if (!page || page.contents !== event.sender || !frame || !this.engine) return inactive();
    const settings = this.currentSettings(event.sender.session);
    const site = adBlockSite(page.url);
    if (!settings.enabled || !site || settings.allowedSites.includes(site) || !adBlockSite(frame.url)) return inactive();
    // URLs come from Electron, never from a renderer-provided argument.
    const request = Request.fromRawDetails({ url: frame.url });
    const initial = features === undefined;
    return this.engine.getCosmeticsFilters({
      url: frame.url, hostname: request.hostname, domain: request.domain,
      ancestors: frame.top && frame.top !== frame ? [Request.fromRawDetails({ url: frame.top.url })] : [],
      ...domFeatures(features),
      getBaseRules: initial, getInjectionRules: initial, getExtendedRules: initial,
      getRulesFromHostname: initial, getRulesFromDOM: !initial,
    });
  }

  snapshot(contents?: WebContents, url = "", target?: Session): BrowserAdBlockState {
    this.initialize();
    const settings = this.currentSettings(contents?.session ?? target);
    const site = adBlockSite(url);
    return {
      enabled: settings.enabled, available: this.engine !== null, site,
      siteEnabled: site !== null && !settings.allowedSites.includes(site),
      blocked: contents ? this.pages.get(contents.id)?.blocked ?? 0 : 0,
    };
  }

  setEnabled(enabled: boolean, target: Session): boolean {
    const settings = this.currentSettings(target);
    return this.save({ ...settings, enabled }, target);
  }

  setSiteEnabled(url: string, enabled: boolean, target: Session): boolean {
    const site = adBlockSite(url);
    if (!site) return false;
    const settings = this.currentSettings(target);
    const allowedSites = settings.allowedSites.filter(value => value !== site);
    if (!enabled) {
      if (allowedSites.length >= 1000) return false;
      allowedSites.push(site);
    }
    return this.save({ ...settings, allowedSites }, target);
  }

  private save(settings: Settings, target: Session): boolean {
    if (this.privateSettings.has(target)) {
      this.privateSettings.set(target, settings);
    } else {
      try { atomicWriteFile(path.join(this.configDir, STATE_FILE), JSON.stringify({ version: 1, ...settings }, null, 2)); }
      catch (error) { this.log(`Ad blocker settings could not be saved: ${String(error)}`); return false; }
      this.settings = settings;
    }
    this.changed();
    // Cosmetic filtering changes immediately. Scriptlet patches are installed
    // once per document; a reload applies their new setting completely.
    for (const page of this.pages.values()) {
      if (page.contents.isDestroyed()) continue;
      if (this.privateSettings.has(target) ? page.contents.session !== target : this.privateSettings.has(page.contents.session)) continue;
      for (const frame of page.contents.mainFrame.framesInSubtree) {
        try { frame.send(`${CHANNEL}:changed`); } catch { /* Frame navigated. */ }
      }
    }
    return true;
  }

  private notify(): void {
    if (this.notificationTimer) return;
    this.notificationTimer = setTimeout(() => {
      this.notificationTimer = undefined;
      this.changed();
    }, 250);
    this.notificationTimer.unref();
  }
}
