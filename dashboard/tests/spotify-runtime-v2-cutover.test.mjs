import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { ensureDirectSpotifyProfile } from "../scripts/runtime-v2-spotify-profile.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const read = (relative) =>
  fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const service = read("scripts/runtime-v2-spotify-playback-service.mjs");
const engine = read("src/lib/spotify/playback-engine.ts");
const runtimeClient = read("src/lib/spotify/runtime-service.ts");
const viewLease = read("src/lib/spotify/view-lease.ts");
const route = read(
  "src/app/api/hermes/connections/spotify/engine/route.ts",
);
const toolRoute = read("src/app/api/hermes/tools/spotify/route.ts");
const target = read("src/lib/spotify/playback-target.ts");
const player = read("src/app/components/hermes/inline-spotify-player.tsx");
const electronProbe = read(
  "../qa/electron/specs/investigation/spotify-playback-runtime.spec.ts",
);

async function reserveLoopbackPort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForHealthyService(child, port, stderr) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      assert.fail(`Spotify playback service exited before health: ${stderr()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.json();
    } catch {
      // The child may still be binding its loopback port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Spotify playback service did not become healthy: ${stderr()}`);
}

function concurrentExistsError() {
  return Object.assign(new Error("concurrent profile creator won"), {
    code: "EEXIST",
  });
}

test("concurrent profile segment creation is accepted only after direct-directory revalidation", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "bb-spotify-profile-race-"));
  const root = path.join(parent, "data");
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const profile = ensureDirectSpotifyProfile(
    root,
    ["database", "spotify-browser-player", "user-7"],
    {
      makeDirectory(candidate) {
        fs.mkdirSync(candidate, { recursive: false });
        throw concurrentExistsError();
      },
    },
  );

  assert.equal(fs.lstatSync(profile).isDirectory(), true);
  assert.equal(fs.lstatSync(profile).isSymbolicLink(), false);
  assert.equal(fs.realpathSync.native(profile), profile);
});

test("a link that wins the profile EEXIST race is rejected", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "bb-spotify-profile-link-race-"));
  const root = path.join(parent, "data");
  const outside = path.join(parent, "outside");
  const plantedLink = path.join(root, "database", "spotify-browser-player");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  t.after(() => {
    try {
      if (fs.lstatSync(plantedLink).isSymbolicLink()) fs.unlinkSync(plantedLink);
    } catch {}
    fs.rmSync(parent, { recursive: true, force: true });
  });

  let caught;
  try {
    ensureDirectSpotifyProfile(
      root,
      ["database", "spotify-browser-player", "user-7"],
      {
        makeDirectory(candidate) {
          if (path.basename(candidate) === "spotify-browser-player") {
            fs.symlinkSync(
              outside,
              candidate,
              process.platform === "win32" ? "junction" : "dir",
            );
          } else {
            fs.mkdirSync(candidate, { recursive: false });
          }
          throw concurrentExistsError();
        },
      },
    );
  } catch (error) {
    caught = error;
  }
  if (caught?.code === "EPERM" || caught?.code === "EACCES") {
    t.skip("directory links are unavailable in this environment");
    return;
  }
  assert.equal(caught?.code, "invalid_spotify_playback_configuration");
  assert.match(caught?.message ?? "", /profile is indirect/u);
  assert.equal(fs.existsSync(path.join(outside, "user-7")), false);
});

