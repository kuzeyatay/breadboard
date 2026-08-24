// Stages the read-only application resources bundled into the installer under
// build-resources/app-services/. Run AFTER the dashboard standalone build:
//
//   cd dashboard && BREADBOARD_DESKTOP_BUILD=1 BREADBOARD_NEXT_DIST_DIR=.next-desktop npx next build
//
// Layout produced (mirrors the repo for the services' repo-root assumptions):
//   app-services/
//     dashboard-standalone/       <- .next-desktop/standalone (server.js tree)
//     dashboard/                  <- marker + Postiz supervisor module closure
//     scripts/                    <- desktop service launchers
//     postiz-app/                 <- optional Postiz Compose definition
//     nango/                      <- provider catalog metadata and logos only
//     chatmock/                   <- ChatMock source (no docker/tests)
//     hermes-config/              <- Breadboard system prompts (read-only)
//     hermes-skills/              <- reviewed first-party skills (read-only)
//     agency-agents/              <- bundled specialist persona catalog (read-only)
//     scientific-agent-skills/    <- pinned K-Dense scientific skills (read-only)
//     auto-claude-code-research-in-sleep/ <- ARIS guide + research skills (read-only)
//     openGym/                 <- exercise catalogue + upstream notices (read-only)
//     quartz-template/            <- Quartz program files (no content/public)
//     scriberr/                   <- docker-compose only (optional Docker mode)
//     shared/                     <- static shared assets

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const stagingRoot = path.join(desktopRoot, "build-resources", "app-services");
const hermesRoot = path.join(repoRoot, "hermes-agent");
const HERMES_UPSTREAM_COMMIT = "55ef425d0c3967022cb54093112e638c5c3f9e01";
const scientificSkillsRoot = path.join(repoRoot, "scientific-agent-skills");
const SCIENTIFIC_SKILLS_UPSTREAM_COMMIT = "757b63b1c09798a45c79eea542c9b55dbe04e502";

function log(message) {
  console.log(`[prepare-app] ${message}`);
}

function fail(message) {
  console.error(`[prepare-app] ERROR: ${message}`);
  process.exit(1);
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function resolveCodexBinary() {
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  const candidates = [
    process.env.CODEX_BIN,
    path.join(repoRoot, "codex", "codex-rs", "target", "release", executable),
    path.join(repoRoot, "codex", "codex-rs", "target", "debug", executable),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  const lookup = spawnSync(
    process.platform === "win32" ? "where.exe" : "which",
    [executable],
    { encoding: "utf8", windowsHide: true },
  );
  if (lookup.status === 0) {
    const found = lookup.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (found && fs.existsSync(found)) return found;
  }
  fail(
    "Codex binary not found. Build ./codex/codex-rs, install Codex, or set CODEX_BIN before packaging.",
  );
}

/** Copy `source` to `target`, skipping any relative path for which `skip` returns true. */
function copyTree(source, target, skip = () => false) {
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    // Materialize symlinks as real files: creating symlinks on Windows needs
    // elevated privileges, and installer resources must be self-contained.
    dereference: true,
    filter: (src) => {
      const rel = path.relative(source, src);
      if (rel === "") return true;
      return !skip(rel.split(path.sep).join("/"));
    },
  });
}

function freshDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

// Codex is a native coding agent launched per task by the dashboard. Stage the
// exact executable so an installed app does not depend on a global install.
const codexSource = resolveCodexBinary();
const codexTarget = path.join(
  desktopRoot,
  "resources",
  "bin",
  process.platform === "win32" ? "codex.exe" : "codex",
);
log(`staging Codex coding agent from ${codexSource}`);
fs.mkdirSync(path.dirname(codexTarget), { recursive: true });
fs.copyFileSync(codexSource, codexTarget);
if (process.platform !== "win32") fs.chmodSync(codexTarget, 0o755);

