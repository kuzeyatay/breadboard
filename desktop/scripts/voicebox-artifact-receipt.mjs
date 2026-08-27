const SHA256_PATTERN = /^[0-9A-F]{64}$/u;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

export const VOICEBOX_ARTIFACT_AUTHORITY = Object.freeze({
  schemaVersion: 1,
  name: "voicebox-server",
  version: "0.5.0",
  backendVersion: "0.2.3",
  platform: "win32",
  architecture: "x64",
  sourceCommit: "51f49dea198384b4eb6087b72c17057c6eb1c1cd",
  executable: "voicebox-server.exe",
  buildPython: Object.freeze({
    implementation: "CPython",
    version: "3.12.13",
    architecture: "64bit",
  }),
  pyinstaller: Object.freeze({
    version: "6.22.2",
    filename: "pyinstaller-6.22.2-py3-none-win_amd64.whl",
    size: 1_405_725,
    sha256: "9B990FA6BBE143572F06644A984AD0D7AA2E2CCC6929D4916031343A5888E9A7",
  }),
  builderArtifacts: Object.freeze([
    Object.freeze({
      distribution: "altgraph",
      version: "0.17.5",
      filename: "altgraph-0.17.5-py2.py3-none-any.whl",
      size: 21_228,
      sha256: "F3A22400BCE1B0C701683820AC4F3B159CD301ACAB067C51C653E06961600597",
      url: "https://files.pythonhosted.org/packages/a9/ba/000a1996d4308bc65120167c21241a3b205464a2e0b58deda26ae8ac21d1/altgraph-0.17.5-py2.py3-none-any.whl",
      purpose: "PyInstaller module-dependency graph",
    }),
    Object.freeze({
      distribution: "packaging",
      version: "26.2",
      filename: "packaging-26.2-py3-none-any.whl",
      size: 100_195,
      sha256: "5FC45236B9446107FF2415CE77C807CEE2862CB6FAC22B8A73826D0693B0980E",
      url: "https://files.pythonhosted.org/packages/df/b2/87e62e8c3e2f4b32e5fe99e0b86d576da1312593b39f47d8ceef365e95ed/packaging-26.2-py3-none-any.whl",
      purpose: "PyInstaller version and requirement parsing",
    }),
    Object.freeze({
      distribution: "pefile",
      version: "2024.8.26",
      filename: "pefile-2024.8.26-py3-none-any.whl",
      size: 74_766,
      sha256: "76F8B485DCD3B1BB8166F1128D395FA3D87AF26360C2358FB75B80019B957C6F",
      url: "https://files.pythonhosted.org/packages/54/16/12b82f791c7f50ddec566873d5bdd245baa1491bac11d15ffb98aecc8f8b/pefile-2024.8.26-py3-none-any.whl",
      purpose: "PyInstaller Windows PE inspection",
    }),
    Object.freeze({
      distribution: "pyinstaller",
      version: "6.22.2",
      filename: "pyinstaller-6.22.2-py3-none-win_amd64.whl",
      size: 1_405_725,
      sha256: "9B990FA6BBE143572F06644A984AD0D7AA2E2CCC6929D4916031343A5888E9A7",
      url: "https://files.pythonhosted.org/packages/3f/53/8ba1d0f6159b490f700eac6161a4be5f0d4672608a6dae9fd73679f183ee/pyinstaller-6.22.2-py3-none-win_amd64.whl",
      purpose: "reviewed Windows onefile executable builder",
    }),
    Object.freeze({
      distribution: "pyinstaller-hooks-contrib",
      version: "2026.7",
      filename: "pyinstaller_hooks_contrib-2026.7-py3-none-any.whl",
      size: 459_445,
      sha256: "24257A04C7A5A7A034CF28E39DCEE20FBEEB9F043076729480F2E1B69904408A",
      url: "https://files.pythonhosted.org/packages/0a/67/350377af7b50416344ab8792756d414eef7629c618a73e9a0b13bb1552d9/pyinstaller_hooks_contrib-2026.7-py3-none-any.whl",
      purpose: "PyInstaller third-party package hook collection",
    }),
    Object.freeze({
      distribution: "pywin32-ctypes",
      version: "0.2.3",
      filename: "pywin32_ctypes-0.2.3-py3-none-any.whl",
      size: 30_756,
      sha256: "8A1513379D709975552D202D942D9837758905C8D01EB82B8BCC30918929E7B8",
      url: "https://files.pythonhosted.org/packages/de/3d/8161f7711c017e01ac9f008dfddd9410dff3674334c233bde66e7ba65bbf/pywin32_ctypes-0.2.3-py3-none-any.whl",
      purpose: "PyInstaller Windows API compatibility layer",
    }),
    Object.freeze({
      distribution: "setuptools",
      version: "78.1.0",
      filename: "setuptools-78.1.0-py3-none-any.whl",
      size: 1_256_108,
      sha256: "3E386E96793C8702AE83D17B853FB93D3E09EF82EC62722E61DA5CD22376DCD8",
      url: "https://files.pythonhosted.org/packages/54/21/f43f0a1fa8b06b32812e0975981f4677d28e0f3271601dc88ac5a5b83220/setuptools-78.1.0-py3-none-any.whl",
      purpose: "PyInstaller packaging metadata support",
    }),
  ]),
  cpuRuntimeArtifacts: Object.freeze([
    Object.freeze({
      distribution: "torch",
      version: "2.11.0+cpu",
      filename: "torch-2.11.0+cpu-cp312-cp312-win_amd64.whl",
      size: 114_469_197,
      sha256: "1ABEAA46FA7532ED35ED79146F4DE5D7A9D4B30462C98052EA4DDFE781EA3ECA",
      url: "https://download-r2.pytorch.org/whl/cpu/torch-2.11.0%2Bcpu-cp312-cp312-win_amd64.whl",
      purpose: "CPU-only tensor and inference runtime embedded in the sidecar",
    }),
    Object.freeze({
      distribution: "torchaudio",
      version: "2.11.0+cpu",
      filename: "torchaudio-2.11.0+cpu-cp312-cp312-win_amd64.whl",
      size: 326_400,
      sha256: "95D517BD1A0A28DACD1C37550CED95CAB64F3A7A4EF9B8219B41049388A71163",
      url: "https://download-r2.pytorch.org/whl/cpu/torchaudio-2.11.0%2Bcpu-cp312-cp312-win_amd64.whl",
      purpose: "CPU-only Torch audio operators embedded in the sidecar",
    }),
    Object.freeze({
      distribution: "torchvision",
      version: "0.26.0+cpu",
      filename: "torchvision-0.26.0+cpu-cp312-cp312-win_amd64.whl",
      size: 4_255_267,
      sha256: "52AA8401850A9792E71A8A1E65AC004E2B23622A6B6FD278CD11179EFBEFC65B",
      url: "https://download-r2.pytorch.org/whl/cpu/torchvision-0.26.0%2Bcpu-cp312-cp312-win_amd64.whl",
      purpose: "CPU-only Torch vision operators required by the speech-model closure",
    }),
  ]),
  sourceTreeFormat: "git-ls-files-canonical-lf-v1",
  dependencyInventoryFormat: "pip-freeze-runtime-sorted-lf-v1",
  normalizedArgumentsFormat: "nul-delimited-utf8-v1",
});

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "name",
  "version",
  "backendVersion",
  "platform",
  "architecture",
  "sourceCommit",
  "executable",
  "size",
  "sha256",
  "sourceTree",
  "buildPython",
  "pyinstallerVersion",
  "builderArtifacts",
  "cpuRuntimeArtifacts",
  "dependencyInventorySha256",
  "dependencyInventory",
  "directVcs",
  "build",
  "smoke",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function safeRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\\\p{Cc}]/u.test(value) &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/u.test(value) &&
    value.split("/").every((component) => component && component !== "." && component !== "..")
  );
}

