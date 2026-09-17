// Framework wiring only. The dashboard owns authentication and the durable
// browser projection; every finite tool/process boundary runs in Rust-owned
// Runtime V2 workers with no in-process fallback.

import db from "../db.ts";
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
    config,
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
          publish: (reason, gardenSlug) =>
            publishQuartzAfterMutation(reason, { requireSuccess: true, gardenSlug }),
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
    checkHealth: ({ userId, gardenId }) =>
      checkScriberrHealthViaRuntime({ userId, gardenId }),
  };
}
