import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceRandomBackgrounds,
  pageAppearanceKey,
  readPageAppearance,
  writePageAppearance,
  WALLPAPERS,
  RANDOM_BACKGROUND_MIN_DELAY_MS as MIN,
  RANDOM_BACKGROUND_MAX_DELAY_MS as MAX,
} from "../src/lib/page-appearance.ts";

function store() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const now = 1_800_000_000_000;
const enable = (storage, theme = "light", options = { now, random: () => 0 }) =>
  writePageAppearance(storage, "me", "browser", { random: { theme, enabled: true } }, options);
const read = (storage) => readPageAppearance(storage, "me", "browser");

test("enabling random immediately chooses a different built-in image and persists a 1–24 hour deadline", () => {
  for (const sample of [0, 0.25, 0.5, 0.99, 1 - Number.EPSILON]) {
    const storage = store();
    writePageAppearance(storage, "me", "browser", { background: { theme: "light", value: "alpine-dawn" } });
    enable(storage, "light", { now, random: () => sample });
    const preference = read(storage);
    assert.notEqual(preference.backgrounds.light, "alpine-dawn");
    assert.ok(WALLPAPERS.some((wallpaper) => wallpaper.id === preference.backgrounds.light));
    const delay = preference.random.light.nextChangeAt - now;
    assert.ok(delay >= MIN && delay <= MAX);
    if (sample === 0) assert.equal(delay, MIN);
    if (sample === 1 - Number.EPSILON) assert.equal(delay, MAX);
    assert.deepEqual(JSON.parse(storage.getItem(pageAppearanceKey("me", "browser"))), preference);
  }
});

test("reopening or mounting multiple consumers retains the deadline and rotates once when due", () => {
  const storage = store();
  enable(storage);
  const first = read(storage);
  enable(storage, "light", { now: now + 100, random: () => 0.7 });
  assert.deepEqual(read(storage), first);
  assert.equal(advanceRandomBackgrounds(storage, "me", "browser", { now: now + MIN - 1 }), false);
  assert.equal(advanceRandomBackgrounds(storage, "me", "browser", { now: now + MIN, random: () => 0.5 }), true);
  const second = read(storage);
  assert.notEqual(second.backgrounds.light, first.backgrounds.light);
  assert.ok(second.random.light.nextChangeAt > now + MIN);
  assert.ok(second.random.light.nextChangeAt <= now + MIN + MAX);
  assert.equal(advanceRandomBackgrounds(storage, "me", "browser", { now: now + MIN }), false);
  assert.deepEqual(read(storage), second);
});

test("returning after several days catches up once and schedules from the current time", () => {
  const storage = store();
  enable(storage);
  const before = read(storage).backgrounds.light;
  const resumed = now + 8 * MAX;
  assert.equal(advanceRandomBackgrounds(storage, "me", "browser", { now: resumed, random: () => 0 }), true);
  assert.notEqual(read(storage).backgrounds.light, before);
  assert.equal(read(storage).random.light.nextChangeAt, resumed + MIN);
});

test("disabling keeps the current image and cancels future changes", () => {
  const storage = store();
  enable(storage);
  const current = read(storage).backgrounds.light;
  writePageAppearance(storage, "me", "browser", { random: { theme: "light", enabled: false } });
  assert.equal(read(storage).random, undefined);
  assert.equal(read(storage).backgrounds.light, current);
  assert.equal(advanceRandomBackgrounds(storage, "me", "browser", { now: now + 3 * MAX }), false);
});

test("manual presets, photos, uploads and No image stop only the selected theme's rotation", () => {
  for (const value of ["moonlit-coast", "pixabay:42", "data:image/png;base64,aGVsbG8=", "none"]) {
    const storage = store();
    enable(storage, "light");
    enable(storage, "dark");
    const dark = read(storage).random.dark;
    writePageAppearance(storage, "me", "browser", { background: { theme: "light", value } });
    assert.equal(read(storage).backgrounds.light, value);
    assert.equal(read(storage).random.light, undefined);
    assert.deepEqual(read(storage).random.dark, dark);
    advanceRandomBackgrounds(storage, "me", "browser", { now: now + 2 * MAX, random: () => 0 });
    assert.equal(read(storage).backgrounds.light, value);
  }
});

test("random preferences and deadlines stay separate across accounts, pages and themes", () => {
  const storage = store();
  enable(storage, "light");
  enable(storage, "dark", { now, random: () => 0.5 });
  const before = read(storage);
  advanceRandomBackgrounds(storage, "me", "browser", { now: now + MIN, random: () => 0 });
  assert.equal(read(storage).backgrounds.dark, before.backgrounds.dark);
  assert.deepEqual(read(storage).random.dark, before.random.dark);
  for (const [owner, page] of [["other", "browser"], ["me", "dashboard"], ["me", "new-tab"]]) {
    assert.equal(advanceRandomBackgrounds(storage, owner, page, { now: now + MAX }), false);
    assert.deepEqual(readPageAppearance(storage, owner, page), { backgrounds: { light: "none", dark: "none" } });
  }
});

test("corrupt rotation data is ignored and an excessive future deadline recovers within 24 hours", () => {
  const storage = store();
  for (const random of [null, true, [], { light: null }, { light: { nextChangeAt: "tomorrow" } }, { light: { nextChangeAt: -1 } }]) {
    storage.setItem(pageAppearanceKey("me", "browser"), JSON.stringify({ backgrounds: { light: "alpine-dawn", dark: "none" }, random }));
    assert.equal(read(storage).random, undefined);
    assert.equal(read(storage).backgrounds.light, "alpine-dawn");
  }
  enable(storage, "light", { now: now + 2 * MAX, random: () => 0 });
  assert.equal(advanceRandomBackgrounds(storage, "me", "browser", { now, random: () => 0 }), true);
  assert.equal(read(storage).random.light.nextChangeAt, now + MIN);
});

test("failed writes leave the image and schedule intact and report the storage failure", () => {
  const storage = store();
  enable(storage);
  const before = read(storage);
  const blocked = { ...storage, setItem() { throw new Error("quota"); } };
  assert.throws(() => advanceRandomBackgrounds(blocked, "me", "browser", { now: now + MAX }), /quota/);
  assert.deepEqual(read(storage), before);
  assert.throws(() => writePageAppearance(blocked, "me", "browser", { random: { theme: "light", enabled: false } }), /quota/);
  assert.deepEqual(read(storage), before);
});
