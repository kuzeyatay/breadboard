// The two structures a language model produces in a Bolt Slides run: the plan
// for the deck, and the source of the deck.
//
// Nothing the model returns reaches the workspace until it has passed through
// here, and the constraints are not decoration. The bundled skill has three
// hard rules — leave the engine alone, author rather than reskin, add no new
// dependencies — and two of those are checkable from the source alone. A file
// that imports a package the clone does not have builds for ninety seconds and
// then fails on a module resolution error; catching it here turns that into a
// repair request the model can answer in one round trip.
//
// The import allowlist does a second job. `App.tsx` is written by a model and
// then executed by a bundler on this machine, so an import is the one place a
// run could reach outside the deck. Restricting it to React, Framer Motion, and
// paths relative to the workspace means the only code a build can pull in is
// code that was already installed for the clone.

import { z } from "zod";

export type SchemaResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; issues: string[] };

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): SchemaResult<T> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: `${label} did not match its schema.`,
    issues: result.error.issues.slice(0, 8).map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    }),
  };
}

/**
 * The packages a deck may import. Everything else in the kit is reached by a
 * relative path, and the clone installs nothing else — `<Globe>` is a
 * hand-built canvas precisely so that stays true.
 */
export const ALLOWED_PACKAGES = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "framer-motion",
]);

/** Every module specifier in a source file: `import … from 'x'` and `import 'x'`. */
export function importSpecifiers(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:^|\n)\s*import\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) found.push(match[1]);
  return found;
}

function checkImports(
  source: string,
  context: z.RefinementCtx,
  path: (string | number)[],
): void {
  for (const specifier of importSpecifiers(source)) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) continue;
    if (ALLOWED_PACKAGES.has(specifier)) continue;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        `imports '${specifier}', which is not installed. A deck adds no dependencies: `
        + `use React, framer-motion, and the kit's own components by relative path.`,
      path,
    });
  }
}

const slidePlanSchema = z.object({
  /** The label the thumbnail rail shows, so `nav="…"` has something to say. */
  nav: z.string().trim().min(1).max(40),
  /** The kit component this slide is built on, or `Slide` for plain JSX. */
  component: z.string().trim().min(1).max(40),
  /** The one thing the slide says, as the audience reads it. */
  headline: z.string().trim().min(1).max(200),
  /** Why the slide is in the deck at all — the entry condition, in one line. */
  purpose: z.string().trim().max(300).default(""),
  notes: z.string().trim().max(600).default(""),
});

export const deckPlanSchema = z.object({
  /** The deck's real title — also the browser tab, so no placeholder survives. */
  title: z.string().trim().min(2).max(120),
  subtitle: z.string().trim().max(200).default(""),
  /** An emoji for the favicon, chosen for the topic. */
  faviconEmoji: z.string().trim().min(1).max(8),
  /** Which of the skill's theme families this deck dresses in. */
  themeFamily: z.string().trim().min(2).max(60),
  themeRationale: z.string().trim().max(400).default(""),
  /** The story the deck tells, in one sentence — shown on the run card. */
  arc: z.string().trim().max(400).default(""),
  slides: z.array(slidePlanSchema).min(3).max(30),
});

export type DeckPlan = z.infer<typeof deckPlanSchema>;
export type SlidePlan = DeckPlan["slides"][number];

const authoredComponentSchema = z.object({
  /** A React component name; it becomes `src/authored/<name>.tsx`. */
  name: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Za-z0-9]{0,39}$/, "a component name is CapitalCase, letters and digits"),
  source: z.string().min(20).max(40_000),
});

export const deckSourceSchema = z
  .object({
    /**
     * The whole of `src/App.tsx`. One file rather than a patch: the deck is
     * authored from scratch every run, so there is no earlier version to
     * reconcile against, and a partial edit would leave starter slides behind.
     */
    appTsx: z.string().min(200).max(400_000),
    /**
     * The body of the `:root` block in `tokens.css` — declarations only, no
     * selector and no braces. The skill's rule is that theming changes values
     * and never variable names, and a body keeps that structurally true.
     */
    tokensRoot: z.string().min(20).max(20_000),
    /** Font `@import` lines prepended to `base.css`, when the theme needs them. */
    fontImport: z.string().trim().max(600).default(""),
    indexTitle: z.string().trim().min(2).max(120),
    faviconEmoji: z.string().trim().min(1).max(8),
    /** New components the topic needed and the kit did not have. */
    components: z.array(authoredComponentSchema).max(8).default([]),
    /** What was built and why, for the message the turn saves. */
    summary: z.string().trim().min(20).max(4_000),
  })
  .superRefine((deck, context) => {
    if (!/<Deck[\s>]/.test(deck.appTsx)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "App.tsx must render a <Deck> whose children are the slides",
        path: ["appTsx"],
      });
    }
    if (!/export default/.test(deck.appTsx)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "App.tsx must default-export the deck component",
        path: ["appTsx"],
      });
    }
    // `main.tsx` renders `<App />` from './App', so an App that took props
    // would render with none of them and the deck would come up empty.
    if (/export default function App\s*\(\s*\{/.test(deck.appTsx)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "App takes no props — main.tsx renders it as <App />",
        path: ["appTsx"],
      });
    }
    checkImports(deck.appTsx, context, ["appTsx"]);
    if (/[{}]/.test(deck.tokensRoot.replace(/\/\*[\s\S]*?\*\//g, ""))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tokensRoot is declarations only — no `:root` selector and no braces",
        path: ["tokensRoot"],
      });
    }
    const names = new Set<string>();
    deck.components.forEach((component, index) => {
      if (names.has(component.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "two authored components share a name",
          path: ["components", index, "name"],
        });
      }
      names.add(component.name);
      checkImports(component.source, context, ["components", index, "source"]);
    });
  });

export type DeckSource = z.infer<typeof deckSourceSchema>;
