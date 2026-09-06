// Assembles the self-contained runtimes shipped inside the Windows installer:
//
//   build-resources/runtimes/node/node.exe    — official Node runtime (copied
//       from the Node running this script; keeps native-module ABI identical
//       to the one dashboard/node_modules was installed for)
//   build-resources/runtimes/bun/bun.exe      — Bun runtime for optional tools
//   build-resources/runtimes/python/          — CPython embeddable distribution
//       matching the local Python's minor version, with ChatMock's pinned
//       dependencies installed into Lib/site-packages
//   build-resources/runtimes/{cad,colpali,humanizer,comfyui}-python/
//       — self-contained, exact official CPython bases plus hashed Windows
//       wheel closures. These are copied program roots rather than ordinary
//       venvs: a Windows venv retains an absolute builder-machine `home` path
//       and is not a clean-machine package boundary.
//
// The script is deterministic for a given machine toolchain and fails loudly
// when a runtime cannot be produced — packaging must not silently drop one.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { commitAtomicDirectorySwap } from "./atomic-artifact-swap.mjs";
import { ensureChatMockSourceHook } from "./chatmock-python-source-hook.mjs";
import { ensureHermesSourceHook } from "./hermes-python-source-hook.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const runtimesDir = path.join(desktopRoot, "build-resources", "runtimes");
const hermesRoot = path.join(repoRoot, "hermes-agent");
const ifixAiRoot = path.join(repoRoot, "iFixAi");
const HERMES_UPSTREAM_COMMIT = "4f5c688775a4ba850d7d3adc5dfd54efcf39ebd3";
const IFIXAI_UPSTREAM_COMMIT = "4ac9cc1c8765427300d98dc30855c18349610cf1";
const PYTHON_VERSION = "3.13.9";
const PYTHON_EMBED_ZIP_SHA256 = "91D828C2DA3A029B41699E918674A0CB379C02CF20DAB9C501306885F837402A";
const PYTHON_EXE_SHA256 = "08A64DC73AC3E3776B49F0097C6306BDB9C8F7990A037065213324D328467BF5";
const PACKAGED_SERVICE_UV_VERSION = "0.12.5";
const PACKAGED_SERVICE_UV_EXE_SHA256 = "8DA6CEDEF60C27AC997EBF400FBFC6D373C5B0A7AE6A299B9D52BE7FE63723FB";
let prepareOptions = { offline: false, only: null, prefetch: false };
const activeRuntimeStages = new Set();
process.on("exit", () => {
  for (const stage of activeRuntimeStages) {
    fs.rmSync(stage, { recursive: true, force: true });
  }
});

const PACKAGED_PYTHON_SERVICES = Object.freeze([
  {
    id: "cad",
    package: "breadboard-cad",
    packageVersion: "1.0.0",
    serviceDirectory: "cad-service",
    moduleDirectory: "breadboard_cad",
    runtimeDirectory: "cad-python",
    pythonVersion: "3.12.10",
    pythonArchiveUrl: "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip",
    pythonArchiveSha256: "4ACBED6DD1C744B0376E3B1CF57CE906F9DC9E95E68824584C8099A63025A3C3",
    pythonExecutableSha256: "4D6F5F81A4BCA11191C4C7C6B43632694D0A4CE74E068619D8FDC161D469859A",
    pythonRuntimeSha256: "00AFF22F464AFC3194EF14EE02B5AC3B9AF5819084FE9CC25EB4FB783EC0F55F",
    pythonRuntimeFileCount: 35,
    pythonLicenseSha256: "A4771D2216653FCA4E3472566A762BA8CE5358F6F6599455FE7CFACEB60D14B3",
    sourceGitTree: "ee9a7d277c8e9dac215b88393650b4ac68a4c9b7",
    sourceSha256: "932CEC6C1B8A38A5C45AB5264C28BF302E208E54883674C57946F5A0218F9B40",
    sourceFileCount: 10,
    pyprojectSha256: "062EE60275B6A65DB9AC6717AFCA300752350CD2A8F834A31B7895F8C80B006F",
    requirementsSha256: "2007C2A50F445ED19EDD602140835536F33E2A0C29BBE94EF4E8682A2CE3F1C3",
    lockSha256: "07C831A0C19239462D331B452DCDD48E67395BED46CB62E60994DDAD4700D4BD",
    packageCount: 43,
    corePackages: {
      cadquery: "2.6.0",
      "cadquery-ocp": "7.8.1.1.post1",
      pydantic: "2.13.4",
    },
    smokeImports: "import cadquery, OCP, pydantic, breadboard_cad.server, breadboard_cad.cadquery_engine",
    // CadQuery 2.6.0's exact Windows native graph can fault only during
    // embedded-Python teardown. The production CAD worker uses the same
    // one-shot exit after its result and exports have been closed.
    hardExitAfterSmoke: true,
  },
  {
    id: "colpali",
    package: "breadboard-colpali",
    packageVersion: "1.0.0",
    serviceDirectory: "colpali-service",
    moduleDirectory: "breadboard_colpali",
    runtimeDirectory: "colpali-python",
    pythonVersion: "3.13.13",
    pythonArchiveUrl: "https://www.python.org/ftp/python/3.13.13/python-3.13.13-embed-amd64.zip",
    pythonArchiveSize: 10_950_201,
    pythonArchiveSha256: "8766A8775746235E23CF5AEE5027AB1060BB981D93110577ADCF3508AA0CBD55",
    pythonExecutableSha256: "DC7ECF75280678175B4F931CE05F1EF9C10D48984399CA7DE6BEEE69D71BCB1B",
    pythonRuntimeSha256: "227E429CEEFA8C3D9F37AF5BAB72689D4DD1C09C25C693CF28144F1054D560E5",
    pythonRuntimeFileCount: 34,
    pythonLicenseSha256: "59688D8633CE27B1D8220F223B9520C4E039E4BA6CCCEB345793A74FD5C155B9",
    sourceGitTree: "91c9d36c7de0e719c8126f55fbadeeec4c642428",
    sourceSha256: "DFB0D4BF4280D2BCA2C8B5586A7941E2ED96C8CF91381622860E7DD7D7CB8392",
    sourceFileCount: 6,
    pyprojectSha256: "C4D4CAAC42C1AACE9227E98C2FB9EF430964EFBF7FF92FDF9C764C13A367A94C",
    requirementsSha256: "AF9BE4D427C2765527E636B46E9A01E7FA7C030B515AF82ECAC5CF80C4674ECE",
    lockSha256: "ECDEB94ADA9A2A55E0D8F565B3819345CD6268615ACF2412BCCBAA1DA11DA2AE",
    packageCount: 49,
    corePackages: {
      "colpali-engine": "0.3.17",
      pydantic: "2.13.4",
      torch: "2.6.0",
      torchvision: "0.21.0",
      transformers: "5.15.1",
    },
    smokeImports: "import colpali_engine, numpy, PIL, pydantic, torch, transformers, breadboard_colpali.server; from colpali_engine.models import ColIdefics3, ColIdefics3Processor",
  },
  {
    id: "humanizer",
    package: "breadboard-humanizer",
    packageVersion: "1.0.0",
    serviceDirectory: "humanizer-service",
    moduleDirectory: "breadboard_humanizer",
    runtimeDirectory: "humanizer-python",
    pythonVersion: "3.13.13",
    pythonArchiveUrl: "https://www.python.org/ftp/python/3.13.13/python-3.13.13-embed-amd64.zip",
    pythonArchiveSize: 10_950_201,
    pythonArchiveSha256: "8766A8775746235E23CF5AEE5027AB1060BB981D93110577ADCF3508AA0CBD55",
    pythonExecutableSha256: "DC7ECF75280678175B4F931CE05F1EF9C10D48984399CA7DE6BEEE69D71BCB1B",
    pythonRuntimeSha256: "227E429CEEFA8C3D9F37AF5BAB72689D4DD1C09C25C693CF28144F1054D560E5",
    pythonRuntimeFileCount: 34,
    pythonLicenseSha256: "59688D8633CE27B1D8220F223B9520C4E039E4BA6CCCEB345793A74FD5C155B9",
    sourceGitTree: "347738d7d0e2777d29fa5c53ed954baaa8e3e04e",
    sourceSha256: "1AB986E95F77763929C6BEFC001C83985D2D547C532F5F04C3815EA3650E0CF5",
    sourceFileCount: 8,
    pyprojectSha256: "D4CE90C6D505D706A5A68D1DA1EE3C7F92E7B8D6A68D15A579A67BA483D2E5A7",
    requirementsSha256: "D1E773C7578D36CB1A9AF6DF0581B20C0E6A7BE3BCA288894EBE617344412559",
    lockSha256: "55B896F45B1BF632AA6AB5FEC7A271EC8148EFBB839BBC6C421FCE91FB5DDCB6",
    noticesSha256: "763B91CFE47AE3E09C39D0DD18CE6999D776156BF486C40773AC13450E3D9465",
    packageCount: 31,
    platformExcludedPackages: ["hf-xet"],
    corePackages: {
      pydantic: "2.13.4",
      safetensors: "0.8.0",
      sentencepiece: "0.2.2",
      torch: "2.6.0",
      transformers: "4.57.6",
    },
    smokeImports: "import pydantic, safetensors, sentencepiece, torch, transformers, breadboard_humanizer.server; from transformers import AutoModelForSeq2SeqLM, AutoTokenizer",
  },
  {
    id: "solidworks-mcp",
    package: "solidworks-mcp-python",
    packageVersion: "1.0.1",
    serviceDirectory: "SolidworksMCP-python",
    moduleDirectory: "src/solidworks_mcp",
    packagedImportSubdirectory: "src",
    runtimeDirectory: "solidworks-python",
    pythonVersion: "3.13.13",
    pythonArchiveUrl: "https://www.python.org/ftp/python/3.13.13/python-3.13.13-embed-amd64.zip",
    pythonArchiveSize: 10_950_201,
    pythonArchiveSha256: "8766A8775746235E23CF5AEE5027AB1060BB981D93110577ADCF3508AA0CBD55",
    pythonExecutableSha256: "DC7ECF75280678175B4F931CE05F1EF9C10D48984399CA7DE6BEEE69D71BCB1B",
    pythonRuntimeSha256: "227E429CEEFA8C3D9F37AF5BAB72689D4DD1C09C25C693CF28144F1054D560E5",
    pythonRuntimeFileCount: 34,
    pythonLicenseSha256: "59688D8633CE27B1D8220F223B9520C4E039E4BA6CCCEB345793A74FD5C155B9",
    upstreamCommit: "a6d1f1be409547c43503dc4a4dcf2c39e6d99096",
    independentCheckout: true,
    sourceArchive: {
      name: "SolidworksMCP-python-a6d1f1be.zip",
      url: "https://codeload.github.com/andrewbartels1/SolidworksMCP-python/zip/a6d1f1be409547c43503dc4a4dcf2c39e6d99096",
      size: 5_403_833,
      sha256: "9C973CA49E8A243EA538EA61DB825CC3F8B727E0EAE5832B0D13E9EDD04907CC",
      rootDirectory: "SolidworksMCP-python-a6d1f1be409547c43503dc4a4dcf2c39e6d99096",
    },
    sourceGitTree: "04ba626c25d09fe3d18079e0dc45cecae62c7256",
    sourceSha256: "E17852FA897BAD6445D8407322A2794AC2351FA0941B8E3B94E4CE908B769B9F",
    sourceFileCount: 92,
    pyprojectSha256: "E8E4C1ABC111B866B1C3967C81673144AF8D346EB6B1E866E1E8F5CC5ECA8101",
    sourceLockFile: "uv.lock",
    sourceLockSha256: "189F8F7EE7FA473A1FF6E305603A58C534DB39B30854E3F16C31CFBA02DF644C",
    lockFormat: "uv-project-export",
    lockSha256: "2555A0542E322BB6DF3000AD850155AB4B0A16731AD16806981669C1265D75C9",
    packageCount: 159,
    platformExcludedPackages: ["jeepney", "secretstorage"],
    corePackages: {
      comtypes: "1.4.16",
      fastmcp: "3.4.2",
      mcp: "1.28.1",
      pydantic: "2.12.5",
      "pydantic-ai": "1.107.0",
      pywin32: "311",
      "pywin32-ctypes": "0.2.3",
      sqlmodel: "0.0.38",
      uvicorn: "0.41.0",
    },
    smokeImports:
      "import comtypes, fastmcp, mcp, pydantic, win32com.client, solidworks_mcp.config, solidworks_mcp.server",
    externalBoundary: ["locally licensed Windows SolidWorks installation and COM automation"],
  },
]);

