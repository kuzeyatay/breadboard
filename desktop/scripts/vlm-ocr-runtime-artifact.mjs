import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const PINNED_VLM_OCR_RUNTIME = Object.freeze({
  schemaVersion: 1,
  service: "vlm-ocr",
  platform: "win32",
  architecture: "x64",
  llamaCpp: {
    release: "b10369",
    sourceCommit: "6e62ba538478202094edc6c100c782719e310aa3",
    archive: {
      name: "llama-b10369-bin-win-cpu-x64.zip",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b10369/llama-b10369-bin-win-cpu-x64.zip",
      size: 18_458_753,
      sha256: "D6F606412F2335BC4A2324750306E8B5B027E8327F183990B2DBE3671F7F9DBD",
    },
    version: { number: 10_369, sourceCommit: "6e62ba538" },
    runtimeFiles: [
      "ggml-base.dll",
      "ggml-cpu-alderlake.dll",
      "ggml-cpu-cannonlake.dll",
      "ggml-cpu-cascadelake.dll",
      "ggml-cpu-cooperlake.dll",
      "ggml-cpu-haswell.dll",
      "ggml-cpu-icelake.dll",
      "ggml-cpu-ivybridge.dll",
      "ggml-cpu-piledriver.dll",
      "ggml-cpu-sandybridge.dll",
      "ggml-cpu-sapphirerapids.dll",
      "ggml-cpu-skylakex.dll",
      "ggml-cpu-sse42.dll",
      "ggml-cpu-x64.dll",
      "ggml-cpu-zen4.dll",
      "ggml.dll",
      "libomp140.x86_64.dll",
      "llama-common.dll",
      "llama-server-impl.dll",
      "llama-server.exe",
      "llama.dll",
      "mtmd.dll",
    ],
    runtimeTree: {
      fileCount: 22,
      sha256: "FECA456BE9B69608A13659D4D5FA7A015A57D81A8FAE42F96CCCA461E7DF42D6",
    },
    license: {
      name: "llama.cpp-LICENSE.txt",
      url: "https://raw.githubusercontent.com/ggml-org/llama.cpp/6e62ba538478202094edc6c100c782719e310aa3/LICENSE",
      size: 1_078,
      sha256: "94F29BBED6A22C35B992C5C6EBF0E7C92F13B836B90F36F461C9CF2F0F1D010D",
    },
  },
  model: {
    repository: "ggml-org/HunyuanOCR-GGUF",
    revision: "8e070c9ad79e4ca97a9b4daa2f1ce17e8759afb1",
    weights: {
      name: "HunyuanOCR-Q8_0.gguf",
      url: "https://huggingface.co/ggml-org/HunyuanOCR-GGUF/resolve/8e070c9ad79e4ca97a9b4daa2f1ce17e8759afb1/HunyuanOCR-Q8_0.gguf?download=true",
      size: 577_949_408,
      sha256: "CDAFC794CAFEAE377868D7A40A70E282A737E39ABE77C0D8B73614447B364A21",
    },
    projector: {
      name: "mmproj-HunyuanOCR-Q8_0.gguf",
      url: "https://huggingface.co/ggml-org/HunyuanOCR-GGUF/resolve/8e070c9ad79e4ca97a9b4daa2f1ce17e8759afb1/mmproj-HunyuanOCR-Q8_0.gguf?download=true",
      size: 732_938_240,
      sha256: "B77913164FF73D4C0DC4D994E236ED72BACBBE5C5DB1EC9B2828627B46C32804",
    },
    license: {
      name: "HunyuanOCR-LICENSE.txt",
      sourceCommit: "b7bf72439f11fa076c547edf8777aa85f8e0a027",
      url: "https://huggingface.co/tencent/HunyuanOCR/resolve/b7bf72439f11fa076c547edf8777aa85f8e0a027/LICENSE?download=true",
      size: 16_277,
      sha256: "745ADAA59575D2A98B64FD6D3452537B477A6B6EDC126F742FC055313CC3D3E0",
    },
  },
});

function canonicalFileIdentity(filePath) {
  const source = fs.readFileSync(filePath);
  const canonical = source.includes(0)
    ? source
    : Buffer.from(source.toString("utf8").replace(/\r\n/gu, "\n"), "utf8");
  return {
    size: canonical.length,
    sha256: createHash("sha256").update(canonical).digest("hex").toUpperCase(),
  };
}

