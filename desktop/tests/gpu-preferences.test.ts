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
  parseGpuState,
  prefersSoftwareGl,
  readGpuState,
  withGpuCrash,
  writeGpuState,
  type GpuState,
} from "../src/main/gpu-preferences";

const NOW = 1_800_000_000_000;

function recordingCommandLine(): {
  commandLine: { appendSwitch: (name: string, value?: string) => void };
  switches: string[];
} {
  const switches: string[] = [];
  return {
    commandLine: {
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

test("the software-GL opt-in rides along on every launch, healthy GPU or not", () => {
  const { commandLine, switches } = recordingCommandLine();

  const result = configureGpuPreferences(commandLine, tempUserData(), NOW, EMPTY_GPU_STATE);

  assert.ok(switches.includes("enable-unsafe-swiftshader"), switches.join(" "));
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
  assert.deepEqual(parseGpuState({ crashes: ["yesterday", -1, null] }), EMPTY_GPU_STATE);
  assert.deepEqual(parseGpuState(null), EMPTY_GPU_STATE);
});

test("the crash recorder writes through and reports the fallback once it is due", () => {
  const dir = tempUserData();
  const lines: string[] = [];
  let listener: (() => void) | null = null;
  let clock = NOW;

  installGpuCrashRecorder(
    { onGpuProcessCrash: (fn) => void (listener = fn) },
    dir,
    (line) => lines.push(line),
    () => clock,
  );

  assert.ok(listener, "no crash listener was registered");
  const crash = listener as unknown as () => void;
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
