// Provision the audio analyzer: the Rust binaries Breadboard runs to hear music.
//
// Two ways in, in this order:
//
//   1. A source build, when the machine has a Rust toolchain and the
//      `audio-analyzer-rs` checkout is present. That is the honest one — what
//      runs is what is in the repository.
//   2. The pinned upstream release, verified by SHA-256. Most machines have no
//      cargo, and an audio analyzer that only works for people who installed
//      Rust is not an innate feature.
//
// Either way the two binaries end up in `.runtime/audio-analyzer/bin`, which is
// the only place dashboard/src/lib/audio-analyzer/config.ts looks.
//
//   node scripts/setup-audio-analyzer.mjs            provision (build or download)
//   node scripts/setup-audio-analyzer.mjs --check    report, install nothing
//   node scripts/setup-audio-analyzer.mjs --download forced download, no build

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloneRoot =
  process.env.AUDIO_ANALYZER_ROOT?.trim() || path.join(repositoryRoot, "audio-analyzer-rs");
const binDirectory =
  process.env.AUDIO_ANALYZER_BIN_DIR?.trim() ||
  path.join(repositoryRoot, ".runtime", "audio-analyzer", "bin");

const VERSION = "v1.0.0";
const RELEASE_BASE = `https://github.com/JuzzyDee/audio-analyzer-rs/releases/download/${VERSION}`;

/**
 * The published archives, by `${platform}-${arch}`, with the digest each one
 * must have. A binary that will read the user's music library is not something
 * to take on a redirect's word.
 */
const ASSETS = {
  "win32-x64": {
    file: "audio-analyzer-x86_64-pc-windows-msvc.zip",
    sha256: "591b503019f87f3abe99e9a1f6b97791052814006131e26ae6e3678a38a428bb",
  },
  "darwin-arm64": {
    file: "audio-analyzer-aarch64-apple-darwin.tar.gz",
    sha256: "da30a7d12d8c775026cf646d0dbf31b8c3bcb42864fd8685ecad8cd75e791395",
  },
  "darwin-x64": {
    file: "audio-analyzer-x86_64-apple-darwin.tar.gz",
    sha256: "d53b2d2f15f4be2ca738c71922b7b6bd2d70c090a6b72a565c76358574960ad2",
  },
  "linux-x64": {
    file: "audio-analyzer-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "0ab8b0954dfa30cdd29b05302715b3a90cf4051c971b85683fc8e528fcce0b8c",
  },
};

const EXE = process.platform === "win32" ? ".exe" : "";
const BINARIES = [`mcp-server${EXE}`, `cli${EXE}`];
const checkOnly = process.argv.includes("--check");
const forceDownload = process.argv.includes("--download");

function installedBinaries() {
  return BINARIES.map((name) => path.join(binDirectory, name));
}

function allInstalled() {
  return installedBinaries().every((file) => {
    const stats = fs.statSync(file, { throwIfNoEntry: false });
    return Boolean(stats?.isFile()) && stats.size > 0;
  });
}

