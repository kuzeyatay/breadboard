import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { HermesRuntimeAdapter } from "../src/lib/agent-runtime/adapters/hermes.ts";
import { brokerCapabilities } from "../src/lib/hermes/capability-broker.ts";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import { planTask } from "../src/lib/hermes/task-plan.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { shouldAutoSelectVideo, videoCommandText } from "../src/lib/hermes/video-intent.ts";
import {
  FILM_SKILL,
  VIDEO_SKILL,
  VIDEO_SKILLS,
  VIDEO_TOOL,
  VideoRequestError,
  lintVideoLook,
  lintVideoText,
  validateMusicAnalysisRequest,
  validateVideoRequest,
} from "../src/lib/remotion/request.ts";
import { previewFindings, remotionEntrySource } from "../src/lib/remotion/service.ts";
import { analyzeSamples, pickMusicStart } from "../src/lib/remotion/audio.ts";

const SAFE = `import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { fade } from "@remotion/transitions/fade";
import { loadFont } from "@remotion/google-fonts/Inter";

const WIDTH = 1920;
const Video: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: "#FFFFFFFF", opacity: interpolate(frame, [0, 20], [0, 1]) }}>
      Builds finish in 40 seconds on the REST API
    </AbsoluteFill>
  );
};
export default Video;
`;
const request = (code, extra = {}) => ({
  title: "Builds",
  description: "A build time comparison.",
  code,
  durationSeconds: 6,
  ...extra,
});
const rejects = (args, code) =>
  assert.throws(
    () => validateVideoRequest(args),
    (error) => error instanceof VideoRequestError && error.code === code,
  );

test("Video is a ready prebuilt skill on both authenticated chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find((candidate) => candidate.slug === VIDEO_SKILL);
    assert.ok(skill, `expected Video on ${surface}`);
    assert.equal(skill.availability, "ready");
    assert.deepEqual(skill.capabilityContract?.requiredTools, [VIDEO_TOOL]);
    assert.deepEqual(skill.capabilityContract?.requiredArtifactKinds, ["video"]);
    assert.ok(allowedToolsForSurface(surface).includes(VIDEO_TOOL));
  }
  assert.ok(!allowedToolsForSurface("quartz_ai").includes(VIDEO_TOOL));
});

test("the tool is registered with the broker, the adapter and the Hermes plugin", async () => {
  const plan = planTask({ request: "Make a video about our launch", authenticated: true });
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const grant = brokerCapabilities({ plan, surface, userId: 1, grants: [], workspaceRoot: "C:/runtime/session" });
    assert.equal(grant.allowedTools[VIDEO_TOOL], true, surface);
  }
  const adapter = new HermesRuntimeAdapter({
    baseUrl: "http://127.0.0.1:9119",
    chatmockBaseUrl: "http://127.0.0.1:8765/v1",
    sessionToken: "test",
    requestTimeoutMs: 5_000,
  });
  assert.ok((await adapter.listCapabilities()).tools.includes(VIDEO_TOOL));
  const plugin = new URL("../../hermes-agent/plugins/breadboard/", import.meta.url);
  assert.match(fs.readFileSync(new URL("plugin.yaml", plugin), "utf8"), /- video_render/);
  const source = fs.readFileSync(new URL("__init__.py", plugin), "utf8");
  assert.match(source, /"video_render",\s+"\/api\/hermes\/tools\/video",\s+"video"/);
  assert.match(source, /route_kind in \{[^}]*"video"[^}]*\}/);
});

test("the slash command loads the skill with its wording rules", async () => {
  const resolved = await resolveCommandMessage(1, "/video a launch video", process.cwd(), {
    mode: "knowledge",
    surface: "dashboard_terminal",
  });
  assert.deepEqual(resolved.invocations.map((invocation) => invocation.slug), [VIDEO_SKILL]);
  assert.match(resolved.text, /No em dashes/);
  assert.match(resolved.text, /"durationSeconds"/);
});

