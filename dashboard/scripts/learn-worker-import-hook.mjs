import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sourceRepairRelease } from "./source-repair-release.mjs";

const dashboardRoot = path.resolve(process.cwd());
const originalSourceRoot = path.resolve(
  process.env.BREADBOARD_LEARN_SOURCE_ROOT?.trim() || path.join(dashboardRoot, "src"),
);
const release = await sourceRepairRelease();
const sourceRoot = release ? path.join(release.root, "dashboard", "src") : originalSourceRoot;
if (release) {
  process.env.BREADBOARD_SOURCE_RELEASE_ID = release.id;
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
}
const emptyServerOnly = "data:text/javascript,export%20default%20undefined";

function sourceCandidate(base) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
    path.join(base, "index.mjs"),
    path.join(base, "index.cjs"),
  ];
  return (
    candidates.find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    ) ?? null
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (release && specifier.startsWith("file:")) {
      const target = fileURLToPath(specifier);
      const relative = path.relative(originalSourceRoot, target);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        const candidate = sourceCandidate(path.join(sourceRoot, relative));
        if (candidate) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    if (specifier === "server-only") {
      return { url: emptyServerOnly, shortCircuit: true };
    }
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }
    if (specifier.startsWith("@/")) {
      const aliasBase = path.resolve(sourceRoot, specifier.slice(2));
      const relativeAlias = path.relative(sourceRoot, aliasBase);
      if (relativeAlias.startsWith("..") || path.isAbsolute(relativeAlias)) {
        throw new Error(`Learn worker import alias escapes dashboard/src: ${specifier}`);
      }
      const candidate = sourceCandidate(aliasBase);
      if (candidate) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:")
    ) {
      const parentPath = fileURLToPath(context.parentURL);
      const candidate = sourceCandidate(
        path.resolve(path.dirname(parentPath), specifier),
      );
      if (candidate) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
