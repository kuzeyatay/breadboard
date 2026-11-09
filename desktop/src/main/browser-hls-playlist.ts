import { createDecipheriv } from "node:crypto";

export const HLS_MANIFEST_LIMIT = 2 * 1024 * 1024;
export const HLS_SEGMENT_LIMIT = 128 * 1024 * 1024;
const MAX_SEGMENTS = 20_000;

export function hlsUrl(value: string, base?: string): string {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 16_384) {
    throw new Error("This stream contains an unsupported media URL.");
  }
  url.hash = '';
  return url.href;
}

export function isHlsResponse(url: string, contentType = ''): boolean {
  try {
    return /\.m3u8?$/i.test(new URL(url).pathname) ||
      /^(application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/(?:mpegurl|x-mpegurl))(?:;|$)/i.test(contentType.trim());
  } catch { return false; }
}

export interface HlsRange { offset: number; length: number }
export interface HlsKey { url: string; iv?: Buffer }
export interface HlsPart { url: string; range?: HlsRange; key?: HlsKey; sequence: number }
export interface HlsMedia { kind: 'media'; parts: HlsPart[]; init?: HlsPart; duration: number; extension: 'ts' | 'mp4' }
export interface HlsMaster { kind: 'master'; variants: Array<{ url: string; bandwidth: number; externalAudio: boolean }> }

function attributes(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of line.slice(line.indexOf(':') + 1).matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))(?:,|$)/g)) {
    result[match[1]!] = match[2] ?? match[3] ?? '';
  }
  return result;
}

function range(value: string, url: string, previous?: HlsPart): HlsRange {
  const match = /^(\d+)(?:@(\d+))?$/.exec(value);
  if (!match || (!match[2] && (!previous?.range || previous.url !== url))) throw new Error("Invalid HLS byte range.");
  const length = Number(match[1]);
  const offset = match[2] ? Number(match[2]) : previous!.range!.offset + previous!.range!.length;
  if (length < 1 || length > HLS_SEGMENT_LIMIT || !Number.isSafeInteger(offset + length) || offset < 0) throw new Error("Invalid HLS byte range.");
  return { offset, length };
}

/** Parse only download-safe, finite playlists. No manifest text is executed or handed to a media process. */
export function parseHlsPlaylist(text: string, base: string): HlsMedia | HlsMaster {
  if (Buffer.byteLength(text) > HLS_MANIFEST_LIMIT) throw new Error("The HLS playlist is too large.");
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error("This address did not return an HLS playlist. Check that the video still plays.");
  if (lines.some(line => /^#EXT-X-(?:DEFINE|GAP|I-FRAMES-ONLY)(?::|$)/.test(line))) throw new Error("This HLS playlist uses an unsupported format.");
  const variants: HlsMaster['variants'] = [];
  const externalAudio = new Set(lines.filter(line => line.startsWith('#EXT-X-MEDIA:')).map(attributes)
    .filter(item => item.TYPE === 'AUDIO' && item.URI).map(item => item['GROUP-ID']));
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const info = attributes(line), next = lines[++index];
    if (!next || next.startsWith('#')) throw new Error("The HLS quality playlist is incomplete.");
    variants.push({ url: hlsUrl(next, base), bandwidth: Number(info['AVERAGE-BANDWIDTH'] ?? info.BANDWIDTH) || 0,
      externalAudio: Boolean(info.AUDIO && externalAudio.has(info.AUDIO)) });
  }
  if (variants.length) return { kind: 'master', variants: variants.sort((a, b) => b.bandwidth - a.bandwidth) };
  if (!lines.includes('#EXT-X-ENDLIST')) throw new Error("This is a live stream. Download it after the broadcast has finished.");
  let key: HlsKey | undefined, init: HlsPart | undefined, pendingRange: string | undefined;
  let sequence = 0, duration = 0, pendingDuration = false;
  const parts: HlsPart[] = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequence = Number(line.slice(line.indexOf(':') + 1));
      if (parts.length || !Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Invalid HLS sequence number.");
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const info = attributes(line);
      if (info.METHOD === 'NONE') { key = undefined; continue; }
      if (info.METHOD !== 'AES-128' || (info.KEYFORMAT && info.KEYFORMAT !== 'identity')) {
        throw new Error("This stream is DRM protected or uses unsupported encryption.");
      }
      if (!info.URI || (info.IV && !/^0x[0-9a-f]{1,32}$/i.test(info.IV))) throw new Error("Invalid HLS encryption key.");
      key = { url: hlsUrl(info.URI, base), ...(info.IV ? { iv: Buffer.from(info.IV.slice(2).padStart(32, '0'), 'hex') } : {}) };
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const info = attributes(line);
      if (!info.URI) throw new Error("The HLS initialization segment is missing.");
      if (key && !key.iv) throw new Error("The encrypted initialization segment has no IV.");
      const url = hlsUrl(info.URI, base);
      const next: HlsPart = { url, sequence: 0, key, ...(info.BYTERANGE ? { range: range(info.BYTERANGE, url, init) } : {}) };
      if (init && JSON.stringify(init) !== JSON.stringify(next)) throw new Error("This stream changes media formats and cannot be saved as one file yet.");
      init = next;
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = line.slice(line.indexOf(':') + 1);
    } else if (line.startsWith('#EXTINF:')) {
      const seconds = Number(line.slice(8).split(',')[0]);
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid HLS segment duration.");
      duration += seconds;
      pendingDuration = true;
    } else if (!line.startsWith('#')) {
      if (!pendingDuration || parts.length >= MAX_SEGMENTS || !Number.isSafeInteger(sequence)) throw new Error("The HLS segment list is invalid or too large.");
      const url = hlsUrl(line, base);
      parts.push({ url, sequence: sequence++, key, ...(pendingRange ? { range: range(pendingRange, url, parts.at(-1)) } : {}) });
      pendingRange = undefined;
      pendingDuration = false;
    }
  }
  if (!parts.length || pendingDuration || pendingRange) throw new Error("The HLS playlist has no complete media segments.");
  if (init && lines.includes('#EXT-X-DISCONTINUITY')) throw new Error("This MP4 stream changes its timeline and cannot be saved as one file yet.");
  return { kind: 'media', parts, init, duration, extension: init ? 'mp4' : 'ts' };
}