test("a request to make a video selects the skill, and neighbours keep their turns", () => {
  const ask = (text, priorMessages) =>
    shouldAutoSelectVideo({ text, surface: "garden_chat", authenticated: true, priorMessages });
  for (const text of [
    "make me a 20 second video about our spring release",
    "Can you create a short promo video for the cafe?",
    "I need an animation showing how DNS resolution works",
    "turn these notes into a short explainer video",
    "animate the logo reveal",
    "generate motion graphics for the quarterly numbers",
  ]) {
    assert.ok(ask(text), text);
  }
  for (const text of [
    "make a summary of this video",
    "how do I make a video in Premiere?",
    "generate a photorealistic video of a cat surfing",
    "create a video script for my channel",
    "set up a video call with Sam",
    "add captions to my video",
    "/manim explain the chain rule",
    "what is this video about https://youtu.be/abc",
    "make the heading bigger",
  ]) {
    assert.ok(!ask(text), text);
  }
  const rendered = [{ role: "assistant", content: "The video is rendered: four scenes, 20 seconds." }];
  assert.ok(ask("make the second scene shorter", rendered));
  assert.equal(
    videoCommandText({ text: "make a video about tides", surface: "quartz_ai", authenticated: false }).automatic,
    false,
  );
  assert.equal(
    videoCommandText({ text: "make a video about tides", surface: "dashboard_terminal", authenticated: true }).text,
    "/video make a video about tides",
  );
});

test("source validation accepts a composition and rejects escape hatches", () => {
  const parsed = validateVideoRequest(request(SAFE));
  assert.equal(parsed.durationInFrames, 180);
  assert.equal(parsed.format, "landscape");
  assert.equal(parsed.quality, "standard");
  assert.match(remotionEntrySource(parsed), /FPS = 30;\s+const FRAMES = 180;[\s\S]*width=\{1920\}/);
  const smooth = validateVideoRequest(request(SAFE, { fps: 60 }));
  assert.equal(smooth.durationInFrames, 360);
  assert.match(remotionEntrySource(smooth), /FPS = 60;\s+const FRAMES = 360;/);
  rejects(request(SAFE, { fps: 24 }), "video_invalid_arguments");
  assert.match(
    remotionEntrySource(validateVideoRequest(request(SAFE, { format: "portrait" }))),
    /width=\{1080\}\s+height=\{1920\}/,
  );

  for (const extra of [
    `import fs from "node:fs";`,
    `import _ from "lodash";`,
    `const x = require("child_process");`,
    `const m = await import("remotion");`,
    `fetch("https://example.com");`,
    `const p = process.env;`,
    `const s = staticFile("a.png");`,
    `const u = "http://127.0.0.1:3000/api";`,
    `const h = <div dangerouslySetInnerHTML={{ __html: "" }} />;`,
  ]) {
    rejects(request(`${extra}\n${SAFE}`), "video_invalid_source");
  }
  rejects(request(SAFE.replace("export default Video;", "")), "video_invalid_source");
  rejects(request(SAFE, { durationSeconds: 0 }), "video_invalid_arguments");
  rejects(request(SAFE, { durationSeconds: 999 }), "video_invalid_arguments");
  rejects(request(SAFE, { format: "cinema" }), "video_invalid_arguments");
});

test("on-screen text rules are enforced, and only on visible text", () => {
  assert.deepEqual(lintVideoText(SAFE), []);
  const dash = SAFE.replace("40 seconds on", "40 seconds \u2014 on");
  const caps = SAFE.replace("Builds finish", "BUILDS FINISH FASTER");
  const forced = SAFE.replace("opacity:", `textTransform: "uppercase", opacity:`);
  for (const code of [dash, caps, forced]) {
    assert.equal(lintVideoText(code).length, 1);
    rejects(request(code), "video_text_style");
  }
  // The user's own wording is theirs to keep.
  assert.ok(validateVideoRequest(request(caps, { asRequested: true })));

  // The looks the user ruled out: italic serif accents, numbered scene labels,
  // and orange or purple accent colours. Blue, green and neutrals pass.
  assert.deepEqual(lintVideoLook(SAFE.replace("#FFFFFFFF", "#2447F9")), []);
  assert.deepEqual(lintVideoLook(SAFE.replace("opacity:", `fontFamily: "Archivo, sans-serif", opacity:`)), []);
  assert.deepEqual(lintVideoLook(SAFE.replace("google-fonts/Inter", "google-fonts/RobotoSlab")), []);
  for (const code of [
    SAFE.replace("google-fonts/Inter", "google-fonts/InstrumentSerif"),
    SAFE.replace("google-fonts/Inter", "google-fonts/PlayfairDisplay"),
    SAFE.replace("google-fonts/Inter", "google-fonts/DMSerifDisplay"),
    SAFE.replace("google-fonts/Inter", "google-fonts/Fraunces"),
    SAFE.replace("opacity:", `fontFamily: "Georgia, serif", opacity:`),
    SAFE.replace("opacity:", `fontStyle: "italic", opacity:`),
    SAFE.replace("Builds finish", "<span>01</span> Builds finish"),
    SAFE.replace("#FFFFFFFF", "#E2542B"),
    SAFE.replace("#FFFFFFFF", "#7C3AED"),
  ]) {
    assert.equal(lintVideoLook(code).length, 1, code.slice(0, 200));
    rejects(request(code), "video_text_style");
  }
  assert.ok(validateVideoRequest(request(SAFE.replace("#FFFFFFFF", "#E2542B"), { asRequested: true })));
});

