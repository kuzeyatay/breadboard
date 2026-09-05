// Stages the read-only application resources bundled into the installer under
// build-resources/app-services/. Run AFTER the dashboard standalone build:
//
//   cd dashboard && BREADBOARD_DESKTOP_BUILD=1 BREADBOARD_NEXT_DIST_DIR=.next-desktop npx next build
//
// Layout produced (mirrors the repo for the services' repo-root assumptions):
//   app-services/
//     dashboard-standalone/dashboard/ <- .next-desktop/standalone (server.js tree)
//     dashboard/                  <- marker + Postiz supervisor module closure
//     scripts/                    <- desktop service launchers
//     postiz-app/                 <- optional Postiz Compose definition
//     nango/                      <- provider catalog metadata and logos only
//     chatmock/                   <- ChatMock source (no docker/tests/dev virtualenv)
//     hermes-config/              <- Breadboard system prompts (read-only)
//     hermes-skills/              <- reviewed first-party skills (read-only)
//     agency-agents/              <- bundled specialist persona catalog (read-only)
//     scientific-agent-skills/    <- pinned K-Dense scientific skills (read-only)
//     patent-disclosure-skill/     <- pinned patent guidance only (read-only)
//     auto-claude-code-research-in-sleep/ <- ARIS guide + research skills (read-only)
//     openGym/                 <- exercise catalogue + upstream notices (read-only)
//     quartz-template/            <- Quartz program files (no content/public)
//     ruflo/                       <- frozen Ruflo CLI + production dependencies
//     gbrain-adapter/              <- authenticated loopback retrieval adapter
//     gbrain/                      <- vendored retrieval engine + production deps
//     dashboard/node_modules/mem0ai/ <- frozen semantic-memory service closure
//     comfyui/                     <- source only; models/cache/user data excluded
//     wardrobe-runtime/            <- frozen Wardrobe source + Vite/Sharp runtime
//     scriberr/                   <- docker-compose only (optional Docker mode)
//     shared/                     <- static shared assets

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPinnedCleanCheckout,
  pinnedSourceTree,
  writeSourceCommitReceipt,
} from "./pinned-source-checkout.mjs";
import { assertStandaloneDashboardRuntimeDependencies } from "./dashboard-build-cache.mjs";
import {
  assertCurrentStandaloneBuildManifest,
  packagedDashboardCopyPlan,
  shouldExcludePackagedDashboardPath,
} from "./packaged-dashboard-input.mjs";
import { assertVoiceboxArtifactReceipt } from "./voicebox-artifact-receipt.mjs";
import { stagePinnedVlmOcrRuntime } from "./vlm-ocr-runtime-artifact.mjs";
import {
  isPatentDisclosurePackageFile,
  PATENT_DISCLOSURE_REQUIRED_FILES,
  PATENT_DISCLOSURE_UPSTREAM_COMMIT,
} from "./patent-disclosure-package.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const stagingRoot = path.join(desktopRoot, "build-resources", "app-services");
const runtimeV2ManifestSource = path.join(desktopRoot, "runtime-v2", "manifests");
const runtimeV2ManifestTarget = path.join(
  desktopRoot,
  "build-resources",
  "runtime-v2",
  "manifests",
);
const hermesRoot = path.join(repoRoot, "hermes-agent");
const HERMES_UPSTREAM_COMMIT = "4f5c688775a4ba850d7d3adc5dfd54efcf39ebd3";
const scientificSkillsRoot = path.join(repoRoot, "scientific-agent-skills");
const SCIENTIFIC_SKILLS_UPSTREAM_COMMIT = "757b63b1c09798a45c79eea542c9b55dbe04e502";
const REVIEWED_LOCAL_SOURCE_COMMITS = Object.freeze({
  penecho: "5d14d54b5a8d06dab4cb6a865f2547556e5ff842",
  googleImages: "e9c515eda45807d80d9ccc993be781d0ee13d47b",
  tradingAgents: "271e8c88a9874cae3f4ba8059b78301c13fa9e18",
  openExecutive: "755d8ec13083bc231b2d9c331af48ff5df902a81",
  agentReach: "241b02870892525e009bceaa7823d3f7b6c6f617",
  watermarks: "ff5db594f189373b80afde42449b5ad952270c95",
});
const PINNED_PACKAGED_SERVICE_COMMITS = Object.freeze({
  comfyUi: "2eb609766a749e3104485979615e062e401bab97",
  deepResearch: "8df5f9b6d8c8f9942ae5e8950972248a152c4f3d",
  deerFlow: "99c926b7bbcd0570870bc24ceb13ab934935f49c",
  moneyPrinter: "bdc45823a15efd438ba88d27bcba3a2e377c867c",
  mem0: "4debc58a83377b18be81ae1e5969a300736b2fac",
  openscience: "74ee13cdd1e086effd7a616a7c0bbad678bc5e51",
  openwork: "776a0646be968842f73d523f3c56372a9ee4ed82",
  stockAnalyst: "235c898a6da8a5229465d49230b479cd92192867",
  vibeTrading: "b3059dca26cea320accc24ba17060830d2f6a22b",
  voicebox: "51f49dea198384b4eb6087b72c17057c6eb1c1cd",
  wardrobe: "f44006cce7e4779e595a35b25fbbc8dabc68d7e4",
});
const SOURCE_ARTIFACT_RECEIPT_NAME = "BREADBOARD_SOURCE_ARTIFACT.json";
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
const VOICEBOX_ARTIFACT_RECEIPT = path.join(
  desktopRoot,
  "runtime-v2",
  "vendor",
  "voicebox",
  "runtime-artifact.json",
);
const PINNED_CLIPROXY_RUNTIME = Object.freeze({
  schemaVersion: 1,
  name: "CLIProxyAPI",
  version: "7.2.111",
  upstreamCommit: "4a315136",
  builtAt: "2026-07-30T18:58:06Z",
  platform: "win32",
  architecture: "x64",
  archive: {
    name: "CLIProxyAPI_7.2.111_windows_amd64.zip",
    url: "https://github.com/router-for-me/CLIProxyAPI/releases/download/v7.2.111/CLIProxyAPI_7.2.111_windows_amd64.zip",
    size: 20_845_521,
    sha256: "F209A15A66DD2D2770723986477FA0F8F3F3E0B244E16028E86CE5A08315BD47",
  },
  executable: {
    name: "cli-proxy-api.exe",
    size: 64_435_712,
    sha256: "90797AF3A2F1293B9253E0DB6F35C20295AE4ECA168E9B15252609F1942E5B52",
  },
  license: {
    name: "LICENSE",
    size: 1_137,
    sha256: "93DF585E5FA07EAD6D47A3AB2DBDF0255782A39FE830022C0274A70394223CC8",
  },
});
const PINNED_RECALL_RUNTIME = Object.freeze({
  schemaVersion: 1,
  name: "@screenpipe/cli-win32-x64",
  version: "0.4.37",
  platform: "win32",
  architecture: "x64",
  npmIntegrity: "sha512-5QXYbw2xdqAXCf0+NlNRYrCK1leo+fUnlb8cUNBlS/cvg/xiRSH5WgkwPYhCgWDYz2EpBdcMH4f6pbOSN3JRMA==",
  dependencyLockSha256: "23F14A87B339926E0846CF82CC8AC91637F4663331E70D780A70B11067788B08",
  files: {
    "DirectML.dll": { size: 18_527_776, sha256: "9C9E6D822561C6C41B90E6994B3E8857CF1D66DBFB1E0C4C799C7C89B4E92DA1" },
    "libopenblas.dll": { size: 51_117_073, sha256: "B554C45AF7B39154C561FB4879FD784D4928462E9A70335AADD9B1DE3C75E9E2" },
    "msvcp140_1.dll": { size: 35_768, sha256: "206C931BF90FDAD8816DE3B5E2EF80B2BCAA9406C89ECC05FE6FDDFFE251E982" },
    "msvcp140.dll": { size: 643_512, sha256: "7C26614E1D733892C2DEAC7E245CE115504B1D80592DD0A01B08E3E5A55F89CA" },
    "onnxruntime.dll": { size: 17_270_304, sha256: "A2323BC49544645B911743052F1EDCE594E17DF1E3423B71468C7386BC902F80" },
    "screenpipe.exe": { size: 44_297_272, sha256: "3BF31DBC0F2DE666046F8D439A0C758CF5F0430640AD19F9D33046DF9A8FA0FB" },
    "vcruntime140_1.dll": { size: 50_112, sha256: "A7146C08F89FE5B04541AB507CDB59FF7B44534D4BA3C668A426C6450A03434E" },
    "vcruntime140.dll": { size: 178_616, sha256: "D1F4225DF2CD877DBF130D5668A021DCE3F94118455FF5EC952061C30AFC9CE7" },
  },
  license: {
    name: "LICENSE.md",
    size: 3_705,
    sha256: "5A2DED76EAAAF6BFB3FF6BB7C4D995D7D5C8CF4F48FB940A7BEBCCEB2BCFAA58",
  },
});
const PINNED_OPENSCIENCE_RUNTIME = Object.freeze({
  schemaVersion: 1,
  name: "@synsci/openscience",
  version: "2.0.22",
  sourceCommit: PINNED_PACKAGED_SERVICE_COMMITS.openscience,
  platform: "win32",
  architecture: "x64",
  npmIntegrity: "sha512-ECK6o4wGbMw+N/qDGxv6xxn6+LI57kNpWMizjEWWOIZ/2h3rAHp/NbNrp2/N3Jj5Dz78o8f44LtJ/xXyqiyxLg==",
  dependencyLockSha256: "924AC97731F4DF7570D13E2991C0691199AC767B8B5C18F52CB96F470B72E2F9",
  files: {
    "node_modules/@synsci/openscience/bin/openscience": {
      size: 7_903,
      sha256: "EC3237E7D0A347C44286EBE42842268BB69F6C5A17B67490C494AE9EEC0B914D",
    },
    "node_modules/@synsci/openscience/package.json": {
      size: 1_023,
      sha256: "B787187248830064F8CF685EC6F33E0C53D74FC2AE446DB07A82CD57114C20B5",
    },
    "node_modules/@synsci/openscience-windows-x64/bin/openscience.exe": {
      size: 163_131_904,
      sha256: "F1398B6555A98991321D3A1DCE2F88AC18D2914411D58D0D73D75EE9530A6190",
    },
    "node_modules/@synsci/openscience-windows-x64/package.json": {
      size: 236,
      sha256: "4F96FA6B680D86ACC84737CDF7CBBDB5E5DB142DD7A8D1624810592BBA1FAD79",
    },
    "node_modules/@synsci/openscience-windows-x64-baseline/bin/openscience.exe": {
      size: 162_408_960,
      sha256: "5E22FA211B78F762953D0B546ABF9FC17D90589FF524B9C62F09273150714D82",
    },
    "node_modules/@synsci/openscience-windows-x64-baseline/package.json": {
      size: 245,
      sha256: "0194E2675E9CD01CAD65B341AF846EF7C99660783C2A0CF1500BD1DC7978CB56",
    },
  },
});
const PINNED_OPENWORK_DEPENDENCIES = Object.freeze({
  "@opencode-ai/sdk": "1.17.11",
  "better-sqlite3": "13.0.2",
  "drizzle-orm": "0.45.2",
  "jsonc-parser": "3.3.1",
  "minimatch": "10.2.5",
  "yaml": "2.9.0",
  "zod": "4.3.6",
  "@openwork/paths": "file:../../packages/paths",
  "@openwork/types": "file:../../packages/types",
});
const PINNED_OPENWORK_RUNTIME = Object.freeze({
  schemaVersion: 1,
  name: "openwork-server",
  version: "0.18.16",
  sourceCommit: PINNED_PACKAGED_SERVICE_COMMITS.openwork,
  platform: "win32",
  architecture: "x64",
  dependencyLock: {
    format: "npm-lockfile-v3",
    size: 9_839,
    sha256: "B24720CBC3E03F87F8ACDBB5F37B8C8A8C8AC8BD7E542373248943DDD817175E",
  },
  preparedManifest: {
    size: 1_145,
    sha256: "12A18A45E7CC0AD98AA44E19798D0809CABAF24B45F6CCC5C29B54E8C3A7DC19",
  },
  source: {
    server: { fileCount: 173, sha256: "DFE336F69C08B971A03137E9C9462F893C4EB38CEB7CABF2AE9DD9DDD1AC3760" },
    paths: { fileCount: 5, sha256: "4C111185DD4326052CB33F46BEBEF1633FF01F01E2A319F155C1D036C634DD57" },
    types: { fileCount: 21, sha256: "A85E3CDFFFF015AD0B2E1F6094FD64714105ECCE1E6422A2B95C10FD36C35510" },
    constants: { size: 36, sha256: "05A3909E20FD68F802E159270EF8AE50C10B04CEB265A37BE95541355253C880" },
  },
  nodeModules: {
    fileCount: 3_925,
    sha256: "5B42BB7DD28B7519CA00CEBE8AA8BD22263427DA627EF30B3B1FA58278E4787C",
  },
  sdkPackage: {
    name: "@opencode-ai/sdk",
    version: "1.17.11",
    packageJsonSize: 1_434,
    packageJsonSha256: "8421A9A4010200BECCC483C560B896773011E30EF548B68982A3C36A4176129A",
  },
  install: {
    command: "npm ci --omit=dev --ignore-scripts --no-audit --no-fund",
    runtimeNetworkRequired: false,
  },
});
const PINNED_WARDROBE_RUNTIME = Object.freeze({
  schemaVersion: 1,
  name: "wardrobe",
  version: "1.0.0",
  sourceCommit: PINNED_PACKAGED_SERVICE_COMMITS.wardrobe,
  platform: "win32",
  architecture: "x64",
  source: {
    fileCount: 16,
    sha256: "AE53F7EA6A10B4F2F4C8483473E25A13579CE5B7E9F85BF0D9144923D98C46A1",
  },
  packageManifest: {
    size: 631,
    sha256: "25EF9D9862AD6A6864465F5B0293222A60E4C8D5AD062688D44B530C908FCDFF",
  },
  dependencyLock: {
    format: "npm-lockfile-v3",
    size: 112_294,
    sha256: "10417E4CC550BEC667376D779259445AAD6E4ECA3643C651526FAE11E262523E",
  },
  nodeModules: {
    fileCount: 14_106,
    sha256: "BF23EAE5091E0FA51865B04474CD6E96E8DA721E80DFD4D66BB6E8D521A267B2",
  },
  vite: {
    version: "6.4.3",
    packageJson: {
      size: 5_251,
      sha256: "A1D0149FD986FD34B6D35503D2C0D8D9F743C4DBAAF94FBC11812BC84B05884D",
    },
  },
  sharp: {
    version: "0.34.5",
    libvipsVersion: "8.17.3",
    packageJson: {
      size: 7_478,
      sha256: "E6BE69319929151BE3AA240BF1485F25A3477CB6D2286F92510B9FCEB3CBEF26",
    },
    nativeFiles: {
      "node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node": {
        size: 433_152,
        sha256: "AFC813593F255968DDAE8F1D66557E0F96484BB374606E4EB2267A7DBC7CB25A",
      },
      "node_modules/@img/sharp-win32-x64/lib/libvips-42.dll": {
        size: 19_112_960,
        sha256: "F8D356DEF73941668252347B825055310E99023FF77C7D3036E592D0771E1529",
      },
      "node_modules/@img/sharp-win32-x64/lib/libvips-cpp-8.17.3.dll": {
        size: 327_168,
        sha256: "F1B3C3EEEA1B6A8292A69D78DD2CD1DEBACB9951CABDD9217A57E34137570CD1",
      },
    },
  },
  install: {
    command: "npm ci --omit=dev --ignore-scripts --no-audit --no-fund",
    runtimeNetworkRequired: false,
  },
});
const PINNED_MEM0_RUNTIME = Object.freeze({
  schemaVersion: 1,
  name: "mem0ai",
  version: "3.1.5",
  platform: "win32",
  architecture: "x64",
  source: {
    commit: PINNED_PACKAGED_SERVICE_COMMITS.mem0,
    tree: "6d1ef35be8ee14a65bfa5dc213fbde9884cd8f38",
    packageManifest: {
      size: 7_991,
      sha256: "AEDF5C3F5CADFDEE10CD9933676B2487C2AEA5D0917B9BB98512980BA4F15136",
    },
    dependencyLock: {
      format: "pnpm-lock-v9",
      size: 343_440,
      sha256: "E34B558987E1276F3A0AB44E4CF5BAF8E54CE5786DD77AFB8359BD418B55DD68",
    },
    workspaceManifest: {
      size: 1_243,
      sha256: "D5858AF881395A9AD9F68545008197BAF0BBDDF69E06B7CD06D9B81E5215AC6B",
    },
    license: {
      size: 11_349,
      sha256: "0BBCBE931C353293A2FAFCE08326181DFEEA0E568C566AFD4CE8337A70F5E219",
    },
  },
  build: {
    nodeVersion: "24.14.1",
    packageManager:
      "pnpm@10.5.2+sha512.da9dc28cd3ff40d0592188235ab25d3202add8a207afbedc682220e4a0029ffbff4562102b9e6e46b4e3f9e8bd53e6d05de48544b0c57d4b0179e22c76d1199b",
    install: "corepack pnpm@10.5.2 install --frozen-lockfile",
    compile: "corepack pnpm@10.5.2 exec tsup",
    cleanMachineNetworkRequired: true,
    runtimeNetworkRequired: false,
  },
  dist: {
    buildOutput: {
      fileCount: 12,
      sha256: "D33627F29BF81CFC570E5E8AA8356EC4C4D0612AB7D2F8BBEA47B67A47A86167",
    },
    stagedOutput: {
      fileCount: 8,
      sha256: "A1D0BBFAD86DAC1954E1D330CD335C839E5A7D4950682824A7841C51AB8CA78A",
    },
  },
  dependencies: {
    axios: "1.18.1",
    "better-sqlite3": "12.9.0",
    openai: "4.104.0",
    pg: "8.11.3",
    uuid: "11.1.1",
    zod: "3.25.76",
  },
  native: {
    betterSqlite3: {
      packageManifest: {
        size: 1_427,
        sha256: "9D2524247288858CFBA9FCD1636CF5540B95E87C4BE0993EB61ECF9B2D0A8D14",
      },
      binary: {
        size: 1_916_928,
        sha256: "D6D1F318430B28F9F803AC7E521724DD895A3F88C332EBE20D67F49BCB3799CB",
      },
    },
  },
  closure: {
    fileCount: 4_048,
    sha256: "A1E1BD7B439438CE7741895F117A2D82B103D346F84F7854355B362C330525F1",
    excludes: ["BREADBOARD_SOURCE_COMMIT", "runtime-artifact.json"],
  },
});
const PINNED_GBRAIN_RUNTIME = Object.freeze({
  schemaVersion: 1,
  adapter: {
    package: "@breadboard/gbrain-adapter",
    version: "0.1.0",
    sourceGitTree: "321aea7a3e2a891322bab0d9565561f825ca1c2b",
    sourceSha256: "EAEBE95DD7B53C2425F3B875982DEE6FBD149FAECE71961D94682A15389DFBED",
    sourceFileCount: 13,
    packageSha256: "3FBB7B271E513887BE51AF945DDBAADA302856715347B911319B0A71BF60BFBB",
    bunLockSha256: "346D47609DC78FD25DEF4D49A74865689B68A0B0BD27F46BA2857CA8F28F2AE2",
    pgliteVersion: "0.2.17",
  },
  engine: {
    package: "gbrain",
    version: "0.42.62.0",
    sourceGitTree: "6789d243367aa1eeccceb0cdae187025a31008b5",
    sourceSha256: "8277B0589741F7E6A0E5F80D0DBB6FEA97611D9203A5EC04A7FFF90E6020DEAC",
    sourceFileCount: 804,
    packageSha256: "A152629DC16865A5DC6B4472DC896A9AEACECE5577515BAA9345D9B242E78CFA",
    bunLockSha256: "696B19255646ABE2139DFE464532B5768F142FF06D0740D71425A9D31E4E4B38",
    licenseSha256: "E56FBB5B3D95756F3FA1CFEFA24732EC79F18ECE1AD08A4E79E00DF57E8B198C",
    upstreamReceiptSha256: "98CED2E74C270E8EF1843638CF213AB40DB825AE5ADFCBAFB9F6D9656E86A370",
    versionFileSha256: "6FC457AC62712991A592105719DFA806E0DAB830DBD1E308374B0FE058C34221",
    pgliteVersion: "0.4.3",
  },
});
const PACKAGED_SERVICE_UV_VERSION = "0.12.5";
const PACKAGED_SERVICE_UV_EXE_SHA256 = "8DA6CEDEF60C27AC997EBF400FBFC6D373C5B0A7AE6A299B9D52BE7FE63723FB";
const PACKAGED_PYTHON_SERVICES = Object.freeze([
  {
    id: "cad", package: "breadboard-cad", packageVersion: "1.0.0",
    serviceDirectory: "cad-service", moduleDirectory: "breadboard_cad",
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
    corePackages: { cadquery: "2.6.0", "cadquery-ocp": "7.8.1.1.post1", pydantic: "2.13.4" },
  },
  {
    id: "colpali", package: "breadboard-colpali", packageVersion: "1.0.0",
    serviceDirectory: "colpali-service", moduleDirectory: "breadboard_colpali",
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
      "colpali-engine": "0.3.17", pydantic: "2.13.4", torch: "2.6.0",
      torchvision: "0.21.0", transformers: "5.15.1",
    },
  },
  {
    id: "humanizer", package: "breadboard-humanizer", packageVersion: "1.0.0",
    serviceDirectory: "humanizer-service", moduleDirectory: "breadboard_humanizer",
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
      pydantic: "2.13.4", safetensors: "0.8.0", sentencepiece: "0.2.2",
      torch: "2.6.0", transformers: "4.57.6",
    },
  },
  {
    id: "solidworks-mcp", package: "solidworks-mcp-python", packageVersion: "1.0.1",
    serviceDirectory: "SolidworksMCP-python", moduleDirectory: "src/solidworks_mcp",
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
    additionalSourceFiles: {
      LICENSE: "5C6AACFC7660B78F60C6711768482F9BC01185EC76F9A958672D701B005FA073",
      "README.md": "F39080AAE6A6EAE9C73D6FAFDB187F065D08DD8127A576B5AA34BDC0DABB1179",
    },
    packageCount: 159,
    platformExcludedPackages: ["jeepney", "secretstorage"],
    corePackages: {
      comtypes: "1.4.16", fastmcp: "3.4.2", mcp: "1.28.1", pydantic: "2.12.5",
      "pydantic-ai": "1.107.0", pywin32: "311", "pywin32-ctypes": "0.2.3",
      sqlmodel: "0.0.38", uvicorn: "0.41.0",
    },
    externalBoundary: ["locally licensed Windows SolidWorks installation and COM automation"],
  },
]);

function log(message) {
  console.log(`[prepare-app] ${message}`);
}

function fail(message) {
  console.error(`[prepare-app] ERROR: ${message}`);
  process.exit(1);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

function canonicalFileIdentity(filePath) {
  const source = fs.readFileSync(filePath);
  const canonical = source.includes(0)
    ? source
    : Buffer.from(source.toString("utf8").replace(/\r\n/gu, "\n"), "utf8");
  return {
    sha256: createHash("sha256").update(canonical).digest("hex").toUpperCase(),
    size: canonical.length,
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
      if (metadata.isSymbolicLink()) fail(`Immutable source closure contains a symlink: ${fullPath}`);
      if (metadata.isDirectory()) {
        await visit(fullPath);
      } else if (metadata.isFile()) {
        const identity = canonicalFileIdentity(fullPath);
        records.push(`${relativePath}\0${identity.size}\0${identity.sha256}\n`);
      } else {
        fail(`Immutable source closure contains a non-file entry: ${fullPath}`);
      }
    }
  }
  await visit(root);
  return {
    sha256: createHash("sha256").update(records.join("")).digest("hex").toUpperCase(),
    fileCount: records.length,
  };
}

function loadReviewedOciReceipt(receiptPath, label, expectedCommit, expectedStack) {
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch (error) {
    fail(`${label} OCI receipt is invalid JSON: ${error instanceof Error ? error.message : String(error)}.`);
  }
  if (
    Object.keys(receipt ?? {}).sort().join(",") !==
      "images,platform,schemaVersion,sourceCommit,sourceFiles,stack" ||
    receipt.schemaVersion !== 1 ||
    receipt.stack !== expectedStack ||
    receipt.sourceCommit !== expectedCommit ||
    receipt.platform !== "linux/amd64" ||
    !Array.isArray(receipt.sourceFiles) ||
    receipt.sourceFiles.length === 0 ||
    !Array.isArray(receipt.images) ||
    receipt.images.length === 0
  ) {
    fail(`${label} OCI receipt does not have the reviewed immutable envelope.`);
  }
  const sourceFiles = new Map();
  for (const row of receipt.sourceFiles) {
    const relative = row?.path;
    if (
      Object.keys(row ?? {}).sort().join(",") !== "path,sha256,size" ||
      typeof relative !== "string" ||
      !relative ||
      relative.includes("\\") ||
      relative.startsWith("/") ||
      relative.split("/").some((component) => !component || component === "." || component === "..") ||
      sourceFiles.has(relative) ||
      !Number.isSafeInteger(row.size) ||
      row.size < 1 ||
      !/^[0-9A-F]{64}$/u.test(row.sha256 ?? "")
    ) {
      fail(`${label} OCI receipt contains an invalid source-file row.`);
    }
    sourceFiles.set(relative, row);
  }
  const images = new Map();
  for (const row of receipt.images) {
    if (
      Object.keys(row ?? {}).sort().join(",") !==
        "immutableReference,indexDigest,linuxAmd64Manifest,service,sourceReference" ||
      typeof row.service !== "string" ||
      !row.service ||
      images.has(row.service) ||
      typeof row.sourceReference !== "string" ||
      row.sourceReference.includes("@") ||
      typeof row.immutableReference !== "string" ||
      !/^[^\s@]+@sha256:[0-9a-f]{64}$/u.test(row.immutableReference) ||
      !/^sha256:[0-9a-f]{64}$/u.test(row.indexDigest ?? "") ||
      !row.immutableReference.endsWith(`@${row.indexDigest}`) ||
      Object.keys(row.linuxAmd64Manifest ?? {}).sort().join(",") !== "digest,size" ||
      !/^sha256:[0-9a-f]{64}$/u.test(row.linuxAmd64Manifest.digest ?? "") ||
      !Number.isSafeInteger(row.linuxAmd64Manifest.size) ||
      row.linuxAmd64Manifest.size < 1
    ) {
      fail(`${label} OCI receipt contains an invalid image row.`);
    }
    images.set(row.service, row);
  }
  return { receipt, images, sourceFiles };
}

