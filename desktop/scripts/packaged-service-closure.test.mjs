import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(desktopRoot, "runtime-v2", "manifests", "services.json"), "utf8"),
);
const verifier = fs.readFileSync(path.join(desktopRoot, "scripts", "verify-package.mjs"), "utf8");
const preparer = fs.readFileSync(path.join(desktopRoot, "scripts", "prepare-app-resources.mjs"), "utf8");
const mem0Setup = fs.readFileSync(path.join(repoRoot, "scripts", "setup-mem0.mjs"), "utf8");
const serviceEnvironment = fs.readFileSync(
  path.join(repoRoot, "native", "runtime-core", "src", "service_environment.rs"),
  "utf8",
);

function canonicalTreeIdentity(root) {
  const records = [];
  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
      const metadata = fs.lstatSync(fullPath);
      assert.equal(metadata.isSymbolicLink(), false, relativePath);
      if (metadata.isDirectory()) visit(fullPath);
      else if (metadata.isFile()) {
        const bytes = fs.readFileSync(fullPath);
        const canonical = bytes.includes(0)
          ? bytes
          : Buffer.from(bytes.toString("utf8").replace(/\r\n/gu, "\n"), "utf8");
        const sha256 = createHash("sha256").update(canonical).digest("hex").toUpperCase();
        records.push(`${relativePath}\0${canonical.length}\0${sha256}\n`);
      }
    }
  }
  visit(root);
  return {
    fileCount: records.length,
    sha256: createHash("sha256").update(records.join("")).digest("hex").toUpperCase(),
  };
}