test("only the Runtime-owned Spotify service imports process spawning", () => {
  assert.match(service, /from "node:child_process"/u);
  for (const source of [
    engine,
    runtimeClient,
    viewLease,
    route,
    toolRoute,
    player,
  ]) {
    assert.doesNotMatch(
      source,
      /node:child_process|\bspawn\(|taskkill|detached:\s*true|\.unref\(\)/u,
    );
  }
  assert.match(service, /detached:\s*false/u);
  assert.match(service, /shell:\s*false/u);
  assert.match(service, /stdio:\s*"ignore"/u);
  assert.doesNotMatch(service, /taskkill|detached:\s*true|child\.unref\(\)/u);
});

test("inline autoplay uses a bounded Runtime lease before sending provider commands", () => {
  assert.match(target, /renewSpotifyPlaybackViewLease/u);
  assert.match(target, /releaseSpotifyPlaybackViewLease/u);
  assert.match(target, /issueSpotifyPlaybackEngineTicket/u);
  assert.match(target, /await spotifyPlaybackEngineStatus/u);
  assert.match(toolRoute, /withSpotifyPlaybackDevice/u);
  assert.doesNotMatch(toolRoute, /ensureSpotifyPlaybackEngine|requestOrigin/u);
});

test("browser launch authority and credentials stay sealed in the service", () => {
  assert.match(service, /BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED/u);
  assert.match(service, /BREADBOARD_SPOTIFY_BROWSER_PATH/u);
  assert.match(service, /BREADBOARD_SPOTIFY_DASHBOARD_ORIGIN/u);
  assert.match(service, /BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_TOKEN/u);
  assert.match(service, /directExecutable/u);
  assert.match(service, /metadata\.isSymbolicLink\(\)/u);
  assert.match(service, /childEnvironment\(\)/u);
  assert.match(service, /NO_PROXY/u);
  assert.match(service, /`\$\{bridge\.origin\}\/player`/u);
  assert.doesNotMatch(service, /searchParams\.set\([^\n]*ticket/u);
  assert.doesNotMatch(service, /`--[^`]*ticket|ticket=\$\{/u);
  assert.match(service, /JSON\.stringify\(\{ ticket: session\.ticket, operation: "token" \}\)/u);
});

test("Spotify service sessions are bounded, per-user, leased, and idle-cleaned", () => {
  assert.match(service, /MAX_BROWSER_SESSIONS = 16/u);
  assert.match(service, /MAX_VIEWS_PER_USER = 16/u);
  assert.match(service, /VIEW_TTL_MS = 75_000/u);
  assert.match(service, /SESSION_IDLE_TTL_MS = 45_000/u);
  assert.match(service, /const sessions = new Map\(\)/u);
  assert.match(service, /const operations = new Map\(\)/u);
  assert.match(service, /const launchingUsers = new Set\(\)/u);
  assert.match(service, /session\.views\.set\(input\.viewId/u);
  assert.match(service, /session\.idleSince \?\?= now/u);
  assert.match(service, /now - session\.idleSince >= SESSION_IDLE_TTL_MS/u);
  assert.match(service, /setInterval\(\(\) => void expireViews\(\), 5_000\)/u);
  assert.match(service, /await Promise\.all\(\[\.\.\.sessions\.values\(\)\]\.map\(closeSession\)\)/u);
  for (const source of [service, runtimeClient]) {
    assert.match(source, /response\.body\?\.getReader\(\)/u);
    assert.match(source, /reader\.cancel\(\)/u);
    assert.doesNotMatch(source, /response\.arrayBuffer\(\)/u);
  }

  assert.match(viewLease, /acquireServiceLease\(\s*"spotify-playback"/u);
  assert.match(viewLease, /MAX_ACTIVE_VIEWS_PER_USER = 8/u);
  assert.match(viewLease, /MAX_ACTIVE_VIEWS_GLOBAL = 128/u);
  assert.match(viewLease, /SPOTIFY_PLAYBACK_VIEW_HOLD_TTL_MS = 70_000/u);
  assert.match(viewLease, /SPOTIFY_PLAYBACK_VIEW_LEASE_ROTATION_MS/u);
  assert.match(viewLease, /releaseSupervisorLease/u);
  assert.match(viewLease, /releaseSpotifyPlaybackRuntimeSession/u);
});

test("status is observational while POST acquires and DELETE releases", () => {
  const getStart = route.indexOf("export async function GET");
  const postStart = route.indexOf("export async function POST");
  const deleteStart = route.indexOf("export async function DELETE");
  assert.ok(getStart >= 0 && postStart > getStart && deleteStart > postStart);
  const getBlock = route.slice(getStart, postStart);
  const postBlock = route.slice(postStart, deleteStart);
  const deleteBlock = route.slice(deleteStart);
  assert.match(getBlock, /spotifyPlaybackEngineStatus/u);
  assert.doesNotMatch(
    getBlock,
    /renewSpotifyPlaybackViewLease|acquireServiceLease|issueSpotifyPlaybackEngineTicket/u,
  );
  assert.match(postBlock, /renewSpotifyPlaybackViewLease/u);
  assert.match(postBlock, /issueSpotifyPlaybackEngineTicket/u);
  assert.match(deleteBlock, /releaseSpotifyPlaybackViewLease/u);
  assert.doesNotMatch(route, /mode === "page"|ensureSpotifyPlaybackEngine/u);
});

test("the existing player renews a hidden view lease and releases it on unmount", () => {
  assert.match(player, /crypto\.randomUUID\(\)/u);
  assert.match(player, /ENGINE_VIEW_HEARTBEAT_MS = 20_000/u);
  assert.match(player, /method: "POST"/u);
  assert.match(player, /method: "DELETE"/u);
  assert.match(player, /keepalive: true/u);
  assert.match(player, /controller\.abort\(\)/u);
  assert.match(player, /window\.clearTimeout\(timer\)/u);
  assert.doesNotMatch(player, /service status|Runtime V2|memory control/iu);
});

test("the Electron probe requires provider truth, a ready device, a real control, and lease cleanup", () => {
  assert.match(electronProbe, /\/api\/hermes\/connections\/spotify"/u);
  assert.match(electronProbe, /connection\.payload\.connected === true/u);
  assert.match(electronProbe, /engine\.payload\.ready === true/u);
  assert.match(electronProbe, /typeof engine\.payload\.deviceId === "string"/u);
  assert.match(
    electronProbe,
    /\/api\/hermes\/connections\/spotify\/playback/u,
  );
  assert.match(electronProbe, /control\("pause"\)/u);
  assert.match(electronProbe, /control\("resume"\)/u);
  assert.match(electronProbe, /finally \{/u);
  assert.match(electronProbe, /method: "DELETE"/u);
  assert.match(electronProbe, /spotify_connection_required/u);
  assert.match(electronProbe, /Connect Spotify from Settings/u);
  assert.doesNotMatch(
    electronProbe,
    /toMatchObject\(\{ status: "starting" \}\)/u,
  );
});

test("the service fails closed before opening a port outside Runtime ownership", () => {
  const script = path.join(
    dashboardRoot,
    "scripts",
    "runtime-v2-spotify-playback-service.mjs",
  );
  const result = spawnSync(process.execPath, [script, "--port", "49191"], {
    cwd: dashboardRoot,
    env: {
      ...process.env,
      BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED: "0",
      BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_TOKEN: "x".repeat(48),
    },
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /may only run in Runtime-managed mode/u);
  assert.doesNotMatch(result.stderr, /x{16,}/u);
});

test(
  "the service accepts Runtime's canonical Windows data-root spelling",
  { skip: process.platform !== "win32", timeout: 15_000 },
  async (t) => {
    const script = path.join(
      dashboardRoot,
      "scripts",
      "runtime-v2-spotify-playback-service.mjs",
    );
    const port = await reserveLoopbackPort();
    let stderr = "";
    const child = spawn(process.execPath, [script, "--port", String(port)], {
      cwd: dashboardRoot,
      env: {
        ...process.env,
        BREADBOARD_DATA_DIR: path.toNamespacedPath(path.dirname(dashboardRoot)),
        BREADBOARD_SPOTIFY_DASHBOARD_ORIGIN: "http://127.0.0.1:9",
        BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED: "1",
        BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_TOKEN: "x".repeat(48),
      },
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });

    assert.deepEqual(await waitForHealthyService(child, port, () => stderr), {
      ok: true,
      service: "spotify-playback",
    });
    child.stdin.end(`${JSON.stringify({ type: "stop", force: false })}\n`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Spotify playback service did not stop.")),
        5_000,
      );
      child.once("exit", (code) => {
        clearTimeout(timer);
        assert.equal(code, 0, stderr);
        resolve();
      });
    });
  },
);
