import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { commitAtomicDirectorySwap } from "./atomic-artifact-swap.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const service = Object.freeze({
  id: "solidworks-mcp",
  package: "solidworks-mcp-python",
  packageVersion: "1.0.1",
  serviceDirectory: "SolidworksMCP-python",
  moduleDirectory: "src/solidworks_mcp",
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
  lockSha256: "2555A0542E322BB6DF3000AD850155AB4B0A16731AD16806981669C1265D75C9",
  additionalSourceFiles: {
    LICENSE: "5C6AACFC7660B78F60C6711768482F9BC01185EC76F9A958672D701B005FA073",
    "README.md": "F39080AAE6A6EAE9C73D6FAFDB187F065D08DD8127A576B5AA34BDC0DABB1179",
  },
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
  externalBoundary: ["locally licensed Windows SolidWorks installation and COM automation"],
});

function fail(message) {
  throw new Error(`[prepare-solidworks-source] ${message}`);
}

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
      if (metadata.isSymbolicLink()) fail(`source closure contains a symlink: ${fullPath}`);
      if (metadata.isDirectory()) {
        await visit(fullPath);
      } else if (metadata.isFile()) {
        const identity = canonicalFileIdentity(fullPath);
        records.push(`${relativePath}\0${identity.size}\0${identity.sha256}\n`);
      } else {
        fail(`source closure contains a non-file entry: ${fullPath}`);
      }
    }
  }
  await visit(root);
  return {
    fileCount: records.length,
    sha256: createHash("sha256").update(records.join("")).digest("hex").toUpperCase(),
  };
}

