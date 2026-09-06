import fs from "node:fs";
import { resolveMusicSource } from "../music-producer/sources.ts";
import type { ResolvedTrack } from "./tracks.ts";
/** An identity, never a model-provided path. Caller must retain audio skill/token checks. */
export function generatedAudioTrack(userId: number, conversationPublicId: string, reference: string | undefined): ResolvedTrack | null {
  if (!reference?.startsWith('artifact:'))
    return null;
  const match = /^artifact:([A-Za-z0-9_-]{1,128})@([1-9]\d{0,8})$/.exec(reference);
  if (!match)
    throw Error('Use artifact:ID@VERSION to select a generated audio version.');
  const file = resolveMusicSource(userId, conversationPublicId, { kind: 'artifact', artifactId: match[1], version: Number(match[2]) });
  return { name: reference, blobId: reference, path: file, format: 'wav', formatLabel: 'WAV', sizeBytes: fs.statSync(file).size, carriedForward: true };
}
