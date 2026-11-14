// Renders a model-authored Remotion composition with the pinned install in
// `<repo>/remotion-runtime` and hands back the MP4 for artifact import.
//
// Two shapes of work share this file. A one-off video is written into a
// throwaway job folder. An engine project is a kept folder under
// `remotion-runtime/projects/<id>` holding the plan, the sources, the assets
// and the renders, so a later request can change one scene and render again.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { repositoryRoot } from "../runtime-paths.ts";
import { mediaTool, prepareAudio, type PreparedAudio } from "./audio.ts";
import { VIDEO_FORMATS, VideoRequestError, type VideoRequest } from "./request.ts";

export const VIDEO_RENDER_TIMEOUT_MS = 7 * 60_000;
const COMPOSITION_ID = "Breadboard";

/** What sampled frames of a preview say about it, without anyone watching. */
export interface PreviewReport {
  /** A contact sheet of twelve frames, in order. */
  sheetPath: string;
  /** Problems worth another pass, in plain words. Empty when none were found. */
  findings: string[];
  /** Brightness (0 to 255) and motion twice a second. */
  samples: { at: number; brightness: number; motion: number }[];
}

export interface VideoRenderResult extends VideoRequest {
  videoPath: string;
  videoRoot: string;
  renderSeconds: number;
  audio: PreparedAudio;
  /** The kept project folder, when there is one. */
  projectDirectory: string | null;
  report: PreviewReport | null;
  cleanup: () => void;
}

export function remotionRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.REMOTION_RUNTIME_ROOT?.trim()
    ? path.resolve(env.REMOTION_RUNTIME_ROOT.trim())
    : path.join(repositoryRoot(), "remotion-runtime");
}

/**
 * The fixed entry point. The model supplies `Video.tsx`; the soundtrack is
 * layered on here so model code never touches local files.
 */
export function remotionEntrySource(
  request: VideoRequest,
  audio: PreparedAudio = { music: null, narration: [], notes: [] },
): string {
  const { width, height } = VIDEO_FORMATS[request.format];
  return `import React from "react";
import { Audio, Composition, Sequence, interpolate, registerRoot, staticFile } from "remotion";
import Video from "./Video";

const FPS = ${request.fps};
const FRAMES = ${request.durationInFrames};
const MUSIC = ${JSON.stringify(audio.music)};
const NARRATION = ${JSON.stringify(audio.narration)};
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// Fades in and out with the video, and steps back while someone is speaking.
const musicVolume = (frame: number) => {
  const seconds = frame / FPS;
  const fade =
    (MUSIC.fadeInSeconds > 0 ? interpolate(seconds, [0, MUSIC.fadeInSeconds], [0, 1], clamp) : 1) *
    (MUSIC.fadeOutSeconds > 0 ? interpolate(frame, [FRAMES - MUSIC.fadeOutSeconds * FPS, FRAMES], [1, 0], clamp) : 1);
  const duck = NARRATION.reduce((level: number, line: { atSeconds: number; durationSeconds: number }) => {
    const end = line.atSeconds + line.durationSeconds;
    return level * interpolate(seconds, [line.atSeconds - 0.3, line.atSeconds, end, end + 0.4], [1, 0.3, 0.3, 1], clamp);
  }, 1);
  return MUSIC.volume * fade * duck;
};

const Root: React.FC = () => (
  <>
    <Video />
    {MUSIC ? <Audio src={staticFile(MUSIC.file)} volume={musicVolume} /> : null}
    {NARRATION.map((line: { file: string; atSeconds: number }) => (
      <Sequence key={line.file} from={Math.round(line.atSeconds * FPS)} layout="none">
        <Audio src={staticFile(line.file)} />
      </Sequence>
    ))}
  </>
);

registerRoot(() => (
  <Composition
    id="${COMPOSITION_ID}"
    component={Root}
    durationInFrames={FRAMES}
    fps={FPS}
    width={${width}}
    height={${height}}
  />
));
`;
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs: number },
): Promise<{ code: number | null; text: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
      timeout: options.timeoutMs,
      killSignal: "SIGKILL",
    });
    let text = "";
    const collect = (chunk: Buffer) => {
      text = `${text}${chunk.toString("utf8")}`.slice(-400_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, text }));
  });
}

