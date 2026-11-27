import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const terminal = read("src/app/components/hermes/dashboard-agent-terminal.tsx");
const workspace = read("src/app/gardens/[clusterSlug]/workspace-client.tsx");
const pdfAssistant = read("src/app/components/pdf-assistant.tsx");
const gardenAssistant = read("src/app/garden/garden-assistant.tsx");
const browser = read("src/app/browser/browser-client.tsx");
const server = read("src/lib/hermes/chat-surface-launch.ts");
const breadLaunch = await import("../src/lib/code-bread-launch.ts");

function installWindow(href) {
  const store = new Map();
  const events = [];
  const url = new URL(href);
  globalThis.window = {
    location: {
      href: url.href,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      assign(next) { events.push(["assign", next]); },
    },
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    history: { state: null, replaceState() {} },
    dispatchEvent(event) { events.push(["event", event.type, event.detail]); return true; },
  };
  globalThis.CustomEvent ??= class extends Event {
    constructor(type, init) { super(type); this.detail = init?.detail; }
  };
  return { store, events };
}

const client = await import("../src/lib/chat-surface-launch-client.ts");

test("a summary's launch is parsed, and only same-origin addresses survive", () => {
  assert.deepEqual(
    client.parseChatSurfaceLaunch({ kind: "pdf", href: "/pdf?src=%2Fa.pdf&assistantChat=conv_x", pageSlug: "pdf:0123456789abcdef" }),
    { kind: "pdf", href: "/pdf?src=%2Fa.pdf&assistantChat=conv_x", gardenSlug: null, pageKey: null, legacyChatId: null, pageSlug: "pdf:0123456789abcdef" },
  );
  assert.equal(client.parseChatSurfaceLaunch({ kind: "pdf", href: "//evil.example/x" }).href, null);
  assert.equal(client.parseChatSurfaceLaunch({ kind: "nowhere" }), null);
});

test("terminal chats and chats with no known page are not launchable", () => {
  installWindow("http://app.local/dashboard");
  assert.equal(client.chatSurfaceLaunchable("conv_a", { kind: "terminal", href: null }), false);
  assert.equal(client.chatSurfaceLaunchable("conv_a", { kind: "pdf", href: null }), false);
  assert.equal(client.chatSurfaceLaunchable("conv_a", { kind: "workspace", href: "/gardens/g?chat=4" }), true);
});

test("a launch to another page navigates; one to the page on screen opens in place", async () => {
  const pushed = [];
  let { events } = installWindow("http://app.local/dashboard");
  const pdf = { kind: "pdf", href: "/gardens/g/pdf/notes?assistantChat=conv_a", pageSlug: "pdf:0123456789abcdef" };
  assert.equal(await client.launchChatSurface({ conversationId: "conv_a", launch: pdf }, (href) => pushed.push(href)), true);
  assert.deepEqual(pushed, [pdf.href]);
  assert.equal(events.length, 0);

  ({ events } = installWindow("http://app.local/gardens/g/pdf/notes"));
  assert.equal(await client.launchChatSurface({ conversationId: "conv_a", launch: pdf }, (href) => pushed.push(href)), true);
  assert.equal(pushed.length, 1, "no same-address push that would leave the progress bar waiting");
  assert.equal(events[0][1], client.CHAT_SURFACE_LAUNCH_EVENT);
});

test("an Explore launch selects its chat for the reader page before arriving", async () => {
  const { store } = installWindow("http://app.local/dashboard");
  const launch = { kind: "explore", href: "/garden/g?note=intro&chat=1", gardenSlug: "g", pageKey: "intro", legacyChatId: 12 };
  await client.launchChatSurface({ conversationId: "conv_b", launch }, () => {});
  assert.equal(store.get(`${client.QUARTZ_CHAT_SELECTION_KEY_PREFIX}g#intro`), "12");
});

test("a browser launch is handed to the drawer exactly once", () => {
  const { store } = installWindow("http://app.local/browser");
  store.set("breadboard:browser-assistant:launch-chat", JSON.stringify({ chatId: "conv_c", url: "https://x.test/", at: Date.now() }));
  assert.equal(client.takeBrowserLaunchChat(), "conv_c");
  assert.equal(client.takeBrowserLaunchChat(), null);
});

