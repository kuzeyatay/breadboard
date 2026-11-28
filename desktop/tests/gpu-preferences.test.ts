import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  EMPTY_GPU_STATE,
  GPU_ALTERNATE_CRASH_THRESHOLD,
  GPU_CRASH_SOFTWARE_THRESHOLD,
  GPU_CRASH_WINDOW_MS,
  GPU_RETRY_AFTER_MS,
  configureGpuPreferences,
  decideGpuBackend,
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
const HOUR = 60 * 60 * 1_000;

function crashes(backend: "hardware" | "alternate", ...at: number[]): GpuState {
  return { crashes: at.map((when) => ({ at: when, backend })) };
}

function merge(...states: GpuState[]): GpuState {
  return { crashes: states.flatMap((state) => state.crashes).sort((a, b) => a.at - b.at) };
}

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
  assert.ok(!switches.includes("disable-gpu-compositing"), switches.join(" "));
});

test("repeated crashes on the default backend move Windows to another driver path, not the CPU", () => {
  const state = crashes("hardware", NOW - 90_000, NOW - 60_000, NOW - 30_000);
  const { commandLine, switches } = recordingCommandLine();

  const result = configureGpuPreferences(commandLine, tempUserData(), NOW, state, "win32");

  assert.equal(result.backend, "alternate");
  assert.equal(result.softwareGl, false);
  assert.ok(switches.includes("use-angle=d3d11on12"), switches.join(" "));
  assert.ok(!switches.includes("use-angle=swiftshader"), switches.join(" "));
  assert.ok(!switches.includes("disable-gpu-compositing"), switches.join(" "));
});

test("crashes on the alternate backend too pin the next launch to SwiftShader", () => {
  const state = merge(
    crashes("hardware", NOW - 5 * 60_000, NOW - 4 * 60_000, NOW - 3 * 60_000),
    crashes("alternate", NOW - 2 * 60_000, NOW - 60_000),
  );
  assert.equal(GPU_ALTERNATE_CRASH_THRESHOLD, 2);
  const { commandLine, switches } = recordingCommandLine();

  const result = configureGpuPreferences(commandLine, tempUserData(), NOW, state, "win32");

  assert.equal(result.softwareGl, true);
  assert.ok(switches.includes("use-angle=swiftshader"), switches.join(" "));
  assert.ok(switches.includes("enable-unsafe-swiftshader"), switches.join(" "));
  // Compositing through emulated-GPU SwiftShader saturated a four-core laptop
  // (dark window, ~90% CPU); Chromium's software compositor draws it cheaply.
  assert.ok(switches.includes("disable-gpu-compositing"), switches.join(" "));
  assert.equal(decideGpuBackend(crashes("alternate", NOW - 60_000), NOW, "win32"), "hardware",
    "one alternate crash on its own is not a pattern");
});

test("without an alternate backend, repeated crashes go straight to SwiftShader", () => {
  const state = crashes("hardware", NOW - 90_000, NOW - 60_000, NOW - 30_000);
  const { commandLine, switches } = recordingCommandLine();

  const result = configureGpuPreferences(commandLine, tempUserData(), NOW, state, "linux");

  assert.equal(result.backend, "software");
  assert.ok(switches.includes("use-angle=swiftshader"), switches.join(" "));
  assert.ok(switches.includes("disable-gpu-compositing"), switches.join(" "));
});

test("an isolated crash, or the burst Chromium recovers from, keeps the GPU", () => {
  assert.equal(GPU_CRASH_SOFTWARE_THRESHOLD, 3);
  for (const platform of ["win32", "linux"] as const) {
    assert.equal(decideGpuBackend(crashes("hardware", NOW - 1_000), NOW, platform), "hardware");
    assert.equal(decideGpuBackend(crashes("hardware", NOW - 2_000, NOW - 1_000), NOW, platform), "hardware");
  }
});

test("crashes outside the window stop counting, so a fixed driver is used again", () => {
  const stale = crashes(
    "hardware",
    NOW - GPU_CRASH_WINDOW_MS - 3,
    NOW - GPU_CRASH_WINDOW_MS - 2,
    NOW - GPU_CRASH_WINDOW_MS - 1,
  );

  assert.equal(decideGpuBackend(stale, NOW, "win32"), "hardware");
  assert.equal(prefersSoftwareGl(stale, NOW, "linux"), false);
});

