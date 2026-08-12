#!/usr/bin/env node
// Prepare the native, self-contained Windows transcription sidecar used by
// Breadboard. The downloaded artifacts are pinned and checksum-verified, then
// staged in desktop/resources/bin so Electron can ship and supervise them
// without Docker or a machine-wide FFmpeg installation.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(repoRoot, "desktop");
const defaultOutputDir = path.join(desktopRoot, "resources", "bin");
const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));

const SCRIBERR_BUILD = Object.freeze({
  version: "1.2.0-breadboard-lazy",
  sourceDir: path.join(repoRoot, "scriberr"),
});

const GO_RELEASE = Object.freeze({
  version: "1.24.4",
  url: "https://go.dev/dl/go1.24.4.windows-amd64.zip",
  sha256: "b751a1136cb9d8a2e7ebb22c538c4f02c09b98138c7c8bfb78a54a4566c013b1",
});

const YTDLP_RELEASE = Object.freeze({
  version: "2026.07.04",
  url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp.exe",
  sha256: "52fe3c26dcf71fbdc85b528589020bb0b8e383155cfa81b64dd447bbe35e24b8",
});

function log(message) {
  process.stdout.write(`[prepare-transcription] ${message}\n`);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function downloadVerified(url, destination, expectedSha256) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
  const actual = sha256(destination);
  if (actual !== expectedSha256) {
    fs.rmSync(destination, { force: true });
    throw new Error(
      `checksum mismatch for ${path.basename(destination)}: expected ${expectedSha256}, got ${actual}`,
    );
  }
}

function powershellQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function extractZip(archive, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const command = `Expand-Archive -LiteralPath ${powershellQuote(archive)} -DestinationPath ${powershellQuote(destination)} -Force`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(
      `could not extract Scriberr: ${(result.stderr || result.stdout || "unknown error").trim()}`,
    );
  }
}

function resolveUvBinary() {
  const override = process.env.UV_BINARY_PATH?.trim();
  if (override && fs.existsSync(override)) return path.resolve(override);
  const lookup = spawnSync("where.exe", ["uv.exe"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (lookup.status === 0) {
    const match = lookup.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && fs.existsSync(line));
    if (match) return match;
  }
  throw new Error(
    "uv.exe was not found. Install uv once (https://docs.astral.sh/uv/) or set UV_BINARY_PATH before packaging Breadboard.",
  );
}

function copyIfChanged(source, destination) {
  if (fs.existsSync(destination) && sha256(source) === sha256(destination)) return;
  fs.copyFileSync(source, destination);
}

function readManifest(outputDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(outputDir, "transcription-runtime.json"), "utf8"));
  } catch {
    return null;
  }
}