// Voicebox ships its Python/ML dependency closure as a native sidecar. A local
// source checkout is not sufficient for an installed app, so stage the binary
// when it has been built (or explicitly supplied) and otherwise leave Speech in
// its truthful unavailable state without breaking unrelated packaging work.
{
  const voiceboxExecutable = process.platform === "win32" ? "voicebox-server.exe" : "voicebox-server";
  const voiceboxTarget = path.join(desktopRoot, "resources", "bin", voiceboxExecutable);
  const targetTriple =
    process.platform === "win32"
      ? "x86_64-pc-windows-msvc.exe"
      : process.platform === "darwin" && process.arch === "arm64"
        ? "aarch64-apple-darwin"
        : process.platform === "darwin"
          ? "x86_64-apple-darwin"
          : "x86_64-unknown-linux-gnu";
  const candidates = [
    process.env.VOICEBOX_SERVER_BIN,
    path.join(repoRoot, "voicebox", "tauri", "src-tauri", "binaries", `voicebox-server-${targetTriple}`),
    path.join(repoRoot, "voicebox", "backend", "dist", voiceboxExecutable),
  ].filter(Boolean);
  const source = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).size > 64 * 1024);
  if (source) {
    log(`staging Voicebox speech server from ${source}`);
    fs.mkdirSync(path.dirname(voiceboxTarget), { recursive: true });
    fs.copyFileSync(source, voiceboxTarget);
    if (process.platform !== "win32") fs.chmodSync(voiceboxTarget, 0o755);
  } else {
    fs.rmSync(voiceboxTarget, { force: true });
    log("Voicebox server binary not built; packaged Speech will report setup required");
  }
}

/**
 * Produce a production `node_modules` for an already-staged package.
 *
 * npm installs can fail under a OneDrive-synchronized checkout while native
 * files are being scanned, so the install runs in the OS temp directory and the
 * resulting tree is materialized back into build-resources.
 */
function installProductionDependencies({ label, target, tempName, command }) {
  const localInstallDir = path.join(os.tmpdir(), tempName);
  freshDir(localInstallDir);
  copyTree(target, localInstallDir);
  const npmCli = process.platform === "win32"
    ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    : null;
  if (npmCli && !fs.existsSync(npmCli)) {
    fail(`npm CLI was not found beside the active Node runtime: ${npmCli}`);
  }
  const npmCommand = npmCli ? process.execPath : "npm";
  const npmPrefix = npmCli ? [npmCli] : [];
  let installStatus = 1;
  for (let attempt = 1; attempt <= 2 && installStatus !== 0; attempt += 1) {
    if (attempt > 1) {
      log(`retrying ${label} production install after a transient failure`);
      fs.rmSync(path.join(localInstallDir, "node_modules"), { recursive: true, force: true });
    }
    const install = spawnSync(
      npmCommand,
      [...npmPrefix, command, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: localInstallDir, stdio: "inherit", shell: false },
    );
    installStatus = install.status ?? 1;
  }
  if (installStatus !== 0) fail(`production install for ${label} failed`);
  const installedModules = path.join(localInstallDir, "node_modules");
  if (!fs.existsSync(installedModules)) {
    fail(`${label} production install produced no node_modules`);
  }
  copyTree(installedModules, path.join(target, "node_modules"));
  fs.rmSync(localInstallDir, { recursive: true, force: true });
}

// --- dashboard standalone -------------------------------------------------
const standaloneSource = path.join(repoRoot, "dashboard", ".next-desktop", "standalone");
const serverJs = path.join(standaloneSource, "dashboard", "server.js");
if (!fs.existsSync(serverJs)) {
  fail(
    `Standalone build not found (${serverJs}). Run the dashboard desktop build first ` +
      "(BREADBOARD_DESKTOP_BUILD=1 BREADBOARD_NEXT_DIST_DIR=.next-desktop npx next build).",
  );
}
const dashboardTarget = path.join(stagingRoot, "dashboard-standalone");
log("staging dashboard standalone server");
freshDir(dashboardTarget);
copyTree(standaloneSource, dashboardTarget, (rel) =>
  // Belt-and-braces: never ship data, secrets, or dev build state even if
  // tracing regressions reintroduce them.
  /^dashboard\/(db\/|database\/|artifacts\/|\.env|\.next\/|\.next-dev|\.next-production|\.vercel\/|tmp-)/.test(rel),
);
// Static assets + public files live outside the standalone tree.
log("staging dashboard static assets");
copyTree(
  path.join(repoRoot, "dashboard", ".next-desktop", "static"),
  path.join(dashboardTarget, "dashboard", ".next-desktop", "static"),
);
copyTree(
  path.join(repoRoot, "dashboard", "public"),
  path.join(dashboardTarget, "dashboard", "public"),
);

// Learn runs in a bounded one-at-a-time worker rather than in the long-lived
// Next server. Stage application source (never db/.env/artifacts) beside the
// standalone dependency graph so Node's native TypeScript loader can execute
// the same domain code after a dashboard recycle.
log("staging durable Learn worker source");
copyTree(
  path.join(repoRoot, "dashboard", "src"),
  path.join(dashboardTarget, "dashboard", "worker-src"),
);
const learnScriptsTarget = path.join(dashboardTarget, "dashboard", "scripts");
fs.mkdirSync(learnScriptsTarget, { recursive: true });
for (const entry of [
  "learn-worker.mjs",
  "learn-worker-import-hook.mjs",
  "windows-breakaway-process.mjs",
]) {
  fs.copyFileSync(
    path.join(repoRoot, "dashboard", "scripts", entry),
    path.join(learnScriptsTarget, entry),
  );
}

