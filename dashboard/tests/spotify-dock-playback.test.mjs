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
  export let holdStatus = null;
  export const engineReads = [];
  export function getEngine() { engineReads.push(true); return engine; }
  export function delayStatus(promise) { holdStatus = promise; }
  export const requests = [];
  export let statusFailure = false;
  export const reconnects = [];
  export let playFailures = [];
  export let replacement = 'breadboard-reconnected-001';
  export function failPlay(codes, replacementId = 'breadboard-reconnected-001') { playFailures = [...codes]; replacement = replacementId; }
  export function invalidateEngine(userId, deviceId) { if(engine.deviceId === deviceId) engine = {...engine,ready:false,deviceId:null}; }
  export async function reconnectEngine(userId, deviceId) {
    reconnects.push({userId,deviceId});
    engine = {ready:true,deviceId:replacement,status:'ready',error:null};
    return replacement;
  }
  export function failStatus() { statusFailure = true; }
  export function reset(value, localEngine = {ready:false,deviceId:null,status:'starting',error:null}) {
    globalThis.spotifyRequestPolicy?.cooldowns.clear();
    playback = value; engine = localEngine; requests.length = 0; seekFailure = false; statusFailure = false;
    localCommands.length = 0; localResult = {handled:false};
    holdStatus = null; engineReads.length = 0;
    reconnects.length = 0; playFailures = [];
    db.exec('DELETE FROM spotify_listening_history');
  }
  export function failSeek() { seekFailure = true; }
  export function setLocalResult(result) { localResult = result; }
  export function controlLocal(input) {
    localCommands.push(input);
    if(localResult instanceof Error) throw localResult;
    return localResult;
  }
  export function providerRequest({request}) {
    requests.push(request);
    if (request.endpoint === '/v1/me/player/devices') return {devices:[
      {id:'phone-123',name:'My iPhone',type:'Smartphone',is_active:true,is_restricted:false},
      {id:'living-room-tv',name:'Living room TV',type:'TV',is_active:false,is_restricted:false},
      {id:'locked-speaker',name:'Restricted speaker',type:'Speaker',is_active:false,is_restricted:true},
      {id:'breadboard-123',name:'Breadboard',type:'Computer',is_active:false,is_restricted:false},
      {id:null,name:'Unavailable',type:'Speaker'},
      {id:'phone-123',name:'Duplicate',type:'Smartphone'},
    ]};
    if (request.method === 'PUT' && (request.endpoint === '/v1/me/player/play' || request.endpoint === '/v1/me/player') && playFailures.length) {
      throw new ApiError(409, playFailures.shift(), 'Playback failed');
    }
    if (request.endpoint === "/v1/search") return {
      tracks: {items: playback?.item ? [playback.item] : []},
      artists: {items: [{id:'artist0123456789abcde',uri:'spotify:artist:artist0123456789abcde',name:'Duke Dumont',images:[]}]},
    };
    if (request.endpoint === "/v1/artists/artist0123456789abcde") return {id:'artist0123456789abcde',uri:'spotify:artist:artist0123456789abcde',name:'Duke Dumont',images:[]};
    if (request.endpoint === "/v1/artists/artist0123456789abcde/top-tracks") return {tracks:playback?.item?[playback.item]:[]};
    if (request.endpoint === "/v1/artists/artist0123456789abcde/albums") return {items:[]};
    if (request.endpoint === "/v1/me/player/play") return null;
    if (request.endpoint === "/v1/me/player/seek") {
      if (seekFailure) throw new Error("Seek rejected");
      return null; // Spotify's read endpoint can still return the old position.
    }
    if (['/v1/me/player/pause','/v1/me/player/next','/v1/me/player/previous'].includes(request.endpoint) && !playback) {
      throw new ApiError(409, 'spotify_device_unavailable', 'No active device');
    }
    if (request.endpoint === "/v1/me/player/pause") { playback.is_playing = false; return null; }
    if (request.endpoint === "/v1/me/player/next" || request.endpoint === "/v1/me/player/previous") {
      playback.item.name = "Changed song";
      playback.progress_ms = 0;
      return null;
    }
    if (request.endpoint === "/v1/me/player") {
      if (request.method !== 'GET') return null;
      if (statusFailure) throw Object.assign(new ApiError(429,'spotify_rate_limited','Too many requests'),{retryAfterMs:90_000});
      if (holdStatus) { const snapshot = structuredClone(playback); return holdStatus.then(() => snapshot); }
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
  "@/lib/spotify/playback-engine.ts": "export {getEngine as spotifyPlaybackEngineStatus} from 'test-fixture';",
  "./playback-engine.ts": "import {engine} from 'test-fixture'; export async function spotifyPlaybackEngineStatus() { return engine; } export {invalidateEngine as invalidateSpotifyPlaybackEngine} from 'test-fixture';",
  "./runtime-service.ts": "export {reconnectEngine as reconnectSpotifyPlaybackRuntime} from 'test-fixture';",
  "@/lib/spotify/runtime-service.ts": "export {controlLocal as controlSpotifyPlaybackRuntime} from 'test-fixture';",
  "../db.ts": "export {db as default} from 'test-fixture';",
  "../connected-apps/broker.ts": "export {providerRequest as embeddedProviderRequest} from 'test-fixture'; export async function connectedAppTokensFor() { throw new Error('Unexpected token request'); }",
  "../connected-apps/vault.ts": "export function readConnectedAppTokens() { return {scope:'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-library-read user-library-modify playlist-read-private'}; }",
  "../nango/catalog.ts": "export function findNangoIntegration() { return {slug:'spotify'}; }",
};
const bundle = await build({
  stdin: {
    contents: 'export {GET,POST} from "./src/app/api/browser/spotify/route.ts"; export {spotifyCurrentPlaybackState} from "./src/lib/spotify/service.ts"; export {reset,requests,failSeek,failStatus,setLocalResult,localCommands,delayStatus,engineReads,failPlay,reconnects,engine} from "test-fixture";',
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

const control = body => dock.POST(new Request("http://localhost/api/browser/spotify", {
  method: "POST", body: JSON.stringify(body),
}));

test("device discovery lists phones, TVs and computers without changing playback", async () => {
  dock.reset(phonePlayback());
  const response = await dock.GET(new Request("http://localhost/api/browser/spotify?view=devices"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const {devices} = await response.json();
  assert.equal(devices.length, 4, "unaddressable and duplicate devices are omitted");
  assert.deepEqual(devices.map(device => device.type), ["smartphone", "tv", "speaker", "computer"]);
  assert.equal(devices[2].isRestricted, true);
  assert.deepEqual(dock.requests, [{method:"GET",endpoint:"/v1/me/player/devices"}]);
  assert.equal(dock.engineReads.length, 0);
});

test("an explicit transfer selects a TV without starting Breadboard or replacing the queue", async () => {
  for (const isPlaying of [true, false]) {
    dock.reset({...phonePlayback(),is_playing:isPlaying});
    const response = await control({action:"transfer",deviceId:"living-room-tv"});
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.device.name, "Living room TV");
    assert.equal(payload.refreshPlayback, true);
    assert.deepEqual(dock.requests.at(-1), {method:"PUT",endpoint:"/v1/me/player",body:{device_ids:["living-room-tv"],play:false}});
    assert.equal(dock.requests.length, 2);
    assert.equal(dock.reconnects.length, 0);
  }
});

test("transfer rejects disappeared, restricted and invalid devices without fallback", async () => {
  for (const [deviceId, status] of [["missing-device",409],["locked-speaker",409],["",400],["../phone",400],[42,400]]) {
    dock.reset(phonePlayback());
    const response = await control({action:"transfer",deviceId});
    assert.equal(response.status, status);
    assert.equal(dock.requests.some(request => request.method !== "GET"), false);
  }
  dock.reset(phonePlayback());
  dock.failPlay(["spotify_device_unavailable"]);
  assert.equal((await control({action:"transfer",deviceId:"living-room-tv"})).status, 409);
  assert.equal(dock.reconnects.length, 0, "a failed TV transfer never redirects playback to Breadboard");
});

test("transfer back to Breadboard recovers a replaced local device ID", async () => {
  dock.reset(phonePlayback(), {ready:true,deviceId:"breadboard-123",status:"ready",error:null});
  dock.failPlay(["spotify_device_unavailable"]);
  const response = await control({action:"transfer",deviceId:"breadboard-123"});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.device.id, payload.engine.deviceId);
  assert.equal(payload.device.id, "breadboard-reconnected-001");
});

test("resume and new music stay on the selected remote device while the local player is unavailable", async () => {
  const actions = [
    {action:"resume"},
    {action:"play-track",trackUri:"spotify:track:0123456789abcdefghijAB"},
    {action:"play-playlist",playlistUri:"spotify:playlist:0123456789abcdefghijAB"},
    {action:"play-artist",artistUri:"spotify:artist:0123456789abcdefghijAB"},
    {action:"play-album",albumUri:"spotify:album:0123456789abcdefghijAB"},
  ];
  for (const action of actions) {
    dock.reset(phonePlayback());
    const response = await control({...action,deviceId:"phone-123"});
    assert.equal(response.status, 200);
    assert.equal(dock.requests.length, 1);
    assert.equal(dock.requests[0].endpoint, "/v1/me/player/play");
    assert.equal(dock.requests[0].query.device_id, "phone-123");
    assert.equal(dock.reconnects.length, 0);
    if (action.action === "resume") assert.equal(dock.engineReads.length, 0);
  }
});

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
    method: "PUT", endpoint: "/v1/me/player/pause",
  }]);
  const state = await response.json();
  assert.equal(state.refreshPlayback, true);
  assert.equal(dock.requests.length, 1, "pause does not wait for a cloud status read");
  assert.equal(dock.engineReads.length, 0, "phone controls never wait for the local engine");
});

