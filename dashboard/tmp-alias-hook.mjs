// Gives a bare Node run the two resolutions the bundler normally provides:
// the "@/*" -> "src/*" tsconfig alias, and extensionless module specifiers.
// Resolution only; it changes no module's behaviour.
import { registerHooks } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.resolve(import.meta.dirname, "src");
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx"];

function firstExistingFile(base) {
  const attempts = [
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  for (const candidate of attempts) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(SRC, specifier.slice(2));
      const resolved =
        fs.existsSync(base) && fs.statSync(base).isFile() ? base : firstExistingFile(base);
      if (!resolved) throw new Error(`Cannot resolve alias ${specifier} under ${SRC}`);
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }

    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) throw error;
      const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : SRC;
      const base = path.resolve(path.dirname(parentPath), specifier);
      const resolved = firstExistingFile(base);
      if (!resolved) throw error;
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  },
});
