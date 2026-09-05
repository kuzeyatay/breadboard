// Fails when the assembled staging roots (and, when present, the packaged
// win-unpacked output) are missing required binaries or contain data/secrets
// that must never ship. Run before and after electron-builder.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SOURCE_COMMIT_RECEIPT_NAME } from "./pinned-source-checkout.mjs";
import { findNestedDashboardRuntimeDuplicates } from "./packaged-dashboard-input.mjs";
import { voiceboxArtifactReceiptProblems } from "./voicebox-artifact-receipt.mjs";
import { PINNED_VLM_OCR_RUNTIME } from "./vlm-ocr-runtime-artifact.mjs";
import {
  PATENT_DISCLOSURE_REQUIRED_FILES,
  PATENT_DISCLOSURE_UPSTREAM_COMMIT,
} from "./patent-disclosure-package.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const hashChecks = [];
const treeHashChecks = [];
const PINNED_PYTHON_EXE_SHA256 = "08A64DC73AC3E3776B49F0097C6306BDB9C8F7990A037065213324D328467BF5";
const PINNED_UV_EXE_SHA256 = "8DA6CEDEF60C27AC997EBF400FBFC6D373C5B0A7AE6A299B9D52BE7FE63723FB";
const PINNED_LOCAL_SOURCE_COMMITS = Object.freeze({
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
    executableSha256: PINNED_UV_EXE_SHA256,
  },
  source: {
    upstreamCommit: PINNED_PACKAGED_SERVICE_COMMITS.comfyUi,
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
    "node_modules/@synsci/openscience/bin/openscience": { size: 7_903, sha256: "EC3237E7D0A347C44286EBE42842268BB69F6C5A17B67490C494AE9EEC0B914D" },
    "node_modules/@synsci/openscience/package.json": { size: 1_023, sha256: "B787187248830064F8CF685EC6F33E0C53D74FC2AE446DB07A82CD57114C20B5" },
    "node_modules/@synsci/openscience-windows-x64/bin/openscience.exe": { size: 163_131_904, sha256: "F1398B6555A98991321D3A1DCE2F88AC18D2914411D58D0D73D75EE9530A6190" },
    "node_modules/@synsci/openscience-windows-x64/package.json": { size: 236, sha256: "4F96FA6B680D86ACC84737CDF7CBBDB5E5DB142DD7A8D1624810592BBA1FAD79" },
    "node_modules/@synsci/openscience-windows-x64-baseline/bin/openscience.exe": { size: 162_408_960, sha256: "5E22FA211B78F762953D0B546ABF9FC17D90589FF524B9C62F09273150714D82" },
    "node_modules/@synsci/openscience-windows-x64-baseline/package.json": { size: 245, sha256: "0194E2675E9CD01CAD65B341AF846EF7C99660783C2A0CF1500BD1DC7978CB56" },
  },
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
const PINNED_RUFLO_RUNTIME = {
  schemaVersion: 1,
  ruflo: {
    package: "@claude-flow/cli",
    version: "3.34.0",
    reviewedCheckoutCommit: "4ac1ab9ff3ee8f0406cfa97fe463944d9b110e9a",
    npmIntegrity: "sha512-jlMyHEGMxvngwcE4HHpkILLf8lMJaFGoMVo2aevEoyAMyF5V4Nly1cdqz31RCTKLNgA4nvLvH3eRZ1OaM9JCnA==",
    dependencyLockSha256: "DE89BCAE18FF05726012A2BF6F8E14EC054411CB3B98A54A01C6EDD8FE5CD53A",
    wrapperSha256: "52134740D49ECC69F2EB4BE72DA8218DA05E81AF9C1FD1813160041D13D88D9E",
    entrypointSha256: "4EC921923FB00AD86F89B171B0DBC293A1EC613C8CE0A20CBDC8169D4C836E51",
    distEntrypointSha256: "E219547441EE029B8447715FFCBC2B80C4DF4DA1ED8CB0FD1B936034973CB019",
    licenseSha256: "D5F6D91BA2E65A09F157CD1336034804E850FCAC3296684221368B3F26FA6CCF",
    omittedDependencyClasses: ["dev", "optional"],
  },
  claudeCode: {
    name: "Claude Code",
    version: "2.1.239",
    platform: "win32",
    architecture: "x64",
    sha256: "0BC1304C7847C317CC550007E7561F9BF270EAA68A0E85A3F381AFB18EE20A2B",
    size: 337_672_352,
  },
};
const PINNED_GBRAIN_RUNTIME = {
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
};
const PACKAGED_SERVICE_UV_VERSION = "0.12.5";
const PACKAGED_PYTHON_SERVICES = Object.freeze([
  {
    id: "cad", package: "breadboard-cad", packageVersion: "1.0.0",
    serviceDirectory: "cad-service", moduleDirectory: "breadboard_cad", runtimeDirectory: "cad-python",
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
    dependencyLicensePaths: ["cadquery-2.6.0.dist-info/licenses/LICENSE"],
    smokeImports: "import cadquery, OCP, pydantic, breadboard_cad.server, breadboard_cad.cadquery_engine",
    hardExitAfterSmoke: true,
  },
  {
    id: "colpali", package: "breadboard-colpali", packageVersion: "1.0.0",
    serviceDirectory: "colpali-service", moduleDirectory: "breadboard_colpali", runtimeDirectory: "colpali-python",
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
    dependencyLicensePaths: [
      "colpali_engine-0.3.17.dist-info/licenses/LICENSE",
      "torch-2.6.0.dist-info/LICENSE",
      "torch-2.6.0.dist-info/NOTICE",
    ],
    smokeImports: "import colpali_engine, numpy, PIL, pydantic, torch, transformers, breadboard_colpali.server; from colpali_engine.models import ColIdefics3, ColIdefics3Processor",
  },
  {
    id: "humanizer", package: "breadboard-humanizer", packageVersion: "1.0.0",
    serviceDirectory: "humanizer-service", moduleDirectory: "breadboard_humanizer", runtimeDirectory: "humanizer-python",
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
    dependencyLicensePaths: [
      "safetensors-0.8.0.dist-info/licenses/LICENSE",
      "torch-2.6.0.dist-info/LICENSE",
      "torch-2.6.0.dist-info/NOTICE",
      "transformers-4.57.6.dist-info/licenses/LICENSE",
    ],
    smokeImports: "import pydantic, safetensors, sentencepiece, torch, transformers, breadboard_humanizer.server; from transformers import AutoModelForSeq2SeqLM, AutoTokenizer",
  },
  {
    id: "solidworks-mcp", package: "solidworks-mcp-python", packageVersion: "1.0.1",
    serviceDirectory: "SolidworksMCP-python", moduleDirectory: "src/solidworks_mcp",
    packagedImportSubdirectory: "src", entrypointFile: "server.py",
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
    dependencyLicensePaths: [],
    smokeImports:
      "import comtypes, fastmcp, mcp, pydantic, win32com.client, solidworks_mcp.config, solidworks_mcp.server",
    externalBoundary: ["locally licensed Windows SolidWorks installation and COM automation"],
  },
]);

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
    uv: { version: PACKAGED_SERVICE_UV_VERSION, executableSha256: PINNED_UV_EXE_SHA256 },
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

function receiptsMatch(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function sha256Tree(root, skip = () => false) {
  const records = [];
  async function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
      if (skip(relativePath, entry)) continue;
      const metadata = fs.lstatSync(fullPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`source closure contains a symlink: ${fullPath}`);
      }
      if (metadata.isDirectory()) {
        await visit(fullPath);
      } else if (metadata.isFile()) {
        const identity = canonicalFileIdentity(fullPath);
        records.push(`${relativePath}\0${identity.size}\0${identity.sha256}\n`);
      } else {
        throw new Error(`source closure contains a non-file entry: ${fullPath}`);
      }
    }
  }
  await visit(root);
  return {
    sha256: createHash("sha256").update(records.join("")).digest("hex").toUpperCase(),
    fileCount: records.length,
  };
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) problems.push(`missing ${label}: ${filePath}`);
}

function requireDirectFile(filePath, label) {
  requireFile(filePath, label);
  if (!fs.existsSync(filePath)) return;
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    problems.push(`${label} must be a direct regular file: ${filePath}`);
  }
}

function requireDirectory(directoryPath, label) {
  if (!fs.existsSync(directoryPath)) {
    problems.push(`missing ${label}: ${directoryPath}`);
    return;
  }
  if (!fs.statSync(directoryPath).isDirectory()) {
    problems.push(`${label} must be a directory: ${directoryPath}`);
  }
}

function compilerReceiptKeys(value, expected) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function compilerClosureFiles(root, label) {
  const files = [];
  const visit = (candidate) => {
    if (!fs.existsSync(candidate)) return;
    const metadata = fs.lstatSync(candidate);
    if (metadata.isSymbolicLink()) {
      problems.push(`${label} contains a link or junction: ${candidate}`);
      return;
    }
    if (metadata.isDirectory()) {
      for (const name of fs.readdirSync(candidate).sort()) visit(path.join(candidate, name));
      return;
    }
    if (!metadata.isFile()) {
      problems.push(`${label} contains a non-file entry: ${candidate}`);
      return;
    }
    files.push(path.relative(root, candidate).split(path.sep).join("/"));
  };
  visit(root);
  return files.sort();
}

function checkDashboardCompilerRuntime(dashboard, bundledNode, label) {
  const receiptPath = path.join(dashboard, "breadboard-runtime-dependencies.json");
  requireDirectFile(receiptPath, `${label} dashboard compiler runtime receipt`);
  if (!fs.existsSync(receiptPath)) return;

  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch {
    problems.push(`${label} dashboard compiler runtime receipt is invalid JSON`);
    return;
  }
  if (
    !compilerReceiptKeys(receipt, ["version", "dependencies"]) ||
    receipt.version !== 1 ||
    !compilerReceiptKeys(receipt.dependencies, ["esbuild", "three", "typescript"])
  ) {
    problems.push(`${label} dashboard compiler runtime receipt has an unexpected schema`);
    return;
  }

  const esbuild = receipt.dependencies.esbuild;
  const typescript = receipt.dependencies.typescript;
  const three = receipt.dependencies.three;
  if (
    !compilerReceiptKeys(esbuild, ["version", "platform", "arch", "platformPackage", "files"]) ||
    typeof esbuild.version !== "string" ||
    esbuild.platform !== "win32" ||
    !["x64", "arm64", "ia32"].includes(esbuild.arch) ||
    esbuild.platformPackage !== `@esbuild/win32-${esbuild.arch}` ||
    !Array.isArray(esbuild.files) ||
    !compilerReceiptKeys(typescript, ["version", "files"]) ||
    typeof typescript.version !== "string" ||
    !Array.isArray(typescript.files) ||
    !compilerReceiptKeys(three, ["version", "files"]) ||
    typeof three.version !== "string" ||
    !Array.isArray(three.files)
  ) {
    problems.push(`${label} dashboard compiler dependency identities are invalid`);
    return;
  }

  const expectedFiles = [
    "node_modules/esbuild/package.json",
    "node_modules/esbuild/lib/main.js",
    "node_modules/esbuild/LICENSE.md",
    `node_modules/${esbuild.platformPackage}/package.json`,
    `node_modules/${esbuild.platformPackage}/esbuild.exe`,
    "node_modules/typescript/package.json",
    "node_modules/typescript/lib/typescript.js",
    "node_modules/typescript/LICENSE.txt",
    "node_modules/typescript/ThirdPartyNoticeText.txt",
    "node_modules/three/package.json",
    "node_modules/three/build/three.module.js",
    "node_modules/three/build/three.core.js",
    "node_modules/three/LICENSE",
  ].sort();
  const receiptFiles = [...esbuild.files, ...typescript.files, ...three.files];
  const receivedPaths = receiptFiles.map((entry) => entry?.path).sort();
  if (
    receiptFiles.length !== expectedFiles.length ||
    JSON.stringify(receivedPaths) !== JSON.stringify(expectedFiles)
  ) {
    problems.push(`${label} dashboard compiler receipt is not the exact reviewed file closure`);
    return;
  }

  const dashboardRoot = path.resolve(dashboard);
  for (const entry of receiptFiles) {
    if (
      !compilerReceiptKeys(entry, ["path", "bytes", "sha256"]) ||
      typeof entry.path !== "string" ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 1 ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? "")
    ) {
      problems.push(`${label} dashboard compiler receipt contains an invalid file identity`);
      continue;
    }
    const filePath = path.resolve(dashboardRoot, ...entry.path.split("/"));
    const relative = path.relative(dashboardRoot, filePath);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      problems.push(`${label} dashboard compiler receipt path escapes its root: ${entry.path}`);
      continue;
    }
    requireDirectFile(filePath, `${label} dashboard compiler ${entry.path}`);
    if (fs.existsSync(filePath)) {
      const canonical = fs.realpathSync.native(filePath);
      if (path.resolve(canonical).toLowerCase() !== path.resolve(filePath).toLowerCase()) {
        problems.push(`${label} dashboard compiler file traverses a link: ${entry.path}`);
      }
      hashChecks.push({
        filePath,
        expectedHash: entry.sha256.toUpperCase(),
        expectedSize: entry.bytes,
        label: `${label} dashboard compiler ${entry.path}`,
      });
    }
  }

  const actualFiles = [
    ...compilerClosureFiles(path.join(dashboard, "node_modules", "esbuild"), `${label} esbuild closure`)
      .map((relative) => `node_modules/esbuild/${relative}`),
    ...compilerClosureFiles(path.join(dashboard, "node_modules", "@esbuild"), `${label} native esbuild closure`)
      .map((relative) => `node_modules/@esbuild/${relative}`),
    ...compilerClosureFiles(path.join(dashboard, "node_modules", "typescript"), `${label} TypeScript closure`)
      .map((relative) => `node_modules/typescript/${relative}`),
    ...compilerClosureFiles(path.join(dashboard, "node_modules", "three"), `${label} Three.js closure`)
      .map((relative) => `node_modules/three/${relative}`),
  ].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    problems.push(`${label} staged dashboard compiler tree contains missing or unreviewed files`);
  }

  const esbuildPackagePath = path.join(dashboard, "node_modules", "esbuild", "package.json");
  const nativePackagePath = path.join(
    dashboard,
    "node_modules",
    ...esbuild.platformPackage.split("/"),
    "package.json",
  );
  const typescriptPackagePath = path.join(dashboard, "node_modules", "typescript", "package.json");
  const threePackagePath = path.join(dashboard, "node_modules", "three", "package.json");
  if (
    [esbuildPackagePath, nativePackagePath, typescriptPackagePath, threePackagePath]
      .every((candidate) => fs.existsSync(candidate))
  ) {
    try {
      const esbuildPackage = JSON.parse(fs.readFileSync(esbuildPackagePath, "utf8"));
      const nativePackage = JSON.parse(fs.readFileSync(nativePackagePath, "utf8"));
      const typescriptPackage = JSON.parse(fs.readFileSync(typescriptPackagePath, "utf8"));
      const threePackage = JSON.parse(fs.readFileSync(threePackagePath, "utf8"));
      const nativeBinaryReceipt = esbuild.files.find(
        (entry) => entry.path === `node_modules/${esbuild.platformPackage}/esbuild.exe`,
      );
      const binaryHashKey = `${esbuild.platformPackage}/esbuild.exe`;
      if (
        esbuildPackage.name !== "esbuild" ||
        esbuildPackage.version !== esbuild.version ||
        esbuildPackage.main !== "lib/main.js" ||
        esbuildPackage.optionalDependencies?.[esbuild.platformPackage] !== esbuild.version ||
        esbuildPackage["esbuild.binaryHashes"]?.[binaryHashKey] !== nativeBinaryReceipt?.sha256 ||
        nativePackage.name !== esbuild.platformPackage ||
        nativePackage.version !== esbuild.version ||
        !nativePackage.os?.includes(esbuild.platform) ||
        !nativePackage.cpu?.includes(esbuild.arch) ||
        typescriptPackage.name !== "typescript" ||
        typescriptPackage.version !== typescript.version ||
        typescriptPackage.main !== "./lib/typescript.js" ||
        threePackage.name !== "three" ||
        threePackage.version !== three.version ||
        threePackage.exports?.["."]?.import !== "./build/three.module.js"
      ) {
        problems.push(`${label} dashboard compiler package metadata does not match its receipt`);
      }
    } catch {
      problems.push(`${label} dashboard compiler package metadata is invalid JSON`);
    }
  }

  if (fs.existsSync(bundledNode)) {
    const compilerModuleUrl = pathToFileURL(path.join(
      dashboard,
      "worker-src",
      "lib",
      "hermes",
      "interactive-visualizer-custom.ts",
    )).href;
    const probe = spawnSync(
      bundledNode,
      [
        "--input-type=module",
        "-e",
        [
          `const { bundleCustomInteractiveVisualizer } = await import(${JSON.stringify(compilerModuleUrl)});`,
          'const result = await bundleCustomInteractiveVisualizer({manifest:{mode:"3d",title:"Packaged compiler probe"},files:{"index.html":"<main id=\\"app\\"><canvas></canvas></main><script src=\\"main.js\\"></script>","styles.css":"canvas{display:block}","main.js":"const scene=new THREE.Scene();void scene;"}});',
          'if (!result.html.includes("breadboard:interactive-visualizer:v1")) process.exit(2);',
        ].join(""),
      ],
      {
        cwd: path.dirname(dashboard),
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        env: { ...process.env, ESBUILD_BINARY_PATH: "" },
      },
    );
    if (probe.status !== 0) {
      const output = `${probe.stderr ?? ""}\n${probe.stdout ?? ""}`.trim();
      problems.push(`${label} packaged dashboard compiler probe failed: ${output || "unknown error"}`);
    }
  }
}

const PACKAGED_SERVICE_CLOSURE_POLICIES = Object.freeze({
  chatmock: { dataRoot: "none", bootstrap: ["app-root:chatmock/chatmock.py"] },
  dashboard: { dataRoot: "none", bootstrap: ["app-root:dashboard-standalone/dashboard/server.js"] },
  hermes: { dataRoot: "none", bootstrap: ["app-root:hermes-agent/breadboard_runtime.py", "app-root:hermes-agent/hermes_cli/main.py"] },
  gbrain: { dataRoot: "none", bootstrap: ["app-root:gbrain/runtime-artifact.json"] },
  comfyui: {
    dataRoot: "writable-state",
    bootstrap: [
      "app-root:comfyui/runtime-artifact.json",
      "app-root:comfyui/pylock.packaged.toml",
      "runtime-root:runtimes/comfyui-python/runtime-artifact.json",
    ],
  },
  "telegram-gateway": { dataRoot: "none", bootstrap: ["app-root:dashboard/scripts/runtime-v2-telegram-gateway-service.mjs"] },
  "whatsapp-gateway": { dataRoot: "none", bootstrap: ["app-root:dashboard/scripts/runtime-v2-whatsapp-gateway-service.mjs"] },
  openwork: {
    dataRoot: "none",
    bootstrap: [
      "app-root:openwork-runtime/runtime-artifact.json",
      "app-root:openwork-runtime/apps/server/src/cli.ts",
      "app-root:openwork-runtime/apps/server/node_modules/@opencode-ai/sdk/package.json",
      "runtime-root:runtimes/bun/bun.exe",
      "app-root:opencode/bin/opencode.exe",
    ],
  },
  openscience: { dataRoot: "none", bootstrap: ["app-root:openscience-cli/runtime-artifact.json"] },
  "money-printer": {
    dataRoot: "managed-install",
    bootstrap: [
      "app-root:MoneyPrinterTurbo/BREADBOARD_SOURCE_ARTIFACT.json",
      "app-root:MoneyPrinterTurbo/uv.lock",
      "app-root:dashboard/scripts/runtime-v2-managed-setup-executor.mjs",
    ],
  },
  wardrobe: {
    dataRoot: "writable-state",
    bootstrap: [
      "app-root:wardrobe/BREADBOARD_SOURCE_ARTIFACT.json",
      "app-root:wardrobe-runtime/runtime-artifact.json",
      "app-root:wardrobe-runtime/node_modules/vite/bin/vite.js",
      "app-root:wardrobe-runtime/node_modules/sharp/package.json",
    ],
  },
  penecho: { dataRoot: "none", bootstrap: ["app-root:penecho/BREADBOARD_SOURCE_COMMIT"] },
  "vlm-ocr": {
    dataRoot: "none",
    bootstrap: [
      "app-root:dashboard/scripts/runtime-v2-vlm-ocr-service.mjs",
      "runtime-root:bin/vlm-ocr/runtime-artifact.json",
    ],
  },
  recall: { dataRoot: "writable-state", bootstrap: ["runtime-root:bin/recall/runtime-artifact.json"] },
  "mem0-semantic-engine": {
    dataRoot: "writable-state",
    bootstrap: ["app-root:dashboard/node_modules/mem0ai/runtime-artifact.json"],
  },
  "local-mcp-broker": {
    dataRoot: "none",
    bootstrap: ["app-root:dashboard/scripts/runtime-v2-local-mcp-broker-service.mjs"],
    externalBoundary: ["one user-approved executable bound by path, size, and SHA-256 per launch"],
  },
  "postiz-coordinator": {
    dataRoot: "external-boundary",
    bootstrap: [
      "app-root:scripts/start-postiz-supervisor.mjs",
      "app-root:postiz-app/oci-images.json",
    ],
    externalBoundary: ["Docker Desktop and OCI registry access"],
  },
  "inbox-zero-stack": {
    dataRoot: "external-boundary",
    bootstrap: [
      "app-root:dashboard/scripts/runtime-v2-inbox-zero-service.mjs",
      "app-root:inbox-zero/oci-images.json",
    ],
    externalBoundary: ["Docker Desktop, OCI registry access, and user-provided mailbox OAuth credentials"],
  },
  "spotify-playback": {
    dataRoot: "writable-state",
    bootstrap: ["app-root:dashboard/scripts/runtime-v2-spotify-playback-service.mjs"],
    externalBoundary: ["installed Edge or Chrome, Spotify Premium account, and Spotify network access"],
  },
  cliproxy: { dataRoot: "none", bootstrap: ["runtime-root:bin/cliproxy-runtime-artifact.json"] },
  quartz: { dataRoot: "none", bootstrap: ["app-root:dashboard/scripts/runtime-v2-quartz-static-service.mjs"] },
  "ui-tars": { dataRoot: "none", bootstrap: ["app-root:ui-tars-adapter/package.json"] },
  cad: { dataRoot: "none", bootstrap: ["app-root:cad-service/runtime-artifact.json"] },
  "solidworks-mcp": {
    dataRoot: "writable-state",
    bootstrap: [
      "app-root:dashboard/scripts/runtime-v2-solidworks-mcp-service.mjs",
      "app-root:SolidworksMCP-python/runtime-artifact.json",
      "runtime-root:runtimes/solidworks-python/runtime-artifact.json",
    ],
    externalBoundary: ["locally licensed Windows SolidWorks installation and COM automation"],
  },
  colpali: {
    dataRoot: "none",
    bootstrap: ["app-root:colpali-service/runtime-artifact.json"],
    externalBoundary: ["user-provisioned ColPali model weights in data-root storage"],
  },
  humanizer: {
    dataRoot: "none",
    bootstrap: ["app-root:humanizer-service/runtime-artifact.json"],
    externalBoundary: ["user-provisioned Humanizer model weights in data-root storage"],
  },
  voicebox: {
    dataRoot: "writable-state",
    bootstrap: ["runtime-root:bin/voicebox-runtime-artifact.json"],
    externalBoundary: ["on-demand speech-model assets stored under the writable Voicebox data root"],
  },
  scriberr: { dataRoot: "none", bootstrap: ["runtime-root:bin/transcription-runtime.json"] },
  "deep-research": { dataRoot: "none", bootstrap: ["app-root:deep-research/BREADBOARD_SOURCE_ARTIFACT.json"] },
  "deer-flow": {
    dataRoot: "managed-install",
    bootstrap: [
      "app-root:deer-flow/BREADBOARD_SOURCE_ARTIFACT.json",
      "app-root:deer-flow/backend/uv.lock",
      "app-root:dashboard/scripts/runtime-v2-managed-setup-executor.mjs",
    ],
  },
  "vibe-trading": {
    dataRoot: "managed-install",
    bootstrap: [
      "app-root:Vibe-Trading/BREADBOARD_SOURCE_ARTIFACT.json",
      "app-root:Vibe-Trading/requirements-lock.txt",
      "app-root:dashboard/scripts/runtime-v2-managed-setup-executor.mjs",
    ],
  },
  "stock-analyst": {
    dataRoot: "managed-install",
    bootstrap: [
      "app-root:daily_stock_analysis/BREADBOARD_SOURCE_ARTIFACT.json",
      "app-root:daily_stock_analysis/requirements.lock",
      "app-root:dashboard/scripts/runtime-v2-managed-setup-executor.mjs",
    ],
  },
});

