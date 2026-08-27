// Writing an authored deck into its workspace.
//
// Four files change and nothing else, which is the skill's first hard rule made
// mechanical: `src/App.tsx` is the deck, the `:root` block of `tokens.css` is
// its theme (merged token by token, never replaced), `base.css` gains at most
// an `@import` for the theme's fonts, and `index.html` gets the deck's real
// title and favicon. The engine in
// `src/deck/` and the component library are copies of the clone and are never
// touched, so a model cannot rewrite the chrome by accident or on purpose.
//
// The one addition Breadboard makes to `index.html` is a BroadcastChannel
// guard. The deck opens a channel to keep a presenter tab in sync, unguarded,
// and the inline preview runs the deck in a sandboxed frame with an opaque
// origin — where constructing one throws in some browsers and takes the whole
// deck down at mount. The shim is three lines in the page shell rather than an
// edit to `src/deck/Deck.tsx`, so presenter sync still works everywhere it can:
// in the deck's own tab, where the origin is real, the native class is kept.

import fs from "node:fs";
import path from "node:path";
import type { DeckSource } from "./schemas.ts";
import {
  appSourcePath,
  appSourcePathAt,
  authoredDirectory,
  authoredDirectoryAt,
  baseStylesPath,
  baseStylesPathAt,
  indexHtmlPath,
  indexHtmlPathAt,
  tokensPath,
  tokensPathAt,
} from "./workspace.ts";

/**
 * A no-op BroadcastChannel for frames whose origin is opaque.
 *
 * Only installed when constructing a real one throws, so nothing changes for
 * the deck opened in its own tab — which is where presenter mode is used.
 */
const CHANNEL_SHIM = [
  "    <script>",
  "      // A sandboxed preview has an opaque origin, where BroadcastChannel can",
  "      // throw. Presenter sync is unavailable there; the deck still runs.",
  "      try { new BroadcastChannel('probe').close(); } catch (e) {",
  "        window.BroadcastChannel = function () {",
  "          return { name: '', onmessage: null, onmessageerror: null,",
  "            postMessage: function () {}, close: function () {},",
  "            addEventListener: function () {}, removeEventListener: function () {},",
  "            dispatchEvent: function () { return false; } };",
  "        };",
  "      }",
  "    </script>",
].join("\n");

function faviconLink(emoji: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`
    + `<text y=".9em" font-size="90">${emoji}</text></svg>`;
  return `    <link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}" />`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** `--primary: #ff7a45;` → `["--primary", "#ff7a45"]`, comments discarded. */
function parseDeclarations(text: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const chunk of text.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const name = trimmed.slice(0, colon).trim();
    if (!name.startsWith("--")) continue;
    found.push([name, trimmed.slice(colon + 1).replace(/\s+/g, " ").trim()]);
  }
  return found;
}

/**
 * Apply the theme's declarations over the `:root` block, one token at a time.
 *
 * Merging rather than replacing, because the alternative fails silently and
 * badly. A model that returns four colours and nothing else is describing a
 * theme, not asking for `--accent`, `--gutter` and `--radius` to be deleted —
 * but a wholesale replacement deletes them, and the deck that comes back has
 * transparent figures and no spacing rather than an error anybody can see. A
 * complete theme still wins completely; a partial one changes exactly what it
 * names. The clone's own comments and grouping survive either way.
 */
function mergeRootBlock(css: string, declarations: string): string {
  const overrides = parseDeclarations(declarations);
  if (!overrides.length) return css;
  const start = css.indexOf(":root");
  const open = start < 0 ? -1 : css.indexOf("{", start);
  if (open < 0) {
    const body = overrides.map(([name, value]) => `  ${name}: ${value};`).join("\n");
    return `:root {\n${body}\n}\n${css}`;
  }
  let depth = 1;
  let cursor = open + 1;
  while (cursor < css.length && depth > 0) {
    if (css[cursor] === "{") depth += 1;
    else if (css[cursor] === "}") depth -= 1;
    cursor += 1;
  }
  const closing = cursor - 1;
  let block = css.slice(open + 1, closing);
  const added: string[] = [];
  for (const [name, value] of overrides) {
    // `--bg` must not match `--bg-grad-1`, so the colon is part of the pattern.
    const pattern = new RegExp(`(^|[\\s;])${name.replace(/-/g, "\\-")}\\s*:[^;]*;`, "m");
    if (pattern.test(block)) {
      block = block.replace(pattern, `$1${name}: ${value};`);
    } else {
      added.push(`  ${name}: ${value};`);
    }
  }
  const tail = added.length ? `\n\n  /* Added by this deck's theme */\n${added.join("\n")}\n` : "";
  return `${css.slice(0, open + 1)}${block}${tail}${css.slice(closing)}`;
}