test("the server derives each chat's surface and stores only app addresses", () => {
  assert.match(server, /label === "PDF" \|\| label === "PDF Assistant"/);
  assert.match(server, /history_surface === "assistant"/);
  assert.match(server, /\/gardens\/\$\{encodeURIComponent\(slug\)\}\?chat=\$\{legacy\.id\}/);
  assert.match(server, /href\.startsWith\("\/\/"\)/);
});

test("the corner switch becomes a launch control once a foreign chat is on screen", () => {
  assert.match(terminal, /if \(!chatId \|\| newChatPageSelected \|\| codePresentation \|\| embeddedPresentation \|\| voicePresentation\) return null;/);
  assert.match(terminal, /browserAssistantPresentation && launch\.kind === "browser"/);
  assert.match(terminal, /currentChatLaunch && !browserAssistantPresentation \? \(\s*<ChatSurfaceLaunchButton/);
  // The dock gets out of the way of the surface it just opened.
  assert.match(terminal, /if \(!drawerPresentation && isOpen\) toggleDock\(false\);/);
  // A Garden workspace offers it only for its linked (Explore/PDF) chats.
  assert.match(workspace, /surfaceLaunch && !newChatPageSelected \? \(\s*<ChatSurfaceLaunchButton/);
});

test("every launched surface opens the chat it was sent", () => {
  assert.match(pdfAssistant, /takeAssistantChatParam\(\)/);
  assert.match(pdfAssistant, /!detail\.launch\.pageSlug \|\| detail\.launch\.pageSlug === documentKey/);
  assert.match(pdfAssistant, /surfaceHref: href/);
  assert.match(gardenAssistant, /launch\?\.kind !== 'explore'/);
  assert.match(workspace, /launch\?\.kind !== "workspace"/);
  assert.match(browser, /initialChatId=\{browser\?\.selection\?\.conversationId \?\? launchedChatId\}/);
});

test("a Code chat is handed to Bread through the server, then the Code tab opens", async () => {
  const pushed = [];
  installWindow("http://app.local/dashboard");
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push([url, init?.method, init?.body]); return { ok: true }; };
  const launch = client.parseChatSurfaceLaunch({ kind: "code", href: "/code" });
  assert.equal(client.chatSurfaceLaunchable("conv_d", launch), true);
  assert.equal(await client.launchChatSurface({ conversationId: "conv_d", launch }, (href) => pushed.push(href)), true);
  assert.deepEqual(calls[0], ["/api/code/bread-launch", "POST", JSON.stringify({ chatId: "conv_d" })]);
  assert.deepEqual(pushed, ["/code"]);

  // Already on the Code tab: Bread picks it up without a navigation.
  installWindow("http://app.local/code");
  await client.launchChatSurface({ conversationId: "conv_d", launch }, (href) => pushed.push(href));
  assert.equal(pushed.length, 1);

  // Nothing opens when the hand-over is refused.
  globalThis.fetch = async () => ({ ok: false });
  assert.equal(await client.launchChatSurface({ conversationId: "conv_d", launch }, (href) => pushed.push(href)), false);
});

test("Bread takes a launched chat once, and a stale one not at all", () => {
  breadLaunch.setPendingBreadChat(7, "conv_e", 1_000);
  assert.equal(breadLaunch.takePendingBreadChat(7, 2_000), "conv_e");
  assert.equal(breadLaunch.takePendingBreadChat(7, 2_000), null);
  breadLaunch.setPendingBreadChat(7, "conv_f", 0);
  assert.equal(breadLaunch.takePendingBreadChat(7, 10 * 60_000), null);
});

test("Code chats launch VS Code from the Terminal and from their Garden workspace", () => {
  assert.match(server, /if \(label === "Code"\) return \{ kind: "code", href: "\/code"/);
  assert.match(terminal, /if \(!codePresentation\) return;[\s\S]{0,400}takeBreadLaunchChat\(\)/);
  assert.match(workspace, /chat\.originLabel === CODE_ORIGIN_LABEL/);
  assert.match(workspace, /surfaceLaunch && !newChatPageSelected \? \(\s*<ChatSurfaceLaunchButton/);
});