function closureRows() {
  const start = verifier.indexOf("const PACKAGED_SERVICE_CLOSURE_POLICIES");
  const end = verifier.indexOf("function packagedAuthorityPath", start);
  assert.ok(start >= 0 && end > start, "packaged closure matrix must be explicit in verifier source");
  const rows = new Map();
  let current = null;
  for (const line of verifier.slice(start, end).split(/\r?\n/u)) {
    const row = /^  (?:(?:"([a-z0-9-]+)")|([a-z][a-z0-9-]*)): \{/u.exec(line);
    if (row) {
      current = row[1] ?? row[2];
      rows.set(current, line);
    } else if (current) {
      rows.set(current, `${rows.get(current)}\n${line}`);
    }
  }
  return rows;
}

function packagedDataReferences(profile) {
  const references = [];
  if (profile.executableAuthority === "data-root") references.push("runtime-prerequisite");
  for (const argument of profile.arguments ?? []) {
    if (argument.kind === "data-path") references.push("writable-data");
  }
  if (profile.workingDirectory?.kind === "data-subdirectory") references.push("writable-data");
  for (const probe of profile.installProbe?.files ?? []) {
    if (probe.authority === "data-root") references.push("runtime-prerequisite");
  }
  return references;
}

test("all 32 process services have one audited packaged closure row", () => {
  assert.equal(manifest.services.length, 32);
  const rows = closureRows();
  assert.deepEqual([...rows.keys()].sort(), manifest.services.map(({ id }) => id).sort());
  for (const service of manifest.services) {
    assert.equal(service.requirement, "required", `${service.id} must be mandatory`);
    for (const mode of ["lean", "hot", "packaged"]) {
      assert.equal(
        service.launchProfiles.filter((profile) => profile.modes.includes(mode)).length,
        1,
        `${service.id} must have exactly one ${mode} profile`,
      );
    }
    const row = rows.get(service.id);
    const policy = /dataRoot: "([a-z-]+)"/u.exec(row)?.[1];
    assert.ok(policy, `${service.id} closure row must declare its data-root policy`);
    assert.match(row, /bootstrap:/u, `${service.id} closure row must name an immutable bootstrap`);
    const profile = service.launchProfiles.find(({ modes }) => modes.includes("packaged"));
    const references = packagedDataReferences(profile);
    if (references.length > 0) assert.notEqual(policy, "none", service.id);
    if (references.includes("runtime-prerequisite")) {
      assert.equal(policy, "managed-install", service.id);
    }
  }
  assert.doesNotMatch(
    verifier.slice(verifier.indexOf("function packagedAuthorityPath"), verifier.indexOf("function checkTranscriptionRuntime")),
    /return null/u,
    "data-root authorities must never be silently skipped",
  );
});

test("packaged native services launch only reviewed immutable artifacts", () => {
  const byId = new Map(manifest.services.map((service) => [service.id, service]));
  const packaged = (id) =>
    byId.get(id).launchProfiles.find(({ modes }) => modes.includes("packaged"));

  assert.equal(packaged("voicebox").allowedExecutable, "bin/voicebox-server.exe");
  assert.ok(packaged("voicebox").installProbe.files.some(({ path: value }) =>
    value === "bin/voicebox-runtime-artifact.json"));
  assert.doesNotMatch(JSON.stringify(packaged("voicebox")), /python|setup-voicebox|start-voicebox/iu);

  assert.equal(packaged("recall").allowedExecutable, "bin/recall/screenpipe.exe");
  assert.ok(packaged("recall").installProbe.files.some(({ path: value }) =>
    value === "bin/recall/runtime-artifact.json"));

  assert.ok(packaged("cliproxy").installProbe.files.some(({ path: value }) =>
    value === "bin/cliproxy-runtime-artifact.json"));
  assert.ok(packaged("openscience").installProbe.files.some(({ authority, path: value }) =>
    authority === "app-root" && value === "openscience-cli/runtime-artifact.json"));

  assert.ok(packaged("openwork").installProbe.files.some(({ authority, path: value }) =>
    authority === "app-root" && value === "openwork-runtime/runtime-artifact.json"));
  assert.ok(packaged("openwork").installProbe.files.some(({ authority, path: value }) =>
    authority === "app-root" && value === "openwork-runtime/apps/server/src/cli.ts"));
  assert.doesNotMatch(JSON.stringify(packaged("openwork")), /data-root|data-path/iu);

  assert.equal(packaged("comfyui").allowedExecutable, "runtimes/comfyui-python/python.exe");
  assert.ok(packaged("comfyui").installProbe.files.some(({ authority, path: value }) =>
    authority === "runtime-root" && value === "runtimes/comfyui-python/runtime-artifact.json"));
  assert.ok(packaged("comfyui").installProbe.files.some(({ authority, path: value }) =>
    authority === "app-root" && value === "comfyui/runtime-artifact.json"));
  assert.doesNotMatch(JSON.stringify(packaged("comfyui")), /runtime-v2\/services\/comfyui\/\.venv/iu);
  for (const profile of byId.get("comfyui").launchProfiles) {
    const entrypointIndex = profile.arguments.findIndex(
      ({ path: value }) => value?.endsWith("comfyui/main.py"),
    );
    const cpuIndex = profile.arguments.findIndex(
      ({ kind, value }) => kind === "literal" && value === "--cpu",
    );
    assert.equal(cpuIndex, entrypointIndex + 1, "ComfyUI CPU policy must follow its entrypoint");
  }

  assert.ok(packaged("wardrobe").installProbe.files.some(({ authority, path: value }) =>
    authority === "app-root" && value === "wardrobe-runtime/runtime-artifact.json"));
  assert.ok(packaged("wardrobe").installProbe.files.some(({ authority, path: value }) =>
    authority === "app-root" && value === "wardrobe-runtime/node_modules/vite/bin/vite.js"));
  assert.doesNotMatch(JSON.stringify(packaged("wardrobe")), /data-root|data-path|npm|managed-setup/iu);

  assert.ok(packaged("mem0-semantic-engine").installProbe.files.some(({ authority, path: value }) =>
    authority === "app-root" && value === "dashboard/node_modules/mem0ai/runtime-artifact.json"));
  assert.ok(packaged("mem0-semantic-engine").installProbe.files.some(({ authority, path: value }) =>
    authority === "app-root" &&
      value === "dashboard/node_modules/mem0ai/node_modules/better-sqlite3/build/Release/better_sqlite3.node"));
  assert.ok(packaged("mem0-semantic-engine").installProbe.files.some(({ authority, path: value }) =>
    authority === "app-root" && value === "dashboard/node_modules/mem0ai/node_modules/pg/package.json"));

  assert.match(preparer, /Voicebox's reviewed native artifact receipt is missing/u);
  assert.match(preparer, /assertVoiceboxArtifactReceipt\(receipt\)/u);
  assert.match(verifier, /voiceboxArtifactReceiptProblems\(reviewed\)/u);
  assert.match(verifier, /receiptBytesMatch/u);
  assert.match(preparer, /PINNED_CLIPROXY_RUNTIME/u);
  assert.match(preparer, /PINNED_RECALL_RUNTIME/u);
  assert.match(preparer, /PINNED_OPENSCIENCE_RUNTIME/u);
  assert.match(preparer, /PINNED_OPENWORK_RUNTIME/u);
  assert.match(
    preparer,
    /label: "openwork",[\s\S]*materializedLinks: \[[\s\S]*@openwork\/paths[\s\S]*@openwork\/types/u,
  );
  assert.match(preparer, /PINNED_WARDROBE_RUNTIME/u);
  assert.match(preparer, /PINNED_MEM0_RUNTIME/u);
  assert.match(
    preparer,
    /const source = resolvePortableDependency\(googleImagesSource, dependency\);[\s\S]*copyPortableDependency\(\{[\s\S]*target: path\.join\(googleModulesTarget/u,
  );
  assert.match(
    preparer,
    /Resource2Skill pinned immutable source[\s\S]*?"ls-files", "-z"[\s\S]*?maxBuffer: 8 \* 1024 \* 1024/u,
  );
});

test("semantic-memory source, build, and packaged dependency boundaries are exact", () => {
  const dashboardPackage = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "dashboard", "package.json"), "utf8"),
  );
  const dashboardLock = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "dashboard", "package-lock.json"), "utf8"),
  );
  const service = manifest.services.find(({ id }) => id === "mem0-semantic-engine");
  const development = service.launchProfiles.find(({ modes }) => modes.includes("lean"));
  const packaged = service.launchProfiles.find(({ modes }) => modes.includes("packaged"));
  assert.deepEqual(development.modes, ["lean", "hot"]);
  assert.deepEqual(packaged.modes, ["packaged"]);
  assert.ok(development.installProbe.files.some(({ path: value }) =>
    value === "dashboard/node_modules/mem0ai/dist/index.mjs"));
  assert.ok(packaged.installProbe.files.some(({ path: value }) =>
    value === "dashboard/node_modules/mem0ai/dist/oss/index.mjs"));
  assert.match(mem0Setup, /assertPinnedCleanCheckout/u);
  assert.match(mem0Setup, /pnpm@10\.5\.2/u);
  assert.match(mem0Setup, /--frozen-lockfile/u);
  assert.match(mem0Setup, /reviewed immutable build/u);
  assert.doesNotMatch(mem0Setup, /run\("npm"|run\("npx"|Semantic recall stays off/u);
  assert.equal(dashboardPackage.dependencies.axios, "1.18.1");
  assert.equal(dashboardLock.packages["node_modules/axios"].version, "1.18.1");

  const gbrainReceipt = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "gbrain", "runtime-artifact.json"), "utf8"),
  );
  const gbrainUpstreamPath = path.join(repoRoot, "gbrain", "UPSTREAM.json");
  const gbrainUpstreamBytes = fs.readFileSync(gbrainUpstreamPath);
  const gbrainUpstreamCanonical = Buffer.from(
    gbrainUpstreamBytes.toString("utf8").replace(/\r\n/gu, "\n"),
    "utf8",
  );
  const gbrainUpstream = JSON.parse(gbrainUpstreamCanonical.toString("utf8"));
  assert.equal(gbrainReceipt.schemaVersion, 1);
  assert.equal(gbrainReceipt.engine.package, "gbrain");
  assert.equal(gbrainReceipt.engine.sourceGitTree, "6789d243367aa1eeccceb0cdae187025a31008b5");
  assert.equal(gbrainUpstream.contentChecksums.gbrainSrcTreeSha, gbrainReceipt.engine.sourceGitTree);
  assert.deepEqual(
    gbrainUpstream.localPatches.map(({ id }) => id),
    ["breadboard-pglite-init-error-diagnostics"],
  );
  assert.equal(
    createHash("sha256").update(gbrainUpstreamCanonical).digest("hex").toUpperCase(),
    gbrainReceipt.engine.upstreamReceiptSha256,
  );
  assert.match(preparer, new RegExp(gbrainReceipt.engine.upstreamReceiptSha256, "u"));
  assert.match(verifier, new RegExp(gbrainReceipt.engine.upstreamReceiptSha256, "u"));
  for (const [relative, expected] of [
    ["gbrain-adapter/src", gbrainReceipt.adapter],
    ["gbrain/src", gbrainReceipt.engine],
  ]) {
    const actual = canonicalTreeIdentity(path.join(repoRoot, ...relative.split("/")));
    assert.equal(actual.fileCount, expected.sourceFileCount, relative);
    assert.equal(actual.sha256, expected.sourceSha256, relative);
    assert.match(preparer, new RegExp(expected.sourceGitTree, "u"));
    assert.match(verifier, new RegExp(expected.sourceGitTree, "u"));
    assert.match(preparer, new RegExp(expected.sourceSha256, "u"));
    assert.match(verifier, new RegExp(expected.sourceSha256, "u"));
  }
});

