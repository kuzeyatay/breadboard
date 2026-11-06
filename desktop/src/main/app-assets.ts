import { protocol, type Session } from "electron";
import { randomUUID } from "node:crypto";
import { artifactPreviewUrl, readArtifactPreview } from "./artifact-preview-transport";
import { forwardVoiceRequest, voiceRequestUrl } from "./voice-transport";
import { appStreamUrl, forwardAppStream } from "./app-stream-transport";
import { BoundedWorkQueue } from "./bounded-work-queue";

const SCHEME = "breadboard-assets";
const PREFIX = "/_next/static/";
const PUBLIC_IMAGES = new Set(["/logo.png", "/breadboard-favicon-20260426.ico", "/breadboard-icon-20260426.png", "/breadboard-apple-icon-20260426.png"]);
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
type Asset = { status: number; headers: [string, string][]; bytes: ArrayBuffer };
class AssetTooLarge extends Error {}

/** Register before app readiness. Public build assets keep normal CORS/CSP. */
export function registerAppAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
  } }]);
}

export function appAssetUrl(value: string, dashboardUrl: string | null): URL | null {
  if (!dashboardUrl) return null;
  try {
    const base = new URL(dashboardUrl);
    const url = new URL(value);
    if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
        base.username || base.password || url.origin !== base.origin || url.username || url.password ||
        (!url.pathname.startsWith(PREFIX) && !PUBLIC_IMAGES.has(url.pathname)) || /%2f|%5c|%2e/i.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}

/** A completed immutable asset can be shared; an interrupted renderer cannot
 * leave a Chromium disk-cache write locked or occupy a live API connection. */
export function createAppAssetLoader(fetchAsset: typeof fetch = fetch) {
  const cache = new Map<string, Asset>();
  const pending = new Map<string, Promise<Asset>>();
  // Recovery can reopen dozens of documents, each with dozens of chunks. The
  // runtime has a bounded request pool; deduplication alone does not bound the
  // number of *different* assets competing with page and API requests.
  const downloads = new BoundedWorkQueue(4);
  let bytes = 0;
  return async (url: string): Promise<Asset> => {
    const cached = cache.get(url);
    if (cached) { cache.delete(url); cache.set(url, cached); return cached; }
    const existing = pending.get(url);
    if (existing) return existing;
    const read = async (): Promise<Asset> => {
      // No cookies/authorization, redirects, or caller-selected host. These
      // are the same public Next assets authenticated pages already include.
      const response = await fetchAsset(url, { redirect: "error",
        headers: { "Accept-Encoding": "identity" }, signal: AbortSignal.timeout(15_000) });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        if (reader) for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_ASSET_BYTES) { await reader.cancel(); throw new AssetTooLarge("App asset is too large"); }
          chunks.push(chunk.value);
        }
      } finally { reader?.releaseLock(); }
      const headers = new Headers(response.headers);
      // fetch decodes compressed bodies. Do not describe the decoded bytes as
      // still compressed or copy server cookie headers into the asset origin.
      for (const name of ["content-encoding", "content-length", "transfer-encoding", "set-cookie"]) headers.delete(name);
      headers.set("Access-Control-Allow-Origin", "*");
      const data = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      const entries: [string, string][] = [];
      headers.forEach((value, name) => entries.push([name, value]));
      const asset: Asset = { status: response.status, headers: entries, bytes: data.buffer };
      if (response.ok && /\bimmutable\b/i.test(headers.get("cache-control") ?? "")) {
        while (bytes + size > MAX_CACHE_BYTES && cache.size) {
          const oldest = cache.keys().next().value!;
          bytes -= cache.get(oldest)!.bytes.byteLength; cache.delete(oldest);
        }
        cache.set(url, asset); bytes += size;
      }
      return asset;
    };
    // Keep transient failures inside the shared request. Returning the first
    // timeout as a 502 poisons Next's chunk promise in every waiting renderer;
    // a healthy server afterwards cannot repair that document's hydration.
    const request = (async () => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const asset = await downloads.run(read);
          if (attempt >= 2 || ![408, 429, 500, 502, 503, 504].includes(asset.status)) return asset;
        } catch (error) {
          if (attempt >= 2 || error instanceof AssetTooLarge) throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
      }
    })();
    pending.set(url, request);
    try { return await request; } finally { pending.delete(url); }
  };
}

/** Public assets and authenticated image previews must not wait behind the
 * app's long-lived streams in Chromium's six HTTP/1 connections. */
