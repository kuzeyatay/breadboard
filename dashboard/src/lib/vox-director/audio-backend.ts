// The voice, and the bed underneath it.
//
// Upstream narrates through a hosted TTS (`xai/tts-v1`) and scores with a hosted
// music model (`minimax/music-2.6`). Neither is reachable here and neither needs
// to be: Breadboard already runs a local speech service — Voicebox, on
// 127.0.0.1, started with the app, with Kokoro preset voices that need no key,
// no account and no network. That is the narrator.
//
// Music is deliberately not generated. Section 9 of the brief is explicit that a
// working local production beats a cloud dependency, so a run uses a track the
// user supplied or a track in a local library, and otherwise renders without
// one. `--no-music` is the same path with the library skipped.
//
// Narration is the one thing that does not degrade. A narrated explainer with no
// narration is not a lesser film, it is a different and wrong one, so a run that
// cannot speak fails and says why rather than shipping silence.

import fs from "node:fs";
import path from "node:path";
import { voiceboxJson, voiceboxFetch } from "../speech/voicebox-client.ts";
import { getSpeechSettings } from "../speech/settings.ts";
import { parseDriverJson } from "./image-backend.ts";
import { relativeInWorkspace, resolveInWorkspace, writeSpec } from "./workspace.ts";
import { resolveVoxFfprobe, runVoxDriver, voxDirectorEnv } from "./runtime.ts";
import { spawn } from "node:child_process";

interface VoiceProfile {
  id: string;
  name: string;
  voice_type: "cloned" | "preset" | "designed";
  default_engine?: string | null;
  preset_engine?: string | null;
  sample_count?: number;
  language?: string | null;
}

export interface NarrationVoice {
  profileId: string;
  name: string;
  engine: string;
  language: string;
}

/**
 * Which voice narrates.
 *
 * A preset voice is preferred over the user's own cloned one even when the chat
 * has one configured: a clone is for reading the person's own messages back,
 * and putting it on a published explainer is a decision they never made here. A
 * cloned voice is used only when it is the only profile that exists.
 */
export async function resolveNarrationVoice(input: {
  userId: number;
  preferredProfileId?: string | null;
  signal?: AbortSignal;
}): Promise<{ ok: true; voice: NarrationVoice } | { ok: false; reason: string }> {
  let profiles: VoiceProfile[];
  try {
    profiles = await voiceboxJson<VoiceProfile[]>("/profiles", {
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? `The local speech service is not answering: ${error.message}`
          : "The local speech service is not answering.",
    };
  }
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return {
      ok: false,
      reason:
        "The local speech service has no voices. Add one in Intelligence → Settings → Speech before narrating a film.",
    };
  }

  const named = input.preferredProfileId
    ? profiles.find((profile) => profile.id === input.preferredProfileId)
    : undefined;
  const preset = profiles.find((profile) => profile.voice_type === "preset");
  const usable = named ?? preset ?? profiles[0];
  if (usable.voice_type === "cloned" && (usable.sample_count ?? 0) === 0) {
    return {
      ok: false,
      reason: `${usable.name} has no voice recording yet, and there is no preset voice to narrate with instead.`,
    };
  }

  let settingsLanguage = "en";
  try {
    settingsLanguage = getSpeechSettings(input.userId).language;
  } catch {
    settingsLanguage = "en";
  }

  return {
    ok: true,
    voice: {
      profileId: usable.id,
      name: usable.name,
      engine: usable.default_engine || usable.preset_engine || "kokoro",
      language: usable.language || settingsLanguage || "en",
    },
  };
}

export interface NarrationClip {
  beatId: number;
  relativePath: string;
  seconds: number;
}

/**
 * Read one beat aloud and measure what came back.
 *
 * The measured length — not the planned one — is what the assembly stage times
 * the film to, because a beat whose voice runs two seconds past its shots would
 * otherwise be cut off mid-sentence. That is why the duration comes from ffprobe
 * rather than from a word count.
 */
