// Close the staged Quartz template over the repository files it imports.
//
// In the checkout, Quartz components import shared Breadboard modules through
// relative paths that leave the template (`../../../../dashboard/src/lib/...`,
// `shared/visualization-renderers.json`, stylesheets via `@use`). Installed,
// the template lives at app-services/quartz-template with no dashboard source
// beside it, so every garden build failed with "Could not resolve" while
// development worked. Hand-listing those imports went stale as soon as a new
// one was added (0.1.15 shipped twelve unresolved), so this follows them all.
//
// Each escaping file is mirrored under quartz/external/<repository path>, so
// relative imports between mirrored files keep their exact spelling, and the
// template's own specifiers are rewritten to the mirror.
import fs from "node:fs";
import path from "node:path";

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx|scss|sass|css)$/iu;
// `from "x"`, `import "x"`, `import("x")`, `export ... from "x"`, and Sass/CSS
// `@use` / `@forward` / `@import`.
const SPECIFIER =
  /(\bfrom\s*|\bimport\s*\(?\s*|@use\s+|@forward\s+|@import\s+)(["'])(\.{1,2}\/[^"']*)\2/gu;
const RESOLVE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".mjs",
  ".jsx",
  ".json",
  ".scss",
  ".css",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

function resolveSourceFile(absolute) {
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${absolute}${suffix}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  // Sass partials: `@use "dir/name"` may mean dir/_name.scss.
  const partial = path.join(path.dirname(absolute), `_${path.basename(absolute)}`);
  for (const suffix of [".scss", ".sass"]) {
    if (fs.existsSync(`${partial}${suffix}`)) return `${partial}${suffix}`;
  }
  return null;
}

function listSourceFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && SOURCE_FILE.test(entry.name)) files.push(full);
    }
  };
  walk(root);
  return files;
}

/**
 * @param {{ repoRoot: string, templateSource: string, templateTarget: string }} options
 *   templateSource is the checkout's quartz directory; templateTarget is its
 *   already-copied staged twin.
 * @returns {string[]} repository-relative files mirrored into the template.
 */
export function closeQuartzTemplateImports({ repoRoot, templateSource, templateTarget }) {
  const mirrorRoot = path.join(templateTarget, "quartz", "external");
  const mirrored = new Map(); // repository source file -> staged mirror
  // Staged file -> the checkout path its relative specifiers were written against.
  const queue = listSourceFiles(templateTarget)
    .filter((file) => !inside(mirrorRoot, file))
    .map((file) => [file, path.join(templateSource, path.relative(templateTarget, file))]);
  // Where the staged tree holds a checkout path.
  const stagedPathFor = (absolute) => {
    if (inside(templateSource, absolute)) {
      return path.join(templateTarget, path.relative(templateSource, absolute));
    }
    if (!inside(repoRoot, absolute)) {
      throw new Error(`Quartz imports a file outside the repository: ${absolute}`);
    }
    return path.join(mirrorRoot, path.relative(repoRoot, absolute));
  };
  while (queue.length) {
    const [staged, original] = queue.shift();
    // Mirrored data (JSON) is copied but has no imports of its own.
    if (!SOURCE_FILE.test(staged)) continue;
    const text = fs.readFileSync(staged, "utf8");
    let changed = false;
    const rewritten = text.replace(SPECIFIER, (whole, lead, quote, specifier) => {
      const target = path.resolve(path.dirname(original), specifier);
      if (inside(templateSource, target) && !inside(mirrorRoot, staged)) {
        return whole; // ordinary template-internal import
      }
      if (inside(templateSource, target)) {
        // A mirrored file importing back into the template.
        const back = path.relative(path.dirname(staged), stagedPathFor(target)).split(path.sep).join("/");
        changed = true;
        return `${lead}${quote}${back.startsWith(".") ? back : `./${back}`}${quote}`;
      }
      const source = resolveSourceFile(target);
      if (!source) {
        throw new Error(`Quartz import ${specifier} in ${original} does not resolve in the checkout.`);
      }
      const mirror = stagedPathFor(source);
      if (!mirrored.has(source)) {
        fs.mkdirSync(path.dirname(mirror), { recursive: true });
        fs.copyFileSync(source, mirror);
        mirrored.set(source, mirror);
        queue.push([mirror, source]);
      }
      // Mirror the specifier itself, so an extensionless or directory import
      // resolves to the same file the checkout resolves.
      let next = path.relative(path.dirname(staged), stagedPathFor(target)).split(path.sep).join("/");
      if (!next.startsWith(".")) next = `./${next}`;
      if (specifier.endsWith("/") && !next.endsWith("/")) next = `${next}/`;
      if (next !== specifier) changed = true;
      return `${lead}${quote}${next}${quote}`;
    });
    if (changed) fs.writeFileSync(staged, rewritten);
  }
  // Nothing in the staged template may still point outside it.
  for (const file of listSourceFiles(templateTarget)) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(SPECIFIER)) {
      const target = path.resolve(path.dirname(file), match[3]);
      if (!inside(templateTarget, target)) {
        throw new Error(`Staged Quartz still imports outside its template: ${match[3]} in ${file}`);
      }
    }
  }
  return [...mirrored.keys()].map((file) => path.relative(repoRoot, file).split(path.sep).join("/")).sort();
}
