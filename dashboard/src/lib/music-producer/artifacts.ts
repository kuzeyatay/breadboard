import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";
import { getRuntimeSessionByConversation, runtimeExternalSessionId } from "../hermes/runtime-store.ts";
import { beginRuntimeRun } from "../hermes/run-store.ts";
import fs from "node:fs";
import path from "node:path";
import { createImportedArtifact, getArtifactForUser, importArtifactVersion, listArtifactsForUser, listArtifactVersions } from "../hermes/artifact-store.ts";
import { musicLaunch, updateMusicLaunch } from "./store.ts";
import type { MusicRequest } from "./request.ts";
export function musicArtifactContext(userId: number, id: string) {
  const launch = musicLaunch(userId, id);
  const conversation = getConversationForUser(launch.conversation_public_id, userId);
  if (conversation.surface !== "dashboard_terminal" && conversation.surface !== "garden_chat")
    throw new Error("invalid_music_surface");
  const session = getRuntimeSessionByConversation(conversation.id);
  const hermesSessionId = session && runtimeExternalSessionId(session);
  const message = findExternalAgentAssistantMessage({ conversationId: conversation.id, runId: id });
  if (!session || !hermesSessionId || !message)
    throw new Error("Music run is missing its originating assistant message.");
  const run = beginRuntimeRun({ runtimeSessionId: session.id, instruction: launch.task, dispatch: { conversationPublicId: conversation.public_id, runtimeText: launch.task } });
  return {
    userId, conversationId: conversation.id, runtimeSessionId: session.id, hermesSessionId,
    clusterId: conversation.surface === "garden_chat" ? conversation.default_garden_id : null,
    surface: conversation.surface, assistantMessageId: message.id, runId: run.id
  };
}
export function assertMusicCollectible(userId: number, id: string): void {
  const launch = musicLaunch(userId, id);
  getConversationForUser(launch.conversation_public_id, userId);
  if (["aborted", "cancelling"].includes(launch.collection_state))
    throw new Error("music_collection_cancelled");
}
export async function publishMusic(input: {
  userId: number;
  id: string;
  context: ReturnType<typeof musicArtifactContext>;
  request: MusicRequest;
  sourceFile: string;
  authorizedRoot: string;
  metadata: Record<string, unknown>;
  signal: AbortSignal;
}) {
  const launch = musicLaunch(input.userId, input.id);
  const check = () => { input.signal.throwIfAborted(); assertMusicCollectible(input.userId, input.id); };
  check();
  const metadata = { ...input.metadata, musicProducerRunId: input.id, operation: input.request.operation, source: input.request.source, requested: input.request };
  // Lookup includes all versions: a crash after import must not publish the same revision twice.
  const existing = listArtifactsForUser({ userId: input.userId, conversationPublicId: launch.conversation_public_id });
  let prior: {
    artifact: typeof existing[number];
    version: number;
  } | null = null;
  for (const artifact of existing) {
    if (artifact.kind !== "audio")
      continue;
    const version = listArtifactVersions(artifact.id).find(row => JSON.parse(row.metadata_json || "{}").musicProducerRunId === input.id);
    if (version) {
      prior = { artifact, version: version.version };
      break;
    }
  }
  const source = input.request.source;
  const revision = source?.kind === "artifact" && ["cover", "repaint"].includes(input.request.operation);
  const common = {
    authorizedRoot: input.authorizedRoot, filePath: input.sourceFile, metadata,
    runId: input.context.runId, assistantMessageId: input.context.assistantMessageId, signal: input.signal,
    scrubProvenance: false, beforePublish: check
  };
  let artifact;
  if (prior)
    artifact = prior.artifact;
  else if (revision && source?.kind === "artifact") {
    const parent = getArtifactForUser({ userId: input.userId, artifactId: source.artifactId, conversationPublicId: launch.conversation_public_id });
    // Append from the explicitly selected source, including historical versions.
    // importArtifactVersion still guards concurrent changes during publication.
    artifact = await importArtifactVersion({ ...common, artifact: parent });
  }
  else {
    artifact = await createImportedArtifact({
      ...input.context, ...common, kind: "audio", title: input.request.brief.slice(0, 160), filename: "music.wav",
      sourceHermesTool: "music_producer", parentArtifactId: source?.kind === "artifact" ? source.artifactId : null
    });
  }
  const version = prior?.version ?? artifact.current_version;
  updateMusicLaunch(input.userId, input.id, { artifact_id: artifact.id, artifact_version: version });
  let lyrics = existing.find(row => row.kind === "markdown" && JSON.parse(row.metadata_json || "{}").musicProducerRunId === input.id);
  if (input.request.lyrics && !lyrics) {
    check();
    const filename = path.join(input.authorizedRoot, "lyrics.md");
    fs.writeFileSync(filename, input.request.lyrics, { flag: "wx", mode: 0o600 });
    try {
      lyrics = await createImportedArtifact({
        ...input.context, ...common, filePath: filename, kind: "markdown", title: "Lyrics", filename: "lyrics.md",
        parentArtifactId: artifact.id, metadata: { musicProducerRunId: input.id, audioArtifactId: artifact.id, audioVersion: version, language: input.request.language }
      });
    }
    finally {
      fs.rmSync(filename, { force: true });
    }
  }
  return { artifact, version, lyricsId: lyrics?.id ?? null };
}
