type NodePath = typeof import("node:path");

// Turbopack's native asset tracer creates a filesystem reference for every
// statically recognized node:path join/resolve expression, even when the
// eventual filesystem call is already opaque. Runtime V2 paths point at
// mutable data and separately staged services, never Next deployment assets.
// Resolve the one fixed builtin through the same closed runtime authority used
// by external-runtime-filesystem so those paths retain real Node semantics
// without becoming standalone trace inputs.
function loadRuntimePath(): NodePath {
  const getBuiltinModule = Reflect.get(process, "getBuiltinModule");
  if (typeof getBuiltinModule !== "function") {
    throw new Error("This Breadboard runtime does not expose Node builtin modules.");
  }
  const runtimePath = Reflect.apply(getBuiltinModule, process, ["node:path"]) as
    | NodePath
    | undefined;
  if (!runtimePath) throw new Error("The Node path builtin is unavailable.");
  return runtimePath;
}

export const externalRuntimePath: NodePath = loadRuntimePath();
