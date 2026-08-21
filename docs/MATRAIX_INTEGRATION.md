# MatrAIx — simulated population studies

`/agents:matraix <what you want to learn>` writes a questionnaire, draws a cohort
out of a pool of persona records, runs each persona as its own agent, and returns
how the population split — with the breakdown by any dimension you name and every
respondent's stated reason.

Upstream: [MatrAIx-ai/MatrAIx-Persona-8B](https://github.com/MatrAIx-ai/MatrAIx-Persona-8B),
cloned at `MatrAIx-Persona-8B/`. Nothing in the clone is modified, and no study
writes inside it.

```
/agents:matraix would busy parents pay $4/month for a meal-planning app
/agents:matraix --personas 20 --by age_bracket which of these two subject lines gets opened
/agents:matraix --filter "life_stage=Parent of young kids" --stratify economic_motivation is $9 too much
```

---

## What it is, and what it is not

MatrAIx is population-scale evaluation infrastructure. Its persona records are
built on a shared schema of **1,290 categorical dimensions** — background,
psychology, capability, behaviour — and each record is rendered into the system
prompt of one agent, which then answers the questionnaire.

The output is a distribution of model answers conditioned on persona records. It
is useful for exploration, stress testing and hypothesis generation. **It is not
evidence from real people**, and the report says so at the top of every study, on
purpose. Upstream is explicit about the same boundary and the integration keeps
it rather than dressing the numbers up.

---

## Shape: a wrapped runtime with a design step in front

MatrAIx passes the liveness test — a real entry point, a loop that needs no
human, progress it can report — so this is a **wrapped runtime**, driven through
`scripts/matraix-bridge.py`. Every load-bearing step inside the bridge is
upstream's own code:

| Step | Upstream |
| --- | --- |
| Cohort retrieval, dimension filters, stratified quotas | `PersonaPoolService.sample_pool` |
| The persona prompt, the model call, answer normalisation, trajectory, metrics | `InprocessSurveyEvalRunner` |
| Rendering a persona record into a prompt | `render_persona_block` |
| The population report | `collect_job_results` + its three formatters |

The one thing Breadboard adds is the **questionnaire**, because a person asking
"would parents pay four dollars" has not supplied one. `lib/matraix/design.ts`
makes exactly one forced tool call, against the dimensions the pool really has,
and Zod refuses anything upstream's `SurveyQuestion` constructor would raise on.
Every other model call in a run is a persona answering, made by the clone's own
client.

### Why the questionnaire does not become a task folder

Upstream builds the survey prompt from a task under `application/tasks/`, found
by questionnaire id. When the id is not a task there,
`build_survey_task_prompt` falls back to rendering instruction, context,
questionnaire and answer envelope **from the instrument itself**, and
`instrument.description` is what it renders as the Context section. So the
generated study travels as an instrument and the clone builds the prompt from it
with its own renderers — no task folder, no write inside the checkout.

Generated ids are namespaced `bb_<runid>` so they can never collide with a real
task and silently borrow its text. `tests/matraix-agent.test.mjs` pins both the
namespacing and the two prefixes upstream scans for.

### Why the report comes back through `jobs/<job>/`

The bridge writes each trial into the directory layout upstream's own results
reader expects — `result.json`, `persona_meta.json`,
`artifacts/app/output/survey_result.json` — and then calls that reader. The
aggregation, the per-question distributions and the subgroup cuts are therefore
upstream's rather than a second implementation, and the same directory can be
handed to `uv run matraix results <dir>` verbatim.

---

## Scope: the Survey lane

MatrAIx runs four environments: **Survey**, **Chat**, **Web** and **App**. Only
Survey is wired here, and the reason is not effort:

- Survey and Chat are host-native; Web and OS-app need Docker containers and
  task verifiers that require `bash`, which upstream's README says means WSL2 on
  Windows. Neither runs on this machine as it stands.
- Chat is host-native but needs a **system under test** — a chatbot for the
  personas to talk to, wired as a sidecar application. There is no such target
  in Breadboard, and inventing one would be inventing the study.

So a MatrAIx run is a survey. Web, App and Chat studies stay available through
the clone's own CLI and Playground.

---

## Setup

`npm run setup:matraix`, or the **Install** button in the agent's settings
dialog. Both build the same environment:

```
uv venv --python 3.12 .runtime/matraix-venv
uv pip install --python .runtime/matraix-venv -e MatrAIx-Persona-8B -e MatrAIx-Persona-8B/packages/playground
```

`uv` is required rather than preferred — the clone pins Python 3.12 and resolves
a large dependency set — and `UV_LINK_MODE=copy` is not optional, because the
repository sits in a OneDrive folder where uv's default hardlinking fails.

The clone's own `.venv` is accepted as a second candidate, so anyone who
followed upstream's README is already installed.

`npm run setup:matraix --check` reports readiness and the persona pools found.

### Persona pools

The clone ships **`matraix-persona-dev-sample`**: 200 quality-filtered personas,
enough for a cohort of a dozen or two. That is the default pool.

The full **Persona 1M** release is a separate multi-gigabyte download from
Hugging Face. The settings dialog detects it and prints the command rather than
starting the transfer:

```
huggingface-cli download MatrAIx2026/MatrAIx_Persona_1M_Public_Release \
  --repo-type dataset --local-dir persona/datasets/matraix-persona-1m/release
```

Once present, `--pool persona/datasets/matraix-persona-1m` selects it.

---

## The message

Everything that is not a flag is the brief. Flags are read anywhere in the
message, and a flag typed here always beats a stored default.

| Flag | Meaning |
| --- | --- |
| `--personas N` / `-n N` | Respondents. Each is a model call; capped at 60. |
| `--seed N` | The same seed and filters draw the same people. |
| `--filter dim=a,b` | Restrict the pool. Repeatable. |
| `--stratify dim` | Sample evenly across a dimension. Repeatable. |
| `--by dim` | Break the results down by a dimension in the report. Repeatable. |
| `--source name` | Persona provenance: `wiki`, `gss`, `amazon`, … |
| `--allocation …` | `equalTotal` (default), `proportional`, `perCell`. |
| `--pool path` | A persona pool other than the dev sample. |

**Quote values with spaces**, on either side of the `=`: most persona values are
several words (`Parent of young kids`, `North America`, `Early career`), so
`--filter "life_stage=Early career"` and `--filter life_stage="Early career"`
both parse.

### The cohort is reconciled before anything runs

The schema has 1,290 dimensions and every persona carries a sparse subset, so
"does this pool have `life_stage`, and with which values" is a question only the
pool can answer. The bridge answers it by reading the pool's personas
(`--catalog`), cached for ten minutes, and the run then:

- drops a filter dimension or value the pool does not have, and **says which**;
- raises the respondent count when stratifying needs more cells than requested —
  three life stages by four brackets needs twelve people — and says so;
- drops the stratification instead when even the ceiling is not enough.

Each adjustment is reported on the run card. Nothing is silently widened.

---

## Files a run leaves behind

Under `dashboard/matraix-runs/<runId>/output/`:

| Path | What it is |
| --- | --- |
| `study.md` | The report: cohort, per-question distributions, subgroup cuts, respondents' reasons. This is also the chat message. |
| `results.json` / `.csv` / `.txt` | Upstream's own `MatraixJobResults.v1` report, in its three formats. |
| `responses/persona_<id>.json` | One respondent: answers, rationales, full trajectory, token usage. |
| `task/` | The study as a real MatrAIx survey task. Drop it into the clone's `application/tasks/` and the upstream CLI reruns it — the markdown is the same markdown the run used, so the prompt comes out identical. |
| `job/` | The trial layout, readable by `uv run matraix results`. |

---

## The model

One model, chosen in chat, does both jobs: it designs the study and it answers
as every persona. It reaches the clone as `openai/<model>` — upstream's client
reads that prefix as "an OpenAI-compatible endpoint from the environment", which
is what ChatMock is. Without the prefix a bare id is treated as an Anthropic
model and the run asks `api.anthropic.com` for a key nobody set.

Cost is worth stating plainly: a persona record renders to roughly **13,000
input tokens**, and there is one call per respondent. A twenty-person study is
about 260k input tokens. Upstream prices runs through LiteLLM where it can; a
locally proxied model is not in its pricing table, so the report gives token
counts and says the cost is unknown rather than reporting zero.

---

## Verified

Run end to end on 2026-08-20 against ChatMock (`cliproxy/gemini-3.7-flash-high`):
five respondents filtered to three life stages, stratified by `life_stage`, cut
by `age_bracket`. Real model calls throughout — the design call, five persona
calls — real sampling from the 200-persona pool, upstream's own aggregation, and
a report with distributions, subgroup tables and per-question rationales. The
population said no, at a mean of 1.4 out of 5, which is the outcome a working
version of this has to be able to produce.

Verification output was deleted afterwards. `matraix smoke` (upstream's
zero-cost host check) also passes against the clone.

Not exercised: the Persona 1M pool (not downloaded), and the Chat, Web and
OS-app lanes (out of scope, above).
