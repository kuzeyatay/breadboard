// Vendors Buzz's global stylesheets into one sheet scoped under `.buzz-root`.
//
// Buzz names its design tokens the way shadcn does — `--background`,
// `--border`, `--primary` — and Breadboard's own paper palette does not. Left
// at `:root` the two would overwrite each other, so every selector is rewritten
// to sit under the page's own scope class instead of the document root.
//
// A PostCSS pass rather than a search-and-replace: selectors like
// `:root[data-buzz-sidebar].dark [data-testid="app-sidebar"]` have to keep
// their compound structure, and only an AST walk gets that right reliably.

import { readFileSync, writeFileSync } from "node:fs";
import postcss from "postcss";

const SCOPE = ".buzz-root";

// The order Buzz imports them in; tokens before the rules that consume them.
const SHEETS = [
  "scrollbars",
  "motion",
  "animations",
  "composer",
  "markdown",
  "theme",
  "typography",
  "skeleton",
  "spoilers",
  "components",
  "terminal",
  "utilities",
  "media-controls",
  "avatar-framing",
  "image-lightbox",
  "video-review",
  "progress",
];

/** Rewrite one comma-free selector so it applies only inside the scope. */
function scopeSelector(selector) {
  let s = selector.trim();
  if (!s) return s;
  // Already ours (hand-written additions, or a second pass).
  if (s.startsWith(SCOPE)) return s;

  // `:root`, `html` and `body` all mean "the themed element" here, which is
  // the page wrapper rather than the document.
  s = s.replace(/^:root\b/, SCOPE);
  s = s.replace(/^html\b/, SCOPE);
  s = s.replace(/^body\b/, SCOPE);
  if (s.startsWith(SCOPE)) return s;

  // A leading `.dark` is Buzz's theme class on the root element. It becomes a
  // compound with the scope so it keeps selecting the same element.
  if (/^\.dark\b/.test(s)) return SCOPE + s;

  // `:where(...)` and everything else becomes a descendant of the scope.
  return `${SCOPE} ${s}`;
}

function scopeRule(rule) {
  rule.selectors = rule.selectors.map(scopeSelector);
}

/*
 * Two of Buzz's token names are already claimed by Breadboard's own
 * `@theme inline` block: `--background` and `--foreground`. Breadboard maps
 * them straight through (`--color-background: var(--background)`) while Buzz
 * stores bare HSL components for `hsl()` to wrap, so sharing the names would
 * hand Tailwind `220 23.08% 94.9%` as a color and break both themes at once.
 * Every other Buzz token is unclaimed and keeps its upstream name.
 *
 * `--card-foreground` and `--sidebar-background` are untouched by these
 * replacements: the patterns start at the leading `--`, which those compound
 * names do not have in front of the colliding word.
 */
const RENAMED_TOKENS = [
  ["--background", "--buzz-background"],
  ["--foreground", "--buzz-foreground"],
];

/*
 * Buzz resolves a handful of `@apply` rules against its own tailwind.config.js
 * — `text-message`, `text-nsec-key`, `border-border`. This sheet is imported
 * on its own, where Tailwind has no theme to resolve them from, and two of
 * them name the very tokens that were renamed above. Expanding them to plain
 * CSS is both the fix and an improvement: the vendored sheet stops depending
 * on utility resolution altogether, so it cannot break again when either
 * project's Tailwind config moves.
 */
const APPLY_EXPANSIONS = [
  [
    "@apply text-message font-normal tracking-normal;",
    `font-size: var(--conversation-message-font-size);
  line-height: var(--conversation-message-line-height);
  font-weight: 400;
  letter-spacing: 0;`,
  ],
  ["@apply border-border;", "border-color: hsl(var(--border));"],
  [
    "@apply bg-background text-foreground antialiased;",
    `background-color: hsl(var(--buzz-background));
    color: hsl(var(--buzz-foreground));
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;`,
  ],
  [
    "@apply w-full break-all [overflow-wrap:anywhere] font-mono text-nsec-key;",
    `width: 100%;
    word-break: break-all;
    overflow-wrap: anywhere;
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: calc(var(--buzz-type-rem) * 2.25);
    line-height: 1.3;`,
  ],
];

/*
 * Buzz's own components — and the shadcn primitives vendored alongside them —
 * are written against `bg-background` and `text-foreground`. Renaming the two
 * colliding tokens above kept the palettes apart, but it also left those 29
 * utility usages resolving to Breadboard's `--background` / `--foreground`,
 * which are not defined inside `.buzz-root`. The result was text and button
 * fills with no colour at all.
 *
 * So the two names are given back inside the scope, as finished colours rather
 * than the bare HSL components Buzz stores. Breadboard maps them straight
 * through (`--color-background: var(--background)`), so `bg-background` now
 * resolves to Buzz's background on the Buzz page and to paper everywhere else,
 * with neither sheet overwriting the other.
 */
const SCOPE_TOKEN_ALIASES = `
/* Added by scripts/vendor-buzz-css.mjs — see SCOPE_TOKEN_ALIASES. */
.buzz-root {
  --background: hsl(var(--buzz-background));
  --foreground: hsl(var(--buzz-foreground));
}
`;

function expandApply(css) {
  let out = css;
  for (const [from, to] of APPLY_EXPANSIONS) {
    out = out.split(from).join(to);
  }
  if (out.includes("@apply ")) {
    throw new Error(
      "An @apply rule appeared that this script does not expand: " +
        (out.match(/@apply [^;]*;/) ?? [""])[0],
    );
  }
  return out;
}

function renameTokens(css) {
  let out = css;
  for (const [from, to] of RENAMED_TOKENS) {
    out = out.split(from).join(to);
  }
  return out;
}

const plugin = {
  postcssPlugin: "scope-buzz",
  Once(root) {
    root.walkRules((rule) => {
      // Keyframe steps (`from`, `to`, `50%`) are not selectors.
      const parent = rule.parent;
      if (parent && parent.type === "atrule" && /keyframes$/i.test(parent.name)) {
        return;
      }
      // Nested rules inside another rule are already scoped by their ancestor.
      if (parent && parent.type === "rule") return;
      scopeRule(rule);
    });
  },
};

const HEADER = `/*
 * Buzz's visual system, vendored from block/buzz (Apache-2.0) and rewritten to
 * live under \`.buzz-root\` instead of the document root.
 *
 * Source: desktop/src/shared/styles/globals/*.css, snapshotted in
 * scripts/buzz-upstream-css/. Generated by scripts/vendor-buzz-css.mjs — edit
 * that script and re-run it rather than editing this file, so a refresh from
 * upstream stays mechanical.
 *
 * Why scoped: Buzz names its tokens the way shadcn does and Breadboard's paper
 * palette does not. At \`:root\` the two sheets would overwrite each other on
 * every page; under \`.buzz-root\` they coexist and only Buzz pays for Buzz.
 */

`;

const parts = [HEADER];
for (const name of SHEETS) {
  const css = readFileSync(`scripts/buzz-upstream-css/${name}.css`, "utf8");
  const scoped = postcss([plugin]).process(css, { from: `scripts/buzz-upstream-css/${name}.css` }).css;
  const out = expandApply(renameTokens(scoped));
  parts.push(`/* ── ${name}.css ─────────────────────────────────────────── */\n${out}`);
}

writeFileSync(
  "src/app/buzz/buzz-theme.css",
  `${parts.join("\n\n")}\n${SCOPE_TOKEN_ALIASES}`,
  "utf8",
);
console.log("wrote src/app/buzz/buzz-theme.css", readFileSync("src/app/buzz/buzz-theme.css", "utf8").length, "bytes");