test("pause uses Spotify's active device when its identifier is unavailable", async () => {
  dock.reset(phonePlayback({name: "My iPhone"}));
  const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
    method: "POST", body: JSON.stringify({action: "pause"}),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(dock.requests.filter(request => request.method !== "GET"), [{method: "PUT", endpoint: "/v1/me/player/pause"}]);
});

test("pause reports a missing active device without retrying the command", async () => {
  dock.reset(null);
  const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
    method: "POST", body: JSON.stringify({action: "pause"}),
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "spotify_playback_required");
  assert.deepEqual(dock.requests.map(request => request.endpoint), ["/v1/me/player/pause"]);
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
        method: "POST", endpoint: `/v1/me/player/${action}`,
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

  test(`${action} reports a missing active device without retrying the command`, async () => {
    dock.reset(null);
    const response = await dock.POST(new Request("http://localhost/api/browser/spotify", {
      method: "POST", body: JSON.stringify({action}),
    }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "spotify_playback_required");
    assert.deepEqual(dock.requests.map(request => request.endpoint), [`/v1/me/player/${action}`]);
  });
}

const post = body => dock.POST(new Request("http://localhost/api/browser/spotify", {method:"POST",body:JSON.stringify(body)}));
const readyEngine = {ready:true,deviceId:"breadboard-123",status:"ready",error:null};

for (const action of ["pause", "next", "previous", "resume", "play-track"]) {
  test(`${action} does not wait behind an in-flight cloud status read`, async () => {
    dock.reset(phonePlayback(), readyEngine);
    let finishStatus;
    dock.delayStatus(new Promise(resolve => { finishStatus = resolve; }));
    const poll = dock.GET(new Request("http://localhost/api/browser/spotify"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dock.requests.filter(request => request.method === "GET").length, 1);
    let deadline;
    try {
      const response = await Promise.race([
        post({action, ...(action === "play-track" ? {trackUri: phonePlayback().item.uri} : {})}),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(Error("Control waited for status")), 500); }),
      ]);
      assert.equal(response.status, 200);
      assert.equal(dock.requests.filter(request => request.method !== "GET").length, 1);
      assert.equal(dock.requests.filter(request => request.method === "GET").length, 1, "the control adds no status preflight");
    } finally {
      clearTimeout(deadline);
      finishStatus();
      await poll;
    }
  });
}

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
  assert.deepEqual(dock.requests.map(request => request.endpoint), ["/v1/me/player/pause"]);
  assert.equal(dock.requests[0].query, undefined, "Spotify resolves the active device");
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

