import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createQaEnvironment } from "../../environment";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

test.describe("QA runtime-root isolation", () => {
  test("rejects a symlink or junction runtime root before creating a run child", () => {
    withLinkedDirectory(({ link, target }) => {
      expect(() =>
        createQaEnvironment({
          repoRoot: REPO_ROOT,
          runtimeRoot: link,
          runId: "must-not-be-created",
        }),
      ).toThrow(/QA runtime root cannot be a symlink or junction/);
      expect(fs.existsSync(path.join(target, "must-not-be-created"))).toBe(false);
    });
  });

  test("rejects a runtime root whose real path escapes through a linked ancestor", () => {
    withLinkedDirectory(({ link, target }) => {
      const targetRuntime = path.join(target, "runtime");
      fs.mkdirSync(targetRuntime);

      expect(() =>
        createQaEnvironment({
          repoRoot: REPO_ROOT,
          runtimeRoot: path.join(link, "runtime"),
          runId: "must-not-be-created",
        }),
      ).toThrow(/QA runtime root resolved outside its configured path/);
      expect(fs.existsSync(path.join(targetRuntime, "must-not-be-created"))).toBe(false);
    });
  });
});

function withLinkedDirectory(
  exercise: (paths: { readonly link: string; readonly target: string }) => void,
): void {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-qa-root-test-"));
  const target = path.join(sandbox, "target");
  const link = path.join(sandbox, "runtime-link");
  fs.mkdirSync(target);
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");

  try {
    exercise({ link, target });
  } finally {
    // Unlink explicitly so recursive cleanup can never traverse the test link.
    try {
      fs.unlinkSync(link);
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) throw error;
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
