import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const desktopRoot = path.resolve(__dirname, "..", "..");
const startupRoot = path.join(desktopRoot, "src", "startup");
const html = fs.readFileSync(path.join(startupRoot, "index.html"), "utf8");
const css = fs.readFileSync(path.join(startupRoot, "startup.css"), "utf8");
const script = fs.readFileSync(path.join(startupRoot, "startup.ts"), "utf8");
const themeScript = fs.readFileSync(path.join(startupRoot, "theme.js"), "utf8");
const recoveryHtml = fs.readFileSync(path.join(startupRoot, "recovery.html"), "utf8");
const recoveryCss = fs.readFileSync(path.join(startupRoot, "recovery.css"), "utf8");

test("desktop loading is a text-free kinetic scale field", () => {
  assert.match(html, /id="kinetic-field" class="kinetic-field"/);
  assert.doesNotMatch(html, /class="brand"/);
  assert.doesNotMatch(html, /<h1/);
  assert.match(html, /id="phase-message" class="visually-hidden"/);
  assert.match(html, /id="service-list" class="visually-hidden"/);

  assert.match(css, /--background: #faf7ef;/);
  assert.match(css, /@keyframes scale-lift/);
  assert.match(css, /\.kinetic-scale::after/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

  assert.match(script, /const rowSizes = \[5, 7, 8, 7, 5\]/);
  assert.match(script, /scale\.className = "kinetic-scale"/);
  assert.match(script, /document\.body\.dataset\["phase"\] = state\.phase/);
});

test("startup paints in the last dashboard theme before its stylesheet loads", () => {
  assert.match(html, /<meta name="color-scheme" content="light dark" \/>/);
  assert.ok(
    html.indexOf('<script src=".\/theme.js"><\/script>') <
      html.indexOf('<link rel="stylesheet" href=".\/startup.css" \/>'),
  );
  assert.match(themeScript, /URLSearchParams\(window\.location\.search\)/);
  assert.match(themeScript, /theme === "dark" \|\| theme === "light"/);
  assert.match(themeScript, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{/);
  assert.match(css, /--background:\s*#18181a/);
  assert.match(css, /--app-background:\s*#18181a/);
  assert.match(css, /:root\[data-theme="dark"\] \.loader::before/);
  assert.match(css, /:root\[data-theme="dark"\] \.dissolve-bloom/);
});

test("dashboard restarts show a themed recovery scene instead of a blank window", () => {
  assert.match(recoveryHtml, /Reconnecting to your workspace/);
  assert.match(recoveryHtml, /Your chats and garden are safe/);
  assert.match(recoveryHtml, /role="status" aria-live="polite"/);
  assert.ok(
    recoveryHtml.indexOf('<script src=".\/theme.js"><\/script>') <
      recoveryHtml.indexOf('<link rel="stylesheet" href=".\/recovery.css" \/>'),
  );
  // The scene stands in the window frame rather than inside the app, so its
  // field is paper — the same colour as the caption strip above it, in both
  // themes. Painting it the app's own background puts a seam across the top.
  assert.match(recoveryCss, /--background: #faf7ef;\s+--chrome: #faf7ef;/);
  assert.match(recoveryCss, /--background: #20211f;\s+--chrome: #20211f;/);
  assert.doesNotMatch(recoveryCss, /#e6f0e6/);
  assert.match(recoveryCss, /:root\[data-theme="dark"\]/);
  assert.match(recoveryCss, /@media \(prefers-reduced-motion: reduce\)/);

  const copyStatic = fs.readFileSync(
    path.join(desktopRoot, "scripts", "copy-static.mjs"),
    "utf8",
  );
  assert.match(copyStatic, /"recovery\.html"/);
  assert.match(copyStatic, /"recovery\.css"/);
});

test("a healthy startup ends on a welcome that is dismissed by hand", () => {
  // Two stacked slots are what makes one greeting cross-fade into the next.
  assert.equal(html.match(/class="welcome-word"/g)?.length, 2);
  assert.match(html, /id="welcome-continue"/);
  assert.match(html, /Click to continue/);
  assert.match(html, /id="dissolve-bloom"/);

  // Only "ready" starts the wait for the welcome, and only the button closes it.
  assert.match(script, /if \(state\.phase === "ready"\) beginWelcomeGate\(\)/);
  assert.match(script, /welcomeContinue\.addEventListener\("click"/);
  assert.match(script, /api\.continueToDashboard\(\)/);

  // Right-to-left scripts have to be marked, or Arabic and Hebrew render their
  // words in the wrong order.
  assert.match(script, /incoming\.dir = greeting\.dir \?\? "ltr"/);
  const greetings = [...script.matchAll(/\{ text: "([^"]+)", lang: "([a-z]{2})"/g)];
  assert.ok(greetings.length >= 12, `only ${greetings.length} greetings`);
  assert.deepEqual(greetings[0]?.slice(1, 3), ["Welcome", "en"]);
  assert.equal(new Set(greetings.map((match) => match[2])).size, greetings.length);
  const leavesLatin = greetings.some((match) =>
    [...(match[1] ?? "")].some((character) => (character.codePointAt(0) ?? 0) > 0x0400),
  );
  assert.ok(leavesLatin, "the cycle should reach beyond the Latin alphabet");

  // The field is a progress indicator; it must stop claiming to be one.
  assert.match(css, /body\[data-stage="welcome"\] \.kinetic-scale::after[\s\S]{0,320}animation: none;/);
  assert.match(css, /body\[data-stage="dissolving"\] \.dissolve-bloom/);
  assert.match(css, /@keyframes bloom-out/);
});

test("the welcome waits for the dashboard so the click has nothing left to wait for", () => {
  // Healthy services are not enough: the loading field holds until the hidden
  // dashboard has painted, and only then does the greeting appear.
  assert.match(script, /stage = "preparing"/);
  assert.match(script, /api\.awaitDashboardReady\(\)\.then\(open, open\)/);
  assert.match(script, /function enterWelcome\(\): void \{\s*if \(stage !== "preparing"\) return;/);

  // "preparing" is still a wait, not a finished state: the only thing that may
  // mark it is the intro backdrop, and that is keyed off playback rather than
  // the stage. No rule may dress the stage itself up the way the welcome and
  // dissolve stages are dressed up.
  assert.doesNotMatch(css, /data-stage="preparing"/);

  // The click itself dissolves straight away; nothing may await between the
  // press and the bloom, or the instant open is instant no more.
  assert.doesNotMatch(script, /awaitDashboardReady[\s\S]{0,80}dissolve\(/);
  assert.match(script, /addEventListener\("click"[\s\S]{0,160}dissolve\(/);
});

test("a startup chime leads the greeting in without putting anything on screen", () => {
  assert.match(html, /<audio id="intro-sound" preload="auto"/);
  assert.match(html, /<source src="\.\/intro\.m4a" type="audio\/mp4" \/>/);
  // Same-origin media is not covered by the img-src the page already grants.
  assert.match(html, /media-src 'self'/);

  // Sound only. The loading field and the greeting remain the whole picture:
  // no element may be painted for the chime, and nothing on screen may key off
  // whether it is playing.
  assert.match(css, /#intro-sound \{\s*display: none;\s*\}/);
  assert.doesNotMatch(html, /<video/);
  assert.doesNotMatch(css, /data-intro/);

  // It ships: the page is loaded from dist/, so the asset has to be copied
  // there alongside the stylesheet rather than left behind in src/.
  assert.ok(fs.existsSync(path.join(startupRoot, "intro.m4a")));
  const copyStatic = fs.readFileSync(
    path.join(desktopRoot, "scripts", "copy-static.mjs"),
    "utf8",
  );
  assert.match(copyStatic, /"intro\.m4a"/);

  // It sounds on the frame loading ends — which is `enterWelcome`, not the
  // healthy-services report that starts the wait for the dashboard. Starting it
  // a stage early would let a slow paint run the whole chime out under a
  // loading field that had not finished.
  assert.match(
    script,
    /stage = "welcome";\s*document\.body\.dataset\["stage"\] = "welcome";[\s\S]{0,400}?startIntro\(\)/,
  );
  assert.doesNotMatch(
    script,
    /document\.body\.dataset\["stage"\] = "preparing";[\s\S]{0,200}?startIntro\(\)/,
  );
  // The greeting then holds back a beat so the sound leads it in.
  assert.match(script, /introPlaying \? INTRO_WELCOME_REVEAL_DELAY_MS : WELCOME_REVEAL_DELAY_MS/);

  // A dead service outranks it, and the click has to silence it: the chime runs
  // for three seconds and would otherwise be heard over the dashboard.
  assert.match(script, /function abandonWelcome\(\): void \{[\s\S]{0,400}stopIntro\(\)/);
  assert.match(script, /stage = "dissolving";[\s\S]{0,220}introSound\.pause\(\)/);

  // A refused autoplay is a complete outcome, not a reason to retry silently.
  assert.match(script, /introSound\.play\(\)\.catch\(\(\) => \{\s*introPlaying = false;/);
});

test("the chime can be muted, and a muted screen waits on nothing to hear", () => {
  // The preference comes from the shell. Nothing the dashboard stores can be
  // read here: this screen is shown before the dashboard serves anything and
  // before anyone has signed in.
  assert.match(script, /api\.getStartupSound\(\)/);
  assert.doesNotMatch(script, /localStorage|fetch\(/);
  assert.match(script, /function startIntro\(\): void \{\s*if \(!introEnabled \|\| introPlaying\) return;/);

  // It is settled before the welcome opens. `enterWelcome` picks how long to
  // hold the greeting back on whether a sound is leading it in, so an answer
  // that arrived during the welcome would arrive too late to be used.
  assert.match(script, /introPreference\.then\(\(\) => api\.awaitDashboardReady\(\)/);
  assert.ok(script.indexOf("const introPreference") < script.indexOf("function beginWelcomeGate"));

  // A shell that cannot answer leaves the chime on: muting is a choice somebody
  // made, and a failed lookup is not one.
  assert.match(script, /let introEnabled = true;/);
});