test("packaged GBrain launches only through the reviewed bundled-Node entrypoint closure", () => {
  const service = manifest.services.find(({ id }) => id === "gbrain");
  assert.ok(service);
  assert.equal(service.launchProfiles.length, 1);
  const profile = service.launchProfiles[0];
  assert.deepEqual(profile.modes, ["lean", "hot", "packaged"]);
  assert.equal(profile.executableAuthority, "runtime-root");
  assert.equal(profile.allowedExecutable, "runtimes/node/node.exe");
  assert.deepEqual(profile.arguments, [
    { kind: "literal", value: "--no-warnings" },
    { kind: "literal", value: "--experimental-transform-types" },
    { kind: "app-path", path: "gbrain-adapter/src/node-entrypoint.mjs" },
  ]);
  assert.deepEqual(profile.workingDirectory, {
    kind: "app-subdirectory",
    path: "gbrain-adapter",
  });
  assert.equal(service.readiness.path, "/ready");
  assert.equal(service.readiness.expectedBodyContains, '"backend":"gbrain"');
  assert.deepEqual(profile.installProbe.files, [
    { authority: "runtime-root", path: "runtimes/node/node.exe" },
    { authority: "app-root", path: "gbrain-adapter/src/node-entrypoint.mjs" },
    { authority: "app-root", path: "gbrain-adapter/src/node-loader.mjs" },
    { authority: "app-root", path: "gbrain-adapter/src/node-server.ts" },
    { authority: "app-root", path: "gbrain-adapter/src/request-handler.ts" },
    { authority: "app-root", path: "gbrain/src/core/engine-factory.ts" },
    {
      authority: "app-root",
      path: "gbrain-adapter/node_modules/@electric-sql/pglite/package.json",
    },
    {
      authority: "app-root",
      path: "gbrain/node_modules/@electric-sql/pglite/package.json",
    },
    { authority: "app-root", path: "gbrain/node_modules/js-yaml/package.json" },
    { authority: "app-root", path: "gbrain/node_modules/@dqbd/tiktoken/package.json" },
    { authority: "app-root", path: "gbrain/node_modules/web-tree-sitter/package.json" },
    { authority: "app-root", path: "gbrain/runtime-artifact.json" },
  ]);
  assert.doesNotMatch(JSON.stringify(profile), /runtimes\/bun\/bun\.exe|--experimental-loader/iu);
});