test("music and narration are validated, and the entry plays them", () => {
  const withSound = validateVideoRequest(
    request(SAFE, {
      music: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x", volume: 0.5 },
      narration: [
        { text: "Second line.", atSeconds: 3 },
        { text: "First line.", atSeconds: 0.5 },
      ],
    }),
  );
  assert.equal(withSound.music.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x");
  assert.equal(withSound.music.startSeconds, null);
  assert.deepEqual(withSound.narration.map((line) => line.atSeconds), [0.5, 3]);
  assert.equal(validateVideoRequest(request(SAFE)).music, null);
  assert.ok(validateVideoRequest(request(SAFE, { music: { search: "calm piano no copyright" } })));
  assert.ok(validateVideoRequest(request(SAFE, { music: { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 65 } })));

  for (const music of [
    {},
    { url: "https://youtu.be/dQw4w9WgXcQ", search: "both" },
    { url: "https://example.com/song.mp3" },
    { url: "http://127.0.0.1/watch?v=dQw4w9WgXcQ" },
    { url: "https://www.youtube.com/playlist?list=PL123" },
    { search: "--exec calc" },
    { search: "two\nlines" },
    { search: "ok", volume: 3 },
  ]) {
    rejects(request(SAFE, { music }), "video_invalid_arguments");
  }
  rejects(request(SAFE, { narration: [{ text: "Late.", atSeconds: 99 }] }), "video_invalid_arguments");
  rejects(request(SAFE, { narration: [{ text: "", atSeconds: 1 }] }), "video_invalid_arguments");

  const entry = remotionEntrySource(withSound, {
    music: { file: "music.mp3", volume: 0.5, startSeconds: 61, fadeInSeconds: 0.4, fadeOutSeconds: 1.5, title: "Song" },
    narration: [{ file: "voice-0.mp3", atSeconds: 0.5, durationSeconds: 2 }],
    notes: [],
  });
  assert.match(entry, /staticFile\(MUSIC\.file\)/);
  assert.match(entry, /"voice-0\.mp3"/);
  // A silent video carries no audio data at all.
  assert.match(remotionEntrySource(withSound), /const MUSIC = null;\s+const NARRATION = \[\];/);
});

test("the music excerpt starts on the loud section's entrance, not in the intro", () => {
  // 20 s quiet intro, a jump at 20 s into 30 s of chorus, then a quieter outro.
  const levels = [
    ...Array(20).fill(-30),
    ...Array(30).fill(-9),
    ...Array(20).fill(-18),
  ];
  assert.equal(pickMusicStart(levels, 20), 20);
  // A gentle swell just before the jump must not pull the start early.
  const swell = [...levels];
  swell[19] = -28;
  assert.equal(pickMusicStart(swell, 20), 20);
  // A track no longer than the video starts at the top, and silence is safe.
  assert.equal(pickMusicStart(levels.slice(0, 15), 20), 0);
  assert.equal(pickMusicStart([], 20), 0);
  assert.equal(pickMusicStart(Array(60).fill(-Infinity), 20), 0);
});

test("music analysis finds the pulse, the hits, the break and the drop", () => {
  // 20 s at 120 beats a minute: a kick on every beat, two seconds of silence
  // from 8 s, then the kicks come back louder with a roll just before the end.
  const rate = 11_025;
  const samples = new Float32Array(20 * rate);
  const kick = (at, gain) => {
    for (let i = 0; i < 0.12 * rate; i += 1) {
      const index = Math.round(at * rate) + i;
      if (index < samples.length) samples[index] += gain * Math.sin((2 * Math.PI * 60 * i) / rate) * Math.exp((-30 * i) / rate);
    }
  };
  for (let beat = 0; beat * 0.5 < 20; beat += 1) {
    const at = beat * 0.5;
    if (at >= 8 && at < 10) continue;
    kick(at, at < 8 ? 0.3 : 0.9);
  }
  for (const at of [18.0, 18.2, 18.4, 18.6]) kick(at + 0.05, 0.9);

  const analysis = analyzeSamples(samples, rate, 30);
  assert.equal(analysis.fromSeconds, 30);
  assert.ok(Math.abs(analysis.bpm - 120) <= 1, `bpm ${analysis.bpm}`);
  assert.ok(Math.abs(analysis.beatSeconds - 0.5) < 0.01);
  // Times are reported in track time, on the kicks.
  assert.ok(analysis.hits.length >= 20);
  assert.ok(analysis.hits.every((hit) => hit.at >= 30 && hit.at <= 50));
  assert.ok(analysis.hits.some((hit) => Math.abs(hit.at - 40) < 0.06), "the first kick after the break");
  const fall = analysis.changes.find((change) => change.kind === "fall");
  const rise = analysis.changes.find((change) => change.kind === "rise" && change.at > 39);
  // The kicks are short, so the level already collapses after the last one at 37.5.
  assert.ok(fall && fall.at > 37 && fall.at < 38.3, JSON.stringify(analysis.changes));
  assert.ok(rise && Math.abs(rise.at - 40) < 0.3, JSON.stringify(analysis.changes));
  assert.ok(analysis.loudness.length >= 19);
  assert.ok(analysis.loudness[8] < analysis.loudness[2] - 20, "the break is far quieter");

  // Silence has no tempo and nothing to cut on.
  const quiet = analyzeSamples(new Float32Array(8 * rate), rate);
  assert.equal(quiet.bpm, null);
  assert.deepEqual(quiet.hits, []);
});

test("fades and the analysis request are validated", () => {
  const cut = validateVideoRequest(
    request(SAFE, { durationSeconds: 41.7, fps: 60, music: { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 76.8, fadeInSeconds: 0.05, fadeOutSeconds: 0.2 } }),
  );
  assert.equal(cut.durationInFrames, 2502);
  assert.equal(cut.music.fadeInSeconds, 0.05);
  assert.equal(cut.music.fadeOutSeconds, 0.2);
  rejects(request(SAFE, { music: { search: "ok", fadeOutSeconds: 60 } }), "video_invalid_arguments");

  const analysis = validateMusicAnalysisRequest({ mode: "analyze_music", music: { search: "calm piano", startSeconds: 70 }, durationSeconds: 60 });
  assert.equal(analysis.windowSeconds, 60);
  assert.equal(analysis.music.startSeconds, 70);
  assert.equal(validateMusicAnalysisRequest({ music: { search: "calm piano" } }).windowSeconds, null);
  assert.throws(() => validateMusicAnalysisRequest({}), (error) => error.code === "video_invalid_arguments");
});

test("Film is a ready skill that a request for a 3D video selects; a plain one gets Video", async () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find((candidate) => candidate.slug === FILM_SKILL);
    assert.ok(skill, `expected Film on ${surface}`);
    assert.equal(skill.availability, "ready");
    assert.deepEqual(skill.capabilityContract?.requiredTools, [VIDEO_TOOL]);
  }
  assert.equal(
    videoCommandText({ text: "make a launch video for our app", surface: "garden_chat", authenticated: true }).text,
    "/video make a launch video for our app",
  );
  const pick = (text, priorMessages) => videoCommandText({ text, surface: "garden_chat", authenticated: true, priorMessages }).text;
  assert.equal(pick("make a 3D launch video for our app"), "/film make a 3D launch video for our app");
  assert.equal(pick("create a cinematic animation with particles"), "/film create a cinematic animation with particles");
  // A follow-up stays with the skill that made the piece.
  assert.equal(pick("make the second scene shorter", [{ role: "assistant", content: "The film is rendered: four scenes, 20 seconds." }]), "/film make the second scene shorter");
  assert.equal(pick("make the second scene shorter", [{ role: "assistant", content: "The video is rendered: four scenes, 20 seconds." }]), "/video make the second scene shorter");
  // The simpler skill is kept and still answers to its own command.
  const kept = await resolveCommandMessage(1, "/video a quick clip", process.cwd(), { mode: "knowledge", surface: "dashboard_terminal" });
  assert.deepEqual(kept.invocations.map((invocation) => invocation.slug), [VIDEO_SKILL]);
  const film = await resolveCommandMessage(1, "/film a launch film", process.cwd(), { mode: "knowledge", surface: "dashboard_terminal" });
  assert.deepEqual(film.invocations.map((invocation) => invocation.slug), [FILM_SKILL]);
  assert.match(film.text, /Stage3D/);
  assert.match(film.text, /"projectId"/);
  assert.deepEqual([...VIDEO_SKILLS], [FILM_SKILL, VIDEO_SKILL]);
});

