import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const vendorRoot = path.join(desktopRoot, "runtime-v2", "vendor", "comfyui");
const lockPath = path.join(vendorRoot, "pylock.packaged.toml");
const constraintsPath = path.join(vendorRoot, "constraints.packaged.txt");
const lockHash = "E3D62AAE9F162C85F5CE6AED996C2A3C6EE253099F796873EC02EE306D696788";
const approvedHosts = new Set(["files.pythonhosted.org", "download-r2.pytorch.org"]);

function canonicalText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/gu, "\n");
}

function canonicalSha256(filePath) {
  return createHash("sha256").update(canonicalText(filePath), "utf8").digest("hex").toUpperCase();
}

function packageRows(source) {
  const rows = new Map();
  const blocks = source.split(/(?=^\[\[packages\]\]$)/gmu).filter((block) =>
    block.startsWith("[[packages]]"),
  );
  for (const block of blocks) {
    const name = block.match(/^name = "([^"]+)"$/mu)?.[1];
    const version = block.match(/^version = "([^"]+)"$/mu)?.[1];
    assert.ok(name && version, "every ComfyUI lock package must have a name and version");
    assert.equal(rows.has(name), false, `duplicate ComfyUI lock package ${name}`);
    rows.set(name, { version, block });
  }
  return rows;
}

test("ComfyUI's Windows CPU lock is an exact wheel-only closure", () => {
  const source = canonicalText(lockPath);
  assert.equal(canonicalSha256(lockPath), lockHash);
  assert.match(
    source,
    /^lock-version = "1\.0"\ncreated-by = "uv"\nrequires-python = ">=3\.12\.10"\n/u,
  );
  assert.doesNotMatch(source, /(?:^|\n)sdist = /u);

  const rows = packageRows(source);
  assert.equal(rows.size, 85);
  let wheelCount = 0;
  for (const [name, { block }] of rows) {
    const urls = [...block.matchAll(/url = "([^"]+)"/gu)].map((match) => match[1]);
    const hashes = [...block.matchAll(/sha256 = "([0-9a-f]+)"/gu)].map((match) => match[1]);
    assert.ok(urls.length > 0, `${name} must have a wheel`);
    assert.equal(hashes.length, urls.length, `${name} must bind every wheel hash`);
    for (const [index, value] of urls.entries()) {
      const artifact = new URL(value);
      assert.equal(artifact.protocol, "https:", `${name} wheel must use HTTPS`);
      assert.ok(approvedHosts.has(artifact.hostname), `${name} wheel host must be reviewed`);
      assert.ok(artifact.pathname.toLowerCase().endsWith(".whl"), `${name} must be wheel-only`);
      assert.match(hashes[index], /^[0-9a-f]{64}$/u, `${name} wheel must have SHA-256`);
    }
    wheelCount += urls.length;
  }
  assert.equal(wheelCount, 94);
  for (const [name, version] of Object.entries({
    "comfy-aimdo": "0.4.13",
    "comfy-kitchen": "0.2.26",
    "comfyui-frontend-package": "1.48.6",
    "comfyui-workflow-templates": "0.11.31",
    torch: "2.11.0+cpu",
    torchaudio: "2.11.0+cpu",
    torchvision: "0.26.0+cpu",
  })) {
    assert.equal(rows.get(name)?.version, version, `${name} version must remain coherent`);
  }
});

test("ComfyUI's resolver inputs bind the pinned upstream checkout", () => {
  assert.equal(
    canonicalText(constraintsPath),
    [
      "# Breadboard's universal Windows x64 CPU policy for ComfyUI.",
      "# Keep the PyTorch family on one compatible release line.",
      "torch==2.11.0",
      "torchvision==0.26.0",
      "torchaudio==2.11.0",
      "",
    ].join("\n"),
  );
  assert.equal(
    canonicalSha256(constraintsPath),
    "49858A870C6241099BB64C4D7844508948C88D38B1E32E7804003A34BC1E8924",
  );
  assert.equal(
    canonicalSha256(path.join(repoRoot, "comfyui", "requirements.txt")),
    "BDCFEC87BEAE821F2374C4A4CE36237E6BCEA08DDA7CF86881D49816E85BCA64",
  );
  assert.equal(
    canonicalSha256(path.join(repoRoot, "comfyui", "pyproject.toml")),
    "B4B313450FDD6F2B5D83772D64ECE440E66A0CCB7793B33A45C01E9F4E171735",
  );
});

test("preparation and verification share the exact ComfyUI receipt authority", () => {
  const scripts = [
    "prepare-runtimes.mjs",
    "prepare-app-resources.mjs",
    "verify-package.mjs",
  ].map((name) => canonicalText(path.join(desktopRoot, "scripts", name)));
  for (const source of scripts) {
    assert.match(source, /const PINNED_COMFYUI_RUNTIME/u);
    assert.ok(source.includes(lockHash));
    assert.ok(source.includes('runtimeDirectory: "comfyui-python"'));
    assert.ok(source.includes('policy: "cpu"'));
  }
  assert.match(scripts[0], /requireComfyUiRuntimeSources/u);
  assert.match(scripts[0], /COMFYUI_PACKAGED_SERVICE/u);
  assert.match(scripts[0], /comfy\.options\.enable_args_parsing\(\)/u);
  assert.ok(scripts[0].includes("['comfyui-smoke','--cpu']"));
  assert.match(scripts[1], /constraints\.packaged\.txt/u);
  assert.match(scripts[1], /pylock\.packaged\.toml/u);
  assert.match(scripts[2], /checkComfyUiPackagedRuntime/u);
  assert.match(scripts[2], /relativePath === "Include"/u);
  assert.match(scripts[2], /without loading\n  \/\/ Torch/u);
});