function validateFileReceipt(value, label, problems, expectedPath = null) {
  if (!hasExactKeys(value, ["path", "size", "sha256"])) {
    problems.push(`${label} must contain exactly path, size, and sha256`);
    return;
  }
  if (!safeRelativePath(value.path) || (expectedPath !== null && value.path !== expectedPath)) {
    problems.push(`${label}.path is not the reviewed safe relative path`);
  }
  if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > 1_073_741_824) {
    problems.push(`${label}.size is invalid`);
  }
  if (!SHA256_PATTERN.test(value.sha256 ?? "")) {
    problems.push(`${label}.sha256 is invalid`);
  }
}

function validateHttpsVcsUrl(value, label, problems) {
  if (typeof value !== "string" || value.length > 2_048 || /\p{Cc}/u.test(value)) {
    problems.push(`${label} is invalid`);
    return;
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      problems.push(`${label} must be one credential-free immutable HTTPS repository URL`);
    }
  } catch {
    problems.push(`${label} is invalid`);
  }
}

export function voiceboxArtifactReceiptProblems(receipt) {
  const problems = [];
  const authority = VOICEBOX_ARTIFACT_AUTHORITY;
  if (!hasExactKeys(receipt, TOP_LEVEL_KEYS)) {
    problems.push("receipt must contain the exact reviewed top-level keys");
    return problems;
  }

  for (const name of [
    "schemaVersion",
    "name",
    "version",
    "backendVersion",
    "platform",
    "architecture",
    "sourceCommit",
    "executable",
  ]) {
    if (receipt[name] !== authority[name]) problems.push(`${name} is not the reviewed value`);
  }
  if (!Number.isSafeInteger(receipt.size) || receipt.size < 64 * 1_024 || receipt.size > 4_294_967_295) {
    problems.push("size is invalid");
  }
  if (!SHA256_PATTERN.test(receipt.sha256 ?? "")) problems.push("sha256 is invalid");

  if (!hasExactKeys(receipt.sourceTree, ["format", "fileCount", "sha256"])) {
    problems.push("sourceTree must contain exactly format, fileCount, and sha256");
  } else {
    if (receipt.sourceTree.format !== authority.sourceTreeFormat) {
      problems.push("sourceTree.format is not reviewed");
    }
    if (
      !Number.isSafeInteger(receipt.sourceTree.fileCount) ||
      receipt.sourceTree.fileCount < 1 ||
      receipt.sourceTree.fileCount > 50_000
    ) {
      problems.push("sourceTree.fileCount is invalid");
    }
    if (!SHA256_PATTERN.test(receipt.sourceTree.sha256 ?? "")) {
      problems.push("sourceTree.sha256 is invalid");
    }
  }

  if (!hasExactKeys(receipt.buildPython, ["implementation", "version", "architecture"])) {
    problems.push("buildPython must contain exactly implementation, version, and architecture");
  } else {
    for (const name of ["implementation", "version", "architecture"]) {
      if (receipt.buildPython[name] !== authority.buildPython[name]) {
        problems.push(`buildPython.${name} is not the reviewed value`);
      }
    }
  }
  if (receipt.pyinstallerVersion !== authority.pyinstaller.version) {
    problems.push("pyinstallerVersion is not reviewed");
  }
  if (!Array.isArray(receipt.builderArtifacts)) {
    problems.push("builderArtifacts must be the exact reviewed array");
  } else if (JSON.stringify(receipt.builderArtifacts) !== JSON.stringify(authority.builderArtifacts)) {
    problems.push("builderArtifacts must pin the exact reviewed official PyPI wheel closure");
  }
  if (!Array.isArray(receipt.cpuRuntimeArtifacts)) {
    problems.push("cpuRuntimeArtifacts must be the exact reviewed array");
  } else if (
    JSON.stringify(receipt.cpuRuntimeArtifacts) !== JSON.stringify(authority.cpuRuntimeArtifacts)
  ) {
    problems.push("cpuRuntimeArtifacts must pin the exact reviewed official CPU wheel closure");
  }

  if (!SHA256_PATTERN.test(receipt.dependencyInventorySha256 ?? "")) {
    problems.push("dependencyInventorySha256 is invalid");
  }
  if (!hasExactKeys(receipt.dependencyInventory, ["format", "entryCount", "sha256"])) {
    problems.push("dependencyInventory must contain exactly format, entryCount, and sha256");
  } else {
    if (receipt.dependencyInventory.format !== authority.dependencyInventoryFormat) {
      problems.push("dependencyInventory.format is not reviewed");
    }
    if (
      !Number.isSafeInteger(receipt.dependencyInventory.entryCount) ||
      receipt.dependencyInventory.entryCount < 1 ||
      receipt.dependencyInventory.entryCount > 10_000
    ) {
      problems.push("dependencyInventory.entryCount is invalid");
    }
    if (
      !SHA256_PATTERN.test(receipt.dependencyInventory.sha256 ?? "") ||
      receipt.dependencyInventory.sha256 !== receipt.dependencyInventorySha256
    ) {
      problems.push("dependency inventory hashes are invalid or inconsistent");
    }
  }

  if (!Array.isArray(receipt.directVcs) || receipt.directVcs.length > 128) {
    problems.push("directVcs must be one bounded array");
  } else {
    let previousDistribution = "";
    const seen = new Set();
    for (const [index, dependency] of receipt.directVcs.entries()) {
      const label = `directVcs[${index}]`;
      if (!hasExactKeys(dependency, ["distribution", "version", "vcs", "url", "commitId"])) {
        problems.push(`${label} has invalid keys`);
        continue;
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(dependency.distribution ?? "")) {
        problems.push(`${label}.distribution is invalid`);
      }
      const normalized = String(dependency.distribution ?? "").toLowerCase().replace(/[-_.]+/gu, "-");
      if (seen.has(normalized) || (previousDistribution && normalized <= previousDistribution)) {
        problems.push("directVcs must be unique and sorted by normalized distribution");
      }
      seen.add(normalized);
      previousDistribution = normalized;
      if (
        typeof dependency.version !== "string" ||
        !dependency.version ||
        dependency.version.length > 128 ||
        /\p{Cc}/u.test(dependency.version)
      ) {
        problems.push(`${label}.version is invalid`);
      }
      if (dependency.vcs !== "git") problems.push(`${label}.vcs must be git`);
      validateHttpsVcsUrl(dependency.url, `${label}.url`, problems);
      if (!GIT_COMMIT_PATTERN.test(dependency.commitId ?? "")) {
        problems.push(`${label}.commitId is not one full immutable Git commit`);
      }
    }
  }

  if (
    !hasExactKeys(receipt.build, [
      "variant",
      "bundleMode",
      "entrypoint",
      "arguments",
      "requirements",
      "buildScript",
      "sourceSpec",
      "generatedSpec",
      "normalizedPyinstallerArguments",
    ])
  ) {
    problems.push("build has invalid keys");
  } else {
    if (receipt.build.variant !== "cpu") problems.push("build.variant must be cpu");
    if (receipt.build.bundleMode !== "onefile") problems.push("build.bundleMode must be onefile");
    if (receipt.build.entrypoint !== "backend/server.py") {
      problems.push("build.entrypoint is not reviewed");
    }
    if (!Array.isArray(receipt.build.arguments) || receipt.build.arguments.length !== 0) {
      problems.push("build.arguments must record the reviewed no-argument CPU build invocation");
    }
    if (
      !Array.isArray(receipt.build.requirements) ||
      receipt.build.requirements.length < 1 ||
      receipt.build.requirements.length > 16
    ) {
      problems.push("build.requirements must be one bounded non-empty array");
    } else {
      let previousPath = "";
      const paths = new Set();
      for (const [index, requirement] of receipt.build.requirements.entries()) {
        validateFileReceipt(requirement, `build.requirements[${index}]`, problems);
        const relativePath = requirement?.path ?? "";
        if (paths.has(relativePath) || (previousPath && relativePath <= previousPath)) {
          problems.push("build.requirements must be unique and sorted by path");
        }
        paths.add(relativePath);
        previousPath = relativePath;
      }
      if (!paths.has("backend/requirements.txt")) {
        problems.push("build.requirements must pin backend/requirements.txt");
      }
    }
    validateFileReceipt(receipt.build.buildScript, "build.buildScript", problems, "backend/build_binary.py");
    validateFileReceipt(receipt.build.sourceSpec, "build.sourceSpec", problems, "backend/voicebox-server.spec");
    validateFileReceipt(receipt.build.generatedSpec, "build.generatedSpec", problems, "backend/voicebox-server.spec");
    if (
      !hasExactKeys(receipt.build.normalizedPyinstallerArguments, [
        "format",
        "argumentCount",
        "sha256",
      ])
    ) {
      problems.push("build.normalizedPyinstallerArguments has invalid keys");
    } else {
      const normalized = receipt.build.normalizedPyinstallerArguments;
      if (normalized.format !== authority.normalizedArgumentsFormat) {
        problems.push("build.normalizedPyinstallerArguments.format is not reviewed");
      }
      if (
        !Number.isSafeInteger(normalized.argumentCount) ||
        normalized.argumentCount < 1 ||
        normalized.argumentCount > 2_048
      ) {
        problems.push("build.normalizedPyinstallerArguments.argumentCount is invalid");
      }
      if (!SHA256_PATTERN.test(normalized.sha256 ?? "")) {
        problems.push("build.normalizedPyinstallerArguments.sha256 is invalid");
      }
    }
  }

  if (
    !hasExactKeys(receipt.smoke, [
      "dynamicPort",
      "host",
      "healthPath",
      "httpStatus",
      "reportedStatus",
      "backendVariant",
      "modelLoaded",
      "reportedVersion",
      "isolatedDataDirectory",
      "zeroDescendantsAfterStop",
    ])
  ) {
    problems.push("smoke has invalid keys");
  } else {
    const expectedSmoke = {
      dynamicPort: true,
      host: "127.0.0.1",
      healthPath: "/health",
      httpStatus: 200,
      reportedStatus: "healthy",
      backendVariant: "cpu",
      modelLoaded: false,
      reportedVersion: authority.version,
      isolatedDataDirectory: true,
      zeroDescendantsAfterStop: true,
    };
    for (const [name, expected] of Object.entries(expectedSmoke)) {
      if (receipt.smoke[name] !== expected) problems.push(`smoke.${name} is not the reviewed value`);
    }
  }
  return problems;
}

export function assertVoiceboxArtifactReceipt(receipt) {
  const problems = voiceboxArtifactReceiptProblems(receipt);
  if (problems.length > 0) {
    throw new Error(`Voicebox native artifact receipt is invalid: ${problems.join("; ")}.`);
  }
  return receipt;
}
