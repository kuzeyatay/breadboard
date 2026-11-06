// Test-only staging overlay, so concurrent production builds see a frozen tree.
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stage = path.join(root, ".tmp/self-repair-staging");
const stagedMode = process.env.BREADBOARD_TEST_REPAIR_STAGE === "1";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export default undefined", shortCircuit: true };
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  let candidate = specifier.startsWith("file:") ? fileURLToPath(specifier) : specifier.startsWith("@/") ? path.join(root, "dashboard/src", specifier.slice(2)) :
    specifier.startsWith(".") && context.parentURL?.startsWith("file:") ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier) : null;
  if (candidate) {
    if (candidate.startsWith(stage + path.sep)) candidate = path.join(root, path.relative(stage, candidate));
    const staged = path.join(stage, path.relative(root, candidate));
    const file = [...(stagedMode ? [staged, staged + ".ts"] : []), candidate, candidate + ".ts"].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true, ...(file.endsWith(".ts") ? { format: "module-typescript" } : {}) };
  }
  return nextResolve(specifier, context);
} });
