import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { net, type Session, type WebContents } from "electron";
import type { BrowserHlsStream } from "../shared/ipc-contract";
import type { BrowserDownloads } from "./browser-downloads";
import type { DownloadSettings } from "./download-settings";
import { browserSourceDestination } from "./browser-source-download";
import { hlsUrl, isHlsResponse, resolveHlsMedia, writeHlsMedia, type HlsFetch, type HlsRange } from "./browser-hls-playlist";

interface Stream extends BrowserHlsStream { url: string; headers: Record<string, string>; pageUrl: string }
interface Page { contents: WebContents; streams: Map<string, Stream>; generation: number }
class HlsRequestError extends Error {
  constructor(message: string, readonly retryable = true) { super(message); }
}
const MAX_STREAMS = 24;
const MAX_TRANSFERS = 2;

export function hlsFilename(title: string, extension: string): string {
  let stem = title.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 140) || 'video';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  return `${stem}.${extension}`;
}

/** Chromium supplies cookies per destination; captured headers never leave main. */
export function fetchHlsResource(session: Session, originalUrl: string, headers: Record<string, string>,
  signal: AbortSignal): HlsFetch {
  return async (input, limit, range) => {
    let url = hlsUrl(input);
    for (let hop = 0; hop < 6; hop++) {
      signal.throwIfAborted();
      // A remote playlist cannot turn the downloader into a local network reader.
      await browserSourceDestination(url, originalUrl, true);
      signal.throwIfAborted();
      const requestHeaders = { ...headers };
      if (new URL(url).origin !== new URL(originalUrl).origin) delete requestHeaders.authorization;
      if (range) requestHeaders.range = `bytes=${range.offset}-${range.offset + range.length - 1}`;
      let result: Awaited<ReturnType<typeof requestHls>> | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { result = await requestHls(session, url, requestHeaders, range, limit, signal); break; }
        catch (error) {
          if (signal.aborted || !(error instanceof HlsRequestError) || !error.retryable || attempt === 2) throw error;
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 300 * (attempt + 1));
            const abort = () => { clearTimeout(timer); reject(new Error('Download cancelled.')); };
            signal.addEventListener('abort', abort, { once: true });
          });
        }
      }
      if (!result) throw new Error('The stream request failed.');
      if ('redirect' in result) { url = hlsUrl(result.redirect, url); continue; }
      return { bytes: result.bytes, url };
    }
    throw new Error("The stream redirected too many times.");
  };
}

function requestHls(session: Session, url: string, headers: Record<string, string>, range: HlsRange | undefined,
  limit: number, signal: AbortSignal): Promise<{ bytes: Buffer } | { redirect: string }> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = net.request({ session, url, method: 'GET', redirect: 'manual', credentials: 'include', headers });
    let settled = false;
    const timer = setTimeout(() => fail(new HlsRequestError("The stream server took too long to respond. Try again.")), 45_000);
    const cleanup = () => { settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const fail = (error: Error) => { if (settled) return; cleanup(); reject(error); request.abort(); };
    const abort = () => fail(new Error("Download cancelled."));
    signal.addEventListener('abort', abort, { once: true });
    request.on('error', () => fail(new HlsRequestError("The stream connection failed. Check that the video still plays and try again.")));
    request.on('login', (_info, callback) => callback());
    request.on('redirect', (_status, _method, redirect) => {
      if (settled) return;
      cleanup(); resolve({ redirect }); request.abort();
    });
    request.on('response', response => {
      response.on('error', () => fail(new HlsRequestError("The stream connection was interrupted.")));
      response.on('aborted', () => fail(new HlsRequestError("The stream connection was interrupted.")));
      if (settled) return;
      const header = (name: string) => { const value = response.headers[name]; return Array.isArray(value) ? value[0] : value; };
      if (response.statusCode < 200 || response.statusCode >= 300) {
        fail(new HlsRequestError(`The stream server returned HTTP ${response.statusCode}. Check that the video still plays.`, response.statusCode >= 500 || response.statusCode === 429)); return;
      }
      if (range && (response.statusCode !== 206 || !new RegExp(`^bytes ${range.offset}-${range.offset + range.length - 1}/`).test(header('content-range') ?? ''))) {
        fail(new Error("The stream server did not return the requested media byte range.")); return;
      }
      if (Number(header('content-length')) > limit) { fail(new Error("A media segment exceeds the download size limit.")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', chunk => {
        if (settled) return;
        size += chunk.length;
        if (size > limit) { fail(new Error("A media segment exceeds the download size limit.")); return; }
        chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => {
        if (settled) return;
        if (range && size !== range.length) { fail(new Error("The server returned an incomplete media byte range.")); return; }
        const expected = Number(header('content-length'));
        if (expected > 0 && !header('content-encoding') && size !== expected) { fail(new Error("The server returned an incomplete media segment.")); return; }
        cleanup(); resolve({ bytes: Buffer.concat(chunks, size) });
      });
    });
    request.end();
  });
}

