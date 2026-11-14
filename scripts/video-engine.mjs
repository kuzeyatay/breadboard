#!/usr/bin/env node
// Command line for the video engine: build, preview and render a project kept
// under remotion-runtime/projects/<id>, or measure a song to cut a video to.
//
//   node scripts/video-engine.mjs preview <project-id>
//   node scripts/video-engine.mjs render  <project-id> [--draft] [--out file.mp4]
//   node scripts/video-engine.mjs analyze <youtube-url> [--from seconds] [--seconds n]
//
// A project is plain files: project.json (the plan and the render settings),
// Video.tsx, further sources such as scenes/*.tsx, and renders/. The same
// validation and renderer the chat tool uses run here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.BREADBOARD_REPO_ROOT ??= repo;
const lib = (file) => pathToFileURL(path.join(repo, "dashboard", "src", "lib", "remotion", file)).href;

const [command, target, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const index = rest.indexOf(`--${name}`);
  return index < 0 ? undefined : (rest[index + 1] ?? true);
};

function sources(directory, base = directory, found = {}) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["renders", "public", "metadata", "node_modules"].includes(entry.name)) sources(full, base, found);
    } else if (/\.tsx?$/.test(entry.name)) {
      found[path.relative(base, full).replaceAll("\\", "/")] = fs.readFileSync(full, "utf8");
    }
  }
  return found;
}

if (command === "analyze" && target) {
  const { validateMusicAnalysisRequest } = await import(lib("request.ts"));
  const { analyzeMusic } = await import(lib("audio.ts"));
  const request = validateMusicAnalysisRequest({
    music: { url: target, ...(flag("from") ? { startSeconds: Number(flag("from")) } : {}) },
    ...(flag("seconds") ? { durationSeconds: Number(flag("seconds")) } : {}),
  });
  const { file, ...analysis } = await analyzeMusic(request.music, request.windowSeconds);
  console.log(JSON.stringify(analysis, null, 2));
} else if ((command === "render" || command === "preview") && target) {
  const { validateVideoRequest } = await import(lib("request.ts"));
  const { renderVideo } = await import(lib("service.ts"));
  const directory = path.join(repo, "remotion-runtime", "projects", target);
  const plan = JSON.parse(fs.readFileSync(path.join(directory, "project.json"), "utf8"));
  const { "Video.tsx": code, "index.tsx": _entry, ...files } = sources(directory);
  const result = await renderVideo(
    validateVideoRequest({
      title: plan.title,
      description: plan.purpose ?? plan.title,
      durationSeconds: plan.duration,
      fps: plan.fps,
      format: plan.format,
      music: plan.audio?.music,
      projectId: target,
      project: plan,
      code,
      files,
      mode: command === "preview" ? "preview" : "render",
      quality: flag("draft") ? "draft" : "standard",
    }),
  );
  if (typeof flag("out") === "string") fs.copyFileSync(result.videoPath, flag("out"));
  console.log(
    JSON.stringify(
      {
        video: typeof flag("out") === "string" ? flag("out") : result.videoPath,
        renderSeconds: result.renderSeconds,
        music: result.audio.music,
        ...(result.report ? { sheet: result.report.sheetPath, findings: result.report.findings } : {}),
      },
      null,
      2,
    ),
  );
} else {
  console.error("Usage: video-engine.mjs preview|render <project-id> [--draft] [--out file.mp4]\n       video-engine.mjs analyze <youtube-url> [--from seconds] [--seconds n]");
  process.exit(2);
}
