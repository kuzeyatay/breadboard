import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const baseStyles = source("../../quartz/quartz/styles/base.scss");
const layoutVariables = source("../../quartz/quartz/styles/variables.scss");

test("wide Garden pages anchor the explorer left and expand the center column", () => {
  const pageRule = baseStyles.slice(
    baseStyles.indexOf(".page {"),
    baseStyles.indexOf(".footnotes"),
  );

  assert.match(pageRule, /max-width:\s*none;/);
  assert.match(pageRule, /margin:\s*0;/);
  assert.doesNotMatch(pageRule, /max-width:\s*calc\(/);
  assert.match(pageRule, /& \.sidebar \{[\s\S]*?position:\s*sticky;/);
  assert.match(
    pageRule,
    /& \.sidebar\.left \{[\s\S]*?grid-area:\s*grid-sidebar-left;/,
  );
  assert.match(
    layoutVariables,
    /templateColumns:\s*"#\{\$sidePanelWidth\} auto #\{\$sidePanelWidth\}"/,
    "the uncapped workspace should leave the remaining viewport width to the center column",
  );
});
