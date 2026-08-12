# iFixAi maintenance loop

Breadboard integrates the pinned iFixAi checkout as an internal, headless
maintenance evaluator. It has no page, settings control, chat command, API
route, toast, or ordinary-user approval step.

The useful purpose is regression detection for the static Hermes assistant
prompt. In `repair` mode it can also ask a model for one small behavioral
overlay, evaluate the unchanged baseline and candidate with the same fixture,
suite, seed, and independent judge, and stage the candidate when it materially
improves the result. It never activates that candidate.

## Safety boundary

- The loop reads the static prompt files once per run. It cannot edit them.
- Every evaluation and candidate is written beneath an isolated runtime run
  directory (`.runtime/ifixai-maintenance` in development).
- Only one run can hold the process-wide file lock.
- A run makes at most two candidate attempts; the default is one.
- Repair requires an explicit cross-vendor SUT/judge pair.
- An improvement below `0.15` is rejected because iFixAi says smaller point
  differences are not statistically distinguishable at typical sample sizes.
- Any category or inspection regression, partial run, evaluator error, or
  self/same-vendor judgment rejects the candidate.
- A passing candidate becomes `staged-candidate.md` beside its receipt. No
  runtime reads this file, and no activation mechanism is implemented.
- iFixAi telemetry and `DO_NOT_TRACK` are forced off for every bridge process.
- API credentials travel through stdin/environment only and are redacted from
  error receipts.

The machine-readable contract is
`hermes-config/ifixai/loop-contract.yaml`. The target fixture is synthetic and
contains no user content. Its structural governance scores test the declared
fixture adapter, not Breadboard's live capability broker; each report and
receipt records that limitation.

## Developer setup

Prepare the isolated interpreter after cloning:

```powershell
npm run setup:ifixai
```

The setup command refuses a checkout other than commit
`4ac9cc1c8765427300d98dc30855c18349610cf1`, installs it under
`.runtime/ifixai-venv`, disables telemetry during validation, and validates the
Breadboard fixture. Desktop packaging performs the same revision check and
installs iFixAi into the bundled Python runtime.

## Operator configuration

The default is off, preventing an unattended clone or installed app from
spending model quota. Operators enable it in the server/desktop process
environment; these are deliberately not user-facing preferences.

Audit only:

```powershell
$env:BREADBOARD_IFIXAI_MODE = "audit"
$env:BREADBOARD_IFIXAI_SUT_MODEL = "gpt-5.6-sol"
```

Proposal-only repair with an independent judge:

```powershell
$env:BREADBOARD_IFIXAI_MODE = "repair"
$env:BREADBOARD_IFIXAI_SUT_MODEL = "gpt-5.6-sol"
$env:BREADBOARD_IFIXAI_JUDGE_MODEL = "anthropic/claude-sonnet-4-5"
```

Both model IDs must be available through local ChatMock. The endpoint itself is
restricted to loopback. Optional controls are:

| Variable | Default | Bound |
|---|---:|---:|
| `BREADBOARD_IFIXAI_SUITE` | `strategic` | named iFixAi suite |
| `BREADBOARD_IFIXAI_INTERVAL_HOURS` | `24` | 1–168 |
| `BREADBOARD_IFIXAI_STARTUP_DELAY_SECONDS` | `120` | 10–3600 |
| `BREADBOARD_IFIXAI_TIMEOUT_MINUTES` | `20` | 2–60 |
| `BREADBOARD_IFIXAI_MAX_ATTEMPTS` | `1` | 1–2 |
| `BREADBOARD_IFIXAI_MINIMUM_IMPROVEMENT` | `0.15` | minimum 0.15 |
| `BREADBOARD_IFIXAI_MAXIMUM_CATEGORY_REGRESSION` | `0.02` | 0–0.10 |
| `BREADBOARD_IFIXAI_SEED` | `1701` | fixed integer |
| `BREADBOARD_IFIXAI_JUDGE_MAX_CALLS` | `200` | 1–500 |

Restart Breadboard after changing operator environment. The scheduler starts
inside the existing server instrumentation lifecycle, waits for its bounded
startup delay, and runs without depending on any open page.

## Receipts

Each run writes `receipt.json` and `receipt.md`, plus iFixAi JSON, Markdown,
summary, and HTML reports. `latest.json` points to the newest receipt. Receipts
include input hashes, the pinned upstream revision, models, score deltas,
rejection reasons, stop reason, and the permanent `activation: forbidden`
decision. They never contain the ChatMock API key.
