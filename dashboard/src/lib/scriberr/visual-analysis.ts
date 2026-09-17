// "Watch"-style analysis for a garden video source.
//
// The transcription worker writes the transcript source and hands a job with
// `analysis: "watch"` to the dashboard in status `analyzing_visuals`. Here the
// checked-in Watch runtime (captions + sampled frames + a frame-grounded
// ChatMock reading, the same path the /watch skill uses) runs against the
// video; the sampled frames are saved beside the garden's other page
// snapshots (`/<garden>/assets/<source>-page-NNN.png`, so Learn's source-visual
// scan reads them like PDF pages) and the analysis is appended to the source
// note under "What the video shows". A job that does not keep its media has
// nothing left on disk afterwards: YouTube media only ever existed inside the
// Watch runtime's work directory, and an upload's temp file is removed here.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { NormalizedTranscript, VideoTranscriptionJob } from "./types.ts";
import type { VideoTranscriptionJobStore } from "./job-store.ts";
import { formatTimestamp } from "./transcript-markdown.ts";
import { removePathWithRetries } from "./paths.ts";

export const VISUAL_ANALYSIS_QUESTION =
  "This is a lecture recording that will become study material. Using both the transcript and the frames, describe everything the video shows that a reader of the transcript alone would miss: every slide, diagram, equation, derivation step, table, plot, and board sketch, with its timestamp, what it depicts, and how it connects to what is being said at that moment. Quote equations exactly. Be exhaustive and ordered by time.";

/** Sampled frames kept per source; Learn treats each as a page snapshot. */
export const MAX_SOURCE_FRAMES = 24;

export interface WatchRunLike {
  report: string;
  framePaths: Array<{ path: string; timestamp: string }>;
  chatmockAnalysis?: string;
  chatmockWarning?: string;
}

export interface VisualAnalysisDeps {
  store: VideoTranscriptionJobStore;
  contentPath: string;
  ffmpegPath: string;
  runWatch(input: { userId: number; jobId: string; source: string; workspaceRoot: string }): Promise<WatchRunLike>;
  publish(reason: string, gardenSlug: string): Promise<void>;
  log?(message: string): void;
}

const inFlight = new Set<string>();

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function timestampSeconds(value: string): number {
  const parts = value.split(":").map((part) => Number.parseFloat(part));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function evenlySample<T>(items: readonly T[], maximum: number): T[] {
  if (items.length <= maximum) return [...items];
  return Array.from({ length: maximum }, (_, index) =>
    items[Math.round((index * (items.length - 1)) / (maximum - 1))]);
}

/** Transcript said around a frame, for the frame's page text. */
export function transcriptWindow(
  transcript: NormalizedTranscript | null,
  seconds: number,
  halfWindowSeconds = 45,
): string {
  if (!transcript) return "";
  return transcript.segments
    .filter((segment) => segment.endSeconds >= seconds - halfWindowSeconds && segment.startSeconds <= seconds + halfWindowSeconds)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
}

function convertToPng(ffmpegPath: string, input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-y", "-loglevel", "error", "-i", input, "-frames:v", "1", output], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(output)) resolve();
      else reject(new Error(`ffmpeg could not convert a frame (${code}): ${stderr.slice(0, 300)}`));
    });
  });
}

/** Save sampled frames as the source's page snapshots. Returns their public URLs in time order. */
export async function saveFramesAsPageSnapshots(input: {
  contentPath: string;
  gardenSlug: string;
  sourceSlug: string;
  ffmpegPath: string;
  frames: ReadonlyArray<{ path: string; timestamp: string }>;
}): Promise<Array<{ url: string; timestamp: string; seconds: number }>> {
  const assetDir = path.join(input.contentPath, input.gardenSlug, "assets");
  fs.mkdirSync(assetDir, { recursive: true });
  const sourceAssetId = slugify(input.sourceSlug) || "video";
  const saved: Array<{ url: string; timestamp: string; seconds: number }> = [];
  let pageNumber = 0;
  for (const frame of input.frames) {
    if (!fs.existsSync(frame.path)) continue;
    pageNumber += 1;
    const fileName = `${sourceAssetId}-page-${String(pageNumber).padStart(3, "0")}.png`;
    const target = path.join(assetDir, fileName);
    if (/\.png$/i.test(frame.path)) fs.copyFileSync(frame.path, target);
    else await convertToPng(input.ffmpegPath, frame.path, target);
    saved.push({
      url: `/${input.gardenSlug}/assets/${fileName}`,
      timestamp: frame.timestamp,
      seconds: timestampSeconds(frame.timestamp),
    });
  }
  return saved;
}

