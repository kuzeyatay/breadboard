import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const PINNED_CUA_DRIVER_RUNTIME = Object.freeze({
  schemaVersion: 1,
  component: "hermes-computer-use",
  platform: "win32",
  architecture: "x64",
  release: "cua-driver-rs-v0.23.2",
  version: "0.23.2",
  archive: {
    name: "cua-driver-rs-0.23.2-windows-x86_64-binary.zip",
    url: "https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.23.2/cua-driver-rs-0.23.2-windows-x86_64-binary.zip",
    size: 27_635_699,
    sha256: "27A41831D5DDA71082B58154FF87966A9AD8131CE66E8060DA2D860558655C13",
  },
  files: [
    {
      name: "cua_driver_abi.h",
      size: 7_998,
      sha256: "C17169F41DA321BAA5E7E953323C3AD660B00790176BA381E93189FBA3506587",
    },
    {
      name: "cua_driver_node_runtime.node",
      size: 643_920,
      sha256: "EFCE78124D5FEB2F0EA05BBB8AF25E594F4480E8451DCF3B87F883E18CCAFCA8",
    },
    {
      name: "cua_driver_sdk.dll",
      size: 23_666_512,
      sha256: "E4700333D4D37BC87F09A45E74EA379E75DCD307BC105562AE6D4E2485E011C7",
    },
    {
      name: "cua-cursor-theme.exe",
      size: 2_033_488,
      sha256: "19CA397B1CB62777EF1D673E3E35B7C3726572A3A248EC739C8ED428AC5D28CC",
    },
    {
      name: "cua-driver-uia.exe",
      size: 20_393_808,
      sha256: "1942B163109D86FA857A0C95224A29739DE8FF31DB61C6FCA6465FFBEFBC4FA8",
    },
    {
      name: "cua-driver.exe",
      size: 28_697_936,
      sha256: "0E410C62BADA4B61C953E2771518A1FD810DA79AF01D36CD1A4E7B6CB91B1523",
    },
  ],
  notices: [
    {
      name: "cua-driver-LICENSE.txt",
      url: "https://raw.githubusercontent.com/trycua/cua/cua-driver-rs-v0.23.2/LICENSE.md",
      size: 1_069,
      sha256: "C0779290C1D4783169AA3DBFB55FEB505E563EF8A004BBF55298CEFFCFBDA8D9",
    },
    {
      name: "cua-driver-node-runtime-NOTICE.txt",
      url: "https://raw.githubusercontent.com/trycua/cua/cua-driver-rs-v0.23.2/libs/cua-driver/scripts/node-runtime-NOTICE.md",
      size: 531,
      sha256: "66A466CC022B4BF4A41F678E4D31D9B82098CC55CC364D6E9295366DFD02CEF2",
    },
  ],
});

async function sha256File(filePath) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex").toUpperCase() };
}

function requireAbsoluteDirectory(candidate, expectedName, label, { create = false } = {}) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  const resolved = path.resolve(candidate);
  if (expectedName && path.basename(resolved).toLowerCase() !== expectedName) {
    throw new Error(`${label} must name the ${expectedName} directory.`);
  }
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let metadata = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!metadata && create) {
      fs.mkdirSync(current);
      metadata = fs.lstatSync(current);
    }
    if (!metadata) break;
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`${label} traverses a non-directory or link: ${current}`);
    }
  }
  return resolved;
}