const PINNED_COMFYUI_RUNTIME = Object.freeze({
  schemaVersion: 1,
  service: "comfyui",
  package: "ComfyUI",
  packageVersion: "0.30.0",
  platform: "win32",
  architecture: "x64",
  runtimeDirectory: "comfyui-python",
  python: {
    version: "3.12.10",
    archiveUrl: "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip",
    archiveSha256: "4ACBED6DD1C744B0376E3B1CF57CE906F9DC9E95E68824584C8099A63025A3C3",
    runtimeExecutableSha256: "4D6F5F81A4BCA11191C4C7C6B43632694D0A4CE74E068619D8FDC161D469859A",
    baseClosureSha256: "00AFF22F464AFC3194EF14EE02B5AC3B9AF5819084FE9CC25EB4FB783EC0F55F",
    baseClosureFileCount: 35,
    licenseSha256: "A4771D2216653FCA4E3472566A762BA8CE5358F6F6599455FE7CFACEB60D14B3",
  },
  uv: {
    version: "0.12.5",
    executableSha256: "8DA6CEDEF60C27AC997EBF400FBFC6D373C5B0A7AE6A299B9D52BE7FE63723FB",
  },
  source: {
    upstreamCommit: "2eb609766a749e3104485979615e062e401bab97",
    pyprojectSha256: "B4B313450FDD6F2B5D83772D64ECE440E66A0CCB7793B33A45C01E9F4E171735",
    requirementsSha256: "BDCFEC87BEAE821F2374C4A4CE36237E6BCEA08DDA7CF86881D49816E85BCA64",
  },
  dependencyLock: {
    format: "pylock.toml",
    target: "cp312-win_amd64",
    policy: "cpu",
    constraintsSha256: "49858A870C6241099BB64C4D7844508948C88D38B1E32E7804003A34BC1E8924",
    lockSha256: "E3D62AAE9F162C85F5CE6AED996C2A3C6EE253099F796873EC02EE306D696788",
    packageCount: 85,
    wheelCount: 94,
    hashesRequired: true,
    sourceDistributionsAllowed: false,
    approvedHosts: ["files.pythonhosted.org", "download-r2.pytorch.org"],
    corePackages: {
      "comfy-aimdo": "0.4.13",
      "comfy-kitchen": "0.2.26",
      "comfyui-frontend-package": "1.48.6",
      "comfyui-workflow-templates": "0.11.31",
      torch: "2.11.0+cpu",
      torchaudio: "2.11.0+cpu",
      torchvision: "0.26.0+cpu",
    },
  },
  install: {
    tool: "uv",
    exact: true,
    buildAllowed: false,
    runtimeNetworkRequired: false,
  },
  modelAssets: { bundled: false, storageAuthority: "data-root" },
});

