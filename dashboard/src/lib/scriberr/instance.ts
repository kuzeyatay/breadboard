// Framework wiring only. The dashboard owns authentication and the durable
// browser projection; every finite tool/process boundary runs in Rust-owned
// Runtime V2 workers with no in-process fallback.

import fs from "node:fs";
import path from "node:path";
import db from "../db.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import {
  requireOwnedClusterFromSlug,
} from "../server-auth.ts";
import {
  abandonScriberrRuntimeUpload,
  cancelScriberrRuntimeJob,
  checkScriberrHealthViaRuntime,
  inspectScriberrYouTubeViaRuntime,
  reconcileScriberrRuntimeJobs,
  retryScriberrRuntimeJob,
  sealScriberrRuntimeUpload,
  startScriberrRuntimeJob,
  type SealedScriberrRuntimeUpload,
} from "../runtime-v2/scriberr-job.ts";
import { getVideoTranscriptionConfig } from "./config.ts";
import { sanitizeErrorForClient } from "./errors.ts";
import { VideoTranscriptionJobStore } from "./job-store.ts";
import type { VideoTranscriptionRouteDeps } from "./route-core.ts";
import { findExistingVideoSource } from "./video-source-store.ts";
import { kickPendingVisualAnalyses, VISUAL_ANALYSIS_QUESTION } from "./visual-analysis.ts";
import { runWatch, MAX_WATCH_PROCESS_TIMEOUT_MS } from "../hermes/watch-service.ts";
import { publishQuartzAfterMutation } from "../quartz-publish.ts";
import { enrichGardenSourceVisuals } from "../garden-visual-enrichment.ts";
import { createChatmockClient } from "../chatmock-client.ts";
import { selectedModelForUser } from "../selected-model.ts";

// Each health check runs a disposable runtime worker, about 10 s, and the video
// panel asks on every Garden open. Which tools are installed changes rarely and
// the panel treats the answer as advisory, so share one answer for a while.
const HEALTH_TTL_MS = 5 * 60_000;
type HealthEntry = { at: number; value: ReturnType<typeof checkScriberrHealthViaRuntime> };
const healthCache: Map<string, HealthEntry> =
  ((globalThis as { __breadboardScriberrHealth?: Map<string, HealthEntry> }).__breadboardScriberrHealth ??= new Map());

// The first check after a launch also took ~10 s, so the last answer is kept
// on disk too and served (at most a day old) while the new check runs.
const HEALTH_FILE_MAX_AGE_MS = 24 * 60 * 60_000;
type HealthValue = Awaited<ReturnType<typeof checkScriberrHealthViaRuntime>>;
const healthFile = () => path.join(dashboardDataDir(), "cache", "scriberr-health.json");

function readSavedHealth(key: string): HealthValue | null {
  try {
    const saved = JSON.parse(fs.readFileSync(healthFile(), "utf8"))[key] as { at: number; value: HealthValue } | undefined;
    return saved && Date.now() - saved.at < HEALTH_FILE_MAX_AGE_MS ? saved.value : null;
  } catch {
    return null;
  }
}

function saveHealth(key: string, value: HealthValue) {
  try {
    let saved: Record<string, unknown> = {};
    try { saved = JSON.parse(fs.readFileSync(healthFile(), "utf8")); } catch { /* First save. */ }
    saved[key] = { at: Date.now(), value };
    fs.mkdirSync(path.dirname(healthFile()), { recursive: true });
    fs.writeFileSync(healthFile(), JSON.stringify(saved));
  } catch { /* Advisory only: the in-memory answer still serves this process. */ }
}

function cachedScriberrHealth(userId: number, gardenId: string) {
  const key = `${userId}:${gardenId}`;
  const hit = healthCache.get(key);
  if (hit && Date.now() - hit.at < HEALTH_TTL_MS) return hit.value;
  const value = checkScriberrHealthViaRuntime({ userId, gardenId });
  healthCache.set(key, { at: Date.now(), value });
  // A failed check is not remembered: the next panel asks again.
  value.then(result => saveHealth(key, result), () => { if (healthCache.get(key)?.value === value) healthCache.delete(key); });
  // Past the TTL, answer with the last result while the new check runs.
  if (hit) return hit.value;
  const saved = readSavedHealth(key);
  return saved ? Promise.resolve(saved) : value;
}

