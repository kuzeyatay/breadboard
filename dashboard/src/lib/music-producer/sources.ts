import fs from "node:fs";
import path from "node:path";
import { getConversationForUser, listRecentConversationMessages } from "../conversations/store.ts";
import { messageAttachments } from "../conversations/uploads.ts";
import { findAudioBlob } from "../conversations/audio-blob-store.ts";
import { artifactDeliveryFile, getArtifactForUser, listArtifactsForUser, listArtifactVersions } from "../hermes/artifact-store.ts";
import { MAX_AUDIO_BYTES } from "../acestep/client.ts";
import { musicSourceSchema, musicRequestSchema, type MusicSource } from "./request.ts";
/** Exact prior lyrics/settings come from the authorized version, not clipped chat history. */
export function sourceMusicRequest(userId: number, conversationPublicId: string, source: MusicSource) {
  source = musicSourceSchema.parse(source);
  if (source.kind !== "artifact")
    return null;
  getArtifactForUser({ userId, conversationPublicId, artifactId: source.artifactId });
  const row = listArtifactVersions(source.artifactId).find(row => row.version === source.version);
  if (!row)
    throw Error("source_version_not_found");
  const parsed = musicRequestSchema.safeParse(JSON.parse(row.metadata_json || "{}").requested);
  return parsed.success ? parsed.data : null;
}
function directFile(filename: string): string {
  const resolved = path.resolve(filename), canonical = fs.realpathSync.native(resolved);
  const same = process.platform === "win32" ? resolved.toLowerCase() === canonical.toLowerCase() : resolved === canonical;
  const stat = fs.lstatSync(resolved);
  if (!same || stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > MAX_AUDIO_BYTES)
    throw new Error("invalid_music_source_file");
  return canonical;
}
export function resolveMusicSource(userId: number, conversationPublicId: string, raw: MusicSource): string {
  const source = musicSourceSchema.parse(raw);
  const conversation = getConversationForUser(conversationPublicId, userId);
  if (source.kind === "artifact") {
    const artifact = getArtifactForUser({ userId, conversationPublicId, artifactId: source.artifactId });
    if (artifact.kind !== "audio" || artifact.status !== "ready")
      throw new Error("source_must_be_ready_audio");
    return directFile(artifactDeliveryFile(artifact, source.version).absolutePath);
  }
  const belongs = listRecentConversationMessages(conversation.id, 200).some(message => messageAttachments(message.metadata).some(attachment => attachment.type === "audio" && attachment.blobId === source.blobId));
  if (!belongs)
    throw new Error("source_not_in_conversation");
  const blob = findAudioBlob({ userId, blobId: source.blobId });
  if (!blob)
    throw new Error("source_not_found");
  return directFile(blob.path);
}
export function musicSources(userId: number, conversationPublicId: string) {
  const conversation = getConversationForUser(conversationPublicId, userId);
  const artifacts = listArtifactsForUser({ userId, conversationPublicId }).filter(a => a.kind === "audio" && a.status === "ready").slice(0, 12);
  const sources: Array<{
    source: MusicSource;
    name: string;
    settings?: Record<string, unknown>;
  }> = artifacts.map(a => {
    const source: MusicSource = { kind: "artifact", artifactId: a.id, version: a.current_version };
    const prior = sourceMusicRequest(userId, conversationPublicId, source);
    return { source, name: a.title, ...(prior ? { settings: { duration: prior.duration, vocalMode: prior.vocalMode, language: prior.language, bpm: prior.bpm, key: prior.key, lyricsAvailable: Boolean(prior.lyrics) } } : {}) };
  });
  const seen = new Set<string>();
  for (const message of listRecentConversationMessages(conversation.id, 200).reverse()) {
    for (const attachment of messageAttachments(message.metadata)) {
      if (attachment.type !== "audio" || seen.has(attachment.blobId))
        continue;
      seen.add(attachment.blobId);
      sources.push({ source: { kind: "attachment", blobId: attachment.blobId }, name: attachment.name.slice(0, 240) });
      if (sources.length >= 24)
        return sources;
    }
  }
  return sources;
}
