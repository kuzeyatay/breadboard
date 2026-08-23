// Bolt Slides: the parts of a deck run that are decided before any model is
// called, and the two boundaries that fail silently when they drift.
//
// The first boundary is the schema. A deck is React source written by a model
// and then compiled by a bundler on this machine, so what the schema refuses is
// load-bearing rather than tidy: an import outside the allowlist is both a
// build that fails ninety seconds later and the one place a run could reach
// code nobody installed.
//
// The second is the event protocol. The run manager emits event names and the
// inline card subscribes to them by name; nothing connects the two lists but
// spelling, and a name emitted but not subscribed to is a card that quietly
// stops updating rather than an error anyone sees.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BOLT_SLIDES_AGENT_ID,
  BOLT_SLIDES_COMMAND,
  BOLT_SLIDES_DEFAULT_SLIDES,
  boltSlidesUserMessage,
  describeBoltSlidesDeck,
  isBoltSlidesTheme,
  parseBoltSlidesRequest,
  taskFromBoltSlidesCommand,
} from "../src/lib/bolt-slides/identity.ts";
import { boltSlidesDefaults } from "../src/lib/agent-settings/defaults.ts";
import { CONFIGURABLE_AGENTS } from "../src/lib/agent-settings/catalog.ts";
import { deckSourceSchema, importSpecifiers, parseWithSchema } from "../src/lib/bolt-slides/schemas.ts";
import { buildFailure } from "../src/lib/bolt-slides/build.ts";

const source = (relative) =>
  fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const VALID_APP = `import Deck from './deck/Deck';
import Slide from './deck/Slide';

export default function App() {
  return (
    <Deck>
      <Slide center nav="One">
        <h2 className="headline">A deck that exists.</h2>
      </Slide>
    </Deck>
  );
}
`;

function deck(overrides = {}) {
  return {
    appTsx: VALID_APP,
    tokensRoot: "--bg: #05070a;\n--primary: #4fe5b0;",
    indexTitle: "A deck",
    faviconEmoji: "🎞️",
    summary: "A deck built to exercise the schema in a test rather than in a run.",
    ...overrides,
  };
}

test("the command is recognised, and everything after it is the brief", () => {
  assert.equal(taskFromBoltSlidesCommand("hello"), null);
  assert.equal(taskFromBoltSlidesCommand("/agents:matraix ask them"), null);
  // A bare token selects the agent with no brief; the surfaces then prompt.
  assert.equal(taskFromBoltSlidesCommand(BOLT_SLIDES_COMMAND), "");
  assert.equal(
    taskFromBoltSlidesCommand(`${BOLT_SLIDES_COMMAND} pitch our Series A`),
    "pitch our Series A",
  );
  // Case is the user's business, not ours.
  assert.equal(taskFromBoltSlidesCommand("/AGENTS:BOLT-SLIDES a deck"), "a deck");
  assert.equal(boltSlidesUserMessage("a deck"), `${BOLT_SLIDES_COMMAND} a deck`);
  assert.equal(boltSlidesUserMessage("   "), BOLT_SLIDES_COMMAND);
});

test("a stacked token survives the parser so the resolver can refuse it", () => {
  // The capability resolver is what reports "a skill cannot ride along with an
  // agent whose route does not resolve one". It can only do that if the token
  // is still in the string it is handed.
  assert.equal(
    taskFromBoltSlidesCommand(`/my-skill ${BOLT_SLIDES_COMMAND} a deck about pricing`),
    "/my-skill a deck about pricing",
  );
  assert.equal(
    taskFromBoltSlidesCommand(`${BOLT_SLIDES_COMMAND} /agents:codex a deck`),
    "/agents:codex a deck",
  );
});

test("flags are read and removed; prose that looks like a flag is not", () => {
  const parsed = parseBoltSlidesRequest(
    "--slides 8 a deck on our Q3 results --theme fintech --brand https://acme.com",
  );
  assert.equal(parsed.brief, "a deck on our Q3 results");
  assert.equal(parsed.slides, 8);
  assert.equal(parsed.theme, "fintech");
  assert.equal(parsed.brandUrl, "https://acme.com");

  // A theme nobody defines, and a brand that is not a URL, stay in the brief
  // rather than becoming a request nothing can satisfy.
  const loose = parseBoltSlidesRequest("a deck --theme neon --brand acme");
  assert.equal(loose.theme, "auto");
  assert.equal(loose.brandUrl, null);
  assert.match(loose.brief, /--theme neon/);
  assert.match(loose.brief, /--brand acme/);

  // The slide count is a target, and an absurd one is pulled back into range
  // rather than refused: nobody presents four hundred slides.
  assert.equal(parseBoltSlidesRequest("a deck --slides 400").slides, 24);
  assert.equal(parseBoltSlidesRequest("a deck --slides 1").slides, 5);
  assert.equal(parseBoltSlidesRequest("a deck").slides, BOLT_SLIDES_DEFAULT_SLIDES);
});

