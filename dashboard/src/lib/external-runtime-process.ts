type NodeChildProcess = typeof import("node:child_process");

// These executables belong to separately provisioned services. As with runtime
// filesystem access, keep their dynamic paths out of Next's deployment trace.
// A turbopackIgnore argument comment does not suppress spawn's asset tracing.
function loadRuntimeProcess(): NodeChildProcess {
  const getBuiltinModule = Reflect.get(process, "getBuiltinModule");
  if (typeof getBuiltinModule !== "function") {
    throw new Error("This Breadboard runtime does not expose Node builtin modules.");
  }
  const childProcess = Reflect.apply(getBuiltinModule, process, ["node:child_process"]) as
    | NodeChildProcess
    | undefined;
  if (!childProcess) throw new Error("The Node child_process builtin is unavailable.");
  return childProcess;
}

const runtimeProcess = loadRuntimeProcess();
export const externalRuntimeSpawn: NodeChildProcess["spawn"] = runtimeProcess.spawn;
export const externalRuntimeSpawnSync: NodeChildProcess["spawnSync"] = runtimeProcess.spawnSync;