/** Passive per-page discovery plus user-initiated native downloads. No extension package or subprocess. */
export class BrowserHlsDownloads {
  private readonly pages = new Map<number, Page>();
  private readonly sessions = new WeakSet<Session>();
  private readonly active = new Set<AbortController>();
  constructor(private readonly downloads: BrowserDownloads | undefined, private readonly settings: DownloadSettings | undefined,
    private readonly changed: () => void) {}

  attach(contents: WebContents): void {
    if (this.pages.has(contents.id)) return;
    const page: Page = { contents, streams: new Map(), generation: 0 };
    this.pages.set(contents.id, page);
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (!mainFrame || inPlace) return;
      page.generation++; page.streams.clear(); this.changed();
    });
    contents.once('destroyed', () => { this.pages.delete(contents.id); });
    const session = contents.session;
    if (this.sessions.has(session)) return;
    this.sessions.add(session);
    const pending = new Map<number, { owner: number; generation: number; headers: Record<string, string> }>();
    // Electron allows one listener per phase. Leave the ad blocker and PDF hooks alone.
    session.webRequest.onSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, details => {
      const owner = details.webContentsId, page = owner === undefined ? undefined : this.pages.get(owner);
      if (!page || owner === undefined) return;
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(details.requestHeaders)) {
        if (['referer', 'origin', 'user-agent', 'authorization'].includes(name.toLowerCase()) && typeof value === 'string' && value.length <= 16_384) headers[name.toLowerCase()] = value;
      }
      if (pending.size >= 512) pending.delete(pending.keys().next().value!);
      pending.set(details.id, { owner, generation: page.generation, headers });
    });
    session.webRequest.onResponseStarted({ urls: ['http://*/*', 'https://*/*'] }, details => {
      const request = pending.get(details.id);
      pending.delete(details.id);
      // Disk-cache hits may skip the outgoing-header phase. Keep those detectable
      // without borrowing credentials from a different document or browser tab.
      const owner = request?.owner ?? (details.fromCache ? details.webContentsId : undefined);
      const page = owner === undefined ? undefined : this.pages.get(owner);
      if (!page || details.frame === null || (request && page.generation !== request.generation) || details.statusCode < 200 || details.statusCode >= 300) return;
      const mime = Object.entries(details.responseHeaders ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.[0] ?? '';
      if (!isHlsResponse(details.url, mime)) return;
      let url: string;
      try { url = hlsUrl(details.url); } catch { return; }
      const existing = page.streams.get(url);
      const headers = request?.headers ?? existing?.headers ?? { referer: details.referrer, 'user-agent': page.contents.getUserAgent() };
      if (existing) {
        existing.headers = headers;
        existing.pageUrl = page.contents.getURL();
        if (existing.state === 'error') { existing.state = 'detected'; delete existing.error; this.changed(); }
        return;
      }
      if (page.streams.size >= MAX_STREAMS) return;
      const parsed = new URL(url);
      let label = parsed.pathname.split('/').pop() || 'HLS stream';
      try { label = decodeURIComponent(label); } catch { /* Keep the encoded display name. */ }
      page.streams.set(url, { id: randomUUID(), url, headers, pageUrl: page.contents.getURL(),
        label: label.slice(0, 120), host: parsed.hostname, state: 'detected' });
      this.changed();
    });
    session.webRequest.onErrorOccurred(details => { pending.delete(details.id); });
    session.webRequest.onCompleted(details => { pending.delete(details.id); });
  }

  snapshot(contents?: WebContents): { streams: BrowserHlsStream[]; available: boolean } {
    const streams = contents ? this.pages.get(contents.id)?.streams.values() : undefined;
    return { available: Boolean(this.downloads && this.settings), streams: streams ? [...streams].map(({ id, label, host, state, error }) => ({ id, label, host, state, error })) : [] };
  }

  async start(contents: WebContents, id: string, choose: (defaultPath: string) => Promise<string | null>): Promise<boolean> {
    const page = this.pages.get(contents.id);
    const stream = page && [...page.streams.values()].find(item => item.id === id);
    if (!stream || !this.downloads || !this.settings || ['preparing', 'downloading'].includes(stream.state)) return false;
    if (this.active.size >= MAX_TRANSFERS) {
      stream.state = 'error'; stream.error = 'Two streams are already downloading. Wait for one to finish.'; this.changed(); return true;
    }
    const controller = new AbortController();
    this.active.add(controller);
    const generation = page!.generation;
    const title = contents.getTitle() || stream.label;
    const fetch = fetchHlsResource(contents.session, stream.url, stream.headers, controller.signal);
    const download = this.downloads.startNative(hlsFilename(title, 'ts').slice(0, -3), stream.pageUrl, () => controller.abort());
    stream.state = 'preparing'; delete stream.error; this.changed();
    let temporary: string | undefined;
    const cleanup = async () => {
      if (temporary) await fs.unlink(temporary).catch(() => {});
      this.active.delete(controller);
      this.changed();
    };
    try {
      const media = await resolveHlsMedia(stream.url, fetch);
      controller.signal.throwIfAborted();
      // A stale popup must not open a picker for the next page.
      if (contents.isDestroyed() || page!.generation !== generation) { controller.abort(); controller.signal.throwIfAborted(); }
      const filename = hlsFilename(title, media.extension), settings = this.settings.read();
      download.rename(filename);
      const selected = settings.askWhereToSave ? await choose(path.join(settings.directory, filename)) : undefined;
      if (selected === null) { controller.abort(); throw new Error('Download cancelled.'); }
      controller.signal.throwIfAborted();
      if (selected !== undefined && !path.isAbsolute(selected)) throw new Error('Invalid download destination.');
      const directory = selected ? path.dirname(selected) : settings.directory;
      await fs.mkdir(directory, { recursive: true });
      temporary = path.join(directory, `.breadboard-hls-${randomUUID()}.part`);
      const file = await fs.open(temporary, 'wx', 0o600);
      stream.state = 'downloading'; this.changed();
      // Resolve the command once the picker has finished. Progress continues in Downloads.
      void (async () => {
        try {
          try {
            await writeHlsMedia(media, fetch, bytes => file.writeFile(bytes), download.progress, controller.signal);
            await file.sync();
          } finally { await file.close(); }
          controller.signal.throwIfAborted();
          const destination = await publishHlsFile(temporary!, directory, filename, selected);
          temporary = undefined;
          download.finish('completed', destination);
          stream.state = 'completed';
        } catch (error) { failed(error); }
        finally { await cleanup(); }
      })();
      return true;
    } catch (error) { failed(error); await cleanup(); return true; }

    function failed(error: unknown) {
      const cancelled = controller.signal.aborted;
      stream!.state = cancelled ? 'detected' : 'error';
      const code = (error as NodeJS.ErrnoException)?.code;
      stream!.error = cancelled ? undefined : code === 'ENOSPC' ? 'There is not enough disk space to save this video.'
        : ['EACCES', 'EPERM', 'ENOENT', 'EROFS', 'ENAMETOOLONG'].includes(code ?? '') ? 'Could not save the video. Check your download folder and try again.'
        : error instanceof Error ? error.message.slice(0, 2_048) : 'Could not save this stream.';
      download.finish(cancelled ? 'cancelled' : 'interrupted', '', stream!.error);
    }
  }
}

async function publishHlsFile(temporary: string, directory: string, filename: string, selected?: string): Promise<string> {
  if (selected) { await fs.rename(temporary, selected); return selected; }
  const ext = path.extname(filename), stem = filename.slice(0, -ext.length);
  for (let suffix = 0; suffix < 10_000; suffix++) {
    const destination = path.join(directory, suffix ? `${stem} (${suffix})${ext}` : filename);
    try {
      // Publish atomically on normal drives, with an exclusive copy fallback for FAT.
      try { await fs.link(temporary, destination); }
      catch (error) {
        if (!['ENOTSUP', 'EPERM', 'EXDEV', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await fs.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
    await fs.unlink(temporary).catch(() => {});
    return destination;
  }
  throw new Error('No unused download filename is available.');
}