function requireDirectFile(candidate, label, { allowMissing = false } = {}) {
  const resolved = path.resolve(candidate);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata && allowMissing) return resolved;
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a direct regular file.`);
  }
  return resolved;
}

async function acquirePinnedFile({ label, suppliedPath, receipt, destination, offline }) {
  let source;
  if (suppliedPath) {
    const resolved = requireDirectFile(path.resolve(suppliedPath), `${label} supplied artifact`);
    const identity = await sha256File(resolved);
    if (identity.size !== receipt.size || identity.sha256 !== receipt.sha256) {
      throw new Error(`${label} supplied artifact is not the reviewed release.`);
    }
    source = fs.createReadStream(resolved);
  } else {
    if (offline) {
      throw new Error(`${label} requires a supplied immutable artifact in offline mode.`);
    }
    const response = await fetch(receipt.url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`${label} download failed with HTTP ${response.status}.`);
    }
    const declared = Number(response.headers.get("content-length"));
    const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
    if ((!encoding || encoding === "identity") && Number.isSafeInteger(declared) && declared > 0 && declared !== receipt.size) {
      throw new Error(`${label} server declared ${declared} bytes; expected ${receipt.size}.`);
    }
    source = Readable.fromWeb(response.body);
  }

  let size = 0;
  const hash = createHash("sha256");
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > receipt.size) {
        callback(new Error(`${label} exceeds its reviewed size.`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(source, meter, fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  } catch (error) {
    fs.rmSync(destination, { force: true });
    throw error;
  }
  const digest = hash.digest("hex").toUpperCase();
  if (size !== receipt.size || digest !== receipt.sha256) {
    fs.rmSync(destination, { force: true });
    throw new Error(`${label} is not reviewed (${size} bytes, SHA-256 ${digest}).`);
  }
}

async function runtimeIsComplete(targetRoot, licensesRoot) {
  try {
    const receipt = JSON.parse(fs.readFileSync(path.join(targetRoot, "runtime-artifact.json"), "utf8"));
    if (JSON.stringify(receipt) !== JSON.stringify(PINNED_CUA_DRIVER_RUNTIME)) return false;
    for (const file of PINNED_CUA_DRIVER_RUNTIME.files) {
      const identity = await sha256File(requireDirectFile(path.join(targetRoot, file.name), file.name));
      if (identity.size !== file.size || identity.sha256 !== file.sha256) return false;
    }
    for (const notice of PINNED_CUA_DRIVER_RUNTIME.notices) {
      const identity = await sha256File(requireDirectFile(path.join(licensesRoot, notice.name), notice.name));
      if (identity.size !== notice.size || identity.sha256 !== notice.sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function commitRuntime({ stagedTarget, targetRoot, stagedNotices, licensesRoot }) {
  const parent = path.dirname(targetRoot);
  const backupRoot = fs.mkdtempSync(path.join(parent, ".cua-driver-backup-"));
  const entries = [
    { source: stagedTarget, destination: targetRoot, backup: path.join(backupRoot, "runtime"), directory: true },
    ...stagedNotices.map(({ source, name }) => ({
      source,
      destination: path.join(licensesRoot, name),
      backup: path.join(backupRoot, name),
      directory: false,
    })),
  ];
  let preserveBackup = false;
  try {
    for (const entry of entries) {
      if (fs.existsSync(entry.destination)) {
        fs.renameSync(entry.destination, entry.backup);
        entry.backedUp = true;
      }
    }
    for (const entry of entries) {
      fs.renameSync(entry.source, entry.destination);
      entry.installed = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of [...entries].reverse()) {
      try {
        if (entry.installed && fs.existsSync(entry.destination)) {
          fs.rmSync(entry.destination, { recursive: entry.directory, force: true });
        }
        if (entry.backedUp && fs.existsSync(entry.backup)) {
          fs.renameSync(entry.backup, entry.destination);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      preserveBackup = true;
      throw new AggregateError([error, ...rollbackErrors], "Computer Use runtime swap and rollback failed.");
    }
    throw error;
  } finally {
    if (!preserveBackup) fs.rmSync(backupRoot, { recursive: true, force: true });
  }
}

export async function stagePinnedCuaDriverRuntime({
  targetRoot,
  licensesRoot,
  suppliedPaths = {},
  offline = false,
  log = () => {},
} = {}) {
  if (process.platform !== PINNED_CUA_DRIVER_RUNTIME.platform || process.arch !== PINNED_CUA_DRIVER_RUNTIME.architecture) {
    throw new Error("The reviewed Hermes Computer Use runtime currently supports Windows x64 only.");
  }
  targetRoot = requireAbsoluteDirectory(targetRoot, "cua-driver", "Computer Use target root");
  const targetParent = requireAbsoluteDirectory(path.dirname(targetRoot), null, "Computer Use target parent", { create: true });
  licensesRoot = requireAbsoluteDirectory(licensesRoot, "licenses", "Computer Use license root", { create: true });
  if (await runtimeIsComplete(targetRoot, licensesRoot)) {
    log(`reusing reviewed cua-driver ${PINNED_CUA_DRIVER_RUNTIME.version}`);
    return PINNED_CUA_DRIVER_RUNTIME;
  }

  const workRoot = fs.mkdtempSync(path.join(targetParent, ".cua-driver-work-"));
  const stagedTarget = fs.mkdtempSync(path.join(targetParent, ".cua-driver-stage-"));
  const nonce = randomUUID();
  const stagedNotices = PINNED_CUA_DRIVER_RUNTIME.notices.map((notice) => ({
    name: notice.name,
    source: path.join(licensesRoot, `.cua-driver-${nonce}-${notice.name}.stage`),
  }));
  try {
    const archive = path.join(workRoot, PINNED_CUA_DRIVER_RUNTIME.archive.name);
    log(`acquiring ${PINNED_CUA_DRIVER_RUNTIME.archive.name}`);
    await acquirePinnedFile({
      label: "Hermes Computer Use driver archive",
      suppliedPath: suppliedPaths.archive,
      receipt: PINNED_CUA_DRIVER_RUNTIME.archive,
      destination: archive,
      offline,
    });
    const extracted = path.join(workRoot, "extracted");
    fs.mkdirSync(extracted);
    const extraction = spawnSync("tar.exe", ["-xf", archive, "-C", extracted], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    if (extraction.status !== 0) {
      throw new Error(`Hermes Computer Use archive extraction failed: ${extraction.stderr.trim()}.`);
    }
    const entries = fs.readdirSync(extracted, { withFileTypes: true });
    const expectedNames = new Set(PINNED_CUA_DRIVER_RUNTIME.files.map(({ name }) => name));
    if (entries.length !== expectedNames.size || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !expectedNames.has(entry.name))) {
      throw new Error("Hermes Computer Use archive does not contain the exact reviewed file closure.");
    }
    for (const file of PINNED_CUA_DRIVER_RUNTIME.files) {
      const source = requireDirectFile(path.join(extracted, file.name), `reviewed ${file.name}`);
      const identity = await sha256File(source);
      if (identity.size !== file.size || identity.sha256 !== file.sha256) {
        throw new Error(`Hermes Computer Use file ${file.name} is not the reviewed release.`);
      }
      fs.copyFileSync(source, path.join(stagedTarget, file.name));
    }
    for (let index = 0; index < PINNED_CUA_DRIVER_RUNTIME.notices.length; index += 1) {
      const notice = PINNED_CUA_DRIVER_RUNTIME.notices[index];
      log(`acquiring ${notice.name}`);
      await acquirePinnedFile({
        label: notice.name,
        suppliedPath: suppliedPaths.notices?.[notice.name],
        receipt: notice,
        destination: stagedNotices[index].source,
        offline,
      });
    }
    fs.writeFileSync(
      path.join(stagedTarget, "runtime-artifact.json"),
      `${JSON.stringify(PINNED_CUA_DRIVER_RUNTIME, null, 2)}\n`,
      { encoding: "utf8", mode: 0o644 },
    );
    commitRuntime({ stagedTarget, targetRoot, stagedNotices, licensesRoot });
    return PINNED_CUA_DRIVER_RUNTIME;
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
    fs.rmSync(stagedTarget, { recursive: true, force: true });
    for (const notice of stagedNotices) fs.rmSync(notice.source, { force: true });
  }
}
