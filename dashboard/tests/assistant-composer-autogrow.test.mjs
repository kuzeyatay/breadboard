import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const composer = fs.readFileSync(
  new URL("../src/app/components/assistant-composer.tsx", import.meta.url),
  "utf8",
);

test("long drafts grow the composer instead of adding an internal scrollbar", () => {
  assert.match(composer, /textarea\.style\.height = 'auto'/);
  assert.match(composer, /textarea\.style\.height = `\$\{textarea\.scrollHeight\}px`/);
  assert.match(composer, /useLayoutEffect\(\(\) => \{[\s\S]*?resizeTextarea\(\)/);
  assert.match(composer, /new ResizeObserver\(\(\) => resizeTextarea\(\)\)/);
  assert.match(composer, /overflow-y-hidden/);
  assert.match(composer, /wrap="soft"/);
  assert.doesNotMatch(composer, /max-h-40 w-full resize-none overflow-y-auto/);
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
