// What the studio needs to know about one video artifact.
//
// The studio is deliberately global: it opens for *any* video artifact, not
// only for ones this editor produced. A short cut by the Shorts agent, a film
// rendered by ViMax, a clip someone dropped into a chat last month — all of
// them are a video with a file, and that is the entire requirement for editing
// one. The first prompt on an adopted video is what creates its session, so
// until then there is no program and no history, and this says so rather than
// pretending to a state it does not have.

import fs from "node:fs";
import {
  listArtifactVersions,
  presentArtifact,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { VIDEO_USE_METADATA, programForArtifact } from "./artifact.ts";
import { programDurationSeconds, type VideoEditProgram } from "./program.ts";
import { videoUseHealth } from "./runtime.ts";
import { findSession } from "./session.ts";
import { resolveSpeechEngine } from "./speech.ts";
import { hasTranscript } from "./transcript.ts";

export interface StudioVersion {
  version: number;
  createdAt: string;
  byteSize: number | null;
  /** What was asked for at this version, when the history remembers it. */
  prompt: string | null;
  summary: string | null;
  current: boolean;
}

export interface StudioState {
  artifactId: string;
  title: string;
  version: number;
  versions: StudioVersion[];
  /** Null until this video has been edited at least once. */
  program: VideoEditProgram | null;
  history: VideoEditProgram["history"];
  sourceDurationSeconds: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  /** The untouched original is on disk, so an edit replays rather than stacks. */
  sourceRetained: boolean;
  transcriptAvailable: boolean;
  /** A render would start right now. */
  editable: boolean;
  /** Why it would not, when it would not. */
  reason: string | null;
  /** Speech-aware edits (filler cuts, captions) are available. */
  speechAware: boolean;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function studioStateFor(input: {
  userId: number;
  artifact: ArtifactRow;
}): Promise<StudioState> {
  const presented = presentArtifact(input.artifact);
  const metadata = presented.metadata;
  const edited = metadata[VIDEO_USE_METADATA.edited] === true;

  const sourceDurationSeconds = numberOrNull(metadata[VIDEO_USE_METADATA.sourceDurationSeconds]);
  const program = edited
    ? programForArtifact(input.artifact, sourceDurationSeconds ?? 0)
    : null;

  const history = program?.history ?? [];
  const promptByVersion = new Map(history.map((entry) => [entry.version, entry]));

  const versions: StudioVersion[] = listArtifactVersions(input.artifact.id).map((row) => {
    const entry = promptByVersion.get(row.version);
    return {
      version: row.version,
      createdAt: row.created_at,
      byteSize: row.byte_size,
      prompt: entry?.prompt ?? null,
      summary: entry?.summary ?? null,
      current: row.version === input.artifact.current_version,
    };
  });

  const session = findSession(input.userId, input.artifact.id);
  const sourceRetained = Boolean(session && fs.existsSync(session.sourcePath));
  const health = videoUseHealth();

  return {
    artifactId: input.artifact.id,
    title: input.artifact.title,
    version: input.artifact.current_version,
    versions,
    program,
    history,
    sourceDurationSeconds,
    durationSeconds:
      numberOrNull(metadata[VIDEO_USE_METADATA.durationSeconds]) ??
      (program ? programDurationSeconds(program) : null),
    width: numberOrNull(metadata[VIDEO_USE_METADATA.width]),
    height: numberOrNull(metadata[VIDEO_USE_METADATA.height]),
    sourceRetained,
    transcriptAvailable: Boolean(session && hasTranscript(session)),
    editable: health.available,
    reason: health.available ? null : health.reason,
    // Asked rather than assumed: whether speech is available depends on a local
    // service being up, which is not something a cached flag can honestly say.
    speechAware: (await resolveSpeechEngine()) !== null,
  };
}
