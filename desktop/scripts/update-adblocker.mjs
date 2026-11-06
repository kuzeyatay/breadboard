// Explicit release maintenance only; browser startup/builds never fetch lists.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const revision = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(revision ?? "")) throw new Error("Usage: node scripts/update-adblocker.mjs <ghostery/adblocker commit SHA>");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/adblocker");
const names = ["badware", "filters", "filters-2020", "filters-2021", "filters-2022", "filters-2023", "filters-2024", "filters-2025", "filters-2026", "quick-fixes", "resource-abuse", "unbreak", "privacy"];
const files = [
  ...names.map(name => [`ublock-${name}.txt`, `ublock-origin/${name}.txt`]),
  ["resources.json", "ublock-origin/resources.json"],
];
const downloaded = await Promise.all(files.map(async ([file, source]) => {
  const url = `https://raw.githubusercontent.com/ghostery/adblocker/${revision}/packages/adblocker/assets/${source}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (file === "resources.json") {
    const parsed = JSON.parse(data.toString("utf8"));
    if (!Array.isArray(parsed.scriptlets) || !Array.isArray(parsed.redirects)) throw new Error("Invalid scriptlet resources");
  } else if (!data.toString("utf8").includes("!")) throw new Error(`Invalid filter list: ${file}`);
  return { file, source: url, data, sha256: createHash("sha256").update(data).digest("hex") };
}));
// Do not touch existing assets until every download has been validated.
for (const { file, data } of downloaded) await fs.writeFile(path.join(root, file), data);
await fs.writeFile(path.join(root, "upstream.json"), JSON.stringify({ revision, files: downloaded.map(({ data, ...entry }) => entry) }, null, 2) + "\n");
console.log(`Updated ${downloaded.length} pinned assets. Rebuild and run the ad blocker tests before shipping.`);