// Next's standalone tracer currently misses the MCP SDK's conditional ESM
// exports when reached through the server-only runtime adapter. Copy the
// lockfile-installed production closure explicitly so the installed dashboard
// can import the Hermes adapter. This stages code only, never data or secrets.
log("staging dashboard MCP proxy dependency closure");
{
  const sourceModules = path.join(repoRoot, "dashboard", "node_modules");
  const targetModules = path.join(
    dashboardTarget,
    "dashboard",
    "node_modules",
  );
  const copied = new Set();
  const resolveDependency = (parentSource, name) => {
    const nested = path.join(parentSource, "node_modules", ...name.split("/"));
    return fs.existsSync(path.join(nested, "package.json"))
      ? nested
      : path.join(sourceModules, ...name.split("/"));
  };
  const copyDependency = (name, parentSource, parentTarget) => {
    const source = resolveDependency(parentSource, name);
    const target = source.startsWith(path.join(parentSource, "node_modules"))
      ? path.join(parentTarget, "node_modules", ...name.split("/"))
      : path.join(targetModules, ...name.split("/"));
    const identity = `${source}\u0000${target}`;
    if (copied.has(identity)) return;
    const manifestPath = path.join(source, "package.json");
    if (!fs.existsSync(manifestPath)) {
      fail(`Dashboard MCP dependency is missing from node_modules: ${name}`);
    }
    copied.add(identity);
    copyTree(
      source,
      target,
      (rel) => /(^|\/)(test|tests|docs|examples|coverage)(\/|$)/i.test(rel),
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const dependency of Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    })) {
      const resolved = resolveDependency(source, dependency);
      if (fs.existsSync(path.join(resolved, "package.json"))) {
        copyDependency(dependency, source, target);
      }
    }
  };
  copyDependency("@modelcontextprotocol/sdk", sourceModules, targetModules);
}

// Repo-root marker so services that look for `<root>/dashboard` next to
// `<root>/hermes-config` recognize the staged layout.
fs.mkdirSync(path.join(stagingRoot, "dashboard"), { recursive: true });
fs.writeFileSync(
  path.join(stagingRoot, "dashboard", "README.txt"),
  "Marker directory. The dashboard server runs from dashboard-standalone/dashboard/server.js.\n",
);

// Postiz is an optional background desktop service. Its coordinator runs under
// the bundled Node runtime outside app.asar, so stage the small source closure
// it imports rather than duplicating the stack/bootstrap implementation.
log("staging Postiz desktop supervisor");
const scriptsTarget = path.join(stagingRoot, "scripts");
fs.mkdirSync(scriptsTarget, { recursive: true });
fs.copyFileSync(
  path.join(repoRoot, "scripts", "start-postiz-supervisor.mjs"),
  path.join(scriptsTarget, "start-postiz-supervisor.mjs"),
);
fs.copyFileSync(
  path.join(repoRoot, "scripts", "voicebox-status.mjs"),
  path.join(scriptsTarget, "voicebox-status.mjs"),
);
fs.copyFileSync(
  path.join(repoRoot, "scripts", "ifixai-background-runner.py"),
  path.join(scriptsTarget, "ifixai-background-runner.py"),
);

// iFixAi's package is installed into the bundled Python runtime. Preserve its
// upstream license and exact source revision beside the staged services.
{
  const ifixAiRoot = path.join(repoRoot, "iFixAi");
  const expected = "4ac9cc1c8765427300d98dc30855c18349610cf1";
  const revision = spawnSync("git", ["-C", ifixAiRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actual = revision.status === 0 ? revision.stdout.trim() : "";
  if (actual !== expected) {
    fail(`iFixAi checkout must be pinned to ${expected}; found ${actual || "unknown"}.`);
  }
  const target = path.join(stagingRoot, "ifixai");
  freshDir(target);
  fs.copyFileSync(path.join(ifixAiRoot, "LICENSE"), path.join(target, "LICENSE"));
  fs.writeFileSync(path.join(target, "BREADBOARD_UPSTREAM_COMMIT"), `${actual}\n`, "utf8");
}

const postizRuntimeTarget = path.join(stagingRoot, "dashboard", "src", "lib", "socials-manager");
fs.mkdirSync(postizRuntimeTarget, { recursive: true });
for (const entry of [
  "api-client.ts",
  "bootstrap.ts",
  "config.ts",
  "coordinator-core.ts",
  "coordinator-runtime.ts",
  "coordinator-server.ts",
  "docker.ts",
  "stack.ts",
]) {
  fs.copyFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "socials-manager", entry),
    path.join(postizRuntimeTarget, entry),
  );
}
fs.copyFileSync(
  path.join(repoRoot, "dashboard", "src", "lib", "runtime-paths.ts"),
  path.join(stagingRoot, "dashboard", "src", "lib", "runtime-paths.ts"),
);

