import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  developmentRebuildCommands,
  rebuildDevelopmentInstallation,
  type DevelopmentRebuildCommand,
} from "../src/main/development-rebuild";

const repoRoot = path.resolve("test-repository");
const env = {
  npm_node_execpath: path.resolve("tools", "node"),
  npm_execpath: path.resolve("tools", "npm-cli.js"),
};

test("hot development rebuilds the desktop shell before the clean source restart", () => {
  const commands = developmentRebuildCommands(repoRoot, "hot", env);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], {
    label: "desktop shell",
    executable: env.npm_node_execpath,
    args: [
      env.npm_execpath,
      "--prefix",
      path.join(repoRoot, "desktop"),
      "run",
      "build",
    ],
    cwd: repoRoot,
  });
});

test("lean development rebuilds the standalone dashboard before the shell", () => {
  const commands = developmentRebuildCommands(repoRoot, "lean", env);
  assert.deepEqual(
    commands.map((command) => command.label),
    ["standalone dashboard", "desktop shell"],
  );
  assert.deepEqual(commands[0]?.args, [
    path.join(repoRoot, "desktop", "scripts", "build-dashboard.mjs"),
  ]);
});

test("a failed development build stops the restart sequence", async () => {
  const run: DevelopmentRebuildCommand[] = [];
  const rebuilt = await rebuildDevelopmentInstallation({
    repoRoot,
    dashboardMode: "lean",
    env,
    runCommand: async (command) => {
      run.push(command);
      return command.label !== "standalone dashboard";
    },
  });
  assert.equal(rebuilt, false);
  assert.deepEqual(run.map((command) => command.label), ["standalone dashboard"]);
});

test("a development restart refuses to guess an npm launcher", () => {
  assert.throws(
    () => developmentRebuildCommands(repoRoot, "hot", {}),
    /Start Breadboard through npm/,
  );
});
