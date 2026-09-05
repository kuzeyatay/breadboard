import { createHash } from "node:crypto";
import { assertPublicHost, downloadPdf } from "../get-doc/download.ts";
import { SUPPORTED_AUDIO_EXTENSIONS, SUPPORTED_VIDEO_EXTENSIONS } from "../scriberr/paths.ts";
import { publicSourceUrl, sourceKind, youtubeSourceUrl, type GardenSourceKind } from "./garden-source-discovery.ts";

export interface GardenSourceImportContext {
  userId: number;
  clusterId: number;
  clusterSlug: string;
  contentPath: string;
}

/** Fetch direct media only; playlists, players, and podcast landing pages are not media files. */
export async function downloadGardenMedia(rawUrl: string, kind: "audio" | "video", maxBytes: number) {
  let url = publicSourceUrl(rawUrl);
  const signal = AbortSignal.timeout(90_000);
  for (let hop = 0; hop <= 5; hop++) {
    await assertPublicHost(url.hostname);
    const response = await fetch(url, { redirect: "manual", signal, cache: "no-store" });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Media redirect has no destination.");
      url = publicSourceUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Media download returned ${response.status}.`); }
    const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    const extension = /\.([a-z0-9]+)$/i.exec(url.pathname)?.[1]?.toLowerCase();
    const extensions = (kind === "audio" ? SUPPORTED_AUDIO_EXTENSIONS : SUPPORTED_VIDEO_EXTENSIONS).map((ext) => ext.slice(1));
    const mimeExtensions: Record<string, string> = {
      "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/x-wav": "wav",
      "audio/ogg": "ogg", "audio/flac": "flac", "audio/aac": "aac", "audio/opus": "ogg",
      "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-matroska": "mkv",
    };
    const ext = extension && extensions.includes(extension) ? extension : mimeExtensions[mime];
    if (!ext || !extensions.includes(ext) || (!mime.startsWith(`${kind}/`) && mime !== "application/octet-stream")) {
      await response.body?.cancel();
      throw new Error(`This URL is not a downloadable ${kind} file. Use a direct media URL${kind === "video" ? " or a YouTube video URL" : ""}.`);
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel(); throw new Error("Media file exceeds the Garden upload limit.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Media download returned no file.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error("Media file exceeds the Garden upload limit.");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const buffer = Buffer.concat(chunks);
    if (!buffer.length || /^\s*(?:<!doctype|<html)/i.test(buffer.subarray(0, 100).toString())) throw new Error("The source returned an empty file or an HTML page.");
    return { buffer, extension: ext, mime, finalUrl: url.href };
  }
  throw new Error("Too many media redirects.");
}

async function importPdf(context: GardenSourceImportContext, url: string, title: string) {
  const downloaded = await downloadPdf(url);
  const { reserveRuntimeJobInput, uploadRuntimeJobInput, abandonRuntimeJobInput, submitRuntimeJob, lookupRuntimeJobByIdempotencyKey, RuntimeJobControlError } = await import("../supervisor-control.ts");
  const { selectedModelForUser } = await import("../selected-model.ts");
  const { localChatmockBaseUrl } = await import("../chatmock-server.ts");
  const authority = { userId: context.userId, gardenId: context.clusterSlug, conversationId: null };
  const digest = createHash("sha256").update(downloaded.buffer).digest("hex");
  let idempotencyKey = `garden-source-${digest}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await lookupRuntimeJobByIdempotencyKey(authority, idempotencyKey).catch((error) => {
      if (error instanceof RuntimeJobControlError && ["JOB_NOT_FOUND", "RUNTIME_JOB_NOT_FOUND"].includes(error.code)) return null;
      throw error;
    });
    if (!existing) break;
    if (existing.state === "uncertain") throw new Error("The previous PDF import has an uncertain outcome. Check its process status before retrying.");
    if (["failed", "cancelled", "interrupted", "resource_exhausted"].includes(existing.state)) {
      if (attempt === 4) throw new Error(`The PDF import repeatedly failed: ${existing.failureMessage ?? existing.state}`);
      idempotencyKey = `garden-source-${digest}-retry-${attempt + 1}`;
      continue;
    }
    return { status: existing.state, duplicate: true, jobId: existing.jobId, url, processing: existing.state !== "succeeded" };
  }
  const reservation = await reserveRuntimeJobInput(authority, {
    gardenId: context.clusterSlug, conversationId: null,
    displayName: `${title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 70) || "source"}-${digest.slice(0, 10)}.pdf`,
    mediaType: "application/pdf", declaredSizeBytes: downloaded.buffer.length,
  });
  try {
    const staged = await uploadRuntimeJobInput(authority, reservation, new Blob([new Uint8Array(downloaded.buffer)]).stream());
    const job = await submitRuntimeJob(authority, {
      jobType: "document-ingestion", idempotencyKey,
      inputUploads: [{ uploadId: staged.uploadId }],
      requestPayload: {
        sourceLabel: url.length <= 256 ? url : title.slice(0, 60), isHandwriting: false, parseWithVlm: false,
        parseWithAnydoc: false, vlmTask: "doc_parse", generateMap: true,
        model: selectedModelForUser(context.userId), chatmockBaseUrl: localChatmockBaseUrl(),
        maximumUploadBytes: 64 * 1024 * 1024,
      },
    });
    return { status: job.state, jobId: job.jobId, url, title, processing: true };
  } catch (error) {
    await abandonRuntimeJobInput(authority, reservation.uploadId).catch(() => {});
    throw error;
  }
}