test("a quiet fallback steps back toward the GPU every few hours instead of after a day", () => {
  assert.equal(GPU_RETRY_AFTER_MS, 4 * HOUR);
  const state = merge(
    crashes("hardware", NOW - 3, NOW - 2, NOW - 1),
    crashes("alternate", NOW, NOW),
  );
  assert.equal(decideGpuBackend(state, NOW + 1, "win32"), "software");
  assert.equal(decideGpuBackend(state, NOW + 4 * HOUR - 1, "win32"), "software");
  assert.equal(decideGpuBackend(state, NOW + 4 * HOUR, "win32"), "alternate");
  assert.equal(decideGpuBackend(state, NOW + 8 * HOUR, "win32"), "hardware");

  const linux = crashes("hardware", NOW - 2, NOW - 1, NOW);
  assert.equal(decideGpuBackend(linux, NOW + 4 * HOUR - 1, "linux"), "software");
  assert.equal(decideGpuBackend(linux, NOW + 4 * HOUR, "linux"), "hardware");
});

test("a failed retry costs one crash and re-escalates at once", () => {
  // Software since NOW; after four quiet hours the alternate backend is retried.
  const base = merge(crashes("hardware", NOW - 3, NOW - 2, NOW - 1), crashes("alternate", NOW, NOW));
  const retryAt = NOW + 4 * HOUR + 1_000;
  assert.equal(decideGpuBackend(base, retryAt, "win32"), "alternate");
  assert.equal(decideGpuBackend(withGpuCrash(base, retryAt, "alternate"), retryAt + 1, "win32"), "software");

  // Four more quiet hours: the default backend is retried; one crash there sends it back.
  const hardwareAt = NOW + 8 * HOUR + 1_000;
  assert.equal(decideGpuBackend(base, hardwareAt, "win32"), "hardware");
  assert.equal(decideGpuBackend(withGpuCrash(base, hardwareAt, "hardware"), hardwareAt + 1, "win32"), "software",
    "the alternate backend's crashes still count inside the day");
  const onlyHardware = crashes("hardware", NOW - 2, NOW - 1, NOW);
  assert.equal(decideGpuBackend(withGpuCrash(onlyHardware, NOW + 4 * HOUR + 1, "hardware"), NOW + 4 * HOUR + 2, "win32"),
    "alternate");
});

test("a recorded crash is persisted and read back with its backend", () => {
  const dir = tempUserData();

  writeGpuState(dir, withGpuCrash(readGpuState(dir), NOW));
  writeGpuState(dir, withGpuCrash(readGpuState(dir), NOW + 1_000));
  writeGpuState(dir, withGpuCrash(readGpuState(dir), NOW + 2_000, "alternate"));

  assert.deepEqual(readGpuState(dir).crashes.map((crash) => crash.backend), ["hardware", "hardware", "alternate"]);
  writeGpuState(dir, withGpuCrash(readGpuState(dir), NOW + 3_000));
  assert.equal(decideGpuBackend(readGpuState(dir), NOW + 4_000, "win32"), "alternate");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "gpu-state.json"), "utf8")).version, 3);
});

test("unreadable or hand-edited state is treated as no history", () => {
  const dir = tempUserData();
  fs.writeFileSync(path.join(dir, "gpu-state.json"), "{not json");

  assert.deepEqual(readGpuState(dir), EMPTY_GPU_STATE);
  assert.deepEqual(parseGpuState({ version: 2, crashes: ["yesterday", -1, null] }), EMPTY_GPU_STATE);
  assert.deepEqual(parseGpuState({ version: 3, crashes: [NOW, { at: NOW, backend: "software" }, { at: "x", backend: "hardware" }] }),
    EMPTY_GPU_STATE);
  assert.deepEqual(parseGpuState({ version: 4, crashes: [{ at: NOW, backend: "hardware" }] }), EMPTY_GPU_STATE);
  assert.deepEqual(parseGpuState(null), EMPTY_GPU_STATE);
});

