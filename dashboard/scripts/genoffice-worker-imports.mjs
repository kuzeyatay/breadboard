import fs from "node:fs";
import path from "node:path";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The vendored editor uses bundler aliases/extensionless TS imports. Workers
 * run outside Next and must resolve that same source closure themselves. */
export function registerGenofficeWorkerImports(sourceRoot) {
  const root = path.resolve(sourceRoot, "vendor", "genoffice");
  const inside = (candidate) => {
    const relative = path.relative(root, candidate);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const candidate = (base) => [base, `${base}.ts`, path.join(base, "index.ts")]
    .find((file) => inside(file) && fs.existsSync(file) && fs.statSync(file).isFile());
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL?.startsWith("file:") ? fileURLToPath(context.parentURL) : null;
      if (specifier.startsWith("@genoffice/")) {
        const [name, ...rest] = specifier.slice("@genoffice/".length).split("/");
        const target = candidate(path.join(root, name, "src", ...rest));
        if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
      } else if (parent && inside(parent) && specifier.startsWith(".")) {
        const target = candidate(path.resolve(path.dirname(parent), specifier));
        if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith("file:") && url.endsWith(".ts") && inside(fileURLToPath(url))) {
        return { format: "module", source: stripTypeScriptTypes(fs.readFileSync(fileURLToPath(url), "utf8"), { mode: "transform", sourceUrl: url }), shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}
