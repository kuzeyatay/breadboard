import * as fs from "node:fs";
import * as path from "node:path";
import { isPathInside } from "./environment";

/**
 * Deterministic fixture loading.
 *
 * Scenarios that upload a document, import a garden, or replay a recorded
 * payload depend on files under `qa/fixtures`. When one of those is missing or
 * malformed the run has learned nothing about Breadboard, so the failure must
 * be reported as a harness/environment problem and must never reach the repair
 * gate as a product defect. `QaFixtureError` carries the wording the failure
 * classifier recognises, and the diagnostic event names it emits are the ones
 * `classifyProbeFailure` treats as concrete environment evidence.
 */

export type QaFixtureProblem = "missing" | "malformed";

export class QaFixtureError extends Error {
  readonly problem: QaFixtureProblem;
  readonly fixture: string;
  readonly diagnosticEvent: "qa-fixture-missing" | "qa-fixture-malformed";

  constructor(problem: QaFixtureProblem, fixture: string, detail: string) {
    super(
      problem === "missing"
        ? `QA fixture file is missing: ${fixture} (${detail})`
        : `malformed QA fixture: ${fixture} (${detail})`,
    );
    this.name = "QaFixtureError";
    this.problem = problem;
    this.fixture = fixture;
    this.diagnosticEvent =
      problem === "missing" ? "qa-fixture-missing" : "qa-fixture-malformed";
  }
}

export interface QaFixtureOptions {
  /** Defaults to `<repoRoot>/qa/fixtures`. */
  readonly fixturesRoot?: string;
  /** Reject an empty file, which is almost always an interrupted checkout. */
  readonly allowEmpty?: boolean;
  /** Minimum byte length a fixture must have to be considered usable. */
  readonly minimumBytes?: number;
}

export function qaFixturesRoot(repoRoot: string): string {
  return path.join(repoRoot, "qa", "fixtures");
}

/**
 * Resolve a fixture path, refusing any name that escapes the fixture root.
 * A traversal attempt is a harness defect, not a product defect.
 */
export function resolveQaFixture(
  repoRoot: string,
  name: string,
  options: QaFixtureOptions = {},
): string {
  const root = path.resolve(options.fixturesRoot ?? qaFixturesRoot(repoRoot));
  const resolved = path.resolve(root, name);
  if (!isPathInside(root, resolved)) {
    throw new QaFixtureError(
      "missing",
      name,
      `forbidden QA path: the fixture name escapes ${root}`,
    );
  }
  return resolved;
}

/** Read a fixture as UTF-8 text, distinguishing missing from malformed. */
export function readQaFixture(
  repoRoot: string,
  name: string,
  options: QaFixtureOptions = {},
): string {
  const resolved = resolveQaFixture(repoRoot, name, options);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new QaFixtureError("missing", name, `no file at ${resolved}`);
  }
  if (stat.isSymbolicLink()) {
    throw new QaFixtureError("malformed", name, "fixture is a symlink or reparse point");
  }
  if (!stat.isFile()) {
    throw new QaFixtureError("missing", name, `${resolved} is not a regular file`);
  }
  const minimumBytes = options.minimumBytes ?? (options.allowEmpty === true ? 0 : 1);
  if (stat.size < minimumBytes) {
    throw new QaFixtureError(
      "malformed",
      name,
      `expected at least ${minimumBytes} byte(s), found ${stat.size}`,
    );
  }
  return fs.readFileSync(resolved, "utf8");
}

/** Read and parse a JSON fixture. A parse failure is always `malformed`. */
export function readQaJsonFixture<T = unknown>(
  repoRoot: string,
  name: string,
  options: QaFixtureOptions = {},
): T {
  const text = readQaFixture(repoRoot, name, options);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new QaFixtureError(
      "malformed",
      name,
      error instanceof Error ? error.message : String(error),
    );
  }
}
