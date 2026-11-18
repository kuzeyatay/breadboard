#!/usr/bin/env node
// Runs `npm audit --omit=dev` for one package and fails on any high or critical
// advisory, except advisories listed in <package>/audit-allowlist.json with a
// reason and an expiry date. An expired entry fails again, so an accepted risk
// is looked at again instead of being forgotten.
//
//   node scripts/npm-audit-gate.mjs quartz
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: node scripts/npm-audit-gate.mjs <package dir>"); process.exit(2); }
const allowFile = path.join(dir, "audit-allowlist.json");
const allow = fs.existsSync(allowFile) ? JSON.parse(fs.readFileSync(allowFile, "utf8")) : {};

let report;
try {
  report = execFileSync("npm", ["audit", "--prefix", dir, "--omit=dev", "--json"], { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 << 20 });
} catch (error) {
  // npm audit exits non-zero whenever it finds something; the JSON is still on stdout.
  report = error.stdout;
}
const vulnerabilities = JSON.parse(report).vulnerabilities ?? {};

// The advisories themselves; packages that are only vulnerable through a dependency name it by package.
const advisories = new Map();
for (const entry of Object.values(vulnerabilities))
  for (const via of entry.via) if (typeof via === "object" && ["high", "critical"].includes(via.severity))
    advisories.set(via.url.split("/").pop(), { title: via.title, package: entry.name, url: via.url });

const today = new Date().toISOString().slice(0, 10);
const failures = [];
for (const [id, advisory] of advisories) {
  const accepted = allow[id];
  if (accepted && accepted.until >= today) console.log(`accepted until ${accepted.until}: ${id} ${advisory.package} (${accepted.reason})`);
  else failures.push(`${id} ${advisory.package}: ${advisory.title} ${advisory.url}${accepted ? ` (accepted until ${accepted.until}, expired)` : ""}`);
}
if (failures.length) { console.error(`High or critical advisories in ${dir}:\n${failures.join("\n")}`); process.exit(1); }
console.log(`No unaccepted high or critical advisories in ${dir}.`);
