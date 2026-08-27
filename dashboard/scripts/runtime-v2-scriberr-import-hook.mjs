import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceRoot = path.resolve(process.env.BREADBOARD_SCRIBERR_SOURCE_ROOT ?? "");
const emptyServerOnly = "data:text/javascript,export%20default%20undefined";

function sourceCandidate(base) {
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
  ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: emptyServerOnly, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const candidateBase = path.resolve(sourceRoot, specifier.slice(2));
      const relative = path.relative(sourceRoot, candidateBase);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Scriberr worker import alias escaped its staged source root.");
      }
      const candidate = sourceCandidate(candidateBase);
      if (candidate) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:")
    ) {
      const parent = fileURLToPath(context.parentURL);
      const candidate = sourceCandidate(path.resolve(path.dirname(parent), specifier));
      if (candidate) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
