import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dashboardRoot = process.cwd();
const repoRoot = path.resolve(dashboardRoot, "..");
const { buildSkill } = await import(
  pathToFileURL(path.join(repoRoot, "scripts/build-bullshit-detector-skill.mjs")).href
);

const shippedPath = path.join(repoRoot, ".agents/skills/bullshit-detector/SKILL.md");
const clonePath = path.join(repoRoot, "bullshit-detector/skills/analysis/bullshit-detector/SKILL.md");
const shipped = fs.readFileSync(shippedPath, "utf8");
const clone = fs.readFileSync(clonePath, "utf8");
const built = buildSkill(clone);

const lf = (s) => s.replace(/\r\n/g, "\n");
const sha = (s) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex").slice(0, 16);

console.log("shipped bytes", shipped.length, "CRLF:", shipped.includes("\r\n"));
console.log("clone   bytes", clone.length, "CRLF:", clone.includes("\r\n"));
console.log("built   bytes", built.length, "CRLF:", built.includes("\r\n"));
console.log("shipped === built            :", shipped === built);
console.log("LF(shipped) === LF(built)    :", lf(shipped) === lf(built));
console.log("sha shipped/built (LF-normal):", sha(lf(shipped)), sha(lf(built)));

if (lf(shipped) !== lf(built)) {
  const a = lf(shipped).split("\n");
  const b = lf(built).split("\n");
  let shown = 0;
  for (let i = 0; i < Math.max(a.length, b.length) && shown < 6; i += 1) {
    if (a[i] !== b[i]) {
      console.log(`  line ${i + 1}:`);
      console.log(`    shipped: ${JSON.stringify((a[i] ?? "").slice(0, 110))}`);
      console.log(`    built  : ${JSON.stringify((b[i] ?? "").slice(0, 110))}`);
      shown += 1;
    }
  }
  console.log(`  differing line count: shipped ${a.length} / built ${b.length}`);
}

// Does the registry pin match the build script's *raw* (mixed line-ending) output?
const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, ".agents/skills/registry.json"), "utf8"));
const pin = registry.skills["bullshit-detector"].localHash;
const full = (s) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const crlf = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
console.log("\nregistry pin                  :", pin.slice(0, 16));
console.log("sha(built, as script emits)   :", full(built).slice(0, 16), full(built) === pin ? "== PIN" : "");
console.log("sha(built, LF)                :", full(lf(built)).slice(0, 16), full(lf(built)) === pin ? "== PIN" : "");
console.log("sha(built, CRLF)              :", full(crlf(built)).slice(0, 16), full(crlf(built)) === pin ? "== PIN" : "");
console.log("sha(shipped, as on disk)      :", full(shipped).slice(0, 16), full(shipped) === pin ? "== PIN" : "");