test("the crash recorder tags crashes and reports each step of the fallback once it is due", () => {
  const dir = tempUserData();
  const lines: string[] = [];
  let listener: ((details: ChildProcessGoneDetails) => void) | null = null;
  let clock = NOW;
  let backend: "hardware" | "alternate" = "hardware";

  installGpuCrashRecorder(
    { onChildProcessGone: (fn) => void (listener = fn), recordingBackend: () => backend },
    dir,
    (line) => lines.push(line),
    () => clock,
    "win32",
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
  assert.ok(lines.at(-1)?.includes("d3d11on12"), lines.join(" | "));

  // The next launch runs on the alternate backend.
  backend = "alternate";
  clock = NOW + 60_000;
  crash();
  assert.equal(lines.length, 1, "one alternate crash is not yet a pattern");
  clock = NOW + 70_000;
  crash();
  assert.ok(lines.at(-1)?.includes("SwiftShader"), lines.join(" | "));
  assert.deepEqual(readGpuState(dir).crashes.map((entry) => entry.backend),
    ["hardware", "hardware", "hardware", "alternate", "alternate"]);
});

test("the applied switches render as a readable command line", () => {
  assert.equal(
    describeGpuSwitches([{ name: "enable-unsafe-swiftshader" }, { name: "use-angle", value: "swiftshader" }]),
    "--enable-unsafe-swiftshader --use-angle=swiftshader",
  );
  assert.equal(describeGpuSwitches([]), "none");
});

test("legacy unclassified exit history cannot force a fallback after an upgrade", () => {
  const dir = tempUserData();
  const at = [NOW - 90_000, NOW - 60_000, NOW - 30_000];
  fs.writeFileSync(path.join(dir, "gpu-state.json"), JSON.stringify({ crashes: at }));
  const { commandLine, switches } = recordingCommandLine();
  assert.equal(configureGpuPreferences(commandLine, dir, NOW, undefined, "win32").backend, "hardware");
  assert.ok(!switches.some((entry) => entry.startsWith("use-angle")));
});

test("version 2 history from 0.1.18 and earlier carries over as hardware crashes", () => {
  const dir = tempUserData();
  const at = [NOW - 90_000, NOW - 60_000, NOW - 30_000];
  fs.writeFileSync(path.join(dir, "gpu-state.json"), JSON.stringify({ version: 2, crashes: at }));
  assert.deepEqual(readGpuState(dir), crashes("hardware", ...at));
  // A machine that 0.1.18 put on SwiftShader now tries the other driver path first.
  assert.equal(configureGpuPreferences(recordingCommandLine().commandLine, dir, NOW, undefined, "win32").backend, "alternate");
  assert.equal(configureGpuPreferences(recordingCommandLine().commandLine, dir, NOW, undefined, "linux").softwareGl, true);
});

test("versioned crash history is sanitized and bounded", () => {
  assert.deepEqual(parseGpuState({ version: 2, crashes: [NOW, null, -1, "bad", NOW - 1, Infinity] }),
    crashes("hardware", NOW - 1, NOW));
  assert.equal(parseGpuState({ version: 2, crashes: Array.from({ length: 30 }, (_, i) => NOW + i) }).crashes.length, 16);
  assert.deepEqual(
    parseGpuState({ version: 3, crashes: [{ at: NOW, backend: "alternate" }, { at: NOW - 1, backend: "hardware" }, null] }),
    merge(crashes("hardware", NOW - 1), crashes("alternate", NOW)),
  );
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
    recordingBackend: () => (recording ? "hardware" : null),
  }, dir, () => {}, () => clock);

  fire({ type: "GPU", reason: "crashed", exitCode: 34 });
  clock += 1_000;
  fire({ type: "GPU", reason: "killed", exitCode: 1073807364 });
  clock += 136;
  fire({ type: "GPU", reason: "crashed", exitCode: -1073741205 });
  assert.deepEqual(readGpuState(dir), crashes("hardware", NOW));
  assert.equal(decideGpuBackend(readGpuState(dir), clock, "win32"), "hardware");

  // Quit and software-rendering launches disable recording at the host.
  recording = false;
  for (let i = 0; i < 4; i++) fire({ type: "GPU", reason: "crashed", exitCode: 2 });
  assert.deepEqual(readGpuState(dir), crashes("hardware", NOW));
});
