# Contributing

Thanks for helping improve oh-my-hermes.

## Development Setup

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .
PYTHONPATH=src python -m unittest discover -s tests
```

Run the static-analysis gate the same way CI does, using the pinned Ruff
version declared under `[dependency-groups] lint` in `pyproject.toml` (no
globally installed `ruff` needed):

```sh
uv run --group lint ruff check src tests
```

## Contribution Rules

- Keep Hermes as the runtime boundary.
- Keep installer behavior reversible and inspectable.
- Do not write workspace guidance files by default.
- Do not overwrite locally modified managed skills unless the caller passes
  `--force`.
- Add or update tests for routing, config edits, manifest behavior, and command
  output when those contracts change.
- Keep generated skill text conservative. It may guide routing, but it must not
  claim hidden control over Hermes core behavior.

## Pull Request Checklist

- The change is scoped and explained.
- Tests pass locally.
- `uv run --group lint ruff check src tests` passes locally.
- Public docs were updated when behavior changed.
- Generated docs were refreshed or `python -m omh.cli docs workflows --check`
  was run when catalog data changed.
- Release-channel impact was considered for installer, update, or packaging
  changes.
- Runtime or native capability claims are backed by artifact evidence, wrapper
  evidence, or explicit "not observed" language.
- The PR description includes risk, validation, and known gaps.
- New public strings avoid coupling the project to another agent runtime.

## Commit Messages

Use concise decision-oriented messages. Mention why the change exists, not just
what files changed.

### Sign your commits (required)

Every commit must carry a Developer Certificate of Origin sign-off. A `DCO`
check runs on each pull request and fails when any commit is missing one, so a
PR without sign-offs cannot merge.

Add it automatically with `-s`:

```sh
git commit -s -m "fix: stop the router matching bare 'plan'"
```

That appends a trailer built from your configured git identity:

```
Signed-off-by: Your Name <you@example.com>
```

The name and email must match the commit author, and `Signed-off-by:` must be
the **last** trailer in the message. If you forgot on the most recent commit:

```sh
git commit --amend -s --no-edit
```

To fix a whole branch at once:

```sh
git rebase --signoff origin/main
```

Both rewrite history, so force-push the branch afterwards
(`git push --force-with-lease`).

By signing off you certify the [Developer Certificate of
Origin](https://developercertificate.org/): that you wrote the patch or
otherwise have the right to submit it under this project's license.

### Decision trailers

Maintainer and agent commits also carry decision trailers — `Constraint`,
`Rejected`, `Confidence`, `Scope-risk`, `Directive`, `Tested`, `Not-tested` —
documented in `AGENTS.md`. They record why a change looks the way it does.
Outside contributions are welcome without them; only the sign-off is required.
Whatever else the message carries, `Signed-off-by:` stays last.

## Review and Labels

Pull requests are reviewed against [`REVIEW.md`](REVIEW.md), which defines what
counts as a blocking finding in this repository. Reading it before you open a
PR is the fastest way to avoid a round trip — most findings here are contract
drift, not ordinary bugs.

Two things catch outside contributions most often:

- **Generated files.** `skills/*/SKILL.md`, `docs/WORKFLOWS.md`,
  `docs/ROLES.md`, `examples/use-cases/g1-g10-demo-cards.json`, and
  `src/plugin_bundle/omh/tools/capability_families.json` are generated. Edit the
  source under `src/`, regenerate, and commit both. Byte-exact gates fail on a
  one-character drift.
- **Exact-count assertions.** Adding a routing case, skill, or demo card
  invalidates counts pinned in the tests. Update them in the same commit; they
  are the contract, not noise.

Labels are defined in [`.github/labels.yml`](.github/labels.yml) and applied by
the maintainer. You do not need to label your own PR.