interface VideoTranscriptionGlobals {
  videoTranscriptionStore?: VideoTranscriptionJobStore;
}

const globals = globalThis as typeof globalThis & VideoTranscriptionGlobals;

export function getVideoTranscriptionStore(): VideoTranscriptionJobStore {
  if (!globals.videoTranscriptionStore) {
    globals.videoTranscriptionStore = new VideoTranscriptionJobStore(db);
  }
  return globals.videoTranscriptionStore;
}

export function videoTranscriptionRouteDeps(): VideoTranscriptionRouteDeps {
  const config = getVideoTranscriptionConfig();
  const store = getVideoTranscriptionStore();
  return {
    config: {
      ...config,
      // Only a desktop install has this file: there the server and the user
      // share a disk, so a path the user picked means the same thing to both.
      allowOriginPaths: fs.existsSync(path.join(dashboardDataDir(), "config", "desktop-config.json")),
    },
    store,
    requireOwnedGarden: async (gardenId: string) => {
      const { userId, cluster } = await requireOwnedClusterFromSlug(gardenId);
      return { userId, clusterId: cluster.id, clusterSlug: cluster.slug };
    },
    contentPath: () => process.env.QUARTZ_CONTENT_PATH ?? null,
    runnerKick: async (clusterId) => {
      await reconcileScriberrRuntimeJobs({ store, clusterId });
      const contentPath = process.env.QUARTZ_CONTENT_PATH;
      if (!contentPath) return;
      // "Watch"-style jobs finish here: the worker cannot reach the Runtime
      // job owner, the dashboard can.
      kickPendingVisualAnalyses(
        {
          store,
          contentPath,
          ffmpegPath: config.ffmpegPath,
          runWatch: async ({ userId, jobId, source, workspaceRoot }) =>
            runWatch({
              userId,
              conversationId: `garden-video:${jobId}`,
              workspaceRoot,
              args: {
                source,
                question: VISUAL_ANALYSIS_QUESTION,
                detail: "token-burner",
                timestamps: [],
                // The transcript already comes from Scriberr; captions are
                // enough for the frame reading, no remote Whisper call.
                noWhisper: true,
                processTimeoutMs: MAX_WATCH_PROCESS_TIMEOUT_MS,
              },
            }),
          publish: (reason, gardenSlug, userId) =>
            publishQuartzAfterMutation(reason, { requireSuccess: true, gardenSlug, userId }),
          describeSource: async (userId, gardenSlug, sourceRelPath) => {
            const result = await enrichGardenSourceVisuals({ contentPath, gardenSlug, sourceRelPath,
              client: createChatmockClient(), model: selectedModelForUser(userId) });
            if (result.pending || result.warnings.length) {
              console.warn(`[video-visual-analysis] ${result.pending} visual descriptions pending. ${result.warnings.join(" ")}`);
            }
          },
          log: (message) => console.warn(`[video-visual-analysis] ${message}`),
        },
        clusterId,
      );
    },
    runnerStart: async (jobId, upload) => {
      try {
        return await startScriberrRuntimeJob({
          store,
          jobId,
          upload: upload as SealedScriberrRuntimeUpload | null,
        });
      } catch (error) {
        const failure = sanitizeErrorForClient(error);
        store.transition(jobId, "failed", failure);
        throw error;
      }
    },
    runnerCancel: (jobId) => cancelScriberrRuntimeJob({ store, jobId }),
    runnerRetry: (jobId) => retryScriberrRuntimeJob({ store, jobId }),
    sealUpload: ({ garden, file, displayFilename, signal }) =>
      sealScriberrRuntimeUpload({
        userId: garden.userId,
        gardenId: garden.clusterSlug,
        file,
        displayFilename,
        maxBytes: config.maxUploadBytes,
        signal,
      }),
    abandonUpload: (garden, uploadId) =>
      abandonScriberrRuntimeUpload({
        userId: garden.userId,
        gardenId: garden.clusterSlug,
        uploadId,
      }),
    inspectYouTube: (garden, parsed) =>
      inspectScriberrYouTubeViaRuntime({
        userId: garden.userId,
        gardenId: garden.clusterSlug,
        parsed,
      }),
    findExistingVideoSource,
    checkHealth: ({ userId, gardenId }) => cachedScriberrHealth(userId, gardenId),
  };
}