const COMFYUI_PACKAGED_SERVICE = Object.freeze({
  id: PINNED_COMFYUI_RUNTIME.service,
  package: PINNED_COMFYUI_RUNTIME.package,
  packageVersion: PINNED_COMFYUI_RUNTIME.packageVersion,
  serviceDirectory: "comfyui",
  packagedSourceDirectory: "comfyui",
  runtimeDirectory: PINNED_COMFYUI_RUNTIME.runtimeDirectory,
  pythonVersion: PINNED_COMFYUI_RUNTIME.python.version,
  pythonArchiveUrl: PINNED_COMFYUI_RUNTIME.python.archiveUrl,
  pythonArchiveSha256: PINNED_COMFYUI_RUNTIME.python.archiveSha256,
  pythonExecutableSha256: PINNED_COMFYUI_RUNTIME.python.runtimeExecutableSha256,
  pythonRuntimeSha256: PINNED_COMFYUI_RUNTIME.python.baseClosureSha256,
  pythonRuntimeFileCount: PINNED_COMFYUI_RUNTIME.python.baseClosureFileCount,
  pythonLicenseSha256: PINNED_COMFYUI_RUNTIME.python.licenseSha256,
  upstreamCommit: PINNED_COMFYUI_RUNTIME.source.upstreamCommit,
  pyprojectSha256: PINNED_COMFYUI_RUNTIME.source.pyprojectSha256,
  requirementsSha256: PINNED_COMFYUI_RUNTIME.source.requirementsSha256,
  constraintsSha256: PINNED_COMFYUI_RUNTIME.dependencyLock.constraintsSha256,
  lockSha256: PINNED_COMFYUI_RUNTIME.dependencyLock.lockSha256,
  packageCount: PINNED_COMFYUI_RUNTIME.dependencyLock.packageCount,
  wheelCount: PINNED_COMFYUI_RUNTIME.dependencyLock.wheelCount,
  approvedHosts: PINNED_COMFYUI_RUNTIME.dependencyLock.approvedHosts,
  corePackages: PINNED_COMFYUI_RUNTIME.dependencyLock.corePackages,
  runtimeReceipt: PINNED_COMFYUI_RUNTIME,
  importPathReceipt: "breadboard-comfyui.pth",
  lockSource: "desktop/runtime-v2/vendor/comfyui/pylock.packaged.toml",
  smokeImports:
    "sys.argv=['comfyui-smoke','--cpu']; import comfy.options; " +
    "comfy.options.enable_args_parsing(); import server; assert hasattr(server, 'PromptServer')",
});

const CHATMOCK_PINNED_DEPS = [
  "blinker==1.9.0",
  "certifi==2025.8.3",
  "flask==3.1.1",
  "flask-sock==0.7.0",
  "idna==3.10",
  "itsdangerous==2.2.0",
  "jinja2==3.1.6",
  // ChatMock pins 3.0.2, which ships no cp314 wheel; 3.0.x is API-compatible
  // (jinja2 requires >=2.0) and matches what the dev environment resolves.
  "markupsafe>=3.0.2,<3.1",
  "requests==2.32.5",
  "urllib3==2.5.0",
  "websockets==15.0.1",
  "werkzeug==3.1.3",
];

function ensureHermesImportPath(target) {
  ensureHermesSourceHook(target);
}

function log(message) {
  console.log(`[prepare-runtimes] ${message}`);
}

function fail(message) {
  console.error(`[prepare-runtimes] ERROR: ${message}`);
  process.exit(1);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

function canonicalFileSha256(filePath) {
  const source = fs.readFileSync(filePath);
  const canonical = source.includes(0)
    ? source
    : Buffer.from(source.toString("utf8").replace(/\r\n/gu, "\n"), "utf8");
  return createHash("sha256").update(canonical).digest("hex").toUpperCase();
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
      if (metadata.isSymbolicLink()) fail(`Python runtime closure contains a symlink: ${fullPath}`);
      if (metadata.isDirectory()) {
        await visit(fullPath);
      } else if (metadata.isFile()) {
        const source = fs.readFileSync(fullPath);
        const canonical = source.includes(0)
          ? source
          : Buffer.from(source.toString("utf8").replace(/\r\n/gu, "\n"), "utf8");
        const identity = createHash("sha256").update(canonical).digest("hex").toUpperCase();
        records.push(`${relativePath}\0${canonical.length}\0${identity}\n`);
      } else {
        fail(`Python runtime closure contains a non-file entry: ${fullPath}`);
      }
    }
  }
  await visit(root);
  return {
    sha256: createHash("sha256").update(records.join("")).digest("hex").toUpperCase(),
    fileCount: records.length,
  };
}

function normalizeDistributionName(value) {
  return String(value).trim().toLowerCase().replace(/[-_.]+/gu, "-");
}

function parsePylockPackages(lockPath) {
  const source = fs.readFileSync(lockPath, "utf8").replace(/\r\n/gu, "\n");
  const packages = new Map();
  for (const match of source.matchAll(/\[\[packages\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/gu)) {
    packages.set(normalizeDistributionName(match[1]), match[2]);
  }
  return packages;
}

function packagedServiceReceipt(service) {
  return {
    schemaVersion: 1,
    service: service.id,
    package: service.package,
    packageVersion: service.packageVersion,
    platform: "win32",
    architecture: "x64",
    python: {
      version: service.pythonVersion,
      archiveUrl: service.pythonArchiveUrl,
      ...(service.pythonArchiveSize ? { archiveSize: service.pythonArchiveSize } : {}),
      archiveSha256: service.pythonArchiveSha256,
      runtimeExecutableSha256: service.pythonExecutableSha256,
      baseClosureSha256: service.pythonRuntimeSha256,
      baseClosureFileCount: service.pythonRuntimeFileCount,
      licenseSha256: service.pythonLicenseSha256,
    },
    uv: {
      version: PACKAGED_SERVICE_UV_VERSION,
      executableSha256: PACKAGED_SERVICE_UV_EXE_SHA256,
    },
    source: {
      moduleDirectory: service.moduleDirectory,
      gitTree: service.sourceGitTree,
      sha256: service.sourceSha256,
      fileCount: service.sourceFileCount,
      pyprojectSha256: service.pyprojectSha256,
      ...(service.upstreamCommit ? { upstreamCommit: service.upstreamCommit } : {}),
      ...(service.sourceArchive ? { archive: service.sourceArchive } : {}),
      ...(service.requirementsSha256
        ? { requirementsSha256: service.requirementsSha256 }
        : {}),
      ...(service.sourceLockSha256
        ? {
            sourceLock: {
              format: service.sourceLockFile,
              sha256: service.sourceLockSha256,
            },
          }
        : {}),
      lockSha256: service.lockSha256,
      ...(service.noticesSha256 ? { noticesSha256: service.noticesSha256 } : {}),
    },
    dependencyLock: {
      format: "pylock.toml",
      ...(service.lockFormat === "uv-project-export"
        ? {
            generatedFrom: service.sourceLockFile,
            exportArguments: [
              "export",
              "--frozen",
              "--no-dev",
              "--no-emit-project",
              "--offline",
              "--no-header",
              "--no-annotate",
              "--format",
              "pylock.toml",
            ],
            buildAllowed: false,
          }
        : {}),
      packageCount: service.packageCount,
      installedPackageCount: service.packageCount - (service.platformExcludedPackages?.length ?? 0),
      platformExcludedPackages: service.platformExcludedPackages ?? [],
      hashesRequired: true,
      corePackages: service.corePackages,
    },
    ...(service.externalBoundary
      ? { externalBoundary: service.externalBoundary }
      : {
          modelAssets: {
            bundled: false,
            storageAuthority: "data-root",
          },
        }),
  };
}

function which(binary) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [binary], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const first = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
  return first ? first.trim() : null;
}

async function requirePackagedServiceUv() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    fail("Packaged Python service runtimes currently target Windows x64 only.");
  }
  const uv = which("uv.exe") ?? which("uv");
  if (!uv) fail(`uv ${PACKAGED_SERVICE_UV_VERSION} is required for packaged Python services.`);
  const version = spawnSync(uv, ["--version"], { encoding: "utf8", shell: false });
  if (version.status !== 0 || !version.stdout.startsWith(`uv ${PACKAGED_SERVICE_UV_VERSION} `)) {
    fail(`Packaged Python services require uv ${PACKAGED_SERVICE_UV_VERSION} exactly.`);
  }
  if (await sha256File(uv) !== PACKAGED_SERVICE_UV_EXE_SHA256) {
    fail(`uv ${PACKAGED_SERVICE_UV_VERSION} executable identity is not the reviewed Windows x64 artifact.`);
  }
  return uv;
}

