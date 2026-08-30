# Premortem repository instructions

Premortem is a Typer CLI for agent-facilitated prospective-hindsight
analysis. JSON envelopes are the default interface.

## Start here

```bash
pytest -q
premortem agent-start
premortem workflow next
```

Use `README.md` for installation and public command examples. Use
`premortem docs show facilitation-guide` for the packaged method.

## Architecture

- `premortem/store.py` owns validated project persistence.
- `premortem/workflow.py` infers readiness and supplies next actions.
- `premortem/edsl_jobs.py` builds portable, model-free EDSL Jobs packages.
- `premortem/ingest.py` normalizes EDSL Results into project entities.
- `premortem/report_context.py` builds the canonical reporting bundle.
- `premortem/report_renderers.py` provides optional renderings from that
  bundle.
- `premortem/docs_content/` is installed package guidance.

## Invariants

- Never reintroduce generated Python job runners or direct paid model calls.
- AI-assisted phases produce `.jobs.ep` files and run only through `ep run`
  after inspection, cost estimation, and approval.
- Do not edit `.premortem` JSON manually.
- Preserve JSON envelope compatibility and explicit action safety metadata.
- Reporting renderers consume report context rather than rebuilding state
  independently.
- Add tests for state mutations, workflow transitions, and command envelopes.

Generated user projects and artifacts in `jobs/`, `writeup/`, or other
untracked directories are not part of package changes unless explicitly
requested.
