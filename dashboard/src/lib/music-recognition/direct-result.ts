import crypto from "node:crypto";
import { appendConversationAssistantMessage, getConversationById } from "../conversations/store.ts";
import { getRuntimeSessionById } from "../hermes/runtime-store.ts";
import { MusicRecognitionError } from "./errors.ts";
import type { MusicRecognitionResult, RecognizedSong } from "./types.ts";

function linkedService(label: string, href: string | undefined): string | null {
  return href ? `[${label}](${href})` : null;
}

function markdownText(value: string): string {
  return value.replace(/[\\`*_[\]()<>]/gu, "\\$&");
}

export function recognizedSongMessage(song: RecognizedSong): string {
  const details = [song.album, song.releaseDate]
    .filter((value): value is string => Boolean(value))
    .map(markdownText)
    .join(" · ");
  const links = [
    linkedService("Open song", song.links?.song),
    linkedService("Open in Spotify", song.links?.spotify),
    linkedService("Open in Apple Music", song.links?.appleMusic),
  ].filter((value): value is string => Boolean(value));
  return [
    `Identified: **${markdownText(song.title)}** — ${markdownText(song.artist)}`,
    details,
    song.timecode ? `Matched at ${markdownText(song.timecode)}.` : "",
    links.join(" · "),
  ].filter(Boolean).join("\n\n");
}

/** Persist the direct button's result when the composer already belongs to a chat. */
export function persistDirectMusicRecognition(input: {
  userId: number;
  runtimeSessionId: number;
  result: MusicRecognitionResult;
}): void {
  const session = getRuntimeSessionById(input.runtimeSessionId);
  if (
    !session ||
    session.user_id !== input.userId ||
    session.conversation_id === null ||
    (session.surface !== "dashboard_terminal" && session.surface !== "garden_chat")
  ) {
    throw new MusicRecognitionError(
      "music_recognition_session_mismatch",
      "That conversation is not available for music recognition.",
      403,
    );
  }
  const conversation = getConversationById(session.conversation_id);
  if (!conversation || conversation.user_id !== input.userId) {
    throw new MusicRecognitionError(
      "music_recognition_conversation_missing",
      "That conversation is not available for music recognition.",
      403,
    );
  }

  appendConversationAssistantMessage({
    conversation,
    clientMessageId: `music-recognition-${crypto.randomUUID()}`,
    surface: conversation.surface,
    content: input.result.match
      ? recognizedSongMessage(input.result.match)
      : "No match found. Try another clean 10–15 second sample.",
    metadata: {
      toolName: "music_recognize",
      directMusicRecognition: true,
      musicRecognition: input.result,
    },
  });
}
