// The navbar work timer: it opens and closes in place, and a running session
// is not lost to closing the panel or reloading the page.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/app/components/work-timer-shortcut.tsx"),
  "utf8",
);

test("the seat is a toggle, and the panel can be dismissed three ways", () => {
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /onClick=\{togglePanel\}/, "the button itself opens and closes");
  assert.match(source, /event\.key === "Escape"/, "Escape closes");
  assert.match(source, /pointerdown/, "clicking anywhere else closes");
  assert.match(
    source,
    /aria-label="Close the work timer"/,
    "and the panel carries its own close button",
  );
});

test("the panel escapes the navbar stacking context", () => {
  assert.match(source, /import \{ createPortal \} from "react-dom"/);
  assert.match(source, /createPortal\(panel, document\.body\)/);
  assert.match(source, /neu-popover fixed z-\[75\]/);
  assert.match(
    source,
    /root\?\.contains\(event\.target\) \|\| panel\?\.contains\(event\.target\)/,
    "clicking inside the portaled panel must not dismiss it",
  );
});

test("closing the panel does not stop the session", () => {
  // The countdown shows on the navbar button, not only inside the panel…
  assert.match(source, /phase === "running" \|\| phase === "paused" \? \(/);
  assert.match(source, /\{clock\}<\/span>/);
  // …and the session is written out, so another page picks it back up. The
  // arithmetic behind that is covered directly in work-timer.test.mjs.
  assert.match(source, /localStorage\.setItem\(WORK_TIMER_STORAGE_KEY/);
  assert.match(source, /settleWorkTimer\(stored, Date\.now\(\)\)/);
});

test("the first render cannot overwrite a stored session with the idle default", () => {
  assert.match(source, /if \(!loadedRef\.current\) return;/);
});

test("work and break durations are directly editable", () => {
  assert.match(source, /aria-label="Timer type"/);
  assert.match(source, /aria-label=\{`\$\{mode === "work" \? "Work" : "Break"\} timer minutes`\}/);
  assert.match(source, /setWorkTimerMinutes\(current, mode, minutes\)/);
  assert.match(source, /setWorkTimerMode\(current, mode\)/);
});

test("a completed session offers the other timer next", () => {
  assert.match(source, /advanceWorkTimer\(current\)/);
  assert.match(source, /`Start \$\{nextMode\}`/);
});

test("the full Paint Pomodoro page is still one click away with simpler copy", () => {
  assert.match(source, /href="\/pomodoro"/);
  assert.match(source, />\s*Open in another tab\s*<\/a>/);
});
