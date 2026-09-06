import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

test("browser translation notifications do not dereference torn-down page state", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/main/tab-manager.ts"), "utf8");
  const constructor = source.slice(
    source.indexOf("const translationContents = live.contents;"),
    source.indexOf("return live;", source.indexOf("const translationContents = live.contents;")),
  );

  assert.match(constructor, /const translationContentsId = translationContents\.id;/);
  assert.match(constructor, /hostByContents\.get\(translationContentsId\)/);
  assert.doesNotMatch(constructor, /hostByContents\.get\(live\.contents\.id\)/);
});
