import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const dashboardRoot = path.resolve(process.cwd(), "dashboard");
const sourceRoot = path.join(dashboardRoot, "src");
const emptyServerOnly = "data:text/javascript,export%20default%20undefined";

function sourceCandidate(base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, path.join(base, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: emptyServerOnly, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const candidate = sourceCandidate(path.join(sourceRoot, specifier.slice(2)));
      if (candidate) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const parentPath = new URL(context.parentURL);
      const candidate = sourceCandidate(path.resolve(path.dirname(parentPath.pathname.slice(1)), specifier));
      if (candidate) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