function download(url, destination, { expectedSize = null, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 5) {
          reject(new Error(`Too many redirects downloading ${url}`));
          return;
        }
        download(response.headers.location, destination, { expectedSize, redirects: redirects + 1 }).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const declaredSize = Number(response.headers["content-length"]);
      if (expectedSize !== null && Number.isSafeInteger(declaredSize) && declaredSize !== expectedSize) {
        response.resume();
        reject(new Error(`HTTP response for ${url} declared ${declaredSize} bytes; expected ${expectedSize}.`));
        return;
      }
      const file = fs.createWriteStream(destination, { flags: "w", mode: 0o600 });
      let size = 0;
      let settled = false;
      const abort = (error) => {
        if (settled) return;
        settled = true;
        response.destroy();
        request.destroy();
        file.destroy();
        fs.rmSync(destination, { force: true });
        reject(error);
      };
      response.on("data", (chunk) => {
        size += chunk.length;
        if (expectedSize !== null && size > expectedSize) {
          abort(new Error(`HTTP response for ${url} exceeds ${expectedSize} bytes.`));
        }
      });
      response.on("error", abort);
      response.pipe(file);
      file.on("error", abort);
      file.on("finish", () => {
        if (settled) return;
        if (expectedSize !== null && size !== expectedSize) {
          abort(new Error(`HTTP response for ${url} contained ${size} bytes; expected ${expectedSize}.`));
          return;
        }
        settled = true;
        file.close(() => resolve());
      });
    });
    request.on("error", (error) => {
      fs.rmSync(destination, { force: true });
      reject(error);
    });
  });
}

async function prepareNode() {
  const target = path.join(runtimesDir, "node");
  fs.mkdirSync(target, { recursive: true });
  const nodeExe = process.execPath;
  fs.copyFileSync(nodeExe, path.join(target, path.basename(nodeExe)));
  log(`node ${process.version} copied from ${nodeExe}`);
  return { runtime: "node", version: process.version, source: nodeExe };
}

async function prepareBun() {
  const bunPath = which(process.platform === "win32" ? "bun.exe" : "bun") ?? which("bun");
  if (!bunPath) fail("Bun is not installed; install it from https://bun.sh.");
  const version = execFileSync(bunPath, ["--version"], { encoding: "utf8" }).trim();
  const target = path.join(runtimesDir, "bun");
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(bunPath, path.join(target, process.platform === "win32" ? "bun.exe" : "bun"));
  log(`bun ${version} copied from ${bunPath}`);
  return { runtime: "bun", version, source: bunPath };
}

