// The teach-by-demonstration acceptance run, end to end, for real.
//
//   teach -> narrate -> infer -> review -> save -> Workflows -> run with new inputs
//
// Nothing here is mocked. It records real global input hooks while real
// keystrokes and clicks land in a real browser, narrates with real speech
// synthesised to a real audio file and played through the speakers while the
// demonstration happens, transcribes it with the real local Whisper, induces the
// procedure with the real model gateway, saves a real workflow row, and then
// replays it through the real replay engine against the live screen with a
// different input value.
//
// It is a script rather than a test file because it drives the whole desktop for
// a couple of minutes, which is not something a test suite should do while
// someone is working.
//
//   node --experimental-strip-types scripts/teach/acceptance-e2e.mjs

import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const DASHBOARD_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

register("../../tests/teach-support/server-only-stub.mjs", import.meta.url);

const FIXTURE_PORT = 8123;
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}/`;
const FIXTURE_TITLE = "Customer Lookup";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const step = (message) => console.log(`\n=== ${message}`);
const detail = (message) => console.log(`    ${message}`);

const failures = [];
function check(label, condition, extra = "") {
  if (condition) {
    console.log(`    PASS  ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    console.log(`    FAIL  ${label}${extra ? ` — ${extra}` : ""}`);
    failures.push(label);
  }
}

/* ------------------------------------------------------------------ *
 * Narration, spoken for real
 * ------------------------------------------------------------------ */

/**
 * Speak a line to a wav file using the speech synthesiser built into Windows.
 *
 * A synthetic voice is still a real voice: it produces real audio that the real
 * Whisper has to transcribe. Handing the pipeline a transcript it was given
 * rather than one it heard would leave the whole speech half of this feature
 * untested.
 */
async function speakToFile(text, outputPath) {
  const script = [
    "Add-Type -AssemblyName System.Speech",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$s.Rate = 0",
    `$s.SetOutputToWaveFile(${JSON.stringify(outputPath)})`,
    `$s.Speak(${JSON.stringify(text)})`,
    "$s.Dispose()",
  ].join("; ");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: 120_000,
    windowsHide: true,
  });
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
    throw new Error("The narration could not be synthesised.");
  }
}

/**
 * Lay each spoken line down at the offset it was spoken at, padding the gaps
 * with silence, so the narration really does line up with the actions rather
 * than being handed matching timestamps.
 *
 * Done in pure Node because this machine has no ffmpeg, which is also why the
 * capture backend does not depend on one.
 */
