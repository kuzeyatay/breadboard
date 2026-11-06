import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  EMPTY_GPU_STATE,
  GPU_CRASH_SOFTWARE_THRESHOLD,
  GPU_CRASH_WINDOW_MS,
  configureGpuPreferences,
  describeGpuSwitches,
  installGpuCrashRecorder,
  isGpuDriverFailure,
  parseGpuState,
  prefersSoftwareGl,
  readGpuState,
  withGpuCrash,
  writeGpuState,
  type GpuState,
} from "../src/main/gpu-preferences";
import type { ChildProcessGoneDetails } from "../src/main/gpu-diagnostics";

const NOW = 1_800_000_000_000;

function recordingCommandLine(disabledFeatures = ""): {
  commandLine: { appendSwitch: (name: string, value?: string) => void; getSwitchValue: (name: string) => string };
  switches: string[];
} {
  const switches: string[] = [];
  return {
    commandLine: {
      getSwitchValue: name => name === "disable-features" ? disabledFeatures : "",
      appendSwitch: (name, value) => {
        switches.push(value === undefined ? name : `${name}=${value}`);
      },
    },
    switches,
  };
}

function tempUserData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-gpu-"));
}

test("Windows keeps the selected native view visible and preserves other Chromium feature overrides", () => {
  const dir = tempUserData();
  const existing = "SomeOtherFeature,AnotherFeature<Trial";
  const feature = "CalculateNativeWinOcclusion";
  const configure = (disabled: string, platform: NodeJS.Platform) => {
    const { commandLine, switches } = recordingCommandLine(disabled);
    configureGpuPreferences(commandLine, dir, NOW, EMPTY_GPU_STATE, platform);
    return switches.filter(entry => entry.startsWith("disable-features="));
  };
  assert.deepEqual(configure("", "win32"), [`disable-features=${feature}`]);
  assert.deepEqual(configure(existing, "win32"), [`disable-features=${existing},${feature}`]);
  assert.deepEqual(configure(`${existing},${feature}`, "win32"), []);
  assert.deepEqual(configure(existing, "linux"), []);
});

test("the software-GL opt-in rides along on every launch, healthy GPU or not", () => {
  const { commandLine, switches } = recordingCommandLine();

  const result = configureGpuPreferences(commandLine, tempUserData(), NOW, EMPTY_GPU_STATE);

  assert.ok(switches.includes("enable-unsafe-swiftshader"), switches.join(" "));
  // Stale video overlay planes paint a green sheet over the window on tab switches.
  assert.ok(switches.includes("disable_direct_composition_video_overlays"), switches.join(" "));
  assert.ok(!switches.includes("disable-direct-composition-video-overlays"), "Chromium ignores the removed hyphenated switch");
  assert.equal(result.softwareGl, false);
  // A healthy machine keeps its hardware GPU.
  assert.ok(!switches.some((entry) => entry.startsWith("use-angle")), switches.join(" "));
});

test("repeated recent GPU crashes pin the next launch to SwiftShader", () => {
  const state: GpuState = { crashes: [NOW - 90_000, NOW - 60_000, NOW - 30_000] };
  const { commandLine, switches } = recordingCommandLine();

  const result = configureGpuPreferences(commandLine, tempUserData(), NOW, state);

  assert.equal(result.softwareGl, true);
  assert.ok(switches.includes("use-angle=swiftshader"), switches.join(" "));
  assert.ok(switches.includes("enable-unsafe-swiftshader"), switches.join(" "));
});

test("an isolated crash, or the burst Chromium recovers from, keeps the GPU", () => {
  assert.equal(GPU_CRASH_SOFTWARE_THRESHOLD, 3);
  assert.equal(prefersSoftwareGl({ crashes: [NOW - 1_000] }, NOW), false);
  assert.equal(prefersSoftwareGl({ crashes: [NOW - 2_000, NOW - 1_000] }, NOW), false);
});

test("crashes outside the window stop counting, so a fixed driver is used again", () => {
  const stale: GpuState = {
    crashes: [
      NOW - GPU_CRASH_WINDOW_MS - 1,
      NOW - GPU_CRASH_WINDOW_MS - 2,
      NOW - GPU_CRASH_WINDOW_MS - 3,
    ],
  };

  assert.equal(prefersSoftwareGl(stale, NOW), false);
});

test("a recorded crash is persisted and read back", () => {
  const dir = tempUserData();

  writeGpuState(dir, withGpuCrash(readGpuState(dir), NOW));
  writeGpuState(dir, withGpuCrash(readGpuState(dir), NOW + 1_000));
  writeGpuState(dir, withGpuCrash(readGpuState(dir), NOW + 2_000));

  assert.equal(readGpuState(dir).crashes.length, 3);
  assert.equal(prefersSoftwareGl(readGpuState(dir), NOW + 3_000), true);
});

