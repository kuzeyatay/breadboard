import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Exercise the real route and Spotify response mapping without touching an
// account, playback device, database, or local playback engine.
const fixture = `
  import { DatabaseSync } from 'node:sqlite';
  import { ApiError } from '../hermes/route-core.ts';
  import { ensureSpotifySchema } from '${fileURLToPath(new URL("../src/lib/spotify/schema.ts", import.meta.url)).replaceAll("\\", "/")}';
  export const db = new DatabaseSync(':memory:');
  db.transaction = operation => ({ immediate() {
    db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }});
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE conversations (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (7);');
  ensureSpotifySchema(db);
  export let playback = null;
  export let engine = null;
  export let seekFailure = false;
  export let localResult = {handled:false};
  export const localCommands = [];
  export let holdRecommendations = null;
  export const requests = [];
  export let statusFailure = false;
  export function failStatus() { statusFailure = true; }
  export function reset(value, localEngine = {ready:false,deviceId:null,status:'starting',error:null}) {
    playback = value; engine = localEngine; requests.length = 0; seekFailure = false; statusFailure = false;
    localCommands.length = 0; localResult = {handled:false}; holdRecommendations = null;
    db.exec('DELETE FROM spotify_listening_history');
  }
  export function failSeek() { seekFailure = true; }
  export function setLocalResult(result) { localResult = result; }
  export function controlLocal(input) {
    localCommands.push(input);
    if(localResult instanceof Error) throw localResult;
    return localResult;
  }
  export function delayRecommendations(promise) { holdRecommendations = promise; }
  export function providerRequest({request}) {
    requests.push(request);
    if (request.endpoint === "/v1/search") return {
      tracks: {items: playback?.item ? [playback.item] : []},
      artists: {items: [{id:'artist0123456789abcde',uri:'spotify:artist:artist0123456789abcde',name:'Duke Dumont',images:[]}]},
    };
    if (request.endpoint === "/v1/artists/artist0123456789abcde") return {id:'artist0123456789abcde',uri:'spotify:artist:artist0123456789abcde',name:'Duke Dumont',images:[]};
    if (request.endpoint === "/v1/artists/artist0123456789abcde/top-tracks") return {tracks:playback?.item?[playback.item]:[]};
    if (request.endpoint === "/v1/artists/artist0123456789abcde/albums") return {items:[]};
    if (request.endpoint === "/v1/recommendations") return holdRecommendations ?? {tracks:[]};
    if (request.endpoint === "/v1/me/player/play") return null;
    if (request.endpoint === "/v1/me/player/seek") {
      if (seekFailure) throw new Error("Seek rejected");
      return null; // Spotify's read endpoint can still return the old position.
    }
    if (request.endpoint === "/v1/me/player/pause") { playback.is_playing = false; return null; }
    if (request.endpoint === "/v1/me/player/next" || request.endpoint === "/v1/me/player/previous") {
      playback.item.name = "Changed song";
      playback.progress_ms = 0;
      return null;
    }
    if (request.endpoint === "/v1/me/player") {
      if (statusFailure) throw Object.assign(new ApiError(429,'spotify_rate_limited','Too many requests'),{retryAfterMs:90_000});
      return structuredClone(playback);
    }
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
  "@/lib/hermes/route-helpers.ts": "export * from '../hermes/route-core.ts';",
  "../hermes/route-core.ts": helpers,
  "@/lib/spotify/playback-engine.ts": "import {engine} from 'test-fixture'; export async function spotifyPlaybackEngineStatus() { return engine; }",
  "@/lib/spotify/runtime-service.ts": "export {controlLocal as controlSpotifyPlaybackRuntime} from 'test-fixture';",
  "../db.ts": "export {db as default} from 'test-fixture';",
  "../connected-apps/broker.ts": "export {providerRequest as embeddedProviderRequest} from 'test-fixture'; export async function connectedAppTokensFor() { throw new Error('Unexpected token request'); }",
  "../connected-apps/vault.ts": "export function readConnectedAppTokens() { return {scope:'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-library-read user-library-modify playlist-read-private'}; }",
  "../nango/catalog.ts": "export function findNangoIntegration() { return {slug:'spotify'}; }",
};
const bundle = await build({
  stdin: {
    contents: 'export {GET,POST} from "./src/app/api/browser/spotify/route.ts"; export {spotifyCurrentPlaybackState} from "./src/lib/spotify/service.ts"; export {reset,requests,failSeek,failStatus,setLocalResult,localCommands,delayRecommendations} from "test-fixture";',
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
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({contents: stubs[args.path], loader: "js", resolveDir: fileURLToPath(new URL("../", import.meta.url))}));
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

const seek = positionMs => dock.POST(new Request("http://localhost/api/browser/spotify", {
  method: "POST", body: JSON.stringify({ action: "seek", positionMs }),
}));

test("dock search returns artists and songs in one provider request", async () => {
  dock.reset(phonePlayback());
  const response = await dock.GET(new Request("http://localhost/api/browser/spotify?view=search&q=Duke%20Dumont"));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.tracks[0].name, "Ocean Drive");
  assert.deepEqual(result.artists, [{id:"artist0123456789abcde",uri:"spotify:artist:artist0123456789abcde",name:"Duke Dumont",imageUrl:null}]);
  assert.equal(dock.requests.length, 1);
  assert.deepEqual(dock.requests[0].query, {q:"Duke Dumont",type:"track,artist",limit:10});
});

test("artist playback uses the artist context on the Breadboard device", async () => {
  dock.reset(phonePlayback(), {ready:true,deviceId:"breadboard-123",status:"ready",error:null});
  const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
    method:"POST",body:JSON.stringify({action:"play-artist",artistUri:"spotify:artist:artist0123456789abcde"}),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).refreshPlayback, true);
  assert.deepEqual(dock.requests, [{method:"PUT",endpoint:"/v1/me/player/play",query:{device_id:"breadboard-123"},body:{context_uri:"spotify:artist:artist0123456789abcde"}}]);
});

test("the artist profile route serves songs without starting playback", async()=>{
  dock.reset(phonePlayback());
  const response=await dock.GET(new Request("http://localhost/api/browser/spotify?view=artist&id=artist0123456789abcde"));
  assert.equal(response.status,200);
  const profile=await response.json();
  assert.equal(profile.artist.name,"Duke Dumont");
  assert.equal(profile.tracks[0].name,"Ocean Drive");
  assert.equal(profile.tracksSource,"top");
  assert.equal(dock.requests.length,4);
  assert.equal(dock.requests.every(request=>request.method==="GET"),true);
});

test("album playback uses the album context and rejects invalid or overridden targets",async()=>{
  dock.reset(phonePlayback(),{ready:true,deviceId:"breadboard-123",status:"ready",error:null});
  const play=body=>dock.POST(new Request("http://localhost/api/browser/spotify",{method:"POST",body:JSON.stringify(body)}));
  const response=await play({action:"play-album",albumUri:"spotify:album:album0123456789abcde"});
  assert.equal(response.status,200);
  assert.deepEqual(dock.requests[0],{method:"PUT",endpoint:"/v1/me/player/play",query:{device_id:"breadboard-123"},body:{context_uri:"spotify:album:album0123456789abcde"}});
  assert.equal((await play({action:"play-album",albumUri:"spotify:track:album0123456789abcde"})).status,400);
  assert.equal((await play({action:"play-album",albumUri:"spotify:album:album0123456789abcde",deviceId:"phone"})).status,400);
  assert.equal(dock.requests.length,1);
});

test("artist playback rejects invalid contexts and waits for the player", async () => {
  for (const artistUri of [undefined, "spotify:track:artist0123456789abcde", "spotify:artist:bad", 123]) {
    dock.reset(phonePlayback());
    const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
      method:"POST",body:JSON.stringify({action:"play-artist",artistUri}),
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_spotify_artist");
    assert.equal(dock.requests.length, 0);
  }
  const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
    method:"POST",body:JSON.stringify({action:"play-artist",artistUri:"spotify:artist:artist0123456789abcde"}),
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "spotify_engine_starting");
  assert.equal(dock.requests.length, 0);
});

for (const device of [{ id: "phone-123", name: "My iPhone" }, { id: "breadboard-123", name: "Breadboard" }, { name: "Speaker" }]) {
  for (const isPlaying of [true, false]) {
    test(`seeking ${isPlaying ? "playing" : "paused"} audio stays on ${device.name} and anchors the accepted position`, async () => {
      dock.reset({ ...phonePlayback(device), is_playing: isPlaying });
      const response = await seek(90000.4);
      assert.equal(response.status, 200);
      const {playback} = await response.json();
      assert.equal(playback.positionMs, 90000);
      assert.equal(playback.isPlaying, isPlaying);
      assert.equal(playback.deviceName, device.name);
      assert.deepEqual(dock.requests.filter(request => request.method !== "GET"), [{
        method: "PUT", endpoint: "/v1/me/player/seek",
        query: { position_ms: 90000, ...(device.id ? { device_id: device.id } : {}) },
      }]);
    });
  }
}

test("seek positions cannot accidentally skip beyond the current song", async () => {
  dock.reset(phonePlayback());
  const response = await seek(1e12);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).playback.positionMs, 205999);
  assert.equal(dock.requests.find(request => request.endpoint.endsWith("/seek")).query.position_ms, 205999);
});

test("seek accepts the beginning and rejects malformed positions before provider calls", async () => {
  dock.reset(phonePlayback());
  assert.equal((await seek(0)).status, 200);
  for (const position of [undefined, null, "1000", -1, true, {}, []]) {
    dock.reset(phonePlayback());
    const response = await seek(position);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_spotify_position");
    assert.equal(dock.requests.length, 0);
  }
});

test("seek rejects a missing track, client device overrides and provider failures", async () => {
  dock.reset(null);
  assert.equal((await seek(5000)).status, 409);
  assert.equal(dock.requests.filter(request => request.method !== "GET").length, 0);
  dock.reset(phonePlayback());
  const override = await dock.POST(new Request("http://localhost/api/browser/spotify", {
    method: "POST", body: JSON.stringify({ action: "seek", positionMs: 5000, deviceId: "another-device" }),
  }));
  assert.equal(override.status, 400);
  assert.equal(dock.requests.length, 0);
  dock.failSeek();
  assert.equal((await seek(5000)).status, 500);
});

test("the dock reports phone playback and its display name while the local engine starts", async () => {
  dock.reset(phonePlayback());
  const response = await dock.GET(new Request("http://localhost/api/browser/spotify"));
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.engine.ready, false);
  assert.equal(state.playback.isPlaying, true);
  assert.equal(state.playback.deviceName, "My iPhone");
  assert.equal(state.playback.deviceId, "phone-123");
  assert.equal(state.history[0].uri, state.playback.track.uri);
});

test("history imports survive later empty or paused playback without provider calls during import", async () => {
  dock.reset(phonePlayback());
  const track = (await dock.spotifyCurrentPlaybackState(7)).track;
  dock.reset(null);
  const imported = await dock.POST(new Request("http://localhost/api/browser/spotify", {
    method: "POST", body: JSON.stringify({action: "import-history", tracks: [track]}),
  }));
  assert.equal(imported.status, 200);
  assert.deepEqual((await imported.json()).history, [track]);
  assert.equal(dock.requests.length, 0);
  const state = await (await dock.GET(new Request("http://localhost/api/browser/spotify"))).json();
  assert.equal(state.playback, null);
  assert.deepEqual(state.history, [track]);
});

test("a paused track is not recorded as a new listen", async () => {
  dock.reset({...phonePlayback(), is_playing: false});
  const state = await (await dock.GET(new Request("http://localhost/api/browser/spotify"))).json();
  assert.deepEqual(state.history, []);
});

test("history import rejects attempts to select another user", async () => {
  dock.reset(null);
  const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
    method: "POST", body: JSON.stringify({action: "import-history", tracks: [], userId: 99}),
  }));
  assert.equal(response.status, 400);
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
      assert.equal((await response.json()).refreshPlayback, true);
      const playback = await dock.spotifyCurrentPlaybackState(7);
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

const post = body => dock.POST(new Request("http://localhost/api/browser/spotify", {method:"POST",body:JSON.stringify(body)}));
const readyEngine = {ready:true,deviceId:"breadboard-123",status:"ready",error:null};

for (const action of ["pause", "resume", "seek", "next", "previous"]) {
  test(`local ${action} reaches the SDK without any Spotify Web API requests`, async () => {
    dock.reset(phonePlayback(), readyEngine);
    const local = {handled:true,trackUri:phonePlayback().item.uri,positionMs:60000,isPlaying:action !== "pause"};
    dock.setLocalResult(local);
    const response = await post({action,local:true,...(action === "seek" ? {positionMs:60000} : {})});
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).localPlayback, local);
    assert.deepEqual(dock.localCommands, [{userId:7,deviceId:readyEngine.deviceId,action,...(action === "seek" ? {positionMs:60000} : {})}]);
    assert.equal(dock.requests.length, 0, "cloud status reads and artificial waits are outside the local command path");
  });
}

test("an unavailable local player falls back to active-device control without transferring playback", async () => {
  dock.reset(phonePlayback(), readyEngine);
  const response = await post({action:"pause",local:true});
  assert.equal(response.status, 200);
  assert.equal(dock.localCommands.length, 1);
  assert.deepEqual(dock.requests.map(request => request.endpoint), ["/v1/me/player", "/v1/me/player/pause"]);
  assert.equal(dock.requests[1].query.device_id, "phone-123");
});

test("an unconfirmed local skip is never sent twice through a cloud fallback", async () => {
  dock.reset(phonePlayback(), readyEngine);
  dock.setLocalResult(new Error("SDK acknowledgement timed out"));
  assert.equal((await post({action:"next",local:true})).status, 500);
  assert.equal(dock.requests.length, 0);
});

test("cold song and playlist starts return after the play command, without recommendations or status polling", async () => {
  for (const body of [
    {action:"play-track",trackUri:phonePlayback().item.uri,autoplay:true},
    {action:"play-playlist",playlistUri:"spotify:playlist:0123456789abcdefghijAB"},
  ]) {
    dock.reset(null, readyEngine);
    const response = await post(body);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).refreshPlayback, true);
    assert.deepEqual(dock.requests.map(request => request.endpoint), ["/v1/me/player/play"]);
  }
});

test("preparing recommendations never delays a click and a completed preparation supplies the queue", async () => {
  dock.reset(null, readyEngine);
  let finish;
  dock.delayRecommendations(new Promise(resolve => { finish = resolve; }));
  const track = phonePlayback().item;
  const next = {...track,id:"next0123456789abcdefgh",uri:"spotify:track:next0123456789abcdefgh"};
  const preparation = dock.GET(new Request(`http://localhost/api/browser/spotify?view=prepare-track&id=${track.id}`));
  await new Promise(resolve => setImmediate(resolve));
  const cold = await post({action:"play-track",trackUri:track.uri,autoplay:true});
  assert.equal(cold.status, 200);
  assert.deepEqual(dock.requests.find(request => request.endpoint.endsWith("/play")).body.uris, [track.uri]);
  finish({tracks:[next]});
  assert.equal((await preparation).status, 200);
  const warm = await post({action:"play-track",trackUri:track.uri,autoplay:true});
  assert.equal(warm.status, 200);
  assert.deepEqual(dock.requests.filter(request => request.endpoint.endsWith("/play")).at(-1).body.uris, [track.uri,next.uri]);
  assert.equal(dock.requests.filter(request => request.endpoint.endsWith("/recommendations")).length, 1);
});

test("a Spotify cooldown stays visible while the connected engine can renew its lease", async () => {
  dock.reset(phonePlayback(), {ready:true,deviceId:"breadboard-123",status:"ready",error:null});
  dock.failStatus();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await dock.GET(new Request("http://localhost/api/browser/spotify"));
    assert.equal(response.status,200);
    const status = await response.json();
    assert.equal(status.connected,true);
    assert.equal(status.engine.ready,true);
    assert.equal(status.playback,null);
    assert.match(status.playbackError,/too many requests/i);
  }
  assert.equal(dock.requests.filter(request=>request.endpoint==="/v1/me/player").length,1);
});