test("an engine project takes several files, the kit and three.js, and can be revised in part", () => {
  const scene = `import React from "react";
import * as THREE from "three";
import { Stage3D, glowPoints, type StageBuild } from "@kit";
import { night } from "./shared";
const build: StageBuild = (ctx) => { const cloud = glowPoints(ctx, 10, 0.02); void THREE; return () => cloud.commit(); };
export const Core: React.FC<{ t: number }> = ({ t }) => <Stage3D build={build} time={t} background={night} />;
`;
  const main = `import React from "react";
import { Core } from "./scenes/Core";
const Video: React.FC = () => <Core t={0} />;
export default Video;
`;
  const project = validateVideoRequest(
    request(main, {
      mode: "preview",
      projectId: "spring-launch",
      project: { title: "Spring launch", scenes: [{ id: "core", file: "scenes/Core.tsx" }] },
      files: { "scenes/Core.tsx": scene, "scenes/shared.ts": `export const night = "#050A08";` },
    }),
  );
  assert.equal(project.preview, true);
  assert.equal(project.projectId, "spring-launch");
  assert.deepEqual(Object.keys(project.files), ["scenes/Core.tsx", "scenes/shared.ts"]);
  assert.match(project.plan, /"Spring launch"/);

  // A revision sends only the file that changed.
  const revision = validateVideoRequest({ ...request(main, { projectId: "spring-launch", files: { "scenes/Core.tsx": scene } }), code: undefined });
  assert.equal(revision.code, null);
  assert.equal(revision.preview, false);
  // Without a project there is nothing to revise.
  rejects({ ...request(main), code: undefined }, "video_invalid_arguments");

  for (const files of [
    { "../escape.tsx": scene },
    { "C:/abs.tsx": scene },
    { "Video.tsx": scene },
    { "scenes/Core.js": scene },
    { "scenes/Empty.tsx": "  " },
  ]) {
    rejects(request(main, { projectId: "p1", files }), "video_invalid_arguments");
  }
  rejects(request(main, { projectId: "Bad Id" }), "video_invalid_arguments");
  // Every file is held to the same source and style rules as the main one.
  rejects(request(main, { projectId: "p1", files: { "scenes/Core.tsx": `import fs from "node:fs";\n${scene}` } }), "video_invalid_source");
  rejects(request(main, { projectId: "p1", files: { "scenes/Core.tsx": `import x from "../../outside";\n${scene}` } }), "video_invalid_source");
  rejects(request(main, { projectId: "p1", files: { "scenes/shared.ts": `export const night = "#E2542B";` } }), "video_text_style");
});

