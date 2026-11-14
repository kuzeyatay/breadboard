// The soundtrack of a rendered video: a music bed fetched with the bundled
// yt-dlp and cut to the right section, plus narration clips. Everything lands
// in the job's `public/` folder, which the fixed entry reads with staticFile().
// The same track can be analysed first, so a video can be cut to its beat.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { repositoryRoot } from "../runtime-paths.ts";
import { VideoRequestError, type VideoMusic } from "./request.ts";

const DOWNLOAD_TIMEOUT_MS = 3 * 60_000;
const FFMPEG_TIMEOUT_MS = 60_000;
const MAX_TRACK_SECONDS = 15 * 60;
const MAX_ANALYSIS_SECONDS = 240;
const CACHED_TRACKS = 8;
const ANALYSIS_RATE = 11_025;

export interface PreparedAudio {
  /** File name inside public/, already cut to the video's length. */
  music: {
    file: string;
    volume: number;
    startSeconds: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
    title: string;
  } | null;
  narration: { file: string; atSeconds: number; durationSeconds: number }[];
  /** Things the model should know and may want to fix with another render. */
  notes: string[];
}

/** What a video needs to know about a stretch of music to be cut to it. */
export interface MusicAnalysis {
  fromSeconds: number;
  toSeconds: number;
  /** Null when no steady pulse was found. */
  bpm: number | null;
  beatSeconds: number | null;
  /** The strongest low-end hits (kicks, downbeats), in track time. */
  hits: { at: number; strength: number }[];
  /** Where the energy jumps or collapses: drops, breaks, the end of a section. */
  changes: { at: number; kind: "rise" | "fall"; fromDb: number; toDb: number }[];
  /** Runs of fast, even hits: drum rolls and fills. */
  rolls: { at: number[]; stepSeconds: number }[];
  /** Loudness once per second from `fromSeconds`, in dBFS. */
  loudness: number[];
}

/** A bundled tool: explicit env override, then the desktop app's bin folders, then PATH. */
export function mediaTool(name: "ffmpeg" | "ffprobe" | "yt-dlp", env: NodeJS.ProcessEnv = process.env): string {
  const override = env[{ ffmpeg: "FFMPEG_PATH", ffprobe: "FFPROBE_PATH", "yt-dlp": "YTDLP_PATH" }[name]]?.trim();
  if (override) return override;
  const file = process.platform === "win32" ? `${name}.exe` : name;
  for (const directory of ["desktop/build-resources/bin", "desktop/resources/bin"]) {
    const candidate = path.join(repositoryRoot(), directory, file);
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
}

export function run(
  command: string,
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal; binary?: boolean },
): Promise<{ code: number | null; stdout: string; stderr: string; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
      timeout: options.timeoutMs,
      killSignal: "SIGKILL",
    });
    const chunks: Buffer[] = [];
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (options.binary) chunks.push(chunk);
      else stdout = `${stdout}${chunk.toString("utf8")}`.slice(-4_000_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16_000);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, bytes: Buffer.concat(chunks) }));
  });
}

export async function durationOf(file: string, signal?: AbortSignal): Promise<number> {
  const probe = await run(
    mediaTool("ffprobe"),
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { timeoutMs: FFMPEG_TIMEOUT_MS, signal },
  );
  const seconds = Number(probe.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new VideoRequestError("video_audio_failed", `Could not read the audio file: ${probe.stderr.slice(-300)}`);
  }
  return seconds;
}

/**
 * Where to start a `windowSeconds` excerpt, given the track's loudness once per
 * second (dBFS). Picks the loudest stretch, which in most songs is a chorus or
 * a drop, then backs up to the nearest jump in level so the excerpt opens on
 * the section's first beat instead of a few seconds into it.
 */
