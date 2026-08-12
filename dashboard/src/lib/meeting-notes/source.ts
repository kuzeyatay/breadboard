import "server-only";

// Finding the meeting.
//
// Four of the five source kinds name their own input and are a lookup. The
// fifth, `auto`, is the one that matters: a Super Agent delegation is a sentence
// and can never carry a file, so without it this agent would be in the same
// position as Video Use and the Legal Agent — user-launched only, and unable to
// answer "can you transcribe this meeting" at all. `auto` is what lets a
// delegated run find the recording the person is plainly talking about: the
// newest audio or video already sitting on this conversation.
//
// The scope is the conversation, never the archive. Reaching into another chat's
// recordings to answer this one would be a privacy failure dressed up as
// convenience, and `listArtifactsForUser` refuses an unscoped call for exactly
// that reason.

import fs from "node:fs";

import {
  artifactFile,
  getArtifactForUser,
  listArtifactsForUser,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { findVideoBlob } from "../conversations/video-blob-store.ts";
import type { MeetingSource } from "./identity.ts";
import { findMeetingUpload } from "./uploads.ts";

/** What a run actually works from, once the source has been resolved. */
export type ResolvedMeeting =
  | { kind: "audio"; path: string; filename: string; title: string; artifactId: string | null }
  | { kind: "transcript"; text: string; title: string };

export class SourceError extends Error {}

const RECORDING_KINDS = new Set<ArtifactRow["kind"]>(["audio", "video"]);

function artifactRecordingPath(artifact: ArtifactRow): { path: string; filename: string } {
  // "download" is the original the artifact was built from; a preview may be a
  // transcoded or trimmed stand-in, which is not what should be transcribed.
  const file = artifactFile({ artifact, version: artifact.current_version, purpose: "download" });
  return { path: file.path, filename: file.filename || artifact.filename };
}

/**
 * The newest recording on this conversation, or null when there is none.
 *
 * Newest wins because the alternative — asking which of three recordings was
 * meant — is a question a delegated run has nobody to ask. When it guesses
 * wrong the run says which recording it picked, so the correction is one
 * message rather than a mystery.
 */
export function findLatestRecording(input: {
  userId: number;
  conversationPublicId: string;
}): ArtifactRow | null {
  try {
    const artifacts = listArtifactsForUser({
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
    });
    return (
      artifacts.find(
        (artifact) => RECORDING_KINDS.has(artifact.kind) && artifact.status === "ready",
      ) ?? null
    );
  } catch {
    return null;
  }
}

export interface ResolveSourceInput {
  userId: number;
  conversationPublicId: string;
  source: MeetingSource;
  /** Falls back to this when the source carries no name of its own. */
  fallbackTitle: string;
}

/**
 * Turn a requested source into something the run can read, or explain why it
 * cannot. Every failure here is a sentence a person can act on — "attach the
 * recording", "that artifact is not a recording" — because this is the step
 * that goes wrong most often and a code is no use to anybody.
 */
export function resolveMeetingSource(input: ResolveSourceInput): ResolvedMeeting {
  const { source } = input;

  if (source.kind === "transcript") {
    const text = source.text.trim();
    if (!text) throw new SourceError("That transcript is empty.");
    return { kind: "transcript", text, title: input.fallbackTitle };
  }

  if (source.kind === "upload") {
    const staged = findMeetingUpload({ userId: input.userId, uploadId: source.uploadId });
    if (!staged) {
      throw new SourceError(
        "That recording is no longer staged. Uploads are kept for a day; upload it again.",
      );
    }
    return {
      kind: "audio",
      path: staged.path,
      filename: source.filename,
      title: input.fallbackTitle,
      artifactId: null,
    };
  }

  if (source.kind === "attachment") {
    const staged = findVideoBlob({ userId: input.userId, blobId: source.blobId });
    if (!staged) {
      throw new SourceError("That attached recording could not be found.");
    }
    return {
      kind: "audio",
      path: staged.path,
      filename: source.filename,
      title: input.fallbackTitle,
      artifactId: null,
    };
  }

  if (source.kind === "artifact") {
    // The store throws on an artifact this user cannot see in this conversation,
    // which is the check that matters — it must not be softened into a null.
    let artifact: ArtifactRow;
    try {
      artifact = getArtifactForUser({
        artifactId: source.artifactId,
        userId: input.userId,
        conversationPublicId: input.conversationPublicId,
      });
    } catch {
      throw new SourceError("That recording is not in this chat's artifacts.");
    }
    if (!RECORDING_KINDS.has(artifact.kind)) {
      throw new SourceError(`“${artifact.title}” is not a recording, so there is nothing to transcribe.`);
    }
    const file = artifactRecordingPath(artifact);
    return {
      kind: "audio",
      path: file.path,
      filename: file.filename,
      title: artifact.title || input.fallbackTitle,
      artifactId: artifact.id,
    };
  }

  // auto
  const latest = findLatestRecording({
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
  });
  if (!latest) {
    throw new SourceError(
      "There is no recording in this chat to transcribe. Attach the meeting recording, record one with the meeting button, or paste the transcript.",
    );
  }
  const file = artifactRecordingPath(latest);
  return {
    kind: "audio",
    path: file.path,
    filename: file.filename,
    title: latest.title || input.fallbackTitle,
    artifactId: latest.id,
  };
}

/** How large the recording is, for the run's own progress line. */
export function recordingBytes(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}
