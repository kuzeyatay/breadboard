import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { initializeSourceRepair, signSourceRepairRelease, writeRepairJournal, repairFileHash } from "../../desktop/src/shared/source-repair.ts";

test("real launchers select matching dashboard/worker releases and fall back on invalid proof", () => {
  const fixture = fs.mkdtempSync(path.resolve(".tmp/source-repair-tests/launch-"));
  const root = path.join(fixture, "repo"), data = path.join(fixture, "data");
  const write = (relative, content) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  write("desktop/package.json", '{"private":true}\n');
  write("dashboard/package.json", '{"private":true}\n');
  for (const file of ["runtime-v2-dashboard.mjs", "learn-worker-import-hook.mjs"]) {
    // Until the coordinated shutdown these exact reviewed files are staged.
    const staged = path.resolve(".tmp/self-repair-staging/dashboard/scripts", file);
    write(`dashboard/scripts/${file}`, fs.readFileSync(fs.existsSync(staged) ? staged : `dashboard/scripts/${file}`));
  }
  write("dashboard/scripts/source-repair-release.mjs", fs.readFileSync("dashboard/scripts/source-repair-release.mjs"));
  write("dashboard/scripts/source-repair-worker-imports.mjs", fs.readFileSync("dashboard/scripts/source-repair-worker-imports.mjs"));
  write("dashboard/scripts/runtime-v2-worker-events.mjs", fs.readFileSync("dashboard/scripts/runtime-v2-worker-events.mjs"));
  write(".runtime/source-repair-installation.json", '{"version":1}\n');
  write("desktop/src/shared/source-repair.ts", fs.readFileSync("desktop/src/shared/source-repair.ts"));
  write("dashboard/src/lib/value.ts", "export const value = 'baseline';\n");
  const server = "dashboard/.next-desktop/standalone/server.js";
  const program = "console.log(JSON.stringify({release:process.env.BREADBOARD_SOURCE_RELEASE_ID || null,ready:process.env.BREADBOARD_SOURCE_REPAIR_READY}));\n";
  write(server, program);
  initializeSourceRepair(data, root, true);
  const id = "sr-0123456789abcdef01234567", candidate = path.join(root, ".qa-worktrees", id);
  write(`.qa-worktrees/${id}/dashboard/package.json`, '{"private":true}\n');
  write(`.qa-worktrees/${id}/${server}`, program);
  const source = "dashboard/src/lib/value.ts";
  write(`.qa-worktrees/${id}/${source}`, "export const value = 'repaired';\n");
  const release = signSourceRepairRelease(data, { id, root: candidate, baseRoot: root, createdAt: Date.now(), sourceFingerprint: "fixture", changedSources: [source],
    files: [server, source].map(file => ({ path: file, sha256: repairFileHash(path.join(candidate, file)) })) });
  const env = { ...process.env, BREADBOARD_DATA_DIR: data, BREADBOARD_REPO_ROOT: root, BREADBOARD_LEARN_SOURCE_ROOT: path.join(root, "dashboard/src") };
  const run = file => JSON.parse(execFileSync(process.execPath, [path.join(root, file)], { cwd: path.join(root, "dashboard"), env, encoding: "utf8", windowsHide: true }).trim());
  assert.deepEqual(run("dashboard/scripts/runtime-v2-dashboard.mjs"), { release: null, ready: "1" });
  writeRepairJournal(data, { version: 1, phase: "probation", active: release, previous: null, repairId: id, updatedAt: Date.now() });
  assert.deepEqual(run("dashboard/scripts/runtime-v2-dashboard.mjs"), { release: id, ready: "1" });
  write("dashboard/check-worker.mjs", `await import('./scripts/learn-worker-import-hook.mjs'); const {value} = await import(${JSON.stringify(pathToFileURL(path.join(root, source)).href)}); console.log(JSON.stringify(value));`);
  assert.equal(run("dashboard/check-worker.mjs"), "repaired");
  write("dashboard/check-direct-worker.mjs", `import {registerSourceRepairWorkerImports} from './scripts/source-repair-worker-imports.mjs'; import {registerHooks} from 'node:module'; registerSourceRepairWorkerImports(); registerHooks({resolve(s,c,n){ return s==='fixture-alias' ? {url:${JSON.stringify(pathToFileURL(path.join(root, source)).href)},shortCircuit:true}:n(s,c)}}); console.log(JSON.stringify((await import('fixture-alias')).value));`);
  assert.equal(run("dashboard/check-direct-worker.mjs"), "repaired");
  write("dashboard/check-early-worker.mjs", `await import('./scripts/runtime-v2-worker-events.mjs'); console.log(JSON.stringify((await import(${JSON.stringify(pathToFileURL(path.join(root, source)).href)})).value));`);
  assert.equal(run("dashboard/check-early-worker.mjs"), "repaired", "Source loaded before event-writer construction must use the candidate.");
  writeRepairJournal(data, { version: 1, phase: "probation", active: { ...release, signature: "invalid" }, previous: null, repairId: id, updatedAt: Date.now() });
  assert.deepEqual(run("dashboard/scripts/runtime-v2-dashboard.mjs"), { release: null, ready: "0" });
  assert.equal(run("dashboard/check-worker.mjs"), "baseline");
  assert.equal(run("dashboard/check-direct-worker.mjs"), "baseline");
});