async function importMedia(context: GardenSourceImportContext, url: string, kind: "audio" | "video", title: string) {
  const [{ videoTranscriptionRouteDeps }, { handleCreateVideoTranscription }] = await Promise.all([
    import("../scriberr/instance.ts"), import("../scriberr/route-core.ts"),
  ]);
  const deps = videoTranscriptionRouteDeps();
  // executeGardenTool has already checked the capability and ownership. The
  // shared ingestion core still enforces queue, duration, format and dedup rules.
  deps.requireOwnedGarden = async (gardenId) => {
    if (gardenId !== context.clusterSlug) throw new Error("Garden scope mismatch.");
    return { userId: context.userId, clusterId: context.clusterId, clusterSlug: context.clusterSlug };
  };
  const youtube = kind === "video" ? youtubeSourceUrl(url) : null;
  let request: Request;
  if (youtube) {
    request = new Request("http://breadboard.internal/media", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ youtubeUrl: youtube }) });
  } else {
    const media = await downloadGardenMedia(url, kind, Math.min(deps.config.maxUploadBytes, 128 * 1024 * 1024));
    const form = new FormData();
    const filename = `${title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 100) || "source"}.${media.extension}`;
    form.set("media", new File([new Uint8Array(media.buffer)], filename, { type: media.mime }));
    request = new Request("http://breadboard.internal/media", { method: "POST", body: form });
  }
  const result = await handleCreateVideoTranscription(deps, context.clusterSlug, request);
  if (result.status >= 400) throw new Error(String(result.body.error ?? "Media import failed."));
  const job = result.body.job as { status?: string } | undefined;
  return { ...result.body, url, processing: Boolean(job && job.status !== "completed") };
}

export interface GardenSourceImportDependencies {
  assertHost(host: string): Promise<void>;
  link(context: GardenSourceImportContext, url: string, title: string): Promise<unknown>;
  pdf(context: GardenSourceImportContext, url: string, title: string): Promise<unknown>;
  media(context: GardenSourceImportContext, url: string, kind: "audio" | "video", title: string): Promise<unknown>;
}

const dependencies: GardenSourceImportDependencies = {
  assertHost: assertPublicHost,
  pdf: importPdf, media: importMedia,
  link: async (context, url, title) => {
    const [{ importGardenLink }, { localChatmockBaseUrl }] = await Promise.all([
      import("../garden-link-import.ts"), import("../chatmock-server.ts"),
    ]);
    return { status: "completed", ...await importGardenLink({
      contentPath: context.contentPath, cluster: { slug: context.clusterSlug },
      userId: context.userId, baseURL: localChatmockBaseUrl(), url, title,
    }) };
  },
};

export async function importGardenSource(context: GardenSourceImportContext, args: Record<string, unknown>, deps = dependencies) {
  const kind: GardenSourceKind = sourceKind(args.kind);
  const url = publicSourceUrl(args.url);
  await deps.assertHost(url.hostname);
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim().slice(0, 180) : url.hostname;
  if (kind === "pdf") return deps.pdf(context, url.href, title);
  if (kind === "link") return deps.link(context, url.href, title);
  return deps.media(context, url.href, kind, title);
}
