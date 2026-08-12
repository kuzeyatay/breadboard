# Meta prompting in Hermes

Every Hermes turn now settles the structure of the answer before its content.
This is Meta Prompting, from "Meta Prompting for AI Systems"
([arXiv:2311.11482](https://arxiv.org/abs/2311.11482), ICLR 2024 BGPT workshop),
cloned at [`meta-prompting/`](../meta-prompting). The paper's claim is that a
single example-agnostic scaffold, the shape a correct answer for a task category
must have, beats content-rich few-shot examples and costs far fewer tokens. It
is a functor in the paper's formalism, which is the precise way of saying the
structure is selected by task type and composes when a task decomposes.

It is innate rather than a command, a skill, or a mode. There is nothing to
invoke and nothing to remember to turn on.

## The two halves

**The discipline** lives in
[`hermes-config/system/meta-prompting.md`](../hermes-config/system/meta-prompting.md)
and is appended by `composeHermesSystemPrompt` on every surface and in every
capability mode. It teaches the signature/procedure/verification decomposition,
the rule that a task which decomposes has a structure that decomposes with it,
and the recursion the paper calls Recursive Meta Prompting: when the supplied
structure does not fit what was asked, repair it in one pass and answer under
the repaired version, silently. That recursion is in-prompt, so it costs no
extra model round trip.

**The per-turn structure** comes from
[`dashboard/src/lib/hermes/meta-prompting.ts`](../dashboard/src/lib/hermes/meta-prompting.ts).
`classifyMetaTask` reads the user's newest message together with the surface and
the server capability decision and picks one of ten task categories;
`metaPromptSection` renders the matching scaffold as a `meta_prompt` system
section, placed after the capability record and before the turn's evidence so
the model reads context already holding the frame it will fill.

Classification is deliberately conservative. A greeting, an acknowledgement, or
anything that matches nothing above the threshold returns `general` and gets no
section at all, so trivial turns pay nothing. The server decision outranks
wording: a turn actually authorized to write code is an implementation turn
whatever the phrasing.

Scaffolds are capability-aware. The quantitative one asks for execution only
where execution exists. On the Terminal the chain is the paper's full
`Question -> AnswerSketch -> Code -> Output -> Answer`; on Garden and Quartz the
Code and Output stages are dropped and the scaffold says so explicitly, so the
model cannot mistake an unrun calculation for an executed one.

## What the clone actually supplies

The clone is a live dependency, not a citation. Four structures are parsed out
of it at request time, cached by mtime so a `git pull` takes effect without a
restart:

| Clone file | What is parsed | Where it lands |
| --- | --- | --- |
| `prompts/cr-agent-assistant-v0.1.md` | the reasoning chain | quantitative scaffold |
| `Math/prompts/mp/math.md` | the answer structure, including the boxed final value | quantitative output contract |
| `prompts/mp-icpd-v0.2.md` | the in-context prompt design stages | prompt-design scaffold |
| `prompts/mp-pt-reasoning-v0.1.md`, `prompts/mp-pt-concise-v0.1.md` | the two refinement operators | prompt-design verification |

The paper writes its prompts as LaTeX `tcolorbox` figures, so `distillClonePrompt`
strips the figure machinery and keeps the instruction text. Nothing LaTeX-shaped
reaches the model. Every parser has an embedded fallback, so a missing clone
degrades instead of breaking turns, and `metaPromptingDiagnostics()` reports
which source was actually used.

The other eight categories (technical diagnosis, implementation, research
synthesis, decision analysis, planning, explanation, extraction, and authoring)
are not covered by the paper and have first-party scaffolds written to the same
discipline.

## Boundaries

The structure is internal. The rendered section ends with an instruction never
to print slot names, stage numbers, or the fact that a structure was used, and
never to let the frame override `response_style`. Answers stay prose. The one
exception is an output contract the user actually asked for, such as a named
format or a final value stated on its own.

The structure is not authority. It adds no capability, no tool, and no root, and
it cannot turn an unavailable action into an assumed one.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `ENABLE_META_PROMPTING` | on | `0`, `false`, `off`, or `no` removes both halves |
| `META_PROMPTING_DIR` | sibling `meta-prompting/` clone | where the parsed assets are read from |

The packaged desktop app stages the five parsed files beside `hermes-config`
(see `desktop/scripts/prepare-app-resources.mjs`), and the build fails if one is
missing rather than shipping an app that silently falls back.

## Tests

[`dashboard/tests/meta-prompting.test.mjs`](../dashboard/tests/meta-prompting.test.mjs)
covers the clone parsers against the real files, the fallback path, the
classifier over representative turns, the surface-dependent execution stages, the
composition into all three surfaces and all three capability modes, and the
disable flag.
