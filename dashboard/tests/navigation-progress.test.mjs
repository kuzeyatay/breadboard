// The navigation bar is the only feedback a click on a cross-page link gets:
// the App Router leaves the current page fully rendered and interactive while
// it waits for the next route, so nothing else moves. A dev-mode route compile
// makes that wait long — /dashboard has been measured at 26s — and the bar used
// to resolve itself after 20s, filling and vanishing while the navigation it
// was tracking was still in flight. The page then sat unchanged with no
// indicator at all, which is indistinguishable from a dead button.
//
// These assertions guard the two halves of that: the backstop must never claim
// arrival, and a bar pinned at its ceiling must still show it is alive.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const component = fs.readFileSync(
  new URL("../src/app/components/navigation-progress.tsx", import.meta.url),
  "utf8",
);
const globals = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/** The body of `beginNavigation`, which is what arms the backstop. */
const beginNavigation =
  component.match(/const beginNavigation = useCallback\(\(\) => \{[\s\S]*?\n {2}\}, \[[^\]]*\]\);/)?.[0] ??
  "";

test("only a real route change completes the bar", () => {
  // The route-change effect is the one place allowed to fill the bar.
  assert.match(
    component,
    /previousRouteRef\.current = routeKey;\s*\n\s*const timer = window\.setTimeout\(finishNavigation, 0\);/,
  );
  assert.match(component, /const finishNavigation = useCallback[\s\S]*?applyProgress\(100\);/);

  // The timed backstop must run the bar out instead, so a slow navigation is
  // never reported as arrived.
  assert.match(component, /const abandonNavigation = useCallback/);
  assert.doesNotMatch(beginNavigation, /setTimeout\(finishNavigation/);
  assert.match(beginNavigation, /setTimeout\(abandonNavigation, ABANDON_AFTER_MS\)/);

  const abandonNavigation =
    component.match(
      /const abandonNavigation = useCallback\(\(\) => \{[\s\S]*?\n {2}\}, \[[^\]]*\]\);/,
    )?.[0] ?? "";
  assert.notEqual(abandonNavigation, "");
  assert.doesNotMatch(abandonNavigation, /applyProgress\(100\)/);
  assert.match(abandonNavigation, /setVisible\(false\)/);
});

test("the backstop outlasts a cold dev route compile", () => {
  const deadline = component.match(/const ABANDON_AFTER_MS = ([0-9_]+);/)?.[1];
  assert.ok(deadline, "ABANDON_AFTER_MS is declared");
  // Observed cold compiles of /dashboard run 20-35s. Anything near that races
  // the very navigations this bar exists to cover.
  assert.ok(Number(deadline.replaceAll("_", "")) >= 60_000);
});

test("a bar pinned at its ceiling still reads as working", () => {
  // The creep stops once there is nowhere left to travel...
  assert.match(
    component,
    /if \(current >= MAX_PENDING_PROGRESS\) \{[\s\S]*?clearInterval/,
  );
  // ...so the shimmer, not the width, is what carries the signal from there on.
  assert.match(component, /const stalled = pending && progress >= MAX_PENDING_PROGRESS;/);
  assert.match(component, /stalled \? 'bb-nav-progress-stalled' : ''/);
  assert.match(globals, /@keyframes bb-nav-progress-stalled \{/);
  assert.match(globals, /\.bb-nav-progress-stalled \{\s*\n\s*animation: bb-nav-progress-stalled/);
  assert.match(
    globals,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.bb-nav-progress-stalled \{\s*\n\s*animation: none;/,
  );
});

test("the bar is thick enough to notice inside the desktop frame", () => {
  assert.match(component, /fixed inset-x-0 top-0 z-\[10000\] h-\[4px\]/);
  assert.match(component, /shadow-\[0_0_8px_rgba\(9,105,218,0\.7\)\]/);
  assert.match(component, /aria-busy=\{pending\}/);
});