/** The last useful lines of a failed render: the part a model can act on. */
function failureDetail(output: string): string {
  const lines = output
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !/^\s*at\s.+node_modules/.test(line));
  return lines.slice(-24).join("\n").slice(-3_000);
}

/** Stretches of at least `minimum` seconds where `test` holds, as "a to b s". */
function stretches(samples: PreviewReport["samples"], test: (sample: PreviewReport["samples"][number]) => boolean, minimum: number): string[] {
  const found: string[] = [];
  let start: number | null = null;
  samples.forEach((sample, index) => {
    const holds = test(sample);
    if (holds && start === null) start = sample.at;
    const last = index === samples.length - 1;
    if (start !== null && (!holds || last)) {
      if (sample.at - start >= minimum) found.push(`${start.toFixed(1)} to ${sample.at.toFixed(1)} s`);
      start = null;
    }
  });
  return found;
}

/**
 * Turn brightness and motion samples into things worth fixing. Pure, so the
 * thresholds are tested without rendering anything.
 *
 * ponytail: this sees only light and movement. It catches a black screen, a
 * blown-out one and a shot where nothing moves; it cannot judge composition
 * or legibility, which is what the contact sheet is for.
 */
export function previewFindings(samples: PreviewReport["samples"], seconds: number): string[] {
  const body = samples.filter((sample) => sample.at >= 0.5 && sample.at <= seconds - 0.5);
  return [
    ...stretches(body, (sample) => sample.brightness < 9, 1.5).map((span) => `Nearly black from ${span}. If that is not a deliberate pause, the shot is not showing.`),
    ...stretches(body, (sample) => sample.brightness > 225, 1).map((span) => `Nearly white from ${span}. Lights or additive particles are too strong; lower them.`),
    ...stretches(body.slice(1), (sample) => sample.motion < 0.08, 2).map((span) => `Nothing moves from ${span}. Add camera drift or motion, or shorten the hold.`),
  ];
}

async function evaluatePreview(videoPath: string, seconds: number, directory: string, signal?: AbortSignal): Promise<PreviewReport> {
  const ffmpeg = mediaTool("ffmpeg");
  const sheetPath = path.join(directory, "preview-sheet.png");
  const sheet = await run(
    ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-vf", `fps=${(12 / seconds).toFixed(5)},scale=480:-1,tile=4x3`, "-frames:v", "1", sheetPath],
    { signal, timeoutMs: 60_000 },
  );
  if (sheet.code !== 0 || !fs.existsSync(sheetPath)) {
    throw new VideoRequestError("video_render_failed", `The preview could not be sampled. ${sheet.text.slice(-300)}`);
  }
  const stats = await run(
    ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-i", videoPath, "-vf", "fps=2,signalstats,metadata=mode=print:file=-", "-an", "-f", "null", "-"],
    { signal, timeoutMs: 60_000 },
  );
  const samples: PreviewReport["samples"] = [];
  let at = 0;
  let brightness = 0;
  for (const line of stats.text.split(/\r?\n/)) {
    const time = /pts_time:([\d.]+)/.exec(line);
    if (time) at = Number(time[1]);
    const average = /signalstats\.YAVG=([\d.]+)/.exec(line);
    if (average) brightness = Number(average[1]);
    const difference = /signalstats\.YDIF=([\d.]+)/.exec(line);
    if (difference) samples.push({ at: Math.round(at * 10) / 10, brightness: Math.round(brightness), motion: Math.round(Number(difference[1]) * 100) / 100 });
  }
  return { sheetPath, findings: previewFindings(samples, seconds), samples };
}

