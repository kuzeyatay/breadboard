import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GENOFFICE_PACKAGES = Object.freeze([
  "docx-engine",
  "pptx-engine",
  "pptx-render",
  "font-metrics",
  "pdf2docx",
]);

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const upstreamRoot = path.join(repoRoot, "genoffice");
const vendorRoot = path.join(dashboardRoot, "src", "vendor", "genoffice");
const commitFile = path.join(upstreamRoot, "BREADBOARD_UPSTREAM_COMMIT");

async function readUpstreamCommit() {
  let commit;
  try {
    commit = (await readFile(commitFile, "utf8")).trim();
  } catch (error) {
    throw new Error(`GenOffice pin is missing: ${commitFile}`, { cause: error });
  }
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(`GenOffice pin is invalid: ${commitFile}`);
  }
  return commit;
}

async function relativeFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await relativeFiles(root, absolute)));
    else if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll("\\", "/"));
    else throw new Error(`Unsupported GenOffice vendor entry: ${absolute}`);
  }
  return files.sort();
}

export async function syncGenOffice() {
  const commit = await readUpstreamCommit();
  await mkdir(vendorRoot, { recursive: true });
  for (const packageName of GENOFFICE_PACKAGES) {
    const source = path.join(upstreamRoot, "packages", packageName, "src");
    const destination = path.join(vendorRoot, packageName, "src");
    if (!(await stat(source)).isDirectory()) throw new Error(`GenOffice source is missing: ${source}`);
    await rm(destination, { recursive: true, force: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, force: true, preserveTimestamps: false });
  }
  return commit;
}

export async function assertGenOfficeVendorDrift() {
  const commit = await readUpstreamCommit();
  const expectedPackageDirs = [...GENOFFICE_PACKAGES].sort();
  const actualPackageDirs = (await readdir(vendorRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(actualPackageDirs) !== JSON.stringify(expectedPackageDirs)) {
    throw new Error(
      `GenOffice vendor package set drifted at ${commit}: expected ${expectedPackageDirs.join(", ")}; got ${actualPackageDirs.join(", ")}`,
    );
  }

  for (const packageName of GENOFFICE_PACKAGES) {
    const source = path.join(upstreamRoot, "packages", packageName, "src");
    const destination = path.join(vendorRoot, packageName, "src");
    const sourceFiles = await relativeFiles(source);
    const destinationFiles = await relativeFiles(destination);
    if (JSON.stringify(sourceFiles) !== JSON.stringify(destinationFiles)) {
      throw new Error(`GenOffice file list drifted for ${packageName} at ${commit}`);
    }
    for (const relativePath of sourceFiles) {
      const [upstream, vendored] = await Promise.all([
        readFile(path.join(source, relativePath)),
        readFile(path.join(destination, relativePath)),
      ]);
      if (!upstream.equals(vendored)) {
        throw new Error(`GenOffice bytes drifted for ${packageName}/src/${relativePath} at ${commit}`);
      }
    }
  }
  return commit;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commit = await syncGenOffice();
  await assertGenOfficeVendorDrift();
  console.log(`Synced GenOffice ${commit}`);
}
