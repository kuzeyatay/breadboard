/**
 * Resolve the dashboard's `@/` path alias for QA harness scripts.
 *
 * Next.js resolves `@/x` to `dashboard/src/x` through tsconfig paths. Node does
 * not, so a harness that imports a component module directly cannot load it.
 * The alternative — reimplementing the module's exports in the harness — is
 * exactly what these arbitrations exist to avoid, so the alias is taught to
 * Node instead and the executed code stays the real product module.
 *
 * This maps names only. It does not transform source, so nothing about the
 * module's behaviour changes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const dashboardRoot = process.env.W23E_DASHBOARD_ROOT ?? process.cwd();

/** Aliased specifiers are usually written without an extension. */
const CANDIDATES = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

function firstExisting(base) {
  for (const suffix of CANDIDATES) {
    const candidate = `${base}${suffix}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(dashboardRoot, "src", specifier.slice(2));
      const found = firstExisting(base);
      if (found) return nextResolve(pathToFileURL(found).href, context);
    }
    return nextResolve(specifier, context);
  },
});