export function installAppAssetTransport(target: Session, dashboardUrl: () => string | null): void {
  const load = createAppAssetLoader();
  const imageReads = new Map<string, { url: string; expires: number }>();
  const voiceRequests = new Map<string, { url: string; method: string; expires: number }>();
  const streamRequests = new Map<string, { url: string; method: string; expires: number }>();
  target.protocol.handle(SCHEME, async request => {
    try {
      const asset = new URL(request.url);
      const slash = asset.pathname.indexOf("/", 1);
      const origin = decodeURIComponent(asset.pathname.slice(1, slash));
      if (asset.hostname === "stream") {
        const token = asset.searchParams.get("__bb_stream");
        const authorized = token ? streamRequests.get(token) : undefined;
        if (token) streamRequests.delete(token);
        asset.searchParams.delete("__bb_stream");
        const stream = appStreamUrl(origin + asset.pathname.slice(slash) + asset.search, dashboardUrl(), request.method);
        if (slash < 0 || !stream || !authorized || authorized.expires < Date.now() ||
            authorized.url !== stream.href || authorized.method !== request.method) {
          return new Response("Not found", { status: 404 });
        }
        return await forwardAppStream(stream, request, target);
      }
      if (asset.hostname === "voice") {
        const token = asset.searchParams.get("__bb_voice");
        const authorized = token ? voiceRequests.get(token) : undefined;
        if (token) voiceRequests.delete(token);
        asset.searchParams.delete("__bb_voice");
        const voice = voiceRequestUrl(origin + asset.pathname.slice(slash) + asset.search, dashboardUrl(), request.method);
        if (slash < 0 || !voice || !authorized || authorized.expires < Date.now() ||
            authorized.url !== voice.href || authorized.method !== request.method) {
          return new Response("Not found", { status: 404 });
        }
        return await forwardVoiceRequest(voice, request, target);
      }
      if (asset.hostname === "image") {
        const token = asset.searchParams.get("__bb_preview");
        const authorized = token ? imageReads.get(token) : undefined;
        if (token) imageReads.delete(token);
        asset.searchParams.delete("__bb_preview");
        const image = artifactPreviewUrl(origin + asset.pathname.slice(slash) + asset.search, dashboardUrl());
        // Electron's internal redirect does not carry Origin/Referer. The
        // one-use capability below is issued only for the trusted app frame.
        if (slash < 0 || !image || request.method !== "GET" || !authorized ||
            authorized.expires < Date.now() || authorized.url !== image.href) {
          return new Response("Not found", { status: 404 });
        }
        return await readArtifactPreview(image, target, request.signal);
      }
      const url = appAssetUrl(origin + asset.pathname.slice(slash) + asset.search, dashboardUrl());
      if (asset.hostname !== "app" || slash < 0 || !url || !["GET", "HEAD"].includes(request.method)) {
        return new Response("Not found", { status: 404 });
      }
      const result = await load(url.href);
      const noBody = request.method === "HEAD" || [204, 205, 304].includes(result.status);
      return new Response(noBody ? null : result.bytes, { status: result.status, headers: result.headers });
    } catch {
      if (new URL(request.url).hostname === "voice") {
        const origin = dashboardUrl();
        return Response.json({ error: "Breadboard lost its connection to speech. Try again." }, {
          status: 502, headers: origin ? { "Access-Control-Allow-Origin": new URL(origin).origin } : {},
        });
      }
      return new Response("App asset unavailable", { status: 502 });
    }
  });
  target.webRequest.onBeforeRequest({ urls: ["http://*/*"] }, (details, callback) => {
    const stream = ["xhr", "other"].includes(details.resourceType)
      ? appStreamUrl(details.url, dashboardUrl(), details.method) : null;
    let trustedStream = false;
    try { trustedStream = Boolean(stream && details.frame && new URL(details.frame.url).origin === stream.origin); } catch { /* detached frame */ }
    if (stream && trustedStream) {
      const token = randomUUID();
      for (const [key, value] of streamRequests) if (value.expires < Date.now()) streamRequests.delete(key);
      if (streamRequests.size >= 256) streamRequests.delete(streamRequests.keys().next().value!);
      streamRequests.set(token, { url: stream.href, method: details.method, expires: Date.now() + 30_000 });
      const redirect = new URL(`${SCHEME}://stream/${encodeURIComponent(stream.origin)}${stream.pathname}${stream.search}`);
      redirect.searchParams.set("__bb_stream", token);
      callback({ redirectURL: redirect.href });
      return;
    }
    const voice = details.resourceType === "xhr" ? voiceRequestUrl(details.url, dashboardUrl(), details.method) : null;
    let trustedVoice = false;
    try { trustedVoice = Boolean(voice && details.frame && new URL(details.frame.url).origin === voice.origin); } catch { /* detached frame */ }
    if (voice && trustedVoice) {
      const token = randomUUID();
      for (const [key, value] of voiceRequests) if (value.expires < Date.now()) voiceRequests.delete(key);
      if (voiceRequests.size >= 256) voiceRequests.delete(voiceRequests.keys().next().value!);
      voiceRequests.set(token, { url: voice.href, method: details.method, expires: Date.now() + 30_000 });
      const redirect = new URL(`${SCHEME}://voice/${encodeURIComponent(voice.origin)}${voice.pathname}${voice.search}`);
      redirect.searchParams.set("__bb_voice", token);
      callback({ redirectURL: redirect.href });
      return;
    }
    const preview = details.method === "GET" && details.resourceType === "xhr"
      ? artifactPreviewUrl(details.url, dashboardUrl()) : null;
    let trusted = false;
    try { trusted = Boolean(preview && details.frame && new URL(details.frame.url).origin === preview.origin); } catch { /* detached frame */ }
    if (preview && trusted) {
      const token = randomUUID();
      for (const [key, value] of imageReads) if (value.expires < Date.now()) imageReads.delete(key);
      if (imageReads.size >= 256) imageReads.delete(imageReads.keys().next().value!);
      imageReads.set(token, { url: preview.href, expires: Date.now() + 30_000 });
      const redirect = new URL(`${SCHEME}://image/${encodeURIComponent(preview.origin)}${preview.pathname}${preview.search}`);
      redirect.searchParams.set("__bb_preview", token);
      callback({ redirectURL: redirect.href });
      return;
    }
    const url = appAssetUrl(details.url, dashboardUrl());
    callback(url && ["GET", "HEAD"].includes(details.method)
      ? { redirectURL: `${SCHEME}://app/${encodeURIComponent(url.origin)}${url.pathname}${url.search}` }
      : {});
  });
}
