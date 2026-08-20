// Links in the composer field.
//
// A textarea cannot hold an anchor, so the composer paints a mirror layer over
// it and puts the anchors there. That only works if the mirror lines up with
// the textarea character for character — one dropped or rewritten character and
// every following line of text sits a little off from the caret behind it.
//
// So the property that matters most here is not "which things are links" but
// "the segments still spell the input exactly".

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const { composerSegments, hasComposerLink, linkHref } = await import(
  "../src/lib/composer-links.ts"
);

const rejoin = (value) => composerSegments(value).map((segment) => segment.text).join("");

test("the segments always spell the input exactly", () => {
  for (const value of [
    "",
    "no links here",
    "https://example.com",
    "look at https://example.com/a?b=c#d and tell me",
    "trailing punctuation https://example.com/page.",
    "  leading and trailing space  ",
    "multi\nline\nhttps://example.com/x\ntext",
    "https://example.com/a https://example.com/b",
    "unicode ✂ https://example.com/ü",
  ]) {
    assert.equal(rejoin(value), value, JSON.stringify(value));
  }
});

test("http and www runs become links", () => {
  const segments = composerSegments("see https://youtu.be/abc and www.example.com now");
  const links = segments.filter((segment) => segment.kind === "link");
  assert.equal(links.length, 2);
  assert.equal(links[0].text, "https://youtu.be/abc");
  assert.equal(links[0].href, "https://youtu.be/abc");
  // A scheme-less www link is still opened over https.
  assert.equal(links[1].text, "www.example.com");
  assert.equal(links[1].href, "https://www.example.com/");
});

test("sentence punctuation is not part of the link", () => {
  const [link] = composerSegments("watch https://example.com/page.").filter(
    (segment) => segment.kind === "link",
  );
  assert.equal(link.text, "https://example.com/page");
  // …but balanced brackets inside a URL are.
  const [wiki] = composerSegments("see https://en.wikipedia.org/wiki/Cut_(film)").filter(
    (segment) => segment.kind === "link",
  );
  assert.equal(wiki.text, "https://en.wikipedia.org/wiki/Cut_(film)");
});

test("only http and https ever become clickable", () => {
  // The reason this function exists: an href is a place a scheme can execute.
  assert.equal(linkHref("javascript:alert(1)"), null);
  assert.equal(linkHref("data:text/html,<script>"), null);
  assert.equal(linkHref("file:///etc/passwd"), null);
  assert.equal(linkHref("https://example.com"), "https://example.com/");
  assert.equal(hasComposerLink("javascript:alert(1)"), false);
});

test("bare domains in prose stay prose", () => {
  // "I read it on example.com yesterday" is a sentence, not a link, and turning
  // words blue while somebody types is worse than missing one.
  assert.equal(hasComposerLink("I read it on example.com yesterday"), false);
  assert.equal(hasComposerLink("version 1.2.3 of the thing"), false);
});

test("the composer paints links in the mirror, above the textarea", () => {
  const composer = read("src/app/components/assistant-composer.tsx");
  assert.match(composer, /composerSegments\(linkBody\)/);
  // A command token is never swallowed by a URL after it.
  assert.match(composer, /const linkBody = commandSplit \? commandSplit\.rest : value/);
  // The layer sits above the textarea so an anchor can be clicked, and passes
  // every other event through so typing still lands on the field.
  assert.match(composer, /pointer-events-none absolute inset-0 z-10/);
  assert.match(composer, /pointer-events-auto cursor-pointer/);
  assert.match(composer, /rel="noreferrer noopener"/);
  // Whenever the mirror paints, the real text is hidden behind it — otherwise
  // both layers show and the text renders twice.
  assert.match(composer, /caret-\[var\(--composer-caret\)\]/);
  assert.match(composer, /\$\{mirrored \? 'text-transparent'/);
});