test("a search result starts at its position in Spotify's album without a catalog lookup", async () => {
  dock.reset(null, readyEngine);
  const trackUri = phonePlayback().item.uri;
  const albumUri = "spotify:album:album0123456789abcde";
  assert.equal((await post({action:"play-track",trackUri,albumUri,queueUris:[]})).status,200);
  assert.deepEqual(dock.requests,[{method:"PUT",endpoint:"/v1/me/player/play",query:{device_id:readyEngine.deviceId},body:{context_uri:albumUri,offset:{uri:trackUri}}}]);
  for(const albumUri of [null, "", "spotify:track:0123456789abcdefghijAB", 3]) {
    assert.equal((await post({action:"play-track",trackUri,albumUri})).status,400);
  }
  assert.equal(dock.requests.length,1);
  const queued="spotify:track:next0123456789abcdefgh";
  assert.equal((await post({action:"play-track",trackUri,albumUri,queueUris:[queued]})).status,200);
  assert.deepEqual(dock.requests[1].body,{uris:[trackUri,queued]},"explicitly selected lists retain their order");
});

test("legacy recommendation prefetch and autoplay flags cannot build a substitute queue", async () => {
  dock.reset(null, readyEngine);
  const track = phonePlayback().item;
  const preparation = await dock.GET(new Request(`http://localhost/api/browser/spotify?view=prepare-track&id=${track.id}`));
  assert.equal(preparation.status, 200);
  assert.deepEqual(dock.requests, [], "hovering never requests catalog recommendations");
  const response = await post({action:"play-track",trackUri:track.uri,autoplay:true,queueUris:["spotify:track:next0123456789abcdefgh"]});
  assert.equal(response.status, 200);
  assert.deepEqual(dock.requests, [{method:"PUT",endpoint:"/v1/me/player/play",query:{device_id:readyEngine.deviceId},body:{uris:[track.uri]}}]);
});

