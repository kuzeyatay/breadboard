import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface WindowsInput {
  click(x: number, y: number): Promise<void>;
  typeText(text: string, pressEnter: boolean, x: number, y: number): Promise<void>;
}

const MAX_TYPED_TEXT_LENGTH = 1_000;
const HELPER_TIMEOUT_MS = 15_000;

function helperPath(): string {
  const bundled = path.join(__dirname, "..", "native", "windows-input.exe");
  const unpacked = bundled.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
  if (fs.existsSync(unpacked)) return unpacked;
  if (fs.existsSync(bundled)) return bundled;
  throw new Error("Restart Breadboard to enable desktop input.");
}

function helperEnvironment(): NodeJS.ProcessEnv {
  return {
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
    ...(process.env.TEMP ? { TEMP: process.env.TEMP } : {}),
    ...(process.env.TMP ? { TMP: process.env.TMP } : {}),
  };
}

function runHelper(args: string[], input?: string): Promise<void> {
  if (process.platform !== "win32") return Promise.reject(new Error("Desktop input is available on Windows."));
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath(), args, {
      env: helperEnvironment(),
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let errorText = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("Windows input timed out."));
    }, HELPER_TIMEOUT_MS);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (errorText.length < 1_000) errorText += chunk.slice(0, 1_000 - errorText.length);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(errorText.trim() || "Windows blocked desktop input."));
    });
    child.stdin.on("error", (error) => finish(error));
    child.stdin.end(input ?? "", "utf8");
  });
}

/** User-confirmed mouse and keyboard input through a DPI-aware native helper. */
export function createWindowsInput(_appRoot: string): WindowsInput {
  return {
    click(x, y) {
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        return Promise.reject(new Error("Invalid desktop coordinates."));
      }
      return runHelper(["click", String(x), String(y)]);
    },
    typeText(text, pressEnter, x, y) {
      if (!text || text.length > MAX_TYPED_TEXT_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) {
        return Promise.reject(new Error("Clicky can type up to 1,000 characters without control characters."));
      }
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        return Promise.reject(new Error("Invalid desktop coordinates."));
      }
      return runHelper(["type", String(x), String(y), pressEnter ? "1" : "0"], text);
    },
  };
}

/** Compatibility helper for callers that need only a click. */
export function createWindowsClicker(appRoot: string): (x: number, y: number) => Promise<void> {
  return createWindowsInput(appRoot).click;
}
