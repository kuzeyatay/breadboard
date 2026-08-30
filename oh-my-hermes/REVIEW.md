# Review instructions

**Who reads this file.** Today it is read explicitly, by the `review-sweep`
skill in `.claude/skills/review-sweep/` and by anyone reviewing a PR by hand.
Nothing reads it automatically. Anthropic's managed Code Review service picks
up a root `REVIEW.md` on its own, but that service is a separate paid product
and is not enabled here; the `claude-code-action` GitHub Action and the local
`/code-review` command both ignore this file. So treat it as the written policy
a reviewer is expected to load, not as configuration that enforces itself.

oh-my-hermes is pure Python 3.11+ with zero runtime dependencies. Core `omh`
code makes no LLM, API, or network calls and never patches Hermes. Most defects
here are **contract drift**, not algorithmic bugs. Weight the review that way:
a correct-looking function that desynchronizes a generated artifact or a pinned
count is worse than an awkward loop.

## What Important means here

Reserve Important for findings that break a contract or ship a false claim.

- A generated artifact was hand-edited instead of regenerated from its source.
  The edit is silently lost on the next regeneration and fails a byte-exact
  gate. See the table below.
- A routing case, skill, or demo card was added without updating the
  exact-count assertions that pin it (`case_count`, `intervention_case_count`,
  and friends). Those counts are the contract, not noise.
- A routing trigger uses a raw substring check instead of the normalized
  helpers (`normalized_phrase`, `routing_tokens`, `contains_cue_phrase`).
- A routing or policy trigger ships without a negative case. A positive-only
  trigger is incomplete, not merely under-tested.
- Evidence language claims execution, review, CI, or merge that did not happen.
  `prepared_not_observed` is never execution evidence.
- A network, LLM, or API call was added to core `omh` code, or a new runtime
  dependency was introduced. The one sanctioned execution surface is
  `omh coding fanout dispatch`.
- A broad `except` was added without a verdict in
  `tests/test_broad_exception_policy.py`.
- User-facing CLI output was made Korean-only, or localized output began
  auto-detecting the OS locale instead of requiring `--language` / `OMH_LANG`.
- Codex was made the implicit default owner in wording, schemas, or reports
  where Claude Code, Hermes runtime, and generic executors are equally valid.

Style, naming, structure, and refactoring suggestions are Nit at most.

## Generated artifacts — never hand-edited

A PR that edits the right-hand column without the left-hand column is an
Important finding.

| Source of truth | Generated file |
| --- | --- |
| `src/skills/catalog.py`, `src/skills/render.py` | `skills/*/SKILL.md`, `skills/*/references/*.md` |
| same catalog data | `docs/WORKFLOWS.md` |
| same catalog data | `docs/ROLES.md` |
| demo case engine | `examples/use-cases/g1-g10-demo-cards.json` |
| `capability_family_projection()` in `src/capabilities/families.py` | `src/plugin_bundle/omh/tools/capability_families.json` |

The gates are byte-exact. A one-character drift fails CI.

## Cap the nits

Report at most five Nits per review. If you found more, say "plus N similar
items" in the summary instead of posting them inline. If everything you found
is a Nit, lead the summary with "No blocking issues."

## Do not report

- Anything CI already enforces: Ruff (Pyflakes `F` only) and `compileall`.
- Broad `except Exception` as a style matter. `BLE001` is deliberately not
  enforced; the policy is owned by issue #652 and gated by
  `tests/test_broad_exception_policy.py`. Only flag a broad `except` whose
  failure is neither classified nor surfaced.
- Anything under `build/lib/`. It is a gitignored stale copy of old sources,
  not live code.
- Missing type annotations, docstring style, or line length. None are enforced.
- Test-only code that intentionally violates production rules.

## Verification bar

Behavior claims need a `file:line` citation in the source, not an inference
from a name. If you cannot point at the line that makes the claim true, either
drop the finding or state plainly that it is unverified.

Before claiming a test would fail, check whether the repo already solves the
problem elsewhere. This codebase has established patterns for skip guards,
symlink capability probes, and filesystem faults; a PR reinventing one is a
consistency finding with a concrete `file:line` alternative, not a bug.

## Always check

- New or changed routing behavior ships with both a positive and a negative
  case.
- A new installable skill touched every required surface. `docs/ADDING-A-SKILL.md`
  is the checklist; awareness lane, context card, ack/label/card coverage, and
  the capability-family sidecar are all easy to miss.
- Commits carry DCO `Signed-off-by:` plus the Lore-style trailers from
  `AGENTS.md`, with `Signed-off-by:` last.
- The PR body follows the repository template with real content. A one-line
  changelog for a user-facing change is a finding.
- Verification claims in the PR body match what the diff can actually support.

## Re-review convergence

After the first review of a PR, suppress new Nits and post Important findings
only. A one-line fix must not reach round seven on style.

## Summary shape

Open the review body with a one-line tally, for example `1 important, 3 nits`.
Lead with "No blocking issues" when that is the case. State the shape of the
work before the details.
