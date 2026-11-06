import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { readPageAppearance, writePageAppearance } from "../src/lib/page-appearance.ts";
import { parseSavedBackground, MAX_SAVED_BACKGROUND_LENGTH } from "../src/lib/page-appearance-persistence.ts";
import { readSavedPageAppearance, writeSavedBackground } from "../src/lib/page-appearance-store.ts";

const upload = "data:image/webp;base64,aGVsbG8=";
const otherUpload = "data:image/png;base64,d29ybGQ=";
const value = background => ({ background, nextChangeAt: null });

test("existing databases gain rain settings without losing their backgrounds", t => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1);
    CREATE TABLE page_appearance(user_id INTEGER, page TEXT, theme TEXT, background TEXT, next_change_at INTEGER, PRIMARY KEY(user_id,page,theme));
    INSERT INTO page_appearance VALUES(1,'new-tab','light','random-colors',NULL);`);
  assert.deepEqual(readSavedPageAppearance(db, 1, "new-tab"), {light: value("random-colors")});
  writeSavedBackground(db, 1, "new-tab", "light", {...value("random-colors"), rain: "weather"});
  assert.equal(readSavedPageAppearance(db, 1, "new-tab").light.rain, "weather");
  assert.equal(parseSavedBackground({...value("none"), rain: "invalid"}), null);
});

test("rain settings survive fresh origins, background changes and switching off", async t => {
  const { fresh } = await fixture(t);
  const first = await fresh();
  await first.savePageAppearance("me", "new-tab", {rain: {theme: "light", mode: "weather"}});
  await first.savePageAppearance("me", "new-tab", {background: {theme: "light", value: "spotify-random-colors"}});
  const restarted = await fresh();
  await restarted.hydratePageAppearance("me", "new-tab");
  assert.equal(readPageAppearance(restarted.storage, "me", "new-tab").rain.light, "weather");
  await restarted.savePageAppearance("me", "new-tab", {rain: {theme: "light", mode: "off"}});
  const off = await fresh();
  await off.hydratePageAppearance("me", "new-tab");
  assert.deepEqual(readPageAppearance(off.storage, "me", "new-tab"), {backgrounds: {light: "spotify-random-colors", dark: "none"}});
});

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

async function fixture(t) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2)");
  const previous = { window: globalThis.window, fetch: globalThis.fetch };
  let localStorage = storage();
  globalThis.window = { localStorage, dispatchEvent() {} };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const page = new URL(url, "http://localhost").searchParams.get("page");
    if (init.method === "PATCH") {
      const body = JSON.parse(init.body);
      calls.push(body);
      return Response.json({ value: writeSavedBackground(db, 1, body.page, body.theme, body.value, body.onlyIfMissing) });
    }
    return Response.json({ preferences: readSavedPageAppearance(db, 1, page) });
  };
  t.after(() => { db.close(); globalThis.window = previous.window; globalThis.fetch = previous.fetch; });
  const fresh = async () => {
    localStorage = storage();
    window.localStorage = localStorage;
    const client = await import(`../src/lib/page-appearance-client.ts?fixture=${crypto.randomUUID()}`);
    return { ...client, storage: localStorage };
  };
  return { db, calls, fresh };
}

test("backgrounds survive reopening the database and remain isolated by account, page and theme", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appearance-"));
  const file = path.join(dir, "preferences.db");
  let db = new Database(file);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2)");
  writeSavedBackground(db, 1, "new-tab", "light", value(upload));
  writeSavedBackground(db, 1, "new-tab", "dark", value(otherUpload));
  writeSavedBackground(db, 2, "new-tab", "light", value("alpine-dawn"));
  db.close();
  db = new Database(file);
  assert.deepEqual(readSavedPageAppearance(db, 1, "new-tab"), { light: value(upload), dark: value(otherUpload) });
  assert.deepEqual(readSavedPageAppearance(db, 1, "dashboard"), {});
  assert.deepEqual(readSavedPageAppearance(db, 2, "new-tab"), { light: value("alpine-dawn") });
  writeSavedBackground(db, 1, "new-tab", "light", value("none"));
  writeSavedBackground(db, 1, "new-tab", "light", value(upload), true);
  assert.equal(readSavedPageAppearance(db, 1, "new-tab").light.background, "none", "migration cannot resurrect removed uploads");
});

test("an uploaded background restores in a fresh origin and removal survives another restart", async t => {
  const { fresh } = await fixture(t);
  const first = await fresh();
  await first.savePageAppearance("me", "new-tab", { background: { theme: "light", value: upload } });
  await first.savePageAppearance("me", "new-tab", { background: { theme: "dark", value: otherUpload } });
  const restarted = await fresh();
  await restarted.hydratePageAppearance("me", "new-tab");
  assert.deepEqual(readPageAppearance(restarted.storage, "me", "new-tab").backgrounds, { light: upload, dark: otherUpload });
  await restarted.savePageAppearance("me", "new-tab", { background: { theme: "light", value: "none" } });
  const removed = await fresh();
  await removed.hydratePageAppearance("me", "new-tab");
  assert.deepEqual(readPageAppearance(removed.storage, "me", "new-tab").backgrounds, { light: "none", dark: otherUpload });
});

test("existing local uploads migrate once without overwriting saved backgrounds", async t => {
  const { db, calls, fresh } = await fixture(t);
  writeSavedBackground(db, 1, "browser", "dark", value("none"));
  const client = await fresh();
  writePageAppearance(client.storage, "me", "browser", { background: { theme: "light", value: upload } });
  writePageAppearance(client.storage, "me", "browser", { background: { theme: "dark", value: otherUpload } });
  await Promise.all([client.hydratePageAppearance("me", "browser"), client.hydratePageAppearance("me", "browser")]);
  assert.deepEqual(readSavedPageAppearance(db, 1, "browser"), { light: value(upload), dark: value("none") });
  assert.deepEqual(readPageAppearance(client.storage, "me", "browser").backgrounds, { light: upload, dark: "none" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].onlyIfMissing, true);
});

test("a delayed restore cannot undo a new choice or a choice made in another tab", async t => {
  const { db, fresh } = await fixture(t);
  writeSavedBackground(db, 1, "dashboard", "light", value(upload));
  writeSavedBackground(db, 1, "dashboard", "dark", value(otherUpload));
  const client = await fresh();
  const fetch = globalThis.fetch;
  let release;
  globalThis.fetch = async (url, init) => {
    const response = await fetch(url, init);
    if (init?.method !== "PATCH") await new Promise(resolve => { release = resolve; });
    return response;
  };
  const hydration = client.hydratePageAppearance("me", "dashboard");
  await client.savePageAppearance("me", "dashboard", { background: { theme: "light", value: "alpine-dawn" } });
  // Another tab can write the shared browser storage while this GET is pending.
  writePageAppearance(client.storage, "me", "dashboard", { background: { theme: "dark", value: "moonlit-coast" } });
  release();
  await hydration;
  assert.deepEqual(readPageAppearance(client.storage, "me", "dashboard").backgrounds, { light: "alpine-dawn", dark: "moonlit-coast" });
});

test("rapid saves arrive in order and a failed save is reported without blocking retries", async t => {
  const { db, fresh } = await fixture(t);
  const client = await fresh();
  const fetch = globalThis.fetch;
  let release;
  let requests = 0;
  globalThis.fetch = async (...args) => {
    requests += 1;
    if (requests === 1) await new Promise(resolve => { release = resolve; });
    return fetch(...args);
  };
  const first = client.savePageAppearance("me", "browser", { background: { theme: "light", value: upload } });
  const second = client.savePageAppearance("me", "browser", { background: { theme: "light", value: otherUpload } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(readSavedPageAppearance(db, 1, "browser").light.background, otherUpload);
  globalThis.fetch = async () => new Response("offline", { status: 503 });
  await assert.rejects(client.savePageAppearance("me", "browser", { background: { theme: "light", value: "none" } }), /Couldn’t save/);
  globalThis.fetch = fetch;
  await client.savePageAppearance("me", "browser", { background: { theme: "light", value: "none" } });
  assert.equal(readSavedPageAppearance(db, 1, "browser").light.background, "none");
});

test("random settings restore, and selecting an upload disables their saved schedule", async t => {
  const { db, fresh } = await fixture(t);
  const first = await fresh();
  await first.savePageAppearance("me", "browser", { random: { theme: "light", enabled: true } });
  const before = readPageAppearance(first.storage, "me", "browser");
  const restarted = await fresh();
  await restarted.hydratePageAppearance("me", "browser");
  assert.deepEqual(readPageAppearance(restarted.storage, "me", "browser"), before);
  await restarted.savePageAppearance("me", "browser", { background: { theme: "light", value: upload } });
  assert.deepEqual(readSavedPageAppearance(db, 1, "browser").light, value(upload));
});

test("invalid and oversized backgrounds cannot enter durable settings", () => {
  for (const candidate of [null, {}, value("javascript:alert(1)"), value("data:image/png;base64," + "a".repeat(MAX_SAVED_BACKGROUND_LENGTH)), { background: upload, nextChangeAt: -1 }, { background: upload, nextChangeAt: "tomorrow" }]) {
    assert.equal(parseSavedBackground(candidate), null);
  }
  assert.deepEqual(parseSavedBackground(value(upload)), value(upload));
});

test("Spotify colors survive a fresh origin and replace random rotation only in the chosen theme", async t => {
  const { fresh } = await fixture(t);
  const first = await fresh();
  await first.savePageAppearance("me", "new-tab", { background: { theme: "dark", value: otherUpload } });
  await first.savePageAppearance("me", "new-tab", { random: { theme: "light", enabled: true } });
  await first.savePageAppearance("me", "new-tab", { background: { theme: "light", value: "spotify-colors" } });
  const restarted = await fresh();
  await restarted.hydratePageAppearance("me", "new-tab");
  assert.deepEqual(readPageAppearance(restarted.storage, "me", "new-tab"), {
    backgrounds: { light: "spotify-colors", dark: otherUpload },
  });
  await restarted.savePageAppearance("me", "new-tab", { background: { theme: "light", value: "none" } });
  const disabled = await fresh();
  await disabled.hydratePageAppearance("me", "new-tab");
  assert.equal(readPageAppearance(disabled.storage, "me", "new-tab").backgrounds.light, "none");
});

test("random lighting and combined Spotify lighting survive a fresh origin independently by theme", async t => {
  const { fresh } = await fixture(t);
  const first = await fresh();
  await first.savePageAppearance("me", "new-tab", { random: { theme: "light", enabled: true } });
  await first.savePageAppearance("me", "new-tab", { background: { theme: "light", value: "random-colors" } });
  await first.savePageAppearance("me", "new-tab", { background: { theme: "dark", value: "spotify-random-colors" } });
  const restarted = await fresh();
  await restarted.hydratePageAppearance("me", "new-tab");
  assert.deepEqual(readPageAppearance(restarted.storage, "me", "new-tab"), {
    backgrounds: { light: "random-colors", dark: "spotify-random-colors" },
  });
  await restarted.savePageAppearance("me", "new-tab", { background: { theme: "dark", value: "random-colors" } });
  const spotifyDisabled = await fresh();
  await spotifyDisabled.hydratePageAppearance("me", "new-tab");
  assert.deepEqual(readPageAppearance(spotifyDisabled.storage, "me", "new-tab").backgrounds, {
    light: "random-colors", dark: "random-colors",
  });
});