function sourceFingerprint(root) {
  const hash = crypto.createHash("sha256");
  const pending = [root];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && [".git", "node_modules", "data", "dist"].includes(entry.name)) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (
        entry.name.endsWith(".go") ||
        entry.name === "go.mod" ||
        entry.name === "go.sum" ||
        full.includes(path.join("internal", "web", "frontend"))
      ) {
        files.push(full);
      }
    }
  }
  files.sort();
  for (const file of files) {
    hash.update(path.relative(root, file).replaceAll(path.sep, "/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function prepareGoToolchain(tempDir) {
  const toolchainRoot = path.join(repoRoot, ".runtime", "build-tools", `go${GO_RELEASE.version}`);
  const goExe = path.join(toolchainRoot, "go", "bin", "go.exe");
  if (fs.existsSync(goExe)) return goExe;

  log(`downloading pinned Go ${GO_RELEASE.version} build toolchain`);
  const archive = path.join(tempDir, "go.zip");
  const extracted = path.join(tempDir, "go-toolchain");
  await downloadVerified(GO_RELEASE.url, archive, GO_RELEASE.sha256);
  extractZip(archive, extracted);
  const extractedGo = path.join(extracted, "go");
  if (!fs.existsSync(path.join(extractedGo, "bin", "go.exe"))) {
    throw new Error("the pinned Go archive did not contain go.exe");
  }
  fs.mkdirSync(path.dirname(toolchainRoot), { recursive: true });
  fs.rmSync(toolchainRoot, { recursive: true, force: true });
  fs.renameSync(extracted, toolchainRoot);
  return goExe;
}

async function buildScriberr({ destination, tempDir, fingerprint }) {
  const goExe = await prepareGoToolchain(tempDir);
  const embeddedWebDir = path.join(SCRIBERR_BUILD.sourceDir, "internal", "web", "dist");
  const bundledWebDir = path.join(SCRIBERR_BUILD.sourceDir, "internal", "web", "frontend");
  const createdEmbeddedWeb = !fs.existsSync(embeddedWebDir);
  if (createdEmbeddedWeb) {
    if (!fs.existsSync(path.join(bundledWebDir, "index.html"))) {
      throw new Error("Scriberr's bundled web assets are missing");
    }
    fs.cpSync(bundledWebDir, embeddedWebDir, { recursive: true });
  }

  const temporaryExe = path.join(tempDir, "scriberr.exe");
  const ldflags = [
    "-s",
    "-w",
    `-X main.version=${SCRIBERR_BUILD.version}`,
    `-X main.commit=breadboard-${fingerprint.slice(0, 12)}`,
    "-X main.date=reproducible-local-build",
  ].join(" ");
  try {
    log(`building native Scriberr ${SCRIBERR_BUILD.version}`);
    const result = spawnSync(
      goExe,
      ["build", "-trimpath", "-ldflags", ldflags, "-o", temporaryExe, "./cmd/server"],
      {
        cwd: SCRIBERR_BUILD.sourceDir,
        env: { ...process.env, CGO_ENABLED: "0", GOOS: "windows", GOARCH: "amd64" },
        encoding: "utf8",
        windowsHide: true,
        timeout: 15 * 60_000,
      },
    );
    if (result.status !== 0 || !fs.existsSync(temporaryExe)) {
      throw new Error(
        `native Scriberr build failed: ${(result.stderr || result.stdout || "unknown error").trim()}`,
      );
    }
    fs.copyFileSync(temporaryExe, destination);
  } finally {
    if (createdEmbeddedWeb) fs.rmSync(embeddedWebDir, { recursive: true, force: true });
  }
}

export async function prepareScriberrRuntime({ outputDir = defaultOutputDir } = {}) {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Breadboard's bundled native Scriberr runtime currently supports Windows x64.");
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const manifest = readManifest(outputDir);
  const scriberrTarget = path.join(outputDir, "scriberr.exe");
  const ytdlpTarget = path.join(outputDir, "yt-dlp.exe");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-transcription-"));
  const fingerprint = sourceFingerprint(SCRIBERR_BUILD.sourceDir);

  try {
    if (
      !fs.existsSync(scriberrTarget) ||
      manifest?.scriberr?.version !== SCRIBERR_BUILD.version ||
      manifest?.scriberr?.sourceFingerprint !== fingerprint
    ) {
      await buildScriberr({ destination: scriberrTarget, tempDir, fingerprint });
    }

    if (!fs.existsSync(ytdlpTarget) || sha256(ytdlpTarget) !== YTDLP_RELEASE.sha256) {
      log(`downloading yt-dlp ${YTDLP_RELEASE.version}`);
      await downloadVerified(YTDLP_RELEASE.url, ytdlpTarget, YTDLP_RELEASE.sha256);
    }

    const ffmpegSource = requireFromDesktop("ffmpeg-static");
    const ffprobeSource = requireFromDesktop("ffprobe-static").path;
    if (typeof ffmpegSource !== "string" || !fs.existsSync(ffmpegSource)) {
      throw new Error("ffmpeg-static did not provide ffmpeg.exe");
    }
    if (typeof ffprobeSource !== "string" || !fs.existsSync(ffprobeSource)) {
      throw new Error("ffprobe-static did not provide ffprobe.exe");
    }
    copyIfChanged(ffmpegSource, path.join(outputDir, "ffmpeg.exe"));
    copyIfChanged(ffprobeSource, path.join(outputDir, "ffprobe.exe"));
    copyIfChanged(resolveUvBinary(), path.join(outputDir, "uv.exe"));

    const nextManifest = {
      schemaVersion: 1,
      platform: "win32-x64",
      scriberr: {
        version: SCRIBERR_BUILD.version,
        sourceFingerprint: fingerprint,
        executableSha256: sha256(scriberrTarget),
      },
      ytdlp: { version: YTDLP_RELEASE.version, sha256: YTDLP_RELEASE.sha256 },
      ffmpeg: { sha256: sha256(path.join(outputDir, "ffmpeg.exe")) },
      ffprobe: { sha256: sha256(path.join(outputDir, "ffprobe.exe")) },
      uv: { sha256: sha256(path.join(outputDir, "uv.exe")) },
    };
    fs.writeFileSync(
      path.join(outputDir, "transcription-runtime.json"),
      `${JSON.stringify(nextManifest, null, 2)}\n`,
      "utf8",
    );
    log(`native runtime ready in ${outputDir}`);
    return { outputDir, manifest: nextManifest };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function loadOrCreateScriberrCredentials(
  runtimeDir = path.join(repoRoot, ".runtime", "scriberr"),
) {
  const filePath = path.join(runtimeDir, "credentials.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (
      typeof parsed.username === "string" &&
      parsed.username.length >= 3 &&
      typeof parsed.password === "string" &&
      parsed.password.length >= 24
    ) {
      return parsed;
    }
  } catch {
    // Create the private local service account below.
  }
  const credentials = {
    username: "breadboard",
    password: crypto.randomBytes(24).toString("base64url"),
  };
  fs.mkdirSync(runtimeDir, { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
  return credentials;
}

const invokedAsMain =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  prepareScriberrRuntime().catch((error) => {
    process.stderr.write(
      `[prepare-transcription] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
