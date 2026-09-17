import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContextMenuParams } from "electron";
import { browserContextMenuTemplate, cleanBrowserContextLink } from "../src/main/browser-context-menu";

const params = (patch: Partial<ContextMenuParams> = {}): ContextMenuParams => ({
  linkURL: "", linkText: "", selectionText: "", srcURL: "", pageURL: "https://example.com/", frameURL: "",
  mediaType: "none", formControlType: "none", isEditable: false, hasImageContents: false,
  editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: true, canDelete: false, canSelectAll: true, canEditRichly: false },
  mediaFlags: { canSave: true }, ...patch,
} as ContextMenuParams);
const menu = (patch: Partial<ContextMenuParams> = {}) => browserContextMenuTemplate(params(patch), { canGoBack: false, canGoForward: true }, () => {});

test("link and selection controls coexist, with bounded literal labels and no page navigation rows", () => {
  const items = menu({ linkURL: "https://example.com/?utm_source=test", selectionText: "A & B " + "text ".repeat(100), editFlags: { ...params().editFlags, canCopy: true } });
  assert.deepEqual(items.filter(item => item.id).slice(0, 7).map(item => item.id), [
    "open-link-tab", "open-link-window", "open-link-private", "bookmark-link", "save-link", "copy-link", "copy-clean-link",
  ]);
  assert.equal(items.find(item => item.id === "copy-clean-link")?.enabled, true);
  assert.ok(items.find(item => item.id === "search")?.label?.includes("A && B"));
  assert.ok(items.find(item => item.id === "search")!.label!.length < 75);
  assert.ok(items.some(item => item.id === "ask"));
  assert.ok(items.some(item => item.id === "copy" && item.enabled));
  assert.ok(!items.some(item => item.id === "back"));
  assert.equal(items.at(-1)?.id, "inspect");
});

test("unsafe link targets can be copied but cannot navigate, download or bookmark", () => {
  for (const linkURL of ["javascript:alert(1)", "file:///C:/Windows/win.ini", "data:text/html,test", "mailto:a@example.com"]) {
    const items = menu({ linkURL });
    for (const id of ["open-link-tab", "open-link-window", "open-link-private", "save-link", "bookmark-link", "copy-clean-link"]) {
      assert.equal(items.find(item => item.id === id)?.enabled, false, `${id}: ${linkURL}`);
    }
    assert.equal(items.find(item => item.id === "copy-link")?.enabled, true);
  }
});

test("clean links preserve functional parameters and untouched signed URL encoding", () => {
  const signed = "https://example.com/file?signature=a%20b&ref=article#part";
  assert.equal(cleanBrowserContextLink(signed), signed);
  assert.equal(cleanBrowserContextLink(signed.replace("#part", "&utm_source=mail#part")), signed);
  assert.equal(cleanBrowserContextLink("https://example.com/?id=2&utm_source=one&utm_source=two&FBCLID=track#part"), "https://example.com/?id=2#part");
  assert.equal(menu({ linkURL: signed }).find(item => item.id === "copy-clean-link")?.enabled, false);
});

test("editing honors Chromium capabilities and password fields never offer text export actions", () => {
  const items = menu({ isEditable: true, formControlType: "input-password", selectionText: "a secret" });
  assert.equal(items.find(item => item.id === "undo")?.enabled, false);
  assert.equal(items.find(item => item.id === "copy")?.enabled, false);
  assert.equal(items.find(item => item.id === "paste")?.enabled, true);
  assert.ok(!items.some(item => ["ask", "search", "translate-text"].includes(item.id ?? "")));
});

test("page navigation and media menus reflect the clicked context", () => {
  const page = menu();
  assert.equal(page.find(item => item.id === "back")?.enabled, false);
  assert.equal(page.find(item => item.id === "forward")?.enabled, true);
  assert.ok(page.some(item => item.id === "print"));
  const image = menu({ mediaType: "image", srcURL: "blob:https://example.com/image", hasImageContents: true });
  assert.equal(image.find(item => item.id === "save-image")?.enabled, true);
  assert.equal(image.find(item => item.id === "copy-image")?.enabled, true);
  assert.equal(image.find(item => item.id === "open-image")?.enabled, false);
  assert.equal(menu({ mediaType: "image", srcURL: "blob:https://other.example/image" }).find(item => item.id === "save-image")?.enabled, false);
  for (const items of [page, image]) {
    assert.notEqual(items[0]?.type, "separator");
    assert.notEqual(items.at(-1)?.type, "separator");
    assert.ok(!items.some((item, i) => item.type === "separator" && items[i + 1]?.type === "separator"));
  }
});