function requireHermesPin() {
  if (!fs.existsSync(path.join(hermesRoot, "pyproject.toml"))) {
    fail(`Hermes checkout is missing: ${hermesRoot}`);
  }
  const actual = execFileSync("git", ["-C", hermesRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (actual !== HERMES_UPSTREAM_COMMIT) {
    fail(
      `Hermes checkout is ${actual}; packaging is pinned to ${HERMES_UPSTREAM_COMMIT}.`,
    );
  }
  const status = execFileSync(
    "git",
    ["-C", hermesRoot, "status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8" },
  ).trim();
  if (status !== "") {
    fail("Hermes checkout must be fully clean before its locked runtime is assembled.");
  }
  return actual;
}

function serviceArtifactEnvironmentName(service, suffix) {
  return `BREADBOARD_${service.id.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}_${suffix}`;
}

function requireIfixAiPin() {
  if (!fs.existsSync(path.join(ifixAiRoot, "pyproject.toml"))) {
    fail(`iFixAi checkout is missing: ${ifixAiRoot}`);
  }
  const actual = execFileSync("git", ["-C", ifixAiRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (actual !== IFIXAI_UPSTREAM_COMMIT) {
    fail(`iFixAi checkout is ${actual}; packaging is pinned to ${IFIXAI_UPSTREAM_COMMIT}.`);
  }
  return actual;
}

function requirePackagedServiceSources(
  service,
  { serviceRoot = path.join(repoRoot, service.serviceDirectory), archiveSource = false, cleanupRoot = null } = {},
) {
  const moduleRoot = path.join(serviceRoot, service.moduleDirectory);
  const sourceLockFile = service.sourceLockFile ?? "pylock.packaged.toml";
  const checkoutPaths = [
    service.moduleDirectory,
    "pyproject.toml",
    ...(service.requirementsSha256 ? ["requirements.txt"] : []),
    sourceLockFile,
    ...(service.noticesSha256 ? ["THIRD_PARTY_NOTICES.md"] : []),
  ];
  for (const relativePath of checkoutPaths) {
    if (!fs.existsSync(path.join(serviceRoot, ...relativePath.split("/")))) {
      fail(`${service.id} packaged source closure is missing ${service.serviceDirectory}/${relativePath}.`);
    }
  }
  if (!archiveSource) {
    const status = service.independentCheckout
      ? spawnSync("git", ["-C", serviceRoot, "status", "--porcelain=v1", "--untracked-files=all"], {
          encoding: "utf8",
          shell: false,
        })
      : spawnSync(
          "git",
          [
            "-C",
            repoRoot,
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--",
            ...checkoutPaths.map((relativePath) => `${service.serviceDirectory}/${relativePath}`),
          ],
          { encoding: "utf8", shell: false },
        );
    if (status.status !== 0 || status.stdout.trim()) {
      fail(`${service.id} packaged source and lock closure must be tracked and clean.`);
    }
    if (service.upstreamCommit) {
      const commit = spawnSync("git", ["-C", serviceRoot, "rev-parse", "HEAD"], {
        encoding: "utf8",
        shell: false,
      });
      if (commit.status !== 0 || commit.stdout.trim() !== service.upstreamCommit) {
        fail(`${service.id} checkout is not pinned to ${service.upstreamCommit}.`);
      }
    }
    const revision = spawnSync(
      "git",
      [
        "-C",
        service.independentCheckout ? serviceRoot : repoRoot,
        "rev-parse",
        service.independentCheckout
          ? `HEAD:${service.moduleDirectory}`
          : `HEAD:${service.serviceDirectory}/${service.moduleDirectory}`,
      ],
      { encoding: "utf8", shell: false },
    );
    if (revision.status !== 0 || revision.stdout.trim() !== service.sourceGitTree) {
      fail(`${service.id} source module tree is not pinned to ${service.sourceGitTree}.`);
    }
  }
  for (const [fileName, expectedHash] of [
    ["pyproject.toml", service.pyprojectSha256],
    ...(service.requirementsSha256 ? [["requirements.txt", service.requirementsSha256]] : []),
    [sourceLockFile, service.sourceLockSha256 ?? service.lockSha256],
    ...(service.noticesSha256 ? [["THIRD_PARTY_NOTICES.md", service.noticesSha256]] : []),
  ]) {
    const actualHash = canonicalFileSha256(path.join(serviceRoot, fileName));
    if (actualHash !== expectedHash) {
      fail(`${service.id} ${fileName} is not the reviewed immutable file (${actualHash}).`);
    }
  }
  const lockPath = path.join(serviceRoot, sourceLockFile);
  let lockedPackages = null;
  if (service.lockFormat !== "uv-project-export") {
    lockedPackages = parsePylockPackages(lockPath);
    if (lockedPackages.size !== service.packageCount) {
      fail(`${service.id} packaged lock must contain ${service.packageCount} packages; found ${lockedPackages.size}.`);
    }
    for (const [packageName, expectedVersion] of Object.entries(service.corePackages)) {
      if (lockedPackages.get(normalizeDistributionName(packageName)) !== expectedVersion) {
        fail(`${service.id} packaged lock does not pin ${packageName}==${expectedVersion}.`);
      }
    }
  }
  return { serviceRoot, lockPath, lockedPackages, cleanupRoot };
}

async function resolvePackagedServiceSources(service) {
  const checkoutRoot = path.join(repoRoot, service.serviceDirectory);
  if (fs.existsSync(checkoutRoot) || !service.sourceArchive) {
    return requirePackagedServiceSources(service);
  }
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `breadboard-${service.id}-source-`));
  const suppliedArchive = process.env[serviceArtifactEnvironmentName(service, "SOURCE_ARCHIVE")];
  if (prepareOptions.offline && !suppliedArchive) {
    fail(
      `${service.id} offline assembly requires ${serviceArtifactEnvironmentName(service, "SOURCE_ARCHIVE")} when its clean checkout is absent.`,
    );
  }
  const archivePath = suppliedArchive
    ? path.resolve(suppliedArchive)
    : path.join(temporaryRoot, service.sourceArchive.name);
  const extractedRoot = path.join(temporaryRoot, "extracted");
  fs.mkdirSync(extractedRoot, { recursive: true });
  if (!suppliedArchive) {
    log(`downloading ${service.id} exact source archive`);
    await download(service.sourceArchive.url, archivePath, {
      expectedSize: service.sourceArchive.size,
    });
  }
  const metadata = fs.lstatSync(archivePath, { throwIfNoEntry: false });
  const archiveHash = metadata?.isFile() ? await sha256File(archivePath) : "";
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== service.sourceArchive.size ||
    archiveHash !== service.sourceArchive.sha256
  ) {
    fail(`${service.id} source archive is not the reviewed immutable artifact.`);
  }
  const extraction = spawnSync(
    process.platform === "win32" ? "tar.exe" : "tar",
    ["-xf", archivePath, "-C", extractedRoot],
    { encoding: "utf8", shell: false, windowsHide: true },
  );
  if (extraction.status !== 0) {
    fail(`${service.id} source archive extraction failed: ${extraction.stderr.trim()}.`);
  }
  const serviceRoot = path.join(extractedRoot, service.sourceArchive.rootDirectory);
  const moduleIdentity = await sha256Tree(path.join(serviceRoot, service.moduleDirectory));
  if (
    moduleIdentity.fileCount !== service.sourceFileCount ||
    moduleIdentity.sha256 !== service.sourceSha256
  ) {
    fail(
      `${service.id} archive source tree is not reviewed (${moduleIdentity.fileCount} files, SHA-256 ${moduleIdentity.sha256}).`,
    );
  }
  return requirePackagedServiceSources(service, {
    serviceRoot,
    archiveSource: true,
    cleanupRoot: temporaryRoot,
  });
}

function exportUvProjectLock(uv, service, closure) {
  const exportArguments = [
    "export",
    "--frozen",
    "--no-dev",
    "--no-emit-project",
    "--offline",
    "--no-header",
    "--no-annotate",
    "--format",
    "pylock.toml",
  ];
  const uvEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("UV_")),
  );
  uvEnvironment.UV_NO_PROGRESS = "1";
  const exported = spawnSync(uv, exportArguments, {
    cwd: closure.serviceRoot,
    env: uvEnvironment,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (exported.status !== 0) {
    fail(`${service.id} locked production export failed: ${(exported.stderr || exported.stdout).trim()}.`);
  }
  const canonical = exported.stdout.replace(/\r\n/gu, "\n");
  if (!canonical.startsWith('lock-version = "1.0"\ncreated-by = "uv"\nrequires-python = ">=3.13"\n')) {
    fail(`${service.id} generated pylock has an unexpected header.`);
  }
  const identity = createHash("sha256").update(canonical, "utf8").digest("hex").toUpperCase();
  if (identity !== service.lockSha256) {
    fail(`${service.id} generated pylock is not the reviewed immutable export (${identity}).`);
  }
  for (const match of canonical.matchAll(/url = "([^"]+)"/gu)) {
    let artifact;
    try {
      artifact = new URL(match[1]);
    } catch {
      fail(`${service.id} generated pylock contains an invalid artifact URL.`);
    }
    if (artifact.protocol !== "https:" || artifact.hostname !== "files.pythonhosted.org") {
      fail(`${service.id} generated pylock contains an unapproved artifact origin.`);
    }
  }
  // PEP 751 only accepts pylock.toml or pylock.<name>.toml basenames. Keep the
  // descriptive uniqueness in the parent directory, not ahead of `pylock`.
  const lockRoot = closure.cleanupRoot ?? fs.mkdtempSync(
    path.join(os.tmpdir(), `breadboard-${service.id}-lock-`),
  );
  if (!closure.cleanupRoot) activeRuntimeStages.add(lockRoot);
  const lockPath = path.join(lockRoot, "pylock.packaged.toml");
  fs.writeFileSync(lockPath, canonical, { encoding: "utf8", mode: 0o600 });
  const lockedPackages = parsePylockPackages(lockPath);
  if (lockedPackages.size !== service.packageCount) {
    fail(`${service.id} generated pylock must contain ${service.packageCount} packages; found ${lockedPackages.size}.`);
  }
  for (const [packageName, expectedVersion] of Object.entries(service.corePackages)) {
    if (lockedPackages.get(normalizeDistributionName(packageName)) !== expectedVersion) {
      fail(`${service.id} generated pylock does not pin ${packageName}==${expectedVersion}.`);
    }
  }
  return { ...closure, lockPath, lockedPackages, cleanupRoot: lockRoot };
}

