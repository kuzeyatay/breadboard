import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  clickyDesktopControl,
  isDirectClickyLaunchPrompt,
  launchClickyFromPrompt,
} from "../src/lib/clicky/desktop-control.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const composerSource = fs.readFileSync(
  path.join(dashboardRoot, "src/app/components/assistant-composer.tsx"),
  "utf8",
);
const navbarSource = fs.readFileSync(
  path.join(dashboardRoot, "src/app/components/navbar.tsx"),
  "utf8",
);
const navbarShortcutSource = fs.readFileSync(
  path.join(dashboardRoot, "src/app/components/clicky-shortcut.tsx"),
  "utf8",
);

function withWindow(windowValue, body) {
  const hadWindow = "window" in globalThis;
  const previousWindow = globalThis.window;
  globalThis.window = windowValue;
  try {
    return body();
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
  }
}

async function withWindowAsync(windowValue, body) {
  const hadWindow = "window" in globalThis;
  const previousWindow = globalThis.window;
  globalThis.window = windowValue;
  try {
    return await body();
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
  }
}

test("only direct Clicky launch prompts are consumed", () => {
  for (const prompt of [
    "/clicky",
    "launch Clicky",
    "Please open the Clicky app",
    "could you start clicky for me?",
    "could you please launch Clicky?",
    "run Clicky now!",
  ]) {
    assert.equal(isDirectClickyLaunchPrompt(prompt), true, prompt);
  }
  for (const prompt of [
    "How do I launch Clicky?",
    "Don't launch Clicky",
    "Launch Clicky and explain how it works",
    "What is Clicky?",
    "Clicky",
  ]) {
    assert.equal(isDirectClickyLaunchPrompt(prompt), false, prompt);
  }
});

test("the shared composer consumes a direct Clicky prompt without losing attachments", () => {
  assert.match(composerSource, /attachments\.length === 0 && launchClickyFromPrompt\(value\)/);
  assert.match(composerSource, /launchClickyFromPrompt\(value\)[\s\S]{0,160}onChange\(''\)/);
});

test("Clicky has a configurable native navbar seat beside Plan", () => {
  const clickyIndex = navbarSource.indexOf("{shortcuts.clicky && <ClickyShortcut />}");
  const planIndex = navbarSource.indexOf("{shortcuts.plan && (");
  assert.ok(clickyIndex > 0, "Clicky is guarded by its navbar preference");
  assert.ok(planIndex > clickyIndex, "Clicky sits directly before Plan");
  assert.match(navbarShortcutSource, /clickyDesktopControl\(\)/);
  assert.match(navbarShortcutSource, /state\?\.supported/);
  assert.match(navbarShortcutSource, /control\.openProject\(\)/);
  assert.match(navbarShortcutSource, /control\.launch\(\)/);
});

test("the Clicky control exists only when the complete desktop bridge does", () => {
  assert.equal(withWindow({}, clickyDesktopControl), null);
  assert.equal(
    withWindow(
      { breadboardDesktop: { launchClicky: async () => ({ ok: true }) } },
      clickyDesktopControl,
    ),
    null,
  );

  const complete = withWindow(
    {
      breadboardDesktop: {
        getClickyState: async () => ({ status: "ready" }),
        launchClicky: async () => ({ code: "launched" }),
        openClickyProject: async () => ({ code: "project_opened" }),
      },
    },
    clickyDesktopControl,
  );
  assert.ok(complete);
});

test("a direct prompt launches Clicky once and publishes the result", async () => {
  let launches = 0;
  const notices = [];
  await withWindowAsync(
    {
      breadboardDesktop: {
        getClickyState: async () => ({
          supported: true,
          available: true,
          projectAvailable: true,
          status: "ready",
          message: "ready",
        }),
        launchClicky: async () => {
          launches += 1;
          return {
            ok: true,
            code: "launched",
            message: "Clicky launched.",
            state: {
              supported: true,
              available: true,
              projectAvailable: true,
              status: "ready",
              message: "ready",
            },
          };
        },
        openClickyProject: async () => ({ ok: true }),
        publishNotificationToast: async (notice) => {
          notices.push(notice);
          return true;
        },
      },
    },
    async () => {
      assert.equal(launchClickyFromPrompt("launch Clicky"), true);
      assert.equal(launchClickyFromPrompt("tell me about Clicky"), false);
      await new Promise((resolve) => setImmediate(resolve));
    },
  );
  assert.equal(launches, 1);
  assert.deepEqual(notices, [
    {
      title: "Clicky",
      message: "Clicky launched.",
      type: "success",
    },
  ]);
});