test("packaged SolidWorks uses only the immutable reviewed Python closure", () => {
  const service = manifest.services.find(({ id }) => id === "solidworks-mcp");
  const development = service.launchProfiles.find(({ modes }) => modes.includes("lean"));
  const packaged = service.launchProfiles.find(({ modes }) => modes.includes("packaged"));

  assert.deepEqual(development.modes, ["lean", "hot"]);
  assert.deepEqual(packaged.modes, ["packaged"]);
  assert.equal(packaged.allowedExecutable, "runtimes/node/node.exe");
  assert.ok(packaged.installProbe.files.some(({ authority, path: value }) =>
    authority === "runtime-root" && value === "runtimes/solidworks-python/python.exe"));
  assert.ok(packaged.installProbe.files.some(({ authority, path: value }) =>
    authority === "runtime-root" && value === "runtimes/solidworks-python/runtime-artifact.json"));
  assert.ok(packaged.installProbe.files.some(({ authority, path: value }) =>
    authority === "runtime-root" && value === "runtimes/solidworks-python/pylock.packaged.toml"));
  assert.ok(packaged.installProbe.files.some(({ authority, path: value }) =>
    authority === "app-root" && value === "SolidworksMCP-python/runtime-artifact.json"));
  assert.ok(packaged.installProbe.files.some(({ authority, path: value }) =>
    authority === "app-root" && value === "SolidworksMCP-python/pylock.packaged.toml"));
  assert.doesNotMatch(JSON.stringify(packaged), /data-root|data-path|uv\.exe|\.venv/iu);
  assert.match(preparer, /solidworks-mcp[\s\S]*lockFormat: "uv-project-export"/u);
  assert.match(preparer, /2555A0542E322BB6DF3000AD850155AB4B0A16731AD16806981669C1265D75C9/u);
  assert.match(preparer, /--frozen[\s\S]*--offline[\s\S]*--format[\s\S]*pylock\.toml/u);
  assert.match(verifier, /locally licensed Windows SolidWorks installation and COM automation/u);
});