export type HlsFetch = (url: string, limit: number, range?: HlsRange) => Promise<{ bytes: Buffer; url: string }>;

export async function resolveHlsMedia(url: string, fetch: HlsFetch): Promise<HlsMedia> {
  const visited = new Set<string>();
  for (let depth = 0; depth < 5; depth++) {
    if (visited.has(url)) throw new Error("The HLS playlists contain a loop.");
    visited.add(url);
    const response = await fetch(url, HLS_MANIFEST_LIMIT);
    const playlist = parseHlsPlaylist(response.bytes.toString('utf8'), response.url);
    if (playlist.kind === 'media') return playlist;
    const best = playlist.variants.find(variant => !variant.externalAudio);
    if (!best) throw new Error("This stream has a separate audio track, which the native downloader does not support yet.");
    url = best.url;
  }
  throw new Error("The HLS stream has too many nested playlists.");
}

export function decryptHlsPart(bytes: Buffer, key: Buffer, part: HlsPart): Buffer {
  if (key.length !== 16) throw new Error("The stream returned an invalid AES-128 key.");
  const iv = part.key?.iv ?? Buffer.alloc(16);
  if (!part.key?.iv) iv.writeBigUInt64BE(BigInt(part.sequence), 8);
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([decipher.update(bytes), decipher.final()]);
  } catch { throw new Error("The media segment could not be decrypted. Try playing the video again."); }
}

function isTransportStream(bytes: Buffer): boolean {
  if (bytes.length < 188 || bytes.length % 188 !== 0) return false;
  for (let offset = 0; offset < bytes.length; offset += 188) if (bytes[offset] !== 0x47) return false;
  return true;
}

/** Sequential, bounded segment buffers; the whole video is never held in memory. */
export async function writeHlsMedia(media: HlsMedia, fetch: HlsFetch, write: (bytes: Buffer) => Promise<void>,
  progress: (bytes: number, completed: number, total: number) => void, signal: AbortSignal): Promise<void> {
  // A new EXT-X-KEY can rotate key material at the same URL. Cache per tag,
  // sharing only among segments to which that exact tag applies.
  const keys = new Map<HlsKey, Buffer>();
  let received = 0, completed = 0;
  const parts = media.init ? [media.init, ...media.parts] : media.parts;
  for (const part of parts) {
    signal.throwIfAborted();
    let { bytes } = await fetch(part.url, HLS_SEGMENT_LIMIT, part.range);
    if (part.key) {
      let key = keys.get(part.key);
      if (!key) {
        key = (await fetch(part.key.url, 16)).bytes;
        if (keys.size >= 32) keys.delete(keys.keys().next().value!);
        keys.set(part.key, key);
      }
      bytes = decryptHlsPart(bytes, key, part);
    }
    signal.throwIfAborted();
    if (!bytes.length) throw new Error("The server returned an empty media segment.");
    // Do not save a login page, an error document, or an AAC-only stream as video.
    const mp4Boxes = completed ? ['styp', 'moof', 'sidx', 'emsg', 'prft'] : ['ftyp'];
    if (media.init ? !mp4Boxes.includes(bytes.toString('ascii', 4, 8)) : !isTransportStream(bytes)) {
      throw new Error("This stream is not MPEG-TS or fragmented MP4, or access has expired.");
    }
    received += bytes.length;
    if (received > 64 * 1024 ** 3) throw new Error("This stream exceeds the 64 GiB download limit.");
    await write(bytes);
    progress(received, ++completed, parts.length);
  }
}
