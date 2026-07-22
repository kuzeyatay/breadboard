import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const layout = source("../../quartz/quartz.layout.ts");
const explorer = source("../../quartz/quartz/components/Explorer.tsx");
const explorerStyles = source(
  "../../quartz/quartz/components/styles/explorer.scss",
);
const readerMode = source("../../quartz/quartz/components/ReaderMode.tsx");
const readerModeScript = source(
  "../../quartz/quartz/components/scripts/readermode.inline.ts",
);

test("Quartz uses its original ReaderMode control without the old sidebar headings", () => {
  assert.doesNotMatch(layout, /Component\.PageTitle\(\)|Component\.DashboardBackLink\(\)/);
  assert.equal((layout.match(/Component\.ReaderMode\(\)/g) ?? []).length, 2);
  assert.equal((layout.match(/gap: "0\.75rem"/g) ?? []).length, 2);
  assert.equal((layout.match(/basis: "14rem"/g) ?? []).length, 2);
  assert.equal(
    (layout.match(/Component\.Explorer\(\{ showTitle: false \}\)/g) ?? []).length,
    2,
  );
  assert.match(explorer, /showTitle\?: boolean/);
  assert.match(explorer, /\{opts\.showTitle \? \(/);
  assert.match(explorer, /opts\.showTitle \? "has-title" : "titleless"/);
  assert.match(explorerStyles, /&\.titleless > \.explorer-content \{\s*margin-top: 0;/);
  assert.match(readerMode, /class=\{classNames\(displayClass, "readermode"\)\}/);
  assert.match(readerModeScript, /document\.documentElement\.setAttribute\("reader-mode", newMode\)/);
  assert.match(readerModeScript, /emitReaderModeChangeEvent\(newMode\)/);
});