test("preview findings name black, blown-out and motionless stretches", () => {
  const sample = (at, brightness, motion) => ({ at, brightness, motion });
  const healthy = Array.from({ length: 20 }, (_, i) => sample(i * 0.5, 60 + (i % 3) * 10, 2));
  assert.deepEqual(previewFindings(healthy, 10), []);

  const dark = healthy.map((s) => (s.at >= 2 && s.at <= 5 ? { ...s, brightness: 3 } : s));
  assert.match(previewFindings(dark, 10).join(" "), /Nearly black from 2\.0 to 5\.5 s/);
  const hot = healthy.map((s) => (s.at >= 6 && s.at <= 8 ? { ...s, brightness: 240 } : s));
  assert.match(previewFindings(hot, 10).join(" "), /Nearly white from 6\.0/);
  const frozen = healthy.map((s) => (s.at >= 3 && s.at <= 7 ? { ...s, motion: 0 } : s));
  assert.match(previewFindings(frozen, 10).join(" "), /Nothing moves from 3\.0/);
  // A dark first half second is an ordinary fade in, not a fault.
  const fadeIn = healthy.map((s) => (s.at < 0.5 ? { ...s, brightness: 0 } : s));
  assert.deepEqual(previewFindings(fadeIn, 10), []);
});

test("the kept launch project is a valid engine project", () => {
  const directory = new URL("../../remotion-runtime/projects/breadboard-launch/", import.meta.url);
  const plan = JSON.parse(fs.readFileSync(new URL("project.json", directory), "utf8"));
  const read = (name) => fs.readFileSync(new URL(name, directory), "utf8");
  const files = Object.fromEntries(
    [...new Set(plan.scenes.map((scene) => scene.file)), "scenes/shared.ts"].map((name) => [name, read(name)]),
  );
  const launch = validateVideoRequest({
    title: plan.title,
    description: plan.purpose,
    durationSeconds: plan.duration,
    fps: plan.fps,
    music: plan.audio.music,
    projectId: "breadboard-launch",
    project: plan,
    code: read("Video.tsx"),
    files,
  });
  assert.equal(launch.durationInFrames, 2160);
  assert.equal(launch.music.startSeconds, 85.9);
  // Scenes tile the timeline with no gap and end with the film.
  plan.scenes.forEach((scene, index) => {
    const next = plan.scenes[index + 1];
    assert.ok(Math.abs(scene.startTime + scene.duration - (next ? next.startTime : plan.duration)) < 0.03, scene.id);
  });
});
