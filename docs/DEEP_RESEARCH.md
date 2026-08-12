# Deep Research — Integration & Operations

Iterative web-research agent. It turns a question into search queries, extracts
learnings, uses them to ask sharper follow-up questions, and finally writes a
sourced report or a one-line answer.

It is used like every other runtime agent — **no separate UI**. Pick it in the
capability palette's **Agents** tab (the `/` button), which inserts its command
into the composer, or type the command yourself:

```
/agents:deep-research how are European ports adopting shore-side electricity?
/agents:deep-research --answer -b 5 -d 2 who operates the largest tidal array?
```

While it is active every prompt in that conversation becomes a research run, and
each run appears as a live card in the transcript (progress, learnings, sources,
then the report). Clear the chip in the composer to hand the conversation back to
the chat model. Flags replace the controls a dialog would have offered:
`--breadth N`/`-b N` (1–10, default 3), `--depth N`/`-d N` (1–5, default 1),
`--answer` / `--report`. Unrecognized flags stay part of the question.

The engine is the [open-deep-research](https://github.com/dzhng/deep-research)
checkout in `./deep-research` (its own git clone, not tracked by this repo). Both
its LLM **and its search** run through **ChatMock** — the local gateway the chat
surfaces already use — so a run needs no third-party key at all.

## Architecture

```
Chat composer: /agents:deep-research <question>   inline run card in transcript
      |                              browser; cookie-authenticated; no secrets
      |  /api/deep-research/*        (requireUserId, ownership, rate limit,
      |                               error-code redaction, SSE re-emission)
Breadboard dashboard (Next.js)       control plane
      |  loopback HTTP + bearer secret (127.0.0.1 only)
Deep Research service (deep-research/src/api.ts)
      |                              bounded supervisor, durable run snapshots
      +--> ChatMock  (LLM: query planning, learning extraction, report writing)
      +--> ChatMock  (search: built-in web_search tool) — default
           or Firecrawl (search + page scrape to markdown) when configured
```

- **Authentication**: the browser calls Breadboard routes with the NextAuth
  session cookie. Breadboard calls the service with the per-launch bearer secret
  and asserts the `userId`; the service enforces run ownership by it. The browser
  never sees the service port or its secret.
- **Run state**: `running -> {completed|failed|aborted}`. Atomic, per-run JSON
  snapshots under `.runtime/deep-research` retain results and events for
  `DEEP_RESEARCH_RUN_RETENTION_MS` (1 h). A run interrupted by a service restart
  is recovered honestly as `service_restarted`; requester context is never
  persisted.
- **Streaming**: the service exposes events-since as JSON; the dashboard route
  re-emits them as SSE (`id:`/`event:`/`data:`) and supports resume via `since`
  or `Last-Event-ID`. Event types: `run.started`, `research.progress`,
  `research.learnings`, `research.evidence`, `run.status`, `run.result`, `run.completed`,
  `run.failed`, `run.aborted`.
- **Stopping** aborts the active search/model request through a per-run
  `AbortController` and emits exactly one terminal event.
- **Evidence** is stored as registered sources plus claim-to-source links. Final
  writers may cite only those source IDs; invented citations are removed and
  incomplete branches remain visible as warnings and coverage counts.
- **Bounds** cap searches, model calls, sources, observed tokens, elapsed time,
  and consecutive no-progress branches. Reaching a bound produces an honest
  partial-result warning instead of an unbounded retry loop.

## ChatMock wiring (why it needed more than a base URL)

ChatMock is OpenAI-*compatible*, not OpenAI: it proxies the ChatGPT Responses
API and **ignores `response_format`**, so the AI SDK's JSON structured-output
mode would leave the schema unenforced. The engine therefore runs object
generation in **tool mode** (`generateObject({ mode: 'tool' })`), where the
schema becomes a forced function call whose arguments are the object.

That required one fix inside `chatmock/`: Chat Completions clients force a
function with `tool_choice: {type:"function", function:{name}}`, but the
Responses API wants the name at the top level, so upstream rejected every forced
tool call with `Missing required parameter: 'tool_choice.name'`. See
`convert_tool_choice_chat_to_responses` in `chatmock/chatmock/utils.py`
(regression test: `tests/test_routes.py::test_chat_completions_normalizes_forced_tool_choice`).
This fix benefits any client using forced tool calls, not just this agent.

Engine-side changes (in the `deep-research` clone):

| File | Change |
| --- | --- |
| `src/ai/providers.ts` | ChatMock provider (`structuredOutputs: false`), preferred when `CHATMOCK_BASE_URL` is set; `objectGenerationMode()`; `getModelInfo()` for health |
| `src/ai/search.ts` (new) | pluggable search layer: ChatMock `web_search` or Firecrawl |
| `src/ai/search.test.ts` (new) | backend selection + citation extraction |
| `src/deep-research.ts`, `src/research-types.ts`, `src/citations.ts` | budgeted adaptive work queue, source-bound evidence, coverage, citation validation, and hard cancellation |
| `src/api.ts` | authenticated loopback run service with durable snapshots, bounded replay, restart recovery, and active-request cancellation |

Because the clone carries its own `.git`, these edits are local to it: re-cloning
or pulling upstream drops them.

## Search backends (`src/ai/search.ts`)

The engine's Firecrawl-only search layer was replaced with a two-backend module
returning one shape, `{ contents: string[]; urls: string[] }`:

| Backend | What it returns | Credential |
| --- | --- | --- |
| `chatmock-web-search` (default) | one cited synthesis per query, produced upstream by the model with `responses_tools: [{type:"web_search"}]`, plus the URLs it cited | none |
| `firecrawl-cloud` / `firecrawl-self-hosted` | real SERP results scraped to markdown | `FIRECRAWL_KEY` or `FIRECRAWL_BASE_URL` |

`DEEP_RESEARCH_SEARCH_PROVIDER` = `auto` (default; prefers ChatMock) | `chatmock`
| `firecrawl`. Asking for a backend that is not configured yields "no backend",
never a silent switch to the other one.

Honest limits of the ChatMock backend, worth knowing before trusting a report:

- **It is a synthesis, not a scrape.** The engine learns from the model's cited
  write-up of what it read, not from page text. Facts are one paraphrase further
  from the source than with Firecrawl, and coverage is whatever the upstream
  search chose to open.
- **Uncited answers are discarded.** `chatmockSearch` returns zero results when
  the response carries no URLs, so a model answering from memory cannot become a
  "learning". A query that finds nothing contributes nothing; if every query
  comes back empty the run fails with `no_search_results` rather than writing a
  confident report about nothing.
- **`tool_choice` cannot force it.** ChatMock only accepts `auto`/`none` for
  `responses_tool_choice`, so search use is prompt-driven — which is exactly why
  the uncited-answer guard exists.
- **It is slow.** Each search is a full upstream model call:
  `DEEP_RESEARCH_SEARCH_TIMEOUT_MS` defaults to 5 minutes and a breadth 2 /
  depth 1 run takes ~5 minutes end to end.

Reasoning prefixes (`<think>…</think>`) are stripped, and `utm_*` tracking
parameters are removed from cited URLs before they are stored.

Engine tests: `npx tsx --test src/ai/search.test.ts` (9 tests: backend selection,
citation extraction, the uncited-answer guard, gateway failures). Note
`src/ai/text-splitter.test.ts` has one failing case that came with the upstream
clone and is unrelated to this work.

## Configuration

Root `.env` (service side) and `dashboard/.env.local` (dashboard side); see both
`.env.example` files.

| Variable | Default | Notes |
| --- | --- | --- |
| `DEEP_RESEARCH_MODE` | `optional` | `disabled` starts nothing and shows the agent disabled; `required` may fail startup |
| `DEEP_RESEARCH_URL` / `DEEP_RESEARCH_PORT` | `http://127.0.0.1:7722` / `7722` | loopback only; kept separate from Postiz on 7721 |
| `DEEP_RESEARCH_SECRET` | generated per launch | shared by the launcher with the dashboard; never reaches the browser |
| `DEEP_RESEARCH_MAX_CONCURRENT_RUNS` | `2` | service-side ceiling |
| `DEEP_RESEARCH_STATE_DIR` | `.runtime/deep-research` | keyless local run/event snapshots; requester context is excluded |
| `DEEP_RESEARCH_MAX_EVENTS_PER_RUN` | `2000` | bounded replay history per run |
| `DEEP_RESEARCH_STEP_TIMEOUT_MS` | `180000` | per model step; the engine's upstream default (60 s) is tight for reasoning models |
| `DEEP_RESEARCH_REQUEST_TIMEOUT_MS` | `15000` | dashboard -> service call timeout |
| `CHATMOCK_BASE_URL` / `CHATMOCK_MODEL` / `CHATMOCK_API_KEY` | `…:8765/v1` / `gpt-5.6-sol` / `local` | the LLM **and**, by default, the search |
| `DEEP_RESEARCH_SEARCH_PROVIDER` | `auto` | `auto` \| `chatmock` \| `firecrawl` |
| `DEEP_RESEARCH_SEARCH_TIMEOUT_MS` | `300000` | one search call; ChatMock's web search is an upstream model call |
| `DEEP_RESEARCH_CONCURRENCY` | `2` | parallel searches per round (falls back to `FIRECRAWL_CONCURRENCY`) |
| `FIRECRAWL_KEY` / `FIRECRAWL_BASE_URL` | empty | optional alternative search backend |

Per-user launch rate limit: 5 runs / 10 min (dashboard side). Run shape limits:
query ≤ 4000 chars, breadth 1–10, depth 1–5.

## Running it

```bash
npm install --prefix deep-research        # once (engine deps)
node scripts/start-deep-research.mjs      # just this service
node scripts/dev-all.mjs                  # full stack (starts it automatically)
curl http://127.0.0.1:7722/health         # model + search backend + readiness
```

`scripts/dev-all.mjs` never blocks on it: an unhealthy service leaves the rest of
Breadboard untouched and the Agents tab explains what is missing.

## Cost and time shape

Breadth and depth seed a work budget; they no longer expand a full recursive
tree. The supervisor de-duplicates queries, runs at most the configured
concurrency, and stops on no-progress work or a hard budget. Default research
caps include `breadth × depth` searches (maximum 40), one analysis call per
search plus planning, 100 sources, 180k observed tokens, and 10 minutes.
ChatMock search usage is counted even when an uncited response is discarded.
The run card labels that total as processed tokens, not answer size.

## Not done

- **Packaged desktop app**: the service is not registered in
  `desktop/src/main/service-definitions.ts` and the engine's `node_modules` are
  not bundled by `desktop/scripts/prepare-app-resources.mjs`. Deep Research is
  dev-stack only today.
- **Report destination**: the report is copy/download only — it is not written
  into a garden.
- **No per-source scraping on the ChatMock backend**: cited URLs are recorded but
  never fetched, so the engine cannot quote a page it was not shown. Configure
  Firecrawl if a run needs page-level text.
