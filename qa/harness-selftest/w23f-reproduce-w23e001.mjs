#!/usr/bin/env node

/**
 * W2-3F / A2 — reproduce W23E-001 before anything is mutated.
 *
 * A repair that starts before the defect is captured has nothing to be
 * compared against afterwards, so this records the whole rejection: the
 * registry pin, the raw hash, the canonical hash the repair will use, the
 * enabled/healthy verdict each surface sees, and whether an explicit slash
 * invocation is refused.
 *
 * Run from `dashboard/` with --experimental-strip-types.
 * Optional second argument: a label to record with the observation.
 */

import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const outPath = path.resolve(process.argv[2] ?? "w23e001-reproduction.json");
const phase = process.argv[3] ?? "before-repair";
const dashboardRoot = process.cwd();
const repoRoot = path.resolve(dashboardRoot, "..");
const load = (relative) => import(pathToFileURL(path.join(dashboardRoot, relative)).href);

const { listApprovedSkills, listInstalledLocalSkills } = await load("src/lib/hermes/skills.ts");
const { skillAvailableForContext, resolveCommandMessage } = await load("src/lib/hermes/commands.ts");

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const utf8 = (text) => Buffer.from(text, "utf8");

/** The canonicalisation the approved contract defines, computed independently here. */
function canonicalDigest(bytes) {
  const text = bytes.toString("utf8");
  if (!utf8(text).equals(bytes)) return null;
  return sha(utf8(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")));
}

const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, ".agents/skills/registry.json"), "utf8"));
const SLUGS = Object.keys(registry.skills);

const skills = SLUGS.map((slug) => {
  const entry = registry.skills[slug];
  const files = (entry.files ?? []).map((file) => {
    const absolute = path.join(repoRoot, ".agents/skills", slug, file);
    const present = fs.existsSync(absolute);
    const bytes = present ? fs.readFileSync(absolute) : null;
    const pin = entry.fileHashes ? entry.fileHashes[file] : null;
    return {
      file,
      present,
      bytes: bytes ? bytes.length : null,
      hasCrlf: bytes ? bytes.includes(0x0d) : null,
      pin,
      pinScheme: typeof pin === "string" && pin.includes(":") ? pin.split(":")[0] : "bare-hex (raw sha256)",
      rawSha256: bytes ? sha(bytes) : null,
      rawMatchesPin: bytes ? sha(bytes) === pin : null,
      canonicalSha256: bytes ? canonicalDigest(bytes) : null,
      canonicalMatchesPin: bytes ? canonicalDigest(bytes) === pin : null,
    };
  });

  const surfaces = {};
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    const summary = listApprovedSkills(surface).find((candidate) => candidate.slug === slug);
    surfaces[surface] = summary
      ? {
          listed: true,
          availability: summary.availability,
          enabled: summary.enabled,
          healthy: summary.healthy,
          dispatchAllowed: skillAvailableForContext(summary, { surface, mode: "knowledge" }),
          requiredTools: summary.capabilityContract?.requiredTools ?? null,
        }
      : { listed: false };
    if (surface !== "quartz_ai") {
      surfaces[surface].shownAsInstalledInCatalog = listInstalledLocalSkills(surface).some(
        (candidate) => candidate.slug === slug,
      );
    }
  }

  return {
    slug,
    reviewState: entry.reviewState ?? null,
    classification: entry.classification?.classification ?? null,
    files,
    rejectionReason: files.every((file) => file.rawMatchesPin)
      ? null
      : "integrityVerified is false because at least one pinned file does not match its raw-byte pin",
    surfaces,
  };
});

/** The user-facing half: does an explicit ask actually run? */
const invocations = [];
for (const [slug, text] of [
  ["premortem", "/premortem Run a premortem for our September launch"],
  ["bullshit-detector", "/bullshit-detector https://example.com/post"],
]) {
  try {
    const resolved = await resolveCommandMessage(1, text, process.cwd(), {
      mode: "knowledge",
      surface: "dashboard_terminal",
    });
    invocations.push({
      slug,
      accepted: true,
      invocations: resolved.invocations.map((invocation) => invocation.slug),
      guidanceAttached: new RegExp("Reviewed skill guidance: " + slug).test(resolved.text),
    });
  } catch (error) {
    invocations.push({
      slug,
      accepted: false,
      refusal: error instanceof Error ? error.message : String(error),
    });
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  phase,
  findingId: "W23E-001",
  verifier: "dashboard/src/lib/hermes/skills.ts :: listApprovedSkillsAtRoot",
  gate: "dashboard/src/lib/hermes/commands.ts :: skillAvailableForContext",
  registryPath: ".agents/skills/registry.json",
  pinnedSkillCount: SLUGS.length,
  skills,
  invocations,
  reproduced: skills.some((skill) =>
    Object.entries(skill.surfaces).some(
      ([surface, state]) => surface !== "quartz_ai" && state.listed && state.enabled === false,
    ),
  ),
  quartzExposure: skills.filter((skill) => skill.surfaces.quartz_ai.listed).map((skill) => skill.slug),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

for (const skill of skills) {
  const terminal = skill.surfaces.dashboard_terminal;
  console.log(
    skill.slug.padEnd(24) +
      " enabled=" + String(terminal.enabled).padEnd(5) +
      " healthy=" + String(terminal.healthy).padEnd(5) +
      " availability=" + String(terminal.availability).padEnd(6) +
      " dispatch=" + String(terminal.dispatchAllowed),
  );
  for (const file of skill.files) {
    console.log(
      "    " + file.file + "  raw=" + String(file.rawMatchesPin).padEnd(5) +
        " canonical=" + String(file.canonicalMatchesPin).padEnd(5) +
        " scheme=" + file.pinScheme,
    );
  }
}
for (const invocation of invocations) {
  console.log("  /" + invocation.slug + " accepted=" + invocation.accepted + (invocation.refusal ? " -> " + invocation.refusal : ""));
}
console.log("quartz_ai exposure: " + JSON.stringify(summary.quartzExposure));
console.log("reproduced: " + summary.reproduced);
