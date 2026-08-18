import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dashboardRoot = process.cwd();
const repoRoot = path.resolve(dashboardRoot, "..");
const load = (rel) => import(pathToFileURL(path.join(dashboardRoot, rel)).href);

const { listApprovedSkills, listInstalledLocalSkills } = await load("src/lib/hermes/skills.ts");

for (const slug of ["bullshit-detector", "premortem"]) {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const s = listApprovedSkills(surface).find((c) => c.slug === slug);
    console.log(`[${slug}][${surface}]`, s ? JSON.stringify({
      availability: s.availability, enabled: s.enabled, healthy: s.healthy,
      keys: Object.keys(s),
      requiredTools: s.capabilityContract?.requiredTools ?? null,
    }) : "ABSENT");
    console.log(`  installedLocal: ${listInstalledLocalSkills(surface).some((c) => c.slug === slug)}`);
  }
  const skillPath = path.join(repoRoot, ".agents/skills", slug, "SKILL.md");
  const exists = fs.existsSync(skillPath);
  console.log(`  shipped SKILL.md exists: ${exists} (${skillPath})`);
  const registryPath = path.join(repoRoot, ".agents/skills/registry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const entry = registry.skills?.[slug];
  console.log(`  registry entry present: ${Boolean(entry)}`);
  if (exists && entry) {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(skillPath)).digest("hex");
    console.log(`  fileHash=${hash.slice(0,16)} localHash=${(entry.localHash??"none").slice(0,16)} match=${entry.localHash===hash}`);
    console.log(`  fileHashes[SKILL.md]=${(entry.fileHashes?.["SKILL.md"]??"none").slice(0,16)} match=${entry.fileHashes?.["SKILL.md"]===hash}`);
    console.log(`  reviewState=${entry.reviewState} classification=${entry.classification?.classification}`);
  }
}
