import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {praxistFinalizationReady} from "../src/lib/praxist/finalization.ts";

test("an early summary cannot stop the runtime before canonical findings are published", () => {
  const summary={status:"succeeded",exit_code:0};
  assert.equal(praxistFinalizationReady(summary,{status:"running"},false),false);
  assert.equal(praxistFinalizationReady(summary,{status:"running"},true),false);
  const finalized={status:"succeeded",finalized_at:"2026-09-08T00:00:00Z"};
  assert.equal(praxistFinalizationReady(summary,finalized,false),false);
  assert.equal(praxistFinalizationReady(summary,finalized,true),true);
  assert.equal(praxistFinalizationReady(summary,{...finalized,status:"failed"},true),false);
});

test("the container waiter waits through early summary publication and actual process exit", () => {
  const python=fileURLToPath(new URL("../../PRAXIST/.venv/Scripts/python.exe",import.meta.url));
  const result=spawnSync(fs.existsSync(python)?python:"python",[
    fileURLToPath(new URL("./praxist-container-lifecycle.py",import.meta.url)),
    fileURLToPath(new URL("../src/lib/praxist/container-runner.py",import.meta.url)),
  ],{encoding:"utf8",windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/Real child process finalization ordering passed/);
});
