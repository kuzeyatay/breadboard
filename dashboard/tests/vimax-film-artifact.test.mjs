// The film artifact's own surface.
//
// A storyboard artist writes 400–900 characters per frame, and the first
// version of this page dropped that whole paragraph into a thumbnail-sized 16:9
// box with no clamp and no overflow rule — so every card on the Storyboard tab
// spilled its text over its neighbours. These are the rules that keep it inside
// its frame, held in place by assertions over the source (this repository has
// no DOM test infrastructure; see tests/paint-pomodoro.test.mjs).

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/app/components/vimax/vimax-film-artifact.tsx", import.meta.url),
  "utf8",
);

test("a frame's description can never overflow the frame it sits in", () => {
  // The placeholder itself clips, whatever it is given.
  assert.match(source, /function FrameCard\(/);
  const card = source.slice(source.indexOf("function FrameCard("), source.indexOf("export default"));
  assert.match(card, /overflow-hidden/);
  assert.match(card, /line-clamp-6/, "the player's own frame must clamp");
  assert.match(card, /line-clamp-4/, "a storyboard thumbnail must clamp harder");
  // The full text stays reachable rather than being lost to the clamp.
  assert.match(card, /title=\{text\}/);
});

test("both sizes of frame card are used where they belong", () => {
  assert.match(source, /<FrameCard shot=\{shot\}[^/]*size="stage"/);
  assert.match(source, /<FrameCard shot=\{entry\}[^/]*size="thumb"/);
});

test("the storyboard card clamps its own paragraph and keeps the full text", () => {
  const storyboard = source.slice(source.indexOf('section === "Storyboard"'));
  assert.match(storyboard, /line-clamp-4 text-xs[\s\S]*?title=\{entry\.firstFrame\.description\}/);
  assert.match(storyboard, /line-clamp-2 text-xs[\s\S]*?title=\{entry\.motion\}/);
});

test("an encoded film is played, and is downloadable", () => {
  assert.match(source, /const film = production\.renderPlan\.video \?\? null/);
  assert.match(source, /<video/);
  assert.match(source, /controls/);
  assert.match(source, /download=\{film\.filename\}/);
  // The animatic remains for the productions that have no encoded film.
  assert.match(source, /section === "Film" && !film && shot/);
});

test("the drift restarts per shot and pauses with the film", () => {
  // Deriving the transform from `playing` alone mounted each new shot straight
  // into its end position, so every shot after the first animated nothing.
  assert.match(source, /key=\{shot\.idx\}/);
  assert.match(source, /vimax-shot-drift/);
  assert.match(source, /animationPlayState: playing \? "running" : "paused"/);
  assert.doesNotMatch(source, /transform: playing \?/);
});

test("the render notices reach the page rather than being swallowed", () => {
  const production = source.slice(source.indexOf('section === "Production"'));
  assert.match(production, /imageBackendReason/);
  assert.match(production, /videoBackendReason/);
});

test("the drift keyframes exist in the stylesheet the page relies on", () => {
  const styles = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /@keyframes vimax-shot-drift/);
  assert.match(styles, /\.vimax-shot-drift/);
  assert.match(styles, /prefers-reduced-motion/);
});
