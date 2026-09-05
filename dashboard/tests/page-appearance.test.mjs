import test from "node:test";
import assert from "node:assert/strict";
import { pageAppearanceKey, readPageAppearance, writePageAppearance, resolveWallpaper } from "../src/lib/page-appearance.ts";
import { rememberEffectiveAppTheme } from "../src/lib/app-theme.ts";

function store(initial = []) {
  const values = new Map(initial);
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("page and account choices stay independent, including light and dark backgrounds", () => {
  const storage = store();
  writePageAppearance(storage, "me", "new-tab", { background: { theme: "dark", value: "aurora-valley" } });
  writePageAppearance(storage, "me", "dashboard", { background: { theme: "light", value: "alpine-dawn" } });
  writePageAppearance(storage, "me", "browser", { background: { theme: "dark", value: "pixabay:12345" } });
  writePageAppearance(storage, "me", "browser", { background: { theme: "light", value: "mineral-clouds" } });
  assert.deepEqual(readPageAppearance(storage, "me", "new-tab"), { backgrounds: { light: "none", dark: "aurora-valley" } });
  assert.deepEqual(readPageAppearance(storage, "me", "dashboard"), { backgrounds: { light: "alpine-dawn", dark: "none" } });
  assert.deepEqual(readPageAppearance(storage, "me", "browser"), { backgrounds: { light: "mineral-clouds", dark: "pixabay:12345" } });
  assert.deepEqual(readPageAppearance(storage, "someone-else", "dashboard"), { backgrounds: { light: "none", dark: "none" } });
  assert.equal(pageAppearanceKey(" ME ", "dashboard"), pageAppearanceKey("me", "dashboard"));
});

test("existing backgrounds survive migration and removal does not resurrect them", () => {
  const upload = "data:image/png;base64,aGVsbG8=";
  const storage = store([["dashboard:bg-image", upload], ["breadboard:browser-wallpaper:me:dark", "moonlit-coast"]]);
  assert.deepEqual(readPageAppearance(storage, "me", "new-tab").backgrounds, { light: upload, dark: upload });
  assert.equal(readPageAppearance(storage, "me", "browser").backgrounds.dark, "moonlit-coast");
  writePageAppearance(storage, "me", "dashboard", { background: { theme: "light", value: "none" } });
  assert.deepEqual(readPageAppearance(storage, "me", "dashboard").backgrounds, { light: "none", dark: upload });
  assert.equal(readPageAppearance(storage, "me", "new-tab").backgrounds.light, upload);
  assert.equal(storage.getItem("dashboard:bg-image"), upload);
});

test("bad storage falls back safely, but failed writes are reported to the picker", () => {
  const storage = store([[pageAppearanceKey("me", "browser"), "{broken"]]);
  assert.deepEqual(readPageAppearance(storage, "me", "browser").backgrounds, { light: "none", dark: "none" });
  storage.setItem(pageAppearanceKey("me", "browser"), JSON.stringify({ theme: "invalid", backgrounds: { light: "javascript:alert(1)", dark: "missing" } }));
  assert.deepEqual(readPageAppearance(storage, "me", "browser"), { backgrounds: { light: "none", dark: "none" } });
  assert.doesNotThrow(() => readPageAppearance({ getItem() { throw new Error("blocked"); } }, "me", "browser"));
  assert.throws(() => writePageAppearance({ ...storage, setItem() { throw new Error("quota"); } }, "me", "browser", { background: { theme: "dark", value: "none" } }), /quota/);
});

test("every background source resolves independently of the global theme", () => {
  assert.equal(resolveWallpaper("none", "light"), null);
  assert.equal(resolveWallpaper("unknown", "light"), null);
  assert.equal(resolveWallpaper("aurora-valley", "light").tone, "dark");
  assert.equal(resolveWallpaper("pixabay:42", "dark").src, "/api/browser-wallpapers/pixabay?id=42&image=1");
  assert.equal(resolveWallpaper("data:image/png;base64,aGVsbG8=", "light").src, "data:image/png;base64,aGVsbG8=");
});

test("legacy page themes are discarded without losing backgrounds or changing the app theme", () => {
  const storage = store([["breadboard:theme", "light"]]);
  for (const page of ["new-tab", "dashboard", "browser"]) {
    storage.setItem(pageAppearanceKey("me", page), JSON.stringify({
      theme: "dark", backgrounds: { light: "alpine-dawn", dark: "aurora-valley" },
    }));
    assert.deepEqual(readPageAppearance(storage, "me", page), {
      backgrounds: { light: "alpine-dawn", dark: "aurora-valley" },
    });
    writePageAppearance(storage, "me", page, { background: { theme: "light", value: "none" } });
    assert.deepEqual(JSON.parse(storage.getItem(pageAppearanceKey("me", page))), {
      backgrounds: { light: "none", dark: "aurora-valley" },
    });
  }
  assert.equal(storage.getItem("breadboard:theme"), "light");
});

test("the app theme always paints, even if an old page override is still on the document", () => {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const storage = store();
  globalThis.window = { localStorage: storage };
  globalThis.document = { documentElement: { dataset: { theme: "light", pageTheme: "dark" } }, visibilityState: "hidden" };
  try {
    rememberEffectiveAppTheme("light", { animate: false });
    assert.equal(document.documentElement.dataset.theme, "light");
    assert.equal(storage.getItem("breadboard:theme"), "light");
    rememberEffectiveAppTheme("dark", { animate: false, persist: false });
    assert.equal(document.documentElement.dataset.theme, "dark");
    assert.equal(storage.getItem("breadboard:theme"), "light");
    delete document.documentElement.dataset.pageTheme;
    rememberEffectiveAppTheme("light", { animate: false, persist: false });
    assert.equal(document.documentElement.dataset.theme, "light");
  } finally {
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
  }
});
