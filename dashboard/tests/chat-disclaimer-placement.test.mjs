// The "Bread can make mistakes" line is part of the transcript, not the bar.
//
// It renders in the scrolled content after the last message on every chat
// surface, which is what makes its behaviour fall out of scrolling itself:
// it leaves when the reader scrolls up, it is revealed by the tail's extra
// travel at the end, and it stands the same distance from the last message
// whether the conversation fills the viewport or ends halfway down it. The
// composer must not carry a copy — pinned to the bar it floats an arbitrary,
// content-dependent distance from the conversation's end.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const surfaces = [
  "../src/app/components/hermes/agent-runtime-panel.tsx",
  "../src/app/components/knowledge-terminal.tsx",
  "../src/app/garden/garden-assistant.tsx",
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
];

test("every chat surface closes its transcript with the disclaimer", () => {
  for (const surface of surfaces) {
    const code = source(surface);
    assert.match(
      code,
      /from ["']@\/app\/components\/chat\/chat-disclaimer["']/,
      `${surface} does not import the disclaimer`,
    );
    // In the flow after the virtualized transcript, never pinned to the composer.
    const transcript = code.indexOf("<VirtualizedMessageList");
    const disclaimer = code.indexOf("<ChatDisclaimer", transcript);
    assert.ok(
      transcript >= 0 && disclaimer > transcript,
      `${surface} does not render the disclaimer after its messages`,
    );
  }
});

test("the composer does not carry its own copy of the line", () => {
  const composer = source("../src/app/components/assistant-composer.tsx");
  assert.ok(!composer.includes("can make mistakes"));
});

test("the line itself", () => {
  const disclaimer = source("../src/app/components/chat/chat-disclaimer.tsx");
  assert.ok(
    disclaimer.includes(
      "Bread can make mistakes, different models give different answers.",
    ),
  );
  assert.ok(disclaimer.includes("Check\n      important info."));
  // The two-regime placement: at the bottom of a short conversation, after
  // the last message of one that scrolls. Both are this one auto margin, so
  // it only works while every surface lays the transcript out as a
  // full-height flex column.
  assert.match(disclaimer, /className="mt-auto /);
});

test("every surface lays the transcript out as a flex column for mt-auto", () => {
  for (const surface of surfaces) {
    const code = source(surface);
    assert.match(
      code,
      /bb-chat-scroll-tail[^"'`]*flex-col/,
      `${surface} transcript wrapper is not a flex column`,
    );
  }
});

test("every transcript scroller reserves its scrollbar gutter symmetrically", () => {
  // The disclaimer is centered inside the scroller; the composer is centered
  // outside it. Without a reserved gutter, the scrollbar that appears once a
  // conversation overflows narrows the scroller and shifts one centerline off
  // the other — the line then sits in a different place on short and long
  // chats.
  for (const surface of surfaces) {
    const code = source(surface);
    assert.match(
      code,
      /bb-chat-scroller/,
      `${surface} scroller does not reserve its scrollbar gutter`,
    );
  }
});