/** The server answering a version question is the only proof that matters. */
function probe() {
  const server = path.join(binDirectory, `mcp-server${EXE}`);
  const request =
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "breadboard-setup", version: "1" },
      },
    }) + "\n";
  const result = spawnSync(server, [], {
    input: request,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  return (result.stdout ?? "").includes('"serverInfo"');
}

function hasCargo() {
  // No `shell: true`: cargo is a real executable on every platform, and a shell
  // would only add quoting rules and a deprecation warning.
  const result = spawnSync("cargo", ["--version"], { encoding: "utf8", windowsHide: true });
  return result.status === 0;
}

function buildFromSource() {
  console.log(`Building the audio analyzer from ${cloneRoot}…`);
  const build = spawnSync("cargo", ["build", "--release"], {
    cwd: cloneRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  if (build.status !== 0) return false;
  fs.mkdirSync(binDirectory, { recursive: true });
  for (const name of BINARIES) {
    const built = path.join(cloneRoot, "target", "release", name);
    if (!fs.existsSync(built)) return false;
    fs.copyFileSync(built, path.join(binDirectory, name));
  }
  return true;
}

/**
 * The files in a zip, by name. Only what a release archive actually uses is
 * supported: stored and deflated entries, read through the central directory so
 * a truncated or rewritten local header cannot hide one.
 */
function readZip(buffer) {
  const EOCD = 0x06054b50;
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== EOCD) end -= 1;
  if (end < 0) throw new Error("The archive has no zip directory.");

  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Corrupt zip directory.");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    // The local header repeats the name and extra field with its own lengths.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    if (method === 0) files.set(name, Buffer.from(raw));
    else if (method === 8) files.set(name, zlib.inflateRawSync(raw));
    else throw new Error(`Unsupported zip compression method ${method} for ${name}.`);
  }
  return files;
}

/** The regular files in a gzipped tar, by name. Enough for a two-binary release. */
function readTarGz(buffer) {
  const tar = zlib.gunzipSync(buffer);
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const name = tar.toString("utf8", offset, offset + 100).replace(/\0.*$/, "");
    if (!name) break;
    const size = Number.parseInt(
      tar.toString("utf8", offset + 124, offset + 136).replace(/\0.*$/, "").trim() || "0",
      8,
    );
    const type = tar.toString("utf8", offset + 156, offset + 157);
    const start = offset + 512;
    if (type === "0" || type === "\0") files.set(name, tar.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function download() {
  const key = `${process.platform}-${process.arch}`;
  const asset = ASSETS[key];
  if (!asset) {
    console.error(
      `No published audio-analyzer build for ${key}. Install Rust and re-run this script to build ` +
        `from ${cloneRoot}.`,
    );
    process.exit(1);
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "audio-analyzer-"));
  const archive = path.join(staging, asset.file);
  try {
    console.log(`Downloading ${asset.file} (${VERSION})…`);
    const response = await fetch(`${RELEASE_BASE}/${asset.file}`, { redirect: "follow" });
    if (!response.ok) {
      console.error(`The release download failed with HTTP ${response.status}.`);
      process.exit(1);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.sha256) {
      console.error(
        `Checksum mismatch for ${asset.file}.\n  expected ${asset.sha256}\n  received ${digest}\n` +
          "Nothing was installed.",
      );
      process.exit(1);
    }
    fs.writeFileSync(archive, bytes);

    // Unpacked in-process rather than by shelling out to `tar`. Windows ships
    // bsdtar (which reads zip) but a Git Bash PATH puts GNU tar (which does
    // not, and reads `C:\` as a remote host) ahead of it — so the archiver that
    // runs would depend on which terminal the person happened to use.
    const members = asset.file.endsWith(".zip") ? readZip(bytes) : readTarGz(bytes);

    fs.mkdirSync(binDirectory, { recursive: true });
    for (const name of BINARIES) {
      const contents = members.get(name);
      if (!contents) {
        console.error(`The release archive did not contain ${name}.`);
        process.exit(1);
      }
      const destination = path.join(binDirectory, name);
      fs.writeFileSync(destination, contents);
      if (process.platform !== "win32") fs.chmodSync(destination, 0o755);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (checkOnly) {
  if (!allInstalled()) {
    console.error(
      `The audio analyzer is not installed in ${binDirectory}. Run \`npm run setup:audio-analyzer\`.`,
    );
    process.exit(1);
  }
  if (!probe()) {
    console.error("The audio analyzer binaries are present but the MCP server did not start.");
    process.exit(1);
  }
  console.log(`Audio analyzer ready in ${binDirectory}.`);
  process.exit(0);
}

if (allInstalled() && !forceDownload && probe()) {
  console.log(`Audio analyzer already installed in ${binDirectory}.`);
  process.exit(0);
}

const built =
  !forceDownload && fs.existsSync(path.join(cloneRoot, "Cargo.toml")) && hasCargo()
    ? buildFromSource()
    : false;
if (!built) {
  if (!forceDownload) {
    console.log("No Rust toolchain or the source build failed; using the pinned release instead.");
  }
  await download();
}

if (!probe()) {
  console.error("The audio analyzer was installed but its MCP server did not start.");
  process.exit(1);
}
console.log(`Audio analyzer ${VERSION} ready in ${binDirectory}.`);
