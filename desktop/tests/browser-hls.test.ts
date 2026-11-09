import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { decryptHlsPart, hlsUrl, isHlsResponse, parseHlsPlaylist, resolveHlsMedia, writeHlsMedia, type HlsFetch, type HlsMedia } from '../src/main/browser-hls-playlist';
import { isTabsCommand } from '../src/shared/ipc-contract';

const origin = 'https://media.example/video/';
const media = (extra = '') => `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n${extra}#EXTINF:2,\nfirst.ts\n#EXTINF:3,\nsecond.ts\n#EXT-X-ENDLIST\n`;

test('HLS detection handles signed URLs and MIME-only playlists, and rejects non-network URLs', () => {
  assert.equal(isHlsResponse(`${origin}stream.m3u8?token=private`), true);
  assert.equal(isHlsResponse(`${origin}stream`, 'application/vnd.apple.mpegurl; charset=utf-8'), true);
  assert.equal(isHlsResponse(`${origin}video.ts`), false);
  for (const url of ['file:///secret', 'data:abc', 'ftp://example.com/x', 'https://user:secret@example.com']) assert.throws(() => hlsUrl(url));
  assert.equal(hlsUrl('../chunk.ts?token=x', `${origin}media.m3u8`), 'https://media.example/chunk.ts?token=x');
});

test('master playlists select the highest combined rendition and resolve relative to redirects', async () => {
  const requested: string[] = [];
  const fetch: HlsFetch = async url => {
    requested.push(url);
    return requested.length === 1
      ? { url: `${origin}redirect/master.m3u8`, bytes: Buffer.from('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=9000000,AUDIO="a",CODECS="avc1,mp4a"\nsilent.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhigh.m3u8') }
      : { url, bytes: Buffer.from(media()) };
  };
  const result = await resolveHlsMedia(`${origin}master.m3u8`, fetch);
  assert.deepEqual(requested, [`${origin}master.m3u8`, `${origin}redirect/high.m3u8`]);
  assert.equal(result.parts[0]!.url, `${origin}redirect/first.ts`);
  assert.equal(result.duration, 5);
  assert.equal(result.extension, 'ts');
});

test('finite media playlists handle initialization segments and explicit/implicit byte ranges', () => {
  const parsed = parseHlsPlaylist('#EXTM3U\n#EXT-X-MAP:URI="all.mp4",BYTERANGE="20@0"\n#EXTINF:1,\n#EXT-X-BYTERANGE:40@20\nall.mp4\n#EXTINF:1,\n#EXT-X-BYTERANGE:30\nall.mp4\n#EXT-X-ENDLIST', origin) as HlsMedia;
  assert.equal(parsed.extension, 'mp4');
  assert.deepEqual(parsed.init?.range, { offset: 0, length: 20 });
  assert.deepEqual(parsed.parts.map(part => part.range), [{ offset: 20, length: 40 }, { offset: 60, length: 30 }]);
  assert.throws(() => parseHlsPlaylist(media('#EXT-X-BYTERANGE:40\n'), origin), /byte range/);
});

test('live, DRM, incomplete, discontinuous MP4 and external-audio-only streams fail explicitly', async () => {
  assert.throws(() => parseHlsPlaylist(media().replace('#EXT-X-ENDLIST', ''), origin), /live stream/);
  assert.throws(() => parseHlsPlaylist(media('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n'), origin), /DRM/);
  assert.throws(() => parseHlsPlaylist('#EXTM3U\n#EXTINF:1,\n#EXT-X-ENDLIST', origin), /complete media/);
  assert.throws(() => parseHlsPlaylist(media('#EXT-X-MAP:URI="init.mp4"\n#EXT-X-DISCONTINUITY\n'), origin), /timeline/);
  assert.throws(() => parseHlsPlaylist(media().replace('first.ts', 'file:///secret'), origin), /unsupported/);
  await assert.rejects(resolveHlsMedia(origin, async url => ({ url, bytes: Buffer.from('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=10,AUDIO="a"\nvideo.m3u8') })), /separate audio/);
  await assert.rejects(resolveHlsMedia(origin, async url => ({ url, bytes: Buffer.from('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n' + origin) })), /loop/);
});

