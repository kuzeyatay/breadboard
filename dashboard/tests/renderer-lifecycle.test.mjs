import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  playSpeechBlob,
  stopSpeechPlayback,
} from "../src/lib/speech/playback.ts";
import { releaseCanvasPixels } from "../src/app/components/canvas-resource.ts";
import { releaseMediaElement } from "../src/app/components/media-element-resource.ts";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = (relativePath) =>
  fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

function sourceFilesUnder(relativePath) {
  const root = path.join(dashboardRoot, relativePath);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

test("Terminal and Garden Chat release every renderer SSE reader", () => {
  const session = source("src/app/components/hermes/use-agent-session.ts");
  assert.match(
    session,
    /let streamReader: ReadableStreamDefaultReader<Uint8Array> \| null = null;/,
  );
  assert.match(session, /streamReader = response\.body\.getReader\(\);/);
  assert.match(
    session,
    /\} finally \{\s*await disposeAgentStreamReader\(streamReader\);\s*\}/,
  );
  assert.match(
    session,
    /Component teardown detaches this page's viewer only[\s\S]*?abortRef\.current\?\.abort\(\);/,
  );
});

test("Terminal rail drags remove window listeners when their owner unmounts", () => {
  const rail = source("src/app/components/hermes/use-rail-resize.ts");
  assert.match(rail, /const dragCleanupRef = useRef<\(\(\) => void\) \| null>\(null\);/);
  assert.match(
    rail,
    /useEffect\(\s*\(\) => \(\) => \{\s*dragCleanupRef\.current\?\.\(\);\s*dragCleanupRef\.current = null;\s*\},\s*\[\],\s*\);/,
  );
  assert.match(rail, /window\.removeEventListener\("pointermove", handleMove\);/);
  assert.match(rail, /window\.removeEventListener\("pointerup", handleEnd\);/);
  assert.match(rail, /window\.removeEventListener\("pointercancel", handleEnd\);/);
  assert.match(rail, /dragCleanupRef\.current = detach;/);
});

test("garden-card resize drags are owned and disposed by the dashboard", () => {
  const dashboard = source("src/app/dashboard/dashboard-client.tsx");
  assert.match(
    dashboard,
    /const resizeCleanupRef = useRef<\(\(\) => void\) \| null>\(null\);/,
  );
  assert.match(
    dashboard,
    /useEffect\(\s*\(\) => \(\) => \{\s*resizeCleanupRef\.current\?\.\(\);\s*resizeCleanupRef\.current = null;\s*resizeSessionRef\.current = null;\s*\},\s*\[\],\s*\);/,
  );
  assert.match(dashboard, /resizeCleanupRef\.current\?\.\(\);/);
  assert.match(dashboard, /window\.removeEventListener\("pointermove", handleMove\);/);
  assert.match(dashboard, /window\.removeEventListener\("pointerup", handleEnd\);/);
  assert.match(dashboard, /window\.removeEventListener\("pointercancel", handleEnd\);/);
  assert.match(dashboard, /resizeCleanupRef\.current = detach;/);
});

test("Terminal and Garden history polls clean up timers and global listeners", () => {
  for (const relativePath of [
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
    "src/app/components/hermes/garden-agent-chat.tsx",
  ]) {
    const component = source(relativePath);
    assert.match(component, /setInterval\(\(\) => refreshHistory\(true\), 10_000\)/);
    assert.match(component, /window\.clearInterval\(timer\);/);
    assert.match(
      component,
      /document\.removeEventListener\("visibilitychange", onVisibilityChange\);/,
    );
    assert.match(
      component,
      /window\.removeEventListener\(\s*HERMES_SESSIONS_CHANGED_EVENT,\s*onSessionsChanged,\s*\);/,
    );
  }
});

