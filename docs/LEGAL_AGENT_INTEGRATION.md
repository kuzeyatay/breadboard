# Legal Agent (`/agents:legal`)

Attach contracts, filings or a data room, say what you need — a review, an
issues list, a memo, a draft — and get back the finished document. Built to
`docs/ADDING_AN_AGENT.md`.

The runtime is the execution harness from **Harvey LAB** (`harvey-labs/`), the
open Legal Agent Benchmark. The agent is named for the work rather than the
stack, on the same reasoning as the Socials Manager: nobody asks for a harness
run, they ask for a contract to be reviewed.

## What was taken, and what was left

The clone is two things. A **task corpus** — 1,671 synthetic assignments across
27 practice areas, each with documents and a pass/fail rubric — and an
**execution harness**: a system prompt, six closed-workspace tools (`bash`,
`read`, `write`, `edit`, `glob`, `grep`), and skill manuals for producing
`.docx` / `.xlsx` / `.pptx`. There is also an LLM judge and a reporting layer.

Only the harness is wired up. Breadboard supplies the assignment and the
documents where a benchmark task would have been, and nothing reads `tasks/`,
`evaluation/`, or the judge. Grading a model is a different product from doing
someone's legal work, and this is the second one.

## The three things the clone assumes and this machine does not have

**Podman.** Every tool call in the benchmark runs inside a rootless container
(`--network=none --cap-drop=ALL`, read-only `documents/`). That is right when the
documents are adversarial fixtures and the model is the thing on trial. Here the
documents are the user's own and the machine is theirs, and Podman is not
installed. `HostSandbox` in `scripts/legal-bridge.py` re-implements the sandbox
interface over a per-run directory — as a **subclass** of the clone's `Sandbox`,
so the parts that enforce the boundary (`assert_sandbox_path`, `is_writable`,
the mount-escape check in `_to_host`) are inherited rather than rewritten. The
`write` and `edit` tools still cannot touch `documents/`, and no tool can
address anything outside the run directory. What is genuinely lost is process
isolation for `bash`, and the **"Let it run commands" switch is what replaces
it** — that is why that setting exists and why its help text says so.

**`parse-doc`.** Reading a `.docx`/`.pdf`/`.pptx`/`.xlsx` goes through
`sandbox.exec("parse-doc …")`, a console entry point that only exists inside the
container image. `HostSandbox.exec` intercepts that one command and calls the
clone's own parser functions in-process.

**Pandoc.** The clone's `.docx` reader shells out to it. `pypandoc-binary` is
installed into the environment, so pandoc ships with the agent rather than being
required of the machine; if it is missing anyway the bridge falls back to
MarkItDown and both health and the run card say so.

## Files

```
scripts/legal-bridge.py              HostSandbox, streaming wrappers, the run
dashboard/src/lib/legal/
  identity.ts                        command, id, name, parser, inline flags
  runtime.ts                         clone/venv/bridge/shell discovery, health
  settings.ts                        stored settings → a run's shape
  workspace.ts                       per-run tree; attachments → documents
  artifact.ts                        deliverables → artifacts of the chat
  run-manager.ts                     spawn, NDJSON → events, abort, cleanup
  setup.ts                           builds harvey-labs/.venv on the user's word
dashboard/src/app/api/legal/         runs, events, abort, files, health, setup
dashboard/src/app/components/hermes/inline-legal-run.tsx
dashboard/tests/legal-agent.test.mjs
```

The bridge lives in Breadboard's `scripts/`, not in the clone, so a `git pull`
in `harvey-labs/` never conflicts with a file of ours.

## The model layer

ChatMock, through the harness's own OpenAI adapter (the Responses API) by
setting `OPENAI_BASE_URL`. No second model layer was added. Provider-prefixed
ChatMock models work: the live verification below ran on
`cliproxy/claude-sonnet-5`, because the ChatGPT account was rate-limited.

## Setup

`harvey-labs/.venv`, built from the agent's settings — never behind a run. The
install list is **not** the clone's `pyproject.toml`: that file is written for
the benchmark and pulls in four provider SDKs, matplotlib and seaborn for the
comparison dashboards, and pytest. `RUNTIME_PACKAGES` in `setup.ts` is what the
harness actually imports on the path Breadboard drives, plus `pypandoc-binary`.

`uv venv --python 3.13` is preferred because the clone caps itself below 3.14
and the system Python is often ahead of that.

## Two behaviours found by running it, not by reading it

**`python3` reached the Windows Store stub.** A venv's `Scripts` directory has
`python.exe` but no `python3.exe`, so under Git Bash `python3` fell through to
the Store shim, which prints "Python was not found" and exits non-zero. Every
skill manual tells the agent to run a script with `python`. It cost two turns
and looked like a broken skill. `_install_python_shims` now writes `python` and
`python3` shims into `<workspace>/.bin` and puts that first on PATH.

**Windows pipes mangled the memo's punctuation.** cp1252 *has* an em dash, so
Python encoded one happily as a single byte that Node then read as broken UTF-8
— no error anywhere, just a `` in the middle of a heading. The bridge now
reconfigures its own stdout to UTF-8 rather than trusting the caller's
environment.

## The known limitation

Breadboard's attachment pipeline extracts `.docx`, `.pdf`, `.xlsx` and `.pptx`
to text in the browser and keeps only that text. So the agent receives a
faithful *reading* of a Word file but not the Word file. Producing a new
document works normally; **rewriting an original** — tracked-changes redlining,
comment threads, the parts of the `docx` skill that start from a source file —
has nothing to rewrite. Lifting that means carrying original bytes through the
attachment store, which is a change to the platform rather than to this agent.

For the same reason a retried turn runs without documents: only an attachment's
*name* is kept with a message, never its text. The run says so rather than
pretending it had them.

## Verified live (2026-08-09)

Against the real clone and real ChatMock, end to end:

- `.docx` read through pandoc; `glob`/`read`/`write`/`bash` all exercised.
- A full assignment producing **two** deliverables — `issues-memo.docx`
  generated by the clone's own `docx` skill script and validated by its
  `validate.py`, plus `response.md` — both landing in the run's output.
- The `python3` shim, re-run after the fix: resolves to the venv interpreter.
- "Let it run commands" off: the tool list drops to five, no `bash` is offered,
  and the run still answers with a citation.

Not exercised live: storing a deliverable in the artifact store, which needs a
real conversation, and the two chat surfaces, which were verified structurally
(`npm test`, `tsc`, `eslint`) rather than by clicking.
