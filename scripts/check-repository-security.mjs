#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Reviewed upstream build flags, local-only development defaults, and
// publishable client keys. New environment files require explicit review.
const publicEnvFiles = new Set([
  "openwork/.env.dev",
  "openwork/apps/app/.env.migration-release",
  "stirling-pdf/app/.env.proprietary",
  "stirling-pdf/app/.env.saas",
  "stirling-pdf/engine/.env",
  "stirling-pdf/frontend/editor/.env",
  "stirling-pdf/frontend/editor/.env.desktop",
  "stirling-pdf/frontend/editor/.env.proprietary",
  "stirling-pdf/frontend/editor/.env.saas",
]);

export function unsafeTrackedPath(file) {
  const p = file.replaceAll("\\", "/");
  if (/^(?:audits|dashboard\/(?:db|database|undefined|postiz|openwork-state|openscience-state|runtime|runtime-v2|\.runtime)|gbrain\/pglite|cliproxy|recall|database|quartz\/(?:content|public))\//.test(p)) return true;
  if (p === "qa/answer-quality/candidates.json") return true;
  if (/(?:^|\/)(?:node_modules|\.next(?:-[^/]+)?)\//.test(p)) return true;
  if (/(?:^|\/)(?:api-key|management-key|cliproxy\.key|settings\.local\.json)$/.test(p)) return true;
  const name = p.split("/").at(-1);
  return /^\.env(?:\.|$)/.test(name) && !name.endsWith(".example") && !publicEnvFiles.has(p);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr?.trim() || result.error?.message}`);
  return result.stdout.trimEnd();
}

export function main(args = process.argv.slice(2)) {
  // Always inspect the whole index: an ignored file can still be tracked.
  const headIndex = args.indexOf("--head");
  const head = headIndex >= 0 ? args[headIndex + 1] : "HEAD";
  if (headIndex >= 0 && !/^[a-f0-9]{40}$/.test(head ?? "")) throw new Error("A full head commit SHA is required.");
  const files = headIndex >= 0 ? git(["ls-tree", "-r", "-z", "--name-only", head]) : git(["ls-files", "-z"]);
  const blocked = files.split("\0").filter(Boolean).filter(unsafeTrackedPath);
  if (blocked.length) {
    console.error("Private runtime files or generated builds are tracked:\n" + blocked.join("\n"));
    return 1;
  }
  if (args.includes("--paths-only")) {
    console.log("Tracked-file security policy passed.");
    return 0;
  }
  const scanArgs = ["git", root, "--redact=100", "--no-banner", "--no-color", "--ignore-gitleaks-allow"];
  if (args.includes("--staged")) {
    scanArgs.push("--staged");
  } else {
    const baseIndex = args.indexOf("--base");
    const base = baseIndex >= 0 ? args[baseIndex + 1] : git(["rev-parse", "HEAD^"]);
    if (!/^[a-f0-9]{40}$/.test(base ?? "")) throw new Error("A full base commit SHA is required.");
    const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", base, head], { cwd: root });
    if (ancestor.status !== 0) throw new Error("Security scan base is unavailable or is not an ancestor of HEAD.");
    const historicalPaths = git(["log", "--format=", "--name-only", "--diff-filter=AM", "--no-renames", `${base}..${head}`]);
    const historicalBlocked = [...new Set(historicalPaths.split(/\r?\n/).filter(Boolean).filter(unsafeTrackedPath))];
    if (historicalBlocked.length) {
      console.error("New history contains private runtime files or generated builds:\n" + historicalBlocked.join("\n"));
      return 1;
    }
    scanArgs.push(`--log-opts=${base}..${head} --no-renames --no-textconv --no-ext-diff`);
  }
  const scan = spawnSync(process.env.GITLEAKS_BIN || "gitleaks", scanArgs, { cwd: root, stdio: "inherit" });
  if (scan.error) {
    console.error("Gitleaks is required. Install it or set GITLEAKS_BIN to the verified executable.");
    return 1;
  }
  return scan.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
