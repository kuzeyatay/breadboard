import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

// Render the real BrowserClient and flower bed. Only unrelated widgets and
// desktop transport are stubbed; no computer/browser automation is involved.
const root = fileURLToPath(new URL("..", import.meta.url));
const stubs = {
  "@/app/components/page-appearance": `export default () => null;`,
  "@/app/components/use-page-appearance": `export const usePageAppearance = () => ({ ready: true, hasWallpaper: false, theme: "light" }); export const useActivePageAppearance = usePageAppearance;`,
  "@/app/components/use-desktop-tabs": `
    let state = null;
    export const setState = (next) => { state = next; };
    export const useDesktopTabs = () => state;`,
  "@/app/components/hermes/use-chat-greeting": `export const useChatGreeting = () => ({ greeting: {} });`,
  "next/dynamic": `export default () => () => null;`,
  "@/app/components/hermes/dashboard-agent-terminal": `export default () => null;`,
  "@/app/components/settings-dialog": `export default () => null;`,
  "./browser-home-widgets": `
    export const AnimatedBrowserGreeting = () => null;
    export const BrowserDock = () => null;
    export const BrowserQuickLinks = () => null;
    export const BrowserSiteIcon = () => null;
    export const BrowserSketchOutline = () => null;
    export const GoogleGlyph = () => null;
    export const SearchGlyph = () => null;
    export const websiteIconUrl = () => "";`,
  "./browser-personalization": `
    export const BrowserDailyQuote = () => null;
`,
};
const result = await esbuild.build({
  stdin: {
    contents: `export { default as BrowserClient } from "@/app/browser/browser-client";
      export { setState } from "@/app/components/use-desktop-tabs";`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  alias: { "@": path.join(root, "src") },
  external: ["react", "react/jsx-runtime"],
  plugins: [{
    name: "handoff-fixture",
    setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path: specifier }) => {
        if (specifier in stubs) return { path: specifier, namespace: "stub" };
        if (specifier.endsWith(".module.css")) return { path: specifier, namespace: "css-stub" };
      });
      build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path: specifier }) => ({
        contents: stubs[specifier], loader: "js",
      }));
      build.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({
        contents: `export default new Proxy({}, { get: (_, key) => key });`, loader: "js",
      }));
    },
  }],
});
const require = createRequire(import.meta.url);
const compiled = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(require, compiled, compiled.exports);
const { BrowserClient, setState } = compiled.exports;
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const browserTab = {
  id: 2, title: "Original page", url: "https://example.com/original", loading: false,
  browser: {
    address: "https://example.com/original", canGoBack: true, canGoForward: false,
    terminalOpen: false, terminalWidth: 640,
  },
};
function render(selected, self = browserTab, identity = self.id) {
  setState({
    enabled: true, activeId: selected.id, selfId: identity, extensions: [],
    tabs: selected.id === self.id ? [self] : [self, selected],
  });
  return renderToStaticMarkup(React.createElement(BrowserClient, {
    showFlowers: true, restoreOwnerKey: "handoff-test",
  }));
}
function toolbar(html) {
  const start = html.indexOf('<div class="browser-toolbar"');
  const end = html.indexOf('<main class="browser-start-page');
  assert.ok(start >= 0 && end > start, "the toolbar and bookmarks remain rendered");
  return html.slice(start, end);
}

test("plus preserves the outgoing browser navbar and grass/flowers while a non-browser tab loads", () => {
  const before = toolbar(render(browserTab));
  const after = toolbar(render({ id: 3, title: "New tab", url: "/new-tab", loading: true }));
  assert.match(after, /class="grassBed"/);
  assert.match(after, /class="flowerHead"/);
  assert.match(after, /aria-label="Browser navigation"/);
  assert.equal(after, before, "neither the controls nor the animated flower bed is replaced");
});

test("switching between browser tabs does not change the retained page's address or controls", () => {
  const selected = {
    ...browserTab, id: 4, loading: true,
    browser: { ...browserTab.browser, address: "https://example.org/new-page", canGoBack: false },
  };
  assert.equal(toolbar(render(selected)), toolbar(render(browserTab)));
});

test("a browser created in the background renders its own toolbar on its first snapshot", () => {
  const html = render({ id: 1, title: "Dashboard", url: "/dashboard", loading: false });
  assert.match(html, /aria-label="Browser navigation"/);
  assert.doesNotMatch(html, /Starting Browser…/);
});

test("an unattached page does not borrow the selected browser's chrome", () => {
  const html = render(browserTab, { id: 5, title: "Plain shell", url: "/browser", loading: false }, null);
  assert.match(html, /aria-label="Browser navigation"/);
  assert.match(html, /aria-label="Search the web or enter a web address"/);
  assert.doesNotMatch(html, /Starting Browser|browser-recovery-card|example\.com\/original/);
});

test("the initial render keeps the browser shell visible before the desktop bridge answers", () => {
  setState(null);
  const html = renderToStaticMarkup(React.createElement(BrowserClient, {
    showFlowers: true, restoreOwnerKey: "handoff-test",
  }));
  assert.match(toolbar(html), /class="flowerHead"/);
  assert.match(html, /aria-label="Search the web or enter a web address"/);
  assert.doesNotMatch(html, /Starting Browser|browser-recovery-card|browser-unavailable/);
});

test("loading a browser page preserves its controls without a loading screen in the content", () => {
  const loading = { ...browserTab, loading: true };
  const html = render(loading, loading);
  assert.match(html, /aria-label="Stop loading"/);
  assert.doesNotMatch(html, /Opening |browser-start-status|Starting Browser/);
});