export async function renderVideo(
  request: VideoRequest,
  options: {
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
    /** One clip per `request.narration` line, synthesised by the caller. */
    narrationAudio?: Uint8Array[];
  } = {},
): Promise<VideoRenderResult> {
  const env = options.env ?? process.env;
  const root = remotionRuntimeRoot(env);
  const cli = path.join(root, "node_modules", "@remotion", "cli", "remotion-cli.js");
  if (!fs.existsSync(cli)) {
    throw new VideoRequestError(
      "video_runtime_unavailable",
      `The video renderer is not installed. Run "npm ci" in ${root} once, then retry.`,
    );
  }
  // Inside the runtime folder so the bundler resolves `remotion`, `react` and
  // the component library from it.
  const project = request.projectId !== null;
  const directory = project ? path.join(root, "projects", request.projectId!) : path.join(root, "jobs", randomUUID());
  const publicDirectory = path.join(directory, "public");
  const renders = project ? path.join(directory, "renders") : directory;
  fs.mkdirSync(publicDirectory, { recursive: true });
  fs.mkdirSync(renders, { recursive: true });
  const cleanup = project ? () => undefined : () => fs.rmSync(directory, { recursive: true, force: true });
  try {
    if (request.code !== null) fs.writeFileSync(path.join(directory, "Video.tsx"), request.code, "utf8");
    if (!fs.existsSync(path.join(directory, "Video.tsx"))) {
      throw new VideoRequestError("video_invalid_arguments", `Project ${request.projectId} has no main file yet. Send code.`);
    }
    for (const [name, source] of Object.entries(request.files)) {
      const target = path.join(directory, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, source, "utf8");
    }
    if (project) {
      if (request.plan !== null) fs.writeFileSync(path.join(directory, "project.json"), request.plan, "utf8");
      fs.mkdirSync(path.join(directory, "metadata"), { recursive: true });
      fs.writeFileSync(
        path.join(directory, "metadata", "generation.json"),
        JSON.stringify(
          {
            title: request.title,
            description: request.description,
            durationSeconds: request.durationSeconds,
            fps: request.fps,
            format: request.format,
            music: request.music,
            narration: request.narration,
            renderedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );
    }
    const audio = await prepareAudio({
      publicDirectory,
      videoSeconds: request.durationSeconds,
      music: request.music,
      narration: request.narration.map((line, index) => ({
        atSeconds: line.atSeconds,
        audio: options.narrationAudio?.[index] ?? new Uint8Array(),
      })),
      signal: options.signal,
    });
    fs.writeFileSync(path.join(directory, "index.tsx"), remotionEntrySource(request, audio), "utf8");
    const videoPath = path.join(renders, request.preview ? "preview.mp4" : project ? "final.mp4" : "video.mp4");
    const started = Date.now();
    const output = await run(
      env.REMOTION_NODE_BIN?.trim() || process.execPath,
      [
        cli,
        "render",
        path.join(directory, "index.tsx"),
        COMPOSITION_ID,
        videoPath,
        `--public-dir=${publicDirectory}`,
        "--log=error",
        "--codec=h264",
        "--overwrite",
        // Shaders and 3D need a real GL backend in the headless browser.
        "--gl=angle",
        ...(request.preview
          ? ["--scale=0.5", "--crf=30"]
          : request.quality === "draft"
            ? ["--scale=0.5", "--crf=28"]
            : ["--crf=20"]),
      ],
      {
        cwd: root,
        // Electron's node needs this to behave as plain node; real node ignores it.
        env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
        signal: options.signal,
        timeoutMs: VIDEO_RENDER_TIMEOUT_MS,
      },
    );
    if (output.code !== 0 || !fs.existsSync(videoPath) || fs.statSync(videoPath).size === 0) {
      throw new VideoRequestError(
        Date.now() - started >= VIDEO_RENDER_TIMEOUT_MS ? "video_timeout" : "video_render_failed",
        `The video did not render.\n${failureDetail(output.text) || "The renderer produced no output."}`,
      );
    }
    return {
      ...request,
      videoPath,
      videoRoot: renders,
      renderSeconds: Math.round((Date.now() - started) / 1000),
      audio,
      projectDirectory: project ? directory : null,
      report: request.preview ? await evaluatePreview(videoPath, request.durationSeconds, renders, options.signal) : null,
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
