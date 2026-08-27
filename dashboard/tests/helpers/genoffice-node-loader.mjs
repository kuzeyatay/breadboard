import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const sourceRelativeDashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
// esbuild integration fixtures may inline this loader into a generated file
// under dashboard/tests. Keep the hook anchored to the dashboard source tree
// in both its ordinary module location and that bundled test location.
const dashboardRoot = fs.existsSync(path.join(sourceRelativeDashboardRoot, "src", "vendor", "genoffice"))
  ? sourceRelativeDashboardRoot
  : path.resolve(process.cwd());
const vendorRoot = path.join(dashboardRoot, "src", "vendor", "genoffice");

function firstTypeScriptFile(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@genoffice/")) {
      const [packageName, ...subpath] = specifier.slice("@genoffice/".length).split("/");
      const base = path.join(vendorRoot, packageName, "src", ...subpath);
      const resolved = firstTypeScriptFile(
        subpath.length > 0 ? [`${base}.ts`, path.join(base, "index.ts")] : [path.join(base, "index.ts")],
      );
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }

    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
      const parentPath = fileURLToPath(context.parentURL);
      if (parentPath.startsWith(vendorRoot) && path.extname(specifier) === "") {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        const resolved = firstTypeScriptFile([`${base}.ts`, path.join(base, "index.ts")]);
        if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(pathToFileURL(vendorRoot).href) && url.endsWith(".ts")) {
      const source = fs.readFileSync(fileURLToPath(url), "utf8");
      const output = ts.transpileModule(source, {
        fileName: fileURLToPath(url),
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          verbatimModuleSyntax: true,
        },
      });
      return { format: "module", source: output.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
