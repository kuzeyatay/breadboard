import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {build} from 'esbuild';
import {spotifyHistoryTracks} from '../src/lib/spotify/history.ts';

const fixture = `
  export const requests = [], deferred = [];
  export function reset() { requests.length=0; deferred.length=0; globalThis.spotifyPlaybackEvents?.samples.clear(); }
  export async function spotifyApiRequest(input) { requests.push(input); throw Error('Engine heartbeats must not control the Spotify queue'); }
  export async function spotifyBrowserAccessToken() { throw Error('Unexpected token request'); }
`;
const errors = `export class ApiError extends Error { constructor(status,code,message) { super(message); this.status=status; this.code=code; } }
  export const requireEnabled=()=>{}; export const readJsonBody=request=>request.json();
  export const apiErrorResponse=error=>Response.json({code:error.code},{status:error.status??500});`;
const stubs = {
  'server-only': 'export {};',
  'fixture': fixture,
  '@/lib/spotify/service.ts': "export {spotifyBrowserAccessToken} from 'fixture'; export const spotifyConnectionStatus=()=>({connected:true});",
  'next/server': "import {deferred} from 'fixture'; export const NextResponse=Response; export const after=work=>deferred.push(work);",
  '@/lib/server-auth': "export async function requireUserId() { throw Error('Only authenticated engine registrations should publish playback'); }",
  '../hermes/route-core.ts': errors,
  '@/lib/hermes/route-core.ts': "export * from '../hermes/route-core.ts';",
  '@/lib/hermes/route-helpers.ts': "export * from '../hermes/route-core.ts';",
  './runtime-service.ts': "export async function readSpotifyPlaybackRuntimeStatus() { return {status:'starting',error:null}; }",
  '@/lib/spotify/view-lease.ts': 'export const releaseSpotifyPlaybackViewLease=()=>{}; export const renewSpotifyPlaybackViewLease=()=>{};',
};
const bundle = await build({
  stdin:{resolveDir:path.resolve(import.meta.dirname,'..'),loader:'ts',contents:`
    export {subscribeSpotifyPlayback} from './src/lib/spotify/playback-events.ts';
    export {POST} from './src/app/api/hermes/connections/spotify/engine/route.ts';
    export {issueSpotifyPlaybackEngineTicket} from './src/lib/spotify/playback-engine.ts';
    export * from 'fixture';`},
  bundle:true,write:false,platform:'node',format:'esm',
  plugins:[{name:'autoplay-boundaries',setup(builder){
    builder.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'fixture'}:undefined);
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js'}));
  }}],
});
const autoplay = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const track = suffix => ({id:`0123456789abcdefghijA${suffix}`,uri:`spotify:track:0123456789abcdefghijA${suffix}`,name:`Song ${suffix}`,artist:'Artist',album:'Album',durationMs:180000,imageUrl:null});
const a=track('A'),b=track('B');
const deviceId='breadboard-player';
const sample = (song=a,extra={}) => ({track:song,isPlaying:true,positionMs:1000,shuffle:false,deviceId,deviceName:'Breadboard',...extra});
const post = body => autoplay.POST(new Request('http://localhost/api/hermes/connections/spotify/engine',{method:'POST',body:JSON.stringify(body)}));
function engineSecret(t) {
  const previous=process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET='spotify-autoplay-registration-test-secret';
  t.after(()=>{if(previous===undefined)delete process.env.NEXTAUTH_SECRET;else process.env.NEXTAUTH_SECRET=previous;});
}
test.beforeEach(()=>autoplay.reset());

test('recent songs keep valid album context while old history remains playable',()=>{
  const albumUri='spotify:album:0123456789abcdefghijAB';
  assert.deepEqual(spotifyHistoryTracks([{...a,albumUri},b]),[{...a,albumUri},b]);
  assert.deepEqual(spotifyHistoryTracks([{...a,albumUri:'https://invalid.test'}]),[a]);
});

for (const hasNextTrack of [false, true, undefined]) {
  test(`engine state with hasNextTrack=${hasNextTrack} reports Spotify playback without choosing follow-up songs`,async t=>{
    engineSecret(t);
    const samples=[];
    const unsubscribe=autoplay.subscribeSpotifyPlayback(7,sample=>samples.push(sample.playback));
    t.after(unsubscribe);
    const ticket=autoplay.issueSpotifyPlaybackEngineTicket(7);
    for (const playback of [sample(a,{hasNextTrack}),sample(b,{hasNextTrack}),sample(b,{isPlaying:false}),null]) {
      assert.equal((await post({ticket,deviceId,playback})).status,200);
    }
    assert.deepEqual(samples.map(playback=>playback?.track.uri??null),[a.uri,b.uri,b.uri,null],"Spotify's next track still reaches the widgets");
    assert.equal(samples[2].isPlaying,false);
    assert.deepEqual(autoplay.requests,[],"no recommendation lookup, queue insertion, play, or skip");
    assert.deepEqual(autoplay.deferred,[],"no later background replenishment can override Spotify");
  });
}

test('engine registration and disconnect do not touch Spotify playback',async t=>{
  engineSecret(t);
  const ticket=autoplay.issueSpotifyPlaybackEngineTicket(7);
  assert.equal((await post({ticket,deviceId})).status,200);
  assert.equal((await post({ticket,deviceId,ready:false})).status,200);
  assert.deepEqual(autoplay.requests,[]);
  assert.deepEqual(autoplay.deferred,[]);
});

test('invalid engine tickets and malformed playback cannot publish a new song',async t=>{
  engineSecret(t);
  const samples=[];
  t.after(autoplay.subscribeSpotifyPlayback(7,sample=>samples.push(sample)));
  assert.equal((await post({ticket:'invalid',deviceId,playback:sample()})).status,403);
  const ticket=autoplay.issueSpotifyPlaybackEngineTicket(7);
  assert.equal((await post({ticket,deviceId,playback:{...sample(),positionMs:-1}})).status,400);
  assert.deepEqual(samples,[]);
  assert.deepEqual(autoplay.deferred,[]);
  assert.deepEqual(autoplay.requests,[]);
});