function assertReviewedOciSource(sourceRoot, reviewed, label) {
  const actual = new Map();
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) fail(`${label} reviewed source contains a symlink: ${absolute}.`);
      if (metadata.isDirectory()) {
        visit(absolute);
      } else if (metadata.isFile()) {
        const relative = path.relative(sourceRoot, absolute).split(path.sep).join("/");
        actual.set(relative, canonicalFileIdentity(absolute));
      } else {
        fail(`${label} reviewed source contains a non-file entry: ${absolute}.`);
      }
    }
  };
  visit(sourceRoot);
  if (actual.size !== reviewed.sourceFiles.size) {
    fail(`${label} reviewed source file count does not match its OCI receipt.`);
  }
  for (const [relative, expected] of reviewed.sourceFiles) {
    const identity = actual.get(relative);
    if (identity?.size !== expected.size || identity?.sha256 !== expected.sha256) {
      fail(`${label} reviewed source is missing or stale for ${relative}.`);
    }
  }
}

function pinComposeImages(source, reviewed, label) {
  const lines = source.replace(/\r\n/gu, "\n").split("\n");
  const output = [];
  const seen = new Set();
  let service = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const serviceMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/u);
    if (serviceMatch) service = serviceMatch[1];
    const imageMatch = line.match(/^(\s{4})image:\s*['"]?([^'"\s]+)['"]?\s*$/u);
    if (!imageMatch) {
      output.push(line);
      continue;
    }
    const row = reviewed.images.get(service);
    if (!row || imageMatch[2] !== row.sourceReference || seen.has(service)) {
      fail(`${label} Compose image for service ${service ?? "unknown"} is not bound by its OCI receipt.`);
    }
    output.push(`${imageMatch[1]}image: ${row.immutableReference}`);
    if (/^\s{4}platform:\s*/u.test(lines[index + 1] ?? "")) index += 1;
    output.push(`${imageMatch[1]}platform: ${reviewed.receipt.platform}`);
    seen.add(service);
  }
  if (seen.size !== reviewed.images.size) {
    const missing = [...reviewed.images.keys()].filter((name) => !seen.has(name));
    fail(`${label} Compose does not consume every reviewed OCI row: ${missing.join(", ")}.`);
  }
  return output.join("\n");
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
              "export", "--frozen", "--no-dev", "--no-emit-project", "--offline",
              "--no-header", "--no-annotate", "--format", "pylock.toml",
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
      : { modelAssets: { bundled: false, storageAuthority: "data-root" } }),
  };
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function resolveCodexBinary() {
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  const candidates = [
    process.env.CODEX_BIN,
    path.join(repoRoot, "codex", "codex-rs", "target", "release", executable),
    path.join(repoRoot, "codex", "codex-rs", "target", "debug", executable),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  const lookup = spawnSync(
    process.platform === "win32" ? "where.exe" : "which",
    [executable],
    { encoding: "utf8", windowsHide: true },
  );
  if (lookup.status === 0) {
    const found = lookup.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (found && fs.existsSync(found)) return found;
  }
  fail(
    "Codex binary not found. Build ./codex/codex-rs, install Codex, or set CODEX_BIN before packaging.",
  );
}

/** Copy `source` to `target`, skipping any relative path for which `skip` returns true. */
function copyTree(source, target, skip = () => false) {
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    // Materialize symlinks as real files: creating symlinks on Windows needs
    // elevated privileges, and installer resources must be self-contained.
    dereference: true,
    filter: (src) => {
      const rel = path.relative(source, src);
      if (rel === "") return true;
      return !skip(rel.split(path.sep).join("/"));
    },
  });
}

function freshDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Materialize a reviewed subset of an independent Git checkout and freeze the
 * complete byte identity of that subset into the package. The receipt is
 * intentionally generated from tracked files only; ignored build products,
 * local configuration, caches, and untracked files can never become inputs.
 */
