import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Exercise the real route and Spotify response mapping without touching an
// account, playback device, database, or local playback engine.
const fixture = `
  export let playback = null;
  export let engine = null;
  export const requests = [];
  export function reset(value, localEngine = {ready:false,deviceId:null,status:'starting',error:null}) {
    playback = value; engine = localEngine; requests.length = 0;
  }
  export function providerRequest({request}) {
    requests.push(request);
    if (request.endpoint === "/v1/me/player/pause") { playback.is_playing = false; return null; }
    if (request.endpoint === "/v1/me/player/next" || request.endpoint === "/v1/me/player/previous") {
      playback.item.name = "Changed song";
      playback.progress_ms = 0;
      return null;
    }
    if (request.endpoint === "/v1/me/player") return structuredClone(playback);
    if (request.endpoint === "/v1/me/library/contains") return [false];
    throw new Error("Unexpected Spotify request: " + request.endpoint);
  }
`;
const helpers = `
  export class ApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  export const requireEnabled = () => {};
  export const readJsonBody = request => request.json();
  export const apiErrorResponse = error => Response.json({code:error.code}, {status:error.status ?? 500});
`;
const stubs = {
  "test-fixture": fixture,
  "server-only": "export {};",
  "next/server": "export const NextResponse = Response;",
  "@/lib/server-auth": "export async function requireUserId() { return 7; }",
  "@/lib/hermes/route-helpers.ts": helpers,
  "../hermes/route-core.ts": helpers,
  "@/lib/spotify/playback-engine.ts": "import {engine} from 'test-fixture'; export async function spotifyPlaybackEngineStatus() { return engine; }",
  "../db.ts": "export default {};",
  "../connected-apps/broker.ts": "export {providerRequest as embeddedProviderRequest} from 'test-fixture'; export async function connectedAppTokensFor() { throw new Error('Unexpected token request'); }",
  "../connected-apps/vault.ts": "export function readConnectedAppTokens() { return {scope:'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-library-read user-library-modify playlist-read-private'}; }",
  "../nango/catalog.ts": "export function findNangoIntegration() { return {slug:'spotify'}; }",
};
const bundle = await build({
  stdin: {
    contents: 'export {GET,POST} from "./src/app/api/browser/spotify/route.ts"; export {spotifyCurrentPlaybackState} from "./src/lib/spotify/service.ts"; export {reset,requests} from "test-fixture";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{ name: "spotify-dock-fixture", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path)
      ? {path: args.path, namespace: "fixture"} : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({contents: stubs[args.path], loader: "js"}));
  } }],
});
const dock = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function phonePlayback(device = { id: "phone-123", name: "My iPhone" }) {
  return {
    is_playing: true,
    device,
    progress_ms: 42000,
    item: {
      id: "0123456789abcdefghijAB",
      uri: "spotify:track:0123456789abcdefghijAB",
      name: "Ocean Drive",
      artists: [{name: "Duke Dumont"}],
      album: {name: "Ocean Drive", images: []},
      duration_ms: 206000,
    },
  };
}

test("the dock reports phone playback and its display name while the local engine starts", async () => {
  dock.reset(phonePlayback());
  const response = await dock.GET(new Request("http://localhost/api/browser/spotify"));
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.engine.ready, false);
  assert.equal(state.playback.isPlaying, true);
  assert.equal(state.playback.deviceName, "My iPhone");
  assert.equal(state.playback.deviceId, "phone-123");
});

test("device names are trimmed and missing names stay unknown", async () => {
  for (const [name, expected] of [["  Living room  ", "Living room"], ["   ", null], [undefined, null]]) {
    dock.reset(phonePlayback({id: "speaker-123", name}));
    assert.equal((await dock.spotifyCurrentPlaybackState(7)).deviceName, expected);
  }
});

test("pause targets the phone without requiring or transferring to the local engine", async () => {
  dock.reset(phonePlayback());
  const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
    method: "POST", body: JSON.stringify({action: "pause"}),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(dock.requests.filter(request => request.method !== "GET"), [{
    method: "PUT", endpoint: "/v1/me/player/pause", query: {device_id: "phone-123"},
  }]);
  const state = await response.json();
  assert.equal(state.playback.isPlaying, false);
  assert.equal(state.playback.deviceName, "My iPhone");
});

test("pause uses Spotify's active device when its identifier is unavailable", async () => {
  dock.reset(phonePlayback({name: "My iPhone"}));
  const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
    method: "POST", body: JSON.stringify({action: "pause"}),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(dock.requests.filter(request => request.method !== "GET"), [{method: "PUT", endpoint: "/v1/me/player/pause"}]);
});

test("pause with no current track returns a clear error and sends no control command", async () => {
  dock.reset(null);
  const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
    method: "POST", body: JSON.stringify({action: "pause"}),
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "spotify_playback_required");
  assert.equal(dock.requests.filter(request => request.method !== "GET").length, 0);
});

for (const action of ["next", "previous"]) {
  for (const ready of [false, true]) {
    test(`${action} stays on the phone when Breadboard's engine is ${ready ? "ready" : "starting"}`, async () => {
      dock.reset(phonePlayback(), {ready, deviceId: ready ? "breadboard-123" : null, status: ready ? "ready" : "starting", error: null});
      const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
        method: "POST", body: JSON.stringify({action}),
      }));
      assert.equal(response.status, 200);
      assert.deepEqual(dock.requests.filter(request => request.method !== "GET"), [{
        method: "POST", endpoint: `/v1/me/player/${action}`, query: {device_id: "phone-123"},
      }]);
      const {playback} = await response.json();
      assert.equal(playback.deviceId, "phone-123");
      assert.equal(playback.deviceName, "My iPhone");
      assert.equal(playback.isPlaying, true);
      assert.equal(playback.track.name, "Changed song");
    });
  }

  test(`${action} lets Spotify select its active device when its identifier is missing`, async () => {
    dock.reset(phonePlayback({name: "My iPhone"}));
    const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
      method: "POST", body: JSON.stringify({action}),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(dock.requests.filter(request => request.method !== "GET"), [{method: "POST", endpoint: `/v1/me/player/${action}`}]);
  });

  test(`${action} with no current track sends no control command`, async () => {
    dock.reset(null);
    const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
      method: "POST", body: JSON.stringify({action}),
    }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "spotify_playback_required");
    assert.equal(dock.requests.filter(request => request.method !== "GET").length, 0);
  });
}
