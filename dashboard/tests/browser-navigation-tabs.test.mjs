import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

const titleBar = read("../src/app/components/desktop-title-bar.tsx");
const linkMenu = read("../src/app/components/link-context-menu.tsx");
const documentMenu = read("../src/app/components/document-context-menu.tsx");
const bridge = read("../src/lib/desktop-browser-tabs.ts");
const tabManager = read("../../desktop/src/main/tab-manager.ts");
const globals = read("../src/app/globals.css");
const profile = read("../src/app/profile/profile-client.tsx");
const buzzLayout = read("../src/app/buzz/layout.tsx");

test("a right-click offers a new tab and a new window, and no longer copies the link", () => {
  assert.match(linkMenu, /export function OpenInNewTabItem/);
  assert.match(linkMenu, /export function OpenInNewWindowItem/);
  assert.match(linkMenu, /children = "Open in new tab"/);
  assert.match(linkMenu, /children = "Open in new window"/);
  assert.doesNotMatch(linkMenu, /CopyLinkItem|Copy link|clipboard/);
  // The default menu lists the tab first, then the window, as a browser does.
  assert.match(linkMenu, /<OpenInNewTabItem href=\{href\} \/>\s*<OpenInNewWindowItem href=\{href\} \/>/);
  // "Open in new window" keeps the navbar's contract: a real `target="_blank"`
  // anchor the desktop shell turns into a window of its own.
  assert.match(
    linkMenu,
    /export function OpenInNewWindowItem[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/,
  );
  assert.match(documentMenu, /Open PDF in new tab/);
  assert.match(documentMenu, /Open PDF in new window/);
  assert.doesNotMatch(documentMenu, /CopyLinkItem/);
});

test("the right-click menu opens without locking or aria-hiding the whole page", () => {
  // Radix's modal menus walk the document to hide everything else and lock
  // scrolling on open; on the dashboard that is a visible pause before a
  // two-row menu.
  assert.match(linkMenu, /<ContextMenuPrimitive\.Root modal=\{false\}>/);
});

test("in the desktop app a new tab is asked of the shell, and is not offered with the switch off", () => {
  assert.match(linkMenu, /useDesktopTabsEnabled\(\)/);
  assert.match(linkMenu, /if \(inDesktop && !desktopTabs\) return null;/);
  assert.match(linkMenu, /openInDesktopTab\(href, \{ background: true \}\)/);
  assert.match(bridge, /type: "open", url, background: options\.background === true/);
});

test("the desktop tab store recovers when preload or its first state read arrives late", () => {
  assert.match(bridge, /scheduleBridgeRetry\(\)/);
  assert.match(bridge, /retryAttempts >= 28/);
  assert.match(bridge, /connectDesktopTabsBridge\(\)/);
  assert.match(bridge, /pushedStateRevision === revisionBeforeRead/);
  assert.match(bridge, /export async function refreshDesktopTabsState/);
});

test("browser navigation coalesces its optimistic state with Chromium's loading event", () => {
  assert.match(tabManager, /const loadingChanged = !tab\.loading/);
  assert.match(tabManager, /if \(suggestionsWereOpen\) this\.layout\(owner\)/);
  assert.match(tabManager, /if \(loadingChanged \|\| suggestionsWereOpen \|\| faviconChanged\) this\.broadcast\(owner\)/);
});

test("the caption strip draws the window's tabs and stays the drag handle", () => {
  assert.match(titleBar, /useDesktopTabs\(\)/);
  assert.match(titleBar, /tabs\?\.enabled \? <TabStrip state=\{tabs\} \/> : null/);
  assert.match(titleBar, /role="tablist"/);
  assert.match(titleBar, /aria-label="New tab"/);
  assert.match(titleBar, /type: "activate", id: tab\.id/);
  assert.match(titleBar, /type: "close", id: tab\.id/);
  assert.match(titleBar, /type: "move", id: tab\.id, index: drag\.target/);
  // Only the tabs and their buttons opt out of the window drag region.
  assert.match(globals, /\.bb-tab \{[\s\S]*?-webkit-app-region: no-drag/);
  assert.match(globals, /\.bb-tab-close,\s*\.bb-tab-new \{[\s\S]*?-webkit-app-region: no-drag/);
  // The strip stops where Electron paints the native caption buttons.
  assert.match(globals, /max-width: env\(titlebar-area-width, calc\(100% - 140px\)\)/);
  // Voice mode owns the whole window; the strip hides under it.
  assert.match(globals, /html\[data-voice-stage="open"\] \.bb-tabstrip \{\s*display: none;/);
});

test("the Profile page carries the browser navigation switch, on by default, desktop only", () => {
  assert.match(profile, /function BrowserNavigationPanel\(\)/);
  assert.match(profile, /<Card title="Browser navigation"/);
  assert.match(profile, /<BrowserNavigationPanel \/>/);
  assert.match(profile, /const \[enabled, setEnabled\] = useState\(true\);[\s\S]*?browserNavigationControl\(\)/);
  // Absent, not disabled, where there is no shell to hold the tabs.
  assert.match(
    profile,
    /function BrowserNavigationPanel\(\)[\s\S]*?if \(!control\) return null;/,
  );
  assert.match(bridge, /export function browserNavigationControl\(\)/);
});

test("a tab is named after the place it shows, not the product", async () => {
  const { tabLabel, describeTabUrl } = await import("../src/lib/desktop-browser-tabs.ts");
  const at = (path) => `http://127.0.0.1:3000${path}`;
  assert.equal(tabLabel("breadboard", at("/dashboard")), "Dashboard");
  assert.equal(tabLabel("", at("/dashboard?theme=light")), "Dashboard");
  assert.equal(tabLabel("breadboard", at("/")), "Dashboard");
  assert.equal(tabLabel("Plan — breadboard", at("/plan")), "Plan");
  assert.equal(tabLabel("Profile — breadboard", at("/profile")), "Profile");
  assert.equal(tabLabel("Organization — breadboard", at("/buzz")), "Organization");
  assert.equal(tabLabel("breadboard", at("/buzz")), "Organization");
  assert.equal(tabLabel("breadboard", at("/gardens/breadboard-dev")), "Breadboard dev");
  assert.equal(tabLabel("breadboard", at("/garden/electronic-circuits")), "Electronic circuits");
  assert.equal(tabLabel("breadboard", at("/new-tab")), "New tab");
  assert.equal(tabLabel("Quantum notes", at("/gardens/quantum")), "Quantum notes");
  assert.equal(describeTabUrl(at("/gardens/quantum")).kind, "workspace");
  assert.equal(describeTabUrl(at("/garden/quantum")).kind, "lessons");
  assert.equal(describeTabUrl(at("/plan")).kind, "plan");
  assert.equal(describeTabUrl("not a url").label, "New tab");
});

test("the Organization page publishes the same name to the desktop tab", () => {
  assert.match(buzzLayout, /title: "Organization — breadboard"/);
  assert.doesNotMatch(buzzLayout, /title: "Chat — breadboard"/);
});

test("Ctrl+T opens on the places there are to go, not on a copy of the page", () => {
  const lifecycle = fs.readFileSync(
    new URL("../../desktop/src/main/app-lifecycle.ts", import.meta.url),
    "utf8",
  );
  assert.match(lifecycle, /setNewTabUrl\(new URL\("\/new-tab", ready\.dashboardUrl\)/);
  assert.match(lifecycle, /setBrowserUrl\(new URL\(BROWSER_TAB_PATH, ready\.dashboardUrl\)/);
  assert.match(tabManager, /net\.fetch\(url, \{ redirect: "manual" \}\)/);
  const page = read("../src/app/new-tab/page.tsx");
  assert.match(page, /title: "New tab — breadboard"/);
  assert.match(page, /getClusters\(userId\)/);
  const client = read("../src/app/new-tab/new-tab-client.tsx");
  for (const href of ['"/dashboard"', '"/plan"', '"/buzz"', '"/profile"']) {
    assert.ok(client.includes(href), `new tab offers ${href}`);
  }
  assert.match(client, /\/gardens\/\$\{garden\.slug\}/);
  assert.match(client, /\/garden\/\$\{garden\.slug\}/);
  assert.match(
    client,
    /openBrowserInDesktop\(\{ replaceCurrent: true \}\)/,
    "the Browser card turns this tab into the browser instead of opening another tab",
  );
  assert.match(
    tabManager,
    /command\.replaceCurrent[\s\S]*?tab\.id === host\.activeId && tab\.contents\.id === sender\.id/,
    "only the active calling tab can ask to be replaced",
  );
  assert.match(
    tabManager,
    /host\.tabs\.splice\(replaceIndex, 1, tab\)/,
    "the browser takes the current slot instead of adding a slot",
  );
});

test("a new tab greets the user with a stable, randomly selected addressee", () => {
  const page = read("../src/app/new-tab/page.tsx");
  const client = read("../src/app/new-tab/new-tab-client.tsx");

  assert.match(page, /const NEW_TAB_ADDRESSEES = \[/);
  assert.match(page, /"sailor"/);
  assert.match(page, /"bub"/);
  assert.match(page, /"champ"/);
  assert.match(page, /"chief"/);
  assert.match(page, /return NEW_TAB_ADDRESSEES\[randomInt\(NEW_TAB_ADDRESSEES\.length\)\]/);
  assert.match(page, /addressee=\{pickAddressee\(\)\}/);
  assert.match(client, /Where to, <span[^>]*>\{addressee\}\?/);
});