test('AES-128 uses sequence-derived IVs, writes segments in order and reports real progress', async () => {
  const key = Buffer.alloc(16, 42);
  const parsed = parseHlsPlaylist(media('#EXT-X-KEY:METHOD=AES-128,URI="key"\n'), origin) as HlsMedia;
  const output: Buffer[] = [], progress: number[][] = [];
  const segments = [Buffer.alloc(188, 1), Buffer.alloc(188, 2)];
  for (const bytes of segments) bytes[0] = 0x47;
  let keyRequests = 0;
  const fetch: HlsFetch = async url => {
    if (url.endsWith('/key')) { keyRequests++; return { url, bytes: key }; }
    const index = url.endsWith('first.ts') ? 0 : 1;
    const iv = Buffer.alloc(16); iv.writeBigUInt64BE(BigInt(7 + index), 8);
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    return { url, bytes: Buffer.concat([cipher.update(segments[index]!), cipher.final()]) };
  };
  await writeHlsMedia(parsed, fetch, async bytes => { output.push(bytes); }, (...args) => progress.push(args), new AbortController().signal);
  assert.deepEqual(Buffer.concat(output), Buffer.concat(segments));
  assert.deepEqual(progress, [[188, 1, 2], [376, 2, 2]]);
  assert.equal(keyRequests, 1);
  assert.throws(() => decryptHlsPart(Buffer.alloc(16), Buffer.alloc(8), parsed.parts[0]!), /invalid AES/);
});

test('cancellation stops before the next segment; access pages never become completed video', async () => {
  const parsed = parseHlsPlaylist(media(), origin) as HlsMedia;
  const controller = new AbortController();
  let requests = 0;
  const fetch: HlsFetch = async url => { requests++; const bytes = Buffer.alloc(188); bytes[0] = 0x47; return { url, bytes }; };
  await assert.rejects(writeHlsMedia(parsed, fetch, async () => { controller.abort(); }, () => {}, controller.signal), /abort/i);
  assert.equal(requests, 1);
  await assert.rejects(writeHlsMedia(parsed, async url => ({ url, bytes: Buffer.from('<html>login</html>') }), async () => {}, () => {}, new AbortController().signal), /access has expired/);
});

test('key rotation can reuse a URL without reusing the previous key material', async () => {
  const tag = '#EXT-X-KEY:METHOD=AES-128,URI="key"\n';
  const parsed = parseHlsPlaylist(media(tag).replace('#EXTINF:3,', tag + '#EXTINF:3,'), origin) as HlsMedia;
  let keysFetched = 0;
  const expected = Buffer.alloc(188); expected[0] = 0x47;
  const chunks: Buffer[] = [];
  const fetch: HlsFetch = async url => {
    if (url.endsWith('/key')) return { url, bytes: Buffer.alloc(16, ++keysFetched) };
    const index = url.endsWith('first.ts') ? 0 : 1;
    const iv = Buffer.alloc(16); iv.writeBigUInt64BE(BigInt(7 + index), 8);
    const cipher = createCipheriv('aes-128-cbc', Buffer.alloc(16, index + 1), iv);
    return { url, bytes: Buffer.concat([cipher.update(expected), cipher.final()]) };
  };
  await writeHlsMedia(parsed, fetch, async bytes => { chunks.push(bytes); }, () => {}, new AbortController().signal);
  assert.equal(keysFetched, 2);
  assert.deepEqual(Buffer.concat(chunks), Buffer.concat([expected, expected]));
});

test('HLS IPC accepts only opaque stream IDs, never URLs or paths', () => {
  assert.equal(isTabsCommand({ type: 'browser-hls-download', id: 'ab123456-1234-1234-1234-ab1234567890' }), true);
  assert.equal(isTabsCommand({ type: 'browser-hls-download', id: `${origin}master.m3u8` }), false);
  assert.equal(isTabsCommand({ type: 'browser-hls-download', id: 'C:\\private.txt' }), false);
});
