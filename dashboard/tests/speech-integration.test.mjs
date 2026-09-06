import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  MAX_SAMPLE_SECONDS,
  calibrationPassage,
  sampleLengthAdvice,
} from "../src/lib/speech/calibration.ts";
import { classifyMicrophoneBlock, microphoneFix } from "../src/lib/speech/microphone-access.ts";
import {
  MICROPHONE_SETTINGS_URI,
  isLoopbackHostname,
} from "../src/lib/speech/system-microphone-settings.ts";
import { parseStartupStatus } from "../src/lib/speech/startup-status.ts";
import {
  appendRecognizedSegment,
  encodePcm16Wav,
  replaceDictationPreview,
} from "../src/lib/speech/live-dictation.ts";
import {
  nextSpeechStep,
  requiredModelName,
  voiceProfileReady,
} from "../src/lib/speech/voice-model.ts";
import {
  prepareLocalSpeech,
  prepareSpeech,
  resetSpeechPreparation,
  speechErrorMessage,
} from "../src/lib/speech/prepare-client.ts";

const source = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const settingsDialog = source("../src/app/components/settings-dialog.tsx");
const toneSettings = source("../src/app/components/settings-voice-calibration.tsx");
const speechSettings = source("../src/app/components/settings-speech.tsx");
const composer = source("../src/app/components/assistant-composer.tsx");
const dictation = source("../src/app/components/speech-dictation-button.tsx");
const actions = source("../src/app/components/assistant-message-actions.tsx");
const synthesize = source("../src/app/api/speech/synthesize/route.ts");
const dictationDownload = source("../src/app/api/speech/synthesize/mp3/route.ts");
const synthesis = source("../src/lib/speech/synthesis.ts");
const speechMediaExecutor = source("../scripts/runtime-v2-speech-media-executor.mjs");
const speechMediaJob = source("../src/lib/runtime-v2/speech-media-job.ts");
const sampleUpload = source("../src/app/api/speech/profiles/[profileId]/samples/route.ts");
const transcribe = source("../src/app/api/speech/transcribe/route.ts");
const prepare = source("../src/app/api/speech/prepare/route.ts");
const status = source("../src/app/api/speech/status/route.ts");
const voiceboxClient = source("../src/lib/speech/voicebox-client.ts");
const speechStore = source("../src/lib/speech/settings.ts");
const recorder = source("../src/app/components/voice-sample-recorder.tsx");
const permissionHelp = source("../src/app/components/microphone-permission-help.tsx");
const prepareClient = source("../src/lib/speech/prepare-client.ts");

test("Settings label writing calibration as Tone and audio controls as Voice", () => {
  assert.match(settingsDialog, /value: "voice",\s*label: "Tone"/);
  assert.match(settingsDialog, /value: "speech",\s*label: "Voice"/);
  assert.match(toneSettings, /Tone calibration/);
  assert.doesNotMatch(toneSettings, /Voice calibration/);
  assert.doesNotMatch(toneSettings, /Using defaults/);
});