const postizAppTarget = path.join(stagingRoot, "postiz-app");
freshDir(postizAppTarget);
fs.copyFileSync(
  path.join(repoRoot, "postiz-app", "docker-compose.yaml"),
  path.join(postizAppTarget, "docker-compose.yaml"),
);
copyTree(
  path.join(repoRoot, "postiz-app", "dynamicconfig"),
  path.join(postizAppTarget, "dynamicconfig"),
);

// The embedded broker uses Nango's open-source provider definitions and logos
// as static catalog data only. No Nango server, runtime, database, or secrets
// are bundled or started.
log("staging connected-app provider catalog");
const providerCatalogTarget = path.join(stagingRoot, "nango");
freshDir(providerCatalogTarget);
fs.mkdirSync(
  path.join(providerCatalogTarget, "packages", "providers"),
  { recursive: true },
);
copyTree(
  path.join(repoRoot, "nango", "packages", "providers", "providers.yaml"),
  path.join(providerCatalogTarget, "packages", "providers", "providers.yaml"),
);
fs.mkdirSync(
  path.join(
    providerCatalogTarget,
    "packages",
    "webapp",
    "public",
    "images",
  ),
  { recursive: true },
);
copyTree(
  path.join(
    repoRoot,
    "nango",
    "packages",
    "webapp",
    "public",
    "images",
    "template-logos",
  ),
  path.join(
    providerCatalogTarget,
    "packages",
    "webapp",
    "public",
    "images",
    "template-logos",
  ),
  (rel) => !rel.toLowerCase().endsWith(".svg"),
);

// --- chatmock -------------------------------------------------------------
log("staging chatmock");
freshDir(path.join(stagingRoot, "chatmock"));
copyTree(path.join(repoRoot, "chatmock"), path.join(stagingRoot, "chatmock"), (rel) =>
  /^(docker\/|Dockerfile|docker-compose|tests\/|chatmock\.egg-info\/|build\.py|gui\.py|__pycache__|\.git)/.test(rel) ||
  rel.includes("__pycache__"),
);

// --- unslop ---------------------------------------------------------------
// The writing skill ChatMock attaches to final, user-facing prose. It is read
// from disk at request time, and `council/unslop.py` finds it by walking up
// from its own module — so it has to sit beside chatmock/ here. Without this
// the packaged app silently answers without the skill while the dev repo
// (which has the sibling clone) looks fine.
log("staging unslop skill");
{
  const unslopSource = path.join(repoRoot, "unslop");
  if (!fs.existsSync(path.join(unslopSource, "SKILL.md"))) {
    fail("unslop/SKILL.md is missing; the packaged app would ship without the writing skill.");
  }
  const unslopTarget = path.join(stagingRoot, "unslop");
  freshDir(unslopTarget);
  copyTree(unslopSource, unslopTarget, (rel) =>
    /^(\.git|node_modules\/|__pycache__)/.test(rel) || rel.includes("__pycache__"),
  );
}

// --- watermarks-remover ---------------------------------------------------
// The scripts behind the `watermark_*` tools. `lib/watermarks/scripts.ts`
// resolves them under the repository root at call time, so without this the
// packaged app answers "the scripts are not installed" while the dev repo
// (which has the clone) looks fine — the same hole unslop fell into. Only the
// skill subtree ships: the clone's tests, Dockerfiles and CI are not read at
// runtime. Everything here is Python 3.10+ stdlib, so the bundled CPython runs
// it exactly as staged.
log("staging watermarks-remover scripts");
{
  const watermarksSkill = path.join(repoRoot, "watermarks-remover", "skills", "remove-ai-marks");
  if (!fs.existsSync(path.join(watermarksSkill, "scripts", "clean_file.py"))) {
    fail(
      "watermarks-remover/skills/remove-ai-marks/scripts/clean_file.py is missing; " +
        "the packaged app would ship without the watermark tools.",
    );
  }
  const watermarksTarget = path.join(stagingRoot, "watermarks-remover", "skills", "remove-ai-marks");
  freshDir(path.join(stagingRoot, "watermarks-remover"));
  copyTree(watermarksSkill, watermarksTarget, (rel) =>
    /(^|\/)__pycache__(\/|$)/.test(rel) || /\.(pyc|pyo)$/.test(rel),
  );
  const watermarksLicense = path.join(repoRoot, "watermarks-remover", "LICENSE");
  if (fs.existsSync(watermarksLicense)) {
    fs.copyFileSync(watermarksLicense, path.join(stagingRoot, "watermarks-remover", "LICENSE"));
  }
}

