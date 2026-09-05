import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const profile = await import("../src/lib/agent-browser/browser-profile.ts");
const identity = await import("../src/lib/agent-browser/identity.ts");
const source = (relativePath) =>
  fs.readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

test("the shared profile lives beside the account's data, never inside the checkout", () => {
  const explicit = path.join(os.tmpdir(), "breadboard-explicit-profile");
  assert.equal(
    profile.agentBrowserProfileDir({ AGENT_BROWSER_PROFILE: explicit }),
    path.resolve(explicit),
  );
  const data = path.join(os.tmpdir(), "breadboard-data");
  assert.equal(
    profile.agentBrowserProfileDir({ BREADBOARD_DATA_DIR: data }),
    path.join(path.resolve(data), "agent-browser-profile"),
  );
  assert.equal(
    profile.agentBrowserProfileDir({}),
    path.join(os.homedir(), ".breadboard", "agent-browser-profile"),
  );
});

test("a run inherits the profile only once someone has signed into it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-agent-profile-"));
  const dir = path.join(root, "agent-browser-profile");
  try {
    assert.equal(profile.activeProfileDir({ AGENT_BROWSER_PROFILE: dir }), null);
    fs.mkdirSync(dir);
    assert.equal(profile.activeProfileDir({ AGENT_BROWSER_PROFILE: dir }), path.resolve(dir));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the run manager hands that profile to the CLI, and only when there is one", () => {
  const manager = source("src/lib/agent-browser/run-manager.ts");
  assert.match(manager, /browserMode === "external" \? activeProfileDir\(\) : null/);
  const executor = source("scripts/runtime-v2-agent-browser-executor.mjs");
  assert.match(executor, /current\.request\.profilePath/);
  assert.match(executor, /AGENT_BROWSER_PROFILE: current\.request\.profilePath/);
});

test("the sign-in window is open only while its own process is alive", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-agent-window-"));
  const env = { AGENT_BROWSER_PROFILE: path.join(root, "agent-browser-profile") };
  const marker = path.join(root, "agent-browser-signin.json");
  const record = (over) =>
    fs.writeFileSync(
      marker,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), executable: "chrome", ...over }),
    );
  try {
    assert.equal(profile.signInWindowOpen(env), false);

    // Recorded on disk, not in one module's memory, so the page, the route and
    // the run guard all see the same window.
    record({});
    assert.equal(profile.signInWindowOpen(env), true);

    // Closed by hand: the pid is dead, so the record clears itself rather than
    // blocking every run from here on.
    record({ pid: 2 ** 30 });
    assert.equal(profile.signInWindowOpen(env), false);
    assert.equal(fs.existsSync(marker), false);

    // And a record old enough to be from another boot, whose pid may by now
    // belong to anything at all, is not trusted either.
    record({ startedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString() });
    assert.equal(profile.signInWindowOpen(env), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("only web addresses reach the browser's command line", () => {
  assert.throws(() => profile.normalizeBrowserProfileStartUrl("file:///etc/passwd"), /invalid_url/);
  assert.throws(() => profile.normalizeBrowserProfileStartUrl("not a url"), /invalid_url/);
});

test("forgetting the sign-ins refuses anything that is not the profile", () => {
  assert.throws(
    () => profile.resetProfile({ AGENT_BROWSER_PROFILE: os.homedir() }),
    /unsafe_profile_directory/,
  );
  assert.throws(
    () => profile.resetProfile({ AGENT_BROWSER_PROFILE: path.parse(os.homedir()).root }),
    /unsafe_profile_directory/,
  );
});

test("a run and the sign-in window never hold the same browser profile", () => {
  const service = source("src/lib/agent-browser/service.ts");
  assert.match(
    service,
    /if \(browserMode === "external" && signInWindowOpen\(\)\)/,
  );

  const route = source("src/app/api/agent-browser/browser-profile/route.ts");
  assert.match(route, /if \(await hasActiveRun\(\)\) throw new BrowserProfileError\(409, "run_in_progress"\)/);

  // And the refusal reaches the person as a sentence with a fix in it.
  assert.match(identity.agentBrowserStartFailure("sign_in_window_open"), /profile page/);
  assert.match(
    source("src/app/components/hermes/dashboard-agent-terminal.tsx"),
    /agentBrowserStartFailure\(data\?\.error\)/,
  );
  assert.match(
    source("src/app/gardens/[clusterSlug]/workspace-client.tsx"),
    /agentBrowserStartFailure\(data\?\.error\)/,
  );
});

test("the profile page carries the sign-in card, read on the server", () => {
  const page = source("src/app/profile/page.tsx");
  assert.match(page, /browserProfile=\{await browserProfileState\(\)\}/);

  const client = source("src/app/profile/profile-client.tsx");
  assert.match(client, /import BrowserProfilePanel from "\.\/browser-profile-panel";/);
  assert.match(client, /<BrowserProfilePanel initial=\{browserProfile\} \/>/);

  const panel = source("src/app/profile/browser-profile-panel.tsx");
  assert.match(panel, /\/api\/agent-browser\/browser-profile/);
  // Absent, not disabled, when there is no runtime the sign-in would serve.
  assert.match(panel, /if \(!profile\.runtimeAvailable \|\| !profile\.browserFound\) return null;/);
});