function packagedAuthorityPath(resources, binRoot, authority, relativePath) {
  const components = relativePath.split("/");
  if (authority === "app-root") {
    return path.join(resources, "app-services", ...components);
  }
  if (authority === "runtime-root") {
    return components[0] === "bin"
      ? path.join(binRoot, ...components.slice(1))
      : path.join(resources, ...components);
  }
  throw new Error(`authority ${authority} is not an immutable packaged authority`);
}

function checkPackagedServiceProfiles(resources, binRoot, label, manifest) {
  if (!Array.isArray(manifest?.services)) {
    problems.push(`${label} Runtime V2 services.json has no services array`);
    return;
  }
  const manifestIds = manifest.services.map((service) => service?.id);
  const policyIds = Object.keys(PACKAGED_SERVICE_CLOSURE_POLICIES);
  if (
    manifestIds.length !== 32 ||
    new Set(manifestIds).size !== manifestIds.length ||
    [...manifestIds].sort().join("\0") !== [...policyIds].sort().join("\0")
  ) {
    problems.push(
      `${label} packaged service closure matrix must cover the exact 32 manifest services`,
    );
  }
  for (const service of manifest.services) {
    const policy = PACKAGED_SERVICE_CLOSURE_POLICIES[service.id];
    if (!policy) continue;
    if (!new Set(["none", "managed-install", "writable-state", "external-boundary"]).has(policy.dataRoot)) {
      problems.push(`${label} packaged service ${service.id} has an invalid data-root policy`);
    }
    if (
      policy.externalBoundary !== undefined &&
      (!Array.isArray(policy.externalBoundary) ||
        policy.externalBoundary.length < 1 ||
        policy.externalBoundary.some(
          (boundary) =>
            typeof boundary !== "string" ||
            !boundary.trim() ||
            Buffer.byteLength(boundary, "utf8") > 512,
        ))
    ) {
      problems.push(`${label} packaged service ${service.id} has an invalid external boundary`);
    }
    for (const bootstrap of policy.bootstrap) {
      const separator = bootstrap.indexOf(":");
      const authority = bootstrap.slice(0, separator);
      const relativePath = bootstrap.slice(separator + 1);
      try {
        requireDirectFile(
          packagedAuthorityPath(resources, binRoot, authority, relativePath),
          `${label} packaged service ${service.id} immutable bootstrap ${relativePath}`,
        );
      } catch (error) {
        problems.push(`${label} packaged service ${service.id} has an invalid closure matrix row`);
      }
    }
    if (policy.releaseBlocker) {
      problems.push(`${label} packaged service ${service.id} release blocker: ${policy.releaseBlocker}`);
    }
    const packagedProfiles = (service.launchProfiles ?? []).filter(
      (profile) => Array.isArray(profile.modes) && profile.modes.includes("packaged"),
    );
    if (packagedProfiles.length !== 1) {
      problems.push(`${label} packaged service ${service.id} must have exactly one packaged profile`);
      continue;
    }
    for (const [profileIndex, profile] of packagedProfiles.entries()) {
      const profileLabel = `${label} packaged service ${service.id} profile ${profileIndex + 1}`;
      const dataRootReferences = [];
      if (profile.executableAuthority === "data-root") {
        dataRootReferences.push({ kind: "runtime-prerequisite", path: profile.allowedExecutable });
      } else {
        try {
          requireDirectFile(
            packagedAuthorityPath(
              resources,
              binRoot,
              profile.executableAuthority,
              profile.allowedExecutable,
            ),
            `${profileLabel} executable`,
          );
        } catch (error) {
          problems.push(`${profileLabel} executable authority is invalid`);
        }
      }

      for (const [argumentIndex, argument] of (profile.arguments ?? []).entries()) {
        if (argument.kind === "app-path") {
          requireDirectFile(
            path.join(resources, "app-services", ...argument.path.split("/")),
            `${profileLabel} app-path argument ${argumentIndex + 1}`,
          );
        } else if (argument.kind === "data-path") {
          dataRootReferences.push({ kind: "writable-data", path: argument.path });
        }
      }

      if (profile.workingDirectory?.kind === "app-subdirectory") {
        requireDirectory(
          path.join(resources, "app-services", ...profile.workingDirectory.path.split("/")),
          `${profileLabel} working directory`,
        );
      } else if (profile.workingDirectory?.kind === "app-root") {
        requireDirectory(path.join(resources, "app-services"), `${profileLabel} working directory`);
      } else if (profile.workingDirectory?.kind === "data-subdirectory") {
        dataRootReferences.push({ kind: "writable-data", path: profile.workingDirectory.path });
      } else if (profile.workingDirectory?.kind === "hot-development-workspace") {
        problems.push(`${profileLabel} uses a hot-only working directory in packaged mode`);
      } else {
        problems.push(`${profileLabel} working directory policy is invalid`);
      }

      if (profile.installProbe?.kind !== "files-present") {
        problems.push(`${profileLabel} has no files-present install probe`);
        continue;
      }
      for (const probe of profile.installProbe.files ?? []) {
        if (probe.authority === "data-root") {
          dataRootReferences.push({ kind: "runtime-prerequisite", path: probe.path });
          continue;
        }
        try {
          requireDirectFile(
            packagedAuthorityPath(resources, binRoot, probe.authority, probe.path),
            `${profileLabel} install probe ${probe.path}`,
          );
        } catch (error) {
          problems.push(`${profileLabel} install probe ${probe.path} has an invalid authority`);
        }
      }
      if (dataRootReferences.length > 0 && policy.dataRoot === "none") {
        problems.push(
          `${profileLabel} uses data-root without an audited managed-install or writable-state boundary`,
        );
      }
      if (
        dataRootReferences.some((reference) => reference.kind === "runtime-prerequisite") &&
        policy.dataRoot !== "managed-install"
      ) {
        problems.push(
          `${profileLabel} has a data-root executable/install probe without a managed immutable bootstrap`,
        );
      }
      if (
        policy.dataRoot === "writable-state" &&
        dataRootReferences.some((reference) => reference.kind === "runtime-prerequisite")
      ) {
        problems.push(`${profileLabel} writable-state boundary contains a runtime prerequisite`);
      }
    }
  }
}

function requireSourceCommitReceipt(sourceRoot, label, expectedCommit) {
  const receiptPath = path.join(sourceRoot, SOURCE_COMMIT_RECEIPT_NAME);
  requireDirectFile(receiptPath, `${label} source commit receipt`);
  if (!fs.existsSync(receiptPath)) return;
  const metadata = fs.lstatSync(receiptPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) return;
  if (fs.readFileSync(receiptPath, "utf8") !== `${expectedCommit}\n`) {
    problems.push(`${label} source revision is not pinned to ${expectedCommit}`);
  }
}