function requireComfyUiRuntimeSources(service) {
  const serviceRoot = path.join(repoRoot, "comfyui");
  const vendorRoot = path.join(desktopRoot, "runtime-v2", "vendor", "comfyui");
  const constraintsPath = path.join(vendorRoot, "constraints.packaged.txt");
  const lockPath = path.join(vendorRoot, "pylock.packaged.toml");
  for (const requiredPath of [
    path.join(serviceRoot, "main.py"),
    path.join(serviceRoot, "server.py"),
    path.join(serviceRoot, "pyproject.toml"),
    path.join(serviceRoot, "requirements.txt"),
    constraintsPath,
    lockPath,
  ]) {
    if (!fs.existsSync(requiredPath)) fail(`ComfyUI packaged closure is missing ${requiredPath}.`);
  }

  const revision = spawnSync("git", ["-C", serviceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  if (revision.status !== 0 || revision.stdout.trim() !== service.upstreamCommit) {
    fail(`ComfyUI checkout must be pinned to ${service.upstreamCommit}.`);
  }
  const sourceStatus = spawnSync(
    "git",
    ["-C", serviceRoot, "status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8", shell: false },
  );
  if (sourceStatus.status !== 0 || sourceStatus.stdout.trim()) {
    fail("ComfyUI's pinned upstream checkout must be fully clean.");
  }
  const vendorStatus = spawnSync(
    "git",
    [
      "-C",
      repoRoot,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      "desktop/runtime-v2/vendor/comfyui/constraints.packaged.txt",
      "desktop/runtime-v2/vendor/comfyui/pylock.packaged.toml",
    ],
    { encoding: "utf8", shell: false },
  );
  if (vendorStatus.status !== 0 || vendorStatus.stdout.trim()) {
    fail("ComfyUI's Breadboard-owned constraints and lock must be tracked and clean.");
  }
  for (const [filePath, expectedHash, label] of [
    [path.join(serviceRoot, "pyproject.toml"), service.pyprojectSha256, "pyproject.toml"],
    [path.join(serviceRoot, "requirements.txt"), service.requirementsSha256, "requirements.txt"],
    [constraintsPath, service.constraintsSha256, "packaged constraints"],
    [lockPath, service.lockSha256, "packaged lock"],
  ]) {
    const actualHash = canonicalFileSha256(filePath);
    if (actualHash !== expectedHash) {
      fail(`ComfyUI ${label} is not the reviewed immutable file (${actualHash}).`);
    }
  }

  const lockSource = fs.readFileSync(lockPath, "utf8").replace(/\r\n/gu, "\n");
  if (!lockSource.startsWith('lock-version = "1.0"\ncreated-by = "uv"\nrequires-python = ">=3.12.10"\n')) {
    fail("ComfyUI packaged lock has an unexpected pylock header.");
  }
  if (/(?:^|\n)sdist = /u.test(lockSource)) {
    fail("ComfyUI packaged lock must not admit source distributions.");
  }
  const packageBlocks = lockSource.split(/(?=^\[\[packages\]\]$)/gmu).filter((block) =>
    block.startsWith("[[packages]]"),
  );
  const lockedPackages = parsePylockPackages(lockPath);
  if (
    packageBlocks.length !== service.packageCount ||
    lockedPackages.size !== service.packageCount
  ) {
    fail(
      `ComfyUI packaged lock must contain ${service.packageCount} unique packages; found ${packageBlocks.length}/${lockedPackages.size}.`,
    );
  }
  let wheelCount = 0;
  for (const block of packageBlocks) {
    const name = block.match(/^name = "([^"]+)"$/mu)?.[1] ?? "unknown";
    const urls = [...block.matchAll(/url = "([^"]+)"/gu)].map((match) => match[1]);
    const hashes = [...block.matchAll(/sha256 = "([0-9a-f]+)"/gu)].map((match) => match[1]);
    if (urls.length === 0 || urls.length !== hashes.length) {
      fail(`ComfyUI lock package ${name} does not have one SHA-256 per wheel.`);
    }
    for (const [index, url] of urls.entries()) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        fail(`ComfyUI lock package ${name} has an invalid wheel URL.`);
      }
      if (
        parsed.protocol !== "https:" ||
        !service.approvedHosts.includes(parsed.hostname) ||
        !parsed.pathname.toLowerCase().endsWith(".whl") ||
        !/^[0-9a-f]{64}$/u.test(hashes[index])
      ) {
        fail(`ComfyUI lock package ${name} has an unreviewed wheel artifact.`);
      }
    }
    wheelCount += urls.length;
  }
  if (wheelCount !== service.wheelCount) {
    fail(`ComfyUI packaged lock must contain ${service.wheelCount} reviewed wheels; found ${wheelCount}.`);
  }
  for (const [packageName, expectedVersion] of Object.entries(service.corePackages)) {
    if (lockedPackages.get(normalizeDistributionName(packageName)) !== expectedVersion) {
      fail(`ComfyUI packaged lock does not pin ${packageName}==${expectedVersion}.`);
    }
  }
  return { serviceRoot, lockPath, lockedPackages };
}

async function acquirePackagedServicePythonArchive(service) {
  const zipName = `python-${service.pythonVersion}-embed-amd64.zip`;
  const suppliedPythonArchive = process.env[
    serviceArtifactEnvironmentName(service, "PYTHON_ARCHIVE")
  ];
  const zipPath = suppliedPythonArchive
    ? path.resolve(suppliedPythonArchive)
    : path.join(os.tmpdir(), zipName);
  const zipMetadata = fs.lstatSync(zipPath, { throwIfNoEntry: false });
  const zipIsReviewed =
    zipMetadata?.isFile() &&
    !zipMetadata.isSymbolicLink() &&
    (service.pythonArchiveSize === undefined || zipMetadata.size === service.pythonArchiveSize) &&
    (await sha256File(zipPath)) === service.pythonArchiveSha256;
  if (!zipIsReviewed) {
    if (suppliedPythonArchive) {
      fail(`${service.id} supplied CPython archive is not the reviewed immutable file.`);
    }
    if (prepareOptions.offline) {
      fail(
        `${service.id} offline assembly requires the reviewed ${zipPath} or ${serviceArtifactEnvironmentName(service, "PYTHON_ARCHIVE")}.`,
      );
    }
    fs.rmSync(zipPath, { force: true });
    log(`downloading ${service.id} exact CPython ${service.pythonVersion} archive`);
    await download(service.pythonArchiveUrl, zipPath, {
      expectedSize: service.pythonArchiveSize ?? null,
    });
  }
  const archiveHash = await sha256File(zipPath);
  if (archiveHash !== service.pythonArchiveSha256) {
    fail(`${service.id} CPython archive identity mismatch: ${archiveHash}.`);
  }
  return zipPath;
}

async function prefetchPackagedServiceRuntime(uv, service) {
  let closure = await resolvePackagedServiceSources(service);
  if (service.lockFormat === "uv-project-export") {
    closure = exportUvProjectLock(uv, service, closure);
  }
  await acquirePackagedServicePythonArchive(service);
  const prefetchTarget = fs.mkdtempSync(
    path.join(os.tmpdir(), `breadboard-${service.id}-wheel-prefetch-`),
  );
  const uvEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("UV_")),
  );
  uvEnvironment.UV_COMPILE_BYTECODE = "false";
  uvEnvironment.UV_NO_PROGRESS = "1";
  let prefetchStatus = null;
  try {
    log(`prefetching ${service.id}'s hashed Windows wheel closure`);
    const prefetch = spawnSync(
      uv,
      [
        "pip",
        "install",
        "--preview-features",
        "pylock",
        "--requirements",
        closure.lockPath,
        "--target",
        prefetchTarget,
        "--python-version",
        service.pythonVersion,
        "--python-platform",
        "windows",
        "--exact",
        "--require-hashes",
        "--no-build",
        "--no-config",
        "--no-python-downloads",
        "--no-sources",
        "--strict",
        "--link-mode",
        "copy",
      ],
      { cwd: repoRoot, env: uvEnvironment, encoding: "utf8", stdio: "inherit", shell: false },
    );
    prefetchStatus = prefetch.status;
  } finally {
    fs.rmSync(prefetchTarget, { recursive: true, force: true });
    if (closure.cleanupRoot) {
      fs.rmSync(closure.cleanupRoot, { recursive: true, force: true });
      activeRuntimeStages.delete(closure.cleanupRoot);
    }
  }
  if (prefetchStatus !== 0) fail(`${service.id} hashed wheel prefetch failed.`);
  log(`${service.id} exact inputs are cached for --offline assembly`);
}

