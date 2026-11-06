import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  stdin: { contents: 'export * from "./src/lib/spotify/playback-engine.ts";', resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'engine-boundaries', setup(builder) {
    const stubs = {
      'server-only': 'export {};',
      './runtime-service.ts': 'export const readSpotifyPlaybackRuntimeStatus = async () => ({status:"starting",error:null});',
      '../hermes/route-core.ts': 'export class ApiError extends Error { constructor(status,code,message) {super(message);this.status=status;this.code=code;} }',
    };
    builder.onResolve({filter:/.*/}, args => Object.hasOwn(stubs,args.path) ? {path:args.path,namespace:'stub'} : undefined);
    builder.onLoad({filter:/.*/,namespace:'stub'}, args => ({contents:stubs[args.path],loader:'js'}));
  }}],
});
const engine = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('offline registrations clear only their own current device and remain user scoped', async () => {
  const previousSecret = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = 'spotify-registration-test-secret';
  try {
    const ticket = engine.issueSpotifyPlaybackEngineTicket(7);
    const otherTicket = engine.issueSpotifyPlaybackEngineTicket(8);
    engine.registerSpotifyPlaybackEngine({ticket,deviceId:'device-original'});
    engine.registerSpotifyPlaybackEngine({ticket:otherTicket,deviceId:'device-other-user'});
    assert.equal((await engine.spotifyPlaybackEngineStatus(7)).ready,true);
    engine.registerSpotifyPlaybackEngine({ticket,deviceId:'device-original',ready:false});
    assert.equal((await engine.spotifyPlaybackEngineStatus(7)).ready,false);
    assert.equal((await engine.spotifyPlaybackEngineStatus(8)).ready,true);
    engine.registerSpotifyPlaybackEngine({ticket,deviceId:'device-replacement'});
    engine.registerSpotifyPlaybackEngine({ticket,deviceId:'device-original',ready:false});
    assert.equal((await engine.spotifyPlaybackEngineStatus(7)).deviceId,'device-replacement');
    assert.throws(()=>engine.registerSpotifyPlaybackEngine({ticket:'invalid',deviceId:'device-replacement',ready:false}));
    assert.equal((await engine.spotifyPlaybackEngineStatus(7)).ready,true);
  } finally {
    if (previousSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = previousSecret;
  }
});
