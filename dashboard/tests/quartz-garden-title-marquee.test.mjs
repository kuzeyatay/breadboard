import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const explorerComponent = source("../../quartz/quartz/components/Explorer.tsx");
const explorerScript = source(
  "../../quartz/quartz/components/scripts/explorer.inline.ts",
);
const explorerStyles = source(
  "../../quartz/quartz/components/styles/explorer.scss",
);
const terminalSidebar = source(
  "../src/app/components/hermes/terminal-sidebar.tsx",
);
const overflowMarquee = source("../src/app/components/overflow-marquee.tsx");
const dashboardClient = source("../src/app/dashboard/dashboard-client.tsx");
const dashboardStyles = source("../src/app/globals.css");

function numericConstant(contents, name) {
  const match = contents.match(new RegExp(`const ${name} = ([0-9.]+)`));
  assert.ok(match, `missing ${name}`);
  return Number(match[1]);
}

test("the Garden root title uses the Terminal marquee timing when it overflows", () => {
  assert.equal(
    numericConstant(explorerScript, "GARDEN_TITLE_MARQUEE_DELAY_MS"),
    numericConstant(overflowMarquee, "MARQUEE_DELAY_MS"),
  );
  assert.equal(
    numericConstant(explorerScript, "GARDEN_TITLE_MARQUEE_SPEED_PX_PER_SEC"),
    numericConstant(overflowMarquee, "MARQUEE_SPEED_PX_PER_SEC"),
  );
  assert.equal(
    numericConstant(explorerScript, "GARDEN_TITLE_MARQUEE_TRAVEL_SHARE"),
    numericConstant(overflowMarquee, "MARQUEE_TRAVEL_SHARE"),
  );

  assert.match(explorerComponent, /class="folder-title-clip"/);
  assert.match(
    explorerScript,
    /titleContainer\.classList\.add\("folder-title-clip"\)/,
  );
  assert.match(explorerScript, /const isGardenRoot = relFolder\.length === 0/);
  assert.match(
    explorerScript,
    /if \(isGardenRoot\) \{[\s\S]*?bindGardenTitleMarquee\(titleContainer, folderTitle\)/,
  );
  assert.match(
    explorerScript,
    /const distance = title\.scrollWidth - title\.clientWidth[\s\S]*?if \(distance < 2\) return/,
  );
});

test("Dashboard Garden cards reuse the same measured marquee as Terminal chats", () => {
  assert.match(terminalSidebar, /useOverflowMarquee\(titleRef\)/);
  assert.match(
    dashboardClient,
    /<OverflowMarquee>\{cluster\.name\}<\/OverflowMarquee>/,
  );
  assert.match(
    overflowMarquee,
    /const distance = text\.scrollWidth - text\.clientWidth[\s\S]*?if \(distance < 2\) return/,
  );
  assert.match(
    overflowMarquee,
    /matchMedia\("\(hover: hover\) and \(pointer: fine\)"\)/,
  );
  assert.match(
    dashboardStyles,
    /\.bb-chat-marquee-text\[data-marquee="run"\][\s\S]*?animation: bb-chat-marquee-shift/,
  );
  assert.match(
    dashboardStyles,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.bb-chat-marquee-text\[data-marquee="run"\][\s\S]*?animation: none;/,
  );
});

test("the marquee is hover-gated and respects reduced motion", () => {
  assert.match(
    explorerScript,
    /matchMedia\("\(hover: hover\) and \(pointer: fine\)"\)/,
  );
  assert.match(
    explorerStyles,
    /@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\.folder-container\.garden-root \.folder-title\[data-marquee="run"\]/,
  );
  assert.match(
    explorerStyles,
    /@keyframes bb-explorer-title-marquee-shift[\s\S]*?transform: translateX\(calc\(-1 \* var\(--bb-marquee-distance, 0px\)\)\)/,
  );
  assert.match(
    explorerStyles,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none;/,
  );
});
