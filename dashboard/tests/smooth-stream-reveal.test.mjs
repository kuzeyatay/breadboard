// A reply must read as a stream no matter how its text arrives. Providers and
// the agent pipeline deliver text in uneven bursts — sometimes a whole answer
// in one chunk — so every chat surface reveals the newest assistant message
// through the paced `useSmoothStreamText` hook instead of drawing the raw
// buffer. The first half of this suite proves the pacing contract on the pure
// step function; the second half pins the hook into each transcript so a
// surface cannot quietly go back to popping blocks in.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { advanceReveal } from "../src/app/components/chat/use-smooth-stream-text.ts";

const dashboard = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
);

function read(...parts) {
  return fs.readFileSync(path.join(dashboard, ...parts), "utf8");
}

// ── the pacing contract ─────────────────────────────────────────────────────

test("a burst types out over frames instead of appearing whole", () => {
  const target = "word ".repeat(200).trim(); // ~1000 chars, arriving at once
  let shown = "";
  let frames = 0;
  while (shown !== target && frames < 1000) {
    shown = advanceReveal(shown, target, 1 / 60, true);
    frames += 1;
  }
  assert.equal(shown, target, "the reveal must eventually catch up");
  assert.ok(frames > 10, `a 1000-char burst must take many frames, got ${frames}`);
  assert.ok(frames < 180, `catch-up must stay under ~3s at 60fps, got ${frames}`);
});

test("shown text is always a prefix of the target and never moves backwards", () => {
  const target = "The quick brown fox jumps over the lazy dog. ".repeat(20);
  let shown = "";
  while (shown !== target) {
    const next = advanceReveal(shown, target, 1 / 60, true);
    assert.ok(next.length > shown.length, "each frame must advance");
    assert.ok(target.startsWith(next), "shown text must be a prefix of the target");
    shown = next;
  }
});

test("a target that is not an extension of what is shown snaps whole", () => {
  // Branch switch / completion rewrite / chat switch: no animated backspacing.
  assert.equal(advanceReveal("Hello there", "Goodbye", 1 / 60, true), "Goodbye");
  assert.equal(advanceReveal("longer than the target", "long", 1 / 60, false), "long");
});

test("the reveal never lands between the halves of a surrogate pair", () => {
  const target = "🌱".repeat(400);
  let shown = "";
  while (shown !== target) {
    shown = advanceReveal(shown, target, 1 / 60, true);
    const last = shown.charCodeAt(shown.length - 1);
    assert.ok(
      !(last >= 0xd800 && last <= 0xdbff),
      "a frame must never end on an unpaired high surrogate",
    );
  }
});

test("the settle rate clears a completion-time backlog faster than the live rate", () => {
  const target = "x".repeat(3000);
  const framesAt = (streaming) => {
    let shown = "";
    let frames = 0;
    while (shown !== target) {
      shown = advanceReveal(shown, target, 1 / 60, streaming);
      frames += 1;
    }
    return frames;
  };
  assert.ok(
    framesAt(false) < framesAt(true),
    "once the turn is over the tail must finish sooner",
  );
});

// ── the surfaces ────────────────────────────────────────────────────────────

const surfaces = [
  {
    name: "agent runtime panel (dashboard + garden agent chat)",
    file: () => read("app", "components", "hermes", "agent-runtime-panel.tsx"),
    applied: /index === lastAssistantIndex\s*\?\s*revealedAssistantContent/,
  },
  {
    name: "garden workspace transcript",
    file: () =>
      read("app", "gardens", "[clusterSlug]", "workspace-client.tsx"),
    applied: /i === lastAssistantIndex\s*\?\s*revealedAssistantContent/,
  },
  {
    name: "garden assistant panel",
    file: () => read("app", "garden", "garden-assistant.tsx"),
    applied: /paced \? \{ \.\.\.message, content: revealedAssistantContent \}/,
  },
  {
    name: "knowledge terminal",
    file: () => read("app", "components", "knowledge-terminal.tsx"),
    applied: /paced \? \{ \.\.\.message, content: revealedAssistantContent \}/,
  },
];

for (const surface of surfaces) {
  test(`${surface.name} reveals the newest answer through the paced hook`, () => {
    const source = surface.file();
    assert.match(
      source,
      /from ['"]@\/app\/components\/chat\/use-smooth-stream-text['"]/,
      "the surface must import the shared hook",
    );
    assert.match(
      source,
      /useSmoothStreamText\(/,
      "the surface must call the hook",
    );
    assert.match(
      source,
      surface.applied,
      "the newest assistant row must render the revealed text, not the raw buffer",
    );
  });
}