test("packaged VLM OCR is offline and binds exact bundled native and model artifacts", () => {
  const artifactAuthority = fs.readFileSync(
    path.join(desktopRoot, "scripts", "vlm-ocr-runtime-artifact.mjs"),
    "utf8",
  );
  const service = manifest.services.find(({ id }) => id === "vlm-ocr");
  const development = service.launchProfiles.find(({ modes }) => modes.includes("lean"));
  const packaged = service.launchProfiles.find(({ modes }) => modes.includes("packaged"));
  assert.deepEqual(development.modes, ["lean", "hot"]);
  assert.deepEqual(packaged.modes, ["packaged"]);
  for (const expected of [
    "bin/vlm-ocr/runtime/llama-server.exe",
    "bin/vlm-ocr/runtime-artifact.json",
    "bin/vlm-ocr/models/HunyuanOCR-Q8_0.gguf",
    "bin/vlm-ocr/models/mmproj-HunyuanOCR-Q8_0.gguf",
  ]) {
    assert.ok(packaged.installProbe.files.some(({ authority, path: value }) =>
      authority === "runtime-root" && value === expected), expected);
  }
  assert.doesNotMatch(JSON.stringify(packaged), /data-root|data-path|huggingface|hf_repo/iu);
  assert.match(
    artifactAuthority,
    /export const PINNED_VLM_OCR_RUNTIME = Object\.freeze\(/u,
  );
  assert.match(
    preparer,
    /import \{ stagePinnedVlmOcrRuntime \} from "\.\/vlm-ocr-runtime-artifact\.mjs"/u,
  );
  assert.match(
    verifier,
    /import \{ PINNED_VLM_OCR_RUNTIME \} from "\.\/vlm-ocr-runtime-artifact\.mjs"/u,
  );
  assert.doesNotMatch(preparer, /const PINNED_VLM_OCR_RUNTIME/u);
  assert.doesNotMatch(verifier, /const PINNED_VLM_OCR_RUNTIME/u);
  assert.match(artifactAuthority, /D6F606412F2335BC4A2324750306E8B5B027E8327F183990B2DBE3671F7F9DBD/u);
  assert.match(artifactAuthority, /CDAFC794CAFEAE377868D7A40A70E282A737E39ABE77C0D8B73614447B364A21/u);
  assert.match(artifactAuthority, /B77913164FF73D4C0DC4D994E236ED72BACBBE5C5DB1EC9B2828627B46C32804/u);
  assert.match(artifactAuthority, /async function acquirePinnedArtifact/u);
  assert.match(artifactAuthority, /Readable\.fromWeb\(response\.body\)/u);
  assert.match(
    artifactAuthority,
    /if \(offline\) \{[\s\S]*requires a supplied immutable artifact in offline mode/u,
  );
  assert.match(
    artifactAuthority,
    /path\.join\(stagedTarget, "runtime-artifact\.json"\),\s*`\$\{JSON\.stringify\(PINNED_VLM_OCR_RUNTIME, null, 2\)\}\\n`,/u,
  );
  assert.match(
    preparer,
    /offline: process\.env\.BREADBOARD_OFFLINE_PACKAGE_ASSEMBLY === "1"/u,
  );
  assert.match(
    verifier,
    /requireExactJsonReceipt\(\s*path\.join\(vlmOcrRoot, "runtime-artifact\.json"\),\s*`\$\{label\} VLM OCR immutable runtime receipt`,\s*PINNED_VLM_OCR_RUNTIME,\s*\);/u,
  );
  assert.match(serviceEnvironment, /if mode == RuntimeMode::Packaged \{[\s\S]*VLM_OCR_SERVER_BINARY/u);
  assert.match(serviceEnvironment, /HunyuanOCR-Q8_0\.gguf/u);
  assert.match(serviceEnvironment, /mmproj-HunyuanOCR-Q8_0\.gguf/u);
  assert.match(verifier, /VLM OCR immutable runtime receipt/u);
});

test("packaged OCI stacks use reviewed linux-amd64 index and child-manifest digests", () => {
  const byId = new Map(manifest.services.map((service) => [service.id, service]));
  const cases = [
    ["postiz-coordinator", "postiz", "postiz-app", "docker-compose.yaml", 9],
    ["inbox-zero-stack", "inbox-zero", "inbox-zero", "docker-compose.yml", 6],
  ];
  for (const [serviceId, stack, directory, compose, expectedImages] of cases) {
    const receipt = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, "runtime-v2", "vendor", stack, "oci-images.json"), "utf8"),
    );
    assert.deepEqual(
      Object.keys(receipt),
      ["schemaVersion", "stack", "sourceCommit", "platform", "sourceFiles", "images"],
    );
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.stack, stack);
    assert.match(receipt.sourceCommit, /^[0-9a-f]{40}$/u);
    assert.equal(receipt.platform, "linux/amd64");
    assert.ok(receipt.sourceFiles.length >= 2);
    const vendorSource = path.join(desktopRoot, "runtime-v2", "vendor", stack, "source");
    for (const file of receipt.sourceFiles) {
      assert.deepEqual(Object.keys(file), ["path", "size", "sha256"]);
      const bytes = fs.readFileSync(path.join(vendorSource, ...file.path.split("/")));
      const canonical = bytes.includes(0)
        ? bytes
        : Buffer.from(bytes.toString("utf8").replace(/\r\n/gu, "\n"), "utf8");
      assert.equal(canonical.length, file.size);
      assert.equal(
        createHash("sha256").update(canonical).digest("hex").toUpperCase(),
        file.sha256,
      );
    }
    assert.equal(receipt.images.length, expectedImages);
    assert.equal(new Set(receipt.images.map(({ service }) => service)).size, expectedImages);
    for (const image of receipt.images) {
      assert.deepEqual(
        Object.keys(image),
        ["service", "sourceReference", "immutableReference", "indexDigest", "linuxAmd64Manifest"],
      );
      assert.match(image.indexDigest, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(image.immutableReference.endsWith(`@${image.indexDigest}`), true);
      assert.match(image.linuxAmd64Manifest.digest, /^sha256:[0-9a-f]{64}$/u);
      assert.ok(Number.isSafeInteger(image.linuxAmd64Manifest.size));
      assert.ok(image.linuxAmd64Manifest.size > 0);
    }

    const profiles = byId.get(serviceId).launchProfiles;
    assert.deepEqual(profiles.find(({ modes }) => modes.includes("lean")).modes, ["lean", "hot"]);
    const packaged = profiles.find(({ modes }) => modes.includes("packaged"));
    assert.deepEqual(packaged.modes, ["packaged"]);
    assert.ok(packaged.installProbe.files.some(({ authority, path: value }) =>
      authority === "app-root" && value === `${directory}/${compose}`));
    assert.ok(packaged.installProbe.files.some(({ authority, path: value }) =>
      authority === "app-root" && value === `${directory}/oci-images.json`));
    assert.ok(packaged.installProbe.files.some(({ authority, path: value }) =>
      authority === "app-root" && value === `${directory}/BREADBOARD_UPSTREAM_COMMIT`));
  }
  assert.match(preparer, /function pinComposeImages/u);
  assert.match(preparer, /function assertReviewedOciSource/u);
  assert.doesNotMatch(preparer, /Postiz checkout must be clean|Inbox Zero checkout must be clean/u);
  assert.match(preparer, /image: \$\{row\.immutableReference\}/u);
  assert.match(preparer, /platform: \$\{reviewed\.receipt\.platform\}/u);
  assert.match(verifier, /function checkPinnedOciCompose/u);
  assert.match(verifier, /Compose service \$\{serviceName\} is not digest\/platform pinned/u);
});