async function sha256Tree(root) {
  const records = [];
  async function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
      const metadata = fs.lstatSync(fullPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`VLM OCR runtime closure contains a symlink: ${fullPath}`);
      }
      if (metadata.isDirectory()) {
        await visit(fullPath);
      } else if (metadata.isFile()) {
        const identity = canonicalFileIdentity(fullPath);
        records.push(`${relativePath}\0${identity.size}\0${identity.sha256}\n`);
      } else {
        throw new Error(`VLM OCR runtime closure contains a non-file entry: ${fullPath}`);
      }
    }
  }
  await visit(root);
  return {
    sha256: createHash("sha256").update(records.join("")).digest("hex").toUpperCase(),
    fileCount: records.length,
  };
}

export function declaredDecodedContentLength(headers) {
  const contentEncoding = headers.get("content-encoding")?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") return null;
  const headerSize = Number(headers.get("content-length"));
  return Number.isSafeInteger(headerSize) && headerSize > 0 ? headerSize : null;
}

async function acquirePinnedArtifact({ label, suppliedPath, receipt, destination, offline }) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.rmSync(destination, { force: true });

  let source;
  let declaredSize = null;
  if (suppliedPath) {
    const resolved = path.resolve(suppliedPath);
    const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${label} supplied artifact is not a direct regular file: ${resolved}`);
    }
    if (metadata.size !== receipt.size) {
      throw new Error(`${label} supplied artifact size is ${metadata.size}; expected ${receipt.size}.`);
    }
    declaredSize = metadata.size;
    source = fs.createReadStream(resolved);
  } else {
    if (offline) {
      throw new Error(`${label} requires a supplied immutable artifact in offline mode.`);
    }
    const response = await fetch(receipt.url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`${label} download failed with HTTP ${response.status}.`);
    }
    declaredSize = declaredDecodedContentLength(response.headers);
    if (declaredSize !== null && declaredSize !== receipt.size) {
      throw new Error(`${label} server declared ${declaredSize} bytes; expected ${receipt.size}.`);
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

function assertDirectPathSegments(candidate, label, { createDirectory = false } = {}) {
  const resolved = path.resolve(candidate);
  if (!path.isAbsolute(candidate)) throw new Error(`${label} must be an absolute path.`);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let metadata = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!metadata && createDirectory) {
      fs.mkdirSync(current);
      metadata = fs.lstatSync(current);
    }
    if (!metadata) break;
    if (metadata.isSymbolicLink()) {
      throw new Error(`${label} traverses a symlink or junction: ${current}`);
    }
  }
  return resolved;
}

function assertDirectDirectory(candidate, expectedName, label, { create = false } = {}) {
  const resolved = assertDirectPathSegments(candidate, label, { createDirectory: create });
  if (expectedName && path.basename(resolved).toLowerCase() !== expectedName) {
    throw new Error(`${label} must be an absolute ${expectedName} directory.`);
  }
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata && !create) return resolved;
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a direct directory.`);
  }
  return resolved;
}

