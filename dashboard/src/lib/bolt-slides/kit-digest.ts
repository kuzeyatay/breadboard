// What the deck author is allowed to compose with, read out of the clone.
//
// The bundled skill describes the component library in prose, and prose is
// exactly the wrong thing to hand a model that has to write `<Split media={…}>`
// and get the prop names right. So the digest is extracted from the source
// instead: for every component in `src/components/` and `src/deck/`, its name,
// the block comment its author wrote above it, and the literal prop type from
// its signature.
//
// Extracting rather than transcribing matters for one reason. The clone is a
// vendored checkout that will be updated, and a hand-written prop list would
// drift from it silently — the failure would arrive as a build error inside a
// run, minutes after the person asked for a deck. A digest read from the files
// is wrong only when the files are.
//
// Every component here is a plain `export default function Name({…}: {…})`, so
// the extraction is a small, deliberate parser rather than a TypeScript pass:
// this is a prompt fragment, and a prop list that is 95% right is worth far
// more than a dependency on the compiler.

import path from "node:path";
import {
  externalRuntimeReadDirectory,
  externalRuntimeReadUtf8,
} from "../external-runtime-filesystem.ts";
import { resolveBoltSlidesRoot } from "./runtime.ts";

export interface KitComponent {
  name: string;
  /** The module it lives in, as `App.tsx` imports it. */
  importPath: string;
  /** True when it is a named export rather than the module's default. */
  named: boolean;
  /** The author's own description, from the block comment above the component. */
  description: string;
  /** The prop type literal from the signature, collapsed onto one line. */
  props: string;
  /** Exported helper types the props refer to, e.g. `Stat`, `Tier`. */
  types: string[];
}

export interface KitDigest {
  components: KitComponent[];
  /** Every `--token` name defined in the `:root` block of `tokens.css`. */
  tokens: string[];
  /** The current `:root { … }` block, verbatim, as the theme's starting point. */
  tokensRoot: string;
  /** Utility and atom class names that `base.css` actually defines. */
  classes: string[];
}

/** Classes the skill calls out as the ones an author composes with directly. */
const ATOM_CLASSES = [
  "display",
  "headline",
  "lead",
  "subhead",
  "kicker",
  "figure",
  "accent-text",
  "rule",
  "cols",
  "container",
  "appmock",
  "hide-narrow",
  "vframe",
  "chip",
  "lift",
];

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** The first block comment in a file, stripped of its asterisks and slashes. */
function leadingComment(source: string): string {
  const match = /\/\*([\s\S]*?)\*\//.exec(source);
  if (!match) return "";
  return collapse(
    match[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\*+\s?/, ""))
      .join(" "),
  );
}

/** The index just past the brace that closes the one at `open`. */
function closeBrace(source: string, open: number): number {
  let depth = 1;
  let cursor = open + 1;
  while (cursor < source.length && depth > 0) {
    if (source[cursor] === "{") depth += 1;
    else if (source[cursor] === "}") depth -= 1;
    cursor += 1;
  }
  return cursor;
}

/**
 * Every exported component in a file, with the prop type literal from its
 * signature — `export default function Cover({…}: { … })`, and the named form
 * the chart module uses.
 *
 * Braces are counted rather than matched with a regex because prop types
 * nest — `stats: Stat[]`, `style?: CSSProperties`, and the occasional inline
 * object all appear — and a lazy match would stop at the first `}`. A component
 * that takes nothing is kept with an empty literal rather than dropped:
 * `VisualDashboard` is real and composable, and silence about it would read as
 * absence.
 */
function signatures(source: string): Array<{ name: string; props: string }> {
  const found: Array<{ name: string; props: string }> = [];
  const pattern = /export\s+(?:default\s+)?function\s+(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const name = match[1];
    const afterParen = match.index + match[0].length;
    const parameterStart = /^\s*\)/.exec(source.slice(afterParen))
      ? -1
      : source.indexOf("{", afterParen);
    if (parameterStart < 0) {
      found.push({ name, props: "{}" });
      continue;
    }
    // Skip the destructuring pattern; the type annotation follows the `:`.
    const afterPattern = closeBrace(source, parameterStart);
    const annotation = /^\s*:\s*\{/.exec(source.slice(afterPattern));
    if (!annotation) {
      found.push({ name, props: "{}" });
      continue;
    }
    const open = afterPattern + annotation[0].length - 1;
    found.push({ name, props: collapse(source.slice(open, closeBrace(source, open))) });
  }
  return found;
}