function git(sourceRoot, ...args) {
  const result = spawnSync("git", ["-C", sourceRoot, ...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) fail(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function receipt() {
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
      archiveSize: service.pythonArchiveSize,
      archiveSha256: service.pythonArchiveSha256,
      runtimeExecutableSha256: service.pythonExecutableSha256,
      baseClosureSha256: service.pythonRuntimeSha256,
      baseClosureFileCount: service.pythonRuntimeFileCount,
      licenseSha256: service.pythonLicenseSha256,
    },
    uv: {
      version: "0.12.5",
      executableSha256: "8DA6CEDEF60C27AC997EBF400FBFC6D373C5B0A7AE6A299B9D52BE7FE63723FB",
    },
    source: {
      moduleDirectory: service.moduleDirectory,
      gitTree: service.sourceGitTree,
      sha256: service.sourceSha256,
      fileCount: service.sourceFileCount,
      pyprojectSha256: service.pyprojectSha256,
      upstreamCommit: service.upstreamCommit,
      archive: service.sourceArchive,
      sourceLock: { format: service.sourceLockFile, sha256: service.sourceLockSha256 },
      lockSha256: service.lockSha256,
    },
    dependencyLock: {
      format: "pylock.toml",
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
      packageCount: service.packageCount,
      installedPackageCount: service.packageCount - service.platformExcludedPackages.length,
      platformExcludedPackages: service.platformExcludedPackages,
      hashesRequired: true,
      corePackages: service.corePackages,
    },
    externalBoundary: service.externalBoundary,
  };
}

const sourceRoot = path.join(repoRoot, service.serviceDirectory);
const sourceModule = path.join(sourceRoot, ...service.moduleDirectory.split("/"));
const runtimeRoot = path.join(
  desktopRoot,
  "build-resources",
  "runtimes",
  service.runtimeDirectory,
);
const exportedLock = path.join(runtimeRoot, "pylock.packaged.toml");
const targetRoot = path.join(
  desktopRoot,
  "build-resources",
  "app-services",
  service.serviceDirectory,
);

if (!fs.existsSync(sourceModule)) fail(`clean source checkout is missing: ${sourceRoot}`);
if (git(sourceRoot, "status", "--porcelain=v1", "--untracked-files=all") !== "") {
  fail("source checkout must be fully clean before staging.");
}
if (git(sourceRoot, "rev-parse", "HEAD") !== service.upstreamCommit) {
  fail(`source checkout is not pinned to ${service.upstreamCommit}.`);
}
if (git(sourceRoot, "rev-parse", `HEAD:${service.moduleDirectory}`) !== service.sourceGitTree) {
  fail(`source module Git tree is not pinned to ${service.sourceGitTree}.`);
}
for (const [relativePath, expectedHash] of [
  ["pyproject.toml", service.pyprojectSha256],
  [service.sourceLockFile, service.sourceLockSha256],
  ...Object.entries(service.additionalSourceFiles),
]) {
  const filePath = path.join(sourceRoot, relativePath);
  if (!fs.existsSync(filePath) || canonicalFileIdentity(filePath).sha256 !== expectedHash) {
    fail(`${relativePath} is not the reviewed immutable file.`);
  }
}
const sourceIdentity = await sha256Tree(sourceModule);
if (
  sourceIdentity.fileCount !== service.sourceFileCount ||
  sourceIdentity.sha256 !== service.sourceSha256
) {
  fail(
    `source module is not reviewed (${sourceIdentity.fileCount} files, SHA-256 ${sourceIdentity.sha256}).`,
  );
}
if (!fs.existsSync(exportedLock) || canonicalFileIdentity(exportedLock).sha256 !== service.lockSha256) {
  fail("reviewed exported pylock is missing; assemble the SolidWorks runtime first.");
}
const packages = new Map();
const lockSource = fs.readFileSync(exportedLock, "utf8").replace(/\r\n/gu, "\n");
for (const match of lockSource.matchAll(/\[\[packages\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/gu)) {
  packages.set(match[1].toLowerCase().replace(/[-_.]+/gu, "-"), match[2]);
}
if (packages.size !== service.packageCount) {
  fail(`exported pylock contains ${packages.size} packages; expected ${service.packageCount}.`);
}
for (const [name, version] of Object.entries(service.corePackages)) {
  if (packages.get(name.toLowerCase().replace(/[-_.]+/gu, "-")) !== version) {
    fail(`exported pylock does not pin ${name}==${version}.`);
  }
}

fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
const stagedRoot = fs.mkdtempSync(path.join(path.dirname(targetRoot), ".solidworks-source-stage-"));
try {
  fs.cpSync(sourceModule, path.join(stagedRoot, ...service.moduleDirectory.split("/")), {
    recursive: true,
    force: true,
    filter: (candidate) => {
      const relative = path.relative(sourceModule, candidate).split(path.sep).join("/");
      return !/(^|\/)(?:__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(relative) &&
        !/\.(?:pyc|pyo)$/u.test(relative);
    },
  });
  for (const relativePath of [
    "pyproject.toml",
    service.sourceLockFile,
    ...Object.keys(service.additionalSourceFiles),
  ]) {
    fs.copyFileSync(path.join(sourceRoot, relativePath), path.join(stagedRoot, relativePath));
  }
  fs.copyFileSync(exportedLock, path.join(stagedRoot, "pylock.packaged.toml"));
  const stagedIdentity = await sha256Tree(
    path.join(stagedRoot, ...service.moduleDirectory.split("/")),
  );
  if (
    stagedIdentity.fileCount !== service.sourceFileCount ||
    stagedIdentity.sha256 !== service.sourceSha256
  ) {
    fail("staged source module is not the reviewed immutable tree.");
  }
  fs.writeFileSync(
    path.join(stagedRoot, "BREADBOARD_UPSTREAM_COMMIT"),
    `${service.upstreamCommit}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(stagedRoot, "runtime-artifact.json"),
    `${JSON.stringify(receipt(), null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
  commitAtomicDirectorySwap({
    stagedTarget: stagedRoot,
    target: targetRoot,
    label: "SolidWorks packaged source",
  });
} finally {
  fs.rmSync(stagedRoot, { recursive: true, force: true });
}

console.log(`[prepare-solidworks-source] exact immutable source staged at ${targetRoot}`);
