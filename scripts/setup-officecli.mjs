#!/usr/bin/env node
// Provision the pinned OfficeCLI binary into .runtime/officecli.
//
// OfficeCLI is a self-contained native binary (no .NET runtime needed at run
// time). The vendored OfficeCLI/ clone is checked out at the same release tag,
// so the skills the catalog serves describe exactly the binary this script
// installs. The download uses the IMMUTABLE versioned release path — never
// /releases/latest/ — and verifies the asset against the release's SHA256SUMS
// before moving it into place.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PINNED_VERSION = "v1.0.143";
const REPO = "iOfficeAI/OfficeCLI";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = path.join(repoRoot, ".runtime", "officecli");
const binaryName = process.platform === "win32" ? "officecli.exe" : "officecli";
const targetPath = path.join(targetDir, binaryName);

function assetName() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "win32") return `officecli-win-${arch}.exe`;
  if (process.platform === "darwin") return `officecli-mac-${arch}`;
  return `officecli-linux-${arch}`;
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const asset = assetName();
  const base = `https://github.com/${REPO}/releases/download/${PINNED_VERSION}`;

  if (fs.existsSync(targetPath)) {
    console.log(`OfficeCLI already present at ${targetPath}; verifying...`);
  }

  console.log(`Downloading OfficeCLI ${PINNED_VERSION} (${asset})...`);
  const [binary, sums] = await Promise.all([
    download(`${base}/${asset}`),
    download(`${base}/SHA256SUMS`),
  ]);

  // Match the filename column exactly — not as a regex or substring — so the
  // wrong manifest line can never supply the hash.
  const expected = sums
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts.length >= 2 && parts[1] === asset)?.[0];
  if (!expected) throw new Error(`SHA256SUMS has no entry for ${asset}`);
  const actual = createHash("sha256").update(binary).digest("hex");
  if (actual !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
  }
  console.log("Checksum verified.");

  fs.mkdirSync(targetDir, { recursive: true });
  const temporary = `${targetPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, binary);
  if (process.platform !== "win32") fs.chmodSync(temporary, 0o755);
  fs.renameSync(temporary, targetPath);
  console.log(`Installed ${targetPath}`);
  console.log("Done. The office_run/office_export tools resolve this path automatically.");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
