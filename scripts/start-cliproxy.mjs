#!/usr/bin/env node
// Launcher for CLIProxyAPI, Breadboard's subscription-OAuth model proxy.
//
// CLIProxyAPI (router-for-me/CLIProxyAPI, MIT) signs into AI *subscriptions*
// — Claude Pro/Max, ChatGPT, Google/Gemini via Antigravity, Kimi, Grok — and
// serves them behind one OpenAI-compatible endpoint. ChatMock registers it as
// the `cliproxy` provider, so those models reach every Breadboard surface
// without an API key.
//
// CLIPROXY_MODE: `required` (default) starts it and treats a failure as fatal —
// it is how Breadboard reaches subscription models, so a silent absence would
// just look like missing models. `optional` starts it but never blocks, and
// `disabled` skips it entirely. The binary is downloaded on first run into
// CLIPROXY_HOME and cached; nothing is vendored into the repo.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadRootEnv, loadDashboardEnv } from "./load-root-env.mjs";
import { exitIfAlreadyRunning } from "./service-probe.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
loadDashboardEnv(repoRoot);

const mode = process.env.CLIPROXY_MODE?.trim().toLowerCase() || "required";
if (mode === "disabled") {
  process.stdout.write("[cliproxy] CLIPROXY_MODE=disabled; service not started.\n");
  process.exit(0);
}

const {
  CLIPROXY_REPO,
  cliproxyApiKey,
  cliproxyAuthDir,
  cliproxyBinaryPath,
  cliproxyConfigPath,
  cliproxyHome,
  cliproxyManagementKey,
  cliproxyPort,
  renderCliproxyConfig,
} = await import(
  // pathToFileURL: on Windows a bare absolute path is read as a URL scheme.
  pathToFileURL(
    path.join(repoRoot, "dashboard", "src", "lib", "cliproxy", "config.ts"),
  ).href
);

const fail = (message) => {
  process.stderr.write(`[cliproxy] ${message}\n`);
  process.exit(mode === "required" ? 1 : 0);
};

/** Map this machine to a release asset name. */
function assetFor(version) {
  const arch = os.arch() === "arm64" ? "aarch64" : "amd64";
  if (process.platform === "win32") {
    return { name: `CLIProxyAPI_${version}_windows_${arch}.zip`, archive: "zip" };
  }
  if (process.platform === "darwin") {
    return { name: `CLIProxyAPI_${version}_darwin_${arch}.tar.gz`, archive: "tar" };
  }
  if (process.platform === "linux") {
    return { name: `CLIProxyAPI_${version}_linux_${arch}.tar.gz`, archive: "tar" };
  }
  return null;
}

async function latestVersion() {
  const pinned = process.env.CLIPROXY_VERSION?.trim();
  if (pinned) return pinned.replace(/^v/, "");

  const response = await fetch(
    `https://api.github.com/repos/${CLIPROXY_REPO}/releases/latest`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  const body = await response.json();
  const tag = typeof body?.tag_name === "string" ? body.tag_name : "";
  if (!tag) throw new Error("no tag_name in the latest release");
  return tag.replace(/^v/, "");
}

function extract(archivePath, archiveType, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const result =
    archiveType === "zip" && process.platform === "win32"
      ? spawnSyncQuiet("powershell", [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${destination}' -Force`,
        ])
      : archiveType === "zip"
        ? spawnSyncQuiet("unzip", ["-o", archivePath, "-d", destination])
        : spawnSyncQuiet("tar", ["-xzf", archivePath, "-C", destination]);

  if (result !== 0) throw new Error(`extraction failed (exit ${result})`);
}

function spawnSyncQuiet(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  return result.status ?? 1;
}

async function install() {
  const version = await latestVersion();
  const asset = assetFor(version);
  if (!asset) throw new Error(`unsupported platform ${process.platform}/${os.arch()}`);

  const url = `https://github.com/${CLIPROXY_REPO}/releases/download/v${version}/${asset.name}`;
  process.stdout.write(`[cliproxy] downloading ${asset.name}\n`);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);

  const stagingDir = path.join(cliproxyHome(), "download");
  fs.mkdirSync(stagingDir, { recursive: true });
  const archivePath = path.join(stagingDir, asset.name);
  fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));

  extract(archivePath, asset.archive, stagingDir);

  const binaryName = process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api";
  const found = findFile(stagingDir, binaryName);
  if (!found) throw new Error(`${binaryName} not found in the downloaded archive`);

  const target = cliproxyBinaryPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(found, target);
  if (process.platform !== "win32") fs.chmodSync(target, 0o755);

  fs.rmSync(stagingDir, { recursive: true, force: true });
  process.stdout.write(`[cliproxy] installed v${version} -> ${target}\n`);
}

function findFile(directory, name) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(full, name);
      if (nested) return nested;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

async function main() {
  // Before anything is downloaded or rewritten: the proxy's bearer lives in a
  // file under CLIPROXY_HOME and every launcher on this machine reads the same
  // one, so an instance that answers it is one this stack can use as-is.
  await exitIfAlreadyRunning("cliproxy", {
    url: `http://127.0.0.1:${cliproxyPort()}/v1/models`,
    headers: { Authorization: `Bearer ${cliproxyApiKey()}` },
  });

  fs.mkdirSync(cliproxyHome(), { recursive: true });
  fs.mkdirSync(cliproxyAuthDir(), { recursive: true });

  const binary = cliproxyBinaryPath();
  if (!fs.existsSync(binary)) {
    try {
      await install();
    } catch (error) {
      fail(`could not install the proxy: ${error instanceof Error ? error.message : error}`);
      return;
    }
  }

  // Regenerate the config every launch: the port, auth-dir and local secrets
  // are all owned by Breadboard, so a stale file must never win.
  const configPath = cliproxyConfigPath();
  fs.writeFileSync(configPath, renderCliproxyConfig(), { encoding: "utf8", mode: 0o600 });

  const port = cliproxyPort();
  process.stdout.write(`[cliproxy] starting on 127.0.0.1:${port}\n`);
  // Touch the secrets once here so the files exist before the dashboard reads them.
  cliproxyApiKey();
  cliproxyManagementKey();

  const child = spawn(binary, ["--config", configPath], {
    cwd: cliproxyHome(),
    // Keeps the Go binary's logs inside CLIPROXY_HOME instead of the repo.
    env: { ...process.env, WRITABLE_PATH: cliproxyHome() },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const relay = (stream, prefix) => {
    stream.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) process.stdout.write(`[cliproxy] ${prefix}${line}\n`);
      }
    });
  };
  relay(child.stdout, "");
  relay(child.stderr, "! ");

  child.on("error", (error) => fail(`failed to start: ${error.message}`));
  child.on("exit", (code) => {
    process.stdout.write(`[cliproxy] exited with code ${code}\n`);
    process.exit(code ?? 0);
  });

  const shutdown = () => {
    if (!child.killed) child.kill();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", shutdown);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
