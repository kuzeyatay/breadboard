# Bolt Slides — presentations that are working web apps

`/agents:bolt-slides <what the deck is about>` plans a deck slide by slide,
themes it, writes the React source, compiles it with Vite, and hands back a link
that opens a real presentation: click-builds, a thumbnail rail, grid view, pen
annotation, and a presenter view synced to a second tab.

Upstream: [stackblitz/bolt-slides](https://github.com/stackblitz/bolt-slides),
cloned at `bolt-slides/`. Nothing in the clone is modified and no run writes
inside it — the only thing that touches it is the one-off `npm install` behind
the setup button.

```
/agents:bolt-slides pitch our Series A to a generalist fund
/agents:bolt-slides --slides 8 --theme swiss the Q3 numbers for the board
/agents:bolt-slides --brand https://acme.com launch deck for the new pricing
```

---

## What it is, and what it is not

The clone is a complete Vite + React deck engine plus a bundled authoring skill
(`.bolt/skills/slides/SKILL.md`). The engine is the part that makes a deck feel
like a deck; the skill is the part that makes one look designed rather than
generated. Breadboard supplies neither. It supplies the loop between them: a
plan, an authored `App.tsx`, a build, and a repair when the build fails.

It is **not** a `.pptx` writer. The output is a web app — the right thing when
the deck will be presented or shared as a link, the wrong thing when someone has
to open it in PowerPoint and edit it. That case is Resource2Skill's, and both
agents' selection briefs say so, in both directions.

---

## Shape: a Breadboard-driven loop over a clone with no runtime

The clone fails the liveness test on purpose: there is no program to run and no
loop that does not need a human — the repo *is* the app, and in Bolt a person
prompts an agent to edit it in place. So this is shape 2, a **Breadboard-driven
loop**, and Breadboard owns the two model calls and the build.

```
brief ──► plan (submit_deck_plan)  ──► author (submit_deck_source) ──► apply ──► vite build
                                              ▲                                     │
                                              └──────────── repair ◄────────────────┘ (once)
```

**Why two calls rather than one.** The skill's sharpest rule is that every
specialty layout has an entry condition — `<Chat>` only for a genuinely
conversational product, `<BigNumber>` only for one real, sourced figure. A model
writing seven hundred lines of TSX in a single pass reaches for whatever is
nearest, and produces the component showcase the skill spends a page warning
against. Making it name each slide's *purpose* before it writes any of them is
what turns "the kit has a Globe" back into "this deck is about market entry".

**Why one repair and not a loop.** A build failure here is nearly always
mechanical — a prop that does not exist, an unclosed tag — and naming it back
with the file and position fixes it. A second failure on the same error is a
model that cannot see the problem, and the run says so rather than spending
another full generation.

---

## The prompt is read out of the clone, not written here

Two things the model is told come from the checkout at run time:

- **The authoring skill**, `.bolt/skills/slides/SKILL.md`, verbatim — minus two
  sections. "Step 1 — Run it in place" describes an install and a dev server
  that the workspace has already done differently. "Internal trigger" tells an
  agent that one exact phrase means *ship the starter demo instead*; harmless in
  Bolt, where one person is watching one repo, and not something a phrase in a
  chat brief should be able to reach.
- **The component library**, extracted by `kit-digest.ts`: for every component
  in `src/components/` and the four composable modules in `src/deck/`, its name,
  the block comment its author wrote, and the literal prop type from its
  signature.

Extracting rather than transcribing is the point. A hand-written prop list drifts
from a vendored checkout silently, and the failure arrives as a build error
inside a run, minutes after somebody asked for a deck.

---

## A workspace per deck, and a clone that stays read-only

`dashboardDataDir()/bolt-slides-runs/<runId>/` holds a working copy of the
authoring surface — `index.html`, `src/deck/`, `src/components/`, `src/styles/`,
`src/main.tsx` — plus a `node_modules` **directory junction** back to the
clone's. One install serves every deck, and the checkout is never written to.

Vite's cache directory is named explicitly for that last reason: its default is
`node_modules/.vite`, which through the junction is a write straight into the
clone.

A run writes exactly four things, which is the skill's first hard rule made
mechanical:

| File | What the run does |
| --- | --- |
| `src/App.tsx` | replaced whole — the deck |
| `src/styles/tokens.css` | `:root` **merged** token by token — the theme |
| `src/styles/base.css` | at most one `@import` prepended, for the theme's fonts |
| `index.html` | title, favicon, and a BroadcastChannel guard |
| `src/authored/*.tsx` | components the topic needed and the kit did not have |

The engine and the component library are copies and are never touched, so a
model cannot rewrite the chrome by accident or on purpose.

**The theme merges rather than replaces**, and that is not a detail. A model that
returns four colours is describing a theme, not asking for `--accent`,
`--gutter` and `--radius` to be deleted — but a wholesale replacement deletes
them, and the deck that comes back has transparent figures and no spacing rather
than an error anyone can see. A complete theme still wins completely.

**The BroadcastChannel guard** exists because the run card frames the deck in a
sandboxed iframe, where the origin is opaque and constructing a channel can
throw — taking the whole deck down at mount. The shim goes in the page shell, not
in `src/deck/Deck.tsx`, and only installs itself when a real channel actually
fails; in the deck's own tab, presenter sync is untouched.

---

## What the schema refuses, and why it matters

`schemas.ts` is the gate between a model's output and a bundler on this machine.
Alongside the shape checks (an `App` that takes props would render empty, since
`main.tsx` renders `<App />`), it enforces an **import allowlist**: `react`,
`react-dom`, `framer-motion`, and relative paths. Nothing else.

That does two jobs at once. It is the skill's "no new dependencies" rule made
checkable before a build burns ninety seconds on a module-resolution error, and
it is the one place a run could otherwise reach code nobody installed.

There is also no remote imagery. The pipeline has no image-generation step, so a
URL the model invents would 404 in front of an audience; the house rules say to
build visuals from CSS, SVG, the `.vframe` mocks and the charts, and web fonts
are the single exception, carried by `fontImport`.

---

## What comes back

- **A link.** `/api/bolt-slides/runs/<runId>/deck/` serves the built `dist/` for
  the account that owns the workspace. The build uses `base: "./"`, so one build
  is servable from a run-scoped path without being rebuilt for it.
- **An inline preview.** The run card frames the same URL with
  `sandbox="allow-scripts"` — the same frame every other generated interactive
  page in Breadboard gets. Presenter mode needs a real origin, which is what the
  card's **Open** link is for.
- **An artifact.** The deck folded into one self-contained HTML file (module
  bundle inlined into a `<script>`, stylesheet into a `<style>`), filed as a
  `presentation` on the chat that asked for it. Its metadata carries
  `boltSlidesDeck: true`, which is the one flag the artifact viewer reads to
  frame it with scripts enabled rather than as inert HTML.
- **The sources.** `App.tsx` and `tokens.css` download from the card, for
  someone who wants to keep editing the deck in the clone.

---

## Settings

Two fields, both overridable by a flag in the message: **slides to aim for**
(`--slides`, 5–24) and **theme family** (`--theme`, the skill's nine families or
`auto`). `auto` is the default and is usually right: the theme follows the topic,
and always follows the brand when `--brand <url>` names one.

Setup is one button: `npm install` in the clone, run only because a person
pressed it. A deck run never installs anything.

---

## Files

```
bolt-slides/                                  the clone, unmodified
dashboard/src/lib/bolt-slides/
  identity.ts        command, flags, brief
  runtime.ts         where the clone is, whether it can build
  workspace.ts       per-run copy, junction, artifacts, deck file serving
  kit-digest.ts      the component library, extracted from source
  schemas.ts         the plan and the deck, with the import allowlist
  author.ts          the two model calls and the repair
  apply.ts           writing an authored deck into its workspace
  build.ts           vite build, and reading the failure back
  run-manager.ts     the run, its events, its abort
  artifact.ts        inlining the deck and filing it on the chat
  setup.ts           the one install
dashboard/src/app/api/bolt-slides/            runs · events · abort · artifacts · deck · health · setup
dashboard/src/app/components/hermes/
  inline-bolt-slides-run.tsx                  the run card
  bolt-slides-settings-dialog.tsx             setup + run defaults
dashboard/tests/bolt-slides-agent.test.mjs
```
