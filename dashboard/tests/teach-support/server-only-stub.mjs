// Makes the dashboard's server modules importable by `node --test`.
//
// Two things Next.js resolves that plain Node does not:
//
//   `server-only`  a build-time marker that keeps a server module out of a
//                  client bundle. It has no runtime behaviour worth keeping in
//                  a test, so it resolves to an empty module -- the guard stays
//                  on the real build.
//
//   `@/…`          the repo's path alias for `dashboard/src`, declared in
//                  tsconfig. Without it, importing any module that uses the
//                  alias fails, which is why so much of `src/lib` has to be
//                  written with relative imports to stay testable at all.

import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      url: new URL("./empty-module.mjs", import.meta.url).href,
      shortCircuit: true,
      format: "module",
    };
  }

  if (specifier.startsWith("@/")) {
    const target = path.join(SOURCE_ROOT, specifier.slice(2));
    // The alias is written without an extension in most of the repo; TypeScript
    // fills it in, so this has to as well.
    for (const candidate of [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")]) {
      try {
        const { existsSync, statSync } = await import("node:fs");
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true, format: "module" };
        }
      } catch {
        // Fall through to the next candidate.
      }
    }
  }

  return nextResolve(specifier, context);
}