/** Add the frames and analysis to the transcript source note. */
export function augmentSourceMarkdown(input: {
  markdown: string;
  analysis: string;
  frames: ReadonlyArray<{ url: string; timestamp: string; seconds: number }>;
  transcript: NormalizedTranscript | null;
}): string {
  const { markdown } = input;
  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  let head = "";
  let body = markdown;
  if (frontmatterMatch) {
    head = frontmatterMatch[0];
    body = markdown.slice(head.length);
    const urls = input.frames.map((frame) => JSON.stringify(frame.url)).join(", ");
    const line = `source_images: [${urls}]`;
    head = /^source_images:.*$/m.test(head)
      ? head.replace(/^source_images:.*$/m, line)
      : head.replace(/\r?\n---\r?\n$/, `\n${line}\n---\n`);
  }
  const frameSections = input.frames.map((frame, index) => {
    const said = transcriptWindow(input.transcript, frame.seconds);
    return [
      `### Frame ${index + 1} (${formatTimestamp(frame.seconds)})`,
      "",
      `![Frame at ${formatTimestamp(frame.seconds)}](${frame.url})`,
      "",
      said ? `Said around this moment: ${said}` : "",
    ].filter((line, i, all) => !(line === "" && all[i - 1] === "")).join("\n");
  });
  const appended = [
    "",
    "## What the video shows",
    "",
    input.analysis.trim() || "_No frame analysis was produced._",
    "",
    "## Frames",
    "",
    frameSections.join("\n\n"),
    "",
  ].join("\n");
  return `${head}${body.replace(/\s+$/, "")}\n${appended}`;
}

async function runVisualAnalysisForJob(deps: VisualAnalysisDeps, job: VideoTranscriptionJob): Promise<void> {
  const sourceRelPath = job.outputRelativePath;
  const sourceSlug = job.sourceSlug;
  if (!sourceRelPath || !sourceSlug) {
    throw new Error("The transcript source is missing; nothing to analyze.");
  }
  const sourcePath = path.join(deps.contentPath, job.gardenId, sourceRelPath);
  if (!fs.existsSync(sourcePath)) throw new Error(`The transcript source is missing at ${sourceRelPath}.`);
  const source = job.inputKind === "youtube"
    ? (job.canonicalUrl ?? job.originalUrl ?? "")
    : (job.mediaTempPath ?? "");
  if (!source) throw new Error("The video is no longer available for analysis.");
  deps.store.transition(job.id, "analyzing_visuals", {
    currentStage: "Watching the video (frames + captions)",
    progressPercent: 96,
  });
  const workspaceRoot = job.inputKind === "youtube"
    ? path.join(deps.contentPath, job.gardenId)
    : path.dirname(source);
  const watched = await deps.runWatch({ userId: job.userId, jobId: job.id, source, workspaceRoot });
  deps.store.transition(job.id, "analyzing_visuals", {
    currentStage: "Saving frames and analysis",
    progressPercent: 98,
  });
  let transcript: NormalizedTranscript | null = null;
  try {
    transcript = job.transcriptJson ? (JSON.parse(job.transcriptJson) as NormalizedTranscript) : null;
  } catch {
    transcript = null;
  }
  const frames = await saveFramesAsPageSnapshots({
    contentPath: deps.contentPath,
    gardenSlug: job.gardenId,
    sourceSlug,
    ffmpegPath: deps.ffmpegPath,
    frames: evenlySample(watched.framePaths, MAX_SOURCE_FRAMES),
  });
  const analysis = watched.chatmockAnalysis?.trim()
    ? watched.chatmockAnalysis
    : `${watched.chatmockWarning ? `${watched.chatmockWarning}\n\n` : ""}${watched.report}`;
  const markdown = fs.readFileSync(sourcePath, "utf8");
  fs.writeFileSync(sourcePath, augmentSourceMarkdown({ markdown, analysis, frames, transcript }));
  await deps.publish(`video visual analysis for ${sourceSlug}`, job.gardenId);
}

async function discardTempMedia(deps: VisualAnalysisDeps, job: VideoTranscriptionJob): Promise<void> {
  if (!job.mediaTempPath) return;
  try {
    await removePathWithRetries(job.mediaTempPath, { root: path.dirname(path.dirname(job.mediaTempPath)) });
    await removePathWithRetries(path.dirname(job.mediaTempPath), { root: path.dirname(path.dirname(job.mediaTempPath)) });
  } catch (error) {
    deps.log?.(`temp media cleanup failed for ${job.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  deps.store.updateJob(job.id, { mediaTempPath: null });
}

/** Run the analysis for every garden job waiting on it, once each per process. */
export function kickPendingVisualAnalyses(deps: VisualAnalysisDeps, clusterId: number): void {
  const waiting = deps.store
    .listJobsForCluster(clusterId, { limit: 50, activeOnly: true })
    .filter((job) => job.status === "analyzing_visuals" && job.analysis === "watch" && !inFlight.has(job.id));
  for (const job of waiting) {
    inFlight.add(job.id);
    void (async () => {
      try {
        await runVisualAnalysisForJob(deps, job);
        deps.store.transition(job.id, "completed", {
          currentStage: "Complete",
          progressPercent: 100,
          errorCode: null,
          errorMessage: null,
        });
      } catch (error) {
        // The transcript source is already written and usable; the job
        // completes with the analysis failure recorded, never silently.
        const message = error instanceof Error ? error.message : String(error);
        deps.log?.(`visual analysis failed for ${job.id}: ${message}`);
        deps.store.transition(job.id, "completed", {
          currentStage: "Complete (visual analysis failed)",
          progressPercent: 100,
          errorCode: "visual_analysis_failed",
          errorMessage: `The transcript was saved, but analyzing what the video shows failed: ${message.slice(0, 400)}`,
        });
      } finally {
        await discardTempMedia(deps, deps.store.getJob(job.id) ?? job);
        inFlight.delete(job.id);
      }
    })();
  }
}
