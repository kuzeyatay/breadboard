// Real wiring of the video transcription feature: the SQLite-backed job store
// on the shared app database, the Scriberr client from validated env config,
// and a process-wide runner singleton (survives Next.js dev hot reloads the
// same way the db handle does). Routes import from here; tests import the
// underlying modules directly with injected fakes.

import db from "../db";
import {
  requireOwnedClusterFromSlug,
} from "../server-auth";
import { getVideoTranscriptionConfig } from "./config";
import { ScriberrClient } from "./client";
import { VideoTranscriptionJobStore } from "./job-store";
import { VideoTranscriptionRunner } from "./job-runner";
import { ingestTranscriptSource, resumeTranscriptIndexing } from "./ingest";
import { findExistingVideoSource } from "./video-source-store";
import { probeMediaFile } from "./ffprobe";
import { inspectYouTubeVideo } from "./ytdlp";
import { checkVideoTranscriptionHealth } from "./health";
import type { VideoTranscriptionRouteDeps } from "./route-core";
import type { ParsedYouTubeUrl } from "./youtube";

interface VideoTranscriptionGlobals {
  videoTranscriptionStore?: VideoTranscriptionJobStore;
  videoTranscriptionRunner?: VideoTranscriptionRunner;
}

const globals = globalThis as typeof globalThis & VideoTranscriptionGlobals;

export function getVideoTranscriptionStore(): VideoTranscriptionJobStore {
  if (!globals.videoTranscriptionStore) {
    globals.videoTranscriptionStore = new VideoTranscriptionJobStore(db);
  }
  return globals.videoTranscriptionStore;
}

export function createScriberrClientFromConfig(): ScriberrClient {
  const config = getVideoTranscriptionConfig();
  return new ScriberrClient({
    baseUrl: config.scriberrBaseUrl,
    apiToken: config.scriberrApiToken,
    username: config.scriberrUsername,
    password: config.scriberrPassword,
    requestTimeoutMs: config.requestTimeoutMs,
  });
}

export function getVideoTranscriptionRunner(): VideoTranscriptionRunner {
  if (!globals.videoTranscriptionRunner) {
    const config = getVideoTranscriptionConfig();
    globals.videoTranscriptionRunner = new VideoTranscriptionRunner({
      config,
      store: getVideoTranscriptionStore(),
      createScriberrClient: () => createScriberrClientFromConfig(),
      probeMedia: (filePath) => probeMediaFile(config.ffprobePath, filePath),
      ingest: ingestTranscriptSource,
      resumeIndexing: resumeTranscriptIndexing,
      findExistingVideoSource,
      contentPath: () => process.env.QUARTZ_CONTENT_PATH ?? "",
    });
  }
  return globals.videoTranscriptionRunner;
}

export function videoTranscriptionRouteDeps(): VideoTranscriptionRouteDeps {
  const config = getVideoTranscriptionConfig();
  const store = getVideoTranscriptionStore();
  const runner = getVideoTranscriptionRunner();
  return {
    config,
    store,
    requireOwnedGarden: async (gardenId: string) => {
      const { userId, cluster } = await requireOwnedClusterFromSlug(gardenId);
      return { userId, clusterId: cluster.id, clusterSlug: cluster.slug };
    },
    contentPath: () => process.env.QUARTZ_CONTENT_PATH ?? null,
    runnerKick: () => runner.kick(),
    runnerCancel: (jobId: string) => runner.requestCancel(jobId),
    runnerRetry: (jobId: string) => runner.retry(jobId),
    inspectYouTube: (parsed: ParsedYouTubeUrl) =>
      inspectYouTubeVideo(
        { ytdlpPath: config.ytdlpPath, timeoutMs: 60_000 },
        parsed,
      ),
    findExistingVideoSource,
    checkHealth: ({ contentPath, clusterSlug }) =>
      checkVideoTranscriptionHealth(config, {
        contentPath,
        clusterSlug,
        scriberrHealthCheck: () => createScriberrClientFromConfig().healthCheck(),
      }),
  };
}