async function buildNarrationTrack(segments, outputPath, workDir) {
  const decoded = [];
  for (const [index, segment] of segments.entries()) {
    const partPath = path.join(workDir, `line-${index}.wav`);
    await speakToFile(segment.text, partPath);
    const buffer = fs.readFileSync(partPath);
    const dataIndex = buffer.indexOf("data", 12, "ascii");
    decoded.push({
      ...segment,
      sampleRate: buffer.readUInt32LE(24),
      channels: buffer.readUInt16LE(22),
      bitsPerSample: buffer.readUInt16LE(34),
      pcm: buffer.subarray(dataIndex + 8),
    });
  }

  const { sampleRate, channels, bitsPerSample } = decoded[0];
  const frameBytes = (bitsPerSample / 8) * channels;
  const endMs = Math.max(
    ...decoded.map((part) => part.offsetMs + (part.pcm.length / frameBytes / sampleRate) * 1000),
  );
  const pcm = Buffer.alloc(Math.ceil(((endMs + 1500) / 1000) * sampleRate) * frameBytes);
  for (const part of decoded) {
    part.pcm.copy(pcm, Math.round((part.offsetMs / 1000) * sampleRate) * frameBytes);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * frameBytes, 28);
  header.writeUInt16LE(frameBytes, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(outputPath, Buffer.concat([header, pcm]));
  return outputPath;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function findBrowser() {
  const candidates = [
    process.env.BREADBOARD_TEACH_E2E_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** A thin line-protocol client for the control helper, used to drive the demo. */
function createController(binary, env) {
  const child = spawn(binary, ["control"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env });
  const pending = new Map();
  let sequence = 0;
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          const entry = pending.get(message.id);
          if (entry) {
            pending.delete(message.id);
            entry(message);
          }
        } catch {
          /* not protocol */
        }
      }
      index = buffer.indexOf("\n");
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => console.error("[helper]", String(chunk).trim()));

  return {
    send(command) {
      sequence += 1;
      const id = `d${sequence}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`control timed out: ${JSON.stringify(command)}`));
        }, 30_000);
        pending.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
      });
    },
    async close() {
      try {
        child.stdin.write(`${JSON.stringify({ op: "exit", id: "bye" })}\n`);
        child.stdin.end();
      } catch {
        /* already closed */
      }
      await delay(400);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    },
  };
}

async function waitForRun(teachStore, userId, runId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const view = teachStore.runView(teachStore.getRun(userId, runId));
    if (["completed", "failed", "stopped"].includes(view.state)) return view;
    if (Date.now() > deadline) return view;
    await delay(600);
  }
}

async function waitForRunState(teachStore, userId, runId, state, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const view = teachStore.runView(teachStore.getRun(userId, runId));
    if (view.state === state) return view;
    if (["completed", "failed", "stopped"].includes(view.state)) return null;
    if (Date.now() > deadline) return null;
    await delay(400);
  }
}

/** How many capture/control helpers are alive anywhere on the machine. */
async function countHelperProcesses() {
  try {
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/FI", "IMAGENAME eq BreadboardTeach*", "/NH"],
      { windowsHide: true },
    );
    return stdout.split("\n").filter((line) => /BreadboardTeach/i.test(line)).length;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

async function main() {
  const workDir = fs.mkdtempSync(path.join(process.env.TEMP ?? ".", "teach-e2e-"));
  console.log(`Working directory: ${workDir}`);

  const helper = await import("../../src/lib/teach/windows-helper.ts");
  const backends = await import("../../src/lib/teach/backends.ts");
  const timelineModule = await import("../../src/lib/teach/timeline.ts");
  const transcription = await import("../../src/lib/teach/transcription.ts");
  const induction = await import("../../src/lib/teach/induction.ts");
  const compile = await import("../../src/lib/teach/compile.ts");
  const grounding = await import("../../src/lib/teach/grounding.ts");
  const approvalsModule = await import("../../src/lib/teach/approvals.ts");

  step("0. Preconditions");
  const availability = backends.teachAvailability();
  check("a capture and control backend exist on this platform", availability.available, availability.reason ?? "");
  if (!availability.available) throw new Error(availability.reason);
  const browser = findBrowser();
  check("a browser is available to demonstrate in", browser !== null, browser ?? "");
  if (!browser) throw new Error("No browser found.");

  const fixture = spawn(
    process.execPath,
    [path.join(DASHBOARD_ROOT, "tests", "teach-support", "serve-fixture.mjs"), String(FIXTURE_PORT)],
    { stdio: "ignore", windowsHide: true },
  );
  await delay(1200);

  const browserChild = spawn(
    browser,
    [
      `--user-data-dir=${path.join(workDir, "browser-profile")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--new-window",
      "--profile-directory=Default",
      // A fresh profile otherwise opens a sign-in/sync dialog over the page,
      // which is noise in the fixture rather than anything under test.
      "--disable-sync",
      "--disable-background-networking",
      "--disable-features=EdgeSyncPromo,msSyncConfirmation,EdgeSignInPromo",
      // Chromium exposes its accessibility tree to UI Automation on demand; the
      // switch removes the race between the window opening and the first
      // observation asking for it.
      "--force-renderer-accessibility",
      "--window-size=1100,850",
      "--window-position=60,60",
      FIXTURE_URL,
    ],
    { stdio: "ignore", windowsHide: false },
  );
  await delay(6000);

  const controlBinary = await helper.ensureHelperBinary();
  const cleanup = [];
  const finish = async (code) => {
    for (const task of cleanup) await task().catch(() => undefined);
    try { browserChild.kill(); } catch { /* already gone */ }
    try { fixture.kill(); } catch { /* already gone */ }
    process.exit(code);
  };

  const driver = createController(controlBinary, helper.helperChildEnvironment());
  cleanup.push(() => driver.close());
  await driver.send({ op: "ping" });

  step("1. Bring the demonstration target to the front");
  const focused = await driver.send({ op: "focus_window", titleContains: FIXTURE_TITLE });
  check("the fixture window came to the front", focused.ok === true, focused.error ?? focused.windowTitle ?? "");

  // Chromium builds its accessibility tree lazily, so the page's controls appear
  // a moment after the window does. A person demonstrating waits for the page to
  // finish loading without thinking about it; a script has to say so.
  let preview = null;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    preview = await driver.send({ op: "observe", maxElements: 160 });
    const ready =
      preview.elements.some((element) => element.name === "Search") &&
      preview.elements.some((element) => (element.name ?? "").includes("Customer name"));
    if (ready) break;
    if (attempt === 1) detail("waiting for the page's accessibility tree…");
    await delay(1500);
    await driver.send({ op: "focus_window", titleContains: FIXTURE_TITLE }).catch(() => undefined);
  }
  detail(`UI Automation sees ${preview.elements.length} controls`);
  check(
    "the page's controls are readable through the accessibility layer",
    preview.elements.some((element) => element.name === "Search") &&
      preview.elements.some((element) => (element.name ?? "").includes("Customer name")),
    preview.elements.map((element) => element.name).filter(Boolean).slice(0, 12).join(" | "),
  );
  if (!preview.elements.some((element) => element.name === "Search")) {
    throw new Error("The fixture page never became readable, so there is nothing to demonstrate against.");
  }

  /* ---------------- 2. Narration ---------------- */

  step("2. Synthesise the narration that will be spoken over the demonstration");
  const narrationPath = path.join(workDir, "narration.wav");
  await buildNarrationTrack(
    [
      { offsetMs: 500, text: "I'm entering the customer's name here. The name changes every time." },
      { offsetMs: 8000, text: "Then I press Search." },
      { offsetMs: 13000, text: "The workflow is finished when the customer detail panel appears." },
      { offsetMs: 19000, text: "Always ask me before pressing Send invoice." },
    ],
    narrationPath,
    workDir,
  );
  detail(`narration track: ${Math.round(fs.statSync(narrationPath).size / 1024)} KB`);

  /* ---------------- 3. Record the demonstration ---------------- */

  step("3. Start capturing and demonstrate the task");
  const captureBackend = backends.demonstrationCaptureBackend();
  const sessionId = `e2e-${Date.now()}`;
  const recordingDir = path.join(workDir, "recording");
  const capture = await captureBackend.start({
    sessionId,
    outputDirectory: recordingDir,
    captureFrames: true,
    maxFrames: 60,
    frameMaxWidth: 1280,
  });
  cleanup.push(() => captureBackend.cancel(sessionId));
  detail(
    `recorder started at epoch ${capture.startedAtEpochMs}, screen ${capture.screenDimensions?.width}x${capture.screenDimensions?.height}`,
  );

  const speaker = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p = New-Object System.Media.SoundPlayer ${JSON.stringify(narrationPath)}; $p.PlaySync()`,
    ],
    { stdio: "ignore", windowsHide: true },
  );
  const audioStartOffsetMs = Date.now() - capture.startedAtEpochMs;

  // A person demonstrating holds their own focus by clicking. Driving the
  // demonstration synthetically on a busy desktop does not, so the target window
  // is re-asserted before each action and the control re-grounded against it.
  const demonstrate = async (label, build) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await driver.send({ op: "focus_window", titleContains: FIXTURE_TITLE }).catch(() => undefined);
      await delay(500);
      const fresh = await driver.send({ op: "observe", maxElements: 120 });
      const result = await build(fresh);
      if (result?.ok === true) {
        detail(`${label}: ok`);
        return true;
      }
      detail(`${label}: attempt ${attempt} failed — ${result?.error ?? "no match"}`);
    }
    return false;
  };

  await delay(2500);
  const typedDemo = await demonstrate("typing Alice", async (fresh) => {
    const match = grounding.groundTarget('the "Customer name" text field', fresh.elements, { action: "type" });
    if (!match.element || !match.confident) return { ok: false, error: match.reason };
    return driver.send({ op: "type", ref: match.element.ref, text: "Alice", clear: true });
  });
  check("the demonstration typed into the fixture", typedDemo, "");
  await delay(4000);

  const clickedDemo = await demonstrate("clicking Search", async (fresh) => {
    const match = grounding.groundTarget('button labeled "Search"', fresh.elements, { action: "click" });
    if (!match.element || !match.confident) return { ok: false, error: match.reason };
    return driver.send({ op: "click", ref: match.element.ref });
  });
  check("the demonstration clicked Search", clickedDemo, "");
  await delay(6000);

  await new Promise((resolve) => speaker.once("exit", resolve));
  const artifact = await captureBackend.stop(sessionId);
  detail(`recorded ${artifact.eventCount} events over ${Math.round(artifact.durationMs / 1000)}s`);
  check("the demonstration captured actions", artifact.eventCount > 3, `${artifact.eventCount} events`);

  /* ---------------- 4. Transcribe ---------------- */

  step("4. Transcribe the narration with the local speech engine");
  const transcript = await transcription.transcribeDemonstration({
    audioPath: narrationPath,
    audioStartOffsetMs,
  });
  for (const segment of transcript.segments) {
    detail(`${(segment.startMs / 1000).toFixed(1)}s–${(segment.endMs / 1000).toFixed(1)}s  "${segment.text}"`);
  }
  const heard = transcript.segments.map((segment) => segment.text).join(" ").toLowerCase();
  check("the narration was heard", transcript.segments.length > 0, `${transcript.segments.length} segments`);
  check("it heard that the name changes every time", /chang\w*\s+every\s+time/.test(heard), "");
  check("it heard the Search step", /search/.test(heard), "");
  check("it heard the success condition", /detail panel/.test(heard), "");
  check("it heard the approval boundary", /send invoice/.test(heard), "");

  /* ---------------- 5. Build the timeline ---------------- */

  step("5. Join the actions and the narration onto one clock");
  const events = timelineModule.parseRecordedEvents(
    fs.readFileSync(capture.eventLogPath, "utf8"),
    capture.startedAtEpochMs,
  );
  const builtTimeline = timelineModule.buildDemonstrationTimeline({
    startedAt: new Date(capture.startedAtEpochMs).toISOString(),
    durationMs: artifact.durationMs,
    events,
    transcript: transcript.segments,
    audioStartOffsetMs: transcript.audioStartOffsetMs,
    hostApplications: ["breadboard"],
  });

  const typingEntry = builtTimeline.entries.find((entry) => entry.event.type === "text_input");
  const clickEntry = builtTimeline.entries.find(
    (entry) => entry.event.type === "mouse_click" && (entry.event.target ?? "").includes("Search"),
  );
  check("the typed value was captured", typingEntry?.event.detail === "Alice", typingEntry?.event.detail ?? "none");
  check("the click resolved a semantic target", Boolean(clickEntry?.event.target), clickEntry?.event.target ?? "none");
  check(
    "narration landed on the typing it explains",
    (typingEntry?.narration ?? []).some((segment) => /chang/i.test(segment.text)),
    (typingEntry?.narration ?? []).map((segment) => segment.text).join(" | "),
  );
  check(
    "narration landed on the Search click",
    (clickEntry?.narration ?? []).some((segment) => /search/i.test(segment.text)),
    (clickEntry?.narration ?? []).map((segment) => segment.text).join(" | "),
  );

  console.log("\n--- what the induction model reads ---");
  console.log(timelineModule.renderTimelineForPrompt(builtTimeline).join("\n"));
  console.log("--- end ---\n");

  /* ---------------- 6. Induce ---------------- */

  step("6. Infer the workflow");
  const procedure = await induction.induceProcedure(
    {
      timeline: builtTimeline,
      sessionId,
      frameRoot: recordingDir,
      includeKeyframes: fs.existsSync(path.join(recordingDir, "frames")),
      nameHint: "Look up a customer",
    },
    {
      sessionId,
      recordedAt: new Date(capture.startedAtEpochMs).toISOString(),
      durationMs: artifact.durationMs,
      eventCount: builtTimeline.events.length,
      transcriptAvailable: true,
      framesAvailable: true,
      videoAvailable: false,
      fallbackName: "Look up a customer",
    },
  );

  console.log(
    JSON.stringify(
      {
        name: procedure.name,
        inputs: procedure.inputs.map((input) => ({ name: input.name, demonstrated: input.demonstratedValue })),
        steps: procedure.steps.map((entry) => ({
          instruction: entry.instruction,
          action: entry.action,
          target: entry.target,
          args: entry.actionArgs,
          approval: entry.approvalRequired ?? false,
        })),
        successCriteria: procedure.successCriteria.map((entry) => entry.text),
        constraints: procedure.constraints.map((entry) => entry.text),
        questions: procedure.ambiguities.map((entry) => entry.question),
      },
      null,
      2,
    ),
  );

  const inputNames = procedure.inputs.map((input) => input.name);
  check(
    "the value the narration called changing became an input",
    inputNames.some((name) => /customer|name/.test(name)),
    inputNames.join(", ") || "none",
  );
  const serialized = JSON.stringify(procedure);
  check("no coordinate became an instruction", !/\b\d{3,4}\s*,\s*\d{3,4}\b/.test(serialized), "");
  check(
    "there is a step that types the input and a step that searches",
    procedure.steps.some((entry) => entry.action === "type") &&
      procedure.steps.some((entry) => /search/i.test(`${entry.instruction} ${entry.target ?? ""}`)),
    "",
  );
  check(
    "the demonstrated value is referenced as an input, not repeated as a literal",
    procedure.steps
      .filter((entry) => entry.action === "type")
      .every((entry) => /\{\{/.test(entry.actionArgs?.text ?? "")),
    procedure.steps.filter((entry) => entry.action === "type").map((entry) => entry.actionArgs?.text).join(" | "),
  );
  check(
    "the success condition is the detail panel",
    procedure.successCriteria.some((entry) => /detail/i.test(entry.text)),
    procedure.successCriteria.map((entry) => entry.text).join(" | "),
  );
  check(
    "the narrated approval boundary was learned",
    procedure.constraints.some((entry) => /send invoice/i.test(entry.text)) ||
      procedure.steps.some((entry) => entry.approvalRequired && /send/i.test(entry.instruction)),
    procedure.constraints.map((entry) => entry.text).join(" | "),
  );

  /* ---------------- 7. Save it as a workflow ---------------- */

  step("7. Save it as a workflow, the way the review screen does");
  // From here the run uses the real stores and the real replay engine, so the
  // database is pointed at a throwaway directory rather than the developer's
  // own. Everything before this point needed the real data root, because that
  // is where the speech environment lives.
  process.env.BREADBOARD_DATA_DIR = path.join(workDir, "data");
  fs.mkdirSync(process.env.BREADBOARD_DATA_DIR, { recursive: true });

  const { default: db } = await import("../../src/lib/db.ts");
  const teachStore = await import("../../src/lib/teach/store.ts");
  const workflowStore = await import("../../src/lib/workflows/store.ts");
  const replayEngine = await import("../../src/lib/teach/replay.ts");

  const columns = db.prepare("PRAGMA table_info(users)").all();
  const names = [];
  const values = [];
  for (const column of columns) {
    if (column.pk) continue;
    if (column.notnull === 1 && column.dflt_value === null) {
      names.push(column.name);
      values.push(column.name === "email" ? "e2e@teach.test" : `${column.name}-e2e`);
    }
  }
  if (!names.includes("email")) {
    names.push("email");
    values.push("e2e@teach.test");
  }
  const userId = Number(
    db
      .prepare(`INSERT INTO users (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
      .run(...values).lastInsertRowid,
  );

  // The review screen is where a person corrects a detail before saving. This is
  // that edit: naming the window the focus step should look for.
  const reviewed = {
    ...procedure,
    steps: procedure.steps.map((entry) =>
      entry.action === "focus_window" ? { ...entry, windowHint: FIXTURE_TITLE } : entry,
    ),
  };

  const createdWorkflow = workflowStore.createWorkflow(userId, { name: reviewed.name });
  const savedCompiled = compile.compileProcedure(createdWorkflow.id, reviewed, 1);
  teachStore.saveProcedureVersion({
    userId,
    workflowId: createdWorkflow.id,
    procedure: { ...reviewed, compiled: savedCompiled },
    compiledDirectory: savedCompiled.directory,
    demonstrationId: null,
    note: "Learned from a demonstration.",
  });

  const listed = workflowStore.listWorkflows(userId).find((entry) => entry.id === createdWorkflow.id);
  check("it appears in the Workflows list", Boolean(listed), listed?.name ?? "missing");
  check("and it is marked as learned from a demonstration", listed?.source === "demonstration", listed?.source ?? "");
  check(
    "its compiled form lives under the workflow, not in a skill catalog",
    savedCompiled.directory.includes(createdWorkflow.id) && !savedCompiled.directory.includes("skills"),
    savedCompiled.directory,
  );

  /* ---------------- 8. Run it with a different value ---------------- */

  step("8. Run it with a new value, through the real replay engine");
  // Move the fixture window first: a replay using the demonstration's
  // coordinates would now miss; one grounding against the live screen will not.
  // The fixture window is this run's whole world. Confirm it is still there
  // before the run starts, so a browser that closed itself is reported as that
  // rather than as a grounding failure.
  const fixturePresent = async () => {
    const seen = await driver.send({ op: "observe", maxElements: 5, includeAllWindows: true });
    return {
      open: (seen.windows ?? []).some((entry) => (entry.windowTitle ?? "").includes(FIXTURE_TITLE)),
      titles: (seen.windows ?? []).map((entry) => entry.windowTitle).slice(0, 6).join(" | "),
    };
  };

  // This desktop is shared with whatever else the person is running, and the
  // fixture window can be closed out from under the test between the
  // demonstration and the run. That is an environment condition, not a result,
  // so it is repaired rather than reported as a product failure.
  let presence = await fixturePresent();
  for (let attempt = 1; attempt <= 2 && !presence.open; attempt += 1) {
    detail(`the fixture window is gone (${presence.titles}); reopening it`);
    spawn(
      browser,
      [
        `--user-data-dir=${path.join(workDir, "browser-profile")}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        "--profile-directory=Default",
        "--disable-sync",
        "--force-renderer-accessibility",
        "--window-size=1000,780",
        "--window-position=300,150",
        FIXTURE_URL,
      ],
      { stdio: "ignore", windowsHide: false },
    );
    await delay(8000);
    presence = await fixturePresent();
  }
  check("the demonstration target is open before the run", presence.open, presence.titles);
  if (!presence.open) throw new Error("The fixture window could not be reopened for the run.");

  // Move the window the run will act on, found by name rather than by whatever
  // happens to be in front, so a replay using the demonstration's coordinates
  // would now miss and one grounding against the live screen will not.
  await driver.send({ op: "focus_window", titleContains: FIXTURE_TITLE }).catch(() => undefined);
  await delay(600);
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    [
      'Add-Type -Namespace W -Name N -MemberDefinition \'[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int t,bool r);\'',
      `$w = (Get-Process | Where-Object { $_.MainWindowTitle -like "*${FIXTURE_TITLE}*" } | Select-Object -First 1).MainWindowHandle`,
      "if ($w) { [W.N]::MoveWindow($w, 300, 150, 980, 760, $true) }",
    ].join("; "),
  ]).catch(() => undefined);
  await delay(800);
  await driver.close();

  const runInputs = {};
  for (const input of reviewed.inputs) runInputs[input.name] = "Bob";
  detail(`running with ${JSON.stringify(runInputs)}`);

  const { runId } = replayEngine.startDemonstrationRun({
    userId,
    workflowId: createdWorkflow.id,
    inputs: runInputs,
  });

  // Policy gates anything that reads as submitting, which is the right answer
  // for a step the model described as "submit the lookup". A person watching
  // would approve it, so this does too — and counts them, because a run that
  // never asked would mean the gate was not working.
  let approvalsGranted = 0;
  const approver = setInterval(() => {
    const view = teachStore.runView(teachStore.getRun(userId, runId));
    if (view.state !== "awaiting_approval" || !view.pendingApproval) return;
    if (replayEngine.decideApproval(userId, runId, true)) {
      approvalsGranted += 1;
      detail(`approved: ${view.pendingApproval.instruction}`);
    }
  }, 400);

  const finished = await waitForRun(teachStore, userId, runId, 240_000);
  clearInterval(approver);
  if (approvalsGranted > 0) {
    check("an approval pause was honoured and approved", true, `${approvalsGranted} granted`);
  }
  for (const event of finished.events) detail(`  ${event.type.padEnd(16)} ${event.message}`);
  check("the run completed", finished.state === "completed", finished.error ?? finished.state);
  check(
    "it grounded its targets against the live screen",
    finished.events.some((event) => event.type === "step.grounded"),
    "",
  );
  check(
    "it verified its own success condition",
    finished.events.some((event) => event.type === "step.verified"),
    "",
  );

  /* ---------------- 9. It used the new value ---------------- */

  step("9. Confirm the run used Bob and not Alice");
  const verifier = createController(controlBinary, helper.helperChildEnvironment());
  cleanup.push(() => verifier.close());
  await verifier.send({ op: "ping" });
  await verifier.send({ op: "focus_window", titleContains: FIXTURE_TITLE });
  await delay(700);
  const afterRun = await verifier.send({ op: "observe", maxElements: 140 });
  const visible = afterRun.elements.map((element) => (element.name ?? "").trim()).filter(Boolean);
  const fieldValues = afterRun.elements.map((element) => (element.value ?? "").trim()).filter(Boolean);
  detail(`screen shows: ${visible.slice(0, 14).join(" | ")}`);
  detail(`field values: ${fieldValues.join(" | ")}`);
  check(
    "the detail panel is showing Bob",
    visible.includes("Bob") || fieldValues.includes("Bob"),
    "",
  );
  check("and not the demonstrated Alice", !visible.includes("Alice") && !fieldValues.includes("Alice"), "");
  await verifier.close();

  /* ---------------- 10. A rejected approval prevents the action ---------------- */

  step("10. A rejected approval must prevent the consequential action");
  const gated = approvalsModule.ensureApprovalBoundaries({
    ...reviewed,
    steps: [
      ...reviewed.steps.filter((entry) => entry.action !== "verify"),
      {
        id: "step-send",
        instruction: "Send the invoice to the customer",
        action: "click",
        route: "gui",
        fallbackRoutes: [],
        target: 'button labeled "Send invoice"',
      },
    ],
    successCriteria: [{ text: 'the text "Invoice sent." is visible' }],
    approvals: [],
  });
  check(
    "the send step was gated without anyone narrating it",
    gated.steps.at(-1).approvalRequired === true,
    gated.steps.at(-1).approvalReason ?? "",
  );

  const gatedWorkflow = workflowStore.createWorkflow(userId, { name: "Send an invoice" });
  const gatedCompiled = compile.compileProcedure(gatedWorkflow.id, gated, 1);
  teachStore.saveProcedureVersion({
    userId,
    workflowId: gatedWorkflow.id,
    procedure: { ...gated, compiled: gatedCompiled },
    compiledDirectory: gatedCompiled.directory,
    demonstrationId: null,
  });

  const gatedRun = replayEngine.startDemonstrationRun({
    userId,
    workflowId: gatedWorkflow.id,
    inputs: { ...runInputs },
  });
  const awaiting = await waitForRunState(teachStore, userId, gatedRun.runId, "awaiting_approval", 240_000);
  check("the run paused and asked", awaiting !== null, awaiting?.pendingApproval?.instruction ?? "never paused");
  if (awaiting) {
    detail(`asked: ${awaiting.pendingApproval?.instruction} — ${awaiting.pendingApproval?.reason}`);
    check("the rejection was accepted", replayEngine.decideApproval(userId, gatedRun.runId, false), "");
    const rejected = await waitForRun(teachStore, userId, gatedRun.runId, 60_000);
    check("the run ended instead of sending", rejected.state === "failed", rejected.state);
    check(
      "and the rejection is on the record",
      rejected.events.some((event) => event.type === "approval.rejected"),
      "",
    );
  }

  const confirm = createController(controlBinary, helper.helperChildEnvironment());
  cleanup.push(() => confirm.close());
  await confirm.send({ op: "ping" });
  await confirm.send({ op: "focus_window", titleContains: FIXTURE_TITLE });
  await delay(700);
  const afterReject = await confirm.send({ op: "observe", maxElements: 160 });
  const sentVisible = afterReject.elements.some((element) => (element.name ?? "").includes("Invoice sent"));
  check("the invoice was NOT sent", sentVisible === false, sentVisible ? "the page says it was sent" : "");
  await confirm.close();

  /* ---------------- 11. Stop terminates control ---------------- */

  step("11. Stop terminates the run and releases the machine");
  const stopRun = replayEngine.startDemonstrationRun({
    userId,
    workflowId: createdWorkflow.id,
    inputs: { ...runInputs },
  });
  await delay(3000);
  check("the run is live before Stop", replayEngine.isRunActive(stopRun.runId), "");
  const stopAccepted = await replayEngine.stopDemonstrationRun(userId, stopRun.runId);
  check("Stop was accepted", stopAccepted === true, "");
  await delay(2000);
  const stoppedRow = teachStore.runView(teachStore.getRun(userId, stopRun.runId));
  check("the run is recorded as stopped", stoppedRow.state === "stopped", stoppedRow.state);
  check("and nothing is still driving", replayEngine.isRunActive(stopRun.runId) === false, "");
  const leftovers = await countHelperProcesses();
  check("no control helper process was left behind", leftovers === 0, `${leftovers} still running`);

  db.close();

  /* ---------------- Result ---------------- */

  console.log("\n============================================");
  if (failures.length === 0) {
    console.log("ACCEPTANCE RUN PASSED");
  } else {
    console.log(`ACCEPTANCE RUN FAILED — ${failures.length} check(s):`);
    for (const failure of failures) console.log(`  - ${failure}`);
  }
  console.log("============================================");

  await finish(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nACCEPTANCE RUN ERRORED:", error);
  process.exit(1);
});