async function preparePackagedServiceRuntime(
  uv,
  service,
  closure = null,
) {
  closure ??= await resolvePackagedServiceSources(service);
  if (service.lockFormat === "uv-project-export") {
    closure = exportUvProjectLock(uv, service, closure);
  }
  const { serviceRoot, lockPath, lockedPackages } = closure;
  const finalTarget = path.join(runtimesDir, service.runtimeDirectory);
  fs.mkdirSync(path.dirname(finalTarget), { recursive: true });
  const target = fs.mkdtempSync(
    path.join(path.dirname(finalTarget), `.${service.runtimeDirectory}-stage-`),
  );
  activeRuntimeStages.add(target);
  // Do not let a builder's uv configuration or UV_* environment override the
  // reviewed lock/install policy. Non-UV process settings remain available to
  // the wheel downloader (for example its proxy/certificate configuration).
  const uvEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("UV_")),
  );
  uvEnvironment.UV_COMPILE_BYTECODE = "false";
  uvEnvironment.UV_NO_PROGRESS = "1";
  const zipPath = await acquirePackagedServicePythonArchive(service);
  const unzip = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${target}" -Force`,
    ],
    { encoding: "utf8", shell: false },
  );
  if (unzip.status !== 0) {
    fail(`${service.id} CPython archive extraction failed: ${unzip.stderr.trim()}.`);
  }

  const pthFile = fs.readdirSync(target).find((name) => /^python\d+\._pth$/u.test(name));
  if (!pthFile) fail(`${service.id} embedded CPython has no python*._pth file.`);
  const pthPath = path.join(target, pthFile);
  const pth = fs.readFileSync(pthPath, "utf8");
  fs.writeFileSync(
    pthPath,
    `${pth.replace(/^#\s*import site\s*$/mu, "import site")}\nLib\\site-packages\n`,
    "utf8",
  );
  fs.mkdirSync(path.join(target, "Lib", "site-packages"), { recursive: true });
  fs.mkdirSync(path.join(target, "Scripts"), { recursive: true });
  const baseIdentity = await sha256Tree(target);
  if (
    baseIdentity.sha256 !== service.pythonRuntimeSha256 ||
    baseIdentity.fileCount !== service.pythonRuntimeFileCount
  ) {
    fail(
      `${service.id} CPython base closure is not pinned (${baseIdentity.fileCount} files, ${baseIdentity.sha256}).`,
    );
  }
  if (canonicalFileSha256(path.join(target, "LICENSE.txt")) !== service.pythonLicenseSha256) {
    fail(`${service.id} CPython license is not the reviewed file.`);
  }

  const python = path.join(target, "python.exe");
  if (!fs.existsSync(python) || await sha256File(python) !== service.pythonExecutableSha256) {
    fail(`${service.id} self-contained Python executable identity is not pinned.`);
  }
  const pythonVersion = spawnSync(
    python,
    ["-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"],
    { encoding: "utf8", shell: false, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
  if (pythonVersion.status !== 0 || pythonVersion.stdout.trim() !== service.pythonVersion) {
    fail(`${service.id} self-contained runtime is not running CPython ${service.pythonVersion}.`);
  }
  if (service.lockFormat === "uv-project-export") {
    fs.copyFileSync(lockPath, path.join(target, "pylock.packaged.toml"));
  }

  log(`installing ${service.id}'s hashed ${service.packageCount}-package closure`);
  const install = spawnSync(
    uv,
    [
      "pip",
      "install",
      "--preview-features",
      "pylock",
      "--python",
      python,
      "--requirements",
      lockPath,
      "--exact",
      "--require-hashes",
      "--no-build",
      "--no-config",
      "--no-python-downloads",
      "--no-sources",
      ...(prepareOptions.offline ? ["--offline"] : []),
      "--strict",
      "--link-mode",
      "copy",
    ],
    { cwd: repoRoot, env: uvEnvironment, encoding: "utf8", stdio: "inherit", shell: false },
  );
  if (install.status !== 0) fail(`${service.id} hashed dependency install failed.`);
  const sitePackages = path.join(target, "Lib", "site-packages");
  const packagedSourceRoot = path.join(
    desktopRoot,
    "build-resources",
    "app-services",
    service.packagedSourceDirectory ?? service.serviceDirectory,
    ...(service.packagedImportSubdirectory
      ? service.packagedImportSubdirectory.split("/")
      : []),
  );
  const relativeSourceRoot = path
    .relative(sitePackages, packagedSourceRoot)
    .split(path.sep)
    .join("/");
  fs.writeFileSync(
    path.join(sitePackages, service.importPathReceipt ?? `breadboard-${service.id}.pth`),
    `${relativeSourceRoot}\n`,
    "utf8",
  );

  const inventory = spawnSync(
    python,
    [
      "-c",
      "import importlib.metadata as m,json,re;" +
        "n=lambda v:re.sub(r'[-_.]+','-',v).lower();" +
        "print(json.dumps(sorted((n(d.metadata['Name']),d.version) for d in m.distributions())))",
    ],
    {
      cwd: serviceRoot,
      encoding: "utf8",
      shell: false,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" },
    },
  );
  if (inventory.status !== 0) fail(`${service.id} installed dependency inventory could not be read.`);
  let installedPackages;
  try {
    installedPackages = new Map(JSON.parse(inventory.stdout));
  } catch {
    fail(`${service.id} installed dependency inventory was not valid JSON.`);
  }
  const excludedPackages = new Set(
    (service.platformExcludedPackages ?? []).map(normalizeDistributionName),
  );
  const expectedInstalledPackages = new Map(
    [...lockedPackages].filter(([packageName]) => !excludedPackages.has(packageName)),
  );
  if (installedPackages.size !== expectedInstalledPackages.size) {
    fail(
      `${service.id} runtime contains ${installedPackages.size} distributions; expected ${expectedInstalledPackages.size} for Windows x64.`,
    );
  }
  for (const [packageName, expectedVersion] of expectedInstalledPackages) {
    if (installedPackages.get(packageName) !== expectedVersion) {
      fail(`${service.id} runtime does not contain locked ${packageName}==${expectedVersion}.`);
    }
  }

  const smokeImportRoot = path.join(
    serviceRoot,
    ...(service.packagedImportSubdirectory
      ? service.packagedImportSubdirectory.split("/")
      : []),
  );
  const smokeScript = [
    `import sys;sys.path.insert(0,${JSON.stringify(smokeImportRoot)})`,
    service.smokeImports,
    service.hardExitAfterSmoke
      ? "import os;sys.stdout.flush();sys.stderr.flush();os._exit(0)"
      : "",
  ]
    .filter(Boolean)
    .join(";");
  const smoke = spawnSync(
    python,
    ["-c", smokeScript],
    {
      cwd: serviceRoot,
      encoding: "utf8",
      shell: false,
      env: {
        ...process.env,
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONNOUSERSITE: "1",
      },
    },
  );
  if (smoke.status !== 0) {
    const detail = (smoke.stderr || smoke.stdout).trim();
    const termination = smoke.error
      ? `${smoke.error.name}: ${smoke.error.message}`
      : smoke.signal
        ? `signal ${smoke.signal}`
        : `exit ${smoke.status}`;
    fail(
      `${service.id} packaged import smoke failed (${termination})` +
        `${detail ? `: ${detail}` : "."}`,
    );
  }
  fs.writeFileSync(
    path.join(target, "runtime-artifact.json"),
    `${JSON.stringify(service.runtimeReceipt ?? packagedServiceReceipt(service), null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
  commitAtomicDirectorySwap({
    stagedTarget: target,
    target: finalTarget,
    label: `${service.id} packaged runtime`,
  });
  activeRuntimeStages.delete(target);
  log(`${service.id} exact packaged runtime assembled`);
  if (closure.cleanupRoot) {
    fs.rmSync(closure.cleanupRoot, { recursive: true, force: true });
    activeRuntimeStages.delete(closure.cleanupRoot);
  }
  return {
    runtime: service.runtimeDirectory,
    version: service.pythonVersion,
    source: service.lockSource ?? `${service.serviceDirectory}/pylock.packaged.toml`,
  };
}

async function preparePython() {
  if (process.platform !== "win32") fail("Python runtime assembly currently targets Windows x64 only.");
  const uv = which("uv.exe") ?? which("uv");
  if (!uv) fail("uv is required to assemble Hermes's locked Python environment.");
  const hermesCommit = requireHermesPin();
  const ifixAiCommit = requireIfixAiPin();
  const fullVersion = PYTHON_VERSION;

  const target = path.join(runtimesDir, "python");
  const stampFile = path.join(target, ".breadboard-python-version");
  const expectedStamp = `${fullVersion}\nhermes=${hermesCommit}\nifixai=${ifixAiCommit}`;
  if (
    fs.existsSync(stampFile) &&
    fs.readFileSync(stampFile, "utf8").trim() === expectedStamp
  ) {
    const cachedPython = path.join(target, "python.exe");
    if (!fs.existsSync(cachedPython) || await sha256File(cachedPython) !== PYTHON_EXE_SHA256) {
      fail("Cached bundled Python executable identity does not match the pinned CPython artifact.");
    }
    ensureChatMockSourceHook(target);
    ensureHermesImportPath(target);
    log(`python ${fullVersion} runtime already assembled — skipping`);
    return { runtime: "python", version: fullVersion, source: "cached" };
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  const zipName = `python-${fullVersion}-embed-amd64.zip`;
  const url = `https://www.python.org/ftp/python/${fullVersion}/${zipName}`;
  const zipPath = path.join(os.tmpdir(), zipName);
  log(`downloading ${url}`);
  await download(url, zipPath);
  const archiveHash = await sha256File(zipPath);
  if (archiveHash !== PYTHON_EMBED_ZIP_SHA256) {
    fail(`Bundled Python archive identity mismatch: ${archiveHash}.`);
  }

  const unzip = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${target}" -Force`],
    { encoding: "utf8" },
  );
  if (unzip.status !== 0) fail(`Failed to extract ${zipPath}: ${unzip.stderr}`);
  const pythonExecutable = path.join(target, "python.exe");
  const executableHash = await sha256File(pythonExecutable);
  if (executableHash !== PYTHON_EXE_SHA256) {
    fail(`Bundled Python executable identity mismatch: ${executableHash}.`);
  }

  // Enable site-packages in the embeddable distribution.
  const pthFile = fs
    .readdirSync(target)
    .find((name) => /^python\d+\._pth$/.test(name));
  if (!pthFile) fail("Could not find python*._pth in the embeddable distribution");
  const pthPath = path.join(target, pthFile);
  const pth = fs.readFileSync(pthPath, "utf8");
  fs.writeFileSync(
    pthPath,
    pth.replace(/^#\s*import site\s*$/m, "import site") + "\nLib\\site-packages\n",
    "utf8",
  );

  const sitePackages = path.join(target, "Lib", "site-packages");
  fs.mkdirSync(sitePackages, { recursive: true });
  log("installing ChatMock dependencies into the bundled runtime");
  const chatmockInstall = spawnSync(
    uv,
    [
      "pip",
      "install",
      "--python",
      path.join(target, "python.exe"),
      ...CHATMOCK_PINNED_DEPS,
    ],
    { encoding: "utf8", stdio: "inherit" },
  );
  if (chatmockInstall.status !== 0) {
    fail("ChatMock dependency install for the bundled Python runtime failed");
  }

  const requirements = path.join(os.tmpdir(), `breadboard-hermes-${process.pid}.txt`);
  const exportResult = spawnSync(
    uv,
    [
      "export",
      "--project",
      hermesRoot,
      "--frozen",
      "--no-dev",
      "--no-emit-project",
      "--no-hashes",
      "--format",
      "requirements-txt",
      "--output-file",
      requirements,
    ],
    { encoding: "utf8", stdio: "inherit" },
  );
  if (exportResult.status !== 0) fail("Could not export Hermes's locked dependencies");
  log(`installing Hermes ${hermesCommit.slice(0, 12)} locked dependencies`);
  const hermesInstall = spawnSync(
    uv,
    [
      "pip",
      "install",
      "--python",
      path.join(target, "python.exe"),
      "--requirements",
      requirements,
    ],
    { encoding: "utf8", stdio: "inherit" },
  );
  fs.rmSync(requirements, { force: true });
  if (hermesInstall.status !== 0) {
    fail("Hermes dependency install for the bundled Python runtime failed");
  }

  log(`installing iFixAi ${ifixAiCommit.slice(0, 12)} and its dependencies`);
  const ifixAiInstall = spawnSync(
    uv,
    ["pip", "install", "--python", path.join(target, "python.exe"), ifixAiRoot],
    { encoding: "utf8", stdio: "inherit" },
  );
  if (ifixAiInstall.status !== 0) {
    fail("iFixAi install for the bundled Python runtime failed");
  }

  fs.writeFileSync(stampFile, expectedStamp, "utf8");
  fs.writeFileSync(
    path.join(target, "hermes-upstream-commit.txt"),
    `${hermesCommit}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(target, "ifixai-upstream-commit.txt"),
    `${ifixAiCommit}\n`,
    "utf8",
  );
  ensureChatMockSourceHook(target);
  ensureHermesImportPath(target);
  log(`python ${fullVersion} runtime assembled`);
  return { runtime: "python", version: fullVersion, source: url };
}

function parsePrepareOptions(arguments_) {
  const options = { offline: false, only: null, prefetch: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--offline") {
      options.offline = true;
      continue;
    }
    if (argument === "--prefetch") {
      options.prefetch = true;
      continue;
    }
    if (argument === "--only") {
      index += 1;
      if (!arguments_[index]) fail("--only requires a runtime target.");
      options.only = arguments_[index];
      continue;
    }
    if (argument.startsWith("--only=")) {
      options.only = argument.slice("--only=".length);
      continue;
    }
    fail(`Unknown runtime preparation argument: ${argument}`);
  }
  const validTargets = new Set([
    "node",
    "bun",
    "python",
    ...PACKAGED_PYTHON_SERVICES.map((service) => service.id),
    COMFYUI_PACKAGED_SERVICE.id,
  ]);
  if (options.only && !validTargets.has(options.only)) {
    fail(`Unknown runtime target ${options.only}. Expected one of: ${[...validTargets].join(", ")}.`);
  }
  if (options.prefetch && options.offline) {
    fail("--prefetch downloads the reviewed cache inputs and cannot be combined with --offline.");
  }
  if (options.offline && !options.only) {
    fail("--offline requires one explicit --only packaged service target.");
  }
  if (
    options.offline &&
    !PACKAGED_PYTHON_SERVICES.some((service) => service.id === options.only)
  ) {
    fail("--offline currently supports the reviewed packaged Python service targets only.");
  }
  if (options.prefetch && !options.only) {
    fail("--prefetch requires one explicit --only packaged service target.");
  }
  if (
    options.prefetch &&
    !PACKAGED_PYTHON_SERVICES.some((service) => service.id === options.only)
  ) {
    fail("--prefetch currently supports the reviewed packaged Python service targets only.");
  }
  return options;
}

prepareOptions = parsePrepareOptions(process.argv.slice(2));
const selected = (target) => prepareOptions.only === null || prepareOptions.only === target;
const selectedPackagedServices = PACKAGED_PYTHON_SERVICES.filter((service) => selected(service.id));
const selectedComfyUi = selected(COMFYUI_PACKAGED_SERVICE.id);
const needsPackagedServiceUv = selectedPackagedServices.length > 0 || selectedComfyUi;
const packagedServiceUv = needsPackagedServiceUv ? await requirePackagedServiceUv() : null;
if (prepareOptions.prefetch) {
  await prefetchPackagedServiceRuntime(packagedServiceUv, selectedPackagedServices[0]);
} else {
  const manifest = [];
  if (selected("node")) manifest.push(await prepareNode());
  if (selected("bun")) manifest.push(await prepareBun());
  if (selected("python")) manifest.push(await preparePython());
  for (const service of selectedPackagedServices) {
    manifest.push(await preparePackagedServiceRuntime(packagedServiceUv, service));
  }
  if (selectedComfyUi) {
    const comfyUiClosure = requireComfyUiRuntimeSources(COMFYUI_PACKAGED_SERVICE);
    manifest.push(
      await preparePackagedServiceRuntime(
        packagedServiceUv,
        COMFYUI_PACKAGED_SERVICE,
        comfyUiClosure,
      ),
    );
  }
  const manifestPath = path.join(runtimesDir, "runtimes-manifest.json");
  let combinedManifest = manifest;
  if (prepareOptions.only && fs.existsSync(manifestPath)) {
    let previous;
    try {
      previous = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
      fail(`Existing runtime manifest is invalid: ${error instanceof Error ? error.message : String(error)}.`);
    }
    if (!Array.isArray(previous.runtimes)) fail("Existing runtime manifest has no runtimes array.");
    const replacedRuntimeIds = new Set(manifest.map((entry) => entry.runtime));
    combinedManifest = [
      ...previous.runtimes.filter((entry) => !replacedRuntimeIds.has(entry.runtime)),
      ...manifest,
    ];
  }
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ assembledAt: new Date().toISOString(), runtimes: combinedManifest }, null, 2),
  );
}
log("done");
