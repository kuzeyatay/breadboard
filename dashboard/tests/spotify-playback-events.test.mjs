import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import path from 'node:path';

const bundled=await build({
  stdin:{resolveDir:path.resolve(import.meta.dirname,'..'),contents:'export * from "./src/lib/spotify/playback-events.ts";'},
  bundle:true,write:false,platform:'node',format:'esm',
  plugins:[{name:'server-only',setup(builder){
    builder.onResolve({filter:/hermes\/route-core\.ts$/},args=>({path:args.path,namespace:'route-error'}));
    builder.onLoad({filter:/.*/,namespace:'route-error'},()=>({contents:'export class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}'}));
    builder.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'stub'}));
    builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:''}));
  }}],
});
const events=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const playback={track:{id:'0123456789abcdefghijAB',uri:'spotify:track:0123456789abcdefghijAB',name:'Song',artist:'Artist',album:'Album',durationMs:200000,imageUrl:null},isPlaying:true,positionMs:1000};

test('playback subscriptions are scoped, replay the current state, and unsubscribe',async()=>{
  const own=[],other=[];
  const off=events.subscribeSpotifyPlayback(100,sample=>own.push(sample));
  const offOther=events.subscribeSpotifyPlayback(101,sample=>other.push(sample));
  events.publishSpotifyPlayback(100,'local-player',playback);
  assert.equal(own.length,1);assert.equal(other.length,0);
  assert.equal(own[0].playback.deviceId,'local-player');
  const replay=[];const offReplay=events.subscribeSpotifyPlayback(100,sample=>replay.push(sample));
  assert.deepEqual(replay,own);
  off();offReplay();offOther();
  events.publishSpotifyPlayback(100,'local-player',null);
  assert.equal(own.length,1);assert.equal(replay.length,1);
});

test('invalid SDK metadata never reaches subscribers and stale samples are not replayed',()=>{
  const received=[];const off=events.subscribeSpotifyPlayback(102,sample=>received.push(sample));
  for(const invalid of [undefined,{}, {...playback,positionMs:-1}, {...playback,track:{...playback.track,uri:'spotify:track:different'}}, {...playback,track:{...playback.track,imageUrl:'javascript:alert(1)'}}]){
    assert.throws(()=>events.publishSpotifyPlayback(102,'local-player',invalid),/invalid/);
  }
  assert.equal(received.length,0);
  events.publishSpotifyPlayback(102,'local-player',playback);
  const now=Date.now;
  try {
    Date.now=()=>now()+16000;
    const late=[];const stop=events.subscribeSpotifyPlayback(102,sample=>late.push(sample));
    assert.equal(late.length,0);stop();
  }finally{Date.now=now;off();}
});

test('event streams clean up on cancellation and aborted requests',async()=>{
  const controller=new AbortController();
  const reader=events.spotifyPlaybackEventStream(103,controller.signal).getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value),/connected/);
  controller.abort();assert.equal((await reader.read()).done,true);
  assert.doesNotThrow(()=>events.publishSpotifyPlayback(103,'local-player',playback));
  const second=events.spotifyPlaybackEventStream(104,new AbortController().signal).getReader();
  await second.cancel();
  assert.doesNotThrow(()=>events.publishSpotifyPlayback(104,'local-player',playback));
});
