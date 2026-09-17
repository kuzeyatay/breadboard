#!/usr/bin/env node
// Standalone disposable worker: regenerate only published visual IDs, preserve lesson prose.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import OpenAI from "openai";
import {
  createGeneratedVisualization,
  replaceGeneratedVisualBlock,
  findGeneratedVisualBlockById,
  loadGeneratedVisualManifest,
  loadGeneratedVisualDefinition,
} from "../src/lib/generated-visuals.ts";
import { compileGardenVisualization } from "../src/lib/generated-visual-compiler.ts";
import { runGeneratedVisualBrowserTestsLocally } from "../src/lib/generated-visual-browser-tests.ts";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const i = arg.indexOf("=");
    return i < 0
      ? [arg.replace(/^--/, ""), true]
      : [arg.slice(2, i), arg.slice(i + 1)];
  }),
);
if (!args.garden || !args.workspace)
  throw new Error(
    "Use --garden=<absolute garden> --workspace=<absolute staging root> --base-url=<ChatMock /v1 URL> [--only=<id>] [--publish]",
  );
const garden = path.resolve(args.garden),
  workspace = path.resolve(args.workspace),
  staged = path.join(workspace, path.basename(garden));
if (workspace.startsWith(garden + path.sep) || workspace === garden)
  throw new Error("Staging must be outside the live garden.");
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
function pages(root) {
  return fs
    .readdirSync(path.join(root, "learning"), {
      recursive: true,
      withFileTypes: true,
    })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) =>
      path
        .relative(root, path.join(e.parentPath, e.name))
        .replaceAll("\\", "/"),
    )
    .sort();
}
const baselinePath = path.join(workspace, "baseline.json");
if (!fs.existsSync(baselinePath)) {
  fs.mkdirSync(path.join(staged, ".breadboard"), { recursive: true });
  const baseline = Object.fromEntries(
    pages(garden).map((p) => [p, hash(fs.readFileSync(path.join(garden, p)))]),
  );
  fs.cpSync(path.join(garden, "learning"), path.join(staged, "learning"), {
    recursive: true,
  });
  for (const name of [
    "visualization-plan.json",
    "visual-index.json",
    "learning-unit-contract.json",
    "visualization-coverage.json",
  ]) {
    const from = path.join(garden, ".breadboard", name);
    if (fs.existsSync(from))
      fs.copyFileSync(from, path.join(staged, ".breadboard", name));
  }
  fs.cpSync(
    path.join(garden, ".breadboard", "visuals"),
    path.join(staged, ".breadboard", "visuals"),
    { recursive: true, filter: (p) => !p.split(path.sep).includes("attempts") },
  );
  fs.writeFileSync(
    baselinePath,
    JSON.stringify(
      { garden, pages: baseline, createdAt: new Date().toISOString() },
      null,
      2,
    ),
  );
}
const baseline = JSON.parse(fs.readFileSync(baselinePath));
if (baseline.garden !== garden)
  throw new Error("Workspace belongs to another garden.");
const plan = JSON.parse(
  fs.readFileSync(path.join(staged, ".breadboard", "visualization-plan.json")),
);
const index = JSON.parse(
  fs.readFileSync(path.join(staged, ".breadboard", "visual-index.json")),
);
const ids = Object.keys(index).filter(
  (id) => index[id].kind === "generated_module",
);
const reportPath = path.join(workspace, "results.json");
const report = fs.existsSync(reportPath)
  ? JSON.parse(fs.readFileSync(reportPath))
  : {};

if (!args.publish) {
  const client = new OpenAI({
    baseURL: args["base-url"],
    apiKey: "local",
    maxRetries: 0,
    timeout: 31 * 60_000,
  });
  const queue = ids.filter(
    (id) =>
      (!args.only || args.only === id) &&
      id !== args.exclude &&
      !String(args.skip || "")
        .split(",")
        .includes(id) &&
      !report[id]?.passed,
  );
  async function regenerate(id) {
    const opportunity = plan.opportunities.find((o) => o.id === id);
    if (!opportunity) throw new Error(`No opportunity for ${id}`);
    const markdown = fs.readFileSync(
      path.join(staged, opportunity.targetPage),
      "utf8",
    );
    console.log(
      JSON.stringify({ id, event: "started", at: new Date().toISOString() }),
    );
    const owner = report[id]?.owner ?? `upgrade-${id}-${Date.now()}`;
    report[id] = { ...report[id], owner, passed: false };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    const stored = loadGeneratedVisualManifest(staged, id);
    const evidenceRoot = path.join(staged, ".breadboard", "visuals", id);
    const storedPassed =
      stored?.sourceSkill === "interactive-visualizer-in-chat" &&
      loadGeneratedVisualDefinition(staged, id) &&
      JSON.parse(fs.readFileSync(path.join(evidenceRoot, "tests.json")))
        .passed === true &&
      JSON.parse(fs.readFileSync(path.join(evidenceRoot, "critic.json")))
        .approved === true;
    const result = storedPassed
      ? { manifest: stored }
      : await createGeneratedVisualization({
          sourceSkill: "interactive-visualizer-in-chat",
          client,
          model: args.model || "gpt-5.6-sol",
          gardenDir: staged,
          ...(args["native-recovery"]
            ? {
                nativeAuthorRecovery: JSON.parse(
                  fs.readFileSync(args["native-recovery"]),
                ),
              }
            : {}),
          durableRecoveryDir: path.join(workspace, "receipts"),
          recoveryOwnerId: owner,
          opportunity,
          pageMarkdown: markdown,
          maxAttempts: 6,
          compilerRunner: compileGardenVisualization,
          browserTestRunner: runGeneratedVisualBrowserTestsLocally,
          onEvent: (event) => console.log(JSON.stringify(event)),
        });
    if (!result.manifest) {
      report[id] = { owner, passed: false, errors: result.errors };
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      throw new Error(`${id}: ${result.errors.join("; ")}`);
    }
    const block = findGeneratedVisualBlockById(markdown, id);
    if (!block) throw new Error(`Missing visual reference ${id}`);
    const replaced = replaceGeneratedVisualBlock(
      markdown,
      block,
      id,
      result.manifest.version,
    );
    fs.writeFileSync(path.join(staged, opportunity.targetPage), replaced);
    report[id] = {
      owner,
      passed: true,
      version: result.manifest.version,
      title: result.manifest.title,
      page: opportunity.targetPage,
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(8, Number(args.parallel) || 1)) },
      async () => {
        while (queue.length) {
          const id = queue.shift();
          try {
            await regenerate(id);
          } catch (error) {
            console.error(JSON.stringify({ id, error: String(error) }));
            process.exitCode = 1;
          }
        }
      },
    ),
  );
  console.log(
    JSON.stringify({
      staged,
      completed: Object.values(report).filter((r) => r.passed).length,
      total: ids.length,
    }),
  );
} else {
  if (ids.some((id) => !report[id]?.passed))
    throw new Error("All visualizers must pass before publication.");
  const { publishLearnVisualizerReplacements } =
    await import("../src/lib/learn-visualizer-publication.ts");
  const receipt = await publishLearnVisualizerReplacements({
    gardenDir: garden,
    stagedGardenDir: staged,
    baselineHashes: baseline.pages,
    receiptPath: path.join(workspace, "publication.json"),
  });
  console.log(JSON.stringify(receipt));
}
