import * as fs from "node:fs";
import * as path from "node:path";

export type ElectronQaHarnessLaunchOptions =
  | { readonly mode: "development" }
  | { readonly mode: "packaged"; readonly executablePath: string };

export function resolveElectronQaHarnessLaunchOptions(
  value: ElectronQaHarnessLaunchOptions = { mode: "development" },
): ElectronQaHarnessLaunchOptions {
  if (!value || typeof value !== "object") {
    throw new Error("Electron QA harness launch options must be an object");
  }
  if (value.mode === "development") {
    assertExactKeys(value, ["mode"]);
    return Object.freeze({ mode: "development" });
  }
  if (value.mode !== "packaged") {
    throw new Error("Electron QA harness launch mode must be development or packaged");
  }
  assertExactKeys(value, ["executablePath", "mode"]);
  if (!path.isAbsolute(value.executablePath)) {
    throw new Error("Packaged Electron QA requires an absolute Breadboard.exe path");
  }
  const resolved = path.resolve(value.executablePath);
  let realPath: string;
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error("not a regular file");
    realPath = fs.realpathSync.native(resolved);
  } catch (error) {
    throw new Error(`Packaged Electron QA executable is not a regular file: ${resolved}`, {
      cause: error,
    });
  }
  if (path.basename(realPath).toLowerCase() !== "breadboard.exe") {
    throw new Error(`Packaged Electron QA executable must be Breadboard.exe: ${realPath}`);
  }
  return Object.freeze({ mode: "packaged", executablePath: realPath });
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`Electron QA harness launch options require exactly: ${required.join(", ")}`);
  }
}