/**
 * Set the page title and favicon, and install the channel guard.
 *
 * The favicon `<link>` is replaced wholesale rather than edited: the clone
 * writes it as an inline SVG data URI across several lines, and swapping one
 * emoji inside that with a regex is exactly the kind of edit that silently
 * matches nothing.
 */
function rewriteIndexHtml(html: string, deck: DeckSource): string {
  let next = html.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtml(deck.indexTitle)}</title>`,
  );
  next = next.replace(/[ \t]*<link\s+rel="icon"[\s\S]*?\/>\s*\n/i, `${faviconLink(deck.faviconEmoji)}\n`);
  if (!/rel="icon"/i.test(next)) {
    next = next.replace(/<\/head>/i, `${faviconLink(deck.faviconEmoji)}\n  </head>`);
  }
  if (!next.includes("BroadcastChannel")) {
    next = next.replace(/<\/head>/i, `${CHANNEL_SHIM}\n  </head>`);
  }
  return next;
}

export interface AppliedDeck {
  /** Paths written, relative to the workspace, for the run's log. */
  written: string[];
}

export function applyDeckSource(runId: string, deck: DeckSource): AppliedDeck {
  return applyDeckSourceToPaths(deck, {
    app: appSourcePath(runId),
    authored: authoredDirectory(runId),
    base: baseStylesPath(runId),
    index: indexHtmlPath(runId),
    tokens: tokensPath(runId),
  });
}

/** Apply source only inside the exact attempt workspace selected by Runtime. */
export function applyDeckSourceAt(workspaceRoot: string, deck: DeckSource): AppliedDeck {
  return applyDeckSourceToPaths(deck, {
    app: appSourcePathAt(workspaceRoot),
    authored: authoredDirectoryAt(workspaceRoot),
    base: baseStylesPathAt(workspaceRoot),
    index: indexHtmlPathAt(workspaceRoot),
    tokens: tokensPathAt(workspaceRoot),
  });
}

function applyDeckSourceToPaths(
  deck: DeckSource,
  files: { app: string; authored: string; base: string; index: string; tokens: string },
): AppliedDeck {
  const written: string[] = [];

  fs.writeFileSync(files.app, `${deck.appTsx.replace(/\s*$/, "")}\n`, "utf8");
  written.push("src/App.tsx");

  const tokens = fs.readFileSync(files.tokens, "utf8");
  fs.writeFileSync(files.tokens, mergeRootBlock(tokens, deck.tokensRoot), "utf8");
  written.push("src/styles/tokens.css");

  const fontImport = deck.fontImport.trim();
  if (fontImport) {
    const base = fs.readFileSync(files.base, "utf8");
    // `@import` is only valid before any other rule, so it goes at the very top
    // — which is also where the clone keeps its own.
    fs.writeFileSync(files.base, `${fontImport}\n${base}`, "utf8");
    written.push("src/styles/base.css");
  }

  const html = fs.readFileSync(files.index, "utf8");
  fs.writeFileSync(files.index, rewriteIndexHtml(html, deck), "utf8");
  written.push("index.html");

  if (deck.components.length) {
    fs.mkdirSync(files.authored, { recursive: true });
    for (const component of deck.components) {
      fs.writeFileSync(
        path.join(files.authored, `${component.name}.tsx`),
        `${component.source.replace(/\s*$/, "")}\n`,
        "utf8",
      );
      written.push(`src/authored/${component.name}.tsx`);
    }
  }

  return { written };
}
