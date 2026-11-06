import path from "node:path";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
const root = path.resolve(process.env.BREADBOARD_REPAIR_TEST_SOURCE);
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export default undefined", shortCircuit: true };
  const base = specifier.startsWith("@/") ? path.resolve(root, specifier.slice(2)) :
    /^(\.\/|\.\.\/)/.test(specifier) && context.parentURL?.startsWith("file:")
      ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier) : null;
  if (specifier.startsWith("@/") && (!base.startsWith(root + path.sep) || path.isAbsolute(path.relative(root, base)))) throw new Error("Repair test alias escapes source.");
  if (base) {
    const file = [base, `${base}.ts`, `${base}.js`, path.join(base, "index.ts")]
      .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true, ...(file.endsWith(".ts") ? { format: "module-typescript" } : {}) };
  }
  return nextResolve(specifier, context);
} });
