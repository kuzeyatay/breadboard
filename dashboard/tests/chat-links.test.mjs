// A URL typed into the chat must render as a clickable blue link, in the
// dashboard transcripts (plain-text user messages) and in the Quartz page
// terminal alike.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { chatLinkHref, hasChatLink, linkifyChatText } from "../src/lib/chat-links.ts";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

const commandText = read("../src/app/components/hermes/command-text.tsx");
const globalStyles = read("../src/app/globals.css");
const quartzInline = read(
  "../../quartz/quartz/components/scripts/breadboardAI.inline.ts",
);
const quartzStyles = read("../../quartz/quartz/components/styles/breadboardAI.scss");

const links = (text) =>
  linkifyChatText(text).filter((segment) => segment.type === "link");

test("bare and www URLs become links with the surrounding text preserved", () => {
  assert.deepEqual(linkifyChatText("see https://example.com/docs now"), [
    { type: "text", value: "see " },
    {
      type: "link",
      value: "https://example.com/docs",
      href: "https://example.com/docs",
    },
    { type: "text", value: " now" },
  ]);

  const [wwwLink] = links("try www.example.com");
  assert.equal(wwwLink.value, "www.example.com");
  assert.equal(wwwLink.href, "https://www.example.com/");

  const bare = linkifyChatText("https://example.com");
  assert.equal(bare.length, 1);
  assert.equal(bare[0].type, "link");
});

test("trailing sentence punctuation stays outside the link", () => {
  const segments = linkifyChatText("read https://example.com/a.");
  assert.equal(segments[1].value, "https://example.com/a");
  assert.equal(segments[2].value, ".");

  // Balanced parens belong to the URL; an unbalanced closer does not.
  assert.equal(links("https://en.wikipedia.org/wiki/A_(b)")[0].value, "https://en.wikipedia.org/wiki/A_(b)");
  assert.equal(links("(see https://example.com/a)")[0].value, "https://example.com/a");
});

test("multiple links and newlines survive intact", () => {
  const segments = linkifyChatText("a https://one.com\nb https://two.com c");
  assert.deepEqual(
    segments.map((segment) => segment.value),
    ["a ", "https://one.com", "\nb ", "https://two.com", " c"],
  );
});

test("only http(s) web addresses are linked", () => {
  assert.equal(hasChatLink("plain text with no url"), false);
  assert.equal(hasChatLink("javascript:alert(1)"), false);
  assert.equal(hasChatLink("mail me at someone@example.com"), false);
  assert.equal(hasChatLink("https://oops"), false);
  assert.equal(chatLinkHref("javascript:alert(1)"), null);
  assert.equal(chatLinkHref("data:text/html,<script>"), null);
  // A local dev server is still a real destination.
  assert.equal(chatLinkHref("http://localhost:3000/x"), "http://localhost:3000/x");
});

test("user messages render links, command tinting included", () => {
  assert.match(commandText, /linkifyChatText/);
  assert.match(commandText, /target="_blank"/);
  assert.match(commandText, /rel="noreferrer noopener"/);
  // Both the plain and slash-command branches linkify the message body.
  assert.equal((commandText.match(/<LinkifiedText content=/g) ?? []).length, 2);
});

test("chat links are blue in both themes", () => {
  assert.match(globalStyles, /--chat-link: #1d4ed8;/);
  assert.match(globalStyles, /--chat-link: #7fb0ff;/);
  assert.match(
    globalStyles,
    /\.chat-markdown a,\s*\n\.chat-inline-link \{\s*\n\s*color: var\(--chat-link\);/,
  );
});

test("the quartz terminal autolinks bare URLs on both sides", () => {
  assert.match(quartzInline, /function autolinkBareUrls/);
  // User messages are escaped before any markup is introduced.
  assert.match(quartzInline, /el\.innerHTML = autolinkBareUrls\(escapeHtml\(text\)\)/);
  assert.match(quartzInline, /return autolinkBareUrls\(/);
  assert.match(quartzStyles, /color: #93c5fd;/);
});