function requirePinnedSourceArtifact(sourceRoot, label, expectedCommit, requiredPaths) {
  requireSourceCommitReceipt(sourceRoot, label, expectedCommit);
  const receiptPath = path.join(sourceRoot, SOURCE_ARTIFACT_RECEIPT_NAME);
  requireDirectFile(receiptPath, `${label} immutable source artifact receipt`);
  if (!fs.existsSync(receiptPath)) return;
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    if (
      Object.keys(receipt ?? {}).sort().join(",") !== "files,schemaVersion,sourceCommit" ||
      receipt.schemaVersion !== 1 ||
      receipt.sourceCommit !== expectedCommit ||
      !Array.isArray(receipt.files) ||
      receipt.files.length < 1 ||
      receipt.files.length > 50_000
    ) {
      problems.push(`${label} immutable source artifact receipt has an invalid envelope`);
      return;
    }
    const seen = new Set();
    let previousPath = "";
    for (const [index, file] of receipt.files.entries()) {
      const relativePath = file?.path;
      if (
        Object.keys(file ?? {}).sort().join(",") !== "path,sha256,size" ||
        typeof relativePath !== "string" ||
        !relativePath ||
        relativePath.includes("\\") ||
        path.posix.isAbsolute(relativePath) ||
        relativePath.split("/").some((component) => !component || component === "." || component === "..") ||
        seen.has(relativePath) ||
        (index > 0 && relativePath <= previousPath) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        !/^[0-9A-F]{64}$/u.test(file.sha256 ?? "")
      ) {
        problems.push(`${label} immutable source artifact receipt contains an invalid file row`);
        continue;
      }
      seen.add(relativePath);
      previousPath = relativePath;
      const artifact = path.join(sourceRoot, ...relativePath.split("/"));
      requireDirectFile(artifact, `${label} immutable source ${relativePath}`);
      if (fs.existsSync(artifact)) {
        hashChecks.push({
          filePath: artifact,
          expectedHash: file.sha256,
          expectedSize: file.size,
          label: `${label} immutable source ${relativePath}`,
        });
      }
    }
    for (const requiredPath of requiredPaths) {
      if (!seen.has(requiredPath)) {
        problems.push(`${label} immutable source artifact receipt omits ${requiredPath}`);
      }
    }
  } catch (error) {
    problems.push(
      `${label} immutable source artifact receipt is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function requireExactJsonReceipt(receiptPath, label, expectedReceipt) {
  requireDirectFile(receiptPath, label);
  if (!fs.existsSync(receiptPath)) return false;
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    if (JSON.stringify(receipt) !== JSON.stringify(expectedReceipt)) {
      problems.push(`${label} does not match the reviewed immutable receipt`);
      return false;
    }
    return true;
  } catch (error) {
    problems.push(
      `${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

function checkTranscriptionRuntime(binDir, label) {
  for (const executable of ["scriberr.exe", "ffmpeg.exe", "ffprobe.exe", "yt-dlp.exe", "uv.exe"]) {
    requireDirectFile(path.join(binDir, executable), `${label} ${executable}`);
  }
  const receiptPath = path.join(binDir, "transcription-runtime.json");
  requireDirectFile(
    receiptPath,
    `${label} pinned runtime manifest`,
  );
  if (fs.existsSync(receiptPath)) {
    try {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      if (String(receipt?.uv?.sha256 ?? "").toUpperCase() !== PINNED_UV_EXE_SHA256) {
        problems.push(`${label} pinned runtime manifest does not bind the expected uv.exe`);
      }
    } catch (error) {
      problems.push(`${label} pinned runtime manifest is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const uv = path.join(binDir, "uv.exe");
  if (fs.existsSync(uv)) {
    hashChecks.push({ filePath: uv, expectedHash: PINNED_UV_EXE_SHA256, label: `${label} uv.exe` });
  }
}

function forbidMatches(root, matcher, label) {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (matcher(entry.name)) problems.push(`${label}: ${full}`);
    }
  }
}

function checkPinnedOciCompose(resources, label, stack) {
  const stackRoot = path.join(resources, "app-services", stack.directory);
  const composePath = path.join(stackRoot, stack.composeFile);
  const stagedReceiptPath = path.join(stackRoot, "oci-images.json");
  const sourceReceiptPath = path.join(
    desktopRoot,
    "runtime-v2",
    "vendor",
    stack.vendorDirectory,
    "oci-images.json",
  );
  const sourceRoot = path.join(path.dirname(sourceReceiptPath), "source");
  const commitPath = path.join(stackRoot, "BREADBOARD_UPSTREAM_COMMIT");
  for (const [filePath, fileLabel] of [
    [composePath, "digest-pinned Compose definition"],
    [stagedReceiptPath, "staged OCI receipt"],
    [sourceReceiptPath, "reviewed OCI receipt"],
    [commitPath, "upstream revision receipt"],
    [path.join(stackRoot, "LICENSE"), "upstream license"],
  ]) {
    requireDirectFile(filePath, `${label} ${stack.label} ${fileLabel}`);
  }
  requireDirectory(sourceRoot, `${label} ${stack.label} reviewed source authority`);
  if (
    fs.existsSync(stagedReceiptPath) &&
    fs.existsSync(sourceReceiptPath) &&
    !fs.readFileSync(stagedReceiptPath).equals(fs.readFileSync(sourceReceiptPath))
  ) {
    problems.push(`${label} ${stack.label} staged OCI receipt is stale`);
  }
  if (
    fs.existsSync(commitPath) &&
    fs.readFileSync(commitPath, "utf8").trim() !== stack.sourceCommit
  ) {
    problems.push(`${label} ${stack.label} upstream revision is not pinned`);
  }
  if (!fs.existsSync(stagedReceiptPath) || !fs.existsSync(composePath)) return;
  try {
    const receipt = JSON.parse(fs.readFileSync(stagedReceiptPath, "utf8"));
    if (
      Object.keys(receipt ?? {}).sort().join(",") !==
        "images,platform,schemaVersion,sourceCommit,sourceFiles,stack" ||
      receipt.schemaVersion !== 1 ||
      receipt.stack !== stack.receiptStack ||
      receipt.sourceCommit !== stack.sourceCommit ||
      receipt.platform !== "linux/amd64" ||
      !Array.isArray(receipt.sourceFiles) ||
      receipt.sourceFiles.length === 0 ||
      !Array.isArray(receipt.images) ||
      receipt.images.length !== stack.imageCount
    ) {
      problems.push(`${label} ${stack.label} OCI receipt has an invalid envelope`);
      return;
    }
    const expectedSourceFiles = new Map();
    for (const row of receipt.sourceFiles) {
      const relative = row?.path;
      if (
        Object.keys(row ?? {}).sort().join(",") !== "path,sha256,size" ||
        typeof relative !== "string" ||
        !relative ||
        relative.includes("\\") ||
        relative.startsWith("/") ||
        relative.split("/").some((component) => !component || component === "." || component === "..") ||
        expectedSourceFiles.has(relative) ||
        !Number.isSafeInteger(row.size) ||
        row.size < 1 ||
        !/^[0-9A-F]{64}$/u.test(row.sha256 ?? "")
      ) {
        problems.push(`${label} ${stack.label} OCI receipt contains an invalid source-file row`);
        continue;
      }
      expectedSourceFiles.set(relative, row);
    }
    const actualSourceFiles = new Set();
    const visitSource = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        const metadata = fs.lstatSync(absolute);
        if (metadata.isSymbolicLink()) {
          problems.push(`${label} ${stack.label} reviewed source contains a symlink`);
        } else if (metadata.isDirectory()) {
          visitSource(absolute);
        } else if (metadata.isFile()) {
          actualSourceFiles.add(path.relative(sourceRoot, absolute).split(path.sep).join("/"));
        } else {
          problems.push(`${label} ${stack.label} reviewed source contains a non-file entry`);
        }
      }
    };
    visitSource(sourceRoot);
    if (actualSourceFiles.size !== expectedSourceFiles.size) {
      problems.push(`${label} ${stack.label} reviewed source file count is not exact`);
    }
    for (const [relative, expectedFile] of expectedSourceFiles) {
      const sourceFile = path.join(sourceRoot, ...relative.split("/"));
      requireDirectFile(sourceFile, `${label} ${stack.label} reviewed source ${relative}`);
      if (fs.existsSync(sourceFile)) {
        hashChecks.push({
          filePath: sourceFile,
          expectedHash: expectedFile.sha256,
          expectedSize: expectedFile.size,
          canonical: true,
          label: `${label} ${stack.label} reviewed source ${relative}`,
        });
      }
      if (relative !== stack.composeFile) {
        const stagedFile = path.join(stackRoot, ...relative.split("/"));
        requireDirectFile(stagedFile, `${label} ${stack.label} staged source ${relative}`);
        if (fs.existsSync(stagedFile)) {
          hashChecks.push({
            filePath: stagedFile,
            expectedHash: expectedFile.sha256,
            expectedSize: expectedFile.size,
            canonical: true,
            label: `${label} ${stack.label} staged source ${relative}`,
          });
        }
      }
    }
    const expected = new Map();
    for (const row of receipt.images) {
      if (
        Object.keys(row ?? {}).sort().join(",") !==
          "immutableReference,indexDigest,linuxAmd64Manifest,service,sourceReference" ||
        typeof row.service !== "string" ||
        !row.service ||
        expected.has(row.service) ||
        typeof row.sourceReference !== "string" ||
        row.sourceReference.includes("@") ||
        !/^[^\s@]+@sha256:[0-9a-f]{64}$/u.test(row.immutableReference ?? "") ||
        !/^sha256:[0-9a-f]{64}$/u.test(row.indexDigest ?? "") ||
        !row.immutableReference.endsWith(`@${row.indexDigest}`) ||
        Object.keys(row.linuxAmd64Manifest ?? {}).sort().join(",") !== "digest,size" ||
        !/^sha256:[0-9a-f]{64}$/u.test(row.linuxAmd64Manifest.digest ?? "") ||
        !Number.isSafeInteger(row.linuxAmd64Manifest.size) ||
        row.linuxAmd64Manifest.size < 1
      ) {
        problems.push(`${label} ${stack.label} OCI receipt contains an invalid image row`);
        continue;
      }
      expected.set(row.service, row);
    }

    const compose = fs.readFileSync(composePath, "utf8").replace(/\r\n/gu, "\n");
    const lines = compose.split("\n");
    const actual = new Map();
    let service = null;
    for (const line of lines) {
      const serviceMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/u);
      if (serviceMatch) service = serviceMatch[1];
      const imageMatch = line.match(/^\s{4}image:\s*([^\s]+)\s*$/u);
      if (imageMatch) {
        if (!service || actual.has(service)) {
          problems.push(`${label} ${stack.label} Compose contains an ambiguous image row`);
        } else {
          actual.set(service, { image: imageMatch[1], platform: null });
        }
      }
      const platformMatch = line.match(/^\s{4}platform:\s*([^\s]+)\s*$/u);
      if (platformMatch && service && actual.has(service)) {
        actual.get(service).platform = platformMatch[1];
      }
    }
    if (actual.size !== expected.size) {
      problems.push(`${label} ${stack.label} Compose image count does not match its OCI receipt`);
    }
    for (const [serviceName, row] of expected) {
      const configured = actual.get(serviceName);
      if (
        configured?.image !== row.immutableReference ||
        configured?.platform !== receipt.platform
      ) {
        problems.push(`${label} ${stack.label} Compose service ${serviceName} is not digest/platform pinned`);
      }
    }
    if (/^\s*build:\s*/mu.test(compose)) {
      problems.push(`${label} ${stack.label} packaged Compose must not contain local image builds`);
    }
  } catch (error) {
    problems.push(
      `${label} ${stack.label} OCI closure is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function checkPackagedPythonService(resources, label, service) {
  const sourceRoot = path.join(resources, "app-services", service.serviceDirectory);
  const sourceModule = path.join(sourceRoot, service.moduleDirectory);
  const sourceLockFile = service.sourceLockFile ?? "pylock.packaged.toml";
  const sourceLockPath = path.join(sourceRoot, sourceLockFile);
  const lockPath = path.join(sourceRoot, "pylock.packaged.toml");
  const appReceiptPath = path.join(sourceRoot, "runtime-artifact.json");
  const runtimeRoot = path.join(resources, "runtimes", service.runtimeDirectory);
  const python = path.join(runtimeRoot, "python.exe");
  const importPathReceipt = path.join(
    runtimeRoot,
    "Lib",
    "site-packages",
    `breadboard-${service.id}.pth`,
  );
  const runtimeReceiptPath = path.join(runtimeRoot, "runtime-artifact.json");
  const retainedRuntimeLock = path.join(runtimeRoot, "pylock.packaged.toml");
  const expectedReceipt = packagedServiceReceipt(service);
  for (const [filePath, fileLabel] of [
    [path.join(sourceModule, service.entrypointFile ?? "__main__.py"), "source entrypoint"],
    [path.join(sourceRoot, "pyproject.toml"), "project metadata"],
    ...(service.requirementsSha256
      ? [[path.join(sourceRoot, "requirements.txt"), "source requirements"]]
      : []),
    ...(sourceLockFile !== "pylock.packaged.toml"
      ? [[sourceLockPath, "upstream dependency lock"]]
      : []),
    [lockPath, "hashed packaged lock"],
    ...Object.keys(service.additionalSourceFiles ?? {}).map((relativePath) => [
      path.join(sourceRoot, ...relativePath.split("/")),
      `source ${relativePath}`,
    ]),
    ...(service.upstreamCommit
      ? [[path.join(sourceRoot, "BREADBOARD_UPSTREAM_COMMIT"), "upstream revision receipt"]]
      : []),
    [appReceiptPath, "app source receipt"],
    [python, "fixed packaged interpreter"],
    [path.join(runtimeRoot, "LICENSE.txt"), "CPython license"],
    [importPathReceipt, "packaged source import path"],
    [runtimeReceiptPath, "runtime receipt"],
    ...(service.lockFormat === "uv-project-export"
      ? [[retainedRuntimeLock, "runtime packaged lock"]]
      : []),
    ...(service.noticesSha256
      ? [[path.join(sourceRoot, "THIRD_PARTY_NOTICES.md"), "third-party notices"]]
      : []),
  ]) {
    requireDirectFile(filePath, `${label} ${service.id} ${fileLabel}`);
  }
  for (const relativePath of service.dependencyLicensePaths) {
    requireDirectFile(
      path.join(runtimeRoot, "Lib", "site-packages", ...relativePath.split("/")),
      `${label} ${service.id} dependency license ${relativePath}`,
    );
  }
  if (fs.existsSync(importPathReceipt)) {
    const expectedSourcePath = path
      .relative(
        path.dirname(importPathReceipt),
        path.join(
          sourceRoot,
          ...(service.packagedImportSubdirectory
            ? service.packagedImportSubdirectory.split("/")
            : []),
        ),
      )
      .split(path.sep)
      .join("/");
    if (fs.readFileSync(importPathReceipt, "utf8") !== `${expectedSourcePath}\n`) {
      problems.push(`${label} ${service.id} packaged source import path is not relocatable`);
    }
  }
  for (const [filePath, expectedHash, fileLabel] of [
    [path.join(sourceRoot, "pyproject.toml"), service.pyprojectSha256, "project metadata"],
    ...(service.requirementsSha256
      ? [[path.join(sourceRoot, "requirements.txt"), service.requirementsSha256, "source requirements"]]
      : []),
    ...(service.sourceLockSha256
      ? [[sourceLockPath, service.sourceLockSha256, "upstream dependency lock"]]
      : []),
    [lockPath, service.lockSha256, "hashed packaged lock"],
    ...Object.entries(service.additionalSourceFiles ?? {}).map(([relativePath, expectedHash]) => [
      path.join(sourceRoot, ...relativePath.split("/")),
      expectedHash,
      `source ${relativePath}`,
    ]),
    ...(service.lockFormat === "uv-project-export"
      ? [[retainedRuntimeLock, service.lockSha256, "runtime packaged lock"]]
      : []),
    ...(service.noticesSha256
      ? [[path.join(sourceRoot, "THIRD_PARTY_NOTICES.md"), service.noticesSha256, "third-party notices"]]
      : []),
  ]) {
    if (fs.existsSync(filePath)) {
      hashChecks.push({
        filePath,
        expectedHash,
        canonical: true,
        label: `${label} ${service.id} ${fileLabel}`,
      });
    }
  }
  if (
    service.upstreamCommit &&
    fs.existsSync(path.join(sourceRoot, "BREADBOARD_UPSTREAM_COMMIT")) &&
    fs.readFileSync(path.join(sourceRoot, "BREADBOARD_UPSTREAM_COMMIT"), "utf8").trim() !==
      service.upstreamCommit
  ) {
    problems.push(`${label} ${service.id} upstream revision receipt is not pinned`);
  }
  if (fs.existsSync(sourceModule)) {
    treeHashChecks.push({
      root: sourceModule,
      expectedHash: service.sourceSha256,
      expectedFileCount: service.sourceFileCount,
      label: `${label} ${service.id} immutable source`,
    });
  }
  if (fs.existsSync(python)) {
    hashChecks.push({
      filePath: python,
      expectedHash: service.pythonExecutableSha256,
      label: `${label} ${service.id} fixed packaged interpreter`,
    });
  }
  const pythonLicense = path.join(runtimeRoot, "LICENSE.txt");
  if (fs.existsSync(pythonLicense)) {
    hashChecks.push({
      filePath: pythonLicense,
      expectedHash: service.pythonLicenseSha256,
      canonical: true,
      label: `${label} ${service.id} CPython license`,
    });
  }
  if (fs.existsSync(runtimeRoot)) {
    treeHashChecks.push({
      root: runtimeRoot,
      expectedHash: service.pythonRuntimeSha256,
      expectedFileCount: service.pythonRuntimeFileCount,
      label: `${label} ${service.id} CPython base closure`,
      skip: (relativePath) => {
        const components = relativePath.split("/");
        return (
          components.includes("__pycache__") ||
          /\.(?:pyc|pyo)$/iu.test(relativePath) ||
          relativePath === "Lib/site-packages" ||
          relativePath.startsWith("Lib/site-packages/") ||
          relativePath === "Scripts" ||
          relativePath.startsWith("Scripts/") ||
          relativePath === "Include" ||
          relativePath.startsWith("Include/") ||
          (service.lockFormat === "uv-project-export" && relativePath === "pylock.packaged.toml") ||
          relativePath === "share" ||
          relativePath.startsWith("share/") ||
          relativePath === "runtime-artifact.json"
        );
      },
    });
  }
  for (const [receiptPath, receiptLabel] of [
    [appReceiptPath, "app source receipt"],
    [runtimeReceiptPath, "runtime receipt"],
  ]) {
    if (!fs.existsSync(receiptPath)) continue;
    try {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      if (!receiptsMatch(receipt, expectedReceipt)) {
        problems.push(`${label} ${service.id} ${receiptLabel} is not the reviewed exact receipt`);
      }
    } catch (error) {
      problems.push(
        `${label} ${service.id} ${receiptLabel} is invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  let lockedPackages = null;
  if (fs.existsSync(lockPath)) {
    lockedPackages = parsePylockPackages(lockPath);
    if (lockedPackages.size !== service.packageCount) {
      problems.push(
        `${label} ${service.id} lock has ${lockedPackages.size} packages; expected ${service.packageCount}`,
      );
    }
    for (const [packageName, expectedVersion] of Object.entries(service.corePackages)) {
      if (lockedPackages.get(normalizeDistributionName(packageName)) !== expectedVersion) {
        problems.push(`${label} ${service.id} lock does not pin ${packageName}==${expectedVersion}`);
      }
    }
  }

  forbidMatches(
    sourceRoot,
    (name) =>
      /\.(?:safetensors|ckpt|onnx|gguf)$/iu.test(name) ||
      name === "pytorch_model.bin" ||
      name === ".env",
    `${label} ${service.id} forbidden source data/model file staged`,
  );
  forbidMatches(
    runtimeRoot,
    (name) =>
      /\.(?:safetensors|ckpt|onnx|gguf)$/iu.test(name) ||
      name === "pytorch_model.bin" ||
      name.startsWith("models--"),
    `${label} ${service.id} forbidden runtime model file staged`,
  );

  if (service.noticesSha256) {
    const noticeBundle = path.join(
      resources,
      "licenses",
      "humanizer-THIRD-PARTY-NOTICES-LICENSE.txt",
    );
    requireDirectFile(noticeBundle, `${label} humanizer third-party notice bundle`);
    if (fs.existsSync(noticeBundle)) {
      hashChecks.push({
        filePath: noticeBundle,
        expectedHash: service.noticesSha256,
        canonical: true,
        label: `${label} humanizer third-party notice bundle`,
      });
    }
  }
  if (!fs.existsSync(python) || !fs.existsSync(sourceModule) || !lockedPackages) return;

  const smokeScript = [
    service.smokeImports,
    `import sys; assert '.'.join(map(str, sys.version_info[:3])) == ${JSON.stringify(service.pythonVersion)}`,
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
      cwd: sourceRoot,
      encoding: "utf8",
      shell: false,
      env: {
        ...process.env,
        HF_HUB_DISABLE_TELEMETRY: "1",
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONNOUSERSITE: "1",
      },
    },
  );
  if (smoke.status !== 0) {
    const output = `${smoke.stderr || ""}\n${smoke.stdout || ""}`.trim();
    problems.push(`${label} ${service.id} interpreter/import smoke failed: ${output || "unknown error"}`);
  }
  const inventory = spawnSync(
    python,
    [
      "-c",
      "import importlib.metadata as m,json,re;" +
        "n=lambda v:re.sub(r'[-_.]+','-',v).lower();" +
        "print(json.dumps(sorted((n(d.metadata['Name']),d.version) for d in m.distributions())))",
    ],
    {
      cwd: sourceRoot,
      encoding: "utf8",
      shell: false,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" },
    },
  );
  if (inventory.status !== 0) {
    problems.push(`${label} ${service.id} installed dependency inventory could not be read`);
    return;
  }
  try {
    const installedPackages = new Map(JSON.parse(inventory.stdout));
    const excludedPackages = new Set(
      (service.platformExcludedPackages ?? []).map(normalizeDistributionName),
    );
    const expectedInstalledPackages = new Map(
      [...lockedPackages].filter(([packageName]) => !excludedPackages.has(packageName)),
    );
    if (installedPackages.size !== expectedInstalledPackages.size) {
      problems.push(
        `${label} ${service.id} runtime has ${installedPackages.size} distributions; expected ${expectedInstalledPackages.size}`,
      );
    }
    for (const [packageName, expectedVersion] of expectedInstalledPackages) {
      if (installedPackages.get(packageName) !== expectedVersion) {
        problems.push(`${label} ${service.id} runtime does not contain ${packageName}==${expectedVersion}`);
      }
    }
  } catch (error) {
    problems.push(
      `${label} ${service.id} installed dependency inventory is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function checkComfyUiDependencyLock(lockPath, label) {
  if (!fs.existsSync(lockPath)) return null;
  const expected = PINNED_COMFYUI_RUNTIME.dependencyLock;
  const source = fs.readFileSync(lockPath, "utf8").replace(/\r\n/gu, "\n");
  if (!source.startsWith('lock-version = "1.0"\ncreated-by = "uv"\nrequires-python = ">=3.12.10"\n')) {
    problems.push(`${label} has an unexpected pylock header`);
  }
  if (/(?:^|\n)sdist = /u.test(source)) {
    problems.push(`${label} admits a source distribution`);
  }
  const packageBlocks = source.split(/(?=^\[\[packages\]\]$)/gmu).filter((block) =>
    block.startsWith("[[packages]]"),
  );
  const packages = parsePylockPackages(lockPath);
  if (packageBlocks.length !== expected.packageCount || packages.size !== expected.packageCount) {
    problems.push(
      `${label} has ${packageBlocks.length}/${packages.size} package rows; expected ${expected.packageCount} unique packages`,
    );
  }
  let wheelCount = 0;
  for (const block of packageBlocks) {
    const packageName = block.match(/^name = "([^"]+)"$/mu)?.[1] ?? "unknown";
    const urls = [...block.matchAll(/url = "([^"]+)"/gu)].map((match) => match[1]);
    const hashes = [...block.matchAll(/sha256 = "([0-9a-f]+)"/gu)].map((match) => match[1]);
    if (urls.length === 0 || urls.length !== hashes.length) {
      problems.push(`${label} package ${packageName} does not bind one SHA-256 per wheel`);
      continue;
    }
    for (const [index, url] of urls.entries()) {
      try {
        const artifact = new URL(url);
        if (
          artifact.protocol !== "https:" ||
          !expected.approvedHosts.includes(artifact.hostname) ||
          !artifact.pathname.toLowerCase().endsWith(".whl") ||
          !/^[0-9a-f]{64}$/u.test(hashes[index])
        ) {
          problems.push(`${label} package ${packageName} has an unreviewed wheel artifact`);
        }
      } catch {
        problems.push(`${label} package ${packageName} has an invalid wheel URL`);
      }
    }
    wheelCount += urls.length;
  }
  if (wheelCount !== expected.wheelCount) {
    problems.push(`${label} has ${wheelCount} wheel rows; expected ${expected.wheelCount}`);
  }
  for (const [packageName, expectedVersion] of Object.entries(expected.corePackages)) {
    if (packages.get(normalizeDistributionName(packageName)) !== expectedVersion) {
      problems.push(`${label} does not pin ${packageName}==${expectedVersion}`);
    }
  }
  return packages;
}

function checkComfyUiPackagedRuntime(resources, label) {
  const sourceRoot = path.join(resources, "app-services", "comfyui");
  const constraintsPath = path.join(sourceRoot, "constraints.packaged.txt");
  const lockPath = path.join(sourceRoot, "pylock.packaged.toml");
  const appReceiptPath = path.join(sourceRoot, "runtime-artifact.json");
  const runtimeRoot = path.join(
    resources,
    "runtimes",
    PINNED_COMFYUI_RUNTIME.runtimeDirectory,
  );
  const python = path.join(runtimeRoot, "python.exe");
  const pythonLicense = path.join(runtimeRoot, "LICENSE.txt");
  const importPathReceipt = path.join(
    runtimeRoot,
    "Lib",
    "site-packages",
    "breadboard-comfyui.pth",
  );
  const runtimeReceiptPath = path.join(runtimeRoot, "runtime-artifact.json");
  for (const [filePath, fileLabel] of [
    [path.join(sourceRoot, "main.py"), "immutable source entrypoint"],
    [path.join(sourceRoot, "server.py"), "immutable server source"],
    [path.join(sourceRoot, "pyproject.toml"), "immutable project metadata"],
    [path.join(sourceRoot, "requirements.txt"), "immutable upstream requirements"],
    [constraintsPath, "Breadboard CPU constraints"],
    [lockPath, "hashed Windows wheel lock"],
    [appReceiptPath, "app runtime receipt"],
    [python, "fixed packaged interpreter"],
    [pythonLicense, "CPython license"],
    [importPathReceipt, "relocatable source import path"],
    [runtimeReceiptPath, "interpreter runtime receipt"],
  ]) {
    requireDirectFile(filePath, `${label} ComfyUI ${fileLabel}`);
  }
  for (const [filePath, expectedHash, fileLabel] of [
    [
      path.join(sourceRoot, "pyproject.toml"),
      PINNED_COMFYUI_RUNTIME.source.pyprojectSha256,
      "project metadata",
    ],
    [
      path.join(sourceRoot, "requirements.txt"),
      PINNED_COMFYUI_RUNTIME.source.requirementsSha256,
      "upstream requirements",
    ],
    [
      constraintsPath,
      PINNED_COMFYUI_RUNTIME.dependencyLock.constraintsSha256,
      "CPU constraints",
    ],
    [lockPath, PINNED_COMFYUI_RUNTIME.dependencyLock.lockSha256, "Windows wheel lock"],
    [pythonLicense, PINNED_COMFYUI_RUNTIME.python.licenseSha256, "CPython license"],
  ]) {
    if (fs.existsSync(filePath)) {
      hashChecks.push({
        filePath,
        expectedHash,
        canonical: true,
        label: `${label} ComfyUI ${fileLabel}`,
      });
    }
  }
  if (fs.existsSync(python)) {
    hashChecks.push({
      filePath: python,
      expectedHash: PINNED_COMFYUI_RUNTIME.python.runtimeExecutableSha256,
      label: `${label} ComfyUI fixed packaged interpreter`,
    });
  }
  if (fs.existsSync(runtimeRoot)) {
    treeHashChecks.push({
      root: runtimeRoot,
      expectedHash: PINNED_COMFYUI_RUNTIME.python.baseClosureSha256,
      expectedFileCount: PINNED_COMFYUI_RUNTIME.python.baseClosureFileCount,
      label: `${label} ComfyUI CPython base closure`,
      skip: (relativePath) => {
        const components = relativePath.split("/");
        return (
          components.includes("__pycache__") ||
          /\.(?:pyc|pyo)$/iu.test(relativePath) ||
          relativePath === "Lib/site-packages" ||
          relativePath.startsWith("Lib/site-packages/") ||
          relativePath === "Scripts" ||
          relativePath.startsWith("Scripts/") ||
          relativePath === "Include" ||
          relativePath.startsWith("Include/") ||
          relativePath === "share" ||
          relativePath.startsWith("share/") ||
          relativePath === "runtime-artifact.json"
        );
      },
    });
  }
  for (const [receiptPath, receiptLabel] of [
    [appReceiptPath, "app runtime receipt"],
    [runtimeReceiptPath, "interpreter runtime receipt"],
  ]) {
    requireExactJsonReceipt(
      receiptPath,
      `${label} ComfyUI ${receiptLabel}`,
      PINNED_COMFYUI_RUNTIME,
    );
  }
  if (fs.existsSync(importPathReceipt)) {
    const expectedSourcePath = path
      .relative(path.dirname(importPathReceipt), sourceRoot)
      .split(path.sep)
      .join("/");
    if (fs.readFileSync(importPathReceipt, "utf8") !== `${expectedSourcePath}\n`) {
      problems.push(`${label} ComfyUI packaged source import path is not relocatable`);
    }
  }
  const lockedPackages = checkComfyUiDependencyLock(
    lockPath,
    `${label} ComfyUI packaged dependency lock`,
  );
  forbidMatches(
    runtimeRoot,
    (name) =>
      /\.(?:safetensors|ckpt|onnx|gguf)$/iu.test(name) ||
      name === "pytorch_model.bin" ||
      name.startsWith("models--"),
    `${label} forbidden ComfyUI runtime model artifact staged`,
  );
  if (!fs.existsSync(python) || !lockedPackages) return;

  // Inventory metadata validates the exact installed wheel set without loading
  // Torch or allocating a model/runtime graph during package verification.
  const inventory = spawnSync(
    python,
    [
      "-c",
      "import importlib.metadata as m,json,re,sys;" +
        "n=lambda v:re.sub(r'[-_.]+','-',v).lower();" +
        "print(json.dumps({'python':'.'.join(map(str,sys.version_info[:3])),'packages':sorted((n(d.metadata['Name']),d.version) for d in m.distributions())}))",
    ],
    {
      cwd: sourceRoot,
      encoding: "utf8",
      shell: false,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" },
    },
  );
  if (inventory.status !== 0) {
    problems.push(`${label} ComfyUI installed dependency inventory could not be read`);
    return;
  }
  try {
    const result = JSON.parse(inventory.stdout);
    if (result.python !== PINNED_COMFYUI_RUNTIME.python.version) {
      problems.push(`${label} ComfyUI interpreter is Python ${result.python ?? "unknown"}`);
    }
    const installedPackages = new Map(result.packages);
    if (installedPackages.size !== lockedPackages.size) {
      problems.push(
        `${label} ComfyUI runtime has ${installedPackages.size} distributions; expected ${lockedPackages.size}`,
      );
    }
    for (const [packageName, expectedVersion] of lockedPackages) {
      if (installedPackages.get(packageName) !== expectedVersion) {
        problems.push(`${label} ComfyUI runtime does not contain ${packageName}==${expectedVersion}`);
      }
    }
  } catch (error) {
    problems.push(
      `${label} ComfyUI installed dependency inventory is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function checkMandatoryPackagedClosures(resources, binRoot, label, bundledNode) {
  const appRoot = path.join(resources, "app-services");
  for (const source of [
    {
      root: "comfyui",
      label: "ComfyUI",
      commit: PINNED_PACKAGED_SERVICE_COMMITS.comfyUi,
      required: ["LICENSE", "main.py", "requirements.txt", "folder_paths.py", "server.py"],
    },
    {
      root: "openwork",
      label: "OpenWork",
      commit: PINNED_PACKAGED_SERVICE_COMMITS.openwork,
      required: [
        "LICENSE",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "apps/server/package.json",
        "apps/server/src/cli.ts",
        "packages/paths/package.json",
        "packages/types/package.json",
      ],
    },
    {
      root: "wardrobe",
      label: "Wardrobe",
      commit: PINNED_PACKAGED_SERVICE_COMMITS.wardrobe,
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
    },
    {
      root: "deer-flow",
      label: "DeerFlow",
      commit: PINNED_PACKAGED_SERVICE_COMMITS.deerFlow,
      required: ["LICENSE", "backend/pyproject.toml", "backend/uv.lock", "backend/app/gateway/app.py"],
    },
    {
      root: "Vibe-Trading",
      label: "Vibe Trading",
      commit: PINNED_PACKAGED_SERVICE_COMMITS.vibeTrading,
      required: ["LICENSE", "NOTICE", "pyproject.toml", "requirements-lock.txt", "agent/api_server.py"],
    },
    {
      root: "daily_stock_analysis",
      label: "Stock Analyst",
      commit: PINNED_PACKAGED_SERVICE_COMMITS.stockAnalyst,
      required: ["LICENSE", "THIRD_PARTY_NOTICES.md", "requirements.lock", "api/app.py"],
    },
    {
      root: "deep-research",
      label: "Deep Research",
      commit: PINNED_PACKAGED_SERVICE_COMMITS.deepResearch,
      required: ["LICENSE", "package.json", "package-lock.json", "src/api.ts"],
    },
    {
      root: "MoneyPrinterTurbo",
      label: "MoneyPrinterTurbo",
      commit: PINNED_PACKAGED_SERVICE_COMMITS.moneyPrinter,
      required: ["LICENSE", "pyproject.toml", "uv.lock", "app/asgi.py", "app/services/task.py"],
    },
    {
      root: "openscience",
      label: "OpenScience version authority",
      commit: PINNED_PACKAGED_SERVICE_COMMITS.openscience,
      required: ["LICENSE", "NOTICE", "backend/cli/package.json"],
    },
  ]) {
    requirePinnedSourceArtifact(
      path.join(appRoot, source.root),
      `${label} ${source.label}`,
      source.commit,
      source.required,
    );
  }

  const wardrobeRuntimeRoot = path.join(appRoot, "wardrobe-runtime");
  requireExactJsonReceipt(
    path.join(wardrobeRuntimeRoot, "runtime-artifact.json"),
    `${label} Wardrobe immutable runtime receipt`,
    PINNED_WARDROBE_RUNTIME,
  );
  requireDirectory(wardrobeRuntimeRoot, `${label} Wardrobe immutable runtime`);
  if (fs.existsSync(wardrobeRuntimeRoot)) {
    treeHashChecks.push({
      root: wardrobeRuntimeRoot,
      expectedHash: PINNED_WARDROBE_RUNTIME.source.sha256,
      expectedFileCount: PINNED_WARDROBE_RUNTIME.source.fileCount,
      skip: (relative) => relative === "node_modules" || relative === "runtime-artifact.json",
      label: `${label} Wardrobe immutable source`,
    });
  }
  const wardrobeNodeModules = path.join(wardrobeRuntimeRoot, "node_modules");
  requireDirectory(wardrobeNodeModules, `${label} Wardrobe production dependencies`);
  if (fs.existsSync(wardrobeNodeModules)) {
    treeHashChecks.push({
      root: wardrobeNodeModules,
      expectedHash: PINNED_WARDROBE_RUNTIME.nodeModules.sha256,
      expectedFileCount: PINNED_WARDROBE_RUNTIME.nodeModules.fileCount,
      label: `${label} Wardrobe production dependencies`,
    });
  }
  for (const [relative, expected, artifactLabel] of [
    ["package.json", PINNED_WARDROBE_RUNTIME.packageManifest, "package manifest"],
    ["package-lock.json", PINNED_WARDROBE_RUNTIME.dependencyLock, "dependency lock"],
    ["node_modules/vite/package.json", PINNED_WARDROBE_RUNTIME.vite.packageJson, "Vite manifest"],
    ["node_modules/sharp/package.json", PINNED_WARDROBE_RUNTIME.sharp.packageJson, "Sharp manifest"],
    ...Object.entries(PINNED_WARDROBE_RUNTIME.sharp.nativeFiles).map(
      ([relative, expected]) => [relative, expected, `Sharp native file ${relative}`],
    ),
  ]) {
    const artifact = path.join(wardrobeRuntimeRoot, ...relative.split("/"));
    requireDirectFile(artifact, `${label} Wardrobe ${artifactLabel}`);
    if (fs.existsSync(artifact)) {
      hashChecks.push({
        filePath: artifact,
        expectedHash: expected.sha256,
        expectedSize: expected.size,
        label: `${label} Wardrobe ${artifactLabel}`,
      });
    }
  }
  if (
    fs.existsSync(path.join(wardrobeNodeModules, "vite", "bin", "vite.js")) &&
    fs.existsSync(bundledNode)
  ) {
    const viteProbe = spawnSync(
      bundledNode,
      [path.join(wardrobeNodeModules, "vite", "bin", "vite.js"), "--version"],
      { cwd: wardrobeRuntimeRoot, encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000 },
    );
    const output = `${viteProbe.stdout ?? ""}\n${viteProbe.stderr ?? ""}`.trim();
    if (viteProbe.status !== 0 || !output.includes(`vite/${PINNED_WARDROBE_RUNTIME.vite.version}`)) {
      problems.push(`${label} Wardrobe immutable Vite smoke failed: ${output || "no output"}`);
    }
  }
  if (fs.existsSync(path.join(wardrobeNodeModules, "sharp", "package.json")) && fs.existsSync(bundledNode)) {
    const sharpProbe = spawnSync(
      bundledNode,
      [
        "--input-type=module",
        "-e",
        "import sharp from 'sharp'; console.log(JSON.stringify({sharp:sharp.versions.sharp,vips:sharp.versions.vips}))",
      ],
      { cwd: wardrobeRuntimeRoot, encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000 },
    );
    try {
      const output = JSON.parse((sharpProbe.stdout ?? "").trim());
      if (
        sharpProbe.status !== 0 ||
        output?.sharp !== PINNED_WARDROBE_RUNTIME.sharp.version ||
        output?.vips !== PINNED_WARDROBE_RUNTIME.sharp.libvipsVersion
      ) {
        throw new Error("version mismatch");
      }
    } catch {
      const output = `${sharpProbe.stdout ?? ""}\n${sharpProbe.stderr ?? ""}`.trim();
      problems.push(`${label} Wardrobe immutable Sharp smoke failed: ${output || "no output"}`);
    }
  }

  const openworkSourceRoot = path.join(appRoot, "openwork");
  const openworkRuntimeRoot = path.join(appRoot, "openwork-runtime");
  requireExactJsonReceipt(
    path.join(openworkRuntimeRoot, "runtime-artifact.json"),
    `${label} OpenWork immutable runtime receipt`,
    PINNED_OPENWORK_RUNTIME,
  );
  for (const [relative, expected, artifactLabel] of [
    ["apps/server/src", PINNED_OPENWORK_RUNTIME.source.server, "server source"],
    ["packages/paths", PINNED_OPENWORK_RUNTIME.source.paths, "paths package"],
    ["packages/types", PINNED_OPENWORK_RUNTIME.source.types, "types package"],
    ["apps/server/node_modules", PINNED_OPENWORK_RUNTIME.nodeModules, "production dependencies"],
  ]) {
    const artifact = path.join(openworkRuntimeRoot, ...relative.split("/"));
    requireDirectory(artifact, `${label} OpenWork ${artifactLabel}`);
    if (fs.existsSync(artifact)) {
      treeHashChecks.push({
        root: artifact,
        expectedHash: expected.sha256,
        expectedFileCount: expected.fileCount,
        label: `${label} OpenWork ${artifactLabel}`,
      });
    }
  }
  for (const [relative, expected, artifactLabel, canonical] of [
    ["constants.json", PINNED_OPENWORK_RUNTIME.source.constants, "constants authority", true],
    ["apps/server/package.json", PINNED_OPENWORK_RUNTIME.preparedManifest, "prepared manifest", false],
    ["apps/server/package-lock.json", PINNED_OPENWORK_RUNTIME.dependencyLock, "immutable npm lock", false],
    [
      "apps/server/node_modules/@opencode-ai/sdk/package.json",
      {
        size: PINNED_OPENWORK_RUNTIME.sdkPackage.packageJsonSize,
        sha256: PINNED_OPENWORK_RUNTIME.sdkPackage.packageJsonSha256,
      },
      "OpenCode SDK manifest",
      false,
    ],
  ]) {
    const artifact = path.join(openworkRuntimeRoot, ...relative.split("/"));
    requireDirectFile(artifact, `${label} OpenWork ${artifactLabel}`);
    if (fs.existsSync(artifact)) {
      hashChecks.push({
        filePath: artifact,
        expectedHash: expected.sha256,
        expectedSize: expected.size,
        canonical,
        label: `${label} OpenWork ${artifactLabel}`,
      });
    }
  }
  const openworkFingerprintReceipt = path.join(openworkRuntimeRoot, "breadboard-source.json");
  requireDirectFile(openworkFingerprintReceipt, `${label} OpenWork immutable source fingerprint`);
  if (
    fs.existsSync(openworkFingerprintReceipt) &&
    fs.existsSync(path.join(openworkSourceRoot, "apps", "server", "src"))
  ) {
    try {
      const parts = [];
      const walk = (directory, prefix) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })
          .sort((left, right) => left.name.localeCompare(right.name))) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          const absolute = path.join(directory, entry.name);
          const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) walk(absolute, relative);
          else if (entry.isFile()) parts.push(`${relative}:${fs.statSync(absolute).size}`);
          else throw new Error("indirect entry");
        }
      };
      walk(path.join(openworkSourceRoot, "apps", "server", "src"), "src");
      for (const relative of ["apps/server/package.json", "constants.json"]) {
        parts.push(
          `${relative}:${fs.statSync(path.join(openworkSourceRoot, ...relative.split("/"))).size}`,
        );
      }
      const receipt = JSON.parse(fs.readFileSync(openworkFingerprintReceipt, "utf8"));
      if (
        Object.keys(receipt ?? {}).join(",") !== "fingerprint" ||
        receipt.fingerprint !== parts.join("|")
      ) {
        problems.push(`${label} OpenWork immutable source fingerprint is stale`);
      }
    } catch (error) {
      problems.push(`${label} OpenWork immutable source fingerprint is invalid`);
    }
  }
  const openworkEntry = path.join(openworkRuntimeRoot, "apps", "server", "src", "cli.ts");
  const bundledBun = path.join(resources, "runtimes", "bun", "bun.exe");
  if (fs.existsSync(openworkEntry) && fs.existsSync(bundledBun)) {
    const smoke = spawnSync(bundledBun, [openworkEntry, "--version"], {
      cwd: path.dirname(path.dirname(openworkEntry)),
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      shell: false,
      env: {
        ...process.env,
        NO_COLOR: "1",
        DO_NOT_TRACK: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
      },
    });
    const output = `${smoke.stdout ?? ""}\n${smoke.stderr ?? ""}`.trim();
    if (
      smoke.status !== 0 ||
      !output.split(/\r?\n/u).includes(PINNED_OPENWORK_RUNTIME.version)
    ) {
      problems.push(`${label} OpenWork immutable runtime smoke failed: ${output || "no output"}`);
    }
  }

  const cliProxyRoot = binRoot;
  const cliProxyReceipt = path.join(cliProxyRoot, "cliproxy-runtime-artifact.json");
  requireExactJsonReceipt(
    cliProxyReceipt,
    `${label} CLIProxyAPI immutable runtime receipt`,
    PINNED_CLIPROXY_RUNTIME,
  );
  const cliProxyExecutable = path.join(cliProxyRoot, PINNED_CLIPROXY_RUNTIME.executable.name);
  requireDirectFile(cliProxyExecutable, `${label} CLIProxyAPI reviewed executable`);
  if (fs.existsSync(cliProxyExecutable)) {
    hashChecks.push({
      filePath: cliProxyExecutable,
      expectedHash: PINNED_CLIPROXY_RUNTIME.executable.sha256,
      expectedSize: PINNED_CLIPROXY_RUNTIME.executable.size,
      label: `${label} CLIProxyAPI reviewed executable`,
    });
  }
  const cliProxyLicense = path.join(resources, "licenses", "cliproxy-LICENSE.txt");
  requireDirectFile(cliProxyLicense, `${label} CLIProxyAPI license`);
  if (fs.existsSync(cliProxyLicense)) {
    hashChecks.push({
      filePath: cliProxyLicense,
      expectedHash: PINNED_CLIPROXY_RUNTIME.license.sha256,
      expectedSize: PINNED_CLIPROXY_RUNTIME.license.size,
      label: `${label} CLIProxyAPI license`,
    });
  }

  const vlmOcrRoot = path.join(binRoot, "vlm-ocr");
  const vlmOcrRuntime = path.join(vlmOcrRoot, "runtime");
  const vlmOcrModels = path.join(vlmOcrRoot, "models");
  requireExactJsonReceipt(
    path.join(vlmOcrRoot, "runtime-artifact.json"),
    `${label} VLM OCR immutable runtime receipt`,
    PINNED_VLM_OCR_RUNTIME,
  );
  requireDirectory(vlmOcrRuntime, `${label} VLM OCR llama.cpp runtime`);
  if (fs.existsSync(vlmOcrRuntime)) {
    treeHashChecks.push({
      root: vlmOcrRuntime,
      expectedHash: PINNED_VLM_OCR_RUNTIME.llamaCpp.runtimeTree.sha256,
      expectedFileCount: PINNED_VLM_OCR_RUNTIME.llamaCpp.runtimeTree.fileCount,
      label: `${label} VLM OCR llama.cpp runtime`,
    });
  }
  for (const [artifact, expected, artifactLabel] of [
    [
      path.join(vlmOcrModels, PINNED_VLM_OCR_RUNTIME.model.weights.name),
      PINNED_VLM_OCR_RUNTIME.model.weights,
      "HunyuanOCR Q8 weights",
    ],
    [
      path.join(vlmOcrModels, PINNED_VLM_OCR_RUNTIME.model.projector.name),
      PINNED_VLM_OCR_RUNTIME.model.projector,
      "HunyuanOCR Q8 vision projector",
    ],
    [
      path.join(resources, "licenses", PINNED_VLM_OCR_RUNTIME.llamaCpp.license.name),
      PINNED_VLM_OCR_RUNTIME.llamaCpp.license,
      "llama.cpp license",
    ],
    [
      path.join(resources, "licenses", PINNED_VLM_OCR_RUNTIME.model.license.name),
      PINNED_VLM_OCR_RUNTIME.model.license,
      "HunyuanOCR license",
    ],
  ]) {
    requireDirectFile(artifact, `${label} VLM OCR ${artifactLabel}`);
    if (fs.existsSync(artifact)) {
      hashChecks.push({
        filePath: artifact,
        expectedHash: expected.sha256,
        expectedSize: expected.size,
        label: `${label} VLM OCR ${artifactLabel}`,
      });
    }
  }
  const vlmOcrServer = path.join(vlmOcrRuntime, "llama-server.exe");
  requireDirectFile(vlmOcrServer, `${label} VLM OCR llama-server executable`);
  if (fs.existsSync(vlmOcrServer)) {
    const version = spawnSync(vlmOcrServer, ["--version"], {
      cwd: vlmOcrRuntime,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 30_000,
    });
    const output = `${version.stdout ?? ""}\n${version.stderr ?? ""}`;
    if (
      version.status !== 0 ||
      !output.includes(`version: ${PINNED_VLM_OCR_RUNTIME.llamaCpp.version.number} `) ||
      !output.includes(`(${PINNED_VLM_OCR_RUNTIME.llamaCpp.version.sourceCommit})`)
    ) {
      problems.push(`${label} VLM OCR llama.cpp version smoke failed: ${output.trim() || "no output"}`);
    }
  }

  const recallRoot = path.join(binRoot, "recall");
  requireExactJsonReceipt(
    path.join(recallRoot, "runtime-artifact.json"),
    `${label} Recall immutable runtime receipt`,
    PINNED_RECALL_RUNTIME,
  );
  for (const [name, expected] of Object.entries(PINNED_RECALL_RUNTIME.files)) {
    const artifact = path.join(recallRoot, name);
    requireDirectFile(artifact, `${label} Recall runtime ${name}`);
    if (fs.existsSync(artifact)) {
      hashChecks.push({
        filePath: artifact,
        expectedHash: expected.sha256,
        expectedSize: expected.size,
        label: `${label} Recall runtime ${name}`,
      });
    }
  }
  const recallLicense = path.join(resources, "licenses", "recall-LICENSE.txt");
  requireDirectFile(recallLicense, `${label} Recall license`);
  if (fs.existsSync(recallLicense)) {
    hashChecks.push({
      filePath: recallLicense,
      expectedHash: PINNED_RECALL_RUNTIME.license.sha256,
      expectedSize: PINNED_RECALL_RUNTIME.license.size,
      label: `${label} Recall license`,
    });
  }

  const openscienceRoot = path.join(appRoot, "openscience-cli");
  requireExactJsonReceipt(
    path.join(openscienceRoot, "runtime-artifact.json"),
    `${label} OpenScience immutable runtime receipt`,
    PINNED_OPENSCIENCE_RUNTIME,
  );
  const openscienceLock = path.join(openscienceRoot, "package-lock.json");
  requireDirectFile(openscienceLock, `${label} OpenScience immutable npm lock`);
  if (fs.existsSync(openscienceLock)) {
    hashChecks.push({
      filePath: openscienceLock,
      expectedHash: PINNED_OPENSCIENCE_RUNTIME.dependencyLockSha256,
      label: `${label} OpenScience immutable npm lock`,
    });
  }
  for (const [relativePath, expected] of Object.entries(PINNED_OPENSCIENCE_RUNTIME.files)) {
    const artifact = path.join(openscienceRoot, ...relativePath.split("/"));
    requireDirectFile(artifact, `${label} OpenScience runtime ${relativePath}`);
    if (fs.existsSync(artifact)) {
      hashChecks.push({
        filePath: artifact,
        expectedHash: expected.sha256,
        expectedSize: expected.size,
        label: `${label} OpenScience runtime ${relativePath}`,
      });
    }
  }
  const openscienceLicense = path.join(resources, "licenses", "openscience-LICENSE.txt");
  requireDirectFile(openscienceLicense, `${label} OpenScience license`);
  const openscienceEntry = path.join(
    openscienceRoot,
    "node_modules",
    "@synsci",
    "openscience",
    "bin",
    "openscience",
  );
  if (fs.existsSync(bundledNode) && fs.existsSync(openscienceEntry)) {
    const probe = spawnSync(bundledNode, [openscienceEntry, "--version"], {
      cwd: openscienceRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      env: { ...process.env, NO_COLOR: "1", OPENSCIENCE_DISABLE_AUTOUPDATE: "1" },
    });
    const output = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`.trim();
    if (probe.status !== 0 || !output.split(/\r?\n/u).includes(PINNED_OPENSCIENCE_RUNTIME.version)) {
      problems.push(`${label} bundled OpenScience CLI failed its version smoke check`);
    }
  }

  const reviewedVoiceboxReceipt = path.join(
    desktopRoot,
    "runtime-v2",
    "vendor",
    "voicebox",
    "runtime-artifact.json",
  );
  const stagedVoiceboxReceipt = path.join(binRoot, "voicebox-runtime-artifact.json");
  requireDirectFile(reviewedVoiceboxReceipt, `${label} reviewed Voicebox build receipt authority`);
  requireDirectFile(stagedVoiceboxReceipt, `${label} Voicebox immutable runtime receipt`);
  if (fs.existsSync(reviewedVoiceboxReceipt) && fs.existsSync(stagedVoiceboxReceipt)) {
    try {
      const reviewed = JSON.parse(fs.readFileSync(reviewedVoiceboxReceipt, "utf8"));
      const staged = JSON.parse(fs.readFileSync(stagedVoiceboxReceipt, "utf8"));
      const receiptProblems = voiceboxArtifactReceiptProblems(reviewed);
      const receiptBytesMatch = fs.readFileSync(stagedVoiceboxReceipt).equals(
        fs.readFileSync(reviewedVoiceboxReceipt),
      );
      if (receiptProblems.length > 0 || !receiptBytesMatch || JSON.stringify(staged) !== JSON.stringify(reviewed)) {
        problems.push(`${label} Voicebox reviewed/staged native receipt is not exact`);
      } else {
        const executable = path.join(binRoot, reviewed.executable);
        requireDirectFile(executable, `${label} Voicebox reviewed native executable`);
        if (fs.existsSync(executable)) {
          hashChecks.push({
            filePath: executable,
            expectedHash: reviewed.sha256,
            expectedSize: reviewed.size,
            label: `${label} Voicebox reviewed native executable`,
          });
        }
      }
    } catch (error) {
      problems.push(`${label} Voicebox native receipt is invalid JSON`);
    }
  }
  requireDirectFile(
    path.join(resources, "licenses", "voicebox-LICENSE.txt"),
    `${label} Voicebox license`,
  );
}

function checkResourcesRoot(resources, binRoot, label) {
  const node = path.join(resources, "runtimes", "node", "node.exe");
  const bun = path.join(resources, "runtimes", "bun", "bun.exe");
  const python = path.join(resources, "runtimes", "python", "python.exe");
  const dashboard = path.join(resources, "app-services", "dashboard-standalone", "dashboard");
  requireFile(node, `${label} bundled Node`);
  requireFile(bun, `${label} bundled Bun`);
  requireDirectFile(python, `${label} bundled Python`);
  if (fs.existsSync(python)) {
    hashChecks.push({
      filePath: python,
      expectedHash: PINNED_PYTHON_EXE_SHA256,
      label: `${label} bundled Python executable`,
    });
  }
  requireFile(
    path.join(binRoot, "codex.exe"),
    `${label} Codex coding-agent binary`,
  );
  requireFile(
    path.join(binRoot, "runtime-supervisor.exe"),
    `${label} transitional Windows Job Object containment helper`,
  );
  requireFile(
    path.join(binRoot, "breadboard-runtime.exe"),
    `${label} authoritative Runtime V2 binary`,
  );
  checkDashboardCompilerRuntime(dashboard, node, label);
  for (const duplicate of findNestedDashboardRuntimeDuplicates(dashboard)) {
    problems.push(`${label} dashboard contains a nested duplicate or unscannable compiler/Three runtime path: ${duplicate}`);
  }
  const runtimeV2Manifests = path.join(resources, "runtime-v2", "manifests");
  for (const manifestName of ["workers.json", "services.json"]) {
    const manifestPath = path.join(runtimeV2Manifests, manifestName);
    requireFile(manifestPath, `${label} Runtime V2 ${manifestName}`);
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const sourceManifestPath = path.join(desktopRoot, "runtime-v2", "manifests", manifestName);
        if (
          fs.existsSync(sourceManifestPath) &&
          !fs.readFileSync(manifestPath).equals(fs.readFileSync(sourceManifestPath))
        ) {
          problems.push(`${label} Runtime V2 ${manifestName} is stale relative to its checked-in source`);
        }
        const expectedVersion = manifestName === "services.json" ? 3 : 2;
        if (manifest?.version !== expectedVersion) {
          problems.push(`${label} Runtime V2 ${manifestName} has an unsupported version`);
        }
        if (manifestName === "services.json") {
          checkPackagedServiceProfiles(resources, binRoot, label, manifest);
        }
      } catch (error) {
        problems.push(
          `${label} Runtime V2 ${manifestName} is invalid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
  for (const service of PACKAGED_PYTHON_SERVICES) {
    checkPackagedPythonService(resources, label, service);
  }
  checkComfyUiPackagedRuntime(resources, label);
  checkMandatoryPackagedClosures(resources, binRoot, label, node);
  requireFile(
    path.join(resources, "runtimes", "python", "Lib", "site-packages", "flask", "__init__.py"),
    `${label} ChatMock Python dependencies`,
  );
  requireFile(
    path.join(dashboard, "server.js"),
    `${label} dashboard standalone server`,
  );
  requireFile(
    path.join(dashboard, "public", "genoffice-editor", "index.html"),
    `${label} GenOffice editor shell`,
  );
  requireFile(
    path.join(dashboard, "public", "genoffice-editor", "app.js"),
    `${label} GenOffice editor JavaScript`,
  );
  requireFile(
    path.join(dashboard, "public", "genoffice-editor", "app.css"),
    `${label} GenOffice Office-style CSS`,
  );
  requireFile(
    path.join(dashboard, "scripts", "learn-worker.mjs"),
    `${label} durable Learn worker entrypoint`,
  );
  requireFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-dashboard.mjs"),
    `${label} Runtime V2 dashboard entrypoint`,
  );
  requireFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-office-artifact-worker.mjs"),
    `${label} Runtime V2 Office worker entrypoint`,
  );
  for (const script of [
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
    "runtime-v2-inbox-zero-service.mjs",
    "runtime-v2-spotify-playback-service.mjs",
    "runtime-v2-solidworks-mcp-service.mjs",
    "runtime-v2-audio-analyzer-worker.mjs",
    "runtime-v2-image-search-worker.mjs",
    "runtime-v2-finite-mcp-worker-core.mjs",
    "runtime-v2-interactive-visualizer-worker.mjs",
    "runtime-v2-interactive-visualizer-executor.mjs",
    "runtime-v2-quartz-publish-worker.mjs",
    "runtime-v2-quartz-publish-executor.mjs",
    "runtime-v2-quartz-static-service.mjs",
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
    "sf3d-bridge.py",
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
    "runtime-v2-agent-tars-worker.mjs",
    "runtime-v2-deep-research-worker.mjs",
    "runtime-v2-openscience-worker.mjs",
    "runtime-v2-praxist-worker.mjs",
    "runtime-v2-openwork-worker.mjs",
    "runtime-v2-legal-probe-worker.mjs",
    "runtime-v2-shorts-probe-worker.mjs",
    "runtime-v2-tradingagents-probe-worker.mjs",
    "runtime-v2-python-agent-probe-worker-core.mjs",
    "runtime-v2-subsai-transcription-worker.mjs",
    "runtime-v2-subsai-probe-worker.mjs",
    "runtime-v2-subsai-worker-layout.mjs",
    "runtime-v2-speech-media-worker.mjs",
    "runtime-v2-speech-media-executor.mjs",
    "runtime-v2-outer-agent-worker-core.mjs",
    "runtime-v2-outer-agent-adapters.mjs",
    "runtime-v2-system-location-worker.mjs",
    "runtime-v2-system-location-executor.mjs",
    "vox_local.py",
  ]) {
    requireFile(
      path.join(resources, "app-services", "dashboard", "scripts", script),
      `${label} Runtime V2 ${script} entrypoint`,
    );
  }
  const watermarksRoot = path.join(resources, "app-services", "watermarks-remover");
  const watermarksSkillRoot = path.join(watermarksRoot, "skills", "remove-ai-marks");
  for (const relative of [
    "SKILL.md",
    "scripts/audit_dir.py",
    "scripts/audit_lib.py",
    "scripts/clean_file.py",
    "scripts/common.py",
    "scripts/inspect_file.py",
  ]) {
    requireDirectFile(
      path.join(watermarksSkillRoot, relative),
      `${label} pinned Watermark ${relative}`,
    );
  }
  requireDirectFile(path.join(watermarksRoot, "LICENSE"), `${label} Watermark license`);
  const watermarksReceipt = path.join(watermarksRoot, "BREADBOARD_UPSTREAM_COMMIT");
  requireDirectFile(watermarksReceipt, `${label} Watermark upstream receipt`);
  if (
    fs.existsSync(watermarksReceipt) &&
    fs.readFileSync(watermarksReceipt, "utf8").trim() !== "28eca2d91fd485213045b86896db671937432a48"
  ) {
    problems.push(`${label} Watermark upstream revision is not pinned`);
  }
  requireSourceCommitReceipt(
    watermarksRoot,
    `${label} Watermark reviewed local source`,
    PINNED_LOCAL_SOURCE_COMMITS.watermarks,
  );
  forbidMatches(
    watermarksRoot,
    (name) => name === "__pycache__" || /\.(?:pyc|pyo)$/u.test(name),
    `${label} forbidden Watermark cache file staged`,
  );
  requireFile(
    path.join(resources, "app-services", "graft", "dist", "cli.js"),
    `${label} pinned Graft CLI`,
  );
  requireFile(
    path.join(resources, "app-services", "graft", "package.json"),
    `${label} pinned Graft package metadata`,
  );
  requireFile(
    path.join(resources, "app-services", "graft", "LICENSE"),
    `${label} Graft license`,
  );
  requireFile(
    path.join(
      resources,
      "app-services",
      "graft",
      "node_modules",
      "tree-sitter",
      "prebuilds",
      "win32-x64",
      "tree-sitter.node",
    ),
    `${label} pinned Graft Windows parser runtime`,
  );
  const rufloRoot = path.join(resources, "app-services", "ruflo");
  const rufloEntrypoint = path.join(rufloRoot, "bin", "cli.js");
  const rufloPackageRoot = path.join(rufloRoot, "node_modules", "@claude-flow", "cli");
  const rufloCliEntrypoint = path.join(rufloPackageRoot, "bin", "cli.js");
  const rufloDistEntrypoint = path.join(rufloPackageRoot, "dist", "src", "index.js");
  const rufloLock = path.join(rufloRoot, "BREADBOARD_DEPENDENCY_LOCK.json");
  const rufloReceipt = path.join(rufloRoot, "runtime-artifact.json");
  const claudeBinary = path.join(binRoot, "claude.exe");
  const claudeReceipt = path.join(binRoot, "claude-runtime-artifact.json");
  for (const [filePath, fileLabel] of [
    [path.join(rufloRoot, "package.json"), "Ruflo package metadata"],
    [rufloEntrypoint, "Ruflo Runtime wrapper"],
    [rufloCliEntrypoint, "Ruflo planner entrypoint"],
    [rufloDistEntrypoint, "Ruflo compiled planner"],
    [path.join(rufloRoot, "node_modules", "@claude-flow", "cli-core", "dist", "src", "index.js"), "Ruflo CLI core dependency"],
    [path.join(rufloRoot, "node_modules", "@claude-flow", "shared", "dist", "index.js"), "Ruflo shared dependency"],
    [path.join(rufloRoot, "node_modules", "commander", "index.js"), "Ruflo command parser dependency"],
    [path.join(rufloRoot, "LICENSE"), "Ruflo license"],
    [rufloLock, "Ruflo frozen dependency lock"],
    [rufloReceipt, "Ruflo immutable artifact receipt"],
    [claudeBinary, "pinned Claude Code executor"],
    [claudeReceipt, "Claude Code immutable artifact receipt"],
  ]) {
    requireDirectFile(filePath, `${label} ${fileLabel}`);
  }
  for (const [receiptPath, receiptLabel] of [
    [rufloReceipt, "Ruflo"],
    [claudeReceipt, "Claude Code"],
  ]) {
    if (!fs.existsSync(receiptPath)) continue;
    try {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      if (JSON.stringify(receipt) !== JSON.stringify(PINNED_RUFLO_RUNTIME)) {
        problems.push(`${label} ${receiptLabel} immutable artifact receipt is not exact`);
      }
    } catch (error) {
      problems.push(
        `${label} ${receiptLabel} immutable artifact receipt is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const rufloManifestPath = path.join(rufloPackageRoot, "package.json");
  if (fs.existsSync(rufloManifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(rufloManifestPath, "utf8"));
      if (
        manifest.name !== PINNED_RUFLO_RUNTIME.ruflo.package ||
        manifest.version !== PINNED_RUFLO_RUNTIME.ruflo.version
      ) {
        problems.push(`${label} packaged Ruflo CLI identity is not pinned`);
      }
    } catch (error) {
      problems.push(
        `${label} packaged Ruflo CLI metadata is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  for (const [filePath, expectedHash, fileLabel] of [
    [rufloEntrypoint, PINNED_RUFLO_RUNTIME.ruflo.wrapperSha256, "Ruflo Runtime wrapper"],
    [rufloCliEntrypoint, PINNED_RUFLO_RUNTIME.ruflo.entrypointSha256, "Ruflo entrypoint"],
    [rufloDistEntrypoint, PINNED_RUFLO_RUNTIME.ruflo.distEntrypointSha256, "Ruflo dist entrypoint"],
    [rufloLock, PINNED_RUFLO_RUNTIME.ruflo.dependencyLockSha256, "Ruflo dependency lock"],
    [path.join(rufloRoot, "LICENSE"), PINNED_RUFLO_RUNTIME.ruflo.licenseSha256, "Ruflo license"],
  ]) {
    if (fs.existsSync(filePath)) hashChecks.push({ filePath, expectedHash, label: `${label} ${fileLabel}` });
  }
  if (fs.existsSync(claudeBinary)) {
    if (fs.statSync(claudeBinary).size !== PINNED_RUFLO_RUNTIME.claudeCode.size) {
      problems.push(`${label} pinned Claude Code executor size is not exact`);
    }
    hashChecks.push({
      filePath: claudeBinary,
      expectedHash: PINNED_RUFLO_RUNTIME.claudeCode.sha256,
      label: `${label} pinned Claude Code executor`,
    });
    const claudeVersion = spawnSync(claudeBinary, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      shell: false,
    });
    if (
      claudeVersion.status !== 0 ||
      !String(claudeVersion.stdout ?? "").includes(PINNED_RUFLO_RUNTIME.claudeCode.version)
    ) {
      const output = `${claudeVersion.stderr ?? ""}\n${claudeVersion.stdout ?? ""}`.trim();
      problems.push(`${label} pinned Claude Code executor cannot start: ${output || "unknown error"}`);
    }
  }
  if (fs.existsSync(node) && fs.existsSync(rufloEntrypoint)) {
    const rufloVersion = spawnSync(node, [rufloEntrypoint, "--version"], {
      cwd: rufloRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      shell: false,
    });
    if (
      rufloVersion.status !== 0 ||
      String(rufloVersion.stdout ?? "").trim() !== `ruflo v${PINNED_RUFLO_RUNTIME.ruflo.version}`
    ) {
      const output = `${rufloVersion.stderr ?? ""}\n${rufloVersion.stdout ?? ""}`.trim();
      problems.push(`${label} packaged Ruflo planner cannot start: ${output || "unknown error"}`);
    }
    const rufloHelp = spawnSync(node, [rufloEntrypoint, "hive-mind", "--help"], {
      cwd: rufloRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      shell: false,
    });
    if (rufloHelp.status !== 0 || !/hive[- ]mind/iu.test(String(rufloHelp.stdout ?? ""))) {
      const output = `${rufloHelp.stderr ?? ""}\n${rufloHelp.stdout ?? ""}`.trim();
      problems.push(`${label} packaged Ruflo hive planner cannot load: ${output || "unknown error"}`);
    }
  }
  const openCodeRoot = path.join(resources, "app-services", "opencode");
  const openCodeBinary = path.join(openCodeRoot, "bin", "opencode.exe");
  requireFile(openCodeBinary, `${label} pinned OpenCode executable`);
  requireFile(
    path.join(openCodeRoot, "packages", "opencode", "package.json"),
    `${label} pinned OpenCode package metadata`,
  );
  requireFile(path.join(openCodeRoot, "LICENSE"), `${label} OpenCode license`);
  const openCodeReceipt = path.join(openCodeRoot, "runtime-artifact.json");
  requireFile(openCodeReceipt, `${label} OpenCode immutable artifact receipt`);
  requireFile(
    path.join(resources, "app-services", "opencode-config", "opencode.json"),
    `${label} Breadboard OpenCode configuration`,
  );
  requireFile(
    path.join(resources, "app-services", "tradingagents", "pyproject.toml"),
    `${label} TradingAgents package metadata`,
  );
  requireFile(
    path.join(
      resources,
      "app-services",
      "tradingagents",
      "tradingagents",
      "graph",
      "trading_graph.py",
    ),
    `${label} TradingAgents graph source`,
  );
  requireFile(
    path.join(resources, "app-services", "tradingagents", "tradingagents", "default_config.py"),
    `${label} TradingAgents configuration source`,
  );
  requireFile(
    path.join(resources, "app-services", "tradingagents", "LICENSE"),
    `${label} TradingAgents license`,
  );
  requireSourceCommitReceipt(
    path.join(resources, "app-services", "tradingagents"),
    `${label} TradingAgents reviewed local source`,
    PINNED_LOCAL_SOURCE_COMMITS.tradingAgents,
  );
  requireFile(
    path.join(resources, "app-services", "scripts", "tradingagents-bridge.py"),
    `${label} TradingAgents bridge`,
  );
  requirePinnedSourceArtifact(
    path.join(resources, "app-services", "OpenExecutive"),
    `${label} OpenExecutive reviewed core source`,
    PINNED_LOCAL_SOURCE_COMMITS.openExecutive,
    [
      "LICENSE",
      "README.md",
      "packages/core/README.md",
      "packages/core/pyproject.toml",
      "packages/core/uv.lock",
      "packages/core/openexecutive/orchestrator/executive.py",
    ],
  );
  requireFile(
    path.join(resources, "app-services", "scripts", "openexecutive-bridge.py"),
    `${label} OpenExecutive bridge`,
  );
  requireFile(
    path.join(resources, "app-services", "scripts", "shorts-bridge.py"),
    `${label} Shorts bridge`,
  );
  requireFile(
    path.join(resources, "app-services", "career-ops", "doctor.mjs"),
    `${label} Career Ops setup source`,
  );
  requireFile(
    path.join(
      resources,
      "app-services",
      "career-ops",
      ".agents",
      "skills",
      "career-ops",
      "SKILL.md",
    ),
    `${label} Career Ops router skill`,
  );
  requireFile(
    path.join(resources, "app-services", "career-ops", "LICENSE"),
    `${label} Career Ops license`,
  );
  for (const relative of [
    ["pyproject.toml"],
    ["uv.lock"],
    ["README.md"],
    ["LICENSE"],
    ["agent_reach", "cli.py"],
  ]) {
    requireFile(
      path.join(resources, "app-services", "agent-reach", ...relative),
      `${label} Agent Reach immutable setup source ${relative.join("/")}`,
    );
  }
  requireSourceCommitReceipt(
    path.join(resources, "app-services", "agent-reach"),
    `${label} Agent Reach reviewed local source`,
    PINNED_LOCAL_SOURCE_COMMITS.agentReach,
  );
  if (fs.existsSync(openCodeReceipt)) {
    try {
      const receipt = JSON.parse(fs.readFileSync(openCodeReceipt, "utf8"));
      const expected = {
        schemaVersion: 1,
        name: "opencode-windows-x64",
        version: "1.18.8",
        platform: "win32",
        architecture: "x64",
        upstreamCommit: "017a5977d2107092007623e507fc5c6eb337d3b2",
        sha256: "8E0B749456339916F1FF0CA7EBB77B42CDA2E2BA585285131CC7B067A08C49C6",
        size: 175_976_448,
      };
      if (JSON.stringify(receipt) !== JSON.stringify(expected)) {
        problems.push(`${label} OpenCode immutable artifact receipt is not exact`);
      }
      if (fs.existsSync(openCodeBinary)) {
        if (fs.statSync(openCodeBinary).size !== expected.size) {
          problems.push(`${label} OpenCode executable size is not pinned`);
        }
        hashChecks.push({
          filePath: openCodeBinary,
          expectedHash: expected.sha256,
          label: `${label} OpenCode executable`,
        });
      }
    } catch (error) {
      problems.push(
        `${label} OpenCode artifact receipt is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  requireFile(
    path.join(resources, "app-services", "penecho", "server.js"),
    `${label} PenEcho Runtime service entrypoint`,
  );
  requireFile(
    path.join(resources, "app-services", "penecho", "src", "server", "main.js"),
    `${label} PenEcho Runtime service source`,
  );
  requireFile(
    path.join(resources, "app-services", "penecho", "public", "index.html"),
    `${label} PenEcho canvas client`,
  );
  requireSourceCommitReceipt(
    path.join(resources, "app-services", "penecho"),
    `${label} PenEcho reviewed local source`,
    PINNED_LOCAL_SOURCE_COMMITS.penecho,
  );
  requireFile(
    path.join(resources, "app-services", "dashboard", "scripts", "book-to-skill-bridge.py"),
    `${label} document-skill bridge`,
  );
  requireFile(
    path.join(resources, "app-services", "book-to-skill", "tools", "validate_skill.py"),
    `${label} document-skill validator`,
  );
  requireFile(
    path.join(dashboard, "worker-src", "lib", "learn.ts"),
    `${label} durable Learn worker source`,
  );
  for (const source of [
    ["lib", "db.ts"],
    ["lib", "knowledge.ts"],
    ["lib", "gbrain", "sync-executor.ts"],
    ["lib", "gbrain", "client.ts"],
    ["lib", "gbrain", "config.ts"],
    ["lib", "gbrain", "mapping.ts"],
    ["lib", "gbrain", "types.ts"],
    ["lib", "thought-topology", "executor.ts"],
    ["lib", "thought-topology", "builder.ts"],
    ["lib", "thought-topology", "projection.ts"],
    ["lib", "thought-topology", "scoring.ts"],
    ["lib", "thought-topology", "storage.ts"],
  ]) {
    requireFile(
      path.join(dashboard, "worker-src", ...source),
      `${label} GBrain sync worker source ${source.join("/")}`,
    );
  }
  for (const source of [
    ["lib", "hermes", "interactive-visualizer-validator.ts"],
    ["lib", "hermes", "interactive-visualizer-plan.ts"],
    ["lib", "hermes", "interactive-visualizer-custom.ts"],
    ["lib", "hermes", "interactive-visualizer-runtime.ts"],
    ["lib", "hermes", "interactive-visualizer-config.ts"],
    ["lib", "hermes", "interactive-visualizer-types.ts"],
    ["lib", "visual-sdk.ts"],
  ]) {
    requireFile(
      path.join(dashboard, "worker-src", ...source),
      `${label} interactive visualizer worker source ${source.join("/")}`,
    );
  }
  requireFile(
    path.join(dashboard, "worker-src", "lib", "office", "officecli.ts"),
    `${label} Office worker source`,
  );
  requireFile(
    path.join(dashboard, "worker-src", "lib", "office", "contract.ts"),
    `${label} Office process-free contract source`,
  );
  requireFile(
    path.join(dashboard, "worker-src", "lib", "document-skills", "validate-worker.ts"),
    `${label} document-skill worker source`,
  );
  requireFile(
    path.join(dashboard, "worker-src", "lib", "markdown-render", "frontmatter.ts"),
    `${label} Office artifact frontmatter source`,
  );
  requireFile(
    path.join(dashboard, "worker-src", "lib", "markdown-render", "theme.ts"),
    `${label} Office artifact theme source`,
  );
  requireFile(
    path.join(resources, "app-services", "openGym", "frontend", "src", "lib", "exercises-data.js"),
    `${label} openGym exercise catalogue`,
  );
  requireFile(
    path.join(resources, "app-services", "openGym", "LICENSE"),
    `${label} openGym license`,
  );
  for (const relative of [
    ["main.py"],
    ["shorts_generator", "pipeline.py"],
    ["shorts_generator", "local", "clipper.py"],
    ["requirements-local.txt"],
  ]) {
    requireFile(
      path.join(resources, "app-services", "AI-Youtube-Shorts-Generator", ...relative),
      `${label} Shorts immutable source ${relative.join("/")}`,
    );
  }
  requireDirectFile(
    path.join(resources, "app-services", "scripts", "legal-bridge.py"),
    `${label} Legal Agent sealed bridge`,
  );
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-legal-worker.mjs"),
    `${label} Legal Agent sealed worker`,
  );
  for (const relative of [
    ["lib", "legal", "run-manager.ts"],
    ["lib", "legal", "runtime.ts"],
    ["lib", "legal", "runtime-inputs.ts"],
    ["lib", "legal", "runtime-attachment-bundle.ts"],
    ["lib", "legal", "workspace.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} Legal Agent worker source ${relative.join("/")}`,
    );
  }
  const legalRoot = path.join(resources, "app-services", "harvey-labs");
  for (const relative of [
    ["LICENSE"],
    ["pyproject.toml"],
    ["uv.lock"],
    ["harness", "agent_loop.py"],
    ["harness", "tools.py"],
    ["harness", "system_prompt.md"],
    ["harness", "adapters", "openai.py"],
    ["harness", "skills", "docx", "SKILL.md"],
    ["harness", "skills", "xlsx", "SKILL.md"],
    ["harness", "skills", "pptx", "SKILL.md"],
    ["sandbox", "sandbox.py"],
    ["sandbox", "parsers", "parse_doc.py"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(legalRoot, ...relative),
      `${label} Legal Agent immutable Harvey LAB source ${relative.join("/")}`,
    );
  }
  const legalCommitReceipt = path.join(legalRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(legalCommitReceipt) &&
    fs.readFileSync(legalCommitReceipt, "utf8").trim() !==
      "55510f0e609ffa5cf6f5df17d9a813ce4bb33d0c"
  ) {
    problems.push(`${label} Legal Agent Harvey LAB upstream revision is not pinned`);
  }
  for (const entry of ["deeptutor-bridge.py", "deeptutor-files-mcp.mjs", "deeptutor-index.py"]) {
    requireDirectFile(
      path.join(resources, "app-services", "scripts", entry),
      `${label} Deep Tutor sealed ${entry}`,
    );
  }
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-deep-tutor-worker.mjs"),
    `${label} Deep Tutor sealed worker`,
  );
  for (const relative of [
    ["lib", "deep-tutor", "run-manager.ts"],
    ["lib", "deep-tutor", "runtime.ts"],
    ["lib", "deep-tutor", "home.ts"],
    ["lib", "deep-tutor", "materials.ts"],
    ["lib", "deep-tutor", "knowledge-base.ts"],
    ["lib", "deep-tutor", "identity.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} Deep Tutor worker source ${relative.join("/")}`,
    );
  }
  const deepTutorRoot = path.join(resources, "app-services", "DeepTutor");
  for (const relative of [
    ["pyproject.toml"],
    ["LICENSE"],
    ["README.md"],
    ["deeptutor", "__init__.py"],
    ["deeptutor", "app", "__init__.py"],
    ["deeptutor_cli", "main.py"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(deepTutorRoot, ...relative),
      `${label} Deep Tutor immutable source ${relative.join("/")}`,
    );
  }
  const deepTutorCommitReceipt = path.join(deepTutorRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(deepTutorCommitReceipt) &&
    fs.readFileSync(deepTutorCommitReceipt, "utf8").trim() !==
      "37c3db6df7e886aee4f61c97ec5e618b8ab379e8"
  ) {
    problems.push(`${label} Deep Tutor upstream revision is not pinned`);
  }
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-premortem-worker.mjs"),
    `${label} Premortem sealed worker`,
  );
  for (const relative of [
    ["lib", "runtime-paths.ts"],
    ["lib", "hermes", "premortem-request.ts"],
    ["lib", "hermes", "premortem-service.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} Premortem worker source ${relative.join("/")}`,
    );
  }
  const premortemRoot = path.join(resources, "app-services", "premortem-runtime");
  for (const relative of [
    ["source", "pyproject.toml"],
    ["source", "premortem", "__main__.py"],
    ["site-packages", "typer", "__init__.py"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(premortemRoot, ...relative),
      `${label} Premortem immutable runtime ${relative.join("/")}`,
    );
  }
  const premortemCommitReceipt = path.join(premortemRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(premortemCommitReceipt) &&
    fs.readFileSync(premortemCommitReceipt, "utf8").trim() !==
      "724247b820e2bab3613e1055d990ee0efc963a83"
  ) {
    problems.push(`${label} Premortem upstream revision is not pinned`);
  }
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-agent-loop-worker.mjs"),
    `${label} Agent Loop sealed worker`,
  );
  for (const relative of [
    ["lib", "runtime-paths.ts"],
    ["lib", "hermes", "agent-loop-request.ts"],
    ["lib", "hermes", "agent-loop-service.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} Agent Loop worker source ${relative.join("/")}`,
    );
  }
  const agentLoopRoot = path.join(resources, "app-services", "agent-loop-runtime");
  const agentLoopPython = path.join(agentLoopRoot, "python", "python.exe");
  for (const relative of [
    ["source", "pyproject.toml"],
    ["source", "LICENSE"],
    ["source", "hermes_loop", "cli.py"],
    ["source", "hermes_loop", "resources", "schemas", "loop-spec.schema.json"],
    ["python", "LICENSE.txt"],
    ["site-packages", "yaml", "__init__.py"],
    ["site-packages", "rpds", "rpds.cp312-win_amd64.pyd"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
    ["runtime-artifact.json"],
  ]) {
    requireDirectFile(
      path.join(agentLoopRoot, ...relative),
      `${label} Agent Loop immutable runtime ${relative.join("/")}`,
    );
  }
  if (fs.existsSync(agentLoopRoot)) {
    const receiptPath = path.join(agentLoopRoot, "runtime-artifact.json");
    try {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      const expected = {
        schemaVersion: 1,
        upstreamCommit: "d8c814e9259824ee57018d2b6fde88b2dc5840d2",
        pythonVersion: "Python 3.12.13",
        pythonSha256: "4F461F0C0DE64E82EB54FBCED0FD1D678D79D34EDA38660B07781E2BBA8064D6",
      };
      if (JSON.stringify(receipt) !== JSON.stringify(expected)) {
        problems.push(`${label} Agent Loop immutable runtime receipt is not exact`);
      }
      if (fs.existsSync(agentLoopPython)) {
        hashChecks.push({
          filePath: agentLoopPython,
          expectedHash: expected.pythonSha256,
          label: `${label} Agent Loop Python executable`,
        });
      }
    } catch (error) {
      problems.push(`${label} Agent Loop runtime receipt is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-omh-worker.mjs"),
    `${label} Oh My Hermes sealed worker`,
  );
  for (const relative of [
    ["lib", "runtime-paths.ts"],
    ["lib", "hermes", "omh-request.ts"],
    ["lib", "hermes", "omh-service.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} Oh My Hermes worker source ${relative.join("/")}`,
    );
  }
  const omhRoot = path.join(resources, "app-services", "oh-my-hermes");
  for (const relative of [
    ["pyproject.toml"],
    ["LICENSE"],
    ["src", "omh", "__init__.py"],
    ["src", "omh", "cli", "__init__.py"],
    ["src", "omh", "cli", "__main__.py"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(omhRoot, ...relative),
      `${label} Oh My Hermes immutable source ${relative.join("/")}`,
    );
  }
  const omhCommitReceipt = path.join(omhRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(omhCommitReceipt) &&
    fs.readFileSync(omhCommitReceipt, "utf8").trim() !==
      "080030ccef0d3c15123a3f7478b671a0d2ddcf22"
  ) {
    problems.push(`${label} Oh My Hermes upstream revision is not pinned`);
  }
  forbidMatches(
    omhRoot,
    (name) => name === ".venv" || name === "__pycache__" || /\.(?:pyc|pyo)$/u.test(name),
    `${label} forbidden Oh My Hermes mutable/cache file staged`,
  );
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-factcheck-worker.mjs"),
    `${label} Factcheck sealed worker`,
  );
  for (const relative of [
    ["lib", "runtime-paths.ts"],
    ["lib", "hermes", "factcheck-service.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} Factcheck worker source ${relative.join("/")}`,
    );
  }
  const factcheckRoot = path.join(resources, "app-services", "bullshit-detector");
  for (const relative of [
    ["LICENSE"],
    ["skills", "ingestion", "fetch-content", "scripts", "fetch.py"],
    ["skills", "ingestion", "coverage-check", "scripts", "coverage.py"],
    ["skills", "analysis", "bullshit-detector", "scripts", "tally.py"],
    ["skills", "analysis", "bullshit-detector", "scripts", "retractions.py"],
    ["skills", "analysis", "bullshit-detector", "RUBRIC.md"],
    ["skills", "analysis", "bullshit-detector", "CLAIMS.md"],
    ["skills", "analysis", "bullshit-detector", "RUN-RECORD.md"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(factcheckRoot, ...relative),
      `${label} Factcheck immutable source ${relative.join("/")}`,
    );
  }
  const factcheckCommitReceipt = path.join(factcheckRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(factcheckCommitReceipt) &&
    fs.readFileSync(factcheckCommitReceipt, "utf8").trim() !==
      "7b8fac1857eba19d25665825793dfbaf0414c6bf"
  ) {
    problems.push(`${label} Factcheck upstream revision is not pinned`);
  }
  const patentDisclosureRoot = path.join(
    resources,
    "app-services",
    "patent-disclosure-skill",
  );
  requirePinnedSourceArtifact(
    patentDisclosureRoot,
    `${label} Patent Disclosure skill`,
    PATENT_DISCLOSURE_UPSTREAM_COMMIT,
    PATENT_DISCLOSURE_REQUIRED_FILES,
  );
  if (fs.existsSync(path.join(patentDisclosureRoot, "tools"))) {
    problems.push(`${label} Patent Disclosure package unexpectedly contains executable tools`);
  }
  for (const script of ["runtime-v2-watch-worker.mjs", "runtime-v2-watch-executor.mjs"]) {
    requireDirectFile(
      path.join(resources, "app-services", "dashboard", "scripts", script),
      `${label} Watch sealed worker closure ${script}`,
    );
  }
  const watchRoot = path.join(resources, "app-services", "hermes-skills", "prebuilt", "watch");
  for (const script of [
    "watch.py",
    "config.py",
    "download.py",
    "frames.py",
    "transcribe.py",
    "whisper.py",
  ]) {
    requireDirectFile(
      path.join(watchRoot, "scripts", script),
      `${label} Watch immutable Python closure ${script}`,
    );
  }
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-loopx-worker.mjs"),
    `${label} LoopX sealed worker`,
  );
  for (const relative of [
    ["lib", "runtime-paths.ts"],
    ["lib", "loopx", "request.ts"],
    ["lib", "loopx", "state.ts"],
    ["lib", "loopx", "runtime.ts"],
    ["lib", "loopx", "governance.ts"],
    ["lib", "loopx", "snapshot.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} LoopX worker source ${relative.join("/")}`,
    );
  }
  const loopxRoot = path.join(resources, "app-services", "LoopX");
  for (const relative of [
    ["pyproject.toml"],
    ["README.md"],
    ["LICENSE"],
    ["loopx", "__init__.py"],
    ["loopx", "entrypoint.py"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(loopxRoot, ...relative),
      `${label} LoopX immutable source ${relative.join("/")}`,
    );
  }
  const loopxCommitReceipt = path.join(loopxRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(loopxCommitReceipt) &&
    fs.readFileSync(loopxCommitReceipt, "utf8").trim() !==
      "924213b86ba7788bdb83ebecab9569ec6cd79b41"
  ) {
    problems.push(`${label} LoopX upstream revision is not pinned`);
  }
  forbidMatches(
    loopxRoot,
    (name) => name === ".venv" || name === "__pycache__" || /\.(?:pyc|pyo)$/u.test(name),
    `${label} forbidden LoopX mutable/cache file staged`,
  );
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-solidworks-mcp-service.mjs"),
    `${label} SolidWorks Runtime service`,
  );
  for (const relative of [
    ["lib", "cad", "solidworks", "runtime-service.ts"],
    ["lib", "cad", "solidworks", "bridge.ts"],
    ["lib", "cad", "solidworks", "configuration.ts"],
    ["lib", "cad", "solidworks", "config.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} SolidWorks Runtime source ${relative.join("/")}`,
    );
  }
  const solidworksMcpRoot = path.join(resources, "app-services", "SolidworksMCP-python");
  for (const relative of [
    ["pyproject.toml"],
    ["LICENSE"],
    ["src", "solidworks_mcp", "server.py"],
    ["src", "solidworks_mcp", "config.py"],
    ["src", "solidworks_mcp", "adapters", "pywin32_adapter.py"],
    ["src", "solidworks_mcp", "tools", "modeling.py"],
    ["src", "solidworks_mcp", "tools", "sketching.py"],
    ["src", "solidworks_mcp", "tools", "export.py"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(solidworksMcpRoot, ...relative),
      `${label} SolidWorks immutable source ${relative.join("/")}`,
    );
  }
  const solidworksCommitReceipt = path.join(solidworksMcpRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(solidworksCommitReceipt) &&
    fs.readFileSync(solidworksCommitReceipt, "utf8").trim() !==
      "a6d1f1be409547c43503dc4a4dcf2c39e6d99096"
  ) {
    problems.push(`${label} SolidWorks MCP upstream revision is not pinned`);
  }
  forbidMatches(
    solidworksMcpRoot,
    (name) =>
      name === ".venv" ||
      name === ".runtime" ||
      name === "__pycache__" ||
      /\.(?:pyc|pyo)$/u.test(name),
    `${label} forbidden SolidWorks MCP mutable/cache file staged`,
  );
  for (const script of [
    "runtime-v2-matraix-worker.mjs",
    "runtime-v2-matraix-probe-worker.mjs",
    "runtime-v2-formsmith-worker.mjs",
    "runtime-v2-formsmith-executor.mjs",
    "shaper-bridge.py",
  ]) {
    requireDirectFile(
      path.join(resources, "app-services", "dashboard", "scripts", script),
      `${label} sealed ${script}`,
    );
  }
  requireDirectFile(
    path.join(resources, "app-services", "scripts", "matraix-bridge.py"),
    `${label} MatrAIx sealed bridge`,
  );
  for (const relative of [
    ["lib", "matraix", "run-manager.ts"],
    ["lib", "matraix", "runtime.ts"],
    ["lib", "runtime-v2", "matraix-probe-job.ts"],
    ["lib", "shaper", "run-manager.ts"],
    ["lib", "shaper", "runtime.ts"],
    ["lib", "runtime-v2", "formsmith-job.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} MatrAIx/Formsmith worker source ${relative.join("/")}`,
    );
  }
  const matraixRoot = path.join(resources, "app-services", "MatrAIx-Persona-8B");
  for (const relative of [
    ["pyproject.toml"],
    ["src", "matraix", "cli.py"],
    ["environment", "runtime", "harbor"],
    ["persona", "datasets", "matraix-persona-dev-sample"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireFile(
      path.join(matraixRoot, ...relative),
      `${label} MatrAIx immutable source ${relative.join("/")}`,
    );
  }
  const matraixCommitReceipt = path.join(matraixRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(matraixCommitReceipt) &&
    fs.readFileSync(matraixCommitReceipt, "utf8").trim() !==
      "2418b37ffb99f79c0a7d4b3dd4e461ced498aefc"
  ) {
    problems.push(`${label} MatrAIx upstream revision is not pinned`);
  }
  forbidMatches(
    matraixRoot,
    (name) => name === ".venv" || name === "__pycache__" || /\.(?:pyc|pyo)$/u.test(name),
    `${label} forbidden MatrAIx mutable/cache file staged`,
  );
  const shapeRRoot = path.join(resources, "app-services", "ShapeR");
  for (const relative of [
    ["infer_shape.py"],
    ["experimental", "workaround_dataproc.py"],
    ["dataset", "shaper_dataset.py"],
    ["model", "download.py"],
    ["model", "flow_matching", "shaper_denoiser.py"],
    ["model", "dino_and_ray_feature_extractor.py"],
    ["model", "vae3d", "autoencoder.py"],
    ["postprocessing", "helper.py"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(shapeRRoot, ...relative),
      `${label} ShapeR immutable source ${relative.join("/")}`,
    );
  }
  const shapeRCommitReceipt = path.join(shapeRRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(shapeRCommitReceipt) &&
    fs.readFileSync(shapeRCommitReceipt, "utf8").trim() !==
      "8e9bd5b25a075bdd2fc4d60027d27e515fa11769"
  ) {
    problems.push(`${label} ShapeR reviewed source revision is not pinned`);
  }
  forbidMatches(
    shapeRRoot,
    (name) => name === ".venv" || name === "__pycache__" || /\.(?:pyc|pyo)$/u.test(name),
    `${label} forbidden ShapeR mutable/cache file staged`,
  );
  for (const script of [
    "runtime-v2-hyperframes-worker.mjs",
    "runtime-v2-openmontage-worker.mjs",
    "runtime-v2-openmontage-probe-worker.mjs",
    "runtime-v2-bolt-slides-worker.mjs",
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
    "runtime-v2-speech-media-worker.mjs",
    "runtime-v2-speech-media-executor.mjs",
    "runtime-v2-deep-research-worker.mjs",
    "runtime-v2-openscience-worker.mjs",
    "runtime-v2-openwork-worker.mjs",
  ]) {
    requireDirectFile(
      path.join(resources, "app-services", "dashboard", "scripts", script),
      `${label} sealed ${script}`,
    );
  }
  for (const relative of [
    ["lib", "ui-tars", "runtime-run-manager.ts"],
    ["lib", "ui-tars", "runtime-worker-run-manager.ts"],
    ["lib", "ui-tars", "runtime-worker-client.ts"],
    ["lib", "ui-tars", "run-profile.ts"],
    ["lib", "ui-tars", "config.ts"],
    ["lib", "ui-tars", "errors.ts"],
    ["lib", "ui-tars", "model-provider.ts"],
    ["lib", "ui-tars", "operator-routing.ts"],
    ["lib", "ui-tars", "schema.ts"],
    ["lib", "ui-tars", "store.ts"],
    ["lib", "runtime-v2", "outer-agent-run.ts"],
    ["lib", "runtime-v2", "outer-agent-run-store.ts"],
    ["lib", "runtime-paths.ts"],
    ["lib", "db.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} Agent TARS worker source ${relative.join("/")}`,
    );
  }
  for (const relative of [
    ["lib", "get-doc", "run-manager.ts"],
    ["lib", "get-doc", "download-run-manager.ts"],
    ["lib", "get-doc", "download.ts"],
    ["lib", "get-doc", "artifact.ts"],
    ["lib", "get-doc", "query-plan.ts"],
    ["lib", "get-doc", "search.ts"],
    ["lib", "get-doc", "sources.ts"],
    ["lib", "get-doc", "identity.ts"],
    ["lib", "get-doc", "types.ts"],
    ["lib", "meeting-notes", "runtime-worker-run-manager.ts"],
    ["lib", "meeting-notes", "runtime-transcribe.ts"],
    ["lib", "meeting-notes", "transcribe.ts"],
    ["lib", "meeting-notes", "notes.ts"],
    ["lib", "meeting-notes", "report.ts"],
    ["lib", "meeting-notes", "artifact.ts"],
    ["lib", "scriberr", "client.ts"],
    ["lib", "scriberr", "config.ts"],
    ["lib", "scriberr", "errors.ts"],
    ["lib", "scriberr", "types.ts"],
    ["lib", "speech", "recording-upload.ts"],
    ["lib", "conversations", "agent-context.ts"],
    ["lib", "conversations", "store.ts"],
    ["lib", "conversations", "external-agent-turns.ts"],
    ["lib", "agent-browser", "provider.ts"],
    ["lib", "hermes", "run-store.ts"],
    ["lib", "inbox-zero", "run-manager.ts"],
    ["lib", "inbox-zero", "client.ts"],
    ["lib", "inbox-zero", "service.ts"],
    ["lib", "socials-manager", "run-manager.ts"],
    ["lib", "max-research", "run-manager.ts"],
    ["lib", "max-research", "runtime-run-manager.ts"],
    ["lib", "max-research", "participants.ts"],
    ["lib", "max-research", "completion.ts"],
    ["lib", "max-research", "plan.ts"],
    ["lib", "max-research", "synthesis.ts"],
    ["lib", "max-research", "review.ts"],
    ["lib", "wardrobe", "runtime-run-manager.ts"],
    ["lib", "wardrobe", "run-manager.ts"],
    ["lib", "wardrobe", "client.ts"],
    ["lib", "wardrobe", "runtime-service.ts"],
    ["lib", "wardrobe", "artifact.ts"],
    ["lib", "cad", "runtime-run-manager.ts"],
    ["lib", "cad", "runtime-worker-adapter.ts"],
    ["lib", "cad", "run-manager.ts"],
    ["lib", "cad", "parameter-action.ts"],
    ["lib", "cad", "project-store.ts"],
    ["lib", "cad", "artifact.ts"],
    ["lib", "stock-analyst", "runtime-run-manager.ts"],
    ["lib", "stock-analyst", "run-manager.ts"],
    ["lib", "stock-analyst", "service.ts"],
    ["lib", "stock-analyst", "runtime.ts"],
    ["lib", "stock-analyst", "settings.ts"],
    ["lib", "stock-analyst", "identity.ts"],
    ["lib", "stock-analyst", "credentials.ts"],
    ["lib", "vibe-trading", "runtime-run-manager.ts"],
    ["lib", "vibe-trading", "run-manager.ts"],
    ["lib", "vibe-trading", "service.ts"],
    ["lib", "vibe-trading", "settings.ts"],
    ["lib", "vibe-trading", "identity.ts"],
    ["lib", "vibe-trading", "runtime.ts"],
    ["lib", "vibe-trading", "credentials.ts"],
    ["lib", "runtime-v2", "managed-service-endpoint.ts"],
    ["lib", "deer-flow", "runtime-run-manager.ts"],
    ["lib", "deer-flow", "run-manager.ts"],
    ["lib", "deer-flow", "runtime-worker-service.ts"],
    ["lib", "deer-flow", "service.ts"],
    ["lib", "deer-flow", "runtime.ts"],
    ["lib", "deer-flow", "settings.ts"],
    ["lib", "deer-flow", "identity.ts"],
    ["lib", "deer-flow", "config.ts"],
    ["lib", "deer-flow", "artifact.ts"],
    ["lib", "money-printer", "runtime-run-manager.ts"],
    ["lib", "money-printer", "run-manager.ts"],
    ["lib", "money-printer", "runtime-service.ts"],
    ["lib", "money-printer", "service.ts"],
    ["lib", "money-printer", "runtime.ts"],
    ["lib", "money-printer", "settings.ts"],
    ["lib", "money-printer", "identity.ts"],
    ["lib", "money-printer", "credentials.ts"],
    ["lib", "money-printer", "config-inspect.ts"],
    ["lib", "money-printer", "artifact.ts"],
    ["lib", "deep-research", "runtime-run-manager.ts"],
    ["lib", "deep-research", "runtime-worker-run-manager.ts"],
    ["lib", "deep-research", "client.ts"],
    ["lib", "deep-research", "config.ts"],
    ["lib", "deep-research", "identity.ts"],
    ["lib", "deep-research", "service.ts"],
    ["lib", "openscience", "runtime-run-manager.ts"],
    ["lib", "openscience", "run-manager.ts"],
    ["lib", "openscience", "runtime-worker-service.ts"],
    ["lib", "openscience", "client.ts"],
    ["lib", "openscience", "contract.ts"],
    ["lib", "openscience", "prompt.ts"],
    ["lib", "openscience", "state-paths.ts"],
    ["lib", "openscience", "service-profile.ts"],
    ["lib", "chat-token-usage.ts"],
    ["lib", "runtime-agent-service.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} sealed outer-worker source ${relative.join("/")}`,
    );
  }
  const openworkWorkerSourceChecks = [
    {
      relative: ["lib", "openwork", "run-manager.ts"],
      sha256: "AB793C0B623B3CE0AC11379A9FBEDAAE2C4FB1E0B64CC3F6DF22C1BD5DE4D7DD",
    },
    {
      relative: ["lib", "openwork", "client.ts"],
      sha256: "D1EE74F7147EB9F8C6B22C42B035F412DC43F7144B38DE16AB14364815F899BA",
    },
    {
      relative: ["lib", "openwork", "prompt.ts"],
      sha256: "5B0F0C4A4F056515206DB710733A5CA0CAB88308A5A4FD777C5547F5241A0C28",
    },
    {
      relative: ["lib", "openwork", "runtime-worker-service.ts"],
      sha256: "9A133156E3A544E78E321F3318D8B7ECE164B75424F17F500BABB07C5400045D",
    },
    {
      relative: ["lib", "openwork", "runtime-artifact.ts"],
      sha256: "B2CEB157865A9DB7B4E27B9355CA7614527FBEE8DF66E620F4C4FA07718EE8BC",
    },
    {
      relative: ["lib", "chat-token-usage.ts"],
      sha256: "C822DB0DBA13017EEDE3E6CCBAE1A128BB83D2A0B937786C072A2287A7056C0F",
    },
  ];
  for (const check of openworkWorkerSourceChecks) {
    const filePath = path.join(dashboard, "worker-src", ...check.relative);
    const sourceLabel = `${label} sealed OpenWork worker source ${check.relative.join("/")}`;
    requireDirectFile(filePath, sourceLabel);
    if (fs.existsSync(filePath)) {
      hashChecks.push({ filePath, expectedHash: check.sha256, label: sourceLabel });
    }
  }
  const openworkWrapper = path.join(
    resources,
    "app-services",
    "dashboard",
    "scripts",
    "runtime-v2-openwork-worker.mjs",
  );
  if (fs.existsSync(openworkWrapper)) {
    hashChecks.push({
      filePath: openworkWrapper,
      expectedHash: "D209FBBA1CFBB6E00C2071478DB7DD854205EA21E9E9F42E7EEA8CB0965A5A63",
      label: `${label} sealed OpenWork wrapper`,
    });
  }
  for (const relative of [
    ["lib", "hyperframes", "run-manager.ts"],
    ["lib", "hyperframes", "runtime-run-manager.ts"],
    ["lib", "hyperframes", "runtime.ts"],
    ["lib", "hyperframes", "setup.ts"],
    ["lib", "hyperframes", "workspace.ts"],
    ["lib", "hyperframes", "prompt.ts"],
    ["lib", "openmontage", "run-manager.ts"],
    ["lib", "openmontage", "runtime-run-manager.ts"],
    ["lib", "openmontage", "runtime.ts"],
    ["lib", "openmontage", "setup.ts"],
    ["lib", "openmontage", "prompt.ts"],
    ["lib", "runtime-v2", "openmontage-probe-job.ts"],
    ["lib", "codex", "run-manager.ts"],
    ["lib", "bolt-slides", "run-manager.ts"],
    ["lib", "bolt-slides", "runtime-run-manager.ts"],
    ["lib", "bolt-slides", "runtime.ts"],
    ["lib", "bolt-slides", "build.ts"],
    ["lib", "bolt-slides", "workspace.ts"],
    ["lib", "bolt-slides", "author.ts"],
    ["lib", "generated-visual-browser-process.ts"],
    ["lib", "generated-visual-browser-tests.ts"],
    ["lib", "runtime-v2", "generated-visual-browser-job.ts"],
    ["lib", "generated-visual-compiler.ts"],
    ["lib", "generated-visuals.ts"],
    ["lib", "agent-browser", "browser-profile.ts"],
    ["lib", "agent-browser", "browser-profile-process.ts"],
    ["lib", "agent-browser", "opencli-extension.ts"],
    ["lib", "agent-browser", "opencli-profile.ts"],
    ["lib", "runtime-v2", "agent-browser-profile-job.ts"],
    ["lib", "runtime-v2", "scriberr-job.ts"],
    ["lib", "scriberr", "client.ts"],
    ["lib", "scriberr", "config.ts"],
    ["lib", "scriberr", "errors.ts"],
    ["lib", "scriberr", "exec.ts"],
    ["lib", "scriberr", "ffprobe.ts"],
    ["lib", "scriberr", "health.ts"],
    ["lib", "scriberr", "ingest.ts"],
    ["lib", "scriberr", "job-runner.ts"],
    ["lib", "scriberr", "job-store.ts"],
    ["lib", "scriberr", "paths.ts"],
    ["lib", "scriberr", "transcript-markdown.ts"],
    ["lib", "scriberr", "transcript-normalizer.ts"],
    ["lib", "scriberr", "types.ts"],
    ["lib", "scriberr", "video-source-store.ts"],
    ["lib", "scriberr", "ytdlp.ts"],
    ["lib", "knowledge.ts"],
    ["lib", "garden-mutation-lease.ts"],
    ["lib", "learn-atomic-promotion.ts"],
    ["lib", "quartz-publish.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} HyperFrames/OpenMontage/Bolt Slides worker source ${relative.join("/")}`,
    );
  }
  const hyperframesRoot = path.join(resources, "app-services", "hyperframes");
  for (const relative of [
    ["LICENSE"],
    ["skills", "hyperframes", "SKILL.md"],
    ["packages", "cli", "package.json"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(hyperframesRoot, ...relative),
      `${label} HyperFrames immutable source ${relative.join("/")}`,
    );
  }
  const hyperframesCommitReceipt = path.join(hyperframesRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(hyperframesCommitReceipt) &&
    fs.readFileSync(hyperframesCommitReceipt, "utf8").trim() !==
      "29f004cfc04b351bf38a8b28b20916bb5bad9fc4"
  ) {
    problems.push(`${label} HyperFrames upstream revision is not pinned`);
  }
  forbidMatches(
    hyperframesRoot,
    (name) => name === ".venv" || name === ".runtime" || name === "node_modules" || name === "__pycache__",
    `${label} forbidden HyperFrames mutable/cache file staged`,
  );
  const openworkRoot = path.join(resources, "app-services", "openwork");
  for (const relative of [
    ["apps", "server", "src", "cli.ts"],
    ["apps", "server", "package.json"],
    ["packages", "paths", "package.json"],
    ["packages", "types", "package.json"],
    ["constants.json"],
    ["LICENSE"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(openworkRoot, ...relative),
      `${label} OpenWork immutable source ${relative.join("/")}`,
    );
  }
  const openworkCommitReceipt = path.join(openworkRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(openworkCommitReceipt) &&
    fs.readFileSync(openworkCommitReceipt, "utf8").trim() !==
      "776a0646be968842f73d523f3c56372a9ee4ed82"
  ) {
    problems.push(`${label} OpenWork upstream revision is not pinned`);
  }
  forbidMatches(
    openworkRoot,
    (name) =>
      name === ".git" ||
      name === "node_modules" ||
      name === ".runtime" ||
      name === ".cache" ||
      name === "__pycache__",
    `${label} forbidden OpenWork mutable/cache file staged`,
  );
  const openMontageRoot = path.join(resources, "app-services", "OpenMontage");
  for (const relative of [
    ["AGENT_GUIDE.md"],
    ["LICENSE"],
    ["requirements.txt"],
    ["tools", "tool_registry.py"],
    ["remotion-composer", "package.json"],
    ["remotion-composer", "package-lock.json"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(openMontageRoot, ...relative),
      `${label} OpenMontage immutable source ${relative.join("/")}`,
    );
  }
  const openMontageCommitReceipt = path.join(openMontageRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(openMontageCommitReceipt) &&
    fs.readFileSync(openMontageCommitReceipt, "utf8").trim() !==
      "4eab34c5cfcccaa4f1970554928feccce73ee930"
  ) {
    problems.push(`${label} OpenMontage upstream revision is not pinned`);
  }
  forbidMatches(
    openMontageRoot,
    (name) =>
      name === ".venv" ||
      name === ".runtime" ||
      name === "node_modules" ||
      name === "__pycache__" ||
      /\.(?:pyc|pyo)$/u.test(name),
    `${label} forbidden OpenMontage mutable/cache file staged`,
  );
  const boltSlidesRoot = path.join(resources, "app-services", "bolt-slides");
  for (const relative of [
    ["LICENSE"],
    ["package.json"],
    ["package-lock.json"],
    [".bolt", "skills", "slides", "SKILL.md"],
    ["src", "styles", "tokens.css"],
    ["src", "styles", "base.css"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(boltSlidesRoot, ...relative),
      `${label} Bolt Slides immutable source ${relative.join("/")}`,
    );
  }
  const boltSlidesCommitReceipt = path.join(boltSlidesRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(boltSlidesCommitReceipt) &&
    fs.readFileSync(boltSlidesCommitReceipt, "utf8").trim() !==
      "53b55bcf365dc2864fac29e7a5594213611142be"
  ) {
    problems.push(`${label} Bolt Slides upstream revision is not pinned`);
  }
  forbidMatches(
    boltSlidesRoot,
    (name) => name === ".runtime" || name === "node_modules" || name === "__pycache__",
    `${label} forbidden Bolt Slides mutable/cache file staged`,
  );
  for (const relative of [
    ["lib", "subsai", "runtime.ts"],
    ["lib", "runtime-paths.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} SubsAI probe source ${relative.join("/")}`,
    );
  }
  const subsaiRoot = path.join(resources, "app-services", "subsai");
  for (const relative of [
    ["pyproject.toml"],
    ["requirements.txt"],
    ["README.md"],
    ["LICENSE"],
    ["src", "subsai", "cli.py"],
    ["src", "subsai", "configs.py"],
    ["src", "subsai", "models", "faster_whisper_model.py"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(subsaiRoot, ...relative),
      `${label} SubsAI immutable source ${relative.join("/")}`,
    );
  }
  const subsaiCommitReceipt = path.join(subsaiRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(subsaiCommitReceipt) &&
    fs.readFileSync(subsaiCommitReceipt, "utf8").trim() !==
      "5ed78a85d2b868a907c811404f7cd9179db39968"
  ) {
    problems.push(`${label} SubsAI upstream revision is not pinned`);
  }
  forbidMatches(
    subsaiRoot,
    (name) =>
      name === ".venv" ||
      name === ".runtime" ||
      name === "__pycache__" ||
      /\.(?:pyc|pyo)$/u.test(name),
    `${label} forbidden SubsAI mutable/cache file staged`,
  );
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-resource2skill-worker.mjs"),
    `${label} Resource2Skill sealed worker`,
  );
  requireDirectFile(
    path.join(resources, "app-services", "scripts", "resource2skill-bridge.py"),
    `${label} Resource2Skill sealed bridge`,
  );
  for (const relative of [
    ["lib", "runtime-paths.ts"],
    ["lib", "resource2skill", "run-manager.ts"],
    ["lib", "resource2skill", "runtime.ts"],
    ["lib", "resource2skill", "workspace.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} Resource2Skill worker source ${relative.join("/")}`,
    );
  }
  const resource2SkillRoot = path.join(resources, "app-services", "Resource2Skill");
  for (const relative of [
    ["cli.py"],
    ["core", "agent_executor.py"],
    ["requirements.txt"],
    ["LICENSE"],
    ["domains", "web", "domain.yaml"],
    ["domains", "ppt", "domain.yaml"],
    ["domains", "excel", "domain.yaml"],
    ["domains", "blender", "domain.yaml"],
    ["domains", "reaper", "domain.yaml"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(resource2SkillRoot, ...relative),
      `${label} Resource2Skill immutable source ${relative.join("/")}`,
    );
  }
  const resource2SkillCommitReceipt = path.join(resource2SkillRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(resource2SkillCommitReceipt) &&
    fs.readFileSync(resource2SkillCommitReceipt, "utf8").trim() !==
      "7f101b4cfe214cc496d085a34efac528a17cc375"
  ) {
    problems.push(`${label} Resource2Skill upstream revision is not pinned`);
  }
  forbidMatches(
    resource2SkillRoot,
    (name) =>
      name === ".venv" ||
      name === ".runtime" ||
      name === "node_modules" ||
      name === "__pycache__" ||
      /\.(?:pyc|pyo)$/u.test(name),
    `${label} forbidden Resource2Skill mutable/cache file staged`,
  );
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-video-use-worker.mjs"),
    `${label} Video Use sealed worker`,
  );
  for (const relative of [
    ["lib", "video-use", "artifact.ts"],
    ["lib", "video-use", "filters.ts"],
    ["lib", "video-use", "identity.ts"],
    ["lib", "video-use", "media.ts"],
    ["lib", "video-use", "plan.ts"],
    ["lib", "video-use", "program.ts"],
    ["lib", "video-use", "render.ts"],
    ["lib", "video-use", "run-manager.ts"],
    ["lib", "video-use", "runtime-run-manager.ts"],
    ["lib", "video-use", "runtime.ts"],
    ["lib", "video-use", "scribe-shape.ts"],
    ["lib", "video-use", "session.ts"],
    ["lib", "video-use", "speech.ts"],
    ["lib", "video-use", "studio.ts"],
    ["lib", "video-use", "transcript.ts"],
    ["lib", "runtime-v2", "outer-agent-run.ts"],
    ["lib", "runtime-v2", "speech-media-job.ts"],
    ["lib", "runtime-v2", "subsai-transcription-job.ts"],
    ["lib", "scriberr", "client.ts"],
    ["lib", "scriberr", "config.ts"],
    ["lib", "scriberr", "errors.ts"],
    ["lib", "scriberr", "types.ts"],
    ["lib", "subsai", "runtime.ts"],
    ["lib", "subsai", "transcribe.ts"],
    ["lib", "hermes", "artifact-store.ts"],
    ["lib", "hermes", "run-store.ts"],
    ["lib", "hermes", "runtime-store.ts"],
    ["lib", "conversations", "agent-context.ts"],
    ["lib", "conversations", "external-agent-turns.ts"],
    ["lib", "conversations", "store.ts"],
    ["lib", "conversations", "video-blob-store.ts"],
    ["lib", "video-sources", "identity.ts"],
    ["lib", "video-sources", "resolve.ts"],
    ["lib", "runtime-paths.ts"],
    ["lib", "db.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} Video Use worker source ${relative.join("/")}`,
    );
  }
  const videoUseRoot = path.join(resources, "app-services", "video-use");
  for (const check of [
    {
      filePath: path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-speech-media-worker.mjs"),
      expectedHash: "DB8C1EFF878C33CF5303F4F0DE663117E908948707A20ECE2532D9062458FC38",
      label: `${label} Speech/media sealed worker`,
    },
    {
      filePath: path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-speech-media-executor.mjs"),
      expectedHash: "CBA4CFF8C71E2A63628E3B03D4B684D8E4E277CCE65BE4CA4D2217C027E56A28",
      label: `${label} Speech/media sealed executor`,
    },
    {
      filePath: path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-worker-events.mjs"),
      expectedHash: "4ED2F4026FE4824B20437F2A25BD8E1A5C7F3B6D3B564E855EC65B7FBAE08FB2",
      label: `${label} Speech/media sealed worker events`,
    },
    {
      filePath: path.join(dashboard, "worker-src", "lib", "video-use", "filters.ts"),
      expectedHash: "BAD3D74038D03E67908CCAD254E93C022919E6B3E9F14AC1E28AF6AB8D528C52",
      label: `${label} Speech/media Video Use filters source`,
    },
    {
      filePath: path.join(videoUseRoot, "helpers", "pack_transcripts.py"),
      expectedHash: "8571693B23C62938B9A22C51B33284347D6BEF8645372E226E39613BF4A23252",
      label: `${label} Speech/media transcript packer`,
    },
  ]) {
    if (fs.existsSync(check.filePath)) hashChecks.push(check);
  }
  for (const relative of [
    ["SKILL.md"],
    ["LICENSE"],
    ["pyproject.toml"],
    ["helpers", "grade.py"],
    ["helpers", "render.py"],
    ["helpers", "pack_transcripts.py"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
    ["BREADBOARD_PATCHED_FILES.json"],
  ]) {
    requireDirectFile(
      path.join(videoUseRoot, ...relative),
      `${label} Video Use immutable source ${relative.join("/")}`,
    );
  }
  const videoUseCommit = "8e94eb04d22c5de30bd0febd2cd06fb4103949dd";
  const videoUseCommitReceipt = path.join(videoUseRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(videoUseCommitReceipt) &&
    fs.readFileSync(videoUseCommitReceipt, "utf8").trim() !== videoUseCommit
  ) {
    problems.push(`${label} Video Use reviewed source revision is not pinned`);
  }
  const videoUseReviewedReceipt = path.join(videoUseRoot, "BREADBOARD_PATCHED_FILES.json");
  const videoUseReviewedHashes = {
    "helpers/grade.py": "CAC78B55A9D15E5CA52A9FAD043CBAA9BE2A3728C34CE2BC2A55E39BCE88520C",
    "helpers/render.py": "5D8927669DCDBD0C2DE31D9AFF4E9EC6251F2700E8D49463EFAA0918BB698D37",
  };
  if (fs.existsSync(videoUseReviewedReceipt)) {
    try {
      const receipt = JSON.parse(fs.readFileSync(videoUseReviewedReceipt, "utf8"));
      if (
        receipt?.schemaVersion !== 1 ||
        receipt?.upstreamCommit !== videoUseCommit ||
        JSON.stringify(receipt?.files ?? {}) !== JSON.stringify(videoUseReviewedHashes)
      ) {
        problems.push(`${label} Video Use reviewed-file receipt is not exact`);
      }
    } catch (error) {
      problems.push(
        `${label} Video Use reviewed-file receipt is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  for (const [relative, expectedHash] of Object.entries(videoUseReviewedHashes)) {
    const filePath = path.join(videoUseRoot, ...relative.split("/"));
    if (fs.existsSync(filePath)) {
      hashChecks.push({ filePath, expectedHash, label: `${label} Video Use reviewed file ${relative}` });
    }
  }
  forbidMatches(
    videoUseRoot,
    (name) =>
      name === ".git" ||
      name === ".venv" ||
      name === ".runtime" ||
      name === "node_modules" ||
      name === "__pycache__" ||
      /\.(?:pyc|pyo)$/u.test(name),
    `${label} forbidden Video Use mutable/cache file staged`,
  );
  requireDirectFile(
    path.join(resources, "runtimes", "python", "python.exe"),
    `${label} Video Use fixed Python runtime`,
  );
  requireDirectFile(path.join(binRoot, "ffmpeg.exe"), `${label} Video Use fixed ffmpeg`);
  requireDirectFile(path.join(binRoot, "ffprobe.exe"), `${label} Video Use fixed ffprobe`);
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-career-ops-probe-worker.mjs"),
    `${label} Career Ops sealed probe worker`,
  );
  for (const relative of [
    ["lib", "career-ops", "runtime.ts"],
    ["lib", "career-ops", "health-contract.ts"],
    ["lib", "runtime-v2", "career-ops-probe-job.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} Career Ops probe source ${relative.join("/")}`,
    );
  }
  for (const relative of [
    ["lib", "sf3d", "config.ts"],
    ["lib", "sf3d", "request.ts"],
    ["lib", "sf3d", "runtime.ts"],
    ["lib", "sf3d", "service.ts"],
    ["lib", "model-attachments.ts"],
    ["lib", "conversations", "model-inspect.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} SF3D worker source ${relative.join("/")}`,
    );
  }
  const sf3dRoot = path.join(resources, "app-services", "stable-fast-3d");
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-sf3d-worker.mjs"),
    `${label} SF3D sealed worker`,
  );
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "sf3d-bridge.py"),
    `${label} SF3D sealed bridge`,
  );
  for (const relative of [
    ["__init__.py"],
    ["LICENSE.md"],
    ["README.md"],
    ["requirements.txt"],
    ["sf3d", "system.py"],
    ["texture_baker", "texture_baker", "__init__.py"],
    ["uv_unwrapper", "uv_unwrapper", "__init__.py"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(sf3dRoot, ...relative),
      `${label} SF3D immutable source ${relative.join("/")}`,
    );
  }
  const sf3dCommitReceipt = path.join(sf3dRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(sf3dCommitReceipt) &&
    fs.readFileSync(sf3dCommitReceipt, "utf8").trim() !==
      "ff21fc491b4dc5314bf6734c7c0dabd86b5f5bb2"
  ) {
    problems.push(`${label} SF3D upstream revision is not pinned`);
  }
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-openplanter-worker.mjs"),
    `${label} OpenPlanter sealed worker`,
  );
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "openplanter-chatmock-runner.py"),
    `${label} OpenPlanter sealed runner`,
  );
  for (const relative of [
    ["lib", "openplanter", "run-manager.ts"],
    ["lib", "openplanter", "runtime.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} OpenPlanter worker source ${relative.join("/")}`,
    );
  }
  const openPlanterRoot = path.join(resources, "app-services", "OpenPlanter");
  for (const relative of [
    ["pyproject.toml"],
    ["LICENSE"],
    ["agent", "__main__.py"],
    ["agent", "runtime.py"],
    ["wiki", "index.md"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireDirectFile(
      path.join(openPlanterRoot, ...relative),
      `${label} OpenPlanter immutable source ${relative.join("/")}`,
    );
  }
  const openPlanterCommitReceipt = path.join(openPlanterRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(openPlanterCommitReceipt) &&
    fs.readFileSync(openPlanterCommitReceipt, "utf8").trim() !==
      "81d75620ff50a69f576bc19a8bb17738e952387a"
  ) {
    problems.push(`${label} OpenPlanter upstream revision is not pinned`);
  }
  requireDirectFile(
    path.join(resources, "app-services", "dashboard", "scripts", "runtime-v2-manim-worker.mjs"),
    `${label} Manim sealed worker`,
  );
  for (const relative of [
    ["lib", "manim", "config.ts"],
    ["lib", "manim", "request.ts"],
    ["lib", "manim", "service.ts"],
  ]) {
    requireDirectFile(
      path.join(dashboard, "worker-src", ...relative),
      `${label} Manim worker source ${relative.join("/")}`,
    );
  }
  const voxDirectorRoot = path.join(resources, "app-services", "vox-director");
  for (const relative of [
    ["SKILL.md"],
    ["LICENSE"],
    ["references", "beat-layer.md"],
    ["references", "prompt-guide.md"],
    ["scripts", "styles.py"],
    ["scripts", "text_overlay.py"],
    ["scripts", "motion.py"],
    ["scripts", "assemble.py"],
    ["BREADBOARD_UPSTREAM_COMMIT"],
  ]) {
    requireFile(
      path.join(voxDirectorRoot, ...relative),
      `${label} Vox Director local worker source ${relative.join("/")}`,
    );
  }
  if (fs.existsSync(path.join(voxDirectorRoot, "scripts", "provider.py"))) {
    problems.push(`${label} Vox Director provider module was staged outside the sealed local closure`);
  }
  const voxCommitReceipt = path.join(voxDirectorRoot, "BREADBOARD_UPSTREAM_COMMIT");
  if (
    fs.existsSync(voxCommitReceipt) &&
    fs.readFileSync(voxCommitReceipt, "utf8").trim() !==
      "668ec3946fe0139bc985313b15c1a300fca42f94"
  ) {
    problems.push(`${label} Vox Director upstream revision is not pinned`);
  }
  if (fs.existsSync(python)) {
    const voxPython = spawnSync(
      python,
      ["-c", "from PIL import Image, ImageDraw, ImageFont; print(Image.__version__)"],
      { encoding: "utf8", windowsHide: true },
    );
    if (voxPython.status !== 0) {
      const output = `${voxPython.stderr ?? ""}\n${voxPython.stdout ?? ""}`.trim();
      problems.push(`${label} bundled Python cannot import Vox Director Pillow modules: ${output || "unknown error"}`);
    }
  }
  requireFile(
    path.join(
      dashboard,
      "node_modules",
      "@modelcontextprotocol",
      "sdk",
      "dist",
      "esm",
      "client",
      "index.js",
    ),
    `${label} dashboard MCP proxy SDK`,
  );
  requireFile(
    path.join(dashboard, "node_modules", "pdfkit", "js", "pdfkit.js"),
    `${label} dashboard PDFKit runtime`,
  );
  requireFile(
    path.join(dashboard, "node_modules", "pdfkit", "js", "data", "Helvetica.afm"),
    `${label} dashboard PDFKit Helvetica font metrics`,
  );
  requireFile(
    path.join(dashboard, "node_modules", "@embedpdf", "pdfium", "dist", "pdfium.wasm"),
    `${label} dashboard PDFium wasm`,
  );
  if (fs.existsSync(node) && fs.existsSync(dashboard)) {
    const mcpSdkImport = spawnSync(
      node,
      [
        "--input-type=module",
        "-e",
        [
          "await import('@modelcontextprotocol/sdk/client/index.js')",
          "await import('@modelcontextprotocol/sdk/client/stdio.js')",
          "await import('@modelcontextprotocol/sdk/client/streamableHttp.js')",
        ].join(";"),
      ],
      { cwd: dashboard, encoding: "utf8", windowsHide: true },
    );
    if (mcpSdkImport.status !== 0) {
      const output = `${mcpSdkImport.stderr ?? ""}\n${mcpSdkImport.stdout ?? ""}`.trim();
      problems.push(`${label} dashboard cannot load MCP proxy runtime: ${output || "unknown error"}`);
    }

    const pdfParseImport = spawnSync(
      node,
      [
        "--input-type=module",
        "-e",
        "const value = await import('pdf-parse'); if (typeof value.PDFParse !== 'function') process.exit(2)",
      ],
      { cwd: dashboard, encoding: "utf8", windowsHide: true },
    );
    if (pdfParseImport.status !== 0) {
      const output = `${pdfParseImport.stderr ?? ""}\n${pdfParseImport.stdout ?? ""}`.trim();
      problems.push(`${label} dashboard cannot load PDF ingestion runtime: ${output || "unknown error"}`);
    }

    const pdfiumWasmLoad = spawnSync(
      node,
      [
        "--input-type=module",
        "-e",
        [
          "const { readFileSync } = await import('node:fs')",
          "const { createRequire } = await import('node:module')",
          "const require = createRequire(import.meta.url)",
          "const wasmPath = require.resolve('@embedpdf/pdfium/pdfium.wasm')",
          "const raw = readFileSync(wasmPath)",
          "const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)",
          "const { init } = await import('@embedpdf/pdfium')",
          "const wrapped = await init({ wasmBinary })",
          "const pdfium = wrapped.pdfium ?? wrapped",
          "pdfium._PDFiumExt_Init()",
        ].join(";"),
      ],
      { cwd: dashboard, encoding: "utf8", windowsHide: true },
    );
    if (pdfiumWasmLoad.status !== 0) {
      const output = `${pdfiumWasmLoad.stderr ?? ""}\n${pdfiumWasmLoad.stdout ?? ""}`.trim();
      problems.push(`${label} dashboard cannot initialize packaged PDFium wasm: ${output || "unknown error"}`);
    }

    const pdfKitRender = spawnSync(
      node,
      [
        "-e",
        [
          "const PDFDocument = require('pdfkit')",
          "const { PassThrough } = require('node:stream')",
          "const sink = new PassThrough(); sink.resume()",
          "const doc = new PDFDocument({ size: 'A4' }); doc.pipe(sink)",
          "doc.font('Helvetica').fontSize(11).text('Breadboard PDF runtime check.'); doc.end()",
        ].join(";"),
      ],
      { cwd: dashboard, encoding: "utf8", windowsHide: true },
    );
    if (pdfKitRender.status !== 0) {
      const output = `${pdfKitRender.stderr ?? ""}\n${pdfKitRender.stdout ?? ""}`.trim();
      problems.push(`${label} dashboard cannot render PDFs: ${output || "unknown error"}`);
    }
  }
  requireFile(
    path.join(
      resources,
      "app-services",
      "dashboard-standalone",
      "dashboard",
      "node_modules",
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node",
    ),
    `${label} better-sqlite3 native binary`,
  );
  requireFile(
    path.join(
      resources,
      "app-services",
      "dashboard-standalone",
      "dashboard",
      "node_modules",
      "bcrypt",
      "prebuilds",
      "win32-x64",
      "bcrypt.node",
    ),
    `${label} bcrypt native binary`,
  );
  requireFile(
    path.join(resources, "app-services", "chatmock", "chatmock.py"),
    `${label} ChatMock entrypoint`,
  );
  const gbrainAdapter = path.join(resources, "app-services", "gbrain-adapter");
  const gbrainEngine = path.join(resources, "app-services", "gbrain");
  requireDirectFile(
    path.join(gbrainAdapter, "src", "node-entrypoint.mjs"),
    `${label} GBrain adapter entrypoint`,
  );
  requireDirectFile(
    path.join(gbrainAdapter, "src", "node-loader.mjs"),
    `${label} GBrain adapter Node loader`,
  );
  requireDirectFile(
    path.join(gbrainAdapter, "src", "node-server.ts"),
    `${label} GBrain adapter Node transport`,
  );
  requireDirectFile(
    path.join(gbrainAdapter, "src", "request-handler.ts"),
    `${label} GBrain adapter request boundary`,
  );
  requireDirectFile(
    path.join(gbrainEngine, "src", "core", "engine-factory.ts"),
    `${label} vendored GBrain engine`,
  );
  const gbrainReceipt = path.join(gbrainEngine, "runtime-artifact.json");
  requireDirectFile(gbrainReceipt, `${label} GBrain immutable runtime receipt`);
  if (fs.existsSync(gbrainReceipt)) {
    try {
      const receipt = JSON.parse(fs.readFileSync(gbrainReceipt, "utf8"));
      if (JSON.stringify(receipt) !== JSON.stringify(PINNED_GBRAIN_RUNTIME)) {
        problems.push(`${label} GBrain immutable runtime receipt does not match the reviewed closure`);
      }
    } catch (error) {
      problems.push(
        `${label} GBrain immutable runtime receipt is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  for (const [root, expected, runtimeLabel] of [
    [gbrainAdapter, PINNED_GBRAIN_RUNTIME.adapter, "adapter"],
    [gbrainEngine, PINNED_GBRAIN_RUNTIME.engine, "engine"],
  ]) {
    const packagePath = path.join(root, "package.json");
    const lockPath = path.join(root, "bun.lock");
    const pglitePath = path.join(root, "node_modules", "@electric-sql", "pglite", "package.json");
    requireDirectFile(packagePath, `${label} GBrain ${runtimeLabel} package metadata`);
    requireDirectFile(lockPath, `${label} GBrain ${runtimeLabel} frozen Bun lock`);
    requireDirectFile(
      pglitePath,
      `${label} vendored GBrain PGLite dependency (${runtimeLabel})`,
    );
    if (fs.existsSync(packagePath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        if (manifest.name !== expected.package || manifest.version !== expected.version) {
          problems.push(`${label} GBrain ${runtimeLabel} package identity is not pinned`);
        }
      } catch (error) {
        problems.push(`${label} GBrain ${runtimeLabel} package metadata is invalid JSON`);
      }
    }
    if (fs.existsSync(pglitePath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(pglitePath, "utf8"));
        if (manifest.version !== expected.pgliteVersion) {
          problems.push(
            `${label} GBrain ${runtimeLabel} PGLite is ${manifest.version ?? "unknown"}, expected ${expected.pgliteVersion}`,
          );
        }
      } catch (error) {
        problems.push(`${label} GBrain ${runtimeLabel} PGLite metadata is invalid JSON`);
      }
    }
    if (fs.existsSync(packagePath)) {
      hashChecks.push({
        filePath: packagePath,
        expectedHash: expected.packageSha256,
        label: `${label} GBrain ${runtimeLabel} package metadata`,
        canonical: true,
      });
    }
    if (fs.existsSync(lockPath)) {
      hashChecks.push({
        filePath: lockPath,
        expectedHash: expected.bunLockSha256,
        label: `${label} GBrain ${runtimeLabel} frozen Bun lock`,
        canonical: true,
      });
    }
    const sourceRoot = path.join(root, "src");
    if (fs.existsSync(sourceRoot)) {
      treeHashChecks.push({
        root: sourceRoot,
        expectedHash: expected.sourceSha256,
        expectedFileCount: expected.sourceFileCount,
        label: `${label} GBrain ${runtimeLabel} source closure`,
      });
    }
  }
  for (const [relativePath, expectedHash, artifactLabel] of [
    ["LICENSE", PINNED_GBRAIN_RUNTIME.engine.licenseSha256, "license"],
    ["UPSTREAM.json", PINNED_GBRAIN_RUNTIME.engine.upstreamReceiptSha256, "upstream receipt"],
    ["VERSION", PINNED_GBRAIN_RUNTIME.engine.versionFileSha256, "version file"],
  ]) {
    const artifactPath = path.join(gbrainEngine, relativePath);
    requireDirectFile(artifactPath, `${label} GBrain ${artifactLabel}`);
    if (fs.existsSync(artifactPath)) {
      hashChecks.push({
        filePath: artifactPath,
        expectedHash,
        label: `${label} GBrain ${artifactLabel}`,
        canonical: true,
      });
    }
  }
  const gbrainImportInputs = [
    bun,
    path.join(gbrainAdapter, "src", "config.ts"),
    path.join(gbrainAdapter, "node_modules", "@electric-sql", "pglite", "package.json"),
    path.join(gbrainEngine, "src", "core", "engine-factory.ts"),
  ];
  if (gbrainImportInputs.every((entry) => fs.existsSync(entry))) {
    const gbrainImport = spawnSync(
      bun,
      [
        "--eval",
        [
          "const [{ PGlite }, adapter, engine] = await Promise.all([",
          "  import('@electric-sql/pglite'),",
          "  import('./src/config.ts'),",
          "  import('../gbrain/src/core/engine-factory.ts'),",
          "])",
          "if (typeof PGlite !== 'function' || typeof adapter.resolveConfig !== 'function' || typeof engine.createEngine !== 'function') process.exit(2)",
        ].join("\n"),
      ],
      { cwd: gbrainAdapter, encoding: "utf8", windowsHide: true },
    );
    if (gbrainImport.status !== 0) {
      const output = `${gbrainImport.stderr ?? ""}\n${gbrainImport.stdout ?? ""}`.trim();
      problems.push(`${label} bundled Bun cannot import the GBrain runtime closure: ${output || "unknown error"}`);
    }
  }
  const comfyUiSource = path.join(resources, "app-services", "comfyui");
  requireFile(path.join(comfyUiSource, "main.py"), `${label} ComfyUI entrypoint`);
  requireFile(
    path.join(comfyUiSource, "requirements.txt"),
    `${label} ComfyUI setup requirements`,
  );
  requireFile(path.join(comfyUiSource, "LICENSE"), `${label} ComfyUI source license`);
  requireFile(
    path.join(resources, "app-services", "scripts", "setup-comfyui.mjs"),
    `${label} explicit ComfyUI setup script`,
  );
  requireFile(
    path.join(resources, "licenses", "comfyui-LICENSE.txt"),
    `${label} ComfyUI packaged license notice`,
  );
  for (const mutableName of ["models", "input", "output", "temp", "user"]) {
    if (fs.existsSync(path.join(comfyUiSource, mutableName))) {
      problems.push(`${label} ComfyUI mutable ${mutableName} directory was staged`);
    }
  }
  requireFile(
    path.join(resources, "app-services", "agency-agents", "divisions.json"),
    `${label} Agency Agents division catalog`,
  );
  requireFile(
    path.join(
      resources,
      "app-services",
      "agency-agents",
      "engineering",
      "engineering-backend-architect.md",
    ),
    `${label} Agency Agents persona files`,
  );
  requireFile(
    path.join(resources, "app-services", "agency-agents", "LICENSE"),
    `${label} Agency Agents license`,
  );
  requireFile(
    path.join(resources, "app-services", "goal", "templates", "continuation.md"),
    `${label} Goal Mode continuation contract`,
  );
  requireFile(
    path.join(resources, "app-services", "goal", "templates", "budget_limit.md"),
    `${label} Goal Mode budget-limit contract`,
  );
  requireFile(
    path.join(resources, "app-services", "goal", "LICENSE"),
    `${label} Goal Mode upstream license`,
  );
  requireFile(
    path.join(resources, "app-services", "goal", "BREADBOARD_UPSTREAM_COMMIT"),
    `${label} Goal Mode upstream revision`,
  );
  requireFile(
    path.join(resources, "app-services", "scripts", "start-postiz-supervisor.mjs"),
    `${label} Postiz supervisor entrypoint`,
  );
  requireFile(
    path.join(resources, "app-services", "scripts", "ifixai-background-runner.py"),
    `${label} iFixAi background bridge`,
  );
  requireFile(
    path.join(resources, "app-services", "ifixai", "LICENSE"),
    `${label} iFixAi upstream license`,
  );
  requireFile(
    path.join(resources, "app-services", "ifixai", "BREADBOARD_UPSTREAM_COMMIT"),
    `${label} staged iFixAi commit pin`,
  );
  requireFile(
    path.join(resources, "runtimes", "python", "ifixai-upstream-commit.txt"),
    `${label} bundled iFixAi commit pin`,
  );
  requireFile(
    path.join(resources, "runtimes", "python", "Lib", "site-packages", "ifixai", "__init__.py"),
    `${label} bundled iFixAi package`,
  );
  if (fs.existsSync(python)) {
    const ifixAiImport = spawnSync(
      python,
      ["-c", "import ifixai; from ifixai.api import run_selected; print(ifixai.__version__)"],
      { encoding: "utf8", windowsHide: true },
    );
    if (ifixAiImport.status !== 0) {
      const output = `${ifixAiImport.stderr ?? ""}\n${ifixAiImport.stdout ?? ""}`.trim();
      problems.push(`${label} bundled Python cannot import iFixAi: ${output || "unknown error"}`);
    }
  }
  requireFile(
    path.join(resources, "app-services", "postiz-app", "docker-compose.yaml"),
    `${label} Postiz Compose definition`,
  );
  for (const moduleName of ["api-client.ts", "bootstrap.ts", "config.ts", "docker.ts", "local-state.ts", "stack.ts"]) {
    requireFile(
      path.join(resources, "app-services", "dashboard", "src", "lib", "socials-manager", moduleName),
      `${label} Postiz supervisor module ${moduleName}`,
    );
  }
  requireFile(
    path.join(resources, "app-services", "inbox-zero", "docker-compose.yml"),
    `${label} Inbox Zero Compose definition`,
  );
  requireFile(
    path.join(resources, "app-services", "inbox-zero", "LICENSE"),
    `${label} Inbox Zero license`,
  );
  checkPinnedOciCompose(resources, label, {
    label: "Postiz",
    directory: "postiz-app",
    composeFile: "docker-compose.yaml",
    vendorDirectory: "postiz",
    receiptStack: "postiz",
    sourceCommit: "cf4c432c00c9db775ea1b1f12480a8e2b89aec32",
    imageCount: 9,
  });
  checkPinnedOciCompose(resources, label, {
    label: "Inbox Zero",
    directory: "inbox-zero",
    composeFile: "docker-compose.yml",
    vendorDirectory: "inbox-zero",
    receiptStack: "inbox-zero",
    sourceCommit: "0006bea20b141d7386d76d32a6e4551c8333dd59",
    imageCount: 6,
  });
  const mem0Runtime = path.join(
    resources,
    "app-services",
    "dashboard",
    "node_modules",
    "mem0ai",
  );
  const mem0RuntimeReceipt = path.join(mem0Runtime, "runtime-artifact.json");
  requireExactJsonReceipt(
    mem0RuntimeReceipt,
    `${label} Mem0 immutable runtime receipt`,
    PINNED_MEM0_RUNTIME,
  );
  requireSourceCommitReceipt(
    mem0Runtime,
    `${label} Mem0 reviewed source`,
    PINNED_PACKAGED_SERVICE_COMMITS.mem0,
  );
  for (const [relative, artifactLabel] of [
    ["package.json", "package manifest"],
    ["pnpm-lock.yaml", "frozen dependency lock"],
    ["pnpm-workspace.yaml", "workspace policy"],
    ["LICENSE", "license"],
    ["dist/oss/index.mjs", "semantic-memory bundle"],
    ["node_modules/pg/package.json", "Postgres vector-store dependency"],
    [
      "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      "Better SQLite native dependency",
    ],
  ]) {
    requireDirectFile(
      path.join(mem0Runtime, ...relative.split("/")),
      `${label} Mem0 ${artifactLabel}`,
    );
  }
  for (const [relative, expected, artifactLabel] of [
    ["package.json", PINNED_MEM0_RUNTIME.source.packageManifest, "package manifest"],
    ["pnpm-lock.yaml", PINNED_MEM0_RUNTIME.source.dependencyLock, "frozen dependency lock"],
    ["pnpm-workspace.yaml", PINNED_MEM0_RUNTIME.source.workspaceManifest, "workspace policy"],
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
    const artifact = path.join(mem0Runtime, ...relative.split("/"));
    if (fs.existsSync(artifact)) {
      hashChecks.push({
        filePath: artifact,
        expectedHash: expected.sha256,
        expectedSize: expected.size,
        canonical: !artifact.endsWith(".node"),
        label: `${label} Mem0 ${artifactLabel}`,
      });
    }
  }
  const mem0Dist = path.join(mem0Runtime, "dist");
  if (fs.existsSync(mem0Dist)) {
    treeHashChecks.push({
      root: mem0Dist,
      expectedHash: PINNED_MEM0_RUNTIME.dist.stagedOutput.sha256,
      expectedFileCount: PINNED_MEM0_RUNTIME.dist.stagedOutput.fileCount,
      label: `${label} Mem0 reviewed runtime bundle`,
    });
  }
  if (fs.existsSync(mem0Runtime)) {
    treeHashChecks.push({
      root: mem0Runtime,
      expectedHash: PINNED_MEM0_RUNTIME.closure.sha256,
      expectedFileCount: PINNED_MEM0_RUNTIME.closure.fileCount,
      skip: (relative) => PINNED_MEM0_RUNTIME.closure.excludes.includes(relative),
      label: `${label} Mem0 portable runtime closure`,
    });
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(mem0Runtime, "package.json"), "utf8"));
      if (
        manifest.name !== PINNED_MEM0_RUNTIME.name ||
        manifest.version !== PINNED_MEM0_RUNTIME.version ||
        manifest.packageManager !== PINNED_MEM0_RUNTIME.build.packageManager
      ) {
        problems.push(`${label} Mem0 package identity or package-manager pin changed`);
      }
      for (const [name, version] of Object.entries(PINNED_MEM0_RUNTIME.dependencies)) {
        const dependency = JSON.parse(
          fs.readFileSync(
            path.join(mem0Runtime, "node_modules", ...name.split("/"), "package.json"),
            "utf8",
          ),
        );
        if (dependency.name !== name || dependency.version !== version) {
          problems.push(`${label} Mem0 dependency ${name} is not pinned to ${version}`);
        }
      }
    } catch (error) {
      problems.push(
        `${label} Mem0 package metadata is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const mem0ImportInputs = [
    node,
    path.join(mem0Runtime, "dist", "oss", "index.mjs"),
    path.join(mem0Runtime, "node_modules", "better-sqlite3", "package.json"),
    path.join(mem0Runtime, "node_modules", "pg", "package.json"),
  ];
  if (mem0ImportInputs.every((entry) => fs.existsSync(entry))) {
    const mem0Import = spawnSync(
      node,
      [
        "--input-type=module",
        "-e",
        [
          `if (process.version !== 'v${PINNED_MEM0_RUNTIME.build.nodeVersion}') process.exit(5)`,
          "const mem0 = await import('./dist/oss/index.mjs')",
          "const sqlite = await import('better-sqlite3')",
          "const postgres = await import('pg')",
          "if (typeof mem0.Memory !== 'function' || typeof sqlite.default !== 'function' || !(postgres.default?.Client || postgres.Client)) process.exit(6)",
        ].join("\n"),
      ],
      { cwd: mem0Runtime, encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000 },
    );
    if (mem0Import.status !== 0) {
      const output = `${mem0Import.stderr ?? ""}\n${mem0Import.stdout ?? ""}`.trim();
      problems.push(`${label} bundled Node cannot import the Mem0 runtime closure: ${output || "unknown error"}`);
    }
  }
  requireFile(
    path.join(resources, "app-services", "dashboard", "node_modules", "@modelcontextprotocol", "sdk", "package.json"),
    `${label} Runtime MCP service dependency`,
  );
  requireFile(
    path.join(resources, "app-services", "mcp-google-images-search", "src", "index.js"),
    `${label} Google image-search MCP entrypoint`,
  );
  requireFile(
    path.join(resources, "app-services", "mcp-google-images-search", "LICENSE"),
    `${label} Google image-search MCP license`,
  );
  requireSourceCommitReceipt(
    path.join(resources, "app-services", "mcp-google-images-search"),
    `${label} Google image-search MCP reviewed local source`,
    PINNED_LOCAL_SOURCE_COMMITS.googleImages,
  );
  requireFile(
    path.join(resources, "app-services", "dashboard", "src", "lib", "runtime-paths.ts"),
    `${label} Postiz supervisor runtime paths module`,
  );
  requireFile(
    path.join(resources, "app-services", "postiz-app", "dynamicconfig", "development-sql.yaml"),
    `${label} Postiz Temporal dynamic configuration`,
  );
  const uiTarsAdapter = path.join(resources, "app-services", "ui-tars-adapter");
  requireFile(
    path.join(uiTarsAdapter, "src", "server.ts"),
    `${label} Agent TARS adapter entrypoint`,
  );
  requireFile(
    path.join(uiTarsAdapter, "node_modules", "@ui-tars", "sdk", "package.json"),
    `${label} Agent TARS desktop SDK`,
  );
  requireFile(
    path.join(
      uiTarsAdapter,
      "node_modules",
      "@computer-use",
      "libnut-win32",
      "build",
      "Release",
      "libnut.node",
    ),
    `${label} Agent TARS Windows desktop native module`,
  );
  if (fs.existsSync(node) && fs.existsSync(uiTarsAdapter)) {
    const desktopOperatorImport = spawnSync(
      node,
      [
        "--input-type=module",
        "-e",
        "const [{GUIAgent},{NutJSOperator}] = await Promise.all([import('@ui-tars/sdk'), import('@ui-tars/operator-nut-js')]); if (typeof GUIAgent !== 'function' || typeof NutJSOperator !== 'function') process.exit(2)",
      ],
      { cwd: uiTarsAdapter, encoding: "utf8", windowsHide: true },
    );
    if (desktopOperatorImport.status !== 0) {
      const output = `${desktopOperatorImport.stderr ?? ""}\n${desktopOperatorImport.stdout ?? ""}`.trim();
      problems.push(`${label} cannot load the Agent TARS desktop runtime: ${output || "unknown error"}`);
    }
  }
  requireFile(
    path.join(resources, "app-services", "chatmock", "chatmock", "cli.py"),
    `${label} ChatMock package`,
  );
  if (fs.existsSync(python)) {
    const chatMockImport = spawnSync(python, ["-c", "import chatmock; import chatmock.cli"], {
      cwd: path.join(resources, "app-services", "chatmock"),
      encoding: "utf8",
      windowsHide: true,
    });
    if (chatMockImport.status !== 0) {
      const output = `${chatMockImport.stderr ?? ""}\n${chatMockImport.stdout ?? ""}`.trim();
      problems.push(`${label} bundled Python cannot import ChatMock: ${output || "unknown error"}`);
    }
  }
  requireFile(
    path.join(resources, "app-services", "hermes-config", "system", "main-assistant.md"),
    `${label} Hermes system prompt`,
  );
    requireFile(
      path.join(
        resources,
        "app-services",
        "nango",
        "packages",
        "providers",
        "providers.yaml",
      ),
      `${label} connected-app provider catalog`,
    );
  requireFile(
    path.join(resources, "app-services", "scientific-agent-skills", "skills", "scientific-writing", "SKILL.md"),
    `${label} scientific skills catalog`,
  );
  requireFile(
    path.join(resources, "app-services", "scientific-agent-skills", "BREADBOARD_UPSTREAM_COMMIT"),
    `${label} scientific skills commit pin`,
  );
  requireFile(
    path.join(
      resources,
      "app-services",
      "hermes-skills",
      "prebuilt",
      "interactive-visualizer",
      "SKILL.md",
    ),
    `${label} first-party interactive visualizer skill`,
  );
  const textToCadRoot = path.join(
    resources,
    "app-services",
    "hermes-skills",
    "prebuilt",
  );
  requireFile(
    path.join(textToCadRoot, "TEXT_TO_CAD_UPSTREAM.json"),
    `${label} text-to-cad upstream receipt`,
  );
  for (const skill of [
    "bambu-labs",
    "cad",
    "cad-viewer",
    "dfam-check",
    "dxf",
    "gcode",
    "implicit-cad",
    "sdf",
    "sendcutsend",
    "srdf",
    "step-parts",
    "urdf",
  ]) {
    for (const relative of ["SKILL.md", "LICENSE", path.join("agents", "openai.yaml")]) {
      requireFile(
        path.join(textToCadRoot, skill, relative),
        `${label} text-to-cad ${skill} ${relative}`,
      );
    }
  }
  for (const [relative, description] of [
    [["dxf", "scripts", "gen", "__main__.py"], "text-to-cad DXF launcher"],
    [
      ["cad-viewer", "scripts", "viewer", "dist", "index.html"],
      "text-to-cad offline CAD viewer",
    ],
  ]) {
    requireFile(
      path.join(textToCadRoot, ...relative),
      `${label} ${description}`,
    );
  }
  requireFile(
    path.join(dashboard, "node_modules", "three", "build", "three.module.js"),
    `${label} pinned local Three.js runtime`,
  );
  requireFile(
    path.join(resources, "runtimes", "python", "hermes-upstream-commit.txt"),
    `${label} Hermes runtime pin`,
  );
  requireFile(
    path.join(resources, "app-services", "hermes-agent", "hermes_cli", "main.py"),
    `${label} Hermes entrypoint`,
  );
  requireFile(
    path.join(resources, "app-services", "hermes-agent", "plugins", "breadboard", "plugin.yaml"),
    `${label} Breadboard Hermes plugin manifest`,
  );
  // The WhatsApp bridge is spawned by the dashboard, and the bundled Node runtime
  // has no npm, so its dependencies must already be installed in the package.
  const whatsAppBridge = path.join(
    resources,
    "app-services",
    "hermes-agent",
    "scripts",
    "whatsapp-bridge",
  );
  requireFile(path.join(whatsAppBridge, "bridge.js"), `${label} WhatsApp bridge`);
  requireFile(
    path.join(whatsAppBridge, "node_modules", "@whiskeysockets", "baileys", "package.json"),
    `${label} WhatsApp bridge dependencies`,
  );
  const breadboardPluginRoot = path.join(
    resources,
    "app-services",
    "hermes-agent",
    "plugins",
    "breadboard",
  );
  const breadboardPluginSource = path.join(breadboardPluginRoot, "__init__.py");
  const breadboardPluginManifest = path.join(breadboardPluginRoot, "plugin.yaml");
  requireFile(breadboardPluginSource, `${label} Breadboard Hermes plugin source`);
  if (fs.existsSync(breadboardPluginSource) && fs.existsSync(breadboardPluginManifest)) {
    const source = fs.readFileSync(breadboardPluginSource, "utf8");
    const manifest = fs.readFileSync(breadboardPluginManifest, "utf8");
    for (const tool of [
      "interactive_visualizer_plan",
      "interactive_visualizer_generate",
      "interactive_visualizer_revise",
      "interactive_visualizer_rollback",
      "interactive_visualizer_cancel",
      "product_search",
    ]) {
      if (!source.includes(`"${tool}"`)) {
        problems.push(`${label} Breadboard Hermes plugin source is missing ${tool}`);
      }
      if (!manifest.includes(`- ${tool}`)) {
        problems.push(`${label} Breadboard Hermes plugin manifest is missing ${tool}`);
      }
    }
  }
  requireFile(
    path.join(resources, "app-services", "hermes-agent", "BREADBOARD_UPSTREAM_COMMIT"),
    `${label} staged Hermes commit pin`,
  );
  if (fs.existsSync(python)) {
    const hermesImport = spawnSync(
      python,
      [path.join(resources, "app-services", "hermes-agent", "breadboard_runtime.py"), "--check-imports"],
      {
        cwd: path.join(resources, "app-services", "hermes-agent"),
        encoding: "utf8",
        windowsHide: true,
      },
    );
    if (hermesImport.status !== 0) {
      const output = `${hermesImport.stderr ?? ""}\n${hermesImport.stdout ?? ""}`.trim();
      problems.push(`${label} bundled Python cannot import Hermes: ${output || "unknown error"}`);
    }
  }
  requireFile(
    path.join(resources, "app-services", "quartz-template", "quartz", "bootstrap-cli.mjs"),
    `${label} Quartz CLI`,
  );
  requireFile(
    path.join(resources, "app-services", "quartz-template", "node_modules", "preact", "package.json"),
    `${label} Quartz node_modules`,
  );
  forbidMatches(
    path.join(resources, "app-services"),
    (name) => /\.(db|db-shm|db-wal)$/.test(name),
    `${label} forbidden database file staged`,
  );
  forbidMatches(
    path.join(resources, "app-services"),
    (name) => /^\.env(?:\.|$)/u.test(name) && !name.endsWith(".example"),
    `${label} forbidden env file staged`,
  );
  // Model weights are a user download, never a shipped asset. The humanizer's
  // checkpoint in particular carries an unresolved upstream licence (see
  // humanizer-service/THIRD_PARTY_NOTICES.md), so a build that contained one
  // would be redistributing something this project has no right to.
  // `.pth` is deliberately absent: it is PyTorch's checkpoint extension and
  // also Python's path-configuration extension, and every staged virtualenv is
  // full of the latter. The extensions below have no such second meaning, and
  // they are the ones this model would actually arrive as.
  forbidMatches(
    path.join(resources, "app-services"),
    (name) => /\.(safetensors|ckpt|onnx|gguf)$/.test(name) || name === "pytorch_model.bin",
    `${label} forbidden model weights staged`,
  );
}

const stagedResourcesRoot = path.join(desktopRoot, "build-resources");
const stagedBinRoot = path.join(desktopRoot, "resources", "bin");
checkResourcesRoot(stagedResourcesRoot, stagedBinRoot, "build-resources");
checkTranscriptionRuntime(stagedBinRoot, "desktop native transcription runtime");

const localBase =
  process.env.BREADBOARD_DESKTOP_RELEASE_DIR?.trim() ||
  (process.platform === "win32" && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "breadboard-desktop-build", "release")
    : path.join(desktopRoot, "release"));
const winUnpacked = fs.existsSync(path.join(localBase, "win-unpacked"))
  ? path.join(localBase, "win-unpacked")
  : path.join(desktopRoot, "release", "win-unpacked");
if (fs.existsSync(winUnpacked)) {
  requireFile(path.join(winUnpacked, "Breadboard.exe"), "packaged executable");
  const packagedResourcesRoot = path.join(winUnpacked, "resources");
  checkResourcesRoot(
    packagedResourcesRoot,
    path.join(packagedResourcesRoot, "bin"),
    "win-unpacked",
  );
  checkTranscriptionRuntime(
    path.join(winUnpacked, "resources", "bin"),
    "packaged native transcription runtime",
  );
  requireFile(path.join(winUnpacked, "resources", "app.asar"), "packaged app.asar");
} else {
  console.log("[verify-package] release/win-unpacked not present; checked staging roots only");
}

if (fs.existsSync(localBase)) {
  for (const name of fs.readdirSync(localBase)) {
    if (!/^Breadboard-Setup-.*-x64\.exe$/.test(name)) continue;
    const installer = path.join(localBase, name);
    if (fs.statSync(installer).size < 10 * 1024 * 1024) {
      problems.push(`incomplete NSIS installer (under 10 MB): ${installer}`);
    }
  }
}

for (const check of hashChecks) {
  try {
    const actual = check.canonical
      ? canonicalFileIdentity(check.filePath)
      : { size: fs.statSync(check.filePath).size, sha256: await sha256File(check.filePath) };
    if (
      check.expectedSize !== undefined &&
      actual.size !== check.expectedSize
    ) {
      problems.push(`${check.label} size is not pinned (${actual.size})`);
    }
    if (actual.sha256 !== check.expectedHash) {
      problems.push(`${check.label} SHA-256 is not pinned (${actual.sha256})`);
    }
  } catch (error) {
    problems.push(
      `${check.label} could not be hashed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

for (const check of treeHashChecks) {
  try {
    const identity = await sha256Tree(check.root, check.skip);
    if (
      identity.sha256 !== check.expectedHash ||
      identity.fileCount !== check.expectedFileCount
    ) {
      problems.push(
        `${check.label} is not pinned (${identity.fileCount} files, SHA-256 ${identity.sha256})`,
      );
    }
  } catch (error) {
    problems.push(
      `${check.label} could not be hashed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

if (problems.length > 0) {
  console.error("[verify-package] FAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("[verify-package] OK");