test("stored defaults fill only what the message left unsaid", () => {
  const stored = { slides: 18, theme: "cinematic" };
  assert.equal(parseBoltSlidesRequest("a deck", stored).slides, 18);
  assert.equal(parseBoltSlidesRequest("a deck", stored).theme, "cinematic");
  // A flag typed in the message always wins over a preference.
  assert.equal(parseBoltSlidesRequest("a deck --slides 6", stored).slides, 6);
  assert.equal(parseBoltSlidesRequest("a deck --theme swiss", stored).theme, "swiss");
});

test("settings translate into the request shape, and nonsense falls back", () => {
  assert.deepEqual(boltSlidesDefaults({ slides: 15, theme: "swiss" }), {
    slides: 15,
    theme: "swiss",
  });
  // A theme the catalog no longer offers must not reach the prompt: the run
  // would ask the model to dress a deck in a family nobody can describe.
  assert.equal(boltSlidesDefaults({ theme: "vaporwave" }).theme, "auto");
  assert.equal(boltSlidesDefaults({}).slides, BOLT_SLIDES_DEFAULT_SLIDES);

  // Every theme the settings panel offers has to be one the parser accepts,
  // or a saved preference becomes an unsatisfiable request.
  const agent = CONFIGURABLE_AGENTS.find((entry) => entry.id === BOLT_SLIDES_AGENT_ID);
  assert.ok(agent, "Bolt Slides has no settings entry");
  assert.equal(agent.command, BOLT_SLIDES_COMMAND);
  const themeField = agent.fields.find((field) => field.key === "theme");
  for (const option of themeField.options) {
    assert.ok(isBoltSlidesTheme(option.value), `${option.value} is not a theme the run accepts`);
  }
});

test("the cohort line describes the deck before anything is planned", () => {
  assert.equal(describeBoltSlidesDeck(parseBoltSlidesRequest("a deck")), "~12 slides");
  assert.equal(
    describeBoltSlidesDeck(
      parseBoltSlidesRequest("a deck --slides 8 --theme paper-editorial --brand https://acme.com"),
    ),
    "~8 slides · paper editorial · acme.com",
  );
});

test("a deck that would not build is refused before the build starts", () => {
  assert.ok(parseWithSchema(deckSourceSchema, deck(), "The deck").ok);

  const noDeck = parseWithSchema(
    deckSourceSchema,
    deck({ appTsx: VALID_APP.replace(/<\/?Deck>/g, "<div>") }),
    "The deck",
  );
  assert.equal(noDeck.ok, false);
  assert.match(noDeck.issues.join(" "), /<Deck>/);

  // `main.tsx` renders `<App />`, so an App with props renders with none of
  // them — an empty deck rather than an error.
  const withProps = parseWithSchema(
    deckSourceSchema,
    deck({ appTsx: VALID_APP.replace("function App()", "function App({ slides })") }),
    "The deck",
  );
  assert.equal(withProps.ok, false);
  assert.match(withProps.issues.join(" "), /takes no props/);

  // The theme is merged into an existing `:root` block, so a selector or a
  // brace in it would be pasted inside one.
  const braced = parseWithSchema(
    deckSourceSchema,
    deck({ tokensRoot: ":root { --bg: #000; }" }),
    "The deck",
  );
  assert.equal(braced.ok, false);
  assert.match(braced.issues.join(" "), /declarations only/);
});

test("the import allowlist is what keeps a deck to code that is installed", () => {
  assert.deepEqual(
    importSpecifiers("import Deck from './deck/Deck';\nimport 'katex/dist/katex.css';"),
    ["./deck/Deck", "katex/dist/katex.css"],
  );

  for (const specifier of ["lodash", "node:fs", "d3", "https://esm.sh/three"]) {
    const rejected = parseWithSchema(
      deckSourceSchema,
      deck({ appTsx: `import x from '${specifier}';\n${VALID_APP}` }),
      "The deck",
    );
    assert.equal(rejected.ok, false, `${specifier} was accepted`);
    assert.match(rejected.issues.join(" "), /not installed/);
  }

  // The allowlist applies to an authored component too — it is compiled by the
  // same build, so an exemption there would be no rule at all.
  const badComponent = parseWithSchema(
    deckSourceSchema,
    deck({
      components: [
        { name: "Chart", source: `import * as d3 from 'd3';\nexport default function Chart() { return null; }\n` },
      ],
    }),
    "The deck",
  );
  assert.equal(badComponent.ok, false);
  assert.match(badComponent.issues.join(" "), /components\.0\.source/);

  // React, framer-motion and relative paths are the whole allowlist.
  assert.ok(
    parseWithSchema(
      deckSourceSchema,
      deck({
        appTsx: `import { motion } from 'framer-motion';\nimport { useState } from 'react';\nimport Panel from './authored/Panel';\n${VALID_APP}`,
      }),
      "The deck",
    ).ok,
  );
});

