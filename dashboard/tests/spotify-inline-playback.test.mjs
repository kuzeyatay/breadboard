import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ensureSpotifySchema } from "../src/lib/spotify/schema.ts";

test("existing playback intents retain their target through an idempotent schema upgrade", () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE spotify_playback_intents (conversation_id INTEGER PRIMARY KEY, user_id INTEGER, revision TEXT, track_json TEXT, queue_json TEXT, requested_at TEXT, updated_at TEXT);
      INSERT INTO spotify_playback_intents VALUES (9,7,'old','{}','[]','2026-09-06','2026-09-06');`);
    ensureSpotifySchema(db);
    ensureSpotifySchema(db);
    assert.equal(db.prepare('SELECT target FROM spotify_playback_intents').get().target,'phone');
    db.prepare("UPDATE spotify_playback_intents SET target='inline'").run();
    ensureSpotifySchema(db);
    assert.equal(db.prepare('SELECT target FROM spotify_playback_intents').get().target,'inline');
  } finally { db.close(); }
});

// Execute the real tool route, playback route, target selection, schema and
// service against SQLite. Only the account/provider/runtime boundaries are fake.
const fixture = `
  import { DatabaseSync } from 'node:sqlite';
  import { ensureSpotifySchema } from '${fileURLToPath(new URL("../src/lib/spotify/schema.ts", import.meta.url)).replaceAll("\\", "/")}';
  export const db = new DatabaseSync(':memory:');
  db.transaction = operation => ({ immediate() {
    db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }});
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE conversations (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (7); INSERT INTO conversations VALUES (9);');
  ensureSpotifySchema(db);
  export const track = { id:'0123456789abcdefghijAB', uri:'spotify:track:0123456789abcdefghijAB', name:'Shoot to Thrill', artists:[{name:'AC/DC'}], album:{name:'Back In Black',images:[]}, duration_ms:317000 };
  export const phone = {id:'phone-device-001',name:'My phone',type:'Smartphone',is_active:true,is_restricted:false};
  export const requests = [], leases = [], releases = [], audits = [];
  export let devices = [], playback = null, engine = null, failure = null, mismatch = false;
  export const tokens = {scope:'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-library-read user-library-modify playlist-read-private playlist-modify-private'};
  export function reset(options = {}) {
    requests.length = leases.length = releases.length = audits.length = 0;
    db.exec('DELETE FROM spotify_playback_intents');
    devices = options.phone ? [phone] : [];
    playback = null; failure = options.failure; mismatch = options.mismatch;
    engine = {ready:true,deviceId:'breadboard-device-001',status:'ready',error:null};
  }
  export function setPlaybackDevice(id) { playback.device.id = id; }
  export async function renew(value) { leases.push(value); if(failure === 'engine') throw new Error('Protected audio unavailable'); }
  export async function release(value) { releases.push(value); }
  export async function providerRequest({request}) {
    requests.push(request);
    const {endpoint,method,body,query} = request;
    if(endpoint === '/v1/search') return {tracks:{items:[track]}};
    if(endpoint === '/v1/me/player/devices') return {devices};
    if(endpoint === '/v1/me/player/play') {
      if(failure === 'provider') throw new Error('Playback denied by Spotify');
      playback = {item:track,is_playing:true,device:{id:mismatch ? phone.id : query.device_id,name:query.device_id},progress_ms:0,shuffle_state:false};
      return null;
    }
    if(endpoint === '/v1/me/player/pause') { if(playback) playback.is_playing = false; return null; }
    if(endpoint === '/v1/me/player') return playback;
    if(endpoint === '/v1/me/library/contains') return [false];
    if(endpoint === '/v1/me/playlists' && method === 'POST') return {id:'playlist0123456789ABCD',uri:'spotify:playlist:playlist0123456789ABCD',name:body.name};
    if(endpoint.endsWith('/items') && method === 'POST') return {};
    throw new Error('Unexpected Spotify endpoint: ' + endpoint);
  }
`;
const helpers = `
  export class ApiError extends Error { constructor(status,code,message) { super(message); this.status=status; this.code=code; } }
  export const requireEnabled = () => {};
  export const readJsonBody = request => request.json();
  export const apiErrorResponse = error => Response.json({code:error.code,message:error.message}, {status:error.status ?? 500});
`;
const stubs = {
  "fixture": fixture,
  "server-only": "export {};",
  "next/server": "export const NextResponse = Response;",
  "@/lib/server-auth": "export async function requireUserId() {return 7;}",
  "@/lib/conversations/store.ts": "export function getConversationForUser() {return {id:9};}",
  "@/lib/hermes/route-helpers.ts": helpers,
  "../hermes/route-core.ts": helpers,
  "@/lib/hermes/tool-service-auth.ts": "export const capabilityForInternalToolRequest = () => 'test-token';",
  "@/lib/hermes/capability-token.ts": "export const tokenAllows=()=>true; export const verifyCapabilityToken=()=>({ok:true,token:{breadboardSessionId:4,hermesSessionId:'session-4',conversationId:9}});",
  "@/lib/hermes/runtime-store.ts": "import {audits} from 'fixture'; export const getRuntimeSessionById=()=>({id:4,user_id:7,conversation_id:9,surface:'dashboard_terminal'}); export const runtimeExternalSessionId=()=> 'session-4'; export const getActiveCapabilityDecision=()=>({allowedTools:['spotify_search','spotify_play','spotify_create_playlist'],selectedConditionalSkills:['spotify']}); export const recordAuditEvent=e=>audits.push(e);",
  "@/lib/hermes/run-store.ts": "export const getActiveRuntimeRun=()=>({id:5});",
  "@/lib/hermes/tool-scopes.ts": "export const SPOTIFY_TOOLS=['spotify_search','spotify_play','spotify_create_playlist'];",
  "../db.ts": "export {db as default} from 'fixture';",
  "../connected-apps/broker.ts": "export {providerRequest as embeddedProviderRequest} from 'fixture'; import {tokens} from 'fixture'; export const connectedAppTokensFor=async()=>tokens;",
  "../connected-apps/vault.ts": "import {tokens} from 'fixture'; export const readConnectedAppTokens=()=>tokens;",
  "../nango/catalog.ts": "export const findNangoIntegration=()=>({slug:'spotify'});",
  "./playback-engine.ts": "import {engine} from 'fixture'; export const issueSpotifyPlaybackEngineTicket=()=> 'sealed-ticket'; export const spotifyPlaybackEngineStatus=async()=>engine;",
  "./view-lease.ts": "export {renew as renewSpotifyPlaybackViewLease,release as releaseSpotifyPlaybackViewLease} from 'fixture';",
};
const bundle = await build({
  stdin: {
    contents: `export {POST as tool} from './src/app/api/hermes/tools/spotify/route.ts'; export {GET as state,POST as control} from './src/app/api/hermes/connections/spotify/playback/route.ts'; export {getSpotifyPlaybackIntent} from './src/lib/spotify/service.ts'; export * from 'fixture';`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "spotify-boundaries", setup(builder) {
    builder.onResolve({filter:/.*/}, args => Object.hasOwn(stubs,args.path) ? {path:args.path,namespace:"fixture"} : undefined);
    builder.onLoad({filter:/.*/,namespace:"fixture"}, args => ({contents:stubs[args.path],loader:"js",resolveDir:fileURLToPath(new URL("../", import.meta.url))}));
  }}],
});
const app = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const request = body => new Request("http://localhost/api/test", {method:"POST",body:JSON.stringify(body)});
const play = args => app.tool(request({tool:"spotify_play",args:{query:"Shoot the Thrill AC/DC",...args}})).then(response=>response.json());

for (const phone of [false,true]) {
  test(`an ordinary song request starts Breadboard with ${phone ? 'an active phone' : 'no phone'}`, async () => {
    app.reset({phone});
    const result = await play();
    assert.equal(result.data.player,"inline");
    assert.equal(result.data.status,"playing");
    assert.equal(result.data.playbackStarted,true);
    assert.equal(app.leases.length,1);
    assert.equal(app.requests.filter(r=>r.endpoint.endsWith('/devices')).length,0);
    const start = app.requests.find(r=>r.endpoint.endsWith('/play'));
    assert.deepEqual(start.query,{device_id:'breadboard-device-001'});
    assert.deepEqual(start.body,{uris:[app.track.uri]});
    assert.equal(app.getSpotifyPlaybackIntent(7,9).target,'inline');
    const state = await (await app.state(new Request('http://localhost/api/test?conversation=chat'))).json();
    assert.equal(state.device.name,'Breadboard');
    assert.equal(state.playback.isPlaying,true);
    assert.equal(app.releases.length,0,'keep the bounded lease for the inline view to take over');
  });
}

test('only an explicit phone target sends playback to a phone', async () => {
  app.reset({phone:true});
  const result = await play({target:'phone'});
  assert.equal(result.data.player,'phone');
  assert.equal(result.data.status,'playing');
  assert.equal(app.leases.length,0);
  assert.equal(app.getSpotifyPlaybackIntent(7,9).target,'phone');
  assert.equal(app.requests.find(r=>r.endpoint.endsWith('/play')).query.device_id,app.phone.id);
  const response = await app.control(request({conversation:'chat',action:'pause'}));
  assert.equal(response.status,200);
  assert.equal(app.requests.find(r=>r.endpoint.endsWith('/pause')).query.device_id,app.phone.id);
});

test('Hermes can switch from a requested phone to Breadboard explicitly', async () => {
  app.reset({phone:true});
  await play({target:'phone'});
  const result = await play({target:'inline'});
  assert.equal(result.data.player,'inline');
  assert.equal(result.data.status,'playing');
  assert.equal(app.getSpotifyPlaybackIntent(7,9).target,'inline');
  assert.deepEqual(app.requests.filter(r=>r.endpoint.endsWith('/play')).map(r=>r.query.device_id),[app.phone.id,'breadboard-device-001']);
});

test('Hermes can keep contextual controls on the chosen phone', async () => {
  app.reset({phone:true});
  await play({target:'phone'});
  const response = await app.tool(request({tool:'spotify_play',args:{action:'pause',target:'phone'}}));
  assert.equal(response.status,200);
  assert.equal(app.requests.find(r=>r.endpoint.endsWith('/pause')).query.device_id,app.phone.id);
  assert.equal(app.leases.length,0);
});

test('explicit phone playback fails truthfully without starting local audio', async () => {
  app.reset();
  const result = await play({target:'phone'});
  assert.equal(result.data.status,'playback_failed');
  assert.equal(result.data.playbackStarted,false);
  assert.match(result.data.playbackError,/phone/);
  assert.equal(app.leases.length,0);
});

for (const failure of ['engine','provider']) {
  test(`${failure} failure preserves the inline request without claiming playback`, async () => {
    app.reset({failure});
    const result = await play();
    assert.equal(result.data.status,'playback_failed');
    assert.equal(result.data.playbackStarted,false);
    assert.doesNotMatch(result.data.playbackError,/phone/);
    assert.equal(app.getSpotifyPlaybackIntent(7,9).track.name,'Shoot to Thrill');
    assert.equal(app.releases.length,1);
  });
}

test('the same track playing on another device cannot confirm inline playback', async () => {
  app.reset({phone:true,mismatch:true});
  const result = await play();
  assert.equal(result.data.status,'playback_failed');
  assert.equal(result.data.playbackStarted,false);
  const state = await (await app.state(new Request('http://localhost/api/test?conversation=chat'))).json();
  assert.equal(state.playback,null);
});

test('inline transport controls cannot be redirected by an active phone or a client device ID', async () => {
  app.reset({phone:true});
  await play();
  const response = await app.control(request({conversation:'chat',action:'pause',deviceId:app.phone.id}));
  assert.equal(response.status,200);
  assert.equal(app.requests.find(r=>r.endpoint.endsWith('/pause')).query.device_id,'breadboard-device-001');
  assert.equal(app.playback.is_playing,false);
});

test('agent controls default to the inline player', async () => {
  app.reset({phone:true});
  const response = await app.tool(request({tool:'spotify_play',args:{action:'pause'}}));
  assert.equal(response.status,200);
  assert.equal(app.requests.find(r=>r.endpoint.endsWith('/pause')).query.device_id,'breadboard-device-001');
  assert.equal(app.releases.length,1,'transport commands must release temporary leases immediately');
});

test('playlist creation stays silent unless playback is requested', async () => {
  app.reset();
  const response = await app.tool(request({tool:'spotify_create_playlist',args:{name:'Rock',queries:['AC/DC','rock'],play:false}}));
  assert.equal((await response.json()).data.status,'created');
  assert.equal(app.leases.length,0);
  assert.equal(app.getSpotifyPlaybackIntent(7,9),null);
  app.reset();
  const played = await app.tool(request({tool:'spotify_create_playlist',args:{name:'Rock',queries:['AC/DC','rock'],play:true}}));
  assert.equal((await played.json()).data.status,'playing');
  assert.equal(app.requests.find(r=>r.endpoint.endsWith('/play')).query.device_id,'breadboard-device-001');
});

test('catalog searches never prepare or start playback', async () => {
  app.reset();
  const response = await app.tool(request({tool:'spotify_search',args:{query:'AC/DC'}}));
  assert.equal((await response.json()).data.tracks[0].name,'Shoot to Thrill');
  assert.equal(app.getSpotifyPlaybackIntent(7,9),null);
  assert.equal(app.leases.length,0);
});

test('invalid targets fail before touching playback', async () => {
  app.reset();
  const response = await app.tool(request({tool:'spotify_play',args:{query:'AC/DC',target:'speaker'}}));
  assert.equal(response.status,400);
  assert.equal(app.requests.length,0);
});