test("history and proposal fetches abort when their renderer owner leaves", () => {
  const sessionClient = source("src/lib/hermes/session-client.ts");
  const session = source("src/app/components/hermes/use-agent-session.ts");
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("src/app/components/hermes/garden-agent-chat.tsx");

  assert.match(sessionClient, /function followSharedRequest<T>\(/);
  assert.match(sessionClient, /request\.consumers\.size === 0/);
  assert.match(sessionClient, /request\.abandon\(\);/);
  assert.match(session, /restoreController\.abort\(\);/);
  assert.match(terminal, /historyController\.abort\(\);/);
  assert.match(garden, /proposalRequestRef\.current\?\.abort\(\);/);
  assert.match(garden, /historyController\.abort\(\);/);
});

test("stopping speech empties the media element before revoking its blob", async () => {
  const calls = [];
  const instances = [];
  const originalAudio = globalThis.Audio;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  class FakeAudio {
    currentTime = 12;
    listeners = new Map();

    constructor(src) {
      this.src = src;
      instances.push(this);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    pause() {
      calls.push("pause");
    }

    removeAttribute(name) {
      calls.push(`remove:${name}`);
      if (name === "src") this.src = "";
    }

    load() {
      calls.push("load");
    }

    async play() {
      calls.push("play");
    }
  }

  let finished = 0;
  try {
    globalThis.Audio = FakeAudio;
    URL.createObjectURL = () => "blob:renderer-lifecycle";
    URL.revokeObjectURL = (url) => calls.push(`revoke:${url}`);

    await playSpeechBlob(new Blob(["audio"]), () => {
      finished += 1;
    });
    stopSpeechPlayback();
    stopSpeechPlayback();
  } finally {
    stopSpeechPlayback();
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }

  assert.equal(instances.length, 1);
  assert.equal(instances[0].src, "");
  assert.equal(instances[0].currentTime, 0);
  assert.equal(finished, 1, "cleanup must notify the owner exactly once");
  assert.deepEqual(calls, [
    "play",
    "pause",
    "remove:src",
    "load",
    "revoke:blob:renderer-lifecycle",
  ]);
});

test("Paint Pomodoro releases both native canvas buffers on teardown", () => {
  const reveal = source("src/lib/paint-reveal.ts");
  const component = source("src/app/components/paint-pomodoro.tsx");

  assert.match(component, /reveal\.destroy\(\);/);
  assert.match(component, /revealRef\.current = null;/);
  assert.match(reveal, /this\.destroyed = true;/);
  assert.match(reveal, /this\.token \+= 1;/);
  assert.match(reveal, /this\.incoming = \[\];/);
  assert.match(reveal, /this\.marks = \[\];/);
  assert.match(reveal, /this\.wash\.width = 0;/);
  assert.match(reveal, /this\.wash\.height = 0;/);
  assert.match(reveal, /this\.canvas\.width = 0;/);
  assert.match(reveal, /this\.canvas\.height = 0;/);
});

test("the CAD viewer releases textures, WebGL context, and canvas buffers", () => {
  const viewer = source("src/app/components/cad/model-viewer.tsx");

  assert.match(viewer, /const textures = new Set<THREE\.Texture>\(\);/);
  assert.match(
    viewer,
    /if \(value instanceof THREE\.Texture\) textures\.add\(value\);/,
  );
  assert.match(
    viewer,
    /for \(const texture of textures\) texture\.dispose\(\);/,
  );
  assert.match(viewer, /renderer\.dispose\(\);/);
  assert.match(viewer, /renderer\.forceContextLoss\(\);/);
  assert.match(viewer, /renderer\.domElement\.width = 0;/);
  assert.match(viewer, /renderer\.domElement\.height = 0;/);
  assert.match(viewer, /refs\.current = null;/);
});

test("the brain graph WebGL probe releases the context it only tests", () => {
  const graph = source("src/lib/quartz-brain-graph/renderer.ts");

  assert.match(
    graph,
    /getExtension\("WEBGL_lose_context"\)\?\.loseContext\(\);/,
  );
  assert.match(graph, /canvas\.width = 0;/);
  assert.match(graph, /canvas\.height = 0;/);
  assert.match(
    graph,
    /app\.destroy\(true, \{ children: true, texture: true, textureSource: true \}\);/,
  );
});

test("the work timer closes Web Audio and disconnects finished chimes", () => {
  const timer = source("src/app/components/work-timer-shortcut.tsx");

  assert.match(timer, /const audio = audioRef\.current;/);
  assert.match(timer, /audioRef\.current = null;/);
  assert.match(timer, /void audio\?\.close\(\)\.catch/);
  assert.match(timer, /oscillator\.addEventListener\(/);
  assert.match(timer, /oscillator\.disconnect\(\);/);
  assert.match(timer, /gain\.disconnect\(\);/);
});

test("interactive visualizers release observers, animation frames, and WebGL", () => {
  const runtime = source("src/lib/hermes/interactive-visualizer-runtime.ts");
  const custom = source("src/lib/hermes/interactive-visualizer-custom.ts");
  const inline = source(
    "src/app/components/hermes/inline-interactive-visualizer.tsx",
  );
  const viewer = source("src/app/components/hermes/artifact-viewer.tsx");

  assert.match(runtime, /function disposeRuntime\(\)/);
  assert.match(runtime, /data\.type==="host-dispose"/);
  assert.equal(
    runtime.match(/cancelAnimationFrame\(frameRequest\)/g)?.length,
    3,
    "every animated renderer must cancel its owned frame",
  );
  assert.match(runtime, /renderer\.forceContextLoss\(\)/);
  assert.match(runtime, /canvas\.width=0;canvas\.height=0;/);
  assert.match(runtime, /cleanups\.push\(\(\)=>bodyObserver\.disconnect\(\)\)/);

  assert.match(
    custom,
    /context\.getExtension\("WEBGL_lose_context"\)\?\.loseContext\(\)/,
  );
  assert.match(custom, /api\.addCleanup\(\(\)=>bodyObserver\.disconnect\(\)\)/);
  assert.match(
    custom,
    /cancelAnimationFrame\(startupFrame\);clearTimeout\(overflowTimer\)/,
  );
  assert.match(custom, /document\.querySelectorAll\("audio,video"\)/);
  assert.match(custom, /document\.querySelectorAll\("canvas"\)/);

  for (const component of [inline, viewer]) {
    assert.match(component, /type: "host-dispose"/);
  }
  assert.match(inline, /key=\{previewUrl\}/);
  assert.match(viewer, /key=\{interactivePreviewUrl\}/);
});

test("inline artifact snapshots have a bounded page-lifetime cache", () => {
  const cards = source("src/app/components/hermes/inline-artifact-cards.tsx");

  assert.match(cards, /const MAX_CACHED_ARTIFACT_QUERIES = 32;/);
  assert.match(cards, /function cacheArtifacts\(/);
  assert.match(cards, /while \(artifactCache\.size > MAX_CACHED_ARTIFACT_QUERIES\)/);
  assert.match(cards, /artifactCache\.delete\(oldest\);/);
  assert.equal(
    cards.match(/cacheArtifacts\(query, /g)?.length,
    3,
    "every artifact snapshot write must pass through the bounded cache",
  );
});

test("canvas ownership releases native pixel buffers immediately", () => {
  const canvas = { width: 8_192, height: 4_096 };
  releaseCanvasPixels(canvas);
  assert.deepEqual(canvas, { width: 0, height: 0 });

  const scene = source("src/app/components/hermes/liquid-glass-scene.ts");
  const glass = source("src/app/components/hermes/use-liquid-glass-bar.ts");
  assert.match(scene, /if \(destroyed\) \{\s*releaseCanvasPixels\(next\);/);
  assert.match(scene, /if \(previous !== next\) releaseCanvasPixels\(previous\);/);
  assert.match(scene, /releaseCanvasPixels\(raster\);\s*raster = null;/);
  assert.match(scene, /releaseCanvasPixels\(canvas\);/);
  assert.match(scene, /colorProbe\.width = 1;\s*colorProbe\.height = 1;/);
  assert.match(glass, /probe\.width = 0;\s*probe\.height = 0;/);
});

test("decoded media is detached at every player ownership boundary", () => {
  const calls = [];
  const media = {
    currentTime: 18,
    pause() {
      calls.push("pause");
    },
    removeAttribute(name) {
      calls.push(`remove:${name}`);
    },
    load() {
      calls.push("load");
    },
  };

  releaseMediaElement(media);
  assert.equal(media.currentTime, 0);
  assert.deepEqual(calls, ["pause", "remove:src", "load"]);

  const wrapper = source("src/app/components/reclaiming-media.tsx");
  assert.match(wrapper, /if \(previous && previous !== element\) releaseMediaElement\(previous\);/);
  assert.match(wrapper, /if \(elementRef\.current === element\) releaseMediaElement\(element\);/);

  for (const relativePath of [
    "src/app/components/chat-message-attachments.tsx",
    "src/app/components/chat-video-link-embed.tsx",
    "src/app/components/hermes/artifact-viewer.tsx",
    "src/app/components/hermes/uploads-panel.tsx",
    "src/app/components/hermes/artifact-video-studio.tsx",
    "src/app/components/hermes/inline-hyperframes-run.tsx",
    "src/app/components/hermes/inline-openmontage-run.tsx",
    "src/app/components/vimax/vimax-film-artifact.tsx",
    "src/app/components/vox-director/vox-production-artifact.tsx",
    "src/app/components/voice-sample-recorder.tsx",
  ]) {
    assert.match(
      source(relativePath),
      /Reclaiming(?:Audio|Video)/,
      `${relativePath} must release its media decoder on teardown`,
    );
  }
});

test("Video Use stops terminal and abandoned recovery resources", () => {
  const card = source("src/app/components/hermes/inline-video-use-run.tsx");
  assert.match(card, /if \(TERMINAL_EVENT_TYPES\.has\(event\.type\)\) \{[\s\S]*?closeStream\(\);/);
  assert.match(card, /let recoveryController: AbortController \| null = null;/);
  assert.match(card, /signal: controller\.signal,/);
  assert.match(
    card,
    /disposed = true;\s*window\.clearTimeout\(timer\);\s*recoveryController\?\.abort\(\);/,
  );
});

test("PDF teardown cancels delayed saves and releases rendered pages", () => {
  const viewer = source(
    "src/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client.tsx",
  );
  assert.match(
    viewer,
    /pointerSaveTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>/,
  );
  assert.match(
    viewer,
    /for \(const timer of pointerSaveTimers\) clearTimeout\(timer\);/,
  );
  assert.match(viewer, /querySelectorAll\("canvas"\)/);
  assert.match(viewer, /forEach\(\(canvas\) => releaseCanvasPixels\(canvas\)\);/);
});

test("completed conversation maps stop polling after their result arrives", () => {
  const map = source("src/app/components/hermes/inline-conversation-map.tsx");
  assert.match(map, /const MAX_CONTEXT_POLL_ATTEMPTS = 48;/);
  assert.match(map, /if \(requestedMapIsReady\(payload, kind, requestedAt\)\) return;/);
  assert.match(map, /attempts < MAX_CONTEXT_POLL_ATTEMPTS/);
  assert.match(map, /signal: controller\.signal,/);
  assert.match(
    map,
    /disposed = true;\s*window\.clearTimeout\(timer\);\s*request\?\.abort\(\);/,
  );
  assert.doesNotMatch(map, /setInterval\(/);
});

test("the browser operator closes its terminal run stream", () => {
  const operator = source("src/app/components/agents/browser-operator.tsx");
  assert.match(operator, /const RUN_STREAM_END_EVENTS = new Set\(/);
  assert.match(
    operator,
    /RUN_STREAM_END_EVENTS\.has\(event\.type\) && esRef\.current === es/,
  );
  assert.match(operator, /esRef\.current = null;\s*es\.close\(\);/);
});

test("every renderer object URL owner revokes at least every URL it creates", () => {
  const owners = sourceFilesUnder("src").filter((file) =>
    fs.readFileSync(file, "utf8").includes("URL.createObjectURL("),
  );
  assert.ok(owners.length > 0, "expected renderer object URL owners");
  for (const file of owners) {
    const text = fs.readFileSync(file, "utf8");
    const created = text.match(/URL\.createObjectURL\(/g)?.length ?? 0;
    const revoked = text.match(/URL\.revokeObjectURL\(/g)?.length ?? 0;
    assert.ok(
      revoked >= created,
      `${path.relative(dashboardRoot, file)} creates ${created} object URLs but exposes ${revoked} revocation paths`,
    );
  }
});

test("renderer global listeners, observers, and intervals have teardown peers", () => {
  const files = [
    "src/app/components",
    "src/app/dashboard",
    "src/app/gardens",
    "src/app/garden",
    "src/app/map",
    "src/app/profile",
  ].flatMap(sourceFilesUnder);

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const relative = path.relative(dashboardRoot, file);
    for (const target of ["window", "document"]) {
      const added = text.match(new RegExp(`${target}\\.addEventListener\\(`, "g"))?.length ?? 0;
      const removed = text.match(new RegExp(`${target}\\.removeEventListener\\(`, "g"))?.length ?? 0;
      assert.ok(removed >= added, `${relative} leaves a ${target} listener unowned`);
    }
    const intervals = text.match(/(?:window\.)?setInterval\(/g)?.length ?? 0;
    const clearedIntervals = text.match(/(?:window\.)?clearInterval\(/g)?.length ?? 0;
    assert.ok(clearedIntervals >= intervals, `${relative} leaves an interval running`);

    const observers = text.match(/new (?:ResizeObserver|MutationObserver|IntersectionObserver)\(/g)?.length ?? 0;
    const disconnected = text.match(/\.disconnect\(\)/g)?.length ?? 0;
    assert.ok(disconnected >= observers, `${relative} leaves an observer connected`);
  }
});

test("large Agent TARS timelines and screenshot failure history are bounded", () => {
  const history = source("src/lib/agent-run-history.ts");
  const gallery = source("src/app/components/agent-tars-screenshot-gallery.tsx");
  for (const relativePath of [
    "src/app/components/agents/browser-operator.tsx",
    "src/app/components/hermes/inline-agent-browser-run.tsx",
    "src/app/components/hermes/inline-browser-run.tsx",
  ]) {
    assert.match(source(relativePath), /appendBoundedAgentRunEvent\(/, relativePath);
  }
  assert.match(history, /MAX_RETAINED_AGENT_RUN_EVENTS = 512/);
  assert.match(history, /next\.slice\(-limit\)/);
  assert.match(gallery, /filter\(\(retainedId\) => screenshotIds\.has\(retainedId\)\)/);
});

test("signature and image-edit canvases release large native backing stores", () => {
  const signature = source("src/app/components/signature-pad.tsx");
  const studio = source("src/app/components/hermes/artifact-image-studio.tsx");
  assert.match(signature, /if \(previous && previous !== canvas\) releaseCanvasPixels\(previous\);/);
  assert.match(signature, /ref=\{attachCanvas\}/);
  assert.match(studio, /const blob = await canvasBlob\(canvas\);\s*releaseCanvasPixels\(canvas\);/);
  assert.match(studio, /finally \{\s*if \(canvas\) releaseCanvasPixels\(canvas\);/);
});

test("voice mode aborts delayed work, network reads, and microphone-open races", () => {
  const voice = source("src/app/components/voice-conversation-overlay.tsx");
  assert.match(voice, /const clearDeferredWork = useCallback\(/);
  assert.match(voice, /for \(const controller of requestAbortRef\.current\) controller\.abort\(\);/);
  assert.match(voice, /window\.clearTimeout\(deferredFinishRef\.current\);/);
  assert.match(voice, /window\.clearTimeout\(resumeListeningRef\.current\);/);
  assert.match(voice, /clearDeferredWork\(\);\s*stopSpeechPlayback\(\);\s*releaseMicrophone\(\);/);
  assert.match(voice, /if \(session !== sessionRef\.current\) \{\s*stream\.getTracks\(\)\.forEach/);
  assert.match(voice, /void context\.close\(\);/);
});

test("MapLibre owners stop polling and release markers, workers, and WebGL", () => {
  const page = source("src/app/map/map-client.tsx");
  const inline = source("src/app/components/hermes/inline-conversation-map.tsx");
  for (const map of [page, inline]) {
    assert.match(map, /request\?\.abort\(\);/);
    assert.match(map, /for \(const marker of markersRef\.current\) marker\.remove\(\);/);
    assert.match(map, /mapRef\.current\?\.remove\(\);/);
  }
  assert.match(page, /if \(request\) return;/, "slow context polls must not overlap");
  assert.match(page, /window\.clearInterval\(timer\);/);
  assert.match(inline, /MAX_CONTEXT_POLL_ATTEMPTS = 48/);
  assert.match(inline, /window\.clearTimeout\(timer\);/);
});