test("unreadable or hand-edited state is treated as no history", () => {
  const dir = tempUserData();
  fs.writeFileSync(path.join(dir, "gpu-state.json"), "{not json");

  assert.deepEqual(readGpuState(dir), EMPTY_GPU_STATE);
  assert.deepEqual(parseGpuState({ version: 2, crashes: ["yesterday", -1, null] }), EMPTY_GPU_STATE);
  assert.deepEqual(parseGpuState(null), EMPTY_GPU_STATE);
});

test("the crash recorder writes through and reports the fallback once it is due", () => {
  const dir = tempUserData();
  const lines: string[] = [];
  let listener: ((details: ChildProcessGoneDetails) => void) | null = null;
  let clock = NOW;

  installGpuCrashRecorder(
    { onChildProcessGone: (fn) => void (listener = fn), shouldRecordCrashes: () => true },
    dir,
    (line) => lines.push(line),
    () => clock,
  );

  assert.ok(listener, "no crash listener was registered");
  const fire = listener as unknown as (details: ChildProcessGoneDetails) => void;
  const crash = () => fire({ type: "GPU", reason: "crashed", exitCode: 2 });
  crash();
  clock = NOW + 5_000;
  crash();
  assert.equal(lines.length, 0, "a recoverable burst is not worth a log line");

  clock = NOW + 10_000;
  crash();

  assert.equal(readGpuState(dir).crashes.length, 3);
  assert.ok(
    lines.some((line) => line.includes("SwiftShader")),
    lines.join(" | "),
  );
});

test("the applied switches render as a readable command line", () => {
  assert.equal(
    describeGpuSwitches([{ name: "enable-unsafe-swiftshader" }, { name: "use-angle", value: "swiftshader" }]),
    "--enable-unsafe-swiftshader --use-angle=swiftshader",
  );
  assert.equal(describeGpuSwitches([]), "none");
});

test("legacy unclassified exit history cannot force software rendering after an upgrade", () => {
  const dir = tempUserData();
  const crashes = [NOW - 90_000, NOW - 60_000, NOW - 30_000];
  fs.writeFileSync(path.join(dir, "gpu-state.json"), JSON.stringify({ crashes }));
  const { commandLine, switches } = recordingCommandLine();
  assert.equal(configureGpuPreferences(commandLine, dir, NOW).softwareGl, false);
  assert.ok(!switches.includes("use-angle=swiftshader"));

  writeGpuState(dir, { crashes });
  assert.deepEqual(readGpuState(dir), { crashes });
  assert.equal(configureGpuPreferences(recordingCommandLine().commandLine, dir, NOW).softwareGl, true);
});

test("versioned crash history is sanitized and bounded", () => {
  assert.deepEqual(parseGpuState({ version: 2, crashes: [NOW, null, -1, "bad", NOW - 1, Infinity] }),
    { crashes: [NOW - 1, NOW] });
  assert.equal(parseGpuState({ version: 2, crashes: Array.from({ length: 30 }, (_, i) => NOW + i) }).crashes.length, 16);
});

test("shutdown, memory pressure and unrelated child exits are not driver failures", () => {
  for (const reason of ["clean-exit", "killed", "oom", "memory-eviction", "launch-failed", "integrity-failure"]) {
    assert.equal(isGpuDriverFailure({ type: "GPU", reason, exitCode: 2 }), false, reason);
  }
  for (const code of [0, 0xc000026b, 0xc000013a, 0xc000010a, 0xc000012d]) {
    for (const exitCode of [code, code | 0]) {
      assert.equal(isGpuDriverFailure({ type: "GPU", reason: "crashed", exitCode }), false, String(exitCode));
    }
  }
  assert.equal(isGpuDriverFailure({ type: "Utility", reason: "crashed", exitCode: 2 }), false);
  for (const reason of ["crashed", "abnormal-exit"]) {
    for (const exitCode of [2, 34, -1073741819]) {
      assert.equal(isGpuDriverFailure({ type: "GPU", reason, exitCode }), true);
    }
  }
});

test("the observed context loss and shutdown sequence does not trigger SwiftShader", () => {
  const dir = tempUserData();
  let fire: (details: ChildProcessGoneDetails) => void = () => assert.fail("listener missing");
  let clock = NOW;
  let recording = true;
  installGpuCrashRecorder({
    onChildProcessGone: (listener) => { fire = listener; },
    shouldRecordCrashes: () => recording,
  }, dir, () => {}, () => clock);

  fire({ type: "GPU", reason: "crashed", exitCode: 34 });
  clock += 1_000;
  fire({ type: "GPU", reason: "killed", exitCode: 1073807364 });
  clock += 136;
  fire({ type: "GPU", reason: "crashed", exitCode: -1073741205 });
  assert.deepEqual(readGpuState(dir), { crashes: [NOW] });
  assert.equal(prefersSoftwareGl(readGpuState(dir), clock), false);

  // Quit and software-rendering launches disable recording at the host.
  recording = false;
  for (let i = 0; i < 4; i++) fire({ type: "GPU", reason: "crashed", exitCode: 2 });
  assert.deepEqual(readGpuState(dir), { crashes: [NOW] });
});
