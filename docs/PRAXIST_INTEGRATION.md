# Praxist integration

Breadboard exposes the cloned [PRAXIST](https://github.com/sapientinc/PRAXIST) runtime as `/agents:praxist` and as an empirical participant in Max Research.

Praxist is a task-project runtime, not a free-form question-answering wrapper. A run always targets an existing absolute directory containing `task.yaml`; that project owns the objective, evaluator, generation policy, and experiment surface.

## One-time setup

From the cloned checkout:

```powershell
cd PRAXIST
uv sync --extra codex
uv run praxist user-agreement review --print
uv run praxist user-agreement accept
```

The last command is intentionally interactive. Breadboard never accepts Praxist's legal terms for the operator.

The health endpoint reports each prerequisite independently:

- the clone is present;
- `.venv` exists;
- the optional `openai-codex` dependency imports;
- the current Praxist agreement is accepted.

`GET /api/praxist/health` returns the readiness state and the exact setup command when one of those checks fails.

## Running the agent

Use an absolute task-project path:

```text
/agents:praxist --task-path "C:\research\my-praxist-task"
```

The dashboard and Garden surfaces create a durable Runtime V2 job, show the shared agent-card chrome, stream phase/generation/finding progress, persist the terminal result, and expose Stop. Outputs go into the Runtime-owned job workspace rather than the PRAXIST source checkout. Cancellation calls `praxist stop <run-id>` before Runtime V2 reaps the worker tree.

Breadboard selects Praxist's `codex_sdk` runtime and `openai_compatible` provider, pointing them at the trusted ChatMock endpoint and credential. The task project's own `agent.reasoning_effort` remains authoritative.

## Max Research

Set a task project before starting Breadboard:

```powershell
$env:PRAXIST_MAX_RESEARCH_TASK_PATH = "C:\research\my-praxist-task"
```

Max Research always plans a Praxist row. If the path or runtime prerequisites are missing, that row is marked unavailable with the reason; the other participants continue. When configured, Praxist runs in the empirical wave alongside OpenScience and ARIS, and its accepted findings and artifacts enter synthesis and review.

The configured project must genuinely bear on the questions for which Max Research is used. Breadboard does not rewrite `task.yaml` or pretend that an unrelated project tested the current question.

## Verification

The integration is covered at four boundaries:

1. identity parsing and absolute task-path validation;
2. sealed Runtime V2 request/worker projection and cancellation ownership;
3. card, persistence, API, capability, and Max Research registration;
4. the upstream Praxist CLI's own offline task-resolution/research tests.

For a production smoke test after accepting the agreement, run a small real task project through the command above and verify that the card reaches `completed`, links `run_summary.json`, and that Stop changes an active run to `aborted`.