async function stagePinnedTrackedSourceClosure({
  label,
  sourceRoot,
  targetRoot,
  expectedCommit,
  allowVendoredSnapshot = false,
  include,
  required,
}) {
  let sourceCommit;
  try {
    sourceCommit = assertPinnedCleanCheckout({
      label,
      sourceRoot,
      expectedCommit,
      allowVendoredSnapshot,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const listing = spawnSync("git", ["-C", sourceRoot, "ls-files", "-z"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listing.status !== 0) fail(`Could not enumerate the tracked ${label} source closure.`);
  const selected = listing.stdout
    .split("\0")
    .filter(Boolean)
    .map((relative) => relative.replaceAll("\\", "/"))
    .filter(include)
    .sort();
  if (selected.length === 0) fail(`${label} source selection produced no files.`);

  freshDir(targetRoot);
  const files = [];
  for (const relative of selected) {
    const source = path.resolve(sourceRoot, ...relative.split("/"));
    const target = path.resolve(targetRoot, ...relative.split("/"));
    const sourceRelative = path.relative(sourceRoot, source);
    const targetRelative = path.relative(targetRoot, target);
    if (
      sourceRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(sourceRelative) ||
      targetRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(targetRelative)
    ) {
      fail(`${label} tracked source path escapes its root: ${relative}`);
    }
    const metadata = fs.lstatSync(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`${label} tracked source must be a direct regular file: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    files.push({
      path: relative,
      size: metadata.size,
      sha256: await sha256File(source),
    });
  }
  for (const relative of required) {
    const staged = path.join(targetRoot, ...relative.split("/"));
    const metadata = fs.lstatSync(staged, { throwIfNoEntry: false });
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      fail(`${label} staged source is incomplete: ${relative}`);
    }
  }
  writeSourceCommitReceipt(targetRoot, sourceCommit);
  fs.writeFileSync(
    path.join(targetRoot, SOURCE_ARTIFACT_RECEIPT_NAME),
    `${JSON.stringify({ schemaVersion: 1, sourceCommit, files }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
}

async function acquirePinnedArchive({ label, suppliedPath, receipt, destination }) {
  let bytes;
  if (suppliedPath) {
    const source = path.resolve(suppliedPath);
    const metadata = fs.lstatSync(source, { throwIfNoEntry: false });
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      fail(`${label} supplied archive is not a direct regular file: ${source}`);
    }
    bytes = fs.readFileSync(source);
  } else {
    log(`downloading pinned ${label} archive ${receipt.name}`);
    const response = await fetch(receipt.url, { redirect: "follow" });
    if (!response.ok) fail(`${label} archive download failed with HTTP ${response.status}.`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const identity = {
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
  };
  if (identity.size !== receipt.size || identity.sha256 !== receipt.sha256) {
    fail(
      `${label} archive is not the reviewed artifact (${identity.size} bytes, SHA-256 ${identity.sha256}).`,
    );
  }
  fs.writeFileSync(destination, bytes, { mode: 0o600 });
}

async function resolvePackagedServiceSourceRoot(service) {
  const checkoutRoot = path.join(repoRoot, service.serviceDirectory);
  if (fs.existsSync(checkoutRoot) || !service.sourceArchive) {
    return { sourceRoot: checkoutRoot, archiveSource: false, cleanupRoot: null };
  }
  const cleanupRoot = fs.mkdtempSync(path.join(os.tmpdir(), `breadboard-${service.id}-source-`));
  const archive = path.join(cleanupRoot, service.sourceArchive.name);
  const extracted = path.join(cleanupRoot, "extracted");
  fs.mkdirSync(extracted, { recursive: true });
  await acquirePinnedArchive({
    label: `${service.id} source`,
    receipt: service.sourceArchive,
    destination: archive,
  });
  runChecked(process.platform === "win32" ? "tar.exe" : "tar", ["-xf", archive, "-C", extracted], {
    shell: false,
  });
  const sourceRoot = path.join(extracted, service.sourceArchive.rootDirectory);
  const moduleIdentity = await sha256Tree(path.join(sourceRoot, service.moduleDirectory));
  if (
    moduleIdentity.fileCount !== service.sourceFileCount ||
    moduleIdentity.sha256 !== service.sourceSha256
  ) {
    fail(
      `${service.id} archive source tree is not reviewed (${moduleIdentity.fileCount} files, SHA-256 ${moduleIdentity.sha256}).`,
    );
  }
  return { sourceRoot, archiveSource: true, cleanupRoot };
}

// Codex is a native coding agent launched per task by the dashboard. Stage the
// exact executable so an installed app does not depend on a global install.
const codexSource = resolveCodexBinary();
const codexTarget = path.join(
  desktopRoot,
  "resources",
  "bin",
  process.platform === "win32" ? "codex.exe" : "codex",
);
log(`staging Codex coding agent from ${codexSource}`);
fs.mkdirSync(path.dirname(codexTarget), { recursive: true });
fs.copyFileSync(codexSource, codexTarget);
if (process.platform !== "win32") fs.chmodSync(codexTarget, 0o755);

// Voicebox ships its Python/ML dependency closure as a native sidecar. Its
// upstream requirements contain floating and Git dependencies, so a source
// checkout alone is not a reproducible packaged runtime. Packaging therefore
// fails closed unless a reviewed, tracked receipt pins the exact executable
// built from the reviewed Voicebox commit.
{
  try {
    assertPinnedCleanCheckout({
      label: "Voicebox",
      sourceRoot: path.join(repoRoot, "voicebox"),
      expectedCommit: PINNED_PACKAGED_SERVICE_COMMITS.voicebox,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const voiceboxExecutable = process.platform === "win32" ? "voicebox-server.exe" : "voicebox-server";
  const voiceboxTarget = path.join(desktopRoot, "resources", "bin", voiceboxExecutable);
  const voiceboxReceiptTarget = path.join(
    desktopRoot,
    "resources",
    "bin",
    "voicebox-runtime-artifact.json",
  );
  if (!fs.existsSync(VOICEBOX_ARTIFACT_RECEIPT)) {
    fail(
      `Voicebox's reviewed native artifact receipt is missing: ${VOICEBOX_ARTIFACT_RECEIPT}. ` +
        "Build the CPU sidecar from the pinned checkout, validate it, and record its exact SHA-256 and size before packaging.",
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(VOICEBOX_ARTIFACT_RECEIPT, "utf8"));
  } catch (error) {
    fail(`Voicebox native artifact receipt is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    assertVoiceboxArtifactReceipt(receipt);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const targetTriple =
    process.platform === "win32"
      ? "x86_64-pc-windows-msvc.exe"
      : process.platform === "darwin" && process.arch === "arm64"
        ? "aarch64-apple-darwin"
        : process.platform === "darwin"
          ? "x86_64-apple-darwin"
          : "x86_64-unknown-linux-gnu";
  const candidates = [
    process.env.VOICEBOX_SERVER_BIN,
    path.join(repoRoot, "voicebox", "tauri", "src-tauri", "binaries", `voicebox-server-${targetTriple}`),
    path.join(repoRoot, "voicebox", "backend", "dist", voiceboxExecutable),
  ].filter(Boolean);
  const source = candidates.find((candidate) => {
    const metadata = candidate
      ? fs.lstatSync(candidate, { throwIfNoEntry: false })
      : null;
    return metadata?.isFile() === true && !metadata.isSymbolicLink();
  });
  if (!source) {
    fail(
      "Voicebox's reviewed native executable is unavailable. Set VOICEBOX_SERVER_BIN or build the pinned CPU sidecar before packaging.",
    );
  }
  const identity = { size: fs.statSync(source).size, sha256: await sha256File(source) };
  if (identity.size !== receipt.size || identity.sha256 !== receipt.sha256) {
    fail(
      `Voicebox native executable does not match its reviewed receipt (${identity.size} bytes, SHA-256 ${identity.sha256}).`,
    );
  }
  log(`staging reviewed Voicebox speech server from ${source}`);
  fs.mkdirSync(path.dirname(voiceboxTarget), { recursive: true });
  fs.copyFileSync(source, voiceboxTarget);
  fs.copyFileSync(VOICEBOX_ARTIFACT_RECEIPT, voiceboxReceiptTarget);
  if (process.platform !== "win32") fs.chmodSync(voiceboxTarget, 0o755);
}

// CLIProxyAPI is mandatory in packaged mode. Development may still use its
// update-oriented launcher, but an installed app receives one exact reviewed
// release and never asks GitHub for an unpinned "latest" binary at runtime.
{
  if (process.platform !== "win32" || process.arch !== "x64") {
    fail("The reviewed packaged CLIProxyAPI runtime currently supports Windows x64 only.");
  }
  const temporaryRoot = path.join(os.tmpdir(), "breadboard-cliproxy-7.2.111-win32-x64");
  const archive = path.join(temporaryRoot, PINNED_CLIPROXY_RUNTIME.archive.name);
  const extracted = path.join(temporaryRoot, "extracted");
  freshDir(temporaryRoot);
  fs.mkdirSync(extracted, { recursive: true });
  await acquirePinnedArchive({
    label: "CLIProxyAPI",
    suppliedPath: process.env.CLIPROXY_ARCHIVE,
    receipt: PINNED_CLIPROXY_RUNTIME.archive,
    destination: archive,
  });
  runChecked(process.platform === "win32" ? "tar.exe" : "tar", ["-xf", archive, "-C", extracted], {
    shell: false,
  });
  for (const [relative, expected, artifactLabel] of [
    [PINNED_CLIPROXY_RUNTIME.executable.name, PINNED_CLIPROXY_RUNTIME.executable, "executable"],
    [PINNED_CLIPROXY_RUNTIME.license.name, PINNED_CLIPROXY_RUNTIME.license, "license"],
  ]) {
    const artifact = path.join(extracted, relative);
    const metadata = fs.lstatSync(artifact, { throwIfNoEntry: false });
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      fail(`CLIProxyAPI reviewed ${artifactLabel} is absent from the pinned archive.`);
    }
    const identity = { size: metadata.size, sha256: await sha256File(artifact) };
    if (identity.size !== expected.size || identity.sha256 !== expected.sha256) {
      fail(`CLIProxyAPI ${artifactLabel} does not match the reviewed release.`);
    }
  }
  const binRoot = path.join(desktopRoot, "resources", "bin");
  fs.mkdirSync(binRoot, { recursive: true });
  fs.copyFileSync(
    path.join(extracted, PINNED_CLIPROXY_RUNTIME.executable.name),
    path.join(binRoot, PINNED_CLIPROXY_RUNTIME.executable.name),
  );
  fs.writeFileSync(
    path.join(binRoot, "cliproxy-runtime-artifact.json"),
    `${JSON.stringify(PINNED_CLIPROXY_RUNTIME, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
  const licensesRoot = path.join(desktopRoot, "build-resources", "licenses");
  fs.mkdirSync(licensesRoot, { recursive: true });
  fs.copyFileSync(
    path.join(extracted, PINNED_CLIPROXY_RUNTIME.license.name),
    path.join(licensesRoot, "cliproxy-LICENSE.txt"),
  );
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

// VLM OCR ships an immutable, CPU-portable llama.cpp server plus the exact
// HunyuanOCR Q8 model/projector pair. The two large model files are streamed
// to disk with incremental hashing so package assembly never buffers either
// artifact in Node's heap, and installed mode never contacts Hugging Face.
await stagePinnedVlmOcrRuntime({
  targetRoot: path.join(desktopRoot, "resources", "bin", "vlm-ocr"),
  licensesRoot: path.join(desktopRoot, "build-resources", "licenses"),
  suppliedPaths: {
    llamaArchive: process.env.BREADBOARD_VLM_OCR_LLAMA_ARCHIVE,
    model: process.env.BREADBOARD_VLM_OCR_MODEL_ARTIFACT,
    projector: process.env.BREADBOARD_VLM_OCR_PROJECTOR_ARTIFACT,
    llamaLicense: process.env.BREADBOARD_VLM_OCR_LLAMA_LICENSE,
    modelLicense: process.env.BREADBOARD_VLM_OCR_MODEL_LICENSE,
  },
  offline: process.env.BREADBOARD_OFFLINE_PACKAGE_ASSEMBLY === "1",
  log,
});

// Recall's recorder is an exact native npm artifact plus its adjacent DLL
// closure. Package it once so installed mode never performs an npm download
// before the capture service can start.
{
  if (process.platform !== "win32" || process.arch !== "x64") {
    fail("The reviewed packaged Recall runtime currently supports Windows x64 only.");
  }
  const authority = path.join(desktopRoot, "runtime-v2", "vendor", "recall");
  const target = path.join(stagingRoot, "recall-runtime-authority");
  freshDir(target);
  for (const entry of ["package.json", "package-lock.json"]) {
    const source = path.join(authority, entry);
    if (!fs.existsSync(source)) fail(`Recall immutable npm authority is missing: ${source}`);
    fs.copyFileSync(source, path.join(target, entry));
  }
  if ((await sha256File(path.join(target, "package-lock.json"))) !== PINNED_RECALL_RUNTIME.dependencyLockSha256) {
    fail("Recall's immutable npm lock is not the reviewed lock.");
  }
  installProductionDependencies({
    label: "recall",
    target,
    tempName: "breadboard-recall-runtime-install",
    command: "ci",
  });
  const installed = path.join(target, "node_modules", "@screenpipe", "cli-win32-x64");
  const runtime = path.join(desktopRoot, "resources", "bin", "recall");
  freshDir(runtime);
  for (const [name, expected] of Object.entries(PINNED_RECALL_RUNTIME.files)) {
    const source = path.join(installed, "bin", name);
    const metadata = fs.lstatSync(source, { throwIfNoEntry: false });
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      fail(`Recall's reviewed native closure is missing ${name}.`);
    }
    const identity = { size: metadata.size, sha256: await sha256File(source) };
    if (identity.size !== expected.size || identity.sha256 !== expected.sha256) {
      fail(`Recall's reviewed native closure does not match for ${name}.`);
    }
    fs.copyFileSync(source, path.join(runtime, name));
  }
  const licenseSource = path.join(installed, PINNED_RECALL_RUNTIME.license.name);
  const licenseIdentity = {
    size: fs.statSync(licenseSource).size,
    sha256: await sha256File(licenseSource),
  };
  if (
    licenseIdentity.size !== PINNED_RECALL_RUNTIME.license.size ||
    licenseIdentity.sha256 !== PINNED_RECALL_RUNTIME.license.sha256
  ) fail("Recall's packaged license is not the reviewed license.");
  fs.writeFileSync(
    path.join(runtime, "runtime-artifact.json"),
    `${JSON.stringify(PINNED_RECALL_RUNTIME, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
  const licensesRoot = path.join(desktopRoot, "build-resources", "licenses");
  fs.mkdirSync(licensesRoot, { recursive: true });
  fs.copyFileSync(licenseSource, path.join(licensesRoot, "recall-LICENSE.txt"));
}

/**
 * Produce a production `node_modules` for an already-staged package.
 *
 * npm installs can fail under a OneDrive-synchronized checkout while native
 * files are being scanned, so the install runs in the OS temp directory and the
 * resulting tree is materialized back into build-resources.
 */
function installProductionDependencies({
  label,
  target,
  tempName,
  command,
  workingDirectory = ".",
  materializedLinks = [],
}) {
  if (
    path.isAbsolute(workingDirectory) ||
    workingDirectory.split(/[\\/]/u).some((component) => component === "..")
  ) {
    fail(`${label} production install working directory is not a safe relative path`);
  }
  const localInstallDir = path.join(os.tmpdir(), tempName);
  freshDir(localInstallDir);
  copyTree(target, localInstallDir);
  const localWorkingDirectory = path.resolve(localInstallDir, workingDirectory);
  const targetWorkingDirectory = path.resolve(target, workingDirectory);
  if (
    !fs.statSync(localWorkingDirectory, { throwIfNoEntry: false })?.isDirectory() ||
    path.relative(localInstallDir, localWorkingDirectory).startsWith(`..${path.sep}`) ||
    path.relative(target, targetWorkingDirectory).startsWith(`..${path.sep}`)
  ) {
    fail(`${label} production install working directory is unavailable`);
  }
  const npmCli = process.platform === "win32"
    ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    : null;
  if (npmCli && !fs.existsSync(npmCli)) {
    fail(`npm CLI was not found beside the active Node runtime: ${npmCli}`);
  }
  const npmCommand = npmCli ? process.execPath : "npm";
  const npmPrefix = npmCli ? [npmCli] : [];
  let installStatus = 1;
  for (let attempt = 1; attempt <= 2 && installStatus !== 0; attempt += 1) {
    if (attempt > 1) {
      log(`retrying ${label} production install after a transient failure`);
      fs.rmSync(path.join(localWorkingDirectory, "node_modules"), { recursive: true, force: true });
    }
    const install = spawnSync(
      npmCommand,
      [...npmPrefix, command, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: localWorkingDirectory, stdio: "inherit", shell: false },
    );
    installStatus = install.status ?? 1;
  }
  if (installStatus !== 0) fail(`production install for ${label} failed`);
  const installedModules = path.join(localWorkingDirectory, "node_modules");
  if (!fs.existsSync(installedModules)) {
    fail(`${label} production install produced no node_modules`);
  }
  for (const { packageName, sourceRelative } of materializedLinks) {
    if (
      !/^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/u.test(packageName) ||
      path.isAbsolute(sourceRelative) ||
      sourceRelative.split(/[\\/]/u).some((component) => component === "..")
    ) {
      fail(`${label} production install declared an unsafe materialized package link`);
    }
    const source = path.resolve(target, sourceRelative);
    const destination = path.resolve(installedModules, ...packageName.split("/"));
    const sourceMetadata = fs.lstatSync(source, { throwIfNoEntry: false });
    if (
      !sourceMetadata?.isDirectory() ||
      sourceMetadata.isSymbolicLink() ||
      path.relative(target, source).startsWith(`..${path.sep}`) ||
      path.relative(installedModules, destination).startsWith(`..${path.sep}`)
    ) {
      fail(`${label} production install cannot materialize ${packageName}`);
    }
    fs.rmSync(destination, { recursive: true, force: true });
    copyTree(source, destination);
  }
  copyTree(installedModules, path.join(targetWorkingDirectory, "node_modules"));
  fs.rmSync(localInstallDir, { recursive: true, force: true });
}

/** Produce a frozen production Bun dependency tree for a staged package. */
function installBunProductionDependencies({ label, target, tempName }) {
  const bunExecutable = path.join(
    desktopRoot,
    "build-resources",
    "runtimes",
    "bun",
    process.platform === "win32" ? "bun.exe" : "bun",
  );
  if (!fs.existsSync(bunExecutable)) {
    fail(`bundled Bun runtime was not prepared before staging ${label}: ${bunExecutable}`);
  }
  const localInstallDir = path.join(os.tmpdir(), tempName);
  freshDir(localInstallDir);
  copyTree(target, localInstallDir);
  const install = spawnSync(
    bunExecutable,
    [
      "install",
      "--production",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--backend=copyfile",
    ],
    { cwd: localInstallDir, stdio: "inherit", shell: false },
  );
  if (install.status !== 0) fail(`production Bun install for ${label} failed`);
  const installedModules = path.join(localInstallDir, "node_modules");
  if (!fs.existsSync(installedModules)) {
    fail(`${label} production Bun install produced no node_modules`);
  }
  copyTree(installedModules, path.join(target, "node_modules"));
  fs.rmSync(localInstallDir, { recursive: true, force: true });
}

// --- dashboard standalone -------------------------------------------------
let currentDashboardBuild;
try {
  currentDashboardBuild = assertCurrentStandaloneBuildManifest(repoRoot);
  assertStandaloneDashboardRuntimeDependencies(repoRoot);
} catch (error) {
  fail(
    `${error instanceof Error ? error.message : String(error)} ` +
      "Run the current dashboard desktop build before packaging.",
  );
}
const {
  standaloneSource,
  dashboardTarget,
  packagedDashboardTarget,
} = packagedDashboardCopyPlan(currentDashboardBuild, stagingRoot);
log("staging dashboard standalone server");
freshDir(dashboardTarget);
copyTree(standaloneSource, packagedDashboardTarget, (rel) =>
  // Belt-and-braces: never ship data, secrets, or dev build state even if
  // tracing regressions reintroduce them.
  shouldExcludePackagedDashboardPath(rel),
);
// Static assets + public files live outside the standalone tree.
log("staging dashboard static assets");
copyTree(
  path.join(repoRoot, "dashboard", ".next-desktop", "static"),
  path.join(packagedDashboardTarget, ".next-desktop", "static"),
);
copyTree(
  path.join(repoRoot, "dashboard", "public"),
  path.join(packagedDashboardTarget, "public"),
);

// Learn and document ingestion run in bounded one-job workers rather than in
// the long-lived Next server. Stage application source (never
// db/.env/artifacts) beside the standalone dependency graph so Node's native
// TypeScript loader can execute the same domain code after a dashboard recycle.
log("staging finite worker source closure");
copyTree(
  path.join(repoRoot, "dashboard", "src"),
  path.join(dashboardTarget, "dashboard", "worker-src"),
);
for (const relative of [
  ["lib", "generated-visual-browser-process.ts"],
  ["lib", "generated-visual-browser-tests.ts"],
  ["lib", "generated-visual-compiler.ts"],
  ["lib", "generated-visuals.ts"],
]) {
  const staged = path.join(
    dashboardTarget,
    "dashboard",
    "worker-src",
    ...relative,
  );
  if (!fs.existsSync(staged)) {
    fail(`finite generated-visual worker source was not staged: ${staged}`);
  }
}
const learnScriptsTarget = path.join(dashboardTarget, "dashboard", "scripts");
fs.mkdirSync(learnScriptsTarget, { recursive: true });
for (const entry of [
  "learn-worker.mjs",
  "learn-worker-import-hook.mjs",
  "windows-breakaway-process.mjs",
]) {
  fs.copyFileSync(
    path.join(repoRoot, "dashboard", "scripts", entry),
    path.join(learnScriptsTarget, entry),
  );
}

// PenEcho is a Runtime V2-owned optional canvas service. Stage only the
// package's declared production source/resource closure; its development,
// fixture, desktop-shell, and repository metadata trees are not launch
// inputs. When its optional Sharp dependency is absent the trusted native
// environment selects PNG, matching the pre-cutover launcher.
log("staging PenEcho Runtime service closure");
{
  const source = path.join(repoRoot, "penecho");
  const target = path.join(stagingRoot, "penecho");
  const sourceCommit = assertPinnedCleanCheckout({
    label: "PenEcho",
    sourceRoot: source,
    expectedCommit: REVIEWED_LOCAL_SOURCE_COMMITS.penecho,
  });
  const required = ["server.js", "src", "public", "package.json", "LICENSE", "NOTICE"];
  for (const entry of required) {
    if (!fs.existsSync(path.join(source, entry))) {
      fail(`PenEcho runtime dependency is missing: ${path.join(source, entry)}`);
    }
  }
  freshDir(target);
  for (const entry of ["server.js", "package.json", "LICENSE", "NOTICE", "README.md"]) {
    fs.copyFileSync(path.join(source, entry), path.join(target, entry));
  }
  copyTree(path.join(source, "src"), path.join(target, "src"), (rel) =>
    /(^|\/)(?:test|tests|fixtures)(\/|$)/iu.test(rel),
  );
  copyTree(path.join(source, "public"), path.join(target, "public"));
  writeSourceCommitReceipt(target, sourceCommit);
}

// Direct source workers cannot rely on Next's compiled route chunks to expose
// package exports. Copy the lockfile-installed production closures they import
// explicitly, including the MCP SDK conditional exports used by Hermes. This
// stages code only, never data or secrets.
log("staging finite-worker production dependency closures");
{
  const sourceModules = path.join(repoRoot, "dashboard", "node_modules");
  const targetModules = path.join(
    dashboardTarget,
    "dashboard",
    "node_modules",
  );
  const copied = new Set();
  const resolveDependency = (parentSource, name) => {
    const nested = path.join(parentSource, "node_modules", ...name.split("/"));
    return fs.existsSync(path.join(nested, "package.json"))
      ? nested
      : path.join(sourceModules, ...name.split("/"));
  };
  const copyDependency = (
    name,
    parentSource,
    parentTarget,
    rootTarget = targetModules,
    copiedSet = copied,
  ) => {
    const source = resolveDependency(parentSource, name);
    const target = source.startsWith(path.join(parentSource, "node_modules"))
      ? path.join(parentTarget, "node_modules", ...name.split("/"))
      : path.join(rootTarget, ...name.split("/"));
    const identity = `${source}\u0000${target}`;
    if (copiedSet.has(identity)) return;
    const manifestPath = path.join(source, "package.json");
    if (!fs.existsSync(manifestPath)) {
      fail(`Dashboard MCP dependency is missing from node_modules: ${name}`);
    }
    copiedSet.add(identity);
    copyTree(
      source,
      target,
      (rel) =>
        /(^|\/)(test|tests|docs|examples|coverage)(\/|$)/i.test(rel) ||
        (name === "mem0ai" && (
          /(^|\/)(src|node_modules)(\/|$)/iu.test(rel) ||
          /\.map$/iu.test(rel)
        )),
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const dependency of Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    })) {
      const resolved = resolveDependency(source, dependency);
      if (fs.existsSync(path.join(resolved, "package.json"))) {
        copyDependency(dependency, source, target, rootTarget, copiedSet);
      }
    }
  };
  const packageRootFromEntry = (entry) => {
    let cursor = fs.statSync(entry).isDirectory() ? entry : path.dirname(entry);
    while (true) {
      if (fs.existsSync(path.join(cursor, "package.json"))) return cursor;
      const parent = path.dirname(cursor);
      if (parent === cursor) fail(`Could not resolve a package root from ${entry}.`);
      cursor = parent;
    }
  };
  const resolvePortableDependency = (parentSource, name) => {
    const canonicalParent = fs.realpathSync.native(parentSource);
    for (const candidate of [
      path.join(parentSource, "node_modules", ...name.split("/")),
      path.join(canonicalParent, "node_modules", ...name.split("/")),
      path.join(path.dirname(canonicalParent), ...name.split("/")),
    ]) {
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    }
    const resolver = createRequire(path.join(canonicalParent, "package.json"));
    for (const specifier of [`${name}/package.json`, name]) {
      try {
        return packageRootFromEntry(resolver.resolve(specifier));
      } catch {
        // Package export maps commonly hide package.json; try its runtime
        // entrypoint before declaring the frozen dependency graph incomplete.
      }
    }
    return null;
  };
  const copyPortableDependency = ({ name, source, target, copiedSet, mem0Root = false }) => {
    const manifestPath = path.join(source, "package.json");
    if (!fs.existsSync(manifestPath)) {
      fail(`The immutable Mem0 dependency is missing: ${name} (${source}).`);
    }
    const identity = `${fs.realpathSync.native(source)}\u0000${target}`;
    if (copiedSet.has(identity)) return;
    copiedSet.add(identity);
    copyTree(source, target, (relative) =>
      /(^|\/)(?:node_modules|test|tests|docs|examples|coverage)(?:\/|$)/iu.test(relative) ||
      (mem0Root && (/(^|\/)src(?:\/|$)/iu.test(relative) || /\.map$/iu.test(relative))),
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      const resolved = resolvePortableDependency(source, dependency);
      if (!resolved) fail(`The frozen Mem0 dependency graph cannot resolve ${name} -> ${dependency}.`);
      copyPortableDependency({
        name: dependency,
        source: resolved,
        target: path.join(target, "node_modules", ...dependency.split("/")),
        copiedSet,
      });
    }
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {}).sort()) {
      const resolved = resolvePortableDependency(source, dependency);
      if (!resolved) continue;
      copyPortableDependency({
        name: dependency,
        source: resolved,
        target: path.join(target, "node_modules", ...dependency.split("/")),
        copiedSet,
      });
    }
  };
  for (const dependency of [
    "@cantoo/pdf-lib",
    "@embedpdf/pdfium",
    "@firecrawl/anydoc",
    "@modelcontextprotocol/sdk",
    "adm-zip",
    "bidi-js",
    "fast-xml-parser",
    // The ingestion worker embeds OCR text layers with pdf-lib + fontkit.
    "fontkit",
    "jszip",
    "katex",
    "mathjax-full",
    "better-sqlite3",
    "axios",
    "uuid",
    "zod",
    "openai",
    "pdf-parse",
    "pdfkit",
    "remark-gfm",
    "remark-math",
    "remark-parse",
    "svg-to-pdfkit",
    "unified",
    "utif2",
  ]) {
    copyDependency(dependency, sourceModules, targetModules);
  }

  const googleImagesSource = path.join(repoRoot, "mcp-google-images-search");
  const googleImagesTarget = path.join(stagingRoot, "mcp-google-images-search");
  const googleImagesCommit = assertPinnedCleanCheckout({
    label: "Google image-search MCP",
    sourceRoot: googleImagesSource,
    expectedCommit: REVIEWED_LOCAL_SOURCE_COMMITS.googleImages,
  });
  freshDir(googleImagesTarget);
  for (const entry of ["package.json", "LICENSE"]) {
    fs.copyFileSync(
      path.join(googleImagesSource, entry),
      path.join(googleImagesTarget, entry),
    );
  }
  copyTree(
    path.join(googleImagesSource, "src"),
    path.join(googleImagesTarget, "src"),
    (rel) => /(?:\.test)?\.ts$/iu.test(rel) || /\.map$/iu.test(rel),
  );
  const googleManifest = JSON.parse(
    fs.readFileSync(path.join(googleImagesSource, "package.json"), "utf8"),
  );
  const googleCopied = new Set();
  const googleModulesTarget = path.join(googleImagesTarget, "node_modules");
  for (const dependency of Object.keys(googleManifest.dependencies ?? {})) {
    const source = resolvePortableDependency(googleImagesSource, dependency);
    if (!source) {
      fail(`The frozen Google image-search dependency graph cannot resolve ${dependency}.`);
    }
    copyPortableDependency({
      name: dependency,
      source,
      target: path.join(googleModulesTarget, ...dependency.split("/")),
      copiedSet: googleCopied,
    });
  }
  writeSourceCommitReceipt(googleImagesTarget, googleImagesCommit);

  // Runtime V2 service/worker entrypoints live under app-services/dashboard,
  // outside the standalone server tree. Materialize only the direct package
  // closures those entrypoints import at that exact Node resolution root.
  // Mem0's local file dependency is a junction into a pnpm virtual store;
  // blindly dereferencing it loses sibling dependencies. Reconstruct a nested,
  // portable graph from each package's canonical resolver and freeze the full
  // byte identity before adding its immutable receipts.
  const runtimeServiceModules = path.join(stagingRoot, "dashboard", "node_modules");
  fs.rmSync(runtimeServiceModules, { recursive: true, force: true });
  const runtimeServiceCopied = new Set();
  // Clicky's Electron-owned mouse input uses the same bundled N-API FFI as
  // dashboard workers. Keep its native platform dependency outside the ASAR.
  copyDependency("koffi", sourceModules, runtimeServiceModules, runtimeServiceModules, runtimeServiceCopied);
  copyDependency(
    "@modelcontextprotocol/sdk",
    sourceModules,
    runtimeServiceModules,
    runtimeServiceModules,
    runtimeServiceCopied,
  );

  const mem0Checkout = path.join(repoRoot, "mem0");
  const mem0Source = path.join(mem0Checkout, "mem0-ts");
  let mem0Commit;
  try {
    mem0Commit = assertPinnedCleanCheckout({
      label: "Mem0",
      sourceRoot: mem0Checkout,
      expectedCommit: PINNED_PACKAGED_SERVICE_COMMITS.mem0,
      allowVendoredSnapshot: true,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const sourceTree = pinnedSourceTree(mem0Checkout, "mem0-ts");
  if (sourceTree !== PINNED_MEM0_RUNTIME.source.tree) {
    fail("Mem0's reviewed source tree is unavailable.");
  }
  if (process.version !== `v${PINNED_MEM0_RUNTIME.build.nodeVersion}`) {
    fail(
      `Mem0's reviewed bundle requires Node ${PINNED_MEM0_RUNTIME.build.nodeVersion}; ` +
        `found ${process.version}.`,
    );
  }
  for (const [relative, expected, artifactLabel] of [
    ["package.json", PINNED_MEM0_RUNTIME.source.packageManifest, "package manifest"],
    ["pnpm-lock.yaml", PINNED_MEM0_RUNTIME.source.dependencyLock, "frozen dependency lock"],
    ["pnpm-workspace.yaml", PINNED_MEM0_RUNTIME.source.workspaceManifest, "workspace policy"],
  ]) {
    const actual = canonicalFileIdentity(path.join(mem0Source, relative));
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      fail(`Mem0's reviewed ${artifactLabel} changed.`);
    }
  }
  const mem0Manifest = JSON.parse(fs.readFileSync(path.join(mem0Source, "package.json"), "utf8"));
  if (
    mem0Manifest.name !== PINNED_MEM0_RUNTIME.name ||
    mem0Manifest.version !== PINNED_MEM0_RUNTIME.version ||
    mem0Manifest.packageManager !== PINNED_MEM0_RUNTIME.build.packageManager
  ) {
    fail("Mem0's reviewed package identity or package-manager pin changed.");
  }
  const sourceDist = path.join(mem0Source, "dist");
  if (!fs.existsSync(sourceDist)) {
    fail("Mem0's reviewed build output is missing; run the fail-closed setup before packaging.");
  }
  const buildOutput = await sha256Tree(sourceDist);
  if (
    buildOutput.fileCount !== PINNED_MEM0_RUNTIME.dist.buildOutput.fileCount ||
    buildOutput.sha256 !== PINNED_MEM0_RUNTIME.dist.buildOutput.sha256
  ) {
    fail(
      `Mem0's build output is not pinned ` +
        `(${buildOutput.fileCount} files, SHA-256 ${buildOutput.sha256}).`,
    );
  }
  const mem0Target = path.join(runtimeServiceModules, "mem0ai");
  const portableCopied = new Set();
  copyPortableDependency({
    name: "mem0ai",
    source: mem0Source,
    target: mem0Target,
    copiedSet: portableCopied,
    mem0Root: true,
  });
  for (const [name, source] of [
    ["better-sqlite3", path.join(sourceModules, "better-sqlite3")],
    ["pg", path.join(mem0Source, "node_modules", "pg")],
  ]) {
    copyPortableDependency({
      name,
      source,
      target: path.join(mem0Target, "node_modules", ...name.split("/")),
      copiedSet: portableCopied,
    });
  }
  fs.copyFileSync(path.join(mem0Checkout, "LICENSE"), path.join(mem0Target, "LICENSE"));
  for (const [name, version] of Object.entries(PINNED_MEM0_RUNTIME.dependencies)) {
    const manifestPath = path.join(mem0Target, "node_modules", ...name.split("/"), "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.name !== name || manifest.version !== version) {
      fail(`Mem0's portable ${name} dependency is not pinned to ${version}.`);
    }
  }
  const stagedDist = await sha256Tree(path.join(mem0Target, "dist"));
  if (
    stagedDist.fileCount !== PINNED_MEM0_RUNTIME.dist.stagedOutput.fileCount ||
    stagedDist.sha256 !== PINNED_MEM0_RUNTIME.dist.stagedOutput.sha256
  ) {
    fail("Mem0's staged runtime bundle does not match the reviewed map-free output.");
  }
  for (const [relative, expected, artifactLabel] of [
    ["LICENSE", PINNED_MEM0_RUNTIME.source.license, "license"],
    [
      "node_modules/better-sqlite3/package.json",
      PINNED_MEM0_RUNTIME.native.betterSqlite3.packageManifest,
      "Better SQLite package manifest",
    ],
    [
      "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      PINNED_MEM0_RUNTIME.native.betterSqlite3.binary,
      "Better SQLite native binary",
    ],
  ]) {
    const actual = canonicalFileIdentity(path.join(mem0Target, ...relative.split("/")));
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      fail(`Mem0's ${artifactLabel} is not the reviewed immutable file.`);
    }
  }
  const closure = await sha256Tree(mem0Target);
  if (
    closure.fileCount !== PINNED_MEM0_RUNTIME.closure.fileCount ||
    closure.sha256 !== PINNED_MEM0_RUNTIME.closure.sha256
  ) {
    fail(
      `Mem0's portable runtime closure is not pinned ` +
        `(${closure.fileCount} files, SHA-256 ${closure.sha256}).`,
    );
  }
  const importSmoke = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        "const mem0 = await import('./dist/oss/index.mjs')",
        "const sqlite = await import('better-sqlite3')",
        "const postgres = await import('pg')",
        "if (typeof mem0.Memory !== 'function' || typeof sqlite.default !== 'function' || !(postgres.default?.Client || postgres.Client)) process.exit(2)",
      ].join("\n"),
    ],
    { cwd: mem0Target, encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000 },
  );
  if (importSmoke.status !== 0) {
    fail(
      `Mem0's portable runtime failed its import smoke: ` +
        `${`${importSmoke.stdout ?? ""}\n${importSmoke.stderr ?? ""}`.trim() || "no output"}`,
    );
  }
  writeSourceCommitReceipt(mem0Target, mem0Commit);
  fs.writeFileSync(
    path.join(mem0Target, "runtime-artifact.json"),
    `${JSON.stringify(PINNED_MEM0_RUNTIME, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
}

// Graft is a finite Runtime-owned code-index tool. Package the pinned global
// production closure into a fixed immutable app-services path so installed
// workers and coding agents never resolve a mutable PATH shim or download on
// first use.
log("staging pinned Graft code-index toolchain");
{
  const candidates = [
    process.env.BREADBOARD_GRAFT_PACKAGE_ROOT,
    process.env.APPDATA
      ? path.join(process.env.APPDATA, "npm", "node_modules", "@nanonets", "graft")
      : null,
    process.env.npm_config_prefix
      ? path.join(process.env.npm_config_prefix, "lib", "node_modules", "@nanonets", "graft")
      : null,
    "/usr/local/lib/node_modules/@nanonets/graft",
    "/usr/lib/node_modules/@nanonets/graft",
  ].filter(Boolean);
  const source = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "package.json")) &&
    fs.existsSync(path.join(candidate, "dist", "cli.js")),
  );
  if (!source) {
    fail(
      "@nanonets/graft 0.10.1 was not found. Install it globally or set " +
        "BREADBOARD_GRAFT_PACKAGE_ROOT before packaging.",
    );
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
  if (manifest.name !== "@nanonets/graft" || manifest.version !== "0.10.1") {
    fail(`Graft must be pinned to @nanonets/graft@0.10.1; found ${manifest.name ?? "unknown"}@${manifest.version ?? "unknown"}.`);
  }
  const target = path.join(stagingRoot, "graft");
  freshDir(target);
  for (const entry of ["package.json", "LICENSE"]) {
    fs.copyFileSync(path.join(source, entry), path.join(target, entry));
  }
  copyTree(path.join(source, "dist"), path.join(target, "dist"), (rel) => /\.map$/iu.test(rel));
  copyTree(path.join(source, "node_modules"), path.join(target, "node_modules"), (rel) =>
    /(^|\/)(?:test|tests|docs|examples|coverage)(\/|$)/iu.test(rel) || /\.map$/iu.test(rel),
  );
}

// OpenCode is a self-contained, source-built Windows executable. Its immutable
// receipt binds the shipped PE to the reviewed checkout and upstream package
// version; no bootstrap/downloader or first-run compilation is packaged.
log("staging pinned OpenCode runtime");
{
  const sourceRoot = path.join(repoRoot, "opencode");
  const sourceBinary = path.join(
    sourceRoot,
    "packages",
    "opencode",
    "dist",
    "opencode-windows-x64",
    "bin",
    "opencode.exe",
  );
  const packagePath = path.join(sourceRoot, "packages", "opencode", "package.json");
  const expected = {
    version: "1.18.8",
    upstreamCommit: "017a5977d2107092007623e507fc5c6eb337d3b2",
    sha256: "8E0B749456339916F1FF0CA7EBB77B42CDA2E2BA585285131CC7B067A08C49C6",
    size: 175_976_448,
  };
  if (!fs.existsSync(sourceBinary)) fail(`OpenCode runtime is missing: ${sourceBinary}`);
  const metadata = fs.lstatSync(sourceBinary);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail("OpenCode runtime must be a direct regular file.");
  }
  const packageManifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (packageManifest.version !== expected.version) {
    fail(`OpenCode package must be ${expected.version}; found ${packageManifest.version ?? "unknown"}.`);
  }
  const actualHash = await sha256File(sourceBinary);
  if (metadata.size !== expected.size || actualHash !== expected.sha256) {
    fail(
      `OpenCode runtime identity mismatch (size ${metadata.size}, sha256 ${actualHash}).`,
    );
  }
  const target = path.join(stagingRoot, "opencode");
  freshDir(target);
  fs.mkdirSync(path.join(target, "bin"), { recursive: true });
  fs.mkdirSync(path.join(target, "packages", "opencode"), { recursive: true });
  fs.copyFileSync(sourceBinary, path.join(target, "bin", "opencode.exe"));
  fs.copyFileSync(packagePath, path.join(target, "packages", "opencode", "package.json"));
  fs.copyFileSync(path.join(sourceRoot, "LICENSE"), path.join(target, "LICENSE"));
  fs.writeFileSync(
    path.join(target, "runtime-artifact.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      name: "opencode-windows-x64",
      version: expected.version,
      platform: "win32",
      architecture: "x64",
      upstreamCommit: expected.upstreamCommit,
      sha256: expected.sha256,
      size: expected.size,
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
  const configTarget = path.join(stagingRoot, "opencode-config");
  freshDir(configTarget);
  fs.copyFileSync(
    path.join(repoRoot, "opencode-config", "opencode.json"),
    path.join(configTarget, "opencode.json"),
  );
}

// Ruflo is a mandatory finite outer-agent planner. Materialize the exact
// lockfile-resolved @claude-flow/cli package and its non-optional production
// dependency graph into app-services. The installed app must never need npm,
// npx, a developer checkout, or a first-run download.
log("staging pinned Ruflo planner and Claude Code executor");
{
  const vendorRoot = path.join(desktopRoot, "runtime-v2", "vendor", "ruflo");
  const dependencyManifest = path.join(vendorRoot, "package.json");
  const dependencyLock = path.join(vendorRoot, "package-lock.json");
  const receiptPath = path.join(vendorRoot, "runtime-artifact.json");
  const wrapperSource = path.join(vendorRoot, "bin", "cli.js");
  for (const required of [dependencyManifest, dependencyLock, receiptPath, wrapperSource]) {
    if (!fs.existsSync(required)) fail(`Ruflo packaged-runtime input is missing: ${required}`);
  }
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  const expectedRuflo = receipt?.ruflo;
  const expectedClaude = receipt?.claudeCode;
  if (
    receipt?.schemaVersion !== 1 ||
    expectedRuflo?.package !== "@claude-flow/cli" ||
    expectedRuflo?.version !== "3.34.0" ||
    expectedRuflo?.reviewedCheckoutCommit !== "4ac1ab9ff3ee8f0406cfa97fe463944d9b110e9a" ||
    expectedClaude?.name !== "Claude Code" ||
    expectedClaude?.version !== "2.1.239" ||
    expectedClaude?.platform !== "win32" ||
    expectedClaude?.architecture !== "x64"
  ) {
    fail("Ruflo packaged-runtime receipt is not the reviewed Windows x64 identity.");
  }
  if (process.platform !== expectedClaude.platform || process.arch !== expectedClaude.architecture) {
    fail(
      `Ruflo's packaged Claude executor is pinned for ${expectedClaude.platform}/${expectedClaude.architecture}; ` +
        `the packaging host is ${process.platform}/${process.arch}.`,
    );
  }

  const sourceRoot = path.join(repoRoot, "ruflo");
  const sourceRevision = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualRevision = sourceRevision.status === 0 ? sourceRevision.stdout.trim() : "";
  if (actualRevision !== expectedRuflo.reviewedCheckoutCommit) {
    fail(
      `Ruflo checkout must be pinned to ${expectedRuflo.reviewedCheckoutCommit}; ` +
        `found ${actualRevision || "unknown"}.`,
    );
  }
  const sourceManifest = JSON.parse(
    fs.readFileSync(path.join(sourceRoot, "v3", "@claude-flow", "cli", "package.json"), "utf8"),
  );
  if (sourceManifest.name !== expectedRuflo.package || sourceManifest.version !== expectedRuflo.version) {
    fail(
      `Ruflo reviewed checkout identity mismatch; found ` +
        `${sourceManifest.name ?? "unknown"}@${sourceManifest.version ?? "unknown"}.`,
    );
  }
  const actualLockHash = await sha256File(dependencyLock);
  if (actualLockHash !== expectedRuflo.dependencyLockSha256) {
    fail(
      `Ruflo dependency lock must have SHA-256 ${expectedRuflo.dependencyLockSha256}; ` +
        `found ${actualLockHash}.`,
    );
  }
  const parsedLock = JSON.parse(fs.readFileSync(dependencyLock, "utf8"));
  const lockedCli = parsedLock?.packages?.["node_modules/@claude-flow/cli"];
  if (
    parsedLock?.lockfileVersion !== 3 ||
    lockedCli?.version !== expectedRuflo.version ||
    lockedCli?.integrity !== expectedRuflo.npmIntegrity
  ) {
    fail("Ruflo dependency lock does not pin the reviewed CLI archive exactly.");
  }

  const installRoot = path.join(os.tmpdir(), "breadboard-ruflo-runtime-install");
  freshDir(installRoot);
  for (const source of [dependencyManifest, dependencyLock]) {
    fs.copyFileSync(source, path.join(installRoot, path.basename(source)));
  }
  const npmCli = process.platform === "win32"
    ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    : null;
  if (npmCli && !fs.existsSync(npmCli)) {
    fail(`npm CLI was not found beside the active Node runtime: ${npmCli}`);
  }
  const npmCommand = npmCli ? process.execPath : "npm";
  const npmPrefix = npmCli ? [npmCli] : [];
  const install = spawnSync(
    npmCommand,
    [
      ...npmPrefix,
      "ci",
      "--omit=dev",
      "--omit=optional",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: installRoot, stdio: "inherit", shell: false },
  );
  if (install.status !== 0) fail("frozen Ruflo production dependency install failed");

  const installedModules = path.join(installRoot, "node_modules");
  const installedCli = path.join(installedModules, "@claude-flow", "cli");
  const cliManifest = JSON.parse(fs.readFileSync(path.join(installedCli, "package.json"), "utf8"));
  const cliEntrypoint = path.join(installedCli, "bin", "cli.js");
  const cliDistEntrypoint = path.join(installedCli, "dist", "src", "index.js");
  if (cliManifest.name !== expectedRuflo.package || cliManifest.version !== expectedRuflo.version) {
    fail("frozen Ruflo install resolved a different CLI identity");
  }
  for (const [filePath, expectedHash, label] of [
    [wrapperSource, expectedRuflo.wrapperSha256, "Runtime wrapper"],
    [cliEntrypoint, expectedRuflo.entrypointSha256, "entrypoint"],
    [cliDistEntrypoint, expectedRuflo.distEntrypointSha256, "dist entrypoint"],
  ]) {
    const actualHash = await sha256File(filePath);
    if (actualHash !== expectedHash) {
      fail(`Ruflo ${label} must have SHA-256 ${expectedHash}; found ${actualHash}.`);
    }
  }

  const target = path.join(stagingRoot, "ruflo");
  freshDir(target);
  fs.mkdirSync(path.join(target, "bin"), { recursive: true });
  fs.copyFileSync(dependencyManifest, path.join(target, "package.json"));
  fs.copyFileSync(wrapperSource, path.join(target, "bin", "cli.js"));
  // Preserve npm's package boundary verbatim. @claude-flow/cli includes three
  // bundled packages below its own node_modules; flattening them changes ESM
  // resolution and can select an incompatible top-level package.
  copyTree(installedModules, path.join(target, "node_modules"));
  fs.copyFileSync(receiptPath, path.join(target, "runtime-artifact.json"));
  fs.copyFileSync(dependencyLock, path.join(target, "BREADBOARD_DEPENDENCY_LOCK.json"));
  const sourceLicense = path.join(sourceRoot, "LICENSE");
  const licenseHash = await sha256File(sourceLicense);
  if (licenseHash !== expectedRuflo.licenseSha256) {
    fail(`Ruflo license must have SHA-256 ${expectedRuflo.licenseSha256}; found ${licenseHash}.`);
  }
  fs.copyFileSync(sourceLicense, path.join(target, "LICENSE"));
  fs.rmSync(installRoot, { recursive: true, force: true });

  const claudeTarget = path.join(desktopRoot, "resources", "bin", "claude.exe");
  const lookup = spawnSync("where.exe", ["claude.exe"], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  const candidates = [
    process.env.RUFLO_CLAUDE_BIN,
    claudeTarget,
    ...(lookup.status === 0 ? lookup.stdout.split(/\r?\n/u) : []),
  ]
    .map((candidate) => candidate?.trim())
    .filter(Boolean);
  let claudeSource = null;
  for (const candidate of [...new Set(candidates)]) {
    if (!fs.existsSync(candidate)) continue;
    const metadata = fs.lstatSync(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== expectedClaude.size) {
      continue;
    }
    if ((await sha256File(candidate)) === expectedClaude.sha256) {
      claudeSource = path.resolve(candidate);
      break;
    }
  }
  if (!claudeSource) {
    fail(
      `Claude Code ${expectedClaude.version} (${expectedClaude.sha256}) was not found. ` +
        "Install that exact official native build or set RUFLO_CLAUDE_BIN before packaging.",
    );
  }
  fs.mkdirSync(path.dirname(claudeTarget), { recursive: true });
  if (path.resolve(claudeSource) !== path.resolve(claudeTarget)) {
    fs.copyFileSync(claudeSource, claudeTarget);
  }
  fs.copyFileSync(receiptPath, path.join(path.dirname(claudeTarget), "claude-runtime-artifact.json"));
}

// The document-skill worker imports the vendored Python package and its
// validator from the immutable app layout. Optional parser dependencies remain
// optional; the clone's stdlib fallbacks preserve the existing behavior.
log("staging book-to-skill worker closure");
{
  const source = path.join(repoRoot, "book-to-skill");
  const target = path.join(stagingRoot, "book-to-skill");
  for (const required of [
    path.join(source, "book_to_skill", "utils.py"),
    path.join(source, "tools", "validate_skill.py"),
    path.join(source, "LICENSE.md"),
  ]) {
    if (!fs.existsSync(required)) fail(`book-to-skill worker dependency is missing: ${required}`);
  }
  freshDir(target);
  copyTree(path.join(source, "book_to_skill"), path.join(target, "book_to_skill"), (rel) =>
    /(^|\/)(__pycache__)(\/|$)/u.test(rel) || /\.(?:pyc|pyo)$/u.test(rel),
  );
  fs.mkdirSync(path.join(target, "tools"), { recursive: true });
  fs.copyFileSync(
    path.join(source, "tools", "validate_skill.py"),
    path.join(target, "tools", "validate_skill.py"),
  );
  fs.copyFileSync(path.join(source, "LICENSE.md"), path.join(target, "LICENSE.md"));
}

// Trading Agent's disposable Runtime worker executes the pinned Python source
// through a data-root virtual environment. Keep the source immutable and omit
// checkout, local-environment, and cache state from the installed closure.
log("staging TradingAgents immutable worker source");
{
  const source = path.join(repoRoot, "tradingagents");
  const target = path.join(stagingRoot, "tradingagents");
  const sourceCommit = assertPinnedCleanCheckout({
    label: "TradingAgents",
    sourceRoot: source,
    expectedCommit: REVIEWED_LOCAL_SOURCE_COMMITS.tradingAgents,
  });
  for (const required of [
    path.join(source, "pyproject.toml"),
    path.join(source, "tradingagents", "graph", "trading_graph.py"),
    path.join(source, "tradingagents", "default_config.py"),
    path.join(source, "LICENSE"),
  ]) {
    if (!fs.existsSync(required)) fail(`TradingAgents worker dependency is missing: ${required}`);
  }
  freshDir(target);
  copyTree(source, target, (relative) =>
    /(^|\/)(?:\.git|\.venv|\.runtime|\.pytest_cache|\.ruff_cache|__pycache__)(?:\/|$)/u.test(relative) ||
    /\.(?:pyc|pyo)$/u.test(relative),
  );
  writeSourceCommitReceipt(target, sourceCommit);
}

// OpenExecutive runs through the managed Python environment and ChatMock. Ship
// only its reviewed core package closure; the web UI, fixtures, checkout data,
// local configuration, and mutable company memory are not package inputs.
log("staging OpenExecutive immutable worker source");
await stagePinnedTrackedSourceClosure({
  label: "OpenExecutive",
  sourceRoot: path.join(repoRoot, "OpenExecutive"),
  targetRoot: path.join(stagingRoot, "OpenExecutive"),
  expectedCommit: REVIEWED_LOCAL_SOURCE_COMMITS.openExecutive,
  include: (relative) =>
    relative === "LICENSE" ||
    relative === "README.md" ||
    relative === "packages/core/README.md" ||
    relative === "packages/core/pyproject.toml" ||
    relative === "packages/core/uv.lock" ||
    relative.startsWith("packages/core/openexecutive/"),
  required: [
    "LICENSE",
    "README.md",
    "packages/core/README.md",
    "packages/core/pyproject.toml",
    "packages/core/uv.lock",
    "packages/core/openexecutive/orchestrator/executive.py",
  ],
});

// Career Ops setup copies this immutable seed into its durable data-root
// workspace. Dependencies and user state are deliberately never staged from
// the developer checkout.
log("staging Career Ops immutable setup source");
{
  const source = path.join(repoRoot, "career-ops");
  const target = path.join(stagingRoot, "career-ops");
  for (const required of [
    path.join(source, "doctor.mjs"),
    path.join(source, "modes"),
    path.join(source, ".agents", "skills", "career-ops", "SKILL.md"),
    path.join(source, "package.json"),
    path.join(source, "LICENSE"),
  ]) {
    if (!fs.existsSync(required)) fail(`Career Ops setup dependency is missing: ${required}`);
  }
  freshDir(target);
  copyTree(source, target, (relative) =>
    /(^|\/)(?:\.git|node_modules|\.runtime)(?:\/|$)/u.test(relative),
  );
}

// Agent Reach setup runs as an authenticated disposable Runtime job. Stage
// only the immutable Python source/version closure it copies into the user's
// Runtime data root; credentials and browser state are never packaged here.
log("staging Agent Reach immutable setup source");
{
  const source = path.join(repoRoot, "agent-reach");
  const target = path.join(stagingRoot, "agent-reach");
  const sourceCommit = assertPinnedCleanCheckout({
    label: "Agent Reach",
    sourceRoot: source,
    expectedCommit: REVIEWED_LOCAL_SOURCE_COMMITS.agentReach,
  });
  for (const required of [
    path.join(source, "pyproject.toml"),
    path.join(source, "uv.lock"),
    path.join(source, "README.md"),
    path.join(source, "LICENSE"),
    path.join(source, "agent_reach"),
  ]) {
    if (!fs.existsSync(required)) fail(`Agent Reach setup dependency is missing: ${required}`);
  }
  freshDir(target);
  for (const entry of ["pyproject.toml", "uv.lock", "README.md", "LICENSE"]) {
    fs.copyFileSync(path.join(source, entry), path.join(target, entry));
  }
  copyTree(path.join(source, "agent_reach"), path.join(target, "agent_reach"), (relative) =>
    /(^|\/)(?:__pycache__|\.pytest_cache)(?:\/|$)/u.test(relative) ||
    /\.(?:pyc|pyo)$/u.test(relative),
  );
  writeSourceCommitReceipt(target, sourceCommit);
}

// Repo-root marker so services that look for `<root>/dashboard` next to
// `<root>/hermes-config` recognize the staged layout.
fs.mkdirSync(path.join(stagingRoot, "dashboard"), { recursive: true });
fs.writeFileSync(
  path.join(stagingRoot, "dashboard", "README.txt"),
  "Marker directory. The dashboard server runs from dashboard-standalone/dashboard/server.js.\n",
);

// Runtime V2 manifests need appRoot-relative dashboard and finite-worker
// entrypoints in both source and installed layouts. The Learn adapter imports
// the already-staged worker source closure directly; it does not start a child,
// detach, or recreate the legacy IPC owner.
const runtimeV2DashboardScripts = path.join(stagingRoot, "dashboard", "scripts");
fs.mkdirSync(runtimeV2DashboardScripts, { recursive: true });
for (const entry of [
  "runtime-v2-dashboard.mjs",
  "runtime-v2-learn-worker.mjs",
  "runtime-v2-document-ingestion-worker.mjs",
  "runtime-v2-anydoc-pdf-worker.mjs",
  "runtime-v2-office-artifact-worker.mjs",
  "runtime-v2-agent-browser-worker.mjs",
  "runtime-v2-agent-browser-executor.mjs",
  "runtime-v2-quartz-publish-worker.mjs",
  "runtime-v2-quartz-publish-executor.mjs",
  "runtime-v2-quartz-static-service.mjs",
  "runtime-v2-background-worker.mjs",
  "runtime-v2-background-executor.mjs",
  "runtime-v2-gateway-http.mjs",
  "runtime-v2-telegram-gateway-service.mjs",
  "runtime-v2-whatsapp-gateway-service.mjs",
  "runtime-v2-agent-service.mjs",
  "runtime-v2-vlm-ocr-service.mjs",
  "runtime-v2-recall-install-worker.mjs",
  "runtime-v2-recall-install-executor.mjs",
  "runtime-v2-mem0-service.mjs",
  "runtime-v2-local-mcp-broker-service.mjs",
  "runtime-v2-cliproxy-service.mjs",
  "runtime-v2-inbox-zero-service.mjs",
  "runtime-v2-spotify-playback-service.mjs",
  "runtime-v2-solidworks-mcp-service.mjs",
  "runtime-v2-audio-analyzer-worker.mjs",
  "runtime-v2-image-search-worker.mjs",
  "runtime-v2-finite-mcp-worker-core.mjs",
  "runtime-v2-interactive-visualizer-worker.mjs",
  "runtime-v2-interactive-visualizer-executor.mjs",
  "runtime-v2-managed-python-service.mjs",
  "runtime-v2-managed-setup-worker.mjs",
  "runtime-v2-managed-setup-executor.mjs",
  "runtime-v2-terminal-command-worker.mjs",
  "runtime-v2-graft-index-worker.mjs",
  "runtime-v2-agent-edits-worker.mjs",
  "runtime-v2-agent-edits-executor.mjs",
  "runtime-v2-codex-worker.mjs",
  "runtime-v2-codex-probe-worker.mjs",
  "runtime-v2-ruflo-worker.mjs",
  "runtime-v2-deep-tutor-worker.mjs",
  "runtime-v2-opencode-worker.mjs",
  "runtime-v2-trading-agent-worker.mjs",
  "runtime-v2-career-ops-worker.mjs",
  "runtime-v2-openexecutive-worker.mjs",
  "runtime-v2-chatmock-login-worker.mjs",
  "runtime-v2-chatmock-login-executor.mjs",
  "runtime-v2-vimax-worker.mjs",
  "runtime-v2-vox-director-worker.mjs",
  "runtime-v2-cinema-agent-worker-core.mjs",
  "runtime-v2-cinema-agent-adapters.mjs",
  "runtime-v2-shorts-worker.mjs",
  "runtime-v2-open-gym-worker.mjs",
  "runtime-v2-agent-reach-setup-worker.mjs",
  "runtime-v2-agent-reach-setup-executor.mjs",
  "runtime-v2-agent-reach-configure.py",
  "runtime-v2-gbrain-sync-worker.mjs",
  "runtime-v2-thought-topology-worker.mjs",
  "runtime-v2-agent-reach-worker.mjs",
  "runtime-v2-praxist-worker.mjs",
  "runtime-v2-agent-tars-worker.mjs",
  "runtime-v2-legal-worker.mjs",
  "runtime-v2-sf3d-worker.mjs",
  "runtime-v2-openplanter-worker.mjs",
  "openplanter-chatmock-runner.py",
  "runtime-v2-manim-worker.mjs",
  "runtime-v2-deep-tutor-probe-worker.mjs",
  "runtime-v2-deep-tutor-index-worker.mjs",
  "runtime-v2-deep-tutor-maintenance-executor.mjs",
  "runtime-v2-premortem-worker.mjs",
  "runtime-v2-agent-loop-worker.mjs",
  "runtime-v2-omh-worker.mjs",
  "runtime-v2-factcheck-worker.mjs",
  "runtime-v2-watch-worker.mjs",
  "runtime-v2-watch-executor.mjs",
  "runtime-v2-loopx-worker.mjs",
  "runtime-v2-resource2skill-worker.mjs",
  "runtime-v2-career-ops-probe-worker.mjs",
  "runtime-v2-matraix-worker.mjs",
  "runtime-v2-matraix-probe-worker.mjs",
  "runtime-v2-formsmith-worker.mjs",
  "runtime-v2-formsmith-executor.mjs",
  "runtime-v2-hyperframes-worker.mjs",
  "runtime-v2-openmontage-worker.mjs",
  "runtime-v2-openmontage-probe-worker.mjs",
  "runtime-v2-bolt-slides-worker.mjs",
  "runtime-v2-legal-probe-worker.mjs",
  "runtime-v2-shorts-probe-worker.mjs",
  "runtime-v2-tradingagents-probe-worker.mjs",
  "runtime-v2-python-agent-probe-worker-core.mjs",
  "runtime-v2-subsai-transcription-worker.mjs",
  "runtime-v2-subsai-probe-worker.mjs",
  "runtime-v2-subsai-worker-layout.mjs",
  "runtime-v2-speech-media-worker.mjs",
  "runtime-v2-speech-media-executor.mjs",
  "runtime-v2-generated-visual-browser-worker.mjs",
  "runtime-v2-generated-visual-browser-executor.mjs",
  "runtime-v2-generated-visual-compiler-worker.mjs",
  "runtime-v2-generated-visual-compiler-executor.mjs",
  "runtime-v2-agent-browser-profile-worker.mjs",
  "runtime-v2-agent-browser-profile-executor.mjs",
  "runtime-v2-scriberr-worker.mjs",
  "runtime-v2-scriberr-executor.mjs",
  "runtime-v2-scriberr-import-hook.mjs",
  "runtime-v2-watermark-worker.mjs",
  "runtime-v2-hardware-blueprint-worker.mjs",
  "runtime-v2-get-doc-worker.mjs",
  "runtime-v2-get-doc-download-worker.mjs",
  "runtime-v2-meeting-notes-worker.mjs",
  "runtime-v2-inbox-zero-worker.mjs",
  "runtime-v2-socials-manager-worker.mjs",
  "runtime-v2-max-research-worker.mjs",
  "runtime-v2-wardrobe-worker.mjs",
  "runtime-v2-parametric-cad-worker.mjs",
  "runtime-v2-stock-analyst-worker.mjs",
  "runtime-v2-vibe-trading-worker.mjs",
  "runtime-v2-deer-flow-worker.mjs",
  "runtime-v2-money-printer-worker.mjs",
  "runtime-v2-video-use-worker.mjs",
  "runtime-v2-deep-research-worker.mjs",
  "runtime-v2-openscience-worker.mjs",
  "runtime-v2-openwork-worker.mjs",
  "runtime-v2-outer-agent-worker-core.mjs",
  "runtime-v2-outer-agent-adapters.mjs",
  "runtime-v2-system-location-worker.mjs",
  "runtime-v2-system-location-executor.mjs",
  "runtime-v2-worker-events.mjs",
  "vox_local.py",
  "book-to-skill-bridge.py",
  "learn-worker-import-hook.mjs",
]) {
  fs.copyFileSync(
    path.join(repoRoot, "dashboard", "scripts", entry),
    path.join(runtimeV2DashboardScripts, entry),
  );
}

// Postiz is an on-demand Runtime V2 service. Its coordinator runs under the
// Runtime-owned bundled Node process tree, so stage the small source closure
// it imports rather than duplicating the stack/bootstrap implementation.
log("staging Postiz desktop supervisor");
const scriptsTarget = path.join(stagingRoot, "scripts");
fs.mkdirSync(scriptsTarget, { recursive: true });
fs.copyFileSync(
  path.join(repoRoot, "scripts", "start-postiz-supervisor.mjs"),
  path.join(scriptsTarget, "start-postiz-supervisor.mjs"),
);
fs.copyFileSync(
  path.join(repoRoot, "scripts", "voicebox-status.mjs"),
  path.join(scriptsTarget, "voicebox-status.mjs"),
);
fs.copyFileSync(
  path.join(repoRoot, "scripts", "setup-comfyui.mjs"),
  path.join(scriptsTarget, "setup-comfyui.mjs"),
);
fs.copyFileSync(
  path.join(repoRoot, "scripts", "tradingagents-bridge.py"),
  path.join(scriptsTarget, "tradingagents-bridge.py"),
);
fs.copyFileSync(
  path.join(repoRoot, "scripts", "openexecutive-bridge.py"),
  path.join(scriptsTarget, "openexecutive-bridge.py"),
);
fs.copyFileSync(
  path.join(repoRoot, "scripts", "shorts-bridge.py"),
  path.join(scriptsTarget, "shorts-bridge.py"),
);
fs.copyFileSync(
  path.join(repoRoot, "scripts", "legal-bridge.py"),
  path.join(scriptsTarget, "legal-bridge.py"),
);
fs.copyFileSync(
  path.join(repoRoot, "scripts", "resource2skill-bridge.py"),
  path.join(scriptsTarget, "resource2skill-bridge.py"),
);
fs.copyFileSync(
  path.join(repoRoot, "scripts", "matraix-bridge.py"),
  path.join(scriptsTarget, "matraix-bridge.py"),
);
fs.copyFileSync(
  path.join(repoRoot, "scripts", "shaper-bridge.py"),
  path.join(runtimeV2DashboardScripts, "shaper-bridge.py"),
);
for (const entry of ["deeptutor-bridge.py", "deeptutor-files-mcp.mjs", "deeptutor-index.py"]) {
  fs.copyFileSync(
    path.join(repoRoot, "scripts", entry),
    path.join(scriptsTarget, entry),
  );
}
fs.copyFileSync(
  path.join(repoRoot, "dashboard", "scripts", "sf3d-bridge.py"),
  path.join(runtimeV2DashboardScripts, "sf3d-bridge.py"),
);
fs.copyFileSync(
  path.join(repoRoot, "scripts", "ifixai-background-runner.py"),
  path.join(scriptsTarget, "ifixai-background-runner.py"),
);

// iFixAi's package is installed into the bundled Python runtime. Preserve its
// upstream license and exact source revision beside the staged services.
{
  const ifixAiRoot = path.join(repoRoot, "iFixAi");
  const expected = "4ac9cc1c8765427300d98dc30855c18349610cf1";
  const revision = spawnSync("git", ["-C", ifixAiRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actual = revision.status === 0 ? revision.stdout.trim() : "";
  if (actual !== expected) {
    fail(`iFixAi checkout must be pinned to ${expected}; found ${actual || "unknown"}.`);
  }
  const target = path.join(stagingRoot, "ifixai");
  freshDir(target);
  fs.copyFileSync(path.join(ifixAiRoot, "LICENSE"), path.join(target, "LICENSE"));
  fs.writeFileSync(path.join(target, "BREADBOARD_UPSTREAM_COMMIT"), `${actual}\n`, "utf8");
}

const postizRuntimeTarget = path.join(stagingRoot, "dashboard", "src", "lib", "socials-manager");
fs.mkdirSync(postizRuntimeTarget, { recursive: true });
for (const entry of [
  "api-client.ts",
  "bootstrap.ts",
  "config.ts",
  "coordinator-core.ts",
  "coordinator-runtime.ts",
  "coordinator-server.ts",
  "docker.ts",
  "local-state.ts",
  "stack.ts",
]) {
  fs.copyFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "socials-manager", entry),
    path.join(postizRuntimeTarget, entry),
  );
}
fs.copyFileSync(
  path.join(repoRoot, "dashboard", "src", "lib", "runtime-paths.ts"),
  path.join(stagingRoot, "dashboard", "src", "lib", "runtime-paths.ts"),
);

const postizAppTarget = path.join(stagingRoot, "postiz-app");
{
  const expectedCommit = "cf4c432c00c9db775ea1b1f12480a8e2b89aec32";
  const vendorRoot = path.join(desktopRoot, "runtime-v2", "vendor", "postiz");
  const sourceRoot = path.join(vendorRoot, "source");
  const receiptPath = path.join(vendorRoot, "oci-images.json");
  const reviewed = loadReviewedOciReceipt(receiptPath, "Postiz", expectedCommit, "postiz");
  assertReviewedOciSource(sourceRoot, reviewed, "Postiz");
  const compose = pinComposeImages(
    fs.readFileSync(path.join(sourceRoot, "docker-compose.yaml"), "utf8"),
    reviewed,
    "Postiz",
  );
  freshDir(postizAppTarget);
  fs.writeFileSync(path.join(postizAppTarget, "docker-compose.yaml"), compose, "utf8");
  fs.copyFileSync(path.join(sourceRoot, "LICENSE"), path.join(postizAppTarget, "LICENSE"));
  fs.copyFileSync(receiptPath, path.join(postizAppTarget, "oci-images.json"));
  fs.writeFileSync(
    path.join(postizAppTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
  copyTree(
    path.join(sourceRoot, "dynamicconfig"),
    path.join(postizAppTarget, "dynamicconfig"),
  );
}

// Inbox Zero uses published images. Runtime needs only the immutable Compose
// authority and its upstream license; mutable overrides and credentials are
// written beneath the Runtime data root by the leased coordinator.
const inboxZeroTarget = path.join(stagingRoot, "inbox-zero");
{
  const expectedCommit = "0006bea20b141d7386d76d32a6e4551c8333dd59";
  const vendorRoot = path.join(desktopRoot, "runtime-v2", "vendor", "inbox-zero");
  const sourceRoot = path.join(vendorRoot, "source");
  const receiptPath = path.join(vendorRoot, "oci-images.json");
  const reviewed = loadReviewedOciReceipt(receiptPath, "Inbox Zero", expectedCommit, "inbox-zero");
  assertReviewedOciSource(sourceRoot, reviewed, "Inbox Zero");
  const compose = pinComposeImages(
    fs.readFileSync(path.join(sourceRoot, "docker-compose.yml"), "utf8"),
    reviewed,
    "Inbox Zero",
  );
  freshDir(inboxZeroTarget);
  fs.writeFileSync(path.join(inboxZeroTarget, "docker-compose.yml"), compose, "utf8");
  fs.copyFileSync(path.join(sourceRoot, "LICENSE"), path.join(inboxZeroTarget, "LICENSE"));
  fs.copyFileSync(receiptPath, path.join(inboxZeroTarget, "oci-images.json"));
  fs.writeFileSync(
    path.join(inboxZeroTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// The embedded broker uses Nango's open-source provider definitions and logos
// as static catalog data only. No Nango server, runtime, database, or secrets
// are bundled or started.
log("staging connected-app provider catalog");
const providerCatalogTarget = path.join(stagingRoot, "nango");
freshDir(providerCatalogTarget);
fs.mkdirSync(
  path.join(providerCatalogTarget, "packages", "providers"),
  { recursive: true },
);
copyTree(
  path.join(repoRoot, "nango", "packages", "providers", "providers.yaml"),
  path.join(providerCatalogTarget, "packages", "providers", "providers.yaml"),
);
fs.mkdirSync(
  path.join(
    providerCatalogTarget,
    "packages",
    "webapp",
    "public",
    "images",
  ),
  { recursive: true },
);
copyTree(
  path.join(
    repoRoot,
    "nango",
    "packages",
    "webapp",
    "public",
    "images",
    "template-logos",
  ),
  path.join(
    providerCatalogTarget,
    "packages",
    "webapp",
    "public",
    "images",
    "template-logos",
  ),
  (rel) => !rel.toLowerCase().endsWith(".svg"),
);

// --- chatmock -------------------------------------------------------------
log("staging chatmock");
freshDir(path.join(stagingRoot, "chatmock"));
copyTree(path.join(repoRoot, "chatmock"), path.join(stagingRoot, "chatmock"), (rel) =>
  /^(docker\/|Dockerfile|docker-compose|tests\/|chatmock\.egg-info\/|build\.py|gui\.py|__pycache__|\.git)/.test(rel) ||
  rel.includes("__pycache__") ||
  /(^|\/)\.venv(?:\/|$)/u.test(rel) ||
  /(^|\/)onnxruntime\/datasets(?:\/|$)/u.test(rel),
);

// --- unslop ---------------------------------------------------------------
// The writing skill ChatMock attaches to final, user-facing prose. It is read
// from disk at request time, and `council/unslop.py` finds it by walking up
// from its own module — so it has to sit beside chatmock/ here. Without this
// the packaged app silently answers without the skill while the dev repo
// (which has the sibling clone) looks fine.
log("staging unslop skill");
{
  const unslopSource = path.join(repoRoot, "unslop");
  if (!fs.existsSync(path.join(unslopSource, "SKILL.md"))) {
    fail("unslop/SKILL.md is missing; the packaged app would ship without the writing skill.");
  }
  const unslopTarget = path.join(stagingRoot, "unslop");
  freshDir(unslopTarget);
  copyTree(unslopSource, unslopTarget, (rel) =>
    /^(\.git|node_modules\/|__pycache__)/.test(rel) || rel.includes("__pycache__"),
  );
}

// --- watermarks-remover ---------------------------------------------------
// The Runtime V2 watermark worker receives this exact staged script root from
// native environment authority. Only the skill subtree ships: the clone's
// tests, Dockerfiles and CI are not read at runtime. Everything here is Python
// 3.10+ stdlib, so the bundled CPython runs it exactly as staged.
log("staging watermarks-remover scripts");
{
  const watermarksSource = path.join(repoRoot, "watermarks-remover");
  const sourceCommit = assertPinnedCleanCheckout({
    label: "Watermarks Remover",
    sourceRoot: watermarksSource,
    expectedCommit: REVIEWED_LOCAL_SOURCE_COMMITS.watermarks,
  });
  const watermarksSkill = path.join(watermarksSource, "skills", "remove-ai-marks");
  if (!fs.existsSync(path.join(watermarksSkill, "scripts", "clean_file.py"))) {
    fail(
      "watermarks-remover/skills/remove-ai-marks/scripts/clean_file.py is missing; " +
        "the packaged app would ship without the watermark tools.",
    );
  }
  const watermarksTarget = path.join(stagingRoot, "watermarks-remover", "skills", "remove-ai-marks");
  freshDir(path.join(stagingRoot, "watermarks-remover"));
  copyTree(watermarksSkill, watermarksTarget, (rel) =>
    /(^|\/)__pycache__(\/|$)/.test(rel) || /\.(pyc|pyo)$/.test(rel),
  );
  const watermarksLicense = path.join(watermarksSource, "LICENSE");
  if (!fs.existsSync(watermarksLicense)) {
    fail("watermarks-remover/LICENSE is missing; the packaged scripts need their upstream notice.");
  }
  fs.copyFileSync(watermarksLicense, path.join(stagingRoot, "watermarks-remover", "LICENSE"));
  const watermarksReceipt = path.join(watermarksSource, "BREADBOARD_UPSTREAM_COMMIT");
  if (!fs.existsSync(watermarksReceipt)) {
    fail("watermarks-remover/BREADBOARD_UPSTREAM_COMMIT is missing; the packaged scripts are not pinned.");
  }
  fs.copyFileSync(
    watermarksReceipt,
    path.join(stagingRoot, "watermarks-remover", "BREADBOARD_UPSTREAM_COMMIT"),
  );
  writeSourceCommitReceipt(path.join(stagingRoot, "watermarks-remover"), sourceCommit);
}

// --- loopx ----------------------------------------------------------------
// The control plane that governs long-running Hermes conversations. Only the
// Python package ships: the docs, the presentation app, and the regression
// fixtures are not read at runtime. LoopX declares no third-party dependencies,
// so the bundled CPython runs it as staged (see BREADBOARD_LOOPX_PYTHON in
// service-definitions.ts).
log("staging loopx control plane");
{
  const loopxSource = path.join(repoRoot, "loopx", "loopx");
  if (!fs.existsSync(path.join(loopxSource, "entrypoint.py"))) {
    fail("loopx/loopx/entrypoint.py is missing; the packaged app would ship without the control plane.");
  }
  const loopxTarget = path.join(stagingRoot, "loopx", "loopx");
  freshDir(path.join(stagingRoot, "loopx"));
  copyTree(loopxSource, loopxTarget, (rel) =>
    /(^|\/)(__pycache__|tests?)(\/|$)/.test(rel) || /\.(pyc|pyo)$/.test(rel),
  );
}

// --- goal -----------------------------------------------------------------
// Goal Mode consumes Goal's upstream continuation contract and persists its
// compatible state through Breadboard's conversation-scoped bridge. Only the
// MIT-licensed template and attribution ship; the Python MCP process is not
// launched in an installed app because one stdio process cannot safely own
// state for multiple Breadboard conversations.
log("staging Goal Mode contract");
{
  const goalSource = path.join(repoRoot, "goal");
  const continuationSource = path.join(goalSource, "src", "templates", "continuation.md");
  const licenseSource = path.join(goalSource, "LICENSE");
  if (!fs.existsSync(continuationSource) || !fs.existsSync(licenseSource)) {
    fail("goal/src/templates/continuation.md and goal/LICENSE are required for Goal Mode.");
  }
  const goalTarget = path.join(stagingRoot, "goal");
  freshDir(goalTarget);
  copyTree(
    path.join(goalSource, "src", "templates"),
    path.join(goalTarget, "templates"),
  );
  fs.copyFileSync(licenseSource, path.join(goalTarget, "LICENSE"));
  const revision = spawnSync("git", ["-C", goalSource, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  fs.writeFileSync(
    path.join(goalTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${revision.status === 0 ? revision.stdout.trim() : "unversioned"}\n`,
    "utf8",
  );
}

// --- Agency Agents -------------------------------------------------------
// Breadboard reads these Markdown personas directly at request time. Stage
// only the division catalog and its agent files: examples, contribution docs,
// and repository automation are not runtime dependencies.
log("staging Agency Agents persona catalog");
{
  const agencySource = path.join(repoRoot, "agency-agents");
  const divisionsSource = path.join(agencySource, "divisions.json");
  const licenseSource = path.join(agencySource, "LICENSE");
  if (!fs.existsSync(divisionsSource) || !fs.existsSync(licenseSource)) {
    fail("agency-agents checkout is incomplete; divisions.json and LICENSE are required.");
  }
  const parsed = JSON.parse(fs.readFileSync(divisionsSource, "utf8"));
  const divisions = Object.keys(parsed?.divisions ?? {});
  if (divisions.length === 0 || divisions.some((name) => !/^[a-z0-9-]+$/.test(name))) {
    fail("agency-agents/divisions.json contains no valid division directories.");
  }

  const agencyTarget = path.join(stagingRoot, "agency-agents");
  freshDir(agencyTarget);
  fs.copyFileSync(divisionsSource, path.join(agencyTarget, "divisions.json"));
  fs.copyFileSync(licenseSource, path.join(agencyTarget, "LICENSE"));
  for (const division of divisions) {
    const source = path.join(agencySource, division);
    if (!fs.existsSync(source)) {
      fail(`Agency Agents division is missing: ${division}`);
    }
    copyTree(source, path.join(agencyTarget, division), (rel) => {
      const entry = path.join(source, ...rel.split("/"));
      return fs.statSync(entry).isFile() && !rel.toLowerCase().endsWith(".md");
    });
  }
}

// --- meta-prompting -------------------------------------------------------
// The paper's prompt assets, which lib/hermes/meta-prompting.ts parses at
// request time to build each turn's scaffold. Only the prompt files ship: the
// clone's Math/data corpus is ~40 MB of benchmark JSON that nothing reads.
// Without this the packaged app falls back to the embedded structures while the
// dev repo (which has the sibling clone) looks fine, exactly as unslop did.
log("staging meta-prompting prompts");
{
  const metaSource = path.join(repoRoot, "meta-prompting");
  const metaFiles = [
    ["prompts", "cr-agent-assistant-v0.1.md"],
    ["prompts", "mp-icpd-v0.2.md"],
    ["prompts", "mp-pt-reasoning-v0.1.md"],
    ["prompts", "mp-pt-concise-v0.1.md"],
    ["Math", "prompts", "mp", "math.md"],
  ];
  const metaTarget = path.join(stagingRoot, "meta-prompting");
  freshDir(metaTarget);
  for (const parts of metaFiles) {
    const source = path.join(metaSource, ...parts);
    if (!fs.existsSync(source)) {
      fail(
        `meta-prompting/${parts.join("/")} is missing; the packaged app would ship without the meta prompt structures.`,
      );
    }
    const target = path.join(metaTarget, ...parts);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

// --- hermes-config --------------------------------------------------------
log("staging hermes-config");
freshDir(path.join(stagingRoot, "hermes-config"));
copyTree(path.join(repoRoot, "hermes-config"), path.join(stagingRoot, "hermes-config"));

// --- Breadboard first-party skills ---------------------------------------
// These are immutable product capabilities, distinct from the user's mutable
// approved/quarantine stores under app data.
log("staging Breadboard first-party skills");
const firstPartySkillsTarget = path.join(stagingRoot, "hermes-skills", "prebuilt");
freshDir(firstPartySkillsTarget);
copyTree(
  path.join(repoRoot, "hermes-skills", "prebuilt"),
  firstPartySkillsTarget,
);

// --- Patent Disclosure reviewed guidance closure -------------------------
// The skill's model-facing procedure needs the routed prompts and schemas, not
// an implicit shell. Stage only text guidance from the pinned independent
// checkout; Python tools, package installers, images and mutable outputs stay
// outside the installed application.
await stagePinnedTrackedSourceClosure({
  label: "Patent Disclosure skill",
  sourceRoot: path.join(repoRoot, "patent-disclosure-skill"),
  targetRoot: path.join(stagingRoot, "patent-disclosure-skill"),
  expectedCommit: PATENT_DISCLOSURE_UPSTREAM_COMMIT,
  allowVendoredSnapshot: true,
  include: isPatentDisclosurePackageFile,
  required: PATENT_DISCLOSURE_REQUIRED_FILES,
});

// --- scientific-agent-skills ---------------------------------------------
{
  const revision = spawnSync("git", ["-C", scientificSkillsRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actual = revision.status === 0 ? revision.stdout.trim() : "";
  if (actual !== SCIENTIFIC_SKILLS_UPSTREAM_COMMIT) {
    fail(
      `Scientific skills checkout must be pinned to ${SCIENTIFIC_SKILLS_UPSTREAM_COMMIT}; found ${actual || "unknown"}.`,
    );
  }
  log(`staging scientific-agent-skills ${actual.slice(0, 12)} source closure`);
  const target = path.join(stagingRoot, "scientific-agent-skills");
  freshDir(target);
  copyTree(path.join(scientificSkillsRoot, "skills"), path.join(target, "skills"));
  fs.copyFileSync(path.join(scientificSkillsRoot, "LICENSE.md"), path.join(target, "LICENSE.md"));
  fs.writeFileSync(path.join(target, "BREADBOARD_UPSTREAM_COMMIT"), `${actual}\n`, "utf8");
}

// --- ARIS autonomous research agent --------------------------------------
// ARIS is a Markdown methodology and helper collection rather than a daemon.
// Stage the source closure Bread uses to assemble its per-turn research persona
// so installed builds behave exactly like the cloned development checkout.
{
  const arisRoot = path.join(repoRoot, "auto-claude-code-research-in-sleep");
  const arisTarget = path.join(stagingRoot, "auto-claude-code-research-in-sleep");
  const required = ["AGENT_GUIDE.md", "skills", "tools", "templates", "LICENSE"];
  for (const entry of required) {
    if (!fs.existsSync(path.join(arisRoot, entry))) {
      fail(`ARIS checkout is incomplete; missing ${path.join(arisRoot, entry)}`);
    }
  }
  const revision = spawnSync("git", ["-C", arisRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actual = revision.status === 0 ? revision.stdout.trim() : "unknown";
  log(`staging ARIS ${actual.slice(0, 12)} research source closure`);
  freshDir(arisTarget);
  fs.copyFileSync(path.join(arisRoot, "AGENT_GUIDE.md"), path.join(arisTarget, "AGENT_GUIDE.md"));
  fs.copyFileSync(path.join(arisRoot, "LICENSE"), path.join(arisTarget, "LICENSE"));
  for (const entry of ["skills", "tools", "templates", "mcp-servers"]) {
    const source = path.join(arisRoot, entry);
    if (!fs.existsSync(source)) continue;
    copyTree(source, path.join(arisTarget, entry), (rel) =>
      /(^|\/)(__pycache__|\.pytest_cache)(\/|$)/.test(rel) ||
      /\.(pyc|pyo)$/.test(rel),
    );
  }
  fs.writeFileSync(path.join(arisTarget, "BREADBOARD_UPSTREAM_COMMIT"), `${actual}\n`, "utf8");
}

// --- hermes-agent ---------------------------------------------------------
// Stage the pinned, minimal Python source closure. Dependencies are installed
// from Hermes's frozen uv.lock into the bundled CPython 3.13 runtime by
// prepare-runtimes.mjs. Keeping source outside the runtime makes the maintained
// Breadboard gateway patch and Breadboard plugin explicit and inspectable.
{
  const revision = spawnSync("git", ["-C", hermesRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actual = revision.status === 0 ? revision.stdout.trim() : "";
  if (actual !== HERMES_UPSTREAM_COMMIT) {
    fail(
      `Hermes checkout must be pinned to ${HERMES_UPSTREAM_COMMIT}; found ${actual || "unknown"}.`,
    );
  }
  const status = spawnSync(
    "git",
    ["-C", hermesRoot, "status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8", shell: false },
  );
  if (status.status !== 0 || status.stdout.trim() !== "") {
    fail("Hermes checkout must be fully clean before its pinned source closure is staged.");
  }
  log(`staging Hermes Agent ${actual.slice(0, 12)} source closure`);
  const hermesTarget = path.join(stagingRoot, "hermes-agent");
  freshDir(hermesTarget);
  const packageDirs = [
    "agent",
    "tools",
    "hermes_cli",
    "gateway",
    "tui_gateway",
    "cron",
    "acp_adapter",
    "plugins",
    "providers",
  ];
  for (const entry of packageDirs) {
    const source = path.join(hermesRoot, entry);
    if (!fs.existsSync(source)) fail(`Hermes package missing: ${source}`);
    copyTree(source, path.join(hermesTarget, entry), (rel) =>
      /(^|\/)(__pycache__|tests?)(\/|$)/.test(rel) ||
      /\.(pyc|pyo)$/.test(rel),
    );
  }
  const rootModules = [
    "breadboard_runtime.py",
    "run_agent.py",
    "model_tools.py",
    "toolsets.py",
    "batch_runner.py",
    "trajectory_compressor.py",
    "toolset_distributions.py",
    "cli.py",
    "hermes_bootstrap.py",
    "hermes_constants.py",
    "hermes_state.py",
    "hermes_time.py",
    "hermes_logging.py",
    "utils.py",
    "mcp_serve.py",
    "pyproject.toml",
    "uv.lock",
    "LICENSE",
  ];
  for (const entry of rootModules) {
    const source = path.join(hermesRoot, entry);
    if (!fs.existsSync(source)) fail(`Hermes runtime file missing: ${source}`);
    fs.copyFileSync(source, path.join(hermesTarget, entry));
  }
  fs.writeFileSync(
    path.join(hermesTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${actual}\n`,
    "utf8",
  );

  // Hermes's Baileys WhatsApp bridge. The Runtime V2 WhatsApp gateway service
  // owns this Node child tree, so it must ship with its production dependencies
  // already installed — the bundled Node runtime is node.exe alone, with no npm
  // available to mutate an installed application on first use.
  const bridgeSource = path.join(hermesRoot, "scripts", "whatsapp-bridge");
  if (!fs.existsSync(bridgeSource)) fail(`Hermes WhatsApp bridge missing: ${bridgeSource}`);
  log("staging Hermes WhatsApp bridge and production dependencies");
  const bridgeTarget = path.join(hermesTarget, "scripts", "whatsapp-bridge");
  freshDir(bridgeTarget);
  copyTree(bridgeSource, bridgeTarget, (rel) =>
    /(^|\/)node_modules(\/|$)/.test(rel) || /\.test\.(mjs|js)$/.test(rel),
  );
  installProductionDependencies({
    label: "hermes whatsapp-bridge",
    target: bridgeTarget,
    tempName: "breadboard-whatsapp-bridge-install",
    // The bridge ships a lockfile but no `npm ci` guarantee across Hermes bumps;
    // `install` keeps packaging working when the lockfile drifts from the manifest.
    command: "install",
  });
}

// --- quartz template (program files only; content/public are user data) ---
log("staging quartz template");
const quartzTarget = path.join(stagingRoot, "quartz-template");
freshDir(quartzTarget);
for (const entry of [
  "quartz",
  "node_modules",
  "package.json",
  "package-lock.json",
  "quartz.config.ts",
  "quartz.layout.ts",
  "tsconfig.json",
  "globals.d.ts",
  "index.d.ts",
]) {
  const source = path.join(repoRoot, "quartz", entry);
  if (!fs.existsSync(source)) continue;
  copyTree(source, path.join(quartzTarget, entry), (rel) => rel.startsWith(".git"));
}

// --- scriberr (compose only, optional Docker compatibility mode) ----------
log("staging scriberr compose file");
freshDir(path.join(stagingRoot, "scriberr"));
fs.copyFileSync(
  path.join(repoRoot, "scriberr", "docker-compose.yml"),
  path.join(stagingRoot, "scriberr", "docker-compose.yml"),
);

// --- openGym catalogue ----------------------------------------------------
// openGym's fresh Runtime V2 worker needs only the compact immutable catalogue;
// animations are loaded from a local data-root cache when present and otherwise
// fetched from the dataset's pinned CDN revision.
{
  const openGymRoot = path.join(repoRoot, "openGym");
  const openGymTarget = path.join(stagingRoot, "openGym");
  const catalogue = path.join(openGymRoot, "frontend", "src", "lib", "exercises-data.js");
  if (!fs.existsSync(catalogue)) fail(`openGym catalogue not found: ${catalogue}`);
  log("staging openGym exercise catalogue");
  freshDir(openGymTarget);
  const catalogueTarget = path.join(openGymTarget, "frontend", "src", "lib");
  fs.mkdirSync(catalogueTarget, { recursive: true });
  fs.copyFileSync(catalogue, path.join(catalogueTarget, "exercises-data.js"));
  for (const notice of ["LICENSE", "NOTICE.md", "README.md"]) {
    const source = path.join(openGymRoot, notice);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(openGymTarget, notice));
  }
}

// --- Shorts immutable Python source --------------------------------------
// Authenticated setup builds the mutable venv below the Runtime data root. A
// disposable run reads this fixed source and keeps downloads/model caches out
// of Program Files.
{
  const shortsSource = path.join(repoRoot, "AI-Youtube-Shorts-Generator");
  const shortsTarget = path.join(stagingRoot, "AI-Youtube-Shorts-Generator");
  for (const required of [
    path.join(shortsSource, "main.py"),
    path.join(shortsSource, "shorts_generator", "pipeline.py"),
    path.join(shortsSource, "shorts_generator", "local", "clipper.py"),
    path.join(shortsSource, "requirements-local.txt"),
  ]) {
    if (!fs.existsSync(required)) fail(`Shorts worker dependency is missing: ${required}`);
  }
  log("staging Shorts immutable worker source");
  freshDir(shortsTarget);
  copyTree(shortsSource, shortsTarget, (relative) =>
    /(^|\/)(?:\.git|\.claude|\.venv|\.runtime|__pycache__)(?:\/|$)/u.test(relative) ||
    /(^|\/)\.env(?:\.|$)/u.test(relative) ||
    /\.(?:pyc|pyo)$/u.test(relative),
  );
}

// --- Premortem pinned Python closure -------------------------------------
// The bundled Python runtime cannot use the source checkout's venv launcher,
// so stage the reviewed package plus its pure/native site-packages closure.
// Cache files and local interpreter state never enter the application image.
{
  const premortemSource = path.join(repoRoot, "premortem");
  const premortemTarget = path.join(stagingRoot, "premortem-runtime");
  const expectedCommit = "724247b820e2bab3613e1055d990ee0efc963a83";
  const revision = spawnSync("git", ["-C", premortemSource, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`Premortem checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const sitePackagesSource = path.join(premortemSource, ".venv", "Lib", "site-packages");
  if (!fs.existsSync(path.join(sitePackagesSource, "typer", "__init__.py"))) {
    fail(`Premortem staged dependency closure is missing Typer: ${sitePackagesSource}`);
  }
  freshDir(premortemTarget);
  const sourceTarget = path.join(premortemTarget, "source");
  fs.mkdirSync(sourceTarget, { recursive: true });
  for (const relative of ["pyproject.toml", "README.md"]) {
    fs.copyFileSync(path.join(premortemSource, relative), path.join(sourceTarget, relative));
  }
  copyTree(path.join(premortemSource, "premortem"), path.join(sourceTarget, "premortem"), (relative) =>
    /(^|\/)(?:__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(relative) ||
    /\.(?:pyc|pyo)$/u.test(relative),
  );
  copyTree(sitePackagesSource, path.join(premortemTarget, "site-packages"), (relative) =>
    /(^|\/)(?:__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(relative) ||
    /\.(?:pyc|pyo)$/u.test(relative),
  );
  fs.writeFileSync(
    path.join(premortemTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- Agent Loop pinned Python 3.12 closure -------------------------------
// This worker's native wheels are CPython 3.12-specific. Stage the exact uv
// interpreter base and the reviewed venv site-packages rather than falling
// back to the application's Python 3.13 runtime or a user-global install.
{
  const agentLoopSource = path.join(repoRoot, "agent-loop-engineering-kit");
  const agentLoopTarget = path.join(stagingRoot, "agent-loop-runtime");
  const expectedCommit = "d8c814e9259824ee57018d2b6fde88b2dc5840d2";
  const expectedPythonVersion = "Python 3.12.13";
  const expectedPythonHash = "4F461F0C0DE64E82EB54FBCED0FD1D678D79D34EDA38660B07781E2BBA8064D6";
  const revision = spawnSync("git", ["-C", agentLoopSource, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`Agent Loop checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const pythonSource = path.resolve(
    process.env.BREADBOARD_AGENT_LOOP_PYTHON_ROOT ??
      path.join(process.env.APPDATA ?? "", "uv", "python", "cpython-3.12-windows-x86_64-none"),
  );
  const pythonExecutable = path.join(pythonSource, "python.exe");
  const version = spawnSync(pythonExecutable, ["--version"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  const actualVersion = `${version.stdout ?? ""}${version.stderr ?? ""}`.trim();
  if (version.status !== 0 || actualVersion !== expectedPythonVersion) {
    fail(`Agent Loop requires ${expectedPythonVersion}; found ${actualVersion || "unavailable"}.`);
  }
  const actualPythonHash = await sha256File(pythonExecutable);
  if (actualPythonHash !== expectedPythonHash) {
    fail(`Agent Loop Python executable identity mismatch: ${actualPythonHash}.`);
  }
  const sitePackagesSource = path.join(agentLoopSource, ".venv", "Lib", "site-packages");
  for (const required of [
    path.join(agentLoopSource, "hermes_loop", "cli.py"),
    path.join(sitePackagesSource, "yaml", "__init__.py"),
    path.join(sitePackagesSource, "rpds", "rpds.cp312-win_amd64.pyd"),
  ]) {
    if (!fs.existsSync(required)) fail(`Agent Loop runtime dependency is missing: ${required}`);
  }
  freshDir(agentLoopTarget);
  const sourceTarget = path.join(agentLoopTarget, "source");
  copyTree(agentLoopSource, sourceTarget, (relative) =>
    /(^|\/)(?:\.git|\.github|\.venv|tests|smoke-tests|docs|examples|receipts|__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(relative) ||
    /\.(?:pyc|pyo)$/u.test(relative),
  );
  copyTree(pythonSource, path.join(agentLoopTarget, "python"), (relative) =>
    /(^|\/)(?:__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(relative) ||
    /\.(?:pyc|pyo)$/u.test(relative),
  );
  copyTree(sitePackagesSource, path.join(agentLoopTarget, "site-packages"), (relative) =>
    /(^|\/)(?:__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(relative) ||
    /\.(?:pyc|pyo)$/u.test(relative),
  );
  fs.writeFileSync(
    path.join(agentLoopTarget, "runtime-artifact.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      upstreamCommit: expectedCommit,
      pythonVersion: expectedPythonVersion,
      pythonSha256: expectedPythonHash,
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
  fs.writeFileSync(
    path.join(agentLoopTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- Oh My Hermes pinned zero-dependency source --------------------------
// OMH executes from its immutable `src/` tree with the bundled Python. Copy
// only Git-tracked direct files so local virtualenvs, caches, generated output,
// and developer-only untracked material can never enter the installed image.
{
  const omhSource = path.join(repoRoot, "oh-my-hermes");
  const omhTarget = path.join(stagingRoot, "oh-my-hermes");
  const expectedCommit = "080030ccef0d3c15123a3f7478b671a0d2ddcf22";
  const revision = spawnSync("git", ["-C", omhSource, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`Oh My Hermes checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const status = spawnSync("git", ["-C", omhSource, "status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
    shell: false,
  });
  if (status.status !== 0 || status.stdout.trim()) {
    fail("Oh My Hermes tracked checkout must be clean before packaging.");
  }
  const listing = spawnSync("git", ["-C", omhSource, "ls-files", "-z"], {
    encoding: "utf8",
    shell: false,
  });
  if (listing.status !== 0) fail("Could not enumerate the tracked Oh My Hermes source closure.");
  freshDir(omhTarget);
  for (const relative of listing.stdout.split("\0").filter(Boolean)) {
    const portable = relative.replaceAll("\\", "/");
    if (
      portable !== "pyproject.toml" &&
      portable !== "LICENSE" &&
      portable !== "README.md" &&
      !portable.startsWith("src/")
    ) continue;
    if (
      /(^|\/)(?:\.git|\.venv|__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(portable) ||
      /\.(?:pyc|pyo)$/u.test(portable)
    ) continue;
    const source = path.resolve(omhSource, ...portable.split("/"));
    const target = path.resolve(omhTarget, ...portable.split("/"));
    const sourceRelative = path.relative(omhSource, source);
    const targetRelative = path.relative(omhTarget, target);
    if (
      sourceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(sourceRelative) ||
      targetRelative.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelative)
    ) fail(`Oh My Hermes tracked path escapes its root: ${relative}`);
    const metadata = fs.lstatSync(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`Oh My Hermes tracked source must be a direct regular file: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const required of ["pyproject.toml", "LICENSE", "src/omh/__init__.py", "src/omh/cli/__main__.py"]) {
    const staged = path.join(omhTarget, ...required.split("/"));
    if (!fs.existsSync(staged)) fail(`Oh My Hermes staged source is incomplete: ${required}`);
  }
  fs.writeFileSync(
    path.join(omhTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- Factcheck pinned script closure -------------------------------------
// The worker invokes the fixed packaged uv and bundled Python directly. Only
// the reviewed scripts/reference files are staged; no checkout venv, model
// credential, or mutable workspace state is packaged.
{
  const factcheckSource = path.join(repoRoot, "bullshit-detector");
  const factcheckTarget = path.join(stagingRoot, "bullshit-detector");
  const expectedCommit = "7b8fac1857eba19d25665825793dfbaf0414c6bf";
  const revision = spawnSync("git", ["-C", factcheckSource, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`Factcheck checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const status = spawnSync("git", ["-C", factcheckSource, "status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
    shell: false,
  });
  if (status.status !== 0 || status.stdout.trim()) {
    fail("Factcheck tracked checkout must be clean before packaging.");
  }
  const files = [
    "LICENSE",
    "skills/ingestion/fetch-content/scripts/fetch.py",
    "skills/ingestion/coverage-check/scripts/coverage.py",
    "skills/analysis/bullshit-detector/scripts/tally.py",
    "skills/analysis/bullshit-detector/scripts/retractions.py",
    "skills/analysis/bullshit-detector/RUBRIC.md",
    "skills/analysis/bullshit-detector/CLAIMS.md",
    "skills/analysis/bullshit-detector/RUN-RECORD.md",
  ];
  freshDir(factcheckTarget);
  for (const relative of files) {
    const source = path.join(factcheckSource, ...relative.split("/"));
    if (!fs.existsSync(source)) fail(`Factcheck worker dependency is missing: ${source}`);
    const metadata = fs.lstatSync(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`Factcheck worker dependency must be a direct regular file: ${source}`);
    }
    const target = path.join(factcheckTarget, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  fs.writeFileSync(
    path.join(factcheckTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- LoopX pinned zero-dependency source ---------------------------------
// The deterministic post-turn worker executes the reviewed Python package
// directly with the bundled interpreter. Durable goals live only below the
// Runtime data root; tests, environments, and caches never enter Program Files.
{
  const loopxSource = path.join(repoRoot, "loopx");
  const loopxTarget = path.join(stagingRoot, "LoopX");
  const expectedCommit = "924213b86ba7788bdb83ebecab9569ec6cd79b41";
  const revision = spawnSync("git", ["-C", loopxSource, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`LoopX checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const status = spawnSync("git", ["-C", loopxSource, "status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
    shell: false,
  });
  if (status.status !== 0 || status.stdout.trim()) {
    fail("LoopX tracked checkout must be clean before packaging.");
  }
  freshDir(loopxTarget);
  for (const relative of ["pyproject.toml", "README.md", "LICENSE"]) {
    const source = path.join(loopxSource, relative);
    if (!fs.existsSync(source)) fail(`LoopX worker dependency is missing: ${source}`);
    fs.copyFileSync(source, path.join(loopxTarget, relative));
  }
  copyTree(path.join(loopxSource, "loopx"), path.join(loopxTarget, "loopx"), (relative) =>
    /(^|\/)(?:__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(relative) ||
    /\.(?:pyc|pyo)$/u.test(relative),
  );
  fs.writeFileSync(
    path.join(loopxTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- Legal Agent pinned Harvey LAB closure -------------------------------
// The disposable Legal worker receives only the reviewed local OpenAI adapter,
// document skills, and parser/sandbox code. Evaluation tasks, provider
// adapters, tests, documentation, environments, and mutable state stay out of
// the installed application.
{
  const legalSource = path.join(repoRoot, "harvey-labs");
  const legalTarget = path.join(stagingRoot, "harvey-labs");
  const expectedCommit = "55510f0e609ffa5cf6f5df17d9a813ce4bb33d0c";
  const revision = spawnSync("git", ["-C", legalSource, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`Harvey LAB checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const files = [
    "LICENSE",
    "pyproject.toml",
    "uv.lock",
    "harness/__init__.py",
    "harness/agent_loop.py",
    "harness/tools.py",
    "harness/system_prompt.md",
    "harness/adapters/__init__.py",
    "harness/adapters/base.py",
    "harness/adapters/openai.py",
    "sandbox/__init__.py",
    "sandbox/sandbox.py",
    "sandbox/parsers/parse_doc.py",
  ];
  freshDir(legalTarget);
  for (const relative of files) {
    const source = path.join(legalSource, ...relative.split("/"));
    if (!fs.existsSync(source)) fail(`Legal worker dependency is missing: ${source}`);
    const target = path.join(legalTarget, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const skill of ["docx", "xlsx", "pptx"]) {
    const source = path.join(legalSource, "harness", "skills", skill);
    const target = path.join(legalTarget, "harness", "skills", skill);
    if (!fs.existsSync(path.join(source, "SKILL.md")) || !fs.existsSync(path.join(source, "scripts"))) {
      fail(`Legal ${skill} skill closure is incomplete: ${source}`);
    }
    copyTree(source, target, (relative) =>
      /(^|\/)(?:__pycache__|\.pytest_cache)(?:\/|$)/u.test(relative) ||
      /\.(?:pyc|pyo)$/u.test(relative),
    );
  }
  fs.writeFileSync(
    path.join(legalTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- SF3D pinned reconstruction closure ----------------------------------
// Model weights and caches live under Runtime data; the installed app carries
// only the immutable reconstruction source needed by the sealed worker.
{
  const sf3dSource = path.join(repoRoot, "stable-fast-3d");
  const sf3dTarget = path.join(stagingRoot, "stable-fast-3d");
  const expectedCommit = "ff21fc491b4dc5314bf6734c7c0dabd86b5f5bb2";
  const revision = spawnSync("git", ["-C", sf3dSource, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`Stable Fast 3D checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  freshDir(sf3dTarget);
  for (const relative of ["__init__.py", "LICENSE.md", "README.md", "requirements.txt"]) {
    const source = path.join(sf3dSource, relative);
    if (!fs.existsSync(source)) fail(`SF3D worker dependency is missing: ${source}`);
    fs.copyFileSync(source, path.join(sf3dTarget, relative));
  }
  for (const directory of ["sf3d", "texture_baker", "uv_unwrapper"]) {
    const source = path.join(sf3dSource, directory);
    const target = path.join(sf3dTarget, directory);
    if (!fs.existsSync(source)) fail(`SF3D source directory is missing: ${source}`);
    copyTree(source, target, (relative) =>
      /(^|\/)(?:__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(relative) ||
      /\.(?:pyc|pyo)$/u.test(relative),
    );
  }
  fs.writeFileSync(
    path.join(sf3dTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// SolidWorks source is staged with the fixed packaged Python services below so
// its upstream uv.lock, exported Windows pylock and interpreter receipt remain
// one atomic immutable closure.

// --- MatrAIx pinned immutable source -------------------------------------
// Both the full outer run and its finite health probe use the same reviewed
// source/catalogue closure. The writable Python environment remains under the
// Runtime data root and is never copied into the installed application.
{
  const sourceRoot = path.join(repoRoot, "MatrAIx-Persona-8B");
  const targetRoot = path.join(stagingRoot, "MatrAIx-Persona-8B");
  const expectedCommit = "2418b37ffb99f79c0a7d4b3dd4e461ced498aefc";
  const revision = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`MatrAIx checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const status = spawnSync("git", ["-C", sourceRoot, "status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
    shell: false,
  });
  if (status.status !== 0 || status.stdout.trim()) {
    fail("MatrAIx tracked checkout must be clean before packaging.");
  }
  const listing = spawnSync(
    "git",
    [
      "-C", sourceRoot, "ls-files", "-z", "--",
      "environment/runtime/harbor/**",
      "src/matraix/cli.py",
      "pyproject.toml",
      "LICENSE*",
      "packages/playground/**",
      "persona/datasets/matraix-persona-dev-sample/**",
    ],
    { encoding: "utf8", shell: false },
  );
  if (listing.status !== 0) fail("Could not enumerate the tracked MatrAIx source closure.");
  freshDir(targetRoot);
  for (const relative of listing.stdout.split("\0").filter(Boolean)) {
    const portable = relative.replaceAll("\\", "/");
    if (/(^|\/)(?:__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(portable) || /\.(?:pyc|pyo)$/u.test(portable)) continue;
    const source = path.resolve(sourceRoot, ...portable.split("/"));
    const target = path.resolve(targetRoot, ...portable.split("/"));
    const metadata = fs.lstatSync(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`MatrAIx tracked source must be a direct regular file: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const required of [
    "pyproject.toml",
    "src/matraix/cli.py",
    "environment/runtime/harbor",
    "persona/datasets/matraix-persona-dev-sample",
  ]) {
    if (!fs.existsSync(path.join(targetRoot, ...required.split("/")))) {
      fail(`MatrAIx staged source is incomplete: ${required}`);
    }
  }
  fs.writeFileSync(
    path.join(targetRoot, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- ShapeR/Formsmith pinned GPU reconstruction source -------------------
// The reviewed Breadboard compatibility changes are committed in the pinned
// source revision. Require that exact clean checkout and stage only the
// model/runtime source needed by the finite worker.
{
  const sourceRoot = path.join(repoRoot, "ShapeR");
  const targetRoot = path.join(stagingRoot, "ShapeR");
  const expectedCommit = "8e9bd5b25a075bdd2fc4d60027d27e515fa11769";
  const revision = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`ShapeR checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const status = spawnSync("git", ["-C", sourceRoot, "status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
    shell: false,
  });
  const checkoutChanges = status.status === 0
    ? status.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).sort()
    : [];
  if (status.status !== 0 || checkoutChanges.length > 0) {
    fail(
      `ShapeR checkout must be clean at the reviewed revision before packaging; ` +
        `found ${checkoutChanges.join(", ") || (status.status === 0 ? "none" : "an unreadable status")}.`,
    );
  }
  freshDir(targetRoot);
  for (const relative of ["infer_shape.py", "LICENSE", "NOTICE"]) {
    const source = path.join(sourceRoot, relative);
    if (!fs.existsSync(source)) fail(`ShapeR worker dependency is missing: ${source}`);
    fs.copyFileSync(source, path.join(targetRoot, relative));
  }
  for (const directory of ["dataset", "model", "postprocessing", "preprocessing", "experimental"]) {
    const source = path.join(sourceRoot, directory);
    if (!fs.existsSync(source)) fail(`ShapeR source directory is missing: ${source}`);
    copyTree(source, path.join(targetRoot, directory), (relative) =>
      /(^|\/)(?:__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(relative) ||
      /\.(?:pyc|pyo)$/u.test(relative),
    );
  }
  for (const required of [
    "infer_shape.py",
    "experimental/workaround_dataproc.py",
    "dataset/shaper_dataset.py",
    "model/download.py",
    "model/flow_matching/shaper_denoiser.py",
    "model/dino_and_ray_feature_extractor.py",
    "model/vae3d/autoencoder.py",
    "postprocessing/helper.py",
  ]) {
    if (!fs.existsSync(path.join(targetRoot, ...required.split("/")))) {
      fail(`ShapeR staged source is incomplete: ${required}`);
    }
  }
  fs.writeFileSync(
    path.join(targetRoot, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- Resource2Skill pinned immutable source ------------------------------
// The disposable outer worker executes the reviewed source through the
// Runtime-owned Python 3.11 environment and browser cache in the data root.
// Enumerating Git-tracked direct files prevents local environments, generated
// artifacts, and developer caches from entering the installed image.
{
  const sourceRoot = path.join(repoRoot, "Resource2Skill");
  const targetRoot = path.join(stagingRoot, "Resource2Skill");
  const expectedCommit = "7f101b4cfe214cc496d085a34efac528a17cc375";
  const revision = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`Resource2Skill checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const status = spawnSync("git", ["-C", sourceRoot, "status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
    shell: false,
  });
  if (status.status !== 0 || status.stdout.trim()) {
    fail("Resource2Skill tracked checkout must be clean before packaging.");
  }
  const listing = spawnSync("git", ["-C", sourceRoot, "ls-files", "-z"], {
    encoding: "utf8",
    shell: false,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (listing.status !== 0) fail("Could not enumerate the tracked Resource2Skill source closure.");
  freshDir(targetRoot);
  for (const relative of listing.stdout.split("\0").filter(Boolean)) {
    const portable = relative.replaceAll("\\", "/");
    if (
      /(^|\/)(?:\.git|\.venv|\.runtime|__pycache__|\.pytest_cache|\.ruff_cache|\.mypy_cache|node_modules)(?:\/|$)/u.test(portable) ||
      /\.(?:pyc|pyo)$/u.test(portable)
    ) continue;
    const source = path.resolve(sourceRoot, ...portable.split("/"));
    const target = path.resolve(targetRoot, ...portable.split("/"));
    const sourceRelative = path.relative(sourceRoot, source);
    const targetRelative = path.relative(targetRoot, target);
    if (
      sourceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(sourceRelative) ||
      targetRelative.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelative)
    ) fail(`Resource2Skill tracked path escapes its root: ${relative}`);
    const metadata = fs.lstatSync(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`Resource2Skill tracked source must be a direct regular file: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const required of [
    "cli.py",
    "core/agent_executor.py",
    "requirements.txt",
    "LICENSE",
    "domains/web/domain.yaml",
    "domains/ppt/domain.yaml",
    "domains/excel/domain.yaml",
    "domains/blender/domain.yaml",
    "domains/reaper/domain.yaml",
  ]) {
    if (!fs.existsSync(path.join(targetRoot, ...required.split("/")))) {
      fail(`Resource2Skill staged source is incomplete: ${required}`);
    }
  }
  fs.writeFileSync(
    path.join(targetRoot, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- Video Use pinned immutable source ----------------------------------
// The disposable coordinator may delegate bounded media work to other
// Runtime V2 jobs, but it still imports this reviewed skill implementation.
// The Breadboard changes are committed in the pinned source revision; require
// a clean checkout and continue binding the security-sensitive files by hash.
{
  const sourceRoot = path.join(repoRoot, "video-use");
  const targetRoot = path.join(stagingRoot, "video-use");
  const expectedCommit = "8e94eb04d22c5de30bd0febd2cd06fb4103949dd";
  const reviewedFileHashes = new Map([
    ["helpers/grade.py", "CAC78B55A9D15E5CA52A9FAD043CBAA9BE2A3728C34CE2BC2A55E39BCE88520C"],
    ["helpers/render.py", "5D8927669DCDBD0C2DE31D9AFF4E9EC6251F2700E8D49463EFAA0918BB698D37"],
  ]);
  const revision = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`Video Use checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const status = spawnSync("git", ["-C", sourceRoot, "status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
    shell: false,
  });
  const checkoutChanges = status.status === 0
    ? status.stdout
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => line.trim())
        .sort()
    : [];
  if (status.status !== 0 || checkoutChanges.length > 0) {
    fail(
      `Video Use checkout must be clean at the reviewed revision before packaging; ` +
        `found ${checkoutChanges.join(", ") || (status.status === 0 ? "none" : "an unreadable status")}.`,
    );
  }
  for (const [relative, expectedHash] of reviewedFileHashes) {
    const actualHash = await sha256File(path.join(sourceRoot, ...relative.split("/")));
    if (actualHash !== expectedHash) {
      fail(`Video Use reviewed file ${relative} must have SHA-256 ${expectedHash}; found ${actualHash}.`);
    }
  }
  const listing = spawnSync("git", ["-C", sourceRoot, "ls-files", "-z"], {
    encoding: "utf8",
    shell: false,
  });
  if (listing.status !== 0) fail("Could not enumerate the tracked Video Use source closure.");
  freshDir(targetRoot);
  for (const relative of listing.stdout.split("\0").filter(Boolean)) {
    const portable = relative.replaceAll("\\", "/");
    if (
      /(^|\/)(?:\.git|\.venv|\.runtime|__pycache__|\.pytest_cache|\.ruff_cache|\.mypy_cache|node_modules)(?:\/|$)/u.test(portable) ||
      /\.(?:pyc|pyo)$/u.test(portable)
    ) continue;
    const source = path.resolve(sourceRoot, ...portable.split("/"));
    const target = path.resolve(targetRoot, ...portable.split("/"));
    const sourceRelative = path.relative(sourceRoot, source);
    const targetRelative = path.relative(targetRoot, target);
    if (
      sourceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(sourceRelative) ||
      targetRelative.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelative)
    ) fail(`Video Use tracked path escapes its root: ${relative}`);
    const metadata = fs.lstatSync(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`Video Use tracked source must be a direct regular file: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const required of [
    "SKILL.md",
    "LICENSE",
    "pyproject.toml",
    "helpers/grade.py",
    "helpers/render.py",
    "helpers/pack_transcripts.py",
  ]) {
    if (!fs.existsSync(path.join(targetRoot, ...required.split("/")))) {
      fail(`Video Use staged source is incomplete: ${required}`);
    }
  }
  fs.writeFileSync(
    path.join(targetRoot, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetRoot, "BREADBOARD_PATCHED_FILES.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      upstreamCommit: expectedCommit,
      files: Object.fromEntries(reviewedFileHashes),
    }, null, 2)}\n`,
    "utf8",
  );
}

// --- HyperFrames reviewed skills and CLI identity ------------------------
// The finite worker reads the reviewed skill catalogue from the immutable
// app image while managed setup owns the executable CLI below the data root.
{
  const sourceRoot = path.join(repoRoot, "hyperframes");
  const targetRoot = path.join(stagingRoot, "hyperframes");
  const expectedCommit = "29f004cfc04b351bf38a8b28b20916bb5bad9fc4";
  const revision = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`HyperFrames checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const status = spawnSync("git", ["-C", sourceRoot, "status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
    shell: false,
  });
  if (status.status !== 0 || status.stdout.trim()) {
    fail("HyperFrames tracked checkout must be clean before packaging.");
  }
  const listing = spawnSync(
    "git",
    ["-C", sourceRoot, "ls-files", "-z", "--", "skills/**", "packages/cli/package.json", "LICENSE*"],
    { encoding: "utf8", shell: false },
  );
  if (listing.status !== 0) fail("Could not enumerate the tracked HyperFrames source closure.");
  freshDir(targetRoot);
  for (const relative of listing.stdout.split("\0").filter(Boolean)) {
    const portable = relative.replaceAll("\\", "/");
    if (/(^|\/)(?:node_modules|__pycache__|\.cache)(?:\/|$)/u.test(portable)) continue;
    const source = path.resolve(sourceRoot, ...portable.split("/"));
    const target = path.resolve(targetRoot, ...portable.split("/"));
    const sourceRelative = path.relative(sourceRoot, source);
    const targetRelative = path.relative(targetRoot, target);
    if (
      sourceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(sourceRelative) ||
      targetRelative.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelative)
    ) fail(`HyperFrames tracked path escapes its root: ${relative}`);
    const metadata = fs.lstatSync(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`HyperFrames tracked source must be a direct regular file: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const required of [
    "skills/hyperframes/SKILL.md",
    "packages/cli/package.json",
  ]) {
    if (!fs.existsSync(path.join(targetRoot, ...required.split("/")))) {
      fail(`HyperFrames staged source is incomplete: ${required}`);
    }
  }
  fs.writeFileSync(
    path.join(targetRoot, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- Wardrobe pinned immutable source and packaged runtime -----------------
// Installed mode starts Vite from this reviewed application-root closure.
// Its gallery/library/model-reference data remains under the writable data
// root, but package installation is never a first-start operation.
{
  const sourceRoot = path.join(repoRoot, "wardrobe");
  const sourceTarget = path.join(stagingRoot, "wardrobe");
  const sourceEntries = [
    "LICENSE",
    "index.html",
    "package-lock.json",
    "package.json",
    "public",
    "scripts",
    "src",
    "vite.config.mjs",
  ];
  await stagePinnedTrackedSourceClosure({
    label: "Wardrobe",
    sourceRoot,
    targetRoot: sourceTarget,
    expectedCommit: PINNED_PACKAGED_SERVICE_COMMITS.wardrobe,
    include: (relative) =>
      ["LICENSE", "index.html", "package-lock.json", "package.json", "vite.config.mjs"].includes(relative) ||
      relative.startsWith("public/") ||
      relative.startsWith("scripts/") ||
      relative.startsWith("src/"),
    required: [
      "LICENSE",
      "index.html",
      "package-lock.json",
      "package.json",
      "public/manifest.webmanifest",
      "scripts/import-job-api.mjs",
      "src/main.jsx",
      "vite.config.mjs",
    ],
  });

  if (process.platform !== "win32" || process.arch !== "x64") {
    fail("The reviewed packaged Wardrobe runtime currently supports Windows x64 only.");
  }
  const runtimeRoot = path.join(stagingRoot, "wardrobe-runtime");
  freshDir(runtimeRoot);
  for (const relative of sourceEntries) {
    const source = path.join(sourceTarget, ...relative.split("/"));
    const target = path.join(runtimeRoot, ...relative.split("/"));
    const metadata = fs.lstatSync(source, { throwIfNoEntry: false });
    if (!metadata || metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) {
      fail(`Wardrobe immutable runtime input is unavailable: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (metadata.isDirectory()) copyTree(source, target);
    else fs.copyFileSync(source, target);
  }
  const sourceIdentity = await sha256Tree(runtimeRoot);
  if (
    sourceIdentity.fileCount !== PINNED_WARDROBE_RUNTIME.source.fileCount ||
    sourceIdentity.sha256 !== PINNED_WARDROBE_RUNTIME.source.sha256
  ) {
    fail(
      `Wardrobe's immutable source is not pinned ` +
        `(${sourceIdentity.fileCount} files, SHA-256 ${sourceIdentity.sha256}).`,
    );
  }

  for (const [relative, expected, artifactLabel] of [
    ["package.json", PINNED_WARDROBE_RUNTIME.packageManifest, "package manifest"],
    ["package-lock.json", PINNED_WARDROBE_RUNTIME.dependencyLock, "dependency lock"],
  ]) {
    const artifact = path.join(runtimeRoot, relative);
    const metadata = fs.lstatSync(artifact, { throwIfNoEntry: false });
    if (
      !metadata?.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size !== expected.size ||
      (await sha256File(artifact)) !== expected.sha256
    ) {
      fail(`Wardrobe's ${artifactLabel} is not the reviewed immutable file.`);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "package-lock.json"), "utf8"));
  if (
    manifest?.name !== PINNED_WARDROBE_RUNTIME.name ||
    manifest?.version !== PINNED_WARDROBE_RUNTIME.version ||
    lock?.lockfileVersion !== 3 ||
    lock?.packages?.[""]?.name !== manifest.name ||
    lock?.packages?.[""]?.version !== manifest.version ||
    JSON.stringify(lock?.packages?.[""]?.dependencies ?? {}) !==
      JSON.stringify(manifest?.dependencies ?? {})
  ) {
    fail("Wardrobe's immutable npm lock does not bind the reviewed production manifest.");
  }

  installProductionDependencies({
    label: "wardrobe",
    target: runtimeRoot,
    tempName: "breadboard-wardrobe-runtime-install",
    command: "ci",
  });
  const nodeModules = path.join(runtimeRoot, "node_modules");
  fs.rmSync(path.join(nodeModules, ".package-lock.json"), { force: true });
  const nodeModulesIdentity = await sha256Tree(nodeModules);
  if (
    nodeModulesIdentity.fileCount !== PINNED_WARDROBE_RUNTIME.nodeModules.fileCount ||
    nodeModulesIdentity.sha256 !== PINNED_WARDROBE_RUNTIME.nodeModules.sha256
  ) {
    fail(
      `Wardrobe's materialized production dependencies are not pinned ` +
        `(${nodeModulesIdentity.fileCount} files, SHA-256 ${nodeModulesIdentity.sha256}).`,
    );
  }

  for (const [relative, expected, artifactLabel] of [
    ["node_modules/vite/package.json", PINNED_WARDROBE_RUNTIME.vite.packageJson, "Vite manifest"],
    ["node_modules/sharp/package.json", PINNED_WARDROBE_RUNTIME.sharp.packageJson, "Sharp manifest"],
    ...Object.entries(PINNED_WARDROBE_RUNTIME.sharp.nativeFiles).map(
      ([relative, expected]) => [relative, expected, `Sharp native file ${relative}`],
    ),
  ]) {
    const artifact = path.join(runtimeRoot, ...relative.split("/"));
    const metadata = fs.lstatSync(artifact, { throwIfNoEntry: false });
    if (
      !metadata?.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size !== expected.size ||
      (await sha256File(artifact)) !== expected.sha256
    ) {
      fail(`Wardrobe's ${artifactLabel} is not the reviewed immutable file.`);
    }
  }
  const viteManifest = JSON.parse(
    fs.readFileSync(path.join(nodeModules, "vite", "package.json"), "utf8"),
  );
  const sharpManifest = JSON.parse(
    fs.readFileSync(path.join(nodeModules, "sharp", "package.json"), "utf8"),
  );
  if (
    viteManifest?.version !== PINNED_WARDROBE_RUNTIME.vite.version ||
    sharpManifest?.version !== PINNED_WARDROBE_RUNTIME.sharp.version
  ) {
    fail("Wardrobe's Vite/Sharp package versions are not the reviewed versions.");
  }

  const viteProbe = spawnSync(
    process.execPath,
    [path.join(nodeModules, "vite", "bin", "vite.js"), "--version"],
    { cwd: runtimeRoot, encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000 },
  );
  const viteOutput = `${viteProbe.stdout ?? ""}\n${viteProbe.stderr ?? ""}`.trim();
  if (viteProbe.status !== 0 || !viteOutput.includes(`vite/${PINNED_WARDROBE_RUNTIME.vite.version}`)) {
    fail(`Wardrobe's immutable Vite runtime failed its version smoke: ${viteOutput || "no output"}`);
  }
  const sharpProbe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import sharp from 'sharp'; console.log(JSON.stringify({sharp:sharp.versions.sharp,vips:sharp.versions.vips}))",
    ],
    { cwd: runtimeRoot, encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000 },
  );
  try {
    const sharpOutput = JSON.parse((sharpProbe.stdout ?? "").trim());
    if (
      sharpProbe.status !== 0 ||
      sharpOutput?.sharp !== PINNED_WARDROBE_RUNTIME.sharp.version ||
      sharpOutput?.vips !== PINNED_WARDROBE_RUNTIME.sharp.libvipsVersion
    ) {
      throw new Error("version mismatch");
    }
  } catch {
    fail(
      `Wardrobe's immutable Sharp runtime failed its native smoke: ` +
        `${`${sharpProbe.stdout ?? ""}\n${sharpProbe.stderr ?? ""}`.trim() || "no output"}`,
    );
  }
  fs.writeFileSync(
    path.join(runtimeRoot, "runtime-artifact.json"),
    `${JSON.stringify(PINNED_WARDROBE_RUNTIME, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
}

// --- OpenWork pinned immutable source and packaged runtime ----------------
// Lean/hot managed setup copies the bounded source closure into data-root.
// Installed mode instead consumes a production dependency tree assembled here
// from one reviewed npm lock; no first-start install or network fallback is
// permitted on that path.
{
  const sourceRoot = path.join(repoRoot, "openwork");
  const targetRoot = path.join(stagingRoot, "openwork");
  await stagePinnedTrackedSourceClosure({
    label: "OpenWork",
    sourceRoot,
    targetRoot,
    expectedCommit: PINNED_PACKAGED_SERVICE_COMMITS.openwork,
    include: (relative) =>
      relative === "LICENSE" ||
      relative === "constants.json" ||
      relative === "package.json" ||
      relative === "pnpm-lock.yaml" ||
      relative === "pnpm-workspace.yaml" ||
      relative === "apps/server/package.json" ||
      relative.startsWith("apps/server/src/") ||
      relative.startsWith("packages/paths/") ||
      relative.startsWith("packages/types/"),
    required: [
      "LICENSE",
      "constants.json",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "apps/server/src/cli.ts",
      "apps/server/package.json",
      "packages/paths/package.json",
      "packages/types/package.json",
    ],
  });
  fs.writeFileSync(
    path.join(targetRoot, "BREADBOARD_UPSTREAM_COMMIT"),
    `${PINNED_PACKAGED_SERVICE_COMMITS.openwork}\n`,
    "utf8",
  );

  if (process.platform !== "win32" || process.arch !== "x64") {
    fail("The reviewed packaged OpenWork runtime currently supports Windows x64 only.");
  }
  const runtimeRoot = path.join(stagingRoot, "openwork-runtime");
  freshDir(runtimeRoot);
  for (const relative of [
    "apps/server/src",
    "packages/paths",
    "packages/types",
    "constants.json",
  ]) {
    const source = path.join(targetRoot, ...relative.split("/"));
    const target = path.join(runtimeRoot, ...relative.split("/"));
    const metadata = fs.lstatSync(source, { throwIfNoEntry: false });
    if (!metadata || metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) {
      fail(`OpenWork immutable runtime input is unavailable: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (metadata.isDirectory()) copyTree(source, target);
    else fs.copyFileSync(source, target);
  }
  for (const [relative, expected] of [
    ["apps/server/src", PINNED_OPENWORK_RUNTIME.source.server],
    ["packages/paths", PINNED_OPENWORK_RUNTIME.source.paths],
    ["packages/types", PINNED_OPENWORK_RUNTIME.source.types],
  ]) {
    const identity = await sha256Tree(path.join(runtimeRoot, ...relative.split("/")));
    if (identity.fileCount !== expected.fileCount || identity.sha256 !== expected.sha256) {
      fail(`OpenWork's ${relative} closure is not the reviewed immutable tree.`);
    }
  }
  const constantsIdentity = canonicalFileIdentity(path.join(runtimeRoot, "constants.json"));
  if (
    constantsIdentity.size !== PINNED_OPENWORK_RUNTIME.source.constants.size ||
    constantsIdentity.sha256 !== PINNED_OPENWORK_RUNTIME.source.constants.sha256
  ) {
    fail("OpenWork's constants authority is not the reviewed immutable file.");
  }

  const sourceManifestPath = path.join(targetRoot, "apps", "server", "package.json");
  const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"));
  if (
    sourceManifest?.name !== PINNED_OPENWORK_RUNTIME.name ||
    sourceManifest?.version !== PINNED_OPENWORK_RUNTIME.version
  ) {
    fail("OpenWork's pinned source manifest does not name the reviewed server version.");
  }
  const preparedManifest = {
    ...sourceManifest,
    dependencies: { ...PINNED_OPENWORK_DEPENDENCIES },
    private: true,
  };
  delete preparedManifest.devDependencies;
  delete preparedManifest.scripts;
  const preparedManifestBytes = Buffer.from(`${JSON.stringify(preparedManifest, null, 2)}\n`, "utf8");
  const preparedManifestIdentity = {
    size: preparedManifestBytes.length,
    sha256: createHash("sha256").update(preparedManifestBytes).digest("hex").toUpperCase(),
  };
  if (
    preparedManifestIdentity.size !== PINNED_OPENWORK_RUNTIME.preparedManifest.size ||
    preparedManifestIdentity.sha256 !== PINNED_OPENWORK_RUNTIME.preparedManifest.sha256
  ) {
    fail("OpenWork's generated production manifest is not the reviewed manifest.");
  }
  const runtimeServer = path.join(runtimeRoot, "apps", "server");
  fs.writeFileSync(path.join(runtimeServer, "package.json"), preparedManifestBytes, {
    encoding: "utf8",
    mode: 0o644,
  });

  const lockAuthority = path.join(
    desktopRoot,
    "runtime-v2",
    "vendor",
    "openwork",
    "package-lock.json",
  );
  const lockMetadata = fs.lstatSync(lockAuthority, { throwIfNoEntry: false });
  if (
    !lockMetadata?.isFile() ||
    lockMetadata.isSymbolicLink() ||
    lockMetadata.size !== PINNED_OPENWORK_RUNTIME.dependencyLock.size ||
    (await sha256File(lockAuthority)) !== PINNED_OPENWORK_RUNTIME.dependencyLock.sha256
  ) {
    fail("OpenWork's immutable npm lock is missing or does not match the reviewed lock.");
  }
  const lock = JSON.parse(fs.readFileSync(lockAuthority, "utf8"));
  if (
    lock?.lockfileVersion !== 3 ||
    lock?.packages?.[""]?.name !== PINNED_OPENWORK_RUNTIME.name ||
    lock?.packages?.[""]?.version !== PINNED_OPENWORK_RUNTIME.version ||
    Object.keys(lock?.packages?.[""]?.dependencies ?? {}).length !==
      Object.keys(PINNED_OPENWORK_DEPENDENCIES).length ||
    Object.entries(PINNED_OPENWORK_DEPENDENCIES).some(
      ([name, version]) => lock?.packages?.[""]?.dependencies?.[name] !== version,
    )
  ) {
    fail("OpenWork's immutable npm lock does not bind the reviewed production manifest.");
  }
  fs.copyFileSync(lockAuthority, path.join(runtimeServer, "package-lock.json"));
  installProductionDependencies({
    label: "openwork",
    target: runtimeRoot,
    tempName: "breadboard-openwork-runtime-install",
    command: "ci",
    workingDirectory: "apps/server",
    materializedLinks: [
      { packageName: "@openwork/paths", sourceRelative: "packages/paths" },
      { packageName: "@openwork/types", sourceRelative: "packages/types" },
    ],
  });

  const nodeModules = path.join(runtimeServer, "node_modules");
  // npm's hidden lock is install bookkeeping derived from npm's own version;
  // runtime resolution uses the reviewed top-level lock, so omit the redundant
  // generated file before pinning and packaging the executable dependency tree.
  fs.rmSync(path.join(nodeModules, ".package-lock.json"), { force: true });
  const nodeModulesIdentity = await sha256Tree(nodeModules);
  if (
    nodeModulesIdentity.fileCount !== PINNED_OPENWORK_RUNTIME.nodeModules.fileCount ||
    nodeModulesIdentity.sha256 !== PINNED_OPENWORK_RUNTIME.nodeModules.sha256
  ) {
    fail(
      `OpenWork's materialized production dependencies are not pinned ` +
        `(${nodeModulesIdentity.fileCount} files, SHA-256 ${nodeModulesIdentity.sha256}).`,
    );
  }
  const sdkManifestPath = path.join(
    nodeModules,
    "@opencode-ai",
    "sdk",
    "package.json",
  );
  const sdkMetadata = fs.lstatSync(sdkManifestPath, { throwIfNoEntry: false });
  const sdkManifest = sdkMetadata?.isFile()
    ? JSON.parse(fs.readFileSync(sdkManifestPath, "utf8"))
    : null;
  if (
    !sdkMetadata?.isFile() ||
    sdkMetadata.isSymbolicLink() ||
    sdkMetadata.size !== PINNED_OPENWORK_RUNTIME.sdkPackage.packageJsonSize ||
    (await sha256File(sdkManifestPath)) !== PINNED_OPENWORK_RUNTIME.sdkPackage.packageJsonSha256 ||
    sdkManifest?.name !== PINNED_OPENWORK_RUNTIME.sdkPackage.name ||
    sdkManifest?.version !== PINNED_OPENWORK_RUNTIME.sdkPackage.version
  ) {
    fail("OpenWork's installed OpenCode SDK is not the reviewed package.");
  }

  const bun = path.join(desktopRoot, "build-resources", "runtimes", "bun", "bun.exe");
  const entrypoint = path.join(runtimeServer, "src", "cli.ts");
  const smoke = spawnSync(bun, [entrypoint, "--version"], {
    cwd: runtimeServer,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1", DO_NOT_TRACK: "1" },
  });
  const smokeOutput = `${smoke.stdout ?? ""}\n${smoke.stderr ?? ""}`.trim();
  if (
    smoke.status !== 0 ||
    !smokeOutput.split(/\r?\n/u).includes(PINNED_OPENWORK_RUNTIME.version)
  ) {
    fail(`OpenWork's immutable server failed its version smoke: ${smokeOutput || "no output"}`);
  }

  const fingerprintParts = [];
  const fingerprintRoot = path.join(targetRoot, "apps", "server", "src");
  const walkFingerprint = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walkFingerprint(absolute, relative);
      else if (entry.isFile()) fingerprintParts.push(`${relative}:${fs.statSync(absolute).size}`);
      else fail("OpenWork's pinned source fingerprint contains an indirect entry.");
    }
  };
  walkFingerprint(fingerprintRoot, "src");
  for (const relative of ["apps/server/package.json", "constants.json"]) {
    fingerprintParts.push(
      `${relative}:${fs.statSync(path.join(targetRoot, ...relative.split("/"))).size}`,
    );
  }
  fs.writeFileSync(
    path.join(runtimeRoot, "breadboard-source.json"),
    `${JSON.stringify({ fingerprint: fingerprintParts.join("|") }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
  fs.writeFileSync(
    path.join(runtimeRoot, "runtime-artifact.json"),
    `${JSON.stringify(PINNED_OPENWORK_RUNTIME, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
}

// --- OpenMontage pinned immutable source ---------------------------------
// Authenticated setup copies this reviewed source into the writable data root
// before either the finite status probe or the full media worker can use it.
{
  const sourceRoot = path.join(repoRoot, "OpenMontage");
  const targetRoot = path.join(stagingRoot, "OpenMontage");
  const expectedCommit = "4eab34c5cfcccaa4f1970554928feccce73ee930";
  const revision = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`OpenMontage checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const status = spawnSync("git", ["-C", sourceRoot, "status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
    shell: false,
  });
  if (status.status !== 0 || status.stdout.trim()) {
    fail("OpenMontage tracked checkout must be clean before packaging.");
  }
  const listing = spawnSync("git", ["-C", sourceRoot, "ls-files", "-z"], {
    encoding: "utf8",
    shell: false,
  });
  if (listing.status !== 0) fail("Could not enumerate the tracked OpenMontage source closure.");
  freshDir(targetRoot);
  for (const relative of listing.stdout.split("\0").filter(Boolean)) {
    const portable = relative.replaceAll("\\", "/");
    if (
      /(^|\/)(?:\.git|\.venv|\.runtime|\.cache|__pycache__|\.pytest_cache|node_modules|projects)(?:\/|$)/u.test(portable) ||
      /\.(?:pyc|pyo)$/u.test(portable)
    ) continue;
    const source = path.resolve(sourceRoot, ...portable.split("/"));
    const target = path.resolve(targetRoot, ...portable.split("/"));
    const sourceRelative = path.relative(sourceRoot, source);
    const targetRelative = path.relative(targetRoot, target);
    if (
      sourceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(sourceRelative) ||
      targetRelative.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelative)
    ) fail(`OpenMontage tracked path escapes its root: ${relative}`);
    const metadata = fs.lstatSync(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`OpenMontage tracked source must be a direct regular file: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const required of [
    "AGENT_GUIDE.md",
    "requirements.txt",
    "tools/tool_registry.py",
    "remotion-composer/package.json",
    "remotion-composer/package-lock.json",
  ]) {
    if (!fs.existsSync(path.join(targetRoot, ...required.split("/")))) {
      fail(`OpenMontage staged source is incomplete: ${required}`);
    }
  }
  fs.writeFileSync(
    path.join(targetRoot, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- Bolt Slides pinned authoring source ---------------------------------
// The outer worker copies this small immutable authoring kit into its private
// run workspace; managed setup owns all installed dependencies in data root.
{
  const sourceRoot = path.join(repoRoot, "bolt-slides");
  const targetRoot = path.join(stagingRoot, "bolt-slides");
  const expectedCommit = "53b55bcf365dc2864fac29e7a5594213611142be";
  const revision = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`Bolt Slides checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const status = spawnSync("git", ["-C", sourceRoot, "status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
    shell: false,
  });
  if (status.status !== 0 || status.stdout.trim()) {
    fail("Bolt Slides tracked checkout must be clean before packaging.");
  }
  const listing = spawnSync("git", ["-C", sourceRoot, "ls-files", "-z"], {
    encoding: "utf8",
    shell: false,
  });
  if (listing.status !== 0) fail("Could not enumerate the tracked Bolt Slides source closure.");
  freshDir(targetRoot);
  for (const relative of listing.stdout.split("\0").filter(Boolean)) {
    const portable = relative.replaceAll("\\", "/");
    if (
      /(^|\/)(?:\.git|\.runtime|\.cache|node_modules|__pycache__)(?:\/|$)/u.test(portable) ||
      /\.(?:pyc|pyo)$/u.test(portable)
    ) continue;
    const source = path.resolve(sourceRoot, ...portable.split("/"));
    const target = path.resolve(targetRoot, ...portable.split("/"));
    const sourceRelative = path.relative(sourceRoot, source);
    const targetRelative = path.relative(targetRoot, target);
    if (
      sourceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(sourceRelative) ||
      targetRelative.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelative)
    ) fail(`Bolt Slides tracked path escapes its root: ${relative}`);
    const metadata = fs.lstatSync(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`Bolt Slides tracked source must be a direct regular file: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const required of [
    ".bolt/skills/slides/SKILL.md",
    "package.json",
    "package-lock.json",
    "src/styles/tokens.css",
    "src/styles/base.css",
  ]) {
    if (!fs.existsSync(path.join(targetRoot, ...required.split("/")))) {
      fail(`Bolt Slides staged source is incomplete: ${required}`);
    }
  }
  fs.writeFileSync(
    path.join(targetRoot, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- SubsAI pinned transcription source ---------------------------------
// The fresh transcription/probe workers import only this reviewed source;
// authenticated managed setup owns the Python environment and model cache.
{
  const sourceRoot = path.join(repoRoot, "subsai");
  const targetRoot = path.join(stagingRoot, "subsai");
  const expectedCommit = "5ed78a85d2b868a907c811404f7cd9179db39968";
  const revision = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`SubsAI checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const status = spawnSync("git", ["-C", sourceRoot, "status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
    shell: false,
  });
  if (status.status !== 0 || status.stdout.trim()) {
    fail("SubsAI tracked checkout must be clean before packaging.");
  }
  const listing = spawnSync(
    "git",
    ["-C", sourceRoot, "ls-files", "-z", "--", "src/**", "pyproject.toml", "requirements.txt", "README.md", "LICENSE"],
    { encoding: "utf8", shell: false },
  );
  if (listing.status !== 0) fail("Could not enumerate the tracked SubsAI source closure.");
  freshDir(targetRoot);
  for (const relative of listing.stdout.split("\0").filter(Boolean)) {
    const portable = relative.replaceAll("\\", "/");
    if (/(^|\/)(?:__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(portable) || /\.(?:pyc|pyo)$/u.test(portable)) continue;
    const source = path.resolve(sourceRoot, ...portable.split("/"));
    const target = path.resolve(targetRoot, ...portable.split("/"));
    const sourceRelative = path.relative(sourceRoot, source);
    const targetRelative = path.relative(targetRoot, target);
    if (
      sourceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(sourceRelative) ||
      targetRelative.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelative)
    ) fail(`SubsAI tracked path escapes its root: ${relative}`);
    const metadata = fs.lstatSync(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`SubsAI tracked source must be a direct regular file: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const required of [
    "pyproject.toml",
    "requirements.txt",
    "src/subsai/cli.py",
    "src/subsai/configs.py",
    "src/subsai/models/faster_whisper_model.py",
  ]) {
    if (!fs.existsSync(path.join(targetRoot, ...required.split("/")))) {
      fail(`SubsAI staged source is incomplete: ${required}`);
    }
  }
  fs.writeFileSync(
    path.join(targetRoot, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- OpenPlanter pinned agent/wiki closure -------------------------------
// Runtime owns the Python tree and gives it a private writable home. The
// installed app contains only the reviewed agent package and wiki catalogue.
{
  const openPlanterSource = path.join(repoRoot, "OpenPlanter");
  const openPlanterTarget = path.join(stagingRoot, "OpenPlanter");
  const expectedCommit = "81d75620ff50a69f576bc19a8bb17738e952387a";
  const revision = spawnSync("git", ["-C", openPlanterSource, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`OpenPlanter checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  freshDir(openPlanterTarget);
  for (const relative of ["pyproject.toml", "LICENSE"]) {
    const source = path.join(openPlanterSource, relative);
    if (!fs.existsSync(source)) fail(`OpenPlanter worker dependency is missing: ${source}`);
    fs.copyFileSync(source, path.join(openPlanterTarget, relative));
  }
  copyTree(path.join(openPlanterSource, "agent"), path.join(openPlanterTarget, "agent"), (relative) => {
    if (/(^|\/)(?:__pycache__|\.pytest_cache)(?:\/|$)/u.test(relative)) return true;
    const source = path.join(openPlanterSource, "agent", ...relative.split("/"));
    return fs.statSync(source).isFile() && !relative.endsWith(".py");
  });
  copyTree(path.join(openPlanterSource, "wiki"), path.join(openPlanterTarget, "wiki"), (relative) => {
    const source = path.join(openPlanterSource, "wiki", ...relative.split("/"));
    return fs.statSync(source).isFile() && !relative.endsWith(".md");
  });
  fs.writeFileSync(
    path.join(openPlanterTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- Deep Tutor immutable package closure --------------------------------
// The disposable worker uses a data-root venv and home, but imports the
// reviewed application and CLI packages from the sealed app layout. Web,
// test, local venv, cache and mutable data trees are deliberately excluded.
{
  const deepTutorSource = path.join(repoRoot, "DeepTutor");
  const deepTutorTarget = path.join(stagingRoot, "DeepTutor");
  const expectedCommit = "37c3db6df7e886aee4f61c97ec5e618b8ab379e8";
  const revision = spawnSync("git", ["-C", deepTutorSource, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`Deep Tutor checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  freshDir(deepTutorTarget);
  for (const relative of ["pyproject.toml", "LICENSE", "README.md"]) {
    const source = path.join(deepTutorSource, relative);
    if (!fs.existsSync(source)) fail(`Deep Tutor worker dependency is missing: ${source}`);
    fs.copyFileSync(source, path.join(deepTutorTarget, relative));
  }
  for (const directory of ["deeptutor", "deeptutor_cli"]) {
    const source = path.join(deepTutorSource, directory);
    const target = path.join(deepTutorTarget, directory);
    if (!fs.existsSync(source)) fail(`Deep Tutor package directory is missing: ${source}`);
    copyTree(source, target, (relative) =>
      /(^|\/)(?:__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(relative) ||
      /\.(?:pyc|pyo)$/u.test(relative),
    );
  }
  fs.writeFileSync(
    path.join(deepTutorTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- Vox Director pinned local-engine closure ----------------------------
// Only the reviewed, provider-free local render scripts enter the package.
// Runtime mints the clone path, Python, ffmpeg and ffprobe; Atlas/provider
// modules and the rest of the upstream checkout are deliberately absent.
{
  const voxSource = path.join(repoRoot, "vox-director");
  const voxTarget = path.join(stagingRoot, "vox-director");
  const expectedCommit = "668ec3946fe0139bc985313b15c1a300fca42f94";
  const revision = spawnSync("git", ["-C", voxSource, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    fail(`Vox Director checkout must be pinned to ${expectedCommit}; found ${actualCommit || "unknown"}.`);
  }
  const files = [
    "SKILL.md",
    "LICENSE",
    "references/beat-layer.md",
    "references/prompt-guide.md",
    "scripts/styles.py",
    "scripts/text_overlay.py",
    "scripts/motion.py",
    "scripts/assemble.py",
  ];
  freshDir(voxTarget);
  for (const relative of files) {
    const source = path.join(voxSource, ...relative.split("/"));
    if (!fs.existsSync(source)) fail(`Vox Director worker dependency is missing: ${source}`);
    const target = path.join(voxTarget, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  fs.writeFileSync(
    path.join(voxTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${expectedCommit}\n`,
    "utf8",
  );
}

// --- shared static assets -------------------------------------------------
// --- mandatory packaged service source closures --------------------------
// These services are installed or launched on demand, but their immutable
// source/version/lock authority must still ship with every installed app.
// Every closure below comes only from an exact clean independent checkout and
// carries a per-file hash receipt for package-time verification.
log("staging pinned on-demand service source closures");
await stagePinnedTrackedSourceClosure({
  label: "DeerFlow",
  sourceRoot: path.join(repoRoot, "deer-flow"),
  targetRoot: path.join(stagingRoot, "deer-flow"),
  expectedCommit: PINNED_PACKAGED_SERVICE_COMMITS.deerFlow,
  include: (relative) =>
    relative === "LICENSE" ||
    relative === "config.example.yaml" ||
    relative === "extensions_config.example.json" ||
    relative.startsWith("skills/") ||
    relative.startsWith("contracts/") ||
    relative === "backend/.python-version" ||
    relative === "backend/README.md" ||
    relative === "backend/pyproject.toml" ||
    relative === "backend/uv.lock" ||
    relative.startsWith("backend/app/") ||
    relative.startsWith("backend/packages/"),
  required: [
    "LICENSE",
    "backend/pyproject.toml",
    "backend/uv.lock",
    "backend/app/gateway/app.py",
    "backend/packages/harness/pyproject.toml",
    "backend/packages/extension-api/pyproject.toml",
  ],
});

await stagePinnedTrackedSourceClosure({
  label: "Vibe Trading",
  sourceRoot: path.join(repoRoot, "Vibe-Trading"),
  targetRoot: path.join(stagingRoot, "Vibe-Trading"),
  expectedCommit: PINNED_PACKAGED_SERVICE_COMMITS.vibeTrading,
  include: (relative) =>
    ["LICENSE", "NOTICE", "MANIFEST.in", "README.md", "pyproject.toml", "requirements-lock.txt"].includes(relative) ||
    (relative.startsWith("agent/") &&
      !/(^|\/)(?:tests?|__pycache__|\.pytest_cache)(?:\/|$)/u.test(relative) &&
      !/(^|\/)\.env(?:\.|$)/u.test(relative)),
  required: [
    "LICENSE",
    "NOTICE",
    "README.md",
    "pyproject.toml",
    "requirements-lock.txt",
    "agent/api_server.py",
    "agent/src/agent/loop.py",
  ],
});

await stagePinnedTrackedSourceClosure({
  label: "Stock Analyst",
  sourceRoot: path.join(repoRoot, "daily_stock_analysis"),
  targetRoot: path.join(stagingRoot, "daily_stock_analysis"),
  expectedCommit: PINNED_PACKAGED_SERVICE_COMMITS.stockAnalyst,
  include: (relative) =>
    [
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "SKILL.md",
      "main.py",
      "server.py",
      "pyproject.toml",
      "requirements.txt",
      "requirements.lock",
      "setup.cfg",
    ].includes(relative) ||
    ["api/", "bot/", "data_provider/", "src/", "strategies/", "templates/"].some((prefix) =>
      relative.startsWith(prefix)
    ),
  required: [
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "requirements.txt",
    "requirements.lock",
    "main.py",
    "server.py",
    "api/app.py",
    "api/v1/endpoints/agent.py",
  ],
});

await stagePinnedTrackedSourceClosure({
  label: "Deep Research",
  sourceRoot: path.join(repoRoot, "deep-research"),
  targetRoot: path.join(stagingRoot, "deep-research"),
  expectedCommit: PINNED_PACKAGED_SERVICE_COMMITS.deepResearch,
  include: (relative) =>
    ["LICENSE", "README.md", "package.json", "package-lock.json", "tsconfig.json"].includes(relative) ||
    relative.startsWith("src/"),
  required: [
    "LICENSE",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "src/api.ts",
  ],
});
installProductionDependencies({
  label: "deep-research",
  target: path.join(stagingRoot, "deep-research"),
  tempName: "breadboard-deep-research-install",
  command: "ci",
});

await stagePinnedTrackedSourceClosure({
  label: "MoneyPrinterTurbo",
  sourceRoot: path.join(repoRoot, "MoneyPrinterTurbo"),
  targetRoot: path.join(stagingRoot, "MoneyPrinterTurbo"),
  expectedCommit: PINNED_PACKAGED_SERVICE_COMMITS.moneyPrinter,
  include: (relative) =>
    [
      ".python-version",
      "LICENSE",
      "README-en.md",
      "cli.py",
      "config.example.toml",
      "main.py",
      "pyproject.toml",
      "requirements.txt",
      "uv.lock",
    ].includes(relative) ||
    relative.startsWith("app/") ||
    relative.startsWith("resource/"),
  required: [
    "LICENSE",
    "config.example.toml",
    "pyproject.toml",
    "requirements.txt",
    "uv.lock",
    "app/asgi.py",
    "app/services/task.py",
    "resource/fonts/MicrosoftYaHeiBold.ttc",
  ],
});

await stagePinnedTrackedSourceClosure({
  label: "OpenScience version authority",
  sourceRoot: path.join(repoRoot, "openscience"),
  targetRoot: path.join(stagingRoot, "openscience"),
  expectedCommit: PINNED_PACKAGED_SERVICE_COMMITS.openscience,
  include: (relative) =>
    relative === "LICENSE" ||
    relative === "NOTICE" ||
    relative === "backend/cli/package.json",
  required: ["LICENSE", "NOTICE", "backend/cli/package.json"],
});

// Installed mode launches the exact npm-published OpenScience CLI from the
// immutable application root. The source checkout remains the version/license
// authority, while this frozen npm lock and reviewed Windows binaries remove
// the old first-start network install from the packaged service path.
{
  if (process.platform !== "win32" || process.arch !== "x64") {
    fail("The reviewed packaged OpenScience runtime currently supports Windows x64 only.");
  }
  const authority = path.join(desktopRoot, "runtime-v2", "vendor", "openscience");
  const target = path.join(stagingRoot, "openscience-cli");
  freshDir(target);
  for (const entry of ["package.json", "package-lock.json"]) {
    const source = path.join(authority, entry);
    const metadata = fs.lstatSync(source, { throwIfNoEntry: false });
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      fail(`OpenScience immutable npm authority is missing a direct ${entry}.`);
    }
    fs.copyFileSync(source, path.join(target, entry));
  }
  if ((await sha256File(path.join(target, "package-lock.json"))) !== PINNED_OPENSCIENCE_RUNTIME.dependencyLockSha256) {
    fail("OpenScience's immutable npm lock is not the reviewed lock.");
  }
  const lock = JSON.parse(fs.readFileSync(path.join(target, "package-lock.json"), "utf8"));
  const lockedPackage = lock?.packages?.["node_modules/@synsci/openscience"];
  if (
    lockedPackage?.version !== PINNED_OPENSCIENCE_RUNTIME.version ||
    lockedPackage?.integrity !== PINNED_OPENSCIENCE_RUNTIME.npmIntegrity
  ) {
    fail("OpenScience's immutable npm lock does not bind the reviewed CLI package.");
  }
  installProductionDependencies({
    label: "openscience",
    target,
    tempName: "breadboard-openscience-runtime-install",
    command: "ci",
  });
  for (const [relativePath, expected] of Object.entries(PINNED_OPENSCIENCE_RUNTIME.files)) {
    const artifact = path.join(target, ...relativePath.split("/"));
    const metadata = fs.lstatSync(artifact, { throwIfNoEntry: false });
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      fail(`OpenScience's reviewed runtime closure is missing ${relativePath}.`);
    }
    const identity = { size: metadata.size, sha256: await sha256File(artifact) };
    if (identity.size !== expected.size || identity.sha256 !== expected.sha256) {
      fail(`OpenScience's reviewed runtime closure does not match for ${relativePath}.`);
    }
  }
  const entrypoint = path.join(
    target,
    "node_modules",
    "@synsci",
    "openscience",
    "bin",
    "openscience",
  );
  const versionProbe = spawnSync(process.execPath, [entrypoint, "--version"], {
    cwd: target,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1", OPENSCIENCE_DISABLE_AUTOUPDATE: "1" },
  });
  const versionOutput = `${versionProbe.stdout ?? ""}\n${versionProbe.stderr ?? ""}`.trim();
  if (versionProbe.status !== 0 || !versionOutput.split(/\r?\n/u).includes(PINNED_OPENSCIENCE_RUNTIME.version)) {
    fail(`OpenScience's reviewed CLI failed its version smoke check: ${versionOutput || "no output"}`);
  }
  fs.writeFileSync(
    path.join(target, "runtime-artifact.json"),
    `${JSON.stringify(PINNED_OPENSCIENCE_RUNTIME, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
}

if (fs.existsSync(path.join(repoRoot, "shared"))) {
  log("staging shared assets");
  freshDir(path.join(stagingRoot, "shared"));
  copyTree(path.join(repoRoot, "shared"), path.join(stagingRoot, "shared"));
}

// --- fixed packaged Python services --------------------------------------
// These services launch from immutable, separately locked Python environments
// assembled by prepare-runtimes.mjs. Only reviewed program source and its
// hashed Windows lock enter app-services; tests, caches, data, and model weights
// remain outside the installer.
for (const service of PACKAGED_PYTHON_SERVICES) {
  const resolvedSource = await resolvePackagedServiceSourceRoot(service);
  const { sourceRoot } = resolvedSource;
  const sourceModule = path.join(sourceRoot, service.moduleDirectory);
  const targetRoot = path.join(stagingRoot, service.serviceDirectory);
  const sourceLockFile = service.sourceLockFile ?? "pylock.packaged.toml";
  const checkoutPaths = [
    service.moduleDirectory,
    "pyproject.toml",
    ...(service.requirementsSha256 ? ["requirements.txt"] : []),
    sourceLockFile,
    ...Object.keys(service.additionalSourceFiles ?? {}),
    ...(service.noticesSha256 ? ["THIRD_PARTY_NOTICES.md"] : []),
  ];
  for (const relativePath of checkoutPaths) {
    if (!fs.existsSync(path.join(sourceRoot, ...relativePath.split("/")))) {
      fail(`${service.id} packaged source closure is missing ${service.serviceDirectory}/${relativePath}.`);
    }
  }
  if (!resolvedSource.archiveSource) {
    const status = service.independentCheckout
      ? spawnSync("git", ["-C", sourceRoot, "status", "--porcelain=v1", "--untracked-files=all"], {
          encoding: "utf8",
          shell: false,
        })
      : spawnSync(
          "git",
          [
            "-C", repoRoot, "status", "--porcelain=v1", "--untracked-files=all", "--",
            ...checkoutPaths.map((relativePath) => `${service.serviceDirectory}/${relativePath}`),
          ],
          { encoding: "utf8", shell: false },
        );
    if (status.status !== 0 || status.stdout.trim()) {
      fail(`${service.id} packaged source and lock closure must be tracked and clean.`);
    }
    if (service.upstreamCommit) {
      const commit = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
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
        service.independentCheckout ? sourceRoot : repoRoot,
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
    ...Object.entries(service.additionalSourceFiles ?? {}),
    ...(service.noticesSha256 ? [["THIRD_PARTY_NOTICES.md", service.noticesSha256]] : []),
  ]) {
    const actualHash = canonicalFileIdentity(path.join(sourceRoot, fileName)).sha256;
    if (actualHash !== expectedHash) {
      fail(`${service.id} ${fileName} is not the reviewed immutable file (${actualHash}).`);
    }
  }
  const exportedLock = service.lockFormat === "uv-project-export"
    ? path.join(
        desktopRoot,
        "build-resources",
        "runtimes",
        service.runtimeDirectory,
        "pylock.packaged.toml",
      )
    : path.join(sourceRoot, "pylock.packaged.toml");
  if (
    !fs.existsSync(exportedLock) ||
    canonicalFileIdentity(exportedLock).sha256 !== service.lockSha256
  ) {
    fail(`${service.id} exported packaged lock is missing or not the reviewed immutable file.`);
  }
  const lockedPackages = new Map();
  const exportedSource = fs.readFileSync(exportedLock, "utf8").replace(/\r\n/gu, "\n");
  for (const match of exportedSource.matchAll(/\[\[packages\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/gu)) {
    lockedPackages.set(match[1].toLowerCase().replace(/[-_.]+/gu, "-"), match[2]);
  }
  if (lockedPackages.size !== service.packageCount) {
    fail(`${service.id} exported pylock must contain ${service.packageCount} packages; found ${lockedPackages.size}.`);
  }
  for (const [packageName, expectedVersion] of Object.entries(service.corePackages)) {
    if (lockedPackages.get(packageName.toLowerCase().replace(/[-_.]+/gu, "-")) !== expectedVersion) {
      fail(`${service.id} exported pylock does not pin ${packageName}==${expectedVersion}.`);
    }
  }

  log(`staging ${service.id} immutable source and hashed packaged lock`);
  freshDir(targetRoot);
  copyTree(sourceModule, path.join(targetRoot, service.moduleDirectory), (relativePath) =>
    /(^|\/)(?:__pycache__|\.pytest_cache|\.cache)(?:\/|$)/u.test(relativePath) ||
    /\.(?:pyc|pyo)$/u.test(relativePath)
  );
  for (const fileName of [
    "pyproject.toml",
    ...(service.requirementsSha256 ? ["requirements.txt"] : []),
    sourceLockFile,
    ...Object.keys(service.additionalSourceFiles ?? {}),
    ...(service.noticesSha256 ? ["THIRD_PARTY_NOTICES.md"] : []),
  ]) {
    fs.copyFileSync(path.join(sourceRoot, fileName), path.join(targetRoot, fileName));
  }
  if (sourceLockFile !== "pylock.packaged.toml") {
    fs.copyFileSync(exportedLock, path.join(targetRoot, "pylock.packaged.toml"));
  }
  const stagedSourceIdentity = await sha256Tree(path.join(targetRoot, service.moduleDirectory));
  if (
    stagedSourceIdentity.sha256 !== service.sourceSha256 ||
    stagedSourceIdentity.fileCount !== service.sourceFileCount
  ) {
    fail(`${service.id} staged program source is not the reviewed immutable tree.`);
  }
  fs.writeFileSync(
    path.join(targetRoot, "runtime-artifact.json"),
    `${JSON.stringify(packagedServiceReceipt(service), null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
  if (service.upstreamCommit) {
    fs.writeFileSync(
      path.join(targetRoot, "BREADBOARD_UPSTREAM_COMMIT"),
      `${service.upstreamCommit}\n`,
      "utf8",
    );
  }
  if (resolvedSource.cleanupRoot) {
    fs.rmSync(resolvedSource.cleanupRoot, { recursive: true, force: true });
  }
}

// --- GBrain (Runtime V2 on-demand retrieval service) ----------------------
// Mutable PGLite/index data is intentionally absent: Runtime V2 injects a
// user-data path at launch. Only reviewed source and frozen production
// dependencies enter immutable app resources.
{
  const adapterSource = path.join(repoRoot, "gbrain-adapter");
  const adapterTarget = path.join(stagingRoot, "gbrain-adapter");
  const engineSource = path.join(repoRoot, "gbrain");
  const engineTarget = path.join(stagingRoot, "gbrain");
  for (const [label, source] of [
    ["gbrain-adapter", adapterSource],
    ["gbrain", engineSource],
  ]) {
    if (!fs.existsSync(source)) fail(`${label} source not found: ${source}`);
  }

  const closurePaths = [
    "gbrain-adapter/package.json",
    "gbrain-adapter/bun.lock",
    "gbrain-adapter/src",
    "gbrain/package.json",
    "gbrain/bun.lock",
    "gbrain/src",
    "gbrain/LICENSE",
    "gbrain/UPSTREAM.json",
    "gbrain/VERSION",
  ];
  const sourceStatus = spawnSync(
    "git",
    ["-C", repoRoot, "status", "--porcelain=v1", "--untracked-files=all", "--", ...closurePaths],
    { encoding: "utf8", shell: false },
  );
  if (sourceStatus.status !== 0 || sourceStatus.stdout.trim()) {
    fail("GBrain tracked runtime source closure must be clean before packaging.");
  }
  for (const [treePath, expectedTree] of [
    ["gbrain-adapter/src", PINNED_GBRAIN_RUNTIME.adapter.sourceGitTree],
    ["gbrain/src", PINNED_GBRAIN_RUNTIME.engine.sourceGitTree],
  ]) {
    const revision = spawnSync("git", ["-C", repoRoot, "rev-parse", `HEAD:${treePath}`], {
      encoding: "utf8",
      shell: false,
    });
    if (revision.status !== 0 || revision.stdout.trim() !== expectedTree) {
      fail(`GBrain immutable source tree ${treePath} is not pinned to ${expectedTree}.`);
    }
  }
  const adapterManifest = JSON.parse(fs.readFileSync(path.join(adapterSource, "package.json"), "utf8"));
  const engineManifest = JSON.parse(fs.readFileSync(path.join(engineSource, "package.json"), "utf8"));
  if (
    adapterManifest.name !== PINNED_GBRAIN_RUNTIME.adapter.package ||
    adapterManifest.version !== PINNED_GBRAIN_RUNTIME.adapter.version
  ) fail("GBrain adapter package identity does not match its reviewed runtime receipt.");
  if (
    engineManifest.name !== PINNED_GBRAIN_RUNTIME.engine.package ||
    engineManifest.version !== PINNED_GBRAIN_RUNTIME.engine.version
  ) fail("GBrain engine package identity does not match its reviewed runtime receipt.");
  if (fs.readFileSync(path.join(engineSource, "VERSION"), "utf8").trim() !== PINNED_GBRAIN_RUNTIME.engine.version) {
    fail("GBrain VERSION does not match its reviewed runtime receipt.");
  }
  for (const [filePath, expectedHash, label] of [
    [path.join(adapterSource, "package.json"), PINNED_GBRAIN_RUNTIME.adapter.packageSha256, "adapter package"],
    [path.join(adapterSource, "bun.lock"), PINNED_GBRAIN_RUNTIME.adapter.bunLockSha256, "adapter lock"],
    [path.join(engineSource, "package.json"), PINNED_GBRAIN_RUNTIME.engine.packageSha256, "engine package"],
    [path.join(engineSource, "bun.lock"), PINNED_GBRAIN_RUNTIME.engine.bunLockSha256, "engine lock"],
    [path.join(engineSource, "LICENSE"), PINNED_GBRAIN_RUNTIME.engine.licenseSha256, "engine license"],
    [path.join(engineSource, "UPSTREAM.json"), PINNED_GBRAIN_RUNTIME.engine.upstreamReceiptSha256, "engine upstream receipt"],
    [path.join(engineSource, "VERSION"), PINNED_GBRAIN_RUNTIME.engine.versionFileSha256, "engine version file"],
  ]) {
    const actualHash = canonicalFileIdentity(filePath).sha256;
    if (actualHash !== expectedHash) fail(`GBrain ${label} SHA-256 is not pinned (${actualHash}).`);
  }
  for (const [source, expected, label] of [
    [path.join(adapterSource, "src"), PINNED_GBRAIN_RUNTIME.adapter, "adapter"],
    [path.join(engineSource, "src"), PINNED_GBRAIN_RUNTIME.engine, "engine"],
  ]) {
    const identity = await sha256Tree(source);
    if (identity.sha256 !== expected.sourceSha256 || identity.fileCount !== expected.sourceFileCount) {
      fail(`GBrain ${label} source closure is not the reviewed immutable tree.`);
    }
  }

  log("staging GBrain adapter and vendored engine");
  freshDir(adapterTarget);
  for (const entry of ["package.json", "bun.lock", "src"]) {
    const source = path.join(adapterSource, entry);
    const target = path.join(adapterTarget, entry);
    if (fs.statSync(source).isDirectory()) copyTree(source, target);
    else fs.copyFileSync(source, target);
  }
  installBunProductionDependencies({
    label: "gbrain-adapter",
    target: adapterTarget,
    tempName: "breadboard-gbrain-adapter-install",
  });

  freshDir(engineTarget);
  for (const entry of ["package.json", "bun.lock", "src", "LICENSE", "UPSTREAM.json", "VERSION"]) {
    const source = path.join(engineSource, entry);
    const target = path.join(engineTarget, entry);
    if (fs.statSync(source).isDirectory()) copyTree(source, target);
    else fs.copyFileSync(source, target);
  }
  installBunProductionDependencies({
    label: "gbrain",
    target: engineTarget,
    tempName: "breadboard-gbrain-engine-install",
  });
  for (const [target, expected, label] of [
    [adapterTarget, PINNED_GBRAIN_RUNTIME.adapter, "adapter"],
    [engineTarget, PINNED_GBRAIN_RUNTIME.engine, "engine"],
  ]) {
    const dependencyManifest = JSON.parse(
      fs.readFileSync(path.join(target, "node_modules", "@electric-sql", "pglite", "package.json"), "utf8"),
    );
    if (dependencyManifest.version !== expected.pgliteVersion) {
      fail(`GBrain ${label} PGLite must be ${expected.pgliteVersion}; found ${dependencyManifest.version ?? "unknown"}.`);
    }
  }
  fs.writeFileSync(
    path.join(engineTarget, "runtime-artifact.json"),
    `${JSON.stringify(PINNED_GBRAIN_RUNTIME, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
}

// --- ComfyUI (Runtime V2 on-demand local image service) ------------------
// Models/cache/output remain mutable user data. Program source and the exact
// Breadboard-owned Windows CPU dependency authority are immutable package
// inputs; prepare-runtimes.mjs assembles the interpreter separately.
{
  const comfyUiSource = path.join(repoRoot, "comfyui");
  const comfyUiTarget = path.join(stagingRoot, "comfyui");
  log("staging ComfyUI source without models, cache, inputs, outputs, or user data");
  const excludedRoots = new Set([
    ".ci",
    ".git",
    ".github",
    "input",
    "models",
    "output",
    "script_examples",
    "temp",
    "tests",
    "tests-unit",
    "user",
  ]);
  await stagePinnedTrackedSourceClosure({
    label: "ComfyUI",
    sourceRoot: comfyUiSource,
    targetRoot: comfyUiTarget,
    expectedCommit: PINNED_PACKAGED_SERVICE_COMMITS.comfyUi,
    include: (relativePath) => {
      const components = relativePath.split("/");
      return (
        !excludedRoots.has(components[0]) &&
        !components.some((component) =>
          component === "__pycache__" || component === ".pytest_cache" || component === ".mypy_cache"
        ) &&
        !/\.(?:pyc|pyo|log)$/iu.test(relativePath)
      );
    },
    required: [
      "LICENSE",
      "main.py",
      "requirements.txt",
      "folder_paths.py",
      "server.py",
    ],
  });
  const comfyUiVendorRoot = path.join(desktopRoot, "runtime-v2", "vendor", "comfyui");
  for (const [fileName, expectedHash] of [
    ["constraints.packaged.txt", PINNED_COMFYUI_RUNTIME.dependencyLock.constraintsSha256],
    ["pylock.packaged.toml", PINNED_COMFYUI_RUNTIME.dependencyLock.lockSha256],
  ]) {
    const source = path.join(comfyUiVendorRoot, fileName);
    if (!fs.existsSync(source)) fail(`ComfyUI packaged dependency authority is missing ${source}.`);
    const identity = canonicalFileIdentity(source);
    if (identity.sha256 !== expectedHash) {
      fail(`ComfyUI ${fileName} is not the reviewed immutable file (${identity.sha256}).`);
    }
    fs.copyFileSync(source, path.join(comfyUiTarget, fileName));
  }
  fs.writeFileSync(
    path.join(comfyUiTarget, "runtime-artifact.json"),
    `${JSON.stringify(PINNED_COMFYUI_RUNTIME, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
}

// --- ui-tars-adapter (browser + actual-desktop sidecar; optional runtime) --
// Stage source, then produce a clean production install on a local temp disk.
// This includes Agent TARS' isolated-browser dependencies and the official
// NutJS Windows desktop operator. Chromium remains external; a system
// Chrome/Edge is located at runtime for isolated-browser mode.
if (fs.existsSync(path.join(repoRoot, "ui-tars-adapter"))) {
  log("staging ui-tars-adapter source and production dependencies");
  const uiTarsTarget = path.join(stagingRoot, "ui-tars-adapter");
  freshDir(uiTarsTarget);
  copyTree(path.join(repoRoot, "ui-tars-adapter"), uiTarsTarget, (rel) =>
    /(^|\/)node_modules(\/|$)/.test(rel) || /(^|\/)test(\/|$)/.test(rel),
  );
  installProductionDependencies({
    label: "ui-tars-adapter",
    target: uiTarsTarget,
    tempName: "breadboard-ui-tars-adapter-install",
    command: "ci",
  });
}

// --- licenses -------------------------------------------------------------
log("staging license notices");
const licensesTarget = path.join(desktopRoot, "build-resources", "licenses");
fs.mkdirSync(licensesTarget, { recursive: true });
const licenseSources = [
  ["agency-agents", path.join(repoRoot, "agency-agents", "LICENSE")],
  ["book-to-skill", path.join(repoRoot, "book-to-skill", "LICENSE.md")],
  ["chatmock", path.join(repoRoot, "chatmock", "LICENSE")],
  ["codex", path.join(repoRoot, "codex", "LICENSE")],
  ["comfyui", path.join(repoRoot, "comfyui", "LICENSE")],
  ["goal", path.join(repoRoot, "goal", "LICENSE")],
  ["gbrain", path.join(repoRoot, "gbrain", "LICENSE")],
  ["hermes-agent", path.join(hermesRoot, "LICENSE")],
  ["humanizer-THIRD-PARTY-NOTICES", path.join(repoRoot, "humanizer-service", "THIRD_PARTY_NOTICES.md")],
  ["mem0", path.join(repoRoot, "mem0", "LICENSE")],
  ["openGym", path.join(repoRoot, "openGym", "LICENSE")],
  ["openscience", path.join(repoRoot, "openscience", "LICENSE")],
  ["scientific-agent-skills", path.join(scientificSkillsRoot, "LICENSE.md")],
  ["quartz", path.join(repoRoot, "quartz", "LICENSE.txt")],
  ["postiz", path.join(desktopRoot, "runtime-v2", "vendor", "postiz", "source", "LICENSE")],
  ["inbox-zero", path.join(desktopRoot, "runtime-v2", "vendor", "inbox-zero", "source", "LICENSE")],
  ["voicebox", path.join(repoRoot, "voicebox", "LICENSE")],
  ["wardrobe", path.join(repoRoot, "wardrobe", "LICENSE")],
];
for (const [name, source] of licenseSources) {
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(licensesTarget, `${name}-LICENSE.txt`));
  }
}

// Sanity guard: no databases or env files may be staged.
const forbidden = [];
function scanForbidden(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanForbidden(full);
    } else if (/\.(db|db-shm|db-wal)$/.test(entry.name) || /^\.env($|\.)/.test(entry.name)) {
      // .env.example files are documentation, not secrets.
      if (entry.name.endsWith(".example")) continue;
      // Third-party packages sometimes ship an empty .env of their own (psl@1.9.0
      // is one). A zero-byte file inside node_modules holds
      // no secret, and blocking it only stops the build. Both conditions are
      // required: anything with content, or anywhere outside node_modules, still
      // fails as before.
      const insideDependencies = full.split(path.sep).includes("node_modules");
      if (insideDependencies && fs.statSync(full).size === 0) continue;
      forbidden.push(full);
    }
  }
}
scanForbidden(stagingRoot);

// Manifests live beside bundled executable runtimes, not beneath app-services.
// Keeping this a direct byte-for-byte stage makes the checked-in definitions
// the sole package authority and prevents a packaging transform from inventing
// different launch paths.
log("staging Runtime V2 launch manifests");
freshDir(runtimeV2ManifestTarget);
copyTree(runtimeV2ManifestSource, runtimeV2ManifestTarget);
if (forbidden.length > 0) {
  fail(`Mutable data or env secrets staged into resources:\n  ${forbidden.join("\n  ")}`);
}
log("done");