function assertDirectFile(candidate, label, { allowMissing = false } = {}) {
  const resolved = assertDirectPathSegments(candidate, label);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata && allowMissing) return resolved;
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a direct regular file.`);
  }
  return resolved;
}

export function commitPinnedVlmOcrArtifactSet({
  stagedTarget,
  targetRoot,
  stagedLicenses,
  licensesRoot,
  operations = fs,
}) {
  targetRoot = assertDirectDirectory(targetRoot, "vlm-ocr", "VLM OCR target root");
  const targetParent = assertDirectDirectory(
    path.dirname(targetRoot),
    null,
    "VLM OCR target parent",
    { create: true },
  );
  licensesRoot = assertDirectDirectory(licensesRoot, "licenses", "VLM OCR license root", {
    create: true,
  });
  stagedTarget = assertDirectDirectory(stagedTarget, null, "staged VLM OCR target");
  if (path.dirname(stagedTarget) !== targetParent) {
    throw new Error("staged VLM OCR target must be a same-parent sibling of its target.");
  }
  const targetMetadata = fs.lstatSync(targetRoot, { throwIfNoEntry: false });
  if (targetMetadata && (!targetMetadata.isDirectory() || targetMetadata.isSymbolicLink())) {
    throw new Error("VLM OCR target root must be absent or a direct directory.");
  }

  const expectedLicenseNames = new Set([
    PINNED_VLM_OCR_RUNTIME.llamaCpp.license.name,
    PINNED_VLM_OCR_RUNTIME.model.license.name,
  ]);
  if (!Array.isArray(stagedLicenses) || stagedLicenses.length !== expectedLicenseNames.size) {
    throw new Error("VLM OCR staging must provide the complete reviewed license set.");
  }
  const validatedLicenses = stagedLicenses.map(({ staged, name }) => {
    if (path.basename(name) !== name || !expectedLicenseNames.delete(name)) {
      throw new Error(`VLM OCR staging contains an unexpected or duplicate license: ${name}`);
    }
    const stagedLicense = assertDirectFile(staged, `staged VLM OCR license ${name}`);
    if (path.dirname(stagedLicense) !== licensesRoot) {
      throw new Error(`staged VLM OCR license ${name} must be a same-parent sibling of its target.`);
    }
    return { staged: stagedLicense, name };
  });
  if (expectedLicenseNames.size !== 0) {
    throw new Error("VLM OCR staging is missing a reviewed license.");
  }

  const targetBackupRoot = operations.mkdtempSync(
    path.join(targetParent, ".vlm-ocr-target-backup-"),
  );
  let licenseBackupRoot;
  try {
    licenseBackupRoot = operations.mkdtempSync(
      path.join(licensesRoot, ".vlm-ocr-license-backup-"),
    );
  } catch (error) {
    operations.rmSync(targetBackupRoot, { recursive: true, force: true });
    throw error;
  }
  const entries = [
    {
      staged: stagedTarget,
      destination: targetRoot,
      backup: path.join(targetBackupRoot, "vlm-ocr"),
      directory: true,
      label: "VLM OCR runtime",
    },
    ...validatedLicenses.map(({ staged, name }) => ({
      staged,
      destination: assertDirectFile(
        path.join(licensesRoot, name),
        `installed VLM OCR license ${name}`,
        { allowMissing: true },
      ),
      backup: path.join(licenseBackupRoot, name),
      directory: false,
      label: `VLM OCR license ${name}`,
    })),
  ];

  let committed = false;
  let failure = null;
  let preserveBackups = false;
  try {
    for (const entry of entries) {
      if (fs.existsSync(entry.destination)) {
        operations.renameSync(entry.destination, entry.backup);
        entry.backedUp = true;
      }
    }
    for (const entry of entries) {
      operations.renameSync(entry.staged, entry.destination);
      entry.installed = true;
    }
    committed = true;
  } catch (error) {
    failure = error;
    const rollbackErrors = [];
    for (const entry of [...entries].reverse()) {
      if (!entry.installed || !fs.existsSync(entry.destination)) continue;
      try {
        operations.rmSync(entry.destination, {
          recursive: entry.directory,
          force: true,
        });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const entry of [...entries].reverse()) {
      if (!entry.backedUp || !fs.existsSync(entry.backup)) continue;
      try {
        operations.renameSync(entry.backup, entry.destination);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      preserveBackups = true;
      failure = new AggregateError(
        [error, ...rollbackErrors],
        "VLM OCR artifact swap failed and rollback was incomplete.",
      );
    }
  } finally {
    if (!preserveBackups) {
      operations.rmSync(targetBackupRoot, { recursive: true, force: true });
      operations.rmSync(licenseBackupRoot, { recursive: true, force: true });
    }
  }
  if (!committed) throw failure;
}

export async function stagePinnedVlmOcrRuntime({
  targetRoot,
  licensesRoot,
  suppliedPaths = {},
  offline = false,
  log = () => {},
} = {}) {
  if (process.platform !== PINNED_VLM_OCR_RUNTIME.platform || process.arch !== PINNED_VLM_OCR_RUNTIME.architecture) {
    throw new Error("The reviewed packaged VLM OCR runtime currently supports Windows x64 only.");
  }
  if (!targetRoot || !licensesRoot) {
    throw new Error("VLM OCR staging requires explicit target and license roots.");
  }
  targetRoot = assertDirectDirectory(targetRoot, "vlm-ocr", "VLM OCR target root");
  const targetParent = assertDirectDirectory(
    path.dirname(targetRoot),
    null,
    "VLM OCR target parent",
    { create: true },
  );
  licensesRoot = assertDirectDirectory(licensesRoot, "licenses", "VLM OCR license root", {
    create: true,
  });

  let workRoot = null;
  let stagedTarget = null;
  const stageNonce = randomUUID();
  const stagedLlamaLicense = path.join(
    licensesRoot,
    `.vlm-ocr-${stageNonce}-llama-license.stage`,
  );
  const stagedModelLicense = path.join(
    licensesRoot,
    `.vlm-ocr-${stageNonce}-model-license.stage`,
  );
  try {
    workRoot = fs.mkdtempSync(path.join(targetParent, ".vlm-ocr-work-"));
    stagedTarget = fs.mkdtempSync(path.join(targetParent, ".vlm-ocr-target-stage-"));
    const archive = path.join(workRoot, PINNED_VLM_OCR_RUNTIME.llamaCpp.archive.name);
    const extracted = path.join(workRoot, "extracted");
    const stagedRuntime = path.join(stagedTarget, "runtime");
    const stagedModels = path.join(stagedTarget, "models");
    fs.mkdirSync(extracted, { recursive: true });
    fs.mkdirSync(stagedRuntime, { recursive: true });
    fs.mkdirSync(stagedModels, { recursive: true });

    log(`acquiring ${PINNED_VLM_OCR_RUNTIME.llamaCpp.archive.name}`);
    await acquirePinnedArtifact({
      label: "VLM OCR llama.cpp archive",
      suppliedPath: suppliedPaths.llamaArchive,
      receipt: PINNED_VLM_OCR_RUNTIME.llamaCpp.archive,
      destination: archive,
      offline,
    });
    const extraction = spawnSync(
      process.platform === "win32" ? "tar.exe" : "tar",
      ["-xf", archive, "-C", extracted],
      { encoding: "utf8", shell: false, windowsHide: true },
    );
    if (extraction.status !== 0) {
      throw new Error(`VLM OCR llama.cpp extraction failed: ${extraction.stderr.trim()}.`);
    }
    for (const name of PINNED_VLM_OCR_RUNTIME.llamaCpp.runtimeFiles) {
      const source = path.join(extracted, name);
      const metadata = fs.lstatSync(source, { throwIfNoEntry: false });
      if (!metadata?.isFile() || metadata.isSymbolicLink()) {
        throw new Error(`VLM OCR llama.cpp archive is missing reviewed runtime file ${name}.`);
      }
      fs.copyFileSync(source, path.join(stagedRuntime, name));
    }
    const runtimeIdentity = await sha256Tree(stagedRuntime);
    if (
      runtimeIdentity.fileCount !== PINNED_VLM_OCR_RUNTIME.llamaCpp.runtimeTree.fileCount ||
      runtimeIdentity.sha256 !== PINNED_VLM_OCR_RUNTIME.llamaCpp.runtimeTree.sha256
    ) {
      throw new Error(
        `VLM OCR llama.cpp runtime tree is not reviewed (${runtimeIdentity.fileCount} files, SHA-256 ${runtimeIdentity.sha256}).`,
      );
    }
    const version = spawnSync(path.join(stagedRuntime, "llama-server.exe"), ["--version"], {
      cwd: stagedRuntime,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 30_000,
    });
    const versionOutput = `${version.stdout ?? ""}\n${version.stderr ?? ""}`;
    if (
      version.status !== 0 ||
      !versionOutput.includes(`version: ${PINNED_VLM_OCR_RUNTIME.llamaCpp.version.number} `) ||
      !versionOutput.includes(`(${PINNED_VLM_OCR_RUNTIME.llamaCpp.version.sourceCommit})`)
    ) {
      throw new Error(`VLM OCR llama.cpp version smoke failed: ${versionOutput.trim() || "no output"}.`);
    }

    for (const [label, suppliedPath, receipt, destination] of [
      ["HunyuanOCR Q8 weights", suppliedPaths.model, PINNED_VLM_OCR_RUNTIME.model.weights, path.join(stagedModels, PINNED_VLM_OCR_RUNTIME.model.weights.name)],
      ["HunyuanOCR Q8 vision projector", suppliedPaths.projector, PINNED_VLM_OCR_RUNTIME.model.projector, path.join(stagedModels, PINNED_VLM_OCR_RUNTIME.model.projector.name)],
      ["llama.cpp license", suppliedPaths.llamaLicense, PINNED_VLM_OCR_RUNTIME.llamaCpp.license, stagedLlamaLicense],
      ["HunyuanOCR license", suppliedPaths.modelLicense, PINNED_VLM_OCR_RUNTIME.model.license, stagedModelLicense],
    ]) {
      log(`acquiring ${label}`);
      await acquirePinnedArtifact({ label, suppliedPath, receipt, destination, offline });
    }
    fs.writeFileSync(
      path.join(stagedTarget, "runtime-artifact.json"),
      `${JSON.stringify(PINNED_VLM_OCR_RUNTIME, null, 2)}\n`,
      { encoding: "utf8", mode: 0o644 },
    );

    commitPinnedVlmOcrArtifactSet({
      stagedTarget,
      targetRoot,
      licensesRoot,
      stagedLicenses: [
        {
          name: PINNED_VLM_OCR_RUNTIME.llamaCpp.license.name,
          staged: stagedLlamaLicense,
        },
        {
          name: PINNED_VLM_OCR_RUNTIME.model.license.name,
          staged: stagedModelLicense,
        },
      ],
    });
    return PINNED_VLM_OCR_RUNTIME;
  } finally {
    if (workRoot) fs.rmSync(workRoot, { recursive: true, force: true });
    if (stagedTarget) fs.rmSync(stagedTarget, { recursive: true, force: true });
    fs.rmSync(stagedLlamaLicense, { force: true });
    fs.rmSync(stagedModelLicense, { force: true });
  }
}
