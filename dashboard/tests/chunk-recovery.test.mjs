import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { chunkRecoveryScript } from "../src/app/components/chunk-recovery.ts";

const origin = "http://127.0.0.1:54752";
const css = `${origin}/_next/static/chunks/browser.css`;
const js = `${origin}/_next/static/chunks/browser.js`;

function fixture({ styles = [], resources = [], startup = "loading", tries = null, storage = true } = {}) {
  const listeners = new Map();
  const timers = [];
  const state = { tries, reloads: 0 };
  class HTMLScriptElement { constructor(src) { this.src = src; } }
  class HTMLLinkElement { constructor(href) { this.href = href; this.rel = "stylesheet"; } }
  vm.runInNewContext(chunkRecoveryScript, {
    URL, HTMLScriptElement, HTMLLinkElement,
    location: { origin, href: `${origin}/browser`, reload() { state.reloads++; } },
    document: {
      documentElement: { dataset: { breadboardStartup: startup } },
      querySelectorAll: () => styles,
    },
    performance: { getEntriesByType: () => resources },
    sessionStorage: {
      getItem: () => state.tries,
      setItem: (_key, value) => { if (!storage) throw Error("Storage disabled"); state.tries = value; },
      removeItem: () => { state.tries = null; },
    },
    matchMedia: media => ({ matches: media !== "print" }),
    addEventListener: (type, listener, options) => listeners.set(`${type}:${options === true}`, listener),
    removeEventListener: (type, _listener, options) => listeners.delete(`${type}:${options === true}`),
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
  });
  return {
    state,
    failScript: src => listeners.get("error:true")({ target: new HTMLScriptElement(src) }),
    failStyle: href => listeners.get("error:true")({ target: new HTMLLinkElement(href) }),
    loadStyle: href => listeners.get("load:true")({ target: new HTMLLinkElement(href) }),
    finish() {
      listeners.get("load:false")();
      assert.equal(timers.length, 1);
      timers[0].callback();
      return timers[0].delay;
    },
  };
}

test("a missing browser stylesheet recovers even after React is ready", () => {
  const page = fixture({ startup: "ready", styles: [{ href: css, sheet: null }] });
  assert.equal(page.finish(), 1000);
  assert.equal(page.state.reloads, 1);
  assert.equal(page.state.tries, "1");
});

test("a stylesheet that finishes loading before the check does not reload", () => {
  const style = { href: css, sheet: null };
  const page = fixture({ styles: [style], tries: "2" });
  style.sheet = {};
  page.finish();
  assert.equal(page.state.reloads, 0);
  assert.equal(page.state.tries, null);
});

test("a failed stylesheet recovers even when Chromium exposes an empty sheet", () => {
  const page = fixture({ startup: "ready", styles: [{ href: css, sheet: {} }] });
  page.failStyle(css);
  page.finish();
  assert.equal(page.state.reloads, 1);
});

test("stylesheet HTTP failures recover when the error preceded the bootstrap", () => {
  const page = fixture({
    startup: "ready", styles: [{ href: css, sheet: {} }],
    resources: [{ name: css, initiatorType: "link", responseStatus: 502 }],
  });
  page.finish();
  assert.equal(page.state.reloads, 1);
});

test("a successful stylesheet retry supersedes its earlier error", () => {
  const resources = [{ name: css, initiatorType: "link", responseStatus: 502 }];
  const page = fixture({ styles: [{ href: css, sheet: {} }], resources });
  page.failStyle(css);
  page.loadStyle(css);
  resources.push({ name: css, initiatorType: "link", responseStatus: 200 });
  page.finish();
  assert.equal(page.state.reloads, 0);
});

test("script and script-preload HTTP failures recover an unhydrated page", () => {
  for (const initiatorType of ["script", "link"]) {
    const page = fixture({ resources: [{ name: js, initiatorType, responseStatus: 502 }] });
    page.finish();
    assert.equal(page.state.reloads, 1);
  }
});

test("a script network error recovers without resource timing status support", () => {
  const page = fixture();
  page.failScript(js);
  page.finish();
  assert.equal(page.state.reloads, 1);
});

test("a recovered script failure does not reload an initialized page", () => {
  const page = fixture({ startup: "ready", resources: [{ name: js, initiatorType: "script", responseStatus: 502 }] });
  page.failScript(js);
  page.finish();
  assert.equal(page.state.reloads, 0);
});

test("third-party assets, font preloads and inactive styles do not trigger recovery", () => {
  const page = fixture({
    styles: [
      { href: "https://third-party.test/_next/static/styles.css", sheet: null },
      { href: css, sheet: null, disabled: true },
      { href: css, sheet: null, media: "print" },
    ],
    resources: [{ name: `${origin}/_next/static/media/font.woff2`, initiatorType: "link", responseStatus: 502 }],
  });
  page.failScript("https://third-party.test/_next/static/script.js");
  page.finish();
  assert.equal(page.state.reloads, 0);
});

test("asset recovery backs off and stops after five reloads", () => {
  for (let attempt = 0; attempt <= 5; attempt++) {
    const page = fixture({ styles: [{ href: css, sheet: null }], tries: String(attempt) });
    assert.equal(page.finish(), Math.min(30, 2 ** attempt) * 1000);
    assert.equal(page.state.reloads, attempt < 5 ? 1 : 0);
    assert.equal(page.state.tries, String(Math.min(attempt + 1, 5)));
  }
});

test("unavailable session storage cannot cause an unbounded reload loop", () => {
  const page = fixture({ styles: [{ href: css, sheet: null }], storage: false });
  page.finish();
  assert.equal(page.state.reloads, 0);
});
