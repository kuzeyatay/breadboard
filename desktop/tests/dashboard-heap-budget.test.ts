import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DASHBOARD_HEAP_OVERRIDE_ENV,
  MAX_DASHBOARD_HEAP_MB,
  MIN_DASHBOARD_HEAP_MB,
  applyMaxOldSpaceSize,
  dashboardDevNodeOptions,
  parseHeapOverrideMb,
  resolveDashboardHeapBudgetMb,
} from "../src/main/dashboard-heap-budget";

const GB = 1024 * 1024 * 1024;

function budget(totalGb: number, override?: string): number {
  return resolveDashboardHeapBudgetMb({
    totalMemoryBytes: totalGb * GB,
    ...(override === undefined ? {} : { override }),
  });
}

test("a 32 GiB workstation is granted far less than the old 75%/24 GiB policy", () => {
  const mb = budget(32);
  // The incident machine reported 31.3 GiB usable.
  const measured = budget(31.3);
  for (const value of [mb, measured]) {
    assert.ok(value <= 6 * 1024, `expected <= 6 GiB, got ${value}MB`);
    assert.ok(value >= 2 * 1024, `expected a workable budget, got ${value}MB`);
  }
  // The old policy would have produced this; it must no longer be reachable.
  assert.notEqual(mb, Math.floor((32 * 1024) * 0.75));
  assert.ok(mb <= MAX_DASHBOARD_HEAP_MB);
  assert.equal(mb, 6 * 1024, "the incident machine uses the validated 6 GiB starting point");
});

test("the budget scales down on small machines and is capped on large ones", () => {
  assert.equal(budget(4), 1024, "tiny machines scale to a conservative usable floor");
  assert.equal(budget(8), 1536, "8 GiB retains most commit for the OS and Chromium");

  const sixteen = budget(16);
  assert.ok(
    sixteen > MIN_DASHBOARD_HEAP_MB && sixteen < MAX_DASHBOARD_HEAP_MB,
    `16 GiB should land between the floor and the ceiling, got ${sixteen}MB`,
  );

  assert.equal(budget(64), 6 * 1024, "derived defaults are capped at the measured safe start");
  assert.equal(budget(256), 6 * 1024, "the default cap does not scale away");

  // Monotonic: more RAM never yields a smaller budget.
  const series = [4, 8, 16, 24, 32, 64, 128].map((gb) => budget(gb));
  for (let index = 1; index < series.length; index += 1) {
    assert.ok(
      (series[index] as number) >= (series[index - 1] as number),
      `budget went backwards at index ${index}: ${series.join(",")}`,
    );
  }
});

test("a valid override wins and invalid configuration fails precisely", () => {
  assert.equal(budget(32, "2048"), 2048);
  assert.equal(budget(8, "6144"), 6144, "an override may exceed the computed default");

  assert.equal(parseHeapOverrideMb(""), null);
  assert.equal(parseHeapOverrideMb("   "), null);

  for (const invalid of [
    "abc",
    "4096.5",
    "4e3",
    "0x1000",
    "4096mb",
    "-2048",
    "0",
    "511", // below MIN_OVERRIDE_MB
    "16385", // above MAX_OVERRIDE_MB
    "999999999999999999999",
    "NaN",
    "Infinity",
  ]) {
    assert.throws(
      () => parseHeapOverrideMb(invalid),
      new RegExp(DASHBOARD_HEAP_OVERRIDE_ENV),
      `expected ${JSON.stringify(invalid)} rejected`,
    );
    assert.throws(
      () => budget(32, invalid),
      new RegExp(DASHBOARD_HEAP_OVERRIDE_ENV),
      `invalid override ${JSON.stringify(invalid)} must fail closed`,
    );
  }

  assert.equal(parseHeapOverrideMb("  3072  "), 3072, "surrounding whitespace is tolerated");
  assert.equal(parseHeapOverrideMb(undefined), null);
});

test("no duplicate --max-old-space-size is ever emitted", () => {
  const cases: Array<[string | undefined, string]> = [
    [undefined, "--max-old-space-size=4096"],
    ["", "--max-old-space-size=4096"],
    ["   ", "--max-old-space-size=4096"],
    ["--max-old-space-size=24576", "--max-old-space-size=4096"],
    ["--max_old_space_size=24576", "--max-old-space-size=4096"],
    ["--max-old-space-size 24576", "--max-old-space-size=4096"],
    ["--enable-source-maps --max-old-space-size=24576", "--enable-source-maps --max-old-space-size=4096"],
    ["--max-old-space-size=1 --max-old-space-size=2", "--max-old-space-size=4096"],
  ];
  for (const [inherited, expected] of cases) {
    const result = applyMaxOldSpaceSize(inherited, 4096);
    assert.equal(result, expected, `inherited=${JSON.stringify(inherited)}`);
    const occurrences = result.match(/--max[-_]old[-_]space[-_]size/g) ?? [];
    assert.equal(occurrences.length, 1, `expected exactly one flag in ${JSON.stringify(result)}`);
  }
});

test("unrelated inherited Node options are preserved in order", () => {
  const result = applyMaxOldSpaceSize(
    "--enable-source-maps --max-old-space-size=24576 --stack-size=4000 --no-warnings",
    3072,
  );
  assert.equal(
    result,
    "--enable-source-maps --stack-size=4000 --no-warnings --max-old-space-size=3072",
  );
});

test("a bare numeric token that is not an old-space value is left alone", () => {
  // `--stack-size 4000` must not have its value eaten by the flag stripper.
  const result = applyMaxOldSpaceSize("--stack-size 4000", 2048);
  assert.equal(result, "--stack-size 4000 --max-old-space-size=2048");
});

test("dashboardDevNodeOptions composes the budget with inherited options", () => {
  const options = dashboardDevNodeOptions(
    "--enable-source-maps --max-old-space-size=24576",
    { [DASHBOARD_HEAP_OVERRIDE_ENV]: "2560" },
    32 * GB,
  );
  assert.equal(options, "--enable-source-maps --max-old-space-size=2560");

  const defaulted = dashboardDevNodeOptions(undefined, {}, 32 * GB);
  assert.match(defaulted, /^--max-old-space-size=\d+$/);
  const value = Number(defaulted.split("=")[1]);
  assert.ok(value <= 6 * 1024, `default must stay under ~6 GiB, got ${value}MB`);
});

test("Next's own restart trigger lands inside a committable range", () => {
  // Next dev restarts its server child at 0.8 * heap_size_limit, and the tree
  // was measured to commit ~1.8x its V8 heap. Two invariants matter: normal
  // recycling must stay under the supervisor's warning threshold (11 GiB), so
  // healthy development never trips it, and far under the ~15 GiB that
  // exhausted the machine's commit limit.
  const estimatedCommitMb = 0.8 * budget(32) * 1.8;
  assert.ok(
    estimatedCommitMb < 11 * 1024,
    `steady-state commit must stay below the 11 GiB warning, got ${Math.round(estimatedCommitMb)}MB`,
  );
  assert.ok(
    estimatedCommitMb < 13 * 1024,
    `steady-state commit must stay below the 13 GiB hard limit, got ${Math.round(estimatedCommitMb)}MB`,
  );
});
