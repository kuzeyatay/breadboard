# Product concept survey (FocusLoop)

MatrAIx **survey** reference task: read product context and a structured
questionnaire, then submit persona-aligned answers as JSON.

Task contents:

- `instruction.md`, `task.toml`, `tests/`
- `input/context.md`, `input/questionnaire.yaml`
- `persona_strategy.json`, `reporting.json` (task root; part of the task)

This task reuses `application/shared-survey-form`. Playground mounts `input/` into
the trial; sampling and reporting stay at the task root.

See [Application Tasks](../README.md).

## Smoke run

Oracle (no persona model):

```bash
uv run harbor run -p application/tasks/example-survey_product-feedback -a oracle
```

Persona agent:

```bash
uv run python application/scripts/generate_application_job.py \
  --task application/tasks/example-survey_product-feedback \
  --execution-mode auto \
  --persona-ids 0042

export ANTHROPIC_API_KEY="sk-ant-..."
export MATRIX_SURVEY_TASK_PATH=application/tasks/example-survey_product-feedback
uv run harbor run -c configs/jobs/application-task-job-recipe/example-survey-product-feedback-auto-n1.yaml
```

See [Application Quickstart](../../../docs/quickstart.md) for the UI path and full env vars.

## What this exercises

- Task-local survey docs in `input/` plus the shared `shared-survey-form` runtime
- `/app/input` → read materials → `/app/output/survey_result.json` contract
- Schema verifier (question coverage + interest scale)