for (const kind of ["playlist", "album"]) {
  test(`selecting a song in a ${kind} retains the Spotify context and selected offset`, async () => {
    dock.reset(null, readyEngine);
    const uri = `spotify:${kind}:0123456789abcdefghijAB`;
    const offsetUri = phonePlayback().item.uri;
    assert.equal((await post({action:`play-${kind}`,[`${kind}Uri`]:uri,offsetUri})).status, 200);
    assert.deepEqual(dock.requests, [{method:"PUT",endpoint:"/v1/me/player/play",query:{device_id:readyEngine.deviceId},body:{context_uri:uri,offset:{uri:offsetUri}}}]);
    for (const offsetUri of [null, "", "spotify:playlist:0123456789abcdefghijAB", 3]) {
      assert.equal((await post({action:`play-${kind}`,[`${kind}Uri`]:uri,offsetUri})).status, 400);
    }
    assert.equal(dock.requests.length, 1, "malformed offsets never reach playback");
  });
}

for (const action of ["transfer", "resume"]) {
  test(`${action} preserves Spotify's existing queue without submitting any track list`, async () => {
    dock.reset(phonePlayback(), readyEngine);
    assert.equal((await post({action})).status, 200);
    assert.deepEqual(dock.requests, [{method:"PUT",endpoint:"/v1/me/player",body:{device_ids:[readyEngine.deviceId],play:true}}]);
  });
}

for (const body of [
  {action: "play-artist", artistUri: "spotify:artist:artist0123456789abcde"},
  {action: "play-album", albumUri: "spotify:album:album0123456789abcde"},
  {action: "play-playlist", playlistUri: "spotify:playlist:list0123456789abcde"},
  {action: "play-track", trackUri: "spotify:track:0123456789abcdefghijAB", queueUris: ["spotify:track:next0123456789abcdefgh"]},
  {action: "resume"},
  {action: "transfer"},
]) {
  test(`${body.action} reconnects an absent device and preserves the original request`, async () => {
    dock.reset(null, readyEngine);
    dock.failPlay(['spotify_device_unavailable']);
    const response = await post(body);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).engine.deviceId, 'breadboard-reconnected-001');
    assert.deepEqual(dock.reconnects, [{userId:7,deviceId:readyEngine.deviceId}]);
    const commands = dock.requests.filter(request => request.method === 'PUT');
    assert.equal(commands.length, 2);
    if (body.action.startsWith('play-')) {
      assert.deepEqual(commands[1].body, commands[0].body);
      assert.equal(commands[1].query.device_id, 'breadboard-reconnected-001');
    } else assert.deepEqual(commands[1].body.device_ids, ['breadboard-reconnected-001']);
  });
}

test('readiness propagation retries are bounded, including reconnects retaining the same ID', async () => {
  dock.reset(null, readyEngine);
  dock.failPlay(['spotify_device_unavailable', 'spotify_device_unavailable'], readyEngine.deviceId);
  assert.equal((await post({action:'play-artist',artistUri:'spotify:artist:artist0123456789abcde'})).status,200);
  assert.equal(dock.reconnects.length,1);
  assert.equal(dock.requests.length,3);
  dock.reset(null,readyEngine);
  dock.failPlay(Array(5).fill('spotify_device_unavailable'));
  assert.equal((await post({action:'play-artist',artistUri:'spotify:artist:artist0123456789abcde'})).status,409);
  assert.equal(dock.reconnects.length,1);
  assert.equal(dock.requests.length,4);
  assert.equal(dock.engine.ready,false);
});

for (const code of ['provider_request_failed', 'spotify_rate_limited']) {
  test(`${code} never reconnects or replays a play request`, async () => {
    dock.reset(null,readyEngine);
    dock.failPlay([code]);
    assert.equal((await post({action:'play-artist',artistUri:'spotify:artist:artist0123456789abcde'})).status,code === 'spotify_rate_limited' ? 429 : 409);
    assert.equal(dock.reconnects.length,0);
    assert.equal(dock.requests.length,1);
  });
}

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
    assert.equal(status.playbackErrorCode,"spotify_rate_limited");
  }
  assert.equal(dock.requests.filter(request=>request.endpoint==="/v1/me/player").length,1);
});