// --- loopx ----------------------------------------------------------------
// The control plane that governs long-running Hermes conversations. Only the
// Python package ships: the docs, the presentation app, and the regression
// fixtures are not read at runtime. LoopX declares no third-party dependencies,
// so the bundled CPython runs it as staged (see BREADBOARD_LOOPX_PYTHON in
// service-definitions.ts).
log("staging loopx control plane");
{
  const loopxSource = path.join(repoRoot, "loopx", "loopx");
  if (!fs.existsSync(path.join(loopxSource, "entrypoint.py"))) {
    fail("loopx/loopx/entrypoint.py is missing; the packaged app would ship without the control plane.");
  }
  const loopxTarget = path.join(stagingRoot, "loopx", "loopx");
  freshDir(path.join(stagingRoot, "loopx"));
  copyTree(loopxSource, loopxTarget, (rel) =>
    /(^|\/)(__pycache__|tests?)(\/|$)/.test(rel) || /\.(pyc|pyo)$/.test(rel),
  );
}

// --- goal -----------------------------------------------------------------
// Goal Mode consumes Goal's upstream continuation contract and persists its
// compatible state through Breadboard's conversation-scoped bridge. Only the
// MIT-licensed template and attribution ship; the Python MCP process is not
// launched in an installed app because one stdio process cannot safely own
// state for multiple Breadboard conversations.
log("staging Goal Mode contract");
{
  const goalSource = path.join(repoRoot, "goal");
  const continuationSource = path.join(goalSource, "src", "templates", "continuation.md");
  const licenseSource = path.join(goalSource, "LICENSE");
  if (!fs.existsSync(continuationSource) || !fs.existsSync(licenseSource)) {
    fail("goal/src/templates/continuation.md and goal/LICENSE are required for Goal Mode.");
  }
  const goalTarget = path.join(stagingRoot, "goal");
  freshDir(goalTarget);
  copyTree(
    path.join(goalSource, "src", "templates"),
    path.join(goalTarget, "templates"),
  );
  fs.copyFileSync(licenseSource, path.join(goalTarget, "LICENSE"));
  const revision = spawnSync("git", ["-C", goalSource, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  fs.writeFileSync(
    path.join(goalTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${revision.status === 0 ? revision.stdout.trim() : "unversioned"}\n`,
    "utf8",
  );
}

// --- Agency Agents -------------------------------------------------------
// Breadboard reads these Markdown personas directly at request time. Stage
// only the division catalog and its agent files: examples, contribution docs,
// and repository automation are not runtime dependencies.
log("staging Agency Agents persona catalog");
{
  const agencySource = path.join(repoRoot, "agency-agents");
  const divisionsSource = path.join(agencySource, "divisions.json");
  const licenseSource = path.join(agencySource, "LICENSE");
  if (!fs.existsSync(divisionsSource) || !fs.existsSync(licenseSource)) {
    fail("agency-agents checkout is incomplete; divisions.json and LICENSE are required.");
  }
  const parsed = JSON.parse(fs.readFileSync(divisionsSource, "utf8"));
  const divisions = Object.keys(parsed?.divisions ?? {});
  if (divisions.length === 0 || divisions.some((name) => !/^[a-z0-9-]+$/.test(name))) {
    fail("agency-agents/divisions.json contains no valid division directories.");
  }

  const agencyTarget = path.join(stagingRoot, "agency-agents");
  freshDir(agencyTarget);
  fs.copyFileSync(divisionsSource, path.join(agencyTarget, "divisions.json"));
  fs.copyFileSync(licenseSource, path.join(agencyTarget, "LICENSE"));
  for (const division of divisions) {
    const source = path.join(agencySource, division);
    if (!fs.existsSync(source)) {
      fail(`Agency Agents division is missing: ${division}`);
    }
    copyTree(source, path.join(agencyTarget, division), (rel) => {
      const entry = path.join(source, ...rel.split("/"));
      return fs.statSync(entry).isFile() && !rel.toLowerCase().endsWith(".md");
    });
  }
}

// --- meta-prompting -------------------------------------------------------
// The paper's prompt assets, which lib/hermes/meta-prompting.ts parses at
// request time to build each turn's scaffold. Only the prompt files ship: the
// clone's Math/data corpus is ~40 MB of benchmark JSON that nothing reads.
// Without this the packaged app falls back to the embedded structures while the
// dev repo (which has the sibling clone) looks fine, exactly as unslop did.
log("staging meta-prompting prompts");
{
  const metaSource = path.join(repoRoot, "meta-prompting");
  const metaFiles = [
    ["prompts", "cr-agent-assistant-v0.1.md"],
    ["prompts", "mp-icpd-v0.2.md"],
    ["prompts", "mp-pt-reasoning-v0.1.md"],
    ["prompts", "mp-pt-concise-v0.1.md"],
    ["Math", "prompts", "mp", "math.md"],
  ];
  const metaTarget = path.join(stagingRoot, "meta-prompting");
  freshDir(metaTarget);
  for (const parts of metaFiles) {
    const source = path.join(metaSource, ...parts);
    if (!fs.existsSync(source)) {
      fail(
        `meta-prompting/${parts.join("/")} is missing; the packaged app would ship without the meta prompt structures.`,
      );
    }
    const target = path.join(metaTarget, ...parts);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

// --- hermes-config --------------------------------------------------------
log("staging hermes-config");
freshDir(path.join(stagingRoot, "hermes-config"));
copyTree(path.join(repoRoot, "hermes-config"), path.join(stagingRoot, "hermes-config"));

// --- Breadboard first-party skills ---------------------------------------
// These are immutable product capabilities, distinct from the user's mutable
// approved/quarantine stores under app data.
log("staging Breadboard first-party skills");
const firstPartySkillsTarget = path.join(stagingRoot, "hermes-skills", "prebuilt");
freshDir(firstPartySkillsTarget);
copyTree(
  path.join(repoRoot, "hermes-skills", "prebuilt"),
  firstPartySkillsTarget,
);

// --- scientific-agent-skills ---------------------------------------------
{
  const revision = spawnSync("git", ["-C", scientificSkillsRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actual = revision.status === 0 ? revision.stdout.trim() : "";
  if (actual !== SCIENTIFIC_SKILLS_UPSTREAM_COMMIT) {
    fail(
      `Scientific skills checkout must be pinned to ${SCIENTIFIC_SKILLS_UPSTREAM_COMMIT}; found ${actual || "unknown"}.`,
    );
  }
  log(`staging scientific-agent-skills ${actual.slice(0, 12)} source closure`);
  const target = path.join(stagingRoot, "scientific-agent-skills");
  freshDir(target);
  copyTree(path.join(scientificSkillsRoot, "skills"), path.join(target, "skills"));
  fs.copyFileSync(path.join(scientificSkillsRoot, "LICENSE.md"), path.join(target, "LICENSE.md"));
  fs.writeFileSync(path.join(target, "BREADBOARD_UPSTREAM_COMMIT"), `${actual}\n`, "utf8");
}

// --- ARIS autonomous research agent --------------------------------------
// ARIS is a Markdown methodology and helper collection rather than a daemon.
// Stage the source closure Bread uses to assemble its per-turn research persona
// so installed builds behave exactly like the cloned development checkout.
{
  const arisRoot = path.join(repoRoot, "auto-claude-code-research-in-sleep");
  const arisTarget = path.join(stagingRoot, "auto-claude-code-research-in-sleep");
  const required = ["AGENT_GUIDE.md", "skills", "tools", "templates", "LICENSE"];
  for (const entry of required) {
    if (!fs.existsSync(path.join(arisRoot, entry))) {
      fail(`ARIS checkout is incomplete; missing ${path.join(arisRoot, entry)}`);
    }
  }
  const revision = spawnSync("git", ["-C", arisRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actual = revision.status === 0 ? revision.stdout.trim() : "unknown";
  log(`staging ARIS ${actual.slice(0, 12)} research source closure`);
  freshDir(arisTarget);
  fs.copyFileSync(path.join(arisRoot, "AGENT_GUIDE.md"), path.join(arisTarget, "AGENT_GUIDE.md"));
  fs.copyFileSync(path.join(arisRoot, "LICENSE"), path.join(arisTarget, "LICENSE"));
  for (const entry of ["skills", "tools", "templates", "mcp-servers"]) {
    const source = path.join(arisRoot, entry);
    if (!fs.existsSync(source)) continue;
    copyTree(source, path.join(arisTarget, entry), (rel) =>
      /(^|\/)(__pycache__|\.pytest_cache)(\/|$)/.test(rel) ||
      /\.(pyc|pyo)$/.test(rel),
    );
  }
  fs.writeFileSync(path.join(arisTarget, "BREADBOARD_UPSTREAM_COMMIT"), `${actual}\n`, "utf8");
}

// --- hermes-agent ---------------------------------------------------------
// Stage the pinned, minimal Python source closure. Dependencies are installed
// from Hermes's frozen uv.lock into the bundled CPython 3.13 runtime by
// prepare-runtimes.mjs. Keeping source outside the runtime makes the maintained
// Breadboard gateway patch and Breadboard plugin explicit and inspectable.
{
  const revision = spawnSync("git", ["-C", hermesRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  const actual = revision.status === 0 ? revision.stdout.trim() : "";
  if (actual !== HERMES_UPSTREAM_COMMIT) {
    fail(
      `Hermes checkout must be pinned to ${HERMES_UPSTREAM_COMMIT}; found ${actual || "unknown"}.`,
    );
  }
  log(`staging Hermes Agent ${actual.slice(0, 12)} source closure`);
  const hermesTarget = path.join(stagingRoot, "hermes-agent");
  freshDir(hermesTarget);
  const packageDirs = [
    "agent",
    "tools",
    "hermes_cli",
    "gateway",
    "tui_gateway",
    "cron",
    "acp_adapter",
    "plugins",
    "providers",
  ];
  for (const entry of packageDirs) {
    const source = path.join(hermesRoot, entry);
    if (!fs.existsSync(source)) fail(`Hermes package missing: ${source}`);
    copyTree(source, path.join(hermesTarget, entry), (rel) =>
      /(^|\/)(__pycache__|tests?)(\/|$)/.test(rel) ||
      /\.(pyc|pyo)$/.test(rel),
    );
  }
  const rootModules = [
    "run_agent.py",
    "model_tools.py",
    "toolsets.py",
    "batch_runner.py",
    "trajectory_compressor.py",
    "toolset_distributions.py",
    "cli.py",
    "hermes_bootstrap.py",
    "hermes_constants.py",
    "hermes_state.py",
    "hermes_time.py",
    "hermes_logging.py",
    "utils.py",
    "mcp_serve.py",
    "pyproject.toml",
    "uv.lock",
    "LICENSE",
  ];
  for (const entry of rootModules) {
    const source = path.join(hermesRoot, entry);
    if (!fs.existsSync(source)) fail(`Hermes runtime file missing: ${source}`);
    fs.copyFileSync(source, path.join(hermesTarget, entry));
  }
  fs.writeFileSync(
    path.join(hermesTarget, "BREADBOARD_UPSTREAM_COMMIT"),
    `${actual}\n`,
    "utf8",
  );

  // Hermes's Baileys WhatsApp bridge. Breadboard's dashboard spawns this Node
  // script directly (docs/WHATSAPP_INTEGRATION.md), so it must ship with its
  // production dependencies already installed — the bundled Node runtime is
  // node.exe alone, with no npm to install them on the user's machine.
  const bridgeSource = path.join(hermesRoot, "scripts", "whatsapp-bridge");
  if (!fs.existsSync(bridgeSource)) fail(`Hermes WhatsApp bridge missing: ${bridgeSource}`);
  log("staging Hermes WhatsApp bridge and production dependencies");
  const bridgeTarget = path.join(hermesTarget, "scripts", "whatsapp-bridge");
  freshDir(bridgeTarget);
  copyTree(bridgeSource, bridgeTarget, (rel) =>
    /(^|\/)node_modules(\/|$)/.test(rel) || /\.test\.(mjs|js)$/.test(rel),
  );
  installProductionDependencies({
    label: "hermes whatsapp-bridge",
    target: bridgeTarget,
    tempName: "breadboard-whatsapp-bridge-install",
    // The bridge ships a lockfile but no `npm ci` guarantee across Hermes bumps;
    // `install` keeps packaging working when the lockfile drifts from the manifest.
    command: "install",
  });
}

// --- quartz template (program files only; content/public are user data) ---
log("staging quartz template");
const quartzTarget = path.join(stagingRoot, "quartz-template");
freshDir(quartzTarget);
for (const entry of [
  "quartz",
  "node_modules",
  "package.json",
  "package-lock.json",
  "quartz.config.ts",
  "quartz.layout.ts",
  "tsconfig.json",
  "globals.d.ts",
  "index.d.ts",
]) {
  const source = path.join(repoRoot, "quartz", entry);
  if (!fs.existsSync(source)) continue;
  copyTree(source, path.join(quartzTarget, entry), (rel) => rel.startsWith(".git"));
}

// --- scriberr (compose only, optional Docker compatibility mode) ----------
log("staging scriberr compose file");
freshDir(path.join(stagingRoot, "scriberr"));
fs.copyFileSync(
  path.join(repoRoot, "scriberr", "docker-compose.yml"),
  path.join(stagingRoot, "scriberr", "docker-compose.yml"),
);

// --- openGym catalogue ----------------------------------------------------
// openGym's Breadboard agent runs in the dashboard process. It only needs the
// compact catalogue at runtime; animations are loaded from a local media mount
// when present and otherwise cached from the dataset's pinned CDN revision.
{
  const openGymRoot = path.join(repoRoot, "openGym");
  const openGymTarget = path.join(stagingRoot, "openGym");
  const catalogue = path.join(openGymRoot, "frontend", "src", "lib", "exercises-data.js");
  if (!fs.existsSync(catalogue)) fail(`openGym catalogue not found: ${catalogue}`);
  log("staging openGym exercise catalogue");
  freshDir(openGymTarget);
  const catalogueTarget = path.join(openGymTarget, "frontend", "src", "lib");
  fs.mkdirSync(catalogueTarget, { recursive: true });
  fs.copyFileSync(catalogue, path.join(catalogueTarget, "exercises-data.js"));
  for (const notice of ["LICENSE", "NOTICE.md", "README.md"]) {
    const source = path.join(openGymRoot, notice);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(openGymTarget, notice));
  }
}

// --- shared static assets -------------------------------------------------
if (fs.existsSync(path.join(repoRoot, "shared"))) {
  log("staging shared assets");
  freshDir(path.join(stagingRoot, "shared"));
  copyTree(path.join(repoRoot, "shared"), path.join(stagingRoot, "shared"));
}

// --- ui-tars-adapter (browser + actual-desktop sidecar; optional runtime) --
// Stage source, then produce a clean production install on a local temp disk.
// This includes Agent TARS' isolated-browser dependencies and the official
// NutJS Windows desktop operator. Chromium remains external; a system
// Chrome/Edge is located at runtime for isolated-browser mode.
if (fs.existsSync(path.join(repoRoot, "ui-tars-adapter"))) {
  log("staging ui-tars-adapter source and production dependencies");
  const uiTarsTarget = path.join(stagingRoot, "ui-tars-adapter");
  freshDir(uiTarsTarget);
  copyTree(path.join(repoRoot, "ui-tars-adapter"), uiTarsTarget, (rel) =>
    /(^|\/)node_modules(\/|$)/.test(rel) || /(^|\/)test(\/|$)/.test(rel),
  );
  installProductionDependencies({
    label: "ui-tars-adapter",
    target: uiTarsTarget,
    tempName: "breadboard-ui-tars-adapter-install",
    command: "ci",
  });
}

// --- licenses -------------------------------------------------------------
log("staging license notices");
const licensesTarget = path.join(desktopRoot, "build-resources", "licenses");
fs.mkdirSync(licensesTarget, { recursive: true });
const licenseSources = [
  ["agency-agents", path.join(repoRoot, "agency-agents", "LICENSE")],
  ["chatmock", path.join(repoRoot, "chatmock", "LICENSE")],
  ["codex", path.join(repoRoot, "codex", "LICENSE")],
  ["goal", path.join(repoRoot, "goal", "LICENSE")],
  ["hermes-agent", path.join(hermesRoot, "LICENSE")],
  ["openGym", path.join(repoRoot, "openGym", "LICENSE")],
  ["scientific-agent-skills", path.join(scientificSkillsRoot, "LICENSE.md")],
  ["quartz", path.join(repoRoot, "quartz", "LICENSE.txt")],
  ["postiz", path.join(repoRoot, "postiz-app", "LICENSE")],
];
for (const [name, source] of licenseSources) {
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(licensesTarget, `${name}-LICENSE.txt`));
  }
}

// Sanity guard: no databases or env files may be staged.
const forbidden = [];
function scanForbidden(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanForbidden(full);
    } else if (/\.(db|db-shm|db-wal)$/.test(entry.name) || /^\.env($|\.)/.test(entry.name)) {
      // .env.example files are documentation, not secrets.
      if (entry.name.endsWith(".example")) continue;
      // Third-party packages sometimes ship an empty .env of their own (psl@1.9.0
      // is one). A zero-byte file inside node_modules holds
      // no secret, and blocking it only stops the build. Both conditions are
      // required: anything with content, or anywhere outside node_modules, still
      // fails as before.
      const insideDependencies = full.split(path.sep).includes("node_modules");
      if (insideDependencies && fs.statSync(full).size === 0) continue;
      forbidden.push(full);
    }
  }
}
scanForbidden(stagingRoot);
if (forbidden.length > 0) {
  fail(`Mutable data or env secrets staged into resources:\n  ${forbidden.join("\n  ")}`);
}
log("done");