test("only genuinely unresolved packaged prerequisites remain release blockers", () => {
  const rows = closureRows();
  assert.doesNotMatch(rows.get("comfyui"), /releaseBlocker/u);
  assert.match(rows.get("comfyui"), /dataRoot: "writable-state"[\s\S]*comfyui-python\/runtime-artifact\.json/u);
  assert.doesNotMatch(rows.get("wardrobe"), /releaseBlocker/u);
  assert.match(rows.get("wardrobe"), /dataRoot: "writable-state"[\s\S]*wardrobe-runtime\/runtime-artifact\.json/u);
  assert.doesNotMatch(rows.get("mem0-semantic-engine"), /releaseBlocker/u);
  assert.match(
    rows.get("mem0-semantic-engine"),
    /dataRoot: "writable-state"[\s\S]*mem0ai\/runtime-artifact\.json/u,
  );
  assert.doesNotMatch(rows.get("vlm-ocr"), /releaseBlocker|externalBoundary/u);
  assert.match(rows.get("vlm-ocr"), /bin\/vlm-ocr\/runtime-artifact\.json/u);
  assert.doesNotMatch(rows.get("postiz-coordinator"), /releaseBlocker/u);
  assert.match(rows.get("postiz-coordinator"), /postiz-app\/oci-images\.json/u);
  assert.doesNotMatch(rows.get("inbox-zero-stack"), /releaseBlocker/u);
  assert.match(rows.get("inbox-zero-stack"), /inbox-zero\/oci-images\.json/u);
  assert.doesNotMatch(rows.get("solidworks-mcp"), /releaseBlocker/u);
  assert.match(rows.get("solidworks-mcp"), /solidworks-python\/runtime-artifact\.json/u);
  assert.doesNotMatch(rows.get("openwork"), /releaseBlocker/u);
  assert.match(rows.get("openwork"), /dataRoot: "none"[\s\S]*openwork-runtime\/runtime-artifact\.json/u);
  for (const id of [
    "local-mcp-broker",
    "postiz-coordinator",
    "inbox-zero-stack",
    "spotify-playback",
    "solidworks-mcp",
    "colpali",
    "humanizer",
    "voicebox",
  ]) {
    assert.match(rows.get(id), /externalBoundary: \[/u, `${id} must declare its external boundary`);
  }
});
