import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

// Some existing libraries open the default database when imported even though
// their tests pass a separate fixture. Isolate that connection and every child
// process's temporary files as well as the explicit fixtures.
const base=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(base,"breadboard-storage-validation-"));
const temporary=path.join(root,"temp");fs.mkdirSync(temporary);
const files=["storage-management","workspace-storage","storage-desktop","storage-settings-browser","storage-compaction-boundary","learn-workspace-superseded-prune",
  "learn-build-pipeline","artifact-transcript","hermes-artifact-search","source-pdf-response",
  "agent-conversation-context","conversation-branches","conversation-memory","conversation-message-context","hyperframes-delivery"];
try {
  const child=spawn(process.execPath,["--test",...files.map(file=>`tests/${file}.test.mjs`)],{
    cwd:path.resolve(import.meta.dirname,".."),windowsHide:true,stdio:"inherit",
    env:{...process.env,BREADBOARD_DATA_DIR:path.join(root,"Data"),TEMP:temporary,TMP:temporary},
  });
  process.exitCode=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",code=>resolve(code??1));});
} finally {
  const resolved=path.resolve(root);
  if(path.dirname(resolved)!==base || !path.basename(resolved).startsWith("breadboard-storage-validation-"))throw new Error("Invalid test cleanup root");
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