export async function narrateBeat(input: {
  runId: string;
  beatId: number;
  text: string;
  voice: NarrationVoice;
  signal?: AbortSignal;
}): Promise<{ ok: true; clip: NarrationClip } | { ok: false; reason: string }> {
  const spoken = input.text.trim();
  if (!spoken) return { ok: false, reason: "the beat has no narration to read" };

  let response: Response;
  try {
    response = await voiceboxFetch(
      "/generate/stream",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(input.signal ? { signal: input.signal } : {}),
        body: JSON.stringify({
          profile_id: input.voice.profileId,
          text: spoken,
          language: input.voice.language,
          engine: input.voice.engine,
        }),
      },
      10 * 60_000,
    );
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "the speech service did not answer",
    };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      ok: false,
      reason: `the speech service returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    };
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength === 0) return { ok: false, reason: "the speech service returned no audio" };

  const relative = `audio/beat_${input.beatId}.wav`;
  const absolute = resolveInWorkspace(input.runId, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, audio);

  const seconds = await probeDuration(absolute, input.signal);
  if (seconds <= 0) {
    return { ok: false, reason: "the narration file could not be read back" };
  }
  return { ok: true, clip: { beatId: input.beatId, relativePath: relative, seconds } };
}

/** Seconds of audio in a file, straight from ffprobe. 0 when it cannot be read. */
export function probeDuration(absolutePath: string, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) return Promise.resolve(0);
  const ffprobe = resolveVoxFfprobe();
  if (!ffprobe) return Promise.resolve(0);
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (value: number) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn(
        ffprobe,
        ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", absolutePath],
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
          env: voxDirectorEnv(),
        },
      );
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        out += chunk;
      });
      const onAbort = () => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
        done(0);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(onAbort, 30_000);
      timer.unref?.();
      child.on("error", () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        done(0);
      });
      child.on("close", () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const parsed = Number.parseFloat(out.trim());
        done(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
      });
    } catch {
      done(0);
    }
  });
}

export interface MusicBed {
  relativePath: string;
  /** "library" / "supplied" / "silence". */
  source: string;
  reason: string;
}

const MUSIC_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".flac"]);

/**
 * The music library, if there is one.
 *
 * A directory the user points `VOX_DIRECTOR_MUSIC_DIR` at, or `music/` inside
 * the clone. Nothing is downloaded and nothing is generated: a track is used
 * because it is already on the machine.
 */
export function findMusicTrack(
  cloneRoot: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const directories = [env.VOX_DIRECTOR_MUSIC_DIR?.trim(), cloneRoot ? path.join(cloneRoot, "music") : null]
    .filter((value): value is string => Boolean(value))
    .map((value) => path.resolve(value));
  for (const directory of directories) {
    let entries: string[];
    try {
      entries = fs.readdirSync(directory);
    } catch {
      continue;
    }
    const track = entries
      .filter((name) => MUSIC_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort()[0];
    if (track) return path.join(directory, track);
  }
  return null;
}

/**
 * The bed the assembly lays under the narration.
 *
 * When there is no music, that bed is silence rather than a second assembly
 * path: `vox-director/scripts/assemble.py` always mixes and ducks a music
 * track, and handing it a silent file keeps one well-tested route through the
 * final render instead of two, one of which would almost never run.
 */
export async function prepareMusicBed(input: {
  runId: string;
  python: string;
  cwd: string;
  seconds: number;
  music: boolean;
  cloneRoot: string | null;
  suppliedTrack?: string | null;
  signal?: AbortSignal;
}): Promise<MusicBed> {
  const silence = async (reason: string): Promise<MusicBed> => {
    const relative = "audio/silence.wav";
    const specPath = writeSpec(input.runId, "silence", {
      root: resolveInWorkspace(input.runId, "."),
      out: relative,
      seconds: Math.max(2, Math.min(600, input.seconds + 4)),
    });
    const run = await runVoxDriver({
      python: input.python,
      operation: "silence",
      specPath,
      cwd: input.cwd,
      timeoutMs: 120_000,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const parsed = parseDriverJson(run.stdout);
    if (!run.ok || !parsed?.ok) {
      // Assembly needs *a* bed; without one the run cannot finish, so this is
      // reported rather than swallowed.
      return { relativePath: "", source: "none", reason: `${reason} The silent bed also failed.` };
    }
    return { relativePath: relative, source: "silence", reason };
  };

  if (!input.music) {
    return silence("--no-music was set, so the film has no music bed.");
  }

  const track = input.suppliedTrack ?? findMusicTrack(input.cloneRoot);
  if (!track || !fs.existsSync(track)) {
    return silence(
      "No local music was found, so the film has narration and no music. Point VOX_DIRECTOR_MUSIC_DIR at a folder of tracks to score it.",
    );
  }
  try {
    const relative = `audio/music${path.extname(track).toLowerCase()}`;
    const absolute = resolveInWorkspace(input.runId, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.copyFileSync(track, absolute);
    return {
      relativePath: relativeInWorkspace(input.runId, absolute),
      source: "library",
      reason: `Scored with ${path.basename(track)}.`,
    };
  } catch (error) {
    return silence(
      `The music track could not be copied into the run (${
        error instanceof Error ? error.message : "unknown error"
      }).`,
    );
  }
}
