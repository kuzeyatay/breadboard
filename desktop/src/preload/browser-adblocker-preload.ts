// A sandbox-compatible session preload. Nothing is exposed through contextBridge.
import { ipcRenderer, webFrame } from "electron";
import { DOMMonitor, type IMessageFromBackground } from "@ghostery/adblocker-content";
import { handlePseudoDirective, querySelectorAll } from "@ghostery/adblocker-extended-selectors";

const CHANNEL = "breadboard:adblock";
const scripts = new Set<string>();
const styles = new Map<string, string>();
let monitor: DOMMonitor | undefined;
let extended: IMessageFromBackground["extended"] = [];
let extendedTimer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let active = false;
// Retain the previous matches so changing ad containers can become visible
// again, and pausing the blocker restores the page's original presentation.
const matches = new Map<string, Set<Element>>();

function clearCosmetics() {
  monitor?.stop();
  monitor = undefined;
  if (extendedTimer) clearTimeout(extendedTimer);
  extendedTimer = undefined;
  for (const key of styles.values()) webFrame.removeInsertedCSS(key);
  styles.clear();
  for (const [attribute, elements] of matches) for (const element of elements) element.removeAttribute(attribute);
  matches.clear();
  extended = [];
}

function applyExtended() {
  extendedTimer = undefined;
  if (!active || !document.documentElement) return;
  const nextMatches = new Map<string, Set<Element>>();
  for (const rule of extended) {
    try {
      const elements = querySelectorAll(document.documentElement, rule.ast);
      if (rule.attribute) {
        const next = nextMatches.get(rule.attribute) ?? new Set<Element>();
        for (const element of elements) next.add(element);
        nextMatches.set(rule.attribute, next);
      } else if (rule.directive) {
        for (const element of elements) handlePseudoDirective(element, rule.directive);
      }
    } catch { /* A selector unsupported by this Chromium must not stop filtering. */ }
  }
  // Several selectors can share the same style/attribute. Diff their union.
  for (const [attribute, elements] of matches) for (const element of elements) {
    if (!nextMatches.get(attribute)?.has(element)) element.removeAttribute(attribute);
  }
  matches.clear();
  for (const [attribute, elements] of nextMatches) {
    for (const element of elements) if (!element.hasAttribute(attribute)) element.setAttribute(attribute, "");
    matches.set(attribute, elements);
  }
}

function scheduleExtended() {
  if (active && extended.length && !extendedTimer) extendedTimer = setTimeout(applyExtended, 100);
}

function apply(payload: IMessageFromBackground, initial = false) {
  if (!payload?.active) return;
  if (payload.styles && !styles.has(payload.styles)) {
    // Electron 33 removes only author-origin insertions. Rules already use
    // !important; author origin lets a site pause actually restore its layout.
    try { styles.set(payload.styles, webFrame.insertCSS(payload.styles, { cssOrigin: "author" })); } catch { /* Navigating. */ }
  }
  if (initial) {
    extended = payload.extended;
    const pending: string[] = [];
    for (const script of payload.scripts) {
      if (scripts.has(script)) continue;
      scripts.add(script);
      pending.push(`try { ${script}\n } catch {}`);
    }
    if (pending.length) {
      // Execute in the page's world at document start, independently of CSP.
      // Keep one private scope for the engine's scriptletGlobals/safeSelf cache.
      // Separate IIFEs snapshot already-patched JSON/fetch/XHR functions, making
      // YouTube's stacked request edits recurse exponentially. Each script still
      // has its own error boundary; no helpers or native references leak to the
      // page global and no synthetic user gesture is granted.
      void webFrame.executeJavaScript(`(() => { ${pending.join("\n")} })()`, false).catch(() => {});
    }
  }
  scheduleExtended();
}

function observe() {
  if (!active || monitor || !document.documentElement) return;
  const version = generation;
  monitor = new DOMMonitor(update => {
    if (!active || version !== generation) return;
    scheduleExtended();
    if (update.type !== "features") return;
    // Preserve all features while bounding each IPC message on infinite feeds.
    const size = Math.max(update.classes.length, update.ids.length, update.hrefs.length);
    for (let start = 0; start < size; start += 512) {
      void ipcRenderer.invoke(`${CHANNEL}:dom`, {
        classes: update.classes.slice(start, start + 512),
        ids: update.ids.slice(start, start + 512),
        hrefs: update.hrefs.slice(start, start + 512),
      }).then(payload => { if (active && version === generation) apply(payload); }).catch(() => {});
    }
  });
  monitor.queryAll(window);
  monitor.start(window);
}

function refresh() {
  generation++;
  active = false;
  clearCosmetics();
  const payload = ipcRenderer.sendSync(`${CHANNEL}:start`) as IMessageFromBackground;
  active = payload?.active === true;
  if (active) { apply(payload, true); observe(); }
}

// The lists stop YouTube from scheduling ads, but YouTube changes its player
// faster than any pinned snapshot. When an ad starts anyway, end it: seeking
// to its last frame makes the player move on to the video. The element is not
// muted because YouTube reuses it for the video that follows.
function skipVideoAd() {
  if (!active) return;
  const player = document.querySelector(".html5-video-player.ad-showing");
  if (!player) return;
  const video = player.querySelector("video");
  if (video && Number.isFinite(video.duration) && video.currentTime < video.duration - 0.1) video.currentTime = video.duration;
  player.querySelector<HTMLElement>(".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern")?.click();
}
if (/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) setInterval(skipVideoAd, 250);

ipcRenderer.on(`${CHANNEL}:changed`, refresh);
document.addEventListener("DOMContentLoaded", observe, { once: true });
// Extended filters can depend on text, unlike ordinary ID/class CSS rules.
const textObserver = new MutationObserver(scheduleExtended);
textObserver.observe(document, { subtree: true, characterData: true });
window.addEventListener("pagehide", () => { generation++; active = false; clearCosmetics(); textObserver.disconnect(); });
window.addEventListener("pageshow", event => { if (event.persisted) { refresh(); textObserver.observe(document, { subtree: true, characterData: true }); } });
refresh();