test("Intelligence settings expose Breadboard-styled Voicebox speech controls", () => {
  assert.match(settingsDialog, /value: "speech"/);
  assert.match(settingsDialog, /<SettingsSpeech/);
  assert.match(speechSettings, /Local speech service/);
  assert.match(speechSettings, /Read responses aloud/);
  assert.match(speechSettings, /Add a voice/);
  assert.match(speechSettings, /Dictation/);
  assert.match(speechSettings, /Local speech models/);
  assert.match(speechSettings, /starts and prepares Voicebox automatically/);
  assert.match(speechSettings, /prepareLocalSpeech\(\)/);
  assert.match(prepareClient, /fetchSpeechApi\("\/api\/speech\/prepare"/);
  assert.match(speechSettings, /void prepare\(\)/);
  assert.match(speechSettings, /status\?\.available \? load\(\) : prepare\(\)/);
  assert.match(speechSettings, /installActive \? 2_000 : 5_000/);
  assert.match(speechSettings, /Hardware compatibility/);
  assert.match(speechSettings, /Apple Silicon/);
  assert.match(speechSettings, /NVIDIA GPU/);
  assert.match(speechSettings, /AMD Radeon/);
  assert.match(speechSettings, /Intel Arc/);
  assert.match(speechSettings, /Windows GPU/);
  assert.match(speechSettings, /DirectML/);
  assert.match(speechSettings, /A dedicated GPU is optional/);
  assert.match(speechSettings, /showHardwareGuide/);
  assert.match(speechSettings, /startup\?\.phase !== "installed"/);
  assert.match(speechSettings, /const primaryButton =\s*\n\s*"neu-button-accent/);
  assert.match(speechSettings, /var\(--paper-/);
  assert.match(speechSettings, /var\(--botanical\)/);
});

test("every shared assistant composer receives recording and transcription", () => {
  assert.match(composer, /<SpeechDictationButton/);
  assert.match(composer, /textareaRef=\{internalTextareaRef\}/);
  assert.match(dictation, /requestForegroundMicrophone/);
  assert.match(dictation, /new MediaRecorder/);
  assert.match(dictation, /createScriptProcessor/);
  assert.match(dictation, /dictation-partial\.wav/);
  assert.match(dictation, /encodePcm16Wav/);
  assert.match(dictation, /recorder\.start\(\)/);
  assert.doesNotMatch(dictation, /recorder\.start\(250\)/);
  assert.match(dictation, /\/api\/speech\/transcribe/);
  assert.match(dictation, /stopForegroundStream/);
  assert.match(dictation, /5 \* 60_000/);
  assert.match(dictation, /aria-label=\{label\}/);
  assert.match(dictation, /<MicrophonePermissionHelp/);
  assert.match(permissionHelp, /openSystemMicrophoneSettings/);
});

test("voice mode can warm Voicebox before recording the first turn", () => {
  assert.match(prepare, /export async function POST\(\)/);
  assert.match(prepare, /requireUserId\(\)/);
  assert.match(prepare, /voiceboxJson<\{ models: unknown\[\] \}>\("\/models\/status"/);
  assert.match(voiceboxClient, /startupFailureMessage\(\)/);
  assert.match(dictation, /await prepareLocalSpeech\(prepareController\.signal\)/);
  assert.ok(
    dictation.indexOf("await prepareLocalSpeech(prepareController.signal)") <
      dictation.indexOf("await requestForegroundMicrophone"),
    "Dictate live must wait for Voicebox before it starts capturing audio",
  );
  assert.match(prepareClient, /SPEECH_RECONNECT_DELAYS_MS/);
  assert.doesNotMatch(prepareClient, /throw lastFailure/);
  assert.match(prepareClient, /Breadboard lost its connection to speech/);

  const launcher = source("../../scripts/start-voicebox.mjs");
  assert.doesNotMatch(launcher, /["']import backend\.main["']/);
  assert.match(launcher, /importlib\.util\.find_spec/);
  assert.match(launcher, /stderrTail/);
  assert.match(launcher, /lastStderrLine\(\)/);
});

test("local speech startup is shared, reconnects once, and hides raw fetch errors", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let finishFirstRequest;
  const firstRequest = new Promise((resolve) => {
    finishFirstRequest = resolve;
  });
  try {
    globalThis.fetch = async () => {
      calls += 1;
      await firstRequest;
      return new Response('{"ready":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const first = prepareLocalSpeech();
    const second = prepareLocalSpeech();
    assert.equal(first, second);
    finishFirstRequest();
    await Promise.all([first, second]);
    assert.equal(calls, 1);

    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 2) throw new TypeError("Failed to fetch");
      return new Response('{"ready":true}', { status: 200 });
    };
    await prepareLocalSpeech();
    assert.equal(calls, 3);
    assert.equal(
      speechErrorMessage(new TypeError("Failed to fetch"), "fallback"),
      "Breadboard lost its connection to speech. Try again in a moment.",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("switching speech provider bypasses an old in-flight local cold start", async () => {
  const originalFetch = globalThis.fetch;
  let finishLocal;
  let calls = 0;
  const pending = new Promise((resolve) => { finishLocal = resolve; });
  try {
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) await pending;
      return Response.json({ ready: true });
    };
    const local = prepareLocalSpeech();
    resetSpeechPreparation();
    const cloud = prepareSpeech();
    assert.notEqual(local, cloud);
    await cloud;
    assert.equal(calls, 2);
    finishLocal();
    await local;
  } finally {
    finishLocal();
    resetSpeechPreparation();
    globalThis.fetch = originalFetch;
  }
});

test("live dictation sends Voicebox-native WAV and revises only its own draft", async () => {
  const sourceRate = 48_000;
  const samples = new Float32Array(sourceRate);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((index / sourceRate) * Math.PI * 2 * 220) * 0.2;
  }
  const wav = encodePcm16Wav(
    [samples.subarray(0, 12_000), samples.subarray(12_000)],
    sourceRate,
  );
  const bytes = new DataView(await wav.arrayBuffer());
  const ascii = (offset, length) =>
    String.fromCharCode(...new Uint8Array(bytes.buffer, offset, length));

  assert.equal(wav.type, "audio/wav");
  assert.equal(wav.size, 44 + 16_000 * 2);
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(bytes.getUint16(22, true), 1);
  assert.equal(bytes.getUint32(24, true), 16_000);
  assert.equal(bytes.getUint16(34, true), 16);
  assert.equal(appendRecognizedSegment("hello", " world "), "hello world");
  assert.equal(
    replaceDictationPreview("Draft hello tail", "hello", "hello world"),
    "Draft hello world tail",
  );
  assert.equal(replaceDictationPreview("Typed first", "", "heard now"), "Typed first heard now");
  assert.match(transcribe, /response\.status === 202/);
  assert.match(transcribe, /downloading: true/);
});

test("a blocked microphone hands back a way out, not a dead end", () => {
  const chrome =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const edge = `${chrome} Edg/141.0.0.0`;
  const firefox = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0";
  const safari =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15";

  // The three refusals arrive as one identical NotAllowedError, so the stored
  // permission and Chromium's wording are all there is to tell them apart.
  assert.equal(classifyMicrophoneBlock({ permission: "denied" }), "browser");
  assert.equal(classifyMicrophoneBlock({ permission: "granted" }), "system");
  assert.equal(classifyMicrophoneBlock({ permission: "prompt", message: "Permission dismissed" }), "ask");
  // Nothing is stored against the page, so the browser will still prompt —
  // sending someone to Windows settings for that is wrong and much slower.
  assert.equal(classifyMicrophoneBlock({ permission: "prompt" }), "ask");
  assert.equal(
    classifyMicrophoneBlock({ permission: "granted", message: "Permission denied by system" }),
    "system",
  );
  // Firefox answers nothing at all about the microphone permission, but a
  // Windows denial reaches it as NotFoundError — so this is Firefox's own block.
  assert.equal(classifyMicrophoneBlock({ userAgent: firefox }), "browser");
  assert.equal(classifyMicrophoneBlock({}), "unknown");
  // The desktop shell has no per-site permission that could be the blocker.
  assert.equal(classifyMicrophoneBlock({ desktopShell: true }), "system");

  // A site-level block names this browser's own settings, and offers the
  // address to paste because browsers refuse to open chrome:// from a page.
  const blockedInEdge = microphoneFix({ userAgent: edge, permission: "denied", platform: "Windows" });
  assert.equal(blockedInEdge.source, "browser");
  assert.match(blockedInEdge.headline, /Microsoft Edge is blocking/);
  assert.equal(blockedInEdge.copy.value, "edge://settings/content/microphone");
  assert.equal(blockedInEdge.action, null);
  assert.equal(
    microphoneFix({ userAgent: chrome, permission: "denied" }).copy.value,
    "chrome://settings/content/microphone",
  );
  // Firefox's own block is what a Firefox NotAllowedError means, and the
  // temporary variant never prompts again — which is what makes it look
  // permanent to someone who only dismissed a prompt once.
  const blockedInFirefox = microphoneFix({ userAgent: firefox, platform: "Win32" });
  assert.equal(blockedInFirefox.source, "browser");
  assert.match(blockedInFirefox.steps.join(" "), /padlock/);
  assert.match(blockedInFirefox.steps.join(" "), /Blocked Temporarily/);
  assert.equal(blockedInFirefox.copy.value, "about:preferences#privacy");
  assert.match(
    microphoneFix({ userAgent: safari, permission: "denied" }).steps.join(" "),
    /Safari → Settings → Websites → Microphone/,
  );

  // A system-level block is openable from here on both desktop platforms, and
  // the fallback is a route that needs no button at all.
  const windowsBlock = microphoneFix({ userAgent: chrome, platform: "Windows", permission: "granted" });
  assert.equal(windowsBlock.source, "system");
  assert.equal(windowsBlock.action.label, "Open Windows microphone settings");
  assert.match(windowsBlock.action.manual, /Windows\+R, paste ms-settings:privacy-microphone/);
  assert.match(windowsBlock.steps.join(" "), /Let desktop apps access your microphone/);
  const macBlock = microphoneFix({ userAgent: safari, platform: "MacIntel", permission: "granted" });
  assert.match(macBlock.action.manual, /Privacy & Security → Microphone/);
  // macOS only applies a new grant on the next launch, which is the step people
  // miss and then conclude the fix did not work.
  assert.match(macBlock.steps.join(" "), /Quit and reopen Safari/);

  // The desktop shell opens the same page through its own bridge.
  const desktopBlock = microphoneFix({ desktopShell: true, platform: "win32" });
  assert.equal(desktopBlock.action.label, "Open microphone settings");
  assert.match(desktopBlock.headline, /Breadboard/);

  // The one case that really is a single click: nothing is stored, so asking
  // again pops the browser's own prompt. No settings page, no copied address —
  // and the retry leads instead of trailing the panel.
  const ask = microphoneFix({ userAgent: chrome, platform: "Windows", message: "Permission dismissed" });
  assert.equal(ask.source, "ask");
  assert.equal(ask.action, null);
  assert.equal(ask.copy, null);
  assert.equal(ask.retryLabel, "Allow microphone");
  assert.match(ask.steps.join(" "), /Press Allow microphone below/);
  assert.match(ask.steps.join(" "), /prompt Chrome shows/);
  // The browser's own words ride along, so a wrong guess here is checkable
  // rather than something the user has to argue with.
  assert.equal(ask.detail, "Chrome said: Permission dismissed.");
  assert.equal(microphoneFix({ userAgent: chrome, permission: "denied" }).detail, null);
  // Only the ask branch promotes the retry; everywhere else it trails.
  for (const fix of [blockedInEdge, blockedInFirefox, windowsBlock, macBlock, desktopBlock]) {
    assert.equal(fix.retryLabel, null, `${fix.source} should not lead with a retry`);
  }

  // When nothing identifies the blocker, both routes are offered rather than
  // the shrug the user used to get.
  const unknown = microphoneFix({ platform: "Win32" });
  assert.equal(unknown.source, "unknown");
  assert.match(unknown.steps.join(" "), /Still blocked\?/);
  assert.equal(unknown.action.label, "Open Windows microphone settings");

  // Every branch ends in something pressable here.
  for (const fix of [blockedInEdge, blockedInFirefox, windowsBlock, macBlock, desktopBlock, ask, unknown]) {
    assert.ok(fix.steps.length > 0, `${fix.source} has no steps`);
    assert.ok(fix.action || fix.copy || fix.retryLabel, `${fix.source} offers no control`);
  }
  // The panel always carries the retry, whatever the branch decided.
  assert.match(permissionHelp, /onRetry/);
  assert.match(recorder, /onRetry=\{\(\) => void startRecording\(\)\}/);
  assert.match(dictation, /onRetry=\{\(\) => void startRecording\(\)\}/);
});

test("the desktop shell owns Settings and the browser fallback owns no process", () => {
  const settingsRoute = source("../src/app/api/speech/microphone-settings/route.ts");
  const opener = source("../src/lib/speech/system-microphone-settings.ts");
  const access = source("../src/lib/speech/microphone-access.ts");

  // Firefox refuses to hand an external protocol to Windows from a page and
  // Chromium's confirmation can be silenced for good. Electron therefore uses
  // its narrow desktop bridge; the browser route only supplies manual details.
  assert.doesNotMatch(permissionHelp, /href=\{fix\.action/);
  assert.match(access, /fetch\("\/api\/speech\/microphone-settings", \{ method: "POST" \}\)/);
  assert.match(access, /openDesktopMicrophoneSettings\(\)\) return true/);

  // Signed in, loopback only, and no caller-supplied URL to launch.
  assert.match(settingsRoute, /requireUserId\(\)/);
  assert.match(settingsRoute, /isLoopbackHostname\(requestHostname\(request\)\)/);
  assert.doesNotMatch(settingsRoute, /request\.json\(\)/);
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("[::1]"), true);
  assert.equal(isLoopbackHostname("breadboard.example.com"), false);
  assert.equal(isLoopbackHostname(null), false);

  // Next cannot own Settings: it has to outlive any dashboard request. The
  // Electron main process transfers the fixed URI through the OS shell.
  assert.doesNotMatch(opener, /node:child_process|spawn\s*\(|execFile\s*\(|detached: true/);
  assert.match(opener, /microphonePrivacyPageFallback/);
  assert.equal(MICROPHONE_SETTINGS_URI.win32, "ms-settings:privacy-microphone");
  assert.match(MICROPHONE_SETTINGS_URI.darwin, /^x-apple\.systempreferences:/);
});

test("all shared AI response actions can read and stop responses", () => {
  assert.match(actions, /Read response aloud/);
  assert.match(actions, /\/api\/speech\/synthesize/);
  assert.match(actions, /stopSpeechPlayback/);
  assert.match(actions, /responseTextForSpeech/);
  assert.match(actions, /Cancel speech generation/);
});

test("the response menu saves the spoken reading as a keepable .mp3", () => {
  assert.match(actions, /Download dictation/);
  assert.match(actions, /"\/api\/speech\/synthesize\/mp3"/);
  assert.match(actions, /breadboard-dictation-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}\.mp3/);
  // The reading is the same text the speaker button plays, not the raw
  // Markdown: fences and link syntax are not words anybody wants read out.
  assert.match(actions, /responseTextForSpeech\(content\)/);
  // Synthesis of a long answer takes as long as saying it, so the wait is
  // visible in the menu and a second press cancels it.
  assert.match(actions, /Preparing dictation…/);
  assert.match(actions, /dictationState === "preparing"[\s\S]*?dictationAbortRef\.current\?\.abort\(\)/);

  // The download route holds the reading long enough to seal it as a Runtime
  // input, while the playback route next door still streams its body directly.
  assert.match(dictationDownload, /speechAsMp3/);
  assert.match(dictationDownload, /await spoken\.arrayBuffer\(\)/);
  assert.match(dictationDownload, /attachment; filename=/);
  assert.match(synthesize, /new Response\(response\.body/);
  assert.match(synthesis, /SPEECH_DOWNLOAD_MIME = "audio\/mpeg"/);
  assert.match(synthesis, /encodeSpeechMp3ViaRuntime/);
  assert.doesNotMatch(synthesis, /node:child_process|spawn\s*\(|execFile\s*\(/);
  assert.match(speechMediaExecutor, /"-c:a", "libmp3lame"/);
  assert.match(speechMediaExecutor, /speech_encode_failed/);
  // Runtime owns the private media stage. Its client removes the attempt stage
  // after consuming the finished file; Next never owns an ffmpeg temp process.
  assert.match(speechMediaJob, /finally \{\s*cleanupAttemptStage\(completed\.job\)/);
});

test("Voicebox stays behind authenticated bounded loopback routes", () => {
  for (const route of [synthesize, dictationDownload, transcribe, status]) {
    assert.match(route, /requireUserId\(\)/);
  }
  assert.match(voiceboxClient, /LOOPBACK_HOSTS/);
  assert.match(voiceboxClient, /parsed\.protocol !== "http:"/);
  assert.match(voiceboxClient, /Voicebox must use a private loopback HTTP address/);
  assert.match(synthesis, /MAX_SPEECH_CHARACTERS = 50_000/);
  assert.match(transcribe, /MAX_AUDIO_BYTES/);
  assert.match(speechStore, /speech_user_settings/);
  assert.match(speechStore, /user_id\s+INTEGER PRIMARY KEY/);
});

test("a killed speech install reads as stopped rather than as progress", () => {
  const installing = {
    phase: "acceleration",
    message: "Installing GPU acceleration for NVIDIA RTX 1000 Ada Generation Laptop GPU.",
    startedAt: "2026-08-03T08:16:18.641Z",
    updatedAt: "2026-08-03T08:21:15.806Z",
    pid: 4242,
    step: 3,
    totalSteps: 6,
    detail: "torch 2.11.0+cu128",
    progress: { receivedBytes: 688_128_000, totalBytes: 2_753_189_216 },
  };
  const at = (iso) => Date.parse(iso);
  const alive = () => true;
  const dead = () => false;

  const live = parseStartupStatus(JSON.stringify(installing), {
    now: at("2026-08-03T08:21:18.000Z"),
    isAlive: alive,
  });
  assert.equal(live.stalled, false);
  assert.equal(live.step, 3);
  assert.equal(live.totalSteps, 6);
  assert.equal(live.detail, "torch 2.11.0+cu128");
  assert.equal(live.progress.receivedBytes, 688_128_000);

  // The heartbeat stopped: the installer died even though the phase still
  // reads like work in flight.
  const overdue = parseStartupStatus(JSON.stringify(installing), {
    now: at("2026-08-03T18:21:15.806Z"),
    isAlive: alive,
  });
  assert.equal(overdue.stalled, true);

  // Fresh timestamp but no such process: killed a moment ago.
  const orphaned = parseStartupStatus(JSON.stringify(installing), {
    now: at("2026-08-03T08:21:18.000Z"),
    isAlive: dead,
  });
  assert.equal(orphaned.stalled, true);

  // Outcomes are allowed to sit still for as long as they like.
  for (const phase of ["ready", "installed", "error", "stopped", "interrupted"]) {
    const settled = parseStartupStatus(JSON.stringify({ ...installing, phase }), {
      now: at("2026-08-04T08:21:15.806Z"),
      isAlive: dead,
    });
    assert.equal(settled.stalled, false, `${phase} should not read as stalled`);
  }

  assert.equal(parseStartupStatus("not json"), null);
  assert.equal(parseStartupStatus(JSON.stringify({ phase: "acceleration" })), null);
});

test("the installer survives dependencies that cannot be built on this machine", () => {
  const setup = source("../../scripts/setup-voicebox.mjs");
  // misaki's `ja` extra needs a C++ toolchain to build pyopenjtalk; the clone
  // stays pristine, so the substitution has to live in the installer.
  assert.match(setup, /pyopenjtalk-plus/);
  assert.match(setup, /withoutExtra\(fs\.readFileSync\(requirements, "utf8"\), "misaki", "ja"\)/);
  assert.match(setup, /wheelAvailable\("pyopenjtalk"\)/);
  // pip's own ERROR line, not "python.exe exited with code 1", reaches Settings.
  assert.match(setup, /writeStatus\("error", lastErrorLine \|\| message\)/);
  // Both writers share one heartbeat protocol, which is what makes a killed
  // setup detectable at all.
  const statusWriter = source("../../scripts/voicebox-status.mjs");
  assert.match(setup, /createStatusWriter\(statusPath/);
  assert.match(source("../../scripts/start-voicebox.mjs"), /createStatusWriter\(statusPath\)/);
  assert.match(statusWriter, /setInterval\(persist, HEARTBEAT_MS\)/);
  assert.match(statusWriter, /pid: process\.pid/);
  // OneDrive holds the destination open and makes the atomic rename fail; a
  // status update must never take the install down with it.
  assert.match(statusWriter, /TRANSIENT_CODES/);
  assert.match(statusWriter, /fs\.writeFileSync\(statusPath, payload, "utf8"\)/);
});

test("a voice resolves to the model the backend registry actually publishes", () => {
  // Names must match backend/backends/__init__.py; a drift here would tell the
  // user to download a model that does not exist, or claim a missing one is
  // ready and hand them a silent multi-gigabyte wait mid-synthesis.
  const preset = (engine) => ({ voice_type: "preset", preset_engine: engine, default_engine: engine });
  const cloned = { voice_type: "cloned", default_engine: "qwen" };

  assert.equal(requiredModelName(preset("kokoro"), { engine: "auto", modelSize: "1.7B" }), "kokoro");
  assert.equal(
    requiredModelName(preset("qwen_custom_voice"), { engine: "auto", modelSize: "1.7B" }),
    "qwen-custom-voice-1.7B",
  );
  assert.equal(
    requiredModelName(preset("qwen_custom_voice"), { engine: "auto", modelSize: "0.6B" }),
    "qwen-custom-voice-0.6B",
  );
  assert.equal(requiredModelName(cloned, { engine: "auto", modelSize: "0.6B" }), "qwen-tts-0.6B");
  assert.equal(requiredModelName(cloned, { engine: "chatterbox_turbo", modelSize: "1.7B" }), "chatterbox-turbo");
  assert.equal(requiredModelName(cloned, { engine: "tada", modelSize: "3B" }), "tada-3b-ml");
  assert.equal(requiredModelName(cloned, { engine: "tada", modelSize: "1.7B" }), "tada-1b");
  assert.equal(requiredModelName(cloned, { engine: "luxtts", modelSize: "1.7B" }), "luxtts");
  // An explicit engine overrides the voice's own default.
  assert.equal(requiredModelName(preset("kokoro"), { engine: "chatterbox", modelSize: "1.7B" }), "chatterbox-tts");
  // Unknown engines never block a voice behind an invented download.
  assert.equal(requiredModelName(cloned, { engine: "something-new", modelSize: "1.7B" }), null);
  assert.equal(requiredModelName(null, { engine: "auto", modelSize: "1.7B" }), null);
});

test("the speech panel leads with the one thing left to do", () => {
  const base = {
    serviceAvailable: true,
    voiceName: "Bella",
    modelDisplayName: "Kokoro 82M",
    modelReady: true,
    modelDownloading: false,
    readAloudEnabled: true,
  };
  // The service card owns the not-ready case; the voice section stays quiet.
  assert.equal(nextSpeechStep({ ...base, serviceAvailable: false }), null);
  assert.match(nextSpeechStep({ ...base, voiceName: null }), /^Pick a voice/);
  assert.match(nextSpeechStep({ ...base, voiceReady: false }), /^Finish cloning Bella/);
  assert.match(
    nextSpeechStep({ ...base, modelReady: false }),
    /Bella needs Kokoro 82M downloaded before it can speak/,
  );
  // Downloading outranks "not ready": the user has already acted.
  assert.match(
    nextSpeechStep({ ...base, modelReady: false, modelDownloading: true }),
    /^Downloading Kokoro 82M\./,
  );
  assert.match(nextSpeechStep({ ...base, readAloudEnabled: false }), /Turn on/);
  assert.match(nextSpeechStep(base), /Ready: the speaker button .* speaks as Bella\./);

  assert.match(speechSettings, /nextSpeechStep\(\{/);
  // Choosing a voice or previewing must not fail on the master switch.
  assert.match(speechSettings, /await updateSettings\(draft\?\.speechProvider === "chatgpt"\s*\? \{ enabled: true \} : \{ profileId: target, enabled: true \}\)/);
  // Preferences save on change; there is no submit step to forget.
  assert.doesNotMatch(speechSettings, /Save dictation/);
});

test("an incomplete cloned voice can be repaired but cannot pretend to play", () => {
  assert.equal(voiceProfileReady({ voice_type: "cloned", sample_count: 0 }), false);
  assert.equal(voiceProfileReady({ voice_type: "cloned", sample_count: 1 }), true);
  assert.equal(voiceProfileReady({ voice_type: "preset", sample_count: 0 }), true);
  assert.equal(voiceProfileReady(null), false);

  assert.match(speechSettings, /needs a recording/);
  assert.match(speechSettings, /finishClonedVoice\(profile\)/);
  assert.match(speechSettings, /Finish clone/);
  assert.match(speechSettings, /createdProfileId/);
  assert.match(speechSettings, /method: "DELETE"/);
  assert.match(synthesis, /\/profiles\/\$\{encodeURIComponent\(settings\.profileId\)\}\/samples/);
  assert.match(sampleUpload, /Voicebox could not decode that recording/);
});

test("a model row only shows a control when there is a real action behind it", () => {
  // Voicebox's cancel endpoint pops a dict entry and leaves the HuggingFace
  // transfer running, so there is nothing honest to offer mid-download: status
  // goes on the left, and the action slot stays empty rather than holding a
  // dot that reads as a dead button.
  assert.match(speechSettings, /\{ready \|\| model\.downloading \? null : \(/);
  assert.match(speechSettings, /Downloading… this continues in the background/);
  assert.doesNotMatch(speechSettings, /Cancel download/);
  assert.doesNotMatch(speechSettings, /models\/download\/cancel/);
});

test("a voice can be cloned from a recording made on the spot", () => {
  // Recording is the default way in: the upload path asks for a file the user
  // does not have yet, and for a transcript they have to type from memory.
  assert.match(speechSettings, /useState<"record" \| "upload">\("record"\)/);
  assert.match(speechSettings, /Record now/);
  assert.match(speechSettings, /Upload a file/);
  assert.match(speechSettings, /<VoiceSampleRecorder/);
  assert.match(recorder, /requestForegroundMicrophone/);
  assert.match(recorder, /new MediaRecorder/);
  assert.match(recorder, /Read this aloud/);
  assert.match(recorder, /const recordButton =\s*\n\s*"neu-button-accent/);
  assert.match(recorder, /"Record again"/);
  assert.match(speechSettings, /"Create voice"/);
  // The point of the script: the transcript is the passage, not a retelling.
  assert.match(speechSettings, /passage=\{passage\}/);
  assert.match(speechSettings, /setSampleTranscript\(file \? passage\.text : ""\)/);
  assert.doesNotMatch(speechSettings, /Exact words spoken/);
  assert.match(speechSettings, /sampleMode === "upload"[\s\S]*Transcript/);
  // Staging a sample one way must not leave it behind when switching to the
  // other, or a recording would be uploaded against a file's transcript.
  assert.match(speechSettings, /function selectSampleMode/);
  assert.match(speechSettings, /clearStagedSample\(\)/);
  assert.match(speechSettings, /sampleFileRef\.current\.value = ""/);
  // The microphone and its meter are released whatever ends the take.
  assert.match(recorder, /stopForegroundStream\(streamRef\.current\)/);
  assert.match(recorder, /audioContextRef\.current\?\.close\(\)/);
  assert.match(recorder, /URL\.revokeObjectURL/);
  assert.match(recorder, /MAX_SAMPLE_SECONDS \* 1_000/);
  // Browser MediaRecorder containers are normalized before Voicebox sees
  // them; this avoids relying on a local ffmpeg decoder for WebM/Opus.
  assert.match(recorder, /decodedRecordingAsWav\(blob, 48_000\)/);
  assert.match(recorder, /new File\(\[wav\], "voice-sample\.wav", \{ type: "audio\/wav" \}\)/);
  assert.match(speechSettings, /decodedRecordingAsWav\(sample, 48_000\)/);
  assert.match(speechSettings, /form\.set\("file", preparedSample\)/);
  assert.match(speechSettings, /Breadboard could not prepare that recording/);
  assert.match(synthesis, /has no voice recording yet/);
  // A muted input records perfect silence, which otherwise looks like success.
  assert.match(recorder, /peakRef\.current < SILENT_PEAK|peak < SILENT_PEAK/);
  assert.match(recorder, /almost silent/);
});

test("the calibration script matches the language the voice speaks", () => {
  const english = calibrationPassage("en");
  assert.equal(english.translated, true);
  assert.equal(english.dir, "ltr");
  assert.match(english.text, /I'll/); // contractions: clones learn them or lose them

  // Every language the clone form offers has its own passage; reading English
  // aloud in a Japanese profile is a worse clone than reading Japanese.
  const offered = ["en", "zh", "ja", "ko", "de", "fr", "es", "it", "pt", "ru", "tr", "ar", "nl", "pl", "sv", "hi"];
  for (const code of offered) {
    const passage = calibrationPassage(code);
    assert.equal(passage.translated, true, `${code} has no calibration passage`);
    assert.ok(passage.text.length > 40, `${code}'s passage is too short to characterise a voice`);
  }
  assert.equal(calibrationPassage("ar").dir, "rtl");
  assert.equal(calibrationPassage("en-GB").text, english.text);

  // An unknown language still gets a script rather than an empty card.
  const unknown = calibrationPassage("xx");
  assert.equal(unknown.translated, false);
  assert.equal(unknown.text, english.text);
  assert.equal(calibrationPassage("").text, english.text);
});

test("take length is judged out loud, before it disappoints in the clone", () => {
  assert.equal(sampleLengthAdvice(2.4, "recording").tone, "short");
  assert.match(sampleLengthAdvice(2.4, "recording").message, /Keep reading/);
  // A finished short take names its own length: "too short" alone is not
  // actionable when the user cannot see how long they spoke for.
  assert.match(sampleLengthAdvice(2.44, "recorded").message, /2\.4 seconds/);
  assert.equal(sampleLengthAdvice(9, "recording").tone, "good");
  assert.equal(sampleLengthAdvice(9, "recorded").tone, "good");
  assert.equal(sampleLengthAdvice(35, "recorded").tone, "long");
  assert.match(sampleLengthAdvice(35, "recording").message, new RegExp(`${MAX_SAMPLE_SECONDS} seconds`));
  // Boundaries land on the side that reads as encouragement.
  assert.equal(sampleLengthAdvice(5, "recorded").tone, "good");
  assert.equal(sampleLengthAdvice(4.99, "recorded").tone, "good"); // rounds to 5.0
  assert.equal(sampleLengthAdvice(20, "recorded").tone, "good");
  assert.equal(sampleLengthAdvice(0, "recording").tone, "short");
});

test("the speech panel reports install progress instead of an endless spinner", () => {
  assert.match(speechSettings, /Step \$\{startup\.step\} of \$\{startup\.totalSteps\}/);
  assert.match(speechSettings, /role="progressbar"/);
  assert.match(speechSettings, /formatBytes\(progress\.receivedBytes\)/);
  assert.match(speechSettings, /Nothing is installing right now/);
  assert.match(speechSettings, /Running for \$\{runningFor\}/);
  assert.match(voiceboxClient, /parseStartupStatus/);
});
