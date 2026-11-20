#!/usr/bin/env node
// One-time setup for /agents:paper-orchestra: a Python 3.11 environment with
// the vendored clone's requirements, and Tectonic as the LaTeX engine.
// Everything lands in PAPER_ORCHESTRA_HOME (default ~/.breadboard/paper-orchestra);
// delete that folder to undo it. A run never installs anything itself.
//
//   node scripts/setup-paper-orchestra.mjs

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = path.resolve(process.env.PAPER_ORCHESTRA_HOME?.trim() || path.join(os.homedir(), ".breadboard", "paper-orchestra"));
const venv = path.join(home, "venv");
const python = path.join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const tectonicDir = path.join(home, "tectonic");
const tectonic = path.join(tectonicDir, process.platform === "win32" ? "tectonic.exe" : "tectonic");

function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", cwd });
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? result.error?.message}).`);
}

fs.mkdirSync(home, { recursive: true });

if (!fs.existsSync(python)) run("uv", ["venv", "--python", "3.11", venv]);
// The Streamlit demo is not used by Breadboard.
const requirements = path.join(home, "requirements.txt");
fs.writeFileSync(requirements, fs.readFileSync(path.join(repo, "paper-orchestra", "requirements.txt"), "utf8")
  .split(/\r?\n/).filter((line) => line.trim() && line.trim() !== "streamlit").join("\n"));
run("uv", ["pip", "install", "--python", python, "-r", requirements]);

if (!fs.existsSync(tectonic)) {
  const target = {
    win32: "x86_64-pc-windows-msvc.zip",
    darwin: process.arch === "arm64" ? "aarch64-apple-darwin.tar.gz" : "x86_64-apple-darwin.tar.gz",
    linux: "x86_64-unknown-linux-musl.tar.gz",
  }[process.platform];
  const release = await (await fetch("https://api.github.com/repos/tectonic-typesetting/tectonic/releases/latest", {
    headers: { "user-agent": "breadboard-setup", accept: "application/vnd.github+json" },
  })).json();
  const asset = release.assets?.find((item) => item.name.endsWith(target));
  if (!asset) throw new Error(`No Tectonic build for ${target} in ${release.tag_name ?? "the latest release"}.`);
  const archive = path.join(home, asset.name);
  console.log(`> download ${asset.browser_download_url}`);
  fs.writeFileSync(archive, Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer()));
  fs.mkdirSync(tectonicDir, { recursive: true });
  // Windows' own bsdtar reads zips; a GNU tar earlier on PATH (Git Bash) does not.
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  run(tar, ["-xf", asset.name, "-C", "tectonic"], home);
  fs.rmSync(archive);
}

run(python, ["-c", "import google.genai, openai, pymupdf, json_repair, thefuzz; print('python ok')"]);
run(tectonic, ["--version"]);
console.log(`PaperOrchestra is set up in ${home}`);
