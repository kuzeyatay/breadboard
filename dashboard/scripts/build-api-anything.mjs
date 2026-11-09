import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createHash } from "node:crypto";

export const API_ANYTHING_UPSTREAM_COMMIT = "985ae8f65f4c4918f24080bd7dbaf51fe92e6bf6";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function buildApiAnything(repoRoot = root) {
  const upstream = path.join(repoRoot, "api-anything");
  const output = path.join(upstream, "breadboard", "host.mjs");
  const receipt = path.join(upstream, "breadboard", "runtime.json");
  const notices = path.join(upstream, "breadboard", "THIRD_PARTY_NOTICES.txt");
  const inputs = fs.readdirSync(path.join(upstream, "src")).filter(name => name.endsWith(".ts")).sort();
  const hash = createHash("sha256");
  const sourceText = file => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  for (const name of inputs) hash.update(name).update(sourceText(path.join(upstream, "src", name)));
  hash.update(sourceText(path.join(upstream, "package-lock.json")));
  hash.update(sourceText(fileURLToPath(import.meta.url)));
  const sourceSha256 = hash.digest("hex");
  const digest = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  try {
    const cached = JSON.parse(fs.readFileSync(receipt, "utf8"));
    if (cached.sourceSha256 === sourceSha256 && cached.bundleSha256 === digest(output) && cached.noticesSha256 === digest(notices)) return output;
  } catch { /* First build or a stale bundle. */ }
  const result = await build({ entryPoints: [path.join(upstream, "src", "host.ts")], outfile: output,
    bundle: true, platform: "node", format: "esm", target: "node22", legalComments: "eof",
    metafile: true,
    external: ["playwright-core"],
    banner: { js: 'import { createRequire as __breadboardCreateRequire } from "node:module"; const require = __breadboardCreateRequire(import.meta.url);' },
  });
  const packages = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const absolute = path.resolve(input).replace(/\\/g, "/");
    const index = absolute.lastIndexOf("/node_modules/");
    if (index < 0) continue;
    const segments = absolute.slice(index + 14).split("/");
    packages.add(absolute.slice(0, index + 14) + segments.slice(0, segments[0].startsWith("@") ? 2 : 1).join("/"));
  }
  const attribution = ["API Anything embedded runtime — bundled third-party software\n",
    "API Anything itself is MIT licensed; see ../LICENSE.\n"];
  for (const directory of [...packages].sort()) {
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    attribution.push(`\n${"=".repeat(72)}\n${pkg.name}@${pkg.version} (${pkg.license ?? "see license below"})\n`);
    const licenses = fs.readdirSync(directory).filter(name => /^(licen[sc]e|copying|notice)/i.test(name) && fs.statSync(path.join(directory, name)).isFile());
    if (!licenses.length) throw new Error(`Missing bundled dependency license: ${pkg.name}`);
    for (const license of licenses) attribution.push(`${license}\n${sourceText(path.join(directory, license))}\n`);
  }
  fs.writeFileSync(notices, attribution.join("\n"));
  fs.writeFileSync(receipt, JSON.stringify({
    name: "api-anything", version: JSON.parse(fs.readFileSync(path.join(upstream, "package.json"), "utf8")).version,
    upstream: "https://github.com/goodnight000/api-anything", commit: API_ANYTHING_UPSTREAM_COMMIT,
    entrypoint: "host.mjs", maxTier: 1, browserFallback: "breadboard", sharing: false,
    sourceSha256, bundleSha256: digest(output), noticesSha256: digest(notices),
  }, null, 2) + "\n");
  return output;
}

export async function stageApiAnything(stagingRoot, repoRoot = root) {
  await buildApiAnything(repoRoot);
  const source = path.join(repoRoot, "api-anything");
  const target = path.join(stagingRoot, "api-anything");
  fs.mkdirSync(target, { recursive: true });
  for (const name of ["breadboard", "sites"]) fs.cpSync(path.join(source, name), path.join(target, name), { recursive: true });
  fs.copyFileSync(path.join(source, "LICENSE"), path.join(target, "LICENSE"));
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Built embedded website APIs: ${await buildApiAnything()}`);
}
