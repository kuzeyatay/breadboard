import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SkillsCatalogStore } from "../src/lib/hermes/skills-catalog-store.ts";
import {
  OMH_SKILLS_SOURCE,
  getLocalOmhSkill,
  localOmhSkillsRepository,
  readLocalOmhSkillFiles,
  synchronizeLocalOmhSkillsCatalog,
} from "../src/lib/hermes/omh-skills-source.ts";
import {
  getLocalReviewedSkill,
  isReviewedLocalSource,
  readLocalReviewedSkillFiles,
} from "../src/lib/hermes/local-skills-sources.ts";
import {
  OmhServiceError,
  resolveOmhRuntime,
  runOmh,
  validateOmhArguments,
} from "../src/lib/hermes/omh-service.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(dashboardRoot, "..");
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const readRepo = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-omh-catalog-"));
  const store = new SkillsCatalogStore(path.join(root, "catalog.db"));
  return {
    store,
    cleanup() {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function withClone(run) {
  const fixture = tempStore();
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-omh-skills-"));
  const previousRoot = process.env.OMH_SKILLS_ROOT;
  try {
    const routing = path.join(clone, "skills", "omh-routing");
    const work = path.join(clone, "skills", "ulw-work");
    fs.mkdirSync(path.join(routing, "references"), { recursive: true });
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(
      path.join(routing, "SKILL.md"),
      "---\nname: omh-routing\ndescription: >\n  [omh] Router guidance for using oh-my-hermes\n  workflow skills inside Hermes Agent.\n---\n\n# Oh My Hermes Router\n",
      "utf8",
    );
    fs.writeFileSync(path.join(routing, "references", "workflow-registry.md"), "# Workflows\n", "utf8");
    fs.writeFileSync(
      path.join(work, "SKILL.md"),
      "---\nname: ulw-work\ndescription: Scale fast parallel work with visible ownership.\n---\n",
      "utf8",
    );
    run({ fixture, clone });
  } finally {
    if (previousRoot === undefined) delete process.env.OMH_SKILLS_ROOT;
    else process.env.OMH_SKILLS_ROOT = previousRoot;
    fs.rmSync(clone, { recursive: true, force: true });
    fixture.cleanup();
  }
}

test("a cloned oh-my-hermes repository overlays complete local metadata and files", () => {
  withClone(({ fixture, clone }) => {
    process.env.OMH_SKILLS_ROOT = clone;

    const result = synchronizeLocalOmhSkillsCatalog({ store: fixture.store, force: true });
    assert.equal(result.total, 2);
    assert.equal(fixture.store.status().totalAvailable, 2);

    const stored = fixture.store.get(`${OMH_SKILLS_SOURCE}/omh-routing`);
    assert.equal(stored.name, "omh-routing");
    assert.equal(
      stored.description,
      "[omh] Router guidance for using oh-my-hermes workflow skills inside Hermes Agent.",
    );
    assert.equal(stored.sourceType, "local-git");
    assert.equal(stored.slashCommand, "omh:omh-routing");
    assert.ok(stored.files.some((file) => file.path === "references/workflow-registry.md"));

    const omhView = fixture.store.list({ source: OMH_SKILLS_SOURCE });
    assert.equal(omhView.total, 2);
    assert.deepEqual(omhView.skills.map((skill) => skill.slug).sort(), ["omh-routing", "ulw-work"]);

    const files = readLocalOmhSkillFiles(stored.upstreamId);
    assert.equal(files.hash, stored.upstreamHash);
    assert.equal(getLocalOmhSkill(stored.upstreamId).detail.hash, stored.upstreamHash);

    const second = synchronizeLocalOmhSkillsCatalog({ store: fixture.store });
    assert.equal(second.skipped, true);
  });
});

test("OMH_SKILLS_ROOT may point at the skills tree instead of the repository", () => {
  withClone(({ fixture, clone }) => {
    process.env.OMH_SKILLS_ROOT = path.join(clone, "skills");
    const result = synchronizeLocalOmhSkillsCatalog({ store: fixture.store, force: true });
    assert.equal(result.total, 2);
    assert.equal(path.basename(result.root), path.basename(clone));
  });
});

test("the workflow pack is a reviewed local source the shared registry resolves", () => {
  withClone(({ fixture, clone }) => {
    process.env.OMH_SKILLS_ROOT = clone;
    synchronizeLocalOmhSkillsCatalog({ store: fixture.store, force: true });

    assert.equal(isReviewedLocalSource(OMH_SKILLS_SOURCE), true);
    const local = getLocalReviewedSkill(`${OMH_SKILLS_SOURCE}/ulw-work`);
    assert.equal(local.source, OMH_SKILLS_SOURCE);
    assert.match(local.label, /oh-my-hermes/);
    assert.equal(local.description, "Scale fast parallel work with visible ownership.");
    assert.ok(readLocalReviewedSkillFiles(`${OMH_SKILLS_SOURCE}/ulw-work`).files["SKILL.md"]);
    assert.equal(getLocalReviewedSkill(`${OMH_SKILLS_SOURCE}/absent`), null);
  });
});

test("the catalog page lists the workflow pack under its own filter", () => {
  const registry = read("src/lib/hermes/local-skills-sources.ts");
  const catalogRoute = read("src/app/api/hermes/skills/route.ts");
  const ui = read("src/app/components/hermes/skills-catalog-panel.tsx");

  assert.match(registry, /synchronize: synchronizeLocalOmhSkillsCatalog/);
  assert.match(catalogRoute, /const FILTERS = new Set<SkillsRouteFilter>\(\[[\s\S]*?"omh"[\s\S]*?\]\)/);
  assert.match(catalogRoute, /filter === "omh"\s*\? OMH_SKILLS_SOURCE/);
  assert.match(ui, /\{ id: "omh", label: "Workflow" \}/);
  assert.match(ui, /filter === "omh"[\s\S]*skill\.source === "rlaope\/oh-my-hermes"/);
});

test("the vendored oh-my-hermes clone is discovered without configuration", () => {
  const clone = path.join(repoRoot, "oh-my-hermes", "skills");
  // The clone is optional: checkouts without it fall back to the catalog only.
  if (!fs.existsSync(clone)) return;
  const previousRoot = process.env.OMH_SKILLS_ROOT;
  delete process.env.OMH_SKILLS_ROOT;
  try {
    assert.equal(path.basename(localOmhSkillsRepository()), "oh-my-hermes");
  } finally {
    if (previousRoot !== undefined) process.env.OMH_SKILLS_ROOT = previousRoot;
  }
});

// --- the runtime half: OMH as a bounded read-only tool -----------------------

test("only read-only OMH commands are reachable", () => {
  for (const args of [
    ["chat", "route", "help me ship a dark mode toggle"],
    ["chat", "route-hint", "plan this"],
    ["chat", "interact", "plan this"],
    ["recommend", "write a research brief"],
    ["quickstart"],
    ["doctor"],
    ["probe"],
    ["list"],
    ["snippet"],
    ["harness", "list"],
    ["cases", "inspect", "g1"],
    ["profile", "list"],
    ["playbook", "recommend", "ship a feature"],
    ["docs", "workflows"],
    ["skill-profile", "status"],
    ["capability-policy", "status"],
  ]) {
    assert.deepEqual(validateOmhArguments(args), args, args.join(" "));
  }
});

test("install, mutation and executor-dispatch commands are denied", () => {
  for (const args of [
    ["setup"],
    ["install"],
    ["update"],
    ["apply"],
    ["convert", "./skills"],
    ["uninstall"],
    ["coding", "fanout", "dispatch"],
    ["memory", "new"],
    ["goal", "start"],
    ["loop", "run"],
    ["worktree", "create"],
    ["plugin", "install"],
    ["release", "hermes-smoke"],
    ["state", "reset"],
    ["mcp", "serve"],
    // Allowed commands still cannot reach a denied subcommand.
    ["chat", "session"],
    ["capability-policy", "disable"],
    ["skill-profile", "reconcile"],
    ["cases", "replay"],
    ["docs", "capability-impact"],
  ]) {
    assert.throws(
      () => validateOmhArguments(args),
      (error) => error instanceof OmhServiceError && error.code === "omh_command_denied",
      args.join(" "),
    );
  }
});

test("the model cannot redirect OMH at the operator's real home or write files", () => {
  for (const args of [
    ["doctor", "--omh-home", os.homedir()],
    ["probe", "--hermes-home", os.homedir()],
    ["doctor", `--omh-home=${os.homedir()}`],
    ["list", "--scope", "user"],
    ["docs", "workflows", "--output", "WORKFLOWS.md"],
    ["snippet", "--output=AGENTS.md"],
    ["docs", "roles", "-o", "ROLES.md"],
    ["doctor", "--force"],
    ["release", "--live"],
  ]) {
    assert.throws(
      () => validateOmhArguments(args),
      (error) =>
        error instanceof OmhServiceError &&
        ["omh_flag_denied", "omh_command_denied"].includes(error.code),
      args.join(" "),
    );
  }
});

test("arguments must be bounded, single-line strings", () => {
  for (const args of [[], "route", ["chat", 7], ["chat", ""], ["chat", "route\nx"], new Array(25).fill("x")]) {
    assert.throws(
      () => validateOmhArguments(args),
      (error) => error instanceof OmhServiceError && error.code === "omh_invalid_arguments",
    );
  }
});

test("the OMH router runs locally and stays inside the session workspace", async (t) => {
  const runtime = resolveOmhRuntime();
  if (!runtime) return t.skip("oh-my-hermes clone or a Python interpreter is unavailable");

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-omh-run-"));
  try {
    const result = await runOmh({
      arguments: ["chat", "route", "I want to safely add a dark mode toggle to this repo"],
      workspaceDirectory: workspace,
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /OMH chat route/);
    assert.match(result.output, /Workflow:/);
    // The router's whole point: a route is prepared work, never observed work.
    assert.match(result.output, /Not evidence yet:/);

    // Both homes are redirected into the workspace, so nothing lands in ~.
    assert.ok(fs.existsSync(path.join(workspace, ".omh")));
    assert.ok(fs.existsSync(path.join(workspace, ".omh-hermes")));
    assert.equal(fs.existsSync(path.join(os.homedir(), ".omh")), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("omh_run is registered everywhere the runtime actually reads", () => {
  // A tool registered only in hermes-config/tool/*.ts is never offered to the
  // model; the live registry is the Python plugin.
  assert.match(readRepo("hermes-agent/plugins/breadboard/plugin.yaml"), /^ {2}- omh_run$/m);
  const plugin = readRepo("hermes-agent/plugins/breadboard/__init__.py");
  assert.match(plugin, /"omh_run",\s*\n\s*"\/api\/hermes\/tools\/omh",/);

  const broker = read("src/lib/hermes/capability-broker.ts");
  assert.match(broker, /OMH_TOOLS,/);
  assert.match(broker, /for \(const tool of OMH_TOOLS\)/);

  assert.ok(fs.existsSync(path.join(dashboardRoot, "src/app/api/hermes/tools/omh/route.ts")));

  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    assert.ok(allowedToolsForSurface(surface).includes("omh_run"), surface);
  }
  assert.equal(allowedToolsForSurface("quartz_ai").includes("omh_run"), false);
});

test("the first-party oh-my-hermes skill resolves ready on the authenticated surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const found = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === "oh-my-hermes",
    );
    assert.ok(found, `not discovered for ${surface}`);
    assert.equal(found.healthy, true, surface);
    assert.equal(found.enabled, true, surface);
    assert.equal(found.availability, "ready", surface);
  }
  const onQuartz = listFirstPartySkills("quartz_ai").find(
    (candidate) => candidate.slug === "oh-my-hermes",
  );
  assert.notEqual(onQuartz?.availability, "ready");
});

test("the callback gates the tool on the selected skill and an active run", () => {
  const route = read("src/app/api/hermes/tools/omh/route.ts");
  assert.match(route, /tokenAllows\(verified\.token, \{ tool: "omh_run" \}\)/);
  assert.match(route, /selectedConditionalSkills\.includes\("oh-my-hermes"\)/);
  assert.match(route, /getActiveRuntimeRun\(session\.id\)/);
  assert.match(route, /\["dashboard_terminal", "garden_chat"\]\.includes\(session\.surface\)/);
});
