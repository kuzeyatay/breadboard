import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { BrowserHistory, BROWSER_HISTORY_FILE } from "../src/main/browser-history";
import { createDesktopApi } from "../src/preload/preload";
import { IPC_CHANNELS } from "../src/shared/ipc-contract";

test("history retains full URLs beyond the old search limit across fresh stores, removals and clearing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-page-history-"));
  try {
    const store = new BrowserHistory(dir);
    const longUrl = `https://example.com/docs?query=${"a".repeat(450)}#section`;
    store.visit(longUrl, "Documentation");
    for (let index = 0; index < 100; index++) store.visit(`https://example.com/${index}`);
    let restored = new BrowserHistory(dir);
    assert.equal(restored.snapshot().items.length, 101);
    assert.equal(restored.snapshot().items.at(-1)?.url, longUrl);
    restored.visit(longUrl);
    assert.equal(restored.snapshot().items[0]?.title, "Documentation");
    assert.equal(restored.snapshot().items.length, 101);
    assert.equal(restored.command({ type: "remove", url: longUrl }), true);
    restored = new BrowserHistory(dir);
    assert.equal(restored.snapshot().items.length, 100);
    assert.equal(restored.command({ type: "clear" }), true);
    assert.deepEqual(new BrowserHistory(dir).snapshot(), { items: [], error: null });
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("only committed main-frame websites are recorded; title events do not revive cleared history", () => {
  const store = new BrowserHistory();
  const page = Object.assign(new EventEmitter(), {
    getURL: () => "https://chatgpt.com/c/example?model=test#message",
    getTitle: () => "Example chat",
  });
  store.attach(page as unknown as WebContents);
  page.emit("will-navigate", {}, "https://never-committed.example/");
  page.emit("did-navigate-in-page", {}, "https://iframe.example/", false);
  for (const url of ["about:blank", "file:///secret", "javascript:alert(1)"]) page.emit("did-navigate", {}, url);
  assert.equal(store.snapshot().items.length, 0);
  page.emit("did-navigate", {}, "https://chatgpt.com/");
  page.emit("did-navigate-in-page", {}, page.getURL(), true);
  page.emit("did-navigate-in-page", {}, page.getURL(), true);
  assert.equal(store.snapshot().items.length, 2);
  assert.equal(store.snapshot().items[0]?.title, "Example chat");
  assert.equal(store.snapshot().items[0]?.url, page.getURL());
  store.command({ type: "clear" });
  page.emit("page-title-updated", {}, "Late title");
  page.emit("did-finish-load");
  assert.equal(store.snapshot().items.length, 0);
});

test("an unreadable history file is reported and never overwritten by a visit or clear", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-page-history-corrupt-"));
  try {
    const file = path.join(dir, BROWSER_HISTORY_FILE);
    fs.writeFileSync(file, '{"entries":');
    const store = new BrowserHistory(dir);
    assert.ok(store.snapshot().error);
    store.visit("https://example.com/");
    assert.equal(store.command({ type: "clear" }), false);
    assert.equal(fs.readFileSync(file, "utf8"), '{"entries":');
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("personal history isolates shared URLs and ignores a late title after an account switch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-personal-history-"));
  const url = "https://example.com/work";
  const file = path.join(dir,BROWSER_HISTORY_FILE);
  fs.writeFileSync(file,JSON.stringify({version:1,entries:[{url,title:"Imported title",visitedAt:1700000000000}]}));
  let owner: string | null = null;
  const history = new BrowserHistory(dir, () => {}, () => owner);
  const page = Object.assign(new EventEmitter(), {getURL: () => url, getTitle: () => "New title"});
  const stored = () => JSON.parse(fs.readFileSync(file,"utf8")).entries[0].visitsByUser;
  try {
    assert.equal(history.restorePersonalHistory(),false);
    assert.equal(stored(),undefined);
    owner = "1";
    assert.ok(history.restorePersonalHistory());
    assert.deepEqual(stored()["1"],{title:"Imported title",visitedAt:1700000000000,days:["2023-11-14"]});
    history.attach(page as unknown as WebContents);
    page.emit("did-navigate",{},url);
    owner = "2";
    history.visit(url,"Account two");
    page.emit("page-title-updated",{},"Old account's private title");
    assert.equal(stored()["1"].title,"Imported title");
    assert.equal(stored()["2"].title,"Account two");
    assert.ok(!("visitsByUser" in history.snapshot().items[0]!));
    owner = null;
    assert.equal(history.command({type:"import-personal"}),false);
    history.command({type:"clear"});
    assert.deepEqual(JSON.parse(fs.readFileSync(file,"utf8")).entries,[]);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test("restart migration preserves signed-out visits and visits owned by another account", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-auto-history-"));
  const file = path.join(dir, BROWSER_HISTORY_FILE);
  const visit = {title:"Existing",visitedAt:1700000000000,days:["2023-11-14"]};
  try {
    fs.writeFileSync(file, JSON.stringify({version:1,entries:[
      {url:"https://example.test/older",title:"Older",visitedAt:visit.visitedAt},
      {url:"https://example.test/signed-out",title:"Signed out",visitedAt:visit.visitedAt,visitsByUser:{}},
      {url:"https://example.test/owned",title:visit.title,visitedAt:visit.visitedAt,visitsByUser:{"8":visit}},
    ]}));
    let writes = 0;
    const account = (id:string) => new BrowserHistory(dir, () => { writes++; }, () => id);
    const first = account("7");
    assert.ok(first.restorePersonalHistory());
    const after = fs.readFileSync(file, "utf8");
    assert.deepEqual(JSON.parse(after).entries.map((row:StoredFixture) => Object.keys(row.visitsByUser)), [["7"],[],["8"]]);
    assert.ok(first.restorePersonalHistory());
    assert.ok(account("8").restorePersonalHistory());
    assert.equal(writes, 1);
    assert.equal(fs.readFileSync(file, "utf8"), after);
  } finally {
    fs.rmSync(dir, {recursive:true,force:true});
  }
});

interface StoredFixture { visitsByUser: Record<string, unknown> }

test("history preload forwards commands and cleans up change subscriptions", async () => {
  const events = new EventEmitter();
  const calls: unknown[][] = [];
  const api = createDesktopApi({
    on: (channel, listener) => events.on(channel, listener),
    invoke: async (channel, ...args) => { calls.push([channel, ...args]); return true; },
  });
  let changed = 0;
  const unsubscribe = api.onBrowserHistoryChanged(() => changed++);
  events.emit(IPC_CHANNELS.browserHistoryChanged);
  unsubscribe();
  events.emit(IPC_CHANNELS.browserHistoryChanged);
  assert.equal(changed, 1);
  await api.getBrowserHistory();
  await api.browserHistoryCommand({ type: "remove", url: "https://chatgpt.com/" });
  assert.deepEqual(calls, [[IPC_CHANNELS.getBrowserHistory], [IPC_CHANNELS.browserHistoryCommand, { type: "remove", url: "https://chatgpt.com/" }]]);
});
