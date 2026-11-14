// Sound for a math animation. Manim renders a silent MP4; narration and a music
// bed are prepared by the same code the Video skill uses and mixed in here with
// ffmpeg, leaving the picture stream untouched.

import fs from "node:fs";
import path from "node:path";

import { durationOf, mediaTool, prepareAudio, run, type PreparedAudio } from "../remotion/audio.ts";
import {
  VideoRequestError,
  musicFrom,
  narrationFrom,
  type VideoMusic,
  type VideoNarrationLine,
} from "../remotion/request.ts";
import { ManimServiceError } from "./request.ts";

// A scene's length is only known once it has rendered, so start times are
// checked against the longest scene worth making and reported on afterwards.
const MAX_SCENE_SECONDS = 600;

export interface ManimSound {
  music: VideoMusic | null;
  narration: VideoNarrationLine[];
}

export function validateManimSound(args: Record<string, unknown>): ManimSound {
  try {
    return { music: musicFrom(args.music), narration: narrationFrom(args.narration, MAX_SCENE_SECONDS) };
  } catch (error) {
    if (error instanceof VideoRequestError) {
      throw new ManimServiceError("manim_invalid_arguments", error.message);
    }
    throw error;
  }
}

/** The ffmpeg arguments that lay `audio` under `videoPath`. Pure, so it is tested without ffmpeg. */
export function soundtrackArgs(input: {
  videoPath: string;
  audioDirectory: string;
  outputPath: string;
  videoSeconds: number;
  audio: PreparedAudio;
}): string[] {
  const inputs: string[] = [];
  const filters: string[] = [];
  const mixed: string[] = [];
  const { music, narration } = input.audio;
  if (music) {
    inputs.push("-i", path.join(input.audioDirectory, music.file));
    const fadeOut = Math.min(music.fadeOutSeconds, input.videoSeconds);
    filters.push(
      // ponytail: one fixed level under the voice (prepareAudio already lowers
      // it when there is narration), no per-line ducking. Sidechain it if the
      // voice gets buried.
      `[1:a]volume=${music.volume},afade=t=in:d=${music.fadeInSeconds},afade=t=out:st=${Math.max(0, input.videoSeconds - fadeOut).toFixed(2)}:d=${fadeOut}[m]`,
    );
    mixed.push("[m]");
  }
  for (const [index, line] of narration.entries()) {
    inputs.push("-i", path.join(input.audioDirectory, line.file));
    filters.push(`[${index + (music ? 2 : 1)}:a]adelay=${Math.round(line.atSeconds * 1000)}:all=1[v${index}]`);
    mixed.push(`[v${index}]`);
  }
  filters.push(`${mixed.join("")}amix=inputs=${mixed.length}:duration=longest:normalize=0[a]`);
  return [
    "-hide_banner", "-y", "-i", input.videoPath, ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-t", input.videoSeconds.toFixed(3),
    "-movflags", "+faststart",
    input.outputPath,
  ];
}

/** Mix music and spoken lines into a rendered scene; returns the new file beside it. */
export async function addSoundtrack(input: {
  videoPath: string;
  music: VideoMusic | null;
  narration: { atSeconds: number; audio: Uint8Array }[];
  signal?: AbortSignal;
}): Promise<{ videoPath: string; videoSeconds: number; audio: PreparedAudio }> {
  try {
    const videoSeconds = await durationOf(input.videoPath, input.signal);
    const audioDirectory = path.join(path.dirname(input.videoPath), "sound");
    const audio = await prepareAudio({
      publicDirectory: audioDirectory,
      videoSeconds,
      music: input.music,
      narration: input.narration,
      signal: input.signal,
    });
    const outputPath = path.join(path.dirname(input.videoPath), "with-sound.mp4");
    const mix = await run(
      mediaTool("ffmpeg"),
      soundtrackArgs({ videoPath: input.videoPath, audioDirectory, outputPath, videoSeconds, audio }),
      { timeoutMs: 120_000, signal: input.signal },
    );
    if (mix.code !== 0 || !fs.existsSync(outputPath)) {
      throw new ManimServiceError("manim_audio_failed", `The soundtrack could not be mixed in. ${mix.stderr.slice(-300)}`);
    }
    return { videoPath: outputPath, videoSeconds: Math.round(videoSeconds * 100) / 100, audio };
  } catch (error) {
    if (error instanceof VideoRequestError) throw new ManimServiceError("manim_audio_failed", error.message);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ManimServiceError("manim_audio_failed", "ffmpeg is not installed, so sound cannot be added. Render without music or narration.");
    }
    throw error;
  }
}