function exportedTypes(source: string): string[] {
  const types: string[] = [];
  const pattern = /export type\s+\w+\s*=\s*[^;]+;/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) types.push(collapse(match[0]));
  return types;
}

function readComponents(
  root: string,
  directory: string,
  importBase: string,
  only?: readonly string[],
): KitComponent[] {
  const absolute = path.join(root, directory);
  let entries: string[];
  try {
    entries = externalRuntimeReadDirectory(absolute).filter((name) => name.endsWith(".tsx"));
  } catch {
    return [];
  }
  const components: KitComponent[] = [];
  for (const entry of entries.sort()) {
    const moduleName = entry.replace(/\.tsx$/, "");
    if (only && !only.includes(moduleName)) continue;
    const source = externalRuntimeReadUtf8(path.join(absolute, entry));
    const description = leadingComment(source);
    const types = exportedTypes(source);
    for (const signature of signatures(source)) {
      components.push({
        name: signature.name,
        importPath: `${importBase}/${moduleName}`,
        // A module whose component shares its filename is the default export;
        // the chart module exports three, and each of those is named.
        named: signature.name !== moduleName,
        description,
        props: signature.props,
        types,
      });
    }
  }
  return components;
}

function rootBlock(css: string): string {
  const start = css.indexOf(":root");
  if (start < 0) return "";
  const open = css.indexOf("{", start);
  if (open < 0) return "";
  let depth = 1;
  let cursor = open + 1;
  while (cursor < css.length && depth > 0) {
    if (css[cursor] === "{") depth += 1;
    else if (css[cursor] === "}") depth -= 1;
    cursor += 1;
  }
  return css.slice(start, cursor);
}

const digestGlobal = globalThis as typeof globalThis & {
  __breadboardBoltSlidesDigest?: KitDigest | null;
};

/**
 * The whole kit, cached for the process.
 *
 * A checkout does not change between two decks, and this reads about thirty
 * files; re-reading them per run would buy nothing. `forgetKitDigest` exists
 * for the install path, which is the one moment the answer can change.
 */
export function kitDigest(): KitDigest | null {
  if (digestGlobal.__breadboardBoltSlidesDigest !== undefined) {
    return digestGlobal.__breadboardBoltSlidesDigest;
  }
  const root = resolveBoltSlidesRoot();
  if (!root) {
    digestGlobal.__breadboardBoltSlidesDigest = null;
    return null;
  }
  const components = [
    // Only the four the deck author composes with. The rest of `src/deck/` is
    // the chrome — the dock, the rail, the annotator — which the skill's first
    // hard rule puts off limits, so describing it would only invite a rewrite.
    ...readComponents(root, path.join("src", "deck"), "./deck", [
      "Deck",
      "Slide",
      "Build",
      "Reveal",
    ]),
    ...readComponents(root, path.join("src", "components"), "./components"),
  ];
  let tokensRoot = "";
  let tokens: string[] = [];
  try {
    const css = externalRuntimeReadUtf8(path.join(root, "src", "styles", "tokens.css"));
    tokensRoot = rootBlock(css);
    tokens = [...new Set(tokensRoot.match(/--[a-z0-9-]+(?=\s*:)/g) ?? [])];
  } catch {
    // A checkout with no tokens file still authors a deck; it just cannot theme
    // one, and the prompt says so by listing nothing.
  }
  let classes: string[] = [];
  try {
    const base = externalRuntimeReadUtf8(path.join(root, "src", "styles", "base.css"));
    const defined = new Set(
      (base.match(/^\s*\.[a-zA-Z][-a-zA-Z0-9]*/gm) ?? []).map((value) => value.trim().slice(1)),
    );
    classes = ATOM_CLASSES.filter((name) => defined.has(name));
  } catch {
    classes = [];
  }
  const digest: KitDigest = { components, tokens, tokensRoot, classes };
  digestGlobal.__breadboardBoltSlidesDigest = digest;
  return digest;
}

export function forgetKitDigest(): void {
  digestGlobal.__breadboardBoltSlidesDigest = undefined;
}

/** The digest as the prompt sees it: one block per component, name first. */
export function renderKitDigest(digest: KitDigest): string {
  const lines: string[] = [];
  for (const component of digest.components) {
    const specifier = component.named ? `{ ${component.name} }` : component.name;
    lines.push(`### ${component.name}`);
    lines.push(`import ${specifier} from '${component.importPath}';`);
    if (component.description) lines.push(component.description);
    lines.push(`props: ${component.props}`);
    for (const type of component.types) lines.push(type);
    lines.push("");
  }
  return lines.join("\n").trim();
}