test("a build failure is reported by its cause, not by its last line", () => {
  const rollup = [
    "vite v5.4.0 building for production...",
    "transforming...",
    "src/App.tsx:41:8: ERROR: Expected \"}\" but found \"<\"",
    "error during build:",
    "Error: Build failed with 1 error",
    "    at failureErrorWithLog (/node_modules/esbuild/lib/main.js:1476:15)",
  ].join("\n");
  assert.match(buildFailure(rollup), /src\/App\.tsx:41:8/);

  // Colour codes must not stop the cause from being found; Vite writes them
  // even with NO_COLOR set in some shells.
  assert.match(buildFailure("[31merror during build:[0m\nRollupError: oh no"), /RollupError: oh no/);

  // With nothing recognisable, the tail is still better than silence.
  assert.equal(buildFailure(""), "");
  assert.match(buildFailure("something\nunhelpful\nhappened"), /happened/);
});

test("the run manager's events and the card's subscriptions are the same list", () => {
  const manager = source("../src/lib/bolt-slides/run-manager.ts");
  const card = source("../src/app/components/hermes/inline-bolt-slides-run.tsx");

  const emitted = new Set(
    [...manager.matchAll(/emit\(\s*run,\s*"([a-z._]+)"/g)].map((match) => match[1]),
  );
  const subscribed = new Set(
    [...(card.match(/const EVENTS = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/"([a-z._]+)"/g)].map(
      (match) => match[1],
    ),
  );

  assert.ok(emitted.size >= 10, "the run manager emits suspiciously few events");
  const unsubscribed = [...emitted].filter((name) => !subscribed.has(name));
  assert.deepEqual(
    unsubscribed,
    [],
    `emitted but not subscribed to, so the card silently stops updating: ${unsubscribed.join(", ")}`,
  );
  const unemitted = [...subscribed].filter((name) => !emitted.has(name));
  assert.deepEqual(
    unemitted,
    [],
    `subscribed to but never emitted, so the card waits for nothing: ${unemitted.join(", ")}`,
  );
});

test("a run's deck and its files are addressed under that run and nowhere else", () => {
  const workspace = source("../src/lib/bolt-slides/workspace.ts");
  // The deck route serves files by relative path out of a directory a model
  // wrote into, so the containment check is the whole of its safety.
  assert.match(workspace, /startsWith\(`\$\{root\}\$\{path\.sep\}`\)/);
  assert.match(workspace, /\^bsrun_\[0-9a-f\]\{32\}\$/);

  // Every run-scoped route proves ownership before it reads anything.
  for (const route of [
    "../src/app/api/bolt-slides/runs/[runId]/deck/[[...path]]/route.ts",
    "../src/app/api/bolt-slides/runs/[runId]/artifacts/route.ts",
    "../src/app/api/bolt-slides/runs/[runId]/artifacts/[artifactId]/route.ts",
  ]) {
    const text = source(route);
    assert.match(text, /requireUserId\(\)/, `${route} does not authenticate`);
    assert.match(text, /requireWorkspaceOwner/, `${route} does not check ownership`);
  }
});

test("nothing in a run writes into the clone", () => {
  const workspace = source("../src/lib/bolt-slides/workspace.ts");
  // Vite's default cache directory is `node_modules/.vite`, which through the
  // workspace's junction is a write straight into the checkout. Naming it is
  // what keeps the clone read-only.
  assert.match(workspace, /cacheDir: '\.vite'/);
  assert.match(workspace, /base: '\.\/'/);

  // An install is the one thing that touches the clone, and it runs from the
  // setup route only — never from a run.
  const setup = source("../src/lib/bolt-slides/setup.ts");
  assert.match(setup, /npm/);
  assert.doesNotMatch(source("../src/lib/bolt-slides/run-manager.ts"), /install/i);
});