export function pickMusicStart(levels: readonly number[], windowSeconds: number): number {
  const window = Math.max(1, Math.round(windowSeconds));
  if (levels.length <= window) return 0;
  const db = levels.map((level) => (Number.isFinite(level) ? Math.max(level, -90) : -90));
  let sum = 0;
  for (let i = 0; i < window; i += 1) sum += db[i];
  let best = 0;
  let bestSum = sum;
  for (let start = 1; start + window <= db.length; start += 1) {
    sum += db[start + window - 1] - db[start - 1];
    if (sum > bestSum + 1e-9) {
      bestSum = sum;
      best = start;
    }
  }
  let onset = best;
  let jump = 3; // dB: smaller steps are ordinary dynamics, not a new section
  for (let second = Math.max(1, best - 6); second <= Math.min(best + 2, db.length - window); second += 1) {
    const rise = db[second] - db[second - 1];
    if (rise > jump) {
      jump = rise;
      onset = second;
    }
  }
  return onset;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Beat, hits and section changes of mono samples that begin `offset` seconds
 * into the track. Pure, so it is tested without a decoder.
 *
 * ponytail: energy and low-band flux only. It finds the pulse, the kicks and
 * the big dynamic turns, which is what cutting needs; it does not know bars,
 * key or song structure. Breadboard's Rust analyzer covers key and timbre.
 */
export function analyzeSamples(samples: Float32Array, sampleRate: number, offset = 0): MusicAnalysis {
  const hop = Math.round(sampleRate / 100); // 10 ms
  const rate = sampleRate / hop;
  const frames = Math.floor(samples.length / hop);
  const full = new Float64Array(frames);
  const low = new Float64Array(frames);
  const pole = Math.exp((-2 * Math.PI * 150) / sampleRate);
  let filtered = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    let energy = 0;
    let lowEnergy = 0;
    for (let i = frame * hop; i < (frame + 1) * hop; i += 1) {
      filtered = pole * filtered + (1 - pole) * samples[i];
      energy += samples[i] * samples[i];
      lowEnergy += filtered * filtered;
    }
    full[frame] = Math.sqrt(energy / hop);
    low[frame] = Math.sqrt(lowEnergy / hop);
  }
  const flux = (signal: Float64Array) => {
    const result = new Float64Array(frames);
    for (let i = 2; i < frames; i += 1) {
      result[i] = Math.max(0, Math.log(1e-4 + signal[i]) - Math.log(1e-4 + signal[i - 2]));
    }
    return result;
  };
  const fullFlux = flux(full);
  const lowFlux = flux(low);
  const peaks = (signal: Float64Array, threshold: number, gapSeconds: number) => {
    const found: { frame: number; strength: number }[] = [];
    for (let i = 3; i < frames - 1; i += 1) {
      if (signal[i] < threshold || signal[i] < signal[i + 1] || signal[i] <= signal[i - 1]) continue;
      const previous = found.at(-1);
      if (previous && (i - previous.frame) / rate < gapSeconds) {
        if (signal[i] > previous.strength) found[found.length - 1] = { frame: i, strength: signal[i] };
      } else {
        found.push({ frame: i, strength: signal[i] });
      }
    }
    return found;
  };
  const at = (frame: number) => round2(offset + frame / rate);

  // Tempo: the lag at which the onset pattern best repeats.
  let bpm: number | null = null;
  let bestScore = 0;
  let total = 0;
  for (let i = 0; i < frames; i += 1) total += fullFlux[i] * fullFlux[i];
  if (frames / rate >= 6 && total > 0) {
    for (let candidate = 70; candidate <= 180; candidate += 0.25) {
      const lag = (60 / candidate) * rate;
      let score = 0;
      for (let i = 0; i + 4 * lag < frames - 1; i += 1) {
        score += fullFlux[i] * (fullFlux[Math.round(i + lag)] + 0.5 * fullFlux[Math.round(i + 2 * lag)] + 0.25 * fullFlux[Math.round(i + 4 * lag)]);
      }
      if (score > bestScore) {
        bestScore = score;
        bpm = candidate;
      }
    }
    if (bestScore < 0.05 * total) bpm = null;
  }

  const hits = peaks(lowFlux, 1.1, 0.12)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 48)
    .sort((a, b) => a.frame - b.frame)
    .map(({ frame, strength }) => ({ at: at(frame), strength: Math.round(strength * 10) / 10 }));

  // Level in quarter-second steps; a change is a half second that differs from
  // the half second before it by 8 dB overall or 12 dB in the bass.
  const stepFrames = Math.round(rate / 4);
  const steps = Math.floor(frames / stepFrames);
  const level = (from: number, to: number, signal: Float64Array = full) => {
    let energy = 0;
    for (let i = Math.max(0, from); i < Math.min(frames, to); i += 1) energy += signal[i] * signal[i];
    return 10 * Math.log10(energy / Math.max(1, Math.min(frames, to) - Math.max(0, from)) + 1e-9);
  };
  const changes: MusicAnalysis["changes"] = [];
  for (let step = 2; step + 2 <= steps; step += 1) {
    const frame = step * stepFrames;
    const before = level(frame - 2 * stepFrames, frame);
    const after = level(frame, frame + 2 * stepFrames);
    // A drop often adds bass more than loudness, so the low band gets a vote.
    const bass = level(frame, frame + 2 * stepFrames, low) - level(frame - 2 * stepFrames, frame, low);
    if (Math.abs(after - before) < 8 && Math.abs(bass) < 12) continue;
    const change = { at: at(frame), kind: (Math.abs(after - before) >= 8 ? after > before : bass > 0) ? ("rise" as const) : ("fall" as const), fromDb: Math.round(before), toDb: Math.round(after) };
    const previous = changes.at(-1);
    if (previous && previous.kind === change.kind && change.at - previous.at < 1) {
      if (Math.abs(after - before) > Math.abs(previous.toDb - previous.fromDb)) changes[changes.length - 1] = change;
    } else {
      changes.push(change);
    }
  }
  // Put each change on the frame where it actually happens.
  for (const change of changes) {
    const centre = Math.round((change.at - offset) * rate);
    if (change.kind === "rise") {
      let best = -1;
      for (let i = Math.max(3, centre - Math.round(0.4 * rate)); i < Math.min(frames - 1, centre + Math.round(0.4 * rate)); i += 1) {
        if (best < 0 || fullFlux[i] + lowFlux[i] > fullFlux[best] + lowFlux[best]) best = i;
      }
      if (best >= 0) change.at = at(best);
    } else {
      for (let i = Math.max(0, centre - Math.round(0.5 * rate)); i < Math.min(frames - 5, centre + Math.round(0.5 * rate)); i += 1) {
        if (level(i, i + 5) <= change.fromDb - 6) {
          change.at = at(i);
          break;
        }
      }
    }
  }

  const rolls: MusicAnalysis["rolls"] = [];
  const onsets = peaks(fullFlux, 0.8, 0.1).map(({ frame }) => frame / rate);
  let runStart = 0;
  for (let i = 1; i <= onsets.length; i += 1) {
    const step = onsets[i] - onsets[i - 1];
    const first = onsets[runStart + 1] - onsets[runStart];
    const even = i < onsets.length && step >= 0.1 && step <= 0.3 && Math.abs(step - first) <= 0.04;
    if (even) continue;
    if (i - runStart >= 3) {
      rolls.push({ at: onsets.slice(runStart, i).map((time) => round2(offset + time)), stepSeconds: round2((onsets[i - 1] - onsets[runStart]) / (i - 1 - runStart)) });
    }
    runStart = i;
  }

  const loudness: number[] = [];
  for (let second = 0; (second + 1) * rate <= frames; second += 1) {
    loudness.push(Math.round(level(Math.round(second * rate), Math.round((second + 1) * rate))));
  }
  return {
    fromSeconds: round2(offset),
    toSeconds: round2(offset + frames / rate),
    bpm,
    beatSeconds: bpm === null ? null : Math.round((60 / bpm) * 10_000) / 10_000,
    hits,
    changes,
    rolls: rolls.slice(0, 12),
    loudness,
  };
}

function trackCacheDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.REMOTION_RUNTIME_ROOT?.trim()
    ? path.join(path.resolve(env.REMOTION_RUNTIME_ROOT.trim()), "cache")
    : path.join(repositoryRoot(), "remotion-runtime", "cache");
}

/**
 * The whole track as an MP3, downloaded once. Analysing a song and then
 * rendering with it would otherwise fetch it twice.
 */
export async function fetchTrack(
  music: Pick<VideoMusic, "url" | "search">,
  signal?: AbortSignal,
): Promise<{ file: string; title: string; seconds: number }> {
  const directory = trackCacheDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const key = createHash("sha1").update(music.url ?? `search:${music.search}`).digest("hex").slice(0, 20);
  const file = path.join(directory, `${key}.mp3`);
  const titleFile = path.join(directory, `${key}.txt`);
  if (!fs.existsSync(file)) {
    const ffmpeg = mediaTool("ffmpeg");
    const download = await run(
      mediaTool("yt-dlp"),
      [
        "--no-playlist", "--no-warnings", "--no-progress",
        "--extract-audio", "--audio-format", "mp3", "--audio-quality", "3",
        // A search takes the first of five results that is a song-length track.
        "--match-filter", `duration > 20 & duration < ${MAX_TRACK_SECONDS}`,
        "--max-downloads", "1",
        "--max-filesize", "80m",
        ...(path.isAbsolute(ffmpeg) ? ["--ffmpeg-location", path.dirname(ffmpeg)] : []),
        "--print", "after_move:%(title)s",
        "-o", path.join(directory, `${key}.%(ext)s`),
        "--",
        music.url ?? `ytsearch5:${music.search}`,
      ],
      { timeoutMs: DOWNLOAD_TIMEOUT_MS, signal },
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        throw new VideoRequestError("video_audio_failed", "yt-dlp is not installed, so music cannot be downloaded. Render without music or install it.");
      }
      throw error;
    });
    // --max-downloads exits 101 on success, so the file is the only verdict.
    if (!fs.existsSync(file)) {
      throw new VideoRequestError(
        "video_audio_failed",
        `No usable track was downloaded (it must be between 20 seconds and 15 minutes long). ${download.stderr.trim().split(/\r?\n/).slice(-2).join(" ").slice(-400)}`,
      );
    }
    fs.writeFileSync(titleFile, download.stdout.trim().split(/\r?\n/).pop()?.slice(0, 160) ?? "", "utf8");
    const tracks = fs.readdirSync(directory)
      .filter((name) => name.endsWith(".mp3"))
      .map((name) => ({ name, time: fs.statSync(path.join(directory, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const stale of tracks.slice(CACHED_TRACKS)) {
      fs.rmSync(path.join(directory, stale.name), { force: true });
      fs.rmSync(path.join(directory, stale.name.replace(/\.mp3$/, ".txt")), { force: true });
    }
  }
  return {
    file,
    title: fs.existsSync(titleFile) ? fs.readFileSync(titleFile, "utf8") : "",
    seconds: await durationOf(file, signal),
  };
}

async function decode(file: string, from: number, seconds: number, signal?: AbortSignal): Promise<Float32Array> {
  const decoded = await run(
    mediaTool("ffmpeg"),
    ["-hide_banner", "-loglevel", "error", "-ss", String(from), "-t", String(seconds), "-i", file, "-vn", "-ac", "1", "-ar", String(ANALYSIS_RATE), "-f", "f32le", "-"],
    { timeoutMs: FFMPEG_TIMEOUT_MS, signal, binary: true },
  );
  if (decoded.code !== 0 || decoded.bytes.length < 4) {
    throw new VideoRequestError("video_audio_failed", `The music could not be decoded. ${decoded.stderr.slice(-300)}`);
  }
  const bytes = decoded.bytes.subarray(0, decoded.bytes.length - (decoded.bytes.length % 4));
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

/** Download (or reuse) a track and measure a stretch of it for cutting. */
export async function analyzeMusic(
  music: VideoMusic,
  windowSeconds: number | null,
  signal?: AbortSignal,
): Promise<MusicAnalysis & { title: string; trackSeconds: number; file: string }> {
  const track = await fetchTrack(music, signal);
  const from = Math.min(music.startSeconds ?? 0, Math.max(0, track.seconds - 1));
  const seconds = Math.min(windowSeconds ?? MAX_ANALYSIS_SECONDS, MAX_ANALYSIS_SECONDS, track.seconds - from);
  const analysis = analyzeSamples(await decode(track.file, from, seconds, signal), ANALYSIS_RATE, from);
  return { ...analysis, title: track.title, trackSeconds: round2(track.seconds), file: track.file };
}

async function prepareMusic(
  music: VideoMusic,
  publicDirectory: string,
  videoSeconds: number,
  quiet: boolean,
  signal?: AbortSignal,
): Promise<NonNullable<PreparedAudio["music"]>> {
  const track = await fetchTrack(music, signal);
  let startSeconds = music.startSeconds;
  if (startSeconds === null) {
    const levels = analyzeSamples(await decode(track.file, 0, Math.min(track.seconds, MAX_TRACK_SECONDS), signal), ANALYSIS_RATE).loudness;
    startSeconds = pickMusicStart(levels, videoSeconds);
  }
  startSeconds = Math.min(Math.max(0, track.seconds - videoSeconds), startSeconds);
  const cut = await run(
    mediaTool("ffmpeg"),
    ["-hide_banner", "-y", "-ss", String(startSeconds), "-t", String(videoSeconds + 0.5), "-i", track.file, "-vn", "-c:a", "libmp3lame", "-q:a", "2", path.join(publicDirectory, "music.mp3")],
    { timeoutMs: FFMPEG_TIMEOUT_MS, signal },
  );
  if (cut.code !== 0) {
    throw new VideoRequestError("video_audio_failed", `The music could not be converted. ${cut.stderr.slice(-300)}`);
  }
  return {
    file: "music.mp3",
    // Lower under a voice; the entry ducks it further while lines are spoken.
    volume: music.volume ?? (quiet ? 0.5 : 0.8),
    startSeconds: round2(startSeconds),
    fadeInSeconds: music.fadeInSeconds ?? 0.4,
    fadeOutSeconds: music.fadeOutSeconds ?? 1.5,
    title: track.title,
  };
}

/** Download, cut and convert every audio input into `publicDirectory`. */
export async function prepareAudio(input: {
  publicDirectory: string;
  videoSeconds: number;
  music: VideoMusic | null;
  /** Synthesised speech for each narration line, in any format ffmpeg reads. */
  narration: { atSeconds: number; audio: Uint8Array }[];
  signal?: AbortSignal;
}): Promise<PreparedAudio> {
  fs.mkdirSync(input.publicDirectory, { recursive: true });
  const notes: string[] = [];
  const narration: PreparedAudio["narration"] = [];
  for (const [index, line] of input.narration.entries()) {
    const raw = path.join(input.publicDirectory, `voice-${index}.src`);
    const file = `voice-${index}.mp3`;
    fs.writeFileSync(raw, line.audio);
    const convert = await run(
      mediaTool("ffmpeg"),
      ["-hide_banner", "-y", "-i", raw, "-vn", "-c:a", "libmp3lame", "-q:a", "3", path.join(input.publicDirectory, file)],
      { timeoutMs: FFMPEG_TIMEOUT_MS, signal: input.signal },
    );
    fs.rmSync(raw, { force: true });
    if (convert.code !== 0) {
      throw new VideoRequestError("video_audio_failed", `Narration line ${index + 1} could not be converted. ${convert.stderr.slice(-300)}`);
    }
    const durationSeconds = await durationOf(path.join(input.publicDirectory, file), input.signal);
    const previous = narration.at(-1);
    if (previous && previous.atSeconds + previous.durationSeconds > line.atSeconds) {
      notes.push(`Narration line ${index} runs ${(previous.atSeconds + previous.durationSeconds - line.atSeconds).toFixed(1)} s into line ${index + 1}. Start line ${index + 1} later or shorten the text.`);
    }
    if (line.atSeconds + durationSeconds > input.videoSeconds) {
      notes.push(`Narration line ${index + 1} ends ${(line.atSeconds + durationSeconds - input.videoSeconds).toFixed(1)} s after the video does. Lengthen the video or shorten the text.`);
    }
    narration.push({ file, atSeconds: line.atSeconds, durationSeconds: round2(durationSeconds) });
  }
  const music = input.music
    ? await prepareMusic(input.music, input.publicDirectory, input.videoSeconds, narration.length > 0, input.signal)
    : null;
  return { music, narration, notes };
}
