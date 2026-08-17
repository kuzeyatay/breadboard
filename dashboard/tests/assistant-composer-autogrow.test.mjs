import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const composer = fs.readFileSync(
  new URL("../src/app/components/assistant-composer.tsx", import.meta.url),
  "utf8",
);

test("the composer grows with a draft up to a cap, then scrolls", () => {
  // Growth is still measured from the natural content height...
  assert.match(composer, /textarea\.style\.height = 'auto'/);
  assert.match(composer, /const natural = textarea\.scrollHeight/);
  // ...but a very long draft stops at the cap instead of pushing the
  // conversation off screen, and the overflow scrolls inside the field.
  assert.match(composer, /const cap = composerMaxHeight\(lineHeight\)/);
  assert.match(composer, /const capped = natural > cap/);
  assert.match(
    composer,
    /textarea\.style\.height = `\$\{capped \? cap : natural\}px`/,
  );
  assert.match(composer, /textarea\.style\.overflowY = capped \? 'auto' : ''/);
  // The scrollbar is off while the height is being measured: an `auto`
  // scrollbar appearing mid-measurement rewraps the text and inflates it.
  assert.match(
    composer,
    /textarea\.style\.overflowY = 'hidden';\s*\n\s*textarea\.style\.height = 'auto'/,
  );
  assert.match(composer, /useLayoutEffect\(\(\) => \{[\s\S]*?resizeTextarea\(\)/);
  assert.match(composer, /new ResizeObserver\(\(\) => resizeTextarea\(\)\)/);
  assert.match(composer, /overflow-y-hidden/);
  assert.match(composer, /wrap="soft"/);
  assert.doesNotMatch(composer, /max-h-40 w-full resize-none overflow-y-auto/);
});

test("the cap is a line count bounded by the viewport", () => {
  assert.match(composer, /const COMPOSER_MAX_LINES = 10/);
  assert.match(composer, /const COMPOSER_MIN_LINES = 3/);
  assert.match(composer, /const COMPOSER_MAX_VIEWPORT_SHARE = 0\.35/);
  assert.match(composer, /function composerMaxHeight\(lineHeight: number\)/);
  // A short window gets the viewport share, never more than the roomy cap, and
  // never less than the floor.
  assert.match(
    composer,
    /Math\.max\(\s*lineHeight \* COMPOSER_MIN_LINES,\s*Math\.min\(roomy, Math\.round\(viewport \* COMPOSER_MAX_VIEWPORT_SHARE\)\),\s*\)/,
  );
});

test("the slash-command backdrop tracks the textarea's vertical alignment", () => {
  // `z-10` puts the mirror above the textarea rather than behind it, so the
  // anchors it paints for URLs can be clicked. The layer stays
  // `pointer-events-none`, so everything except those anchors still reaches the
  // field — see tests/composer-links.test.mjs.
  assert.match(
    composer,
    /pointer-events-none absolute inset-0 z-10 flex select-none items-center overflow-hidden/,
  );
  assert.match(composer, /w-full whitespace-pre-wrap break-words px-1 py-0/);
  assert.doesNotMatch(composer, /absolute inset-x-0 top-0 select-none/);
});

test("the backdrop follows the field once the field scrolls", () => {
  // Centring is right for a one-line field and wrong for a scrolling one: it
  // would park the first lines above the top edge where no scroll reaches them.
  assert.match(composer, /backdrop\.style\.alignItems = capped \? 'flex-start' : ''/);
  // Same usable width as the scrolling field, so both layers wrap alike.
  assert.match(
    composer,
    /backdrop\.style\.paddingRight = capped\s*\n?\s*\? `\$\{Math\.max\(0, textarea\.offsetWidth - textarea\.clientWidth\)\}px`/,
  );
  // And the two layers scroll together.
  assert.match(composer, /backdrop\.scrollTop = textarea\.scrollTop/);
  assert.match(composer, /onScroll=\{syncCommandBackdrop\}/);
});
