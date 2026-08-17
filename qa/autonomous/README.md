# Breadboard autonomous Electron QA and repair protocol

This directory defines the exploratory scenario inventory and the bounded
repair contract for Breadboard's user-level Electron QA layer. The system under
test is the actual Electron application and the services that its main process
starts and supervises. A browser pointed at an already-running dashboard is not
an equivalent substitute.

The primary controller is an external Claude Code or Codex process using
Playwright's Electron API. Hermes, Garden Chat, agents, skills, MCP connections,
artifacts, terminal execution, GBrain, UI-TARS, and every other Breadboard
runtime remain systems under test; none may be the authority that declares
itself healthy.

## Current contract status

This is an **L3 repository/file-edit loop**. It is manual-first, bounded to one
scenario per invocation, and requires isolated application data, an isolated
git worktree or equivalent reviewer-approved branch, deterministic checks, a
diff review, a rollback path, and a receipt.

The Agent Loop Engineering Kit is present in the repository, but the formal
`agent_loop_run` tool required by the skill was unavailable when this contract
was authored. Consequently, no formal validation, quality score, dry-run,
privacy-scan receipt, activation, or schedule is claimed here. The contract's
schema fields were authored against the checked-in kit schema. Before any
unattended activation, use the formal runner to:

1. validate `qa/autonomous/loop-contract.yaml`;
2. score it and improve it until the score is at least 85;
3. dry-run it and render/read the resulting receipt; and
4. privacy-scan `qa/autonomous/`.

A contract dry-run proves only that the loop is bounded and readable. It never
proves that Breadboard works or that a repair is correct. Breadboard does not
schedule or activate this loop from these files.

## Source-grounded feature boundary

The scenario manifest is grounded in implemented repository surfaces rather
than a wishlist. In particular, it reflects:

- the Electron lifecycle, welcome gate, hidden dashboard preload, loopback
  navigation restrictions, typed preload bridge, service supervisor, restart
  budget, data-directory override, and process-tree cleanup under `desktop/`;
- gardens, nested folders, garden editing, import/export, Markdown/PDF
  ingestion, link ingestion, Garden Chat, Learn, Quartz reading/editing, and
  persistence under `dashboard/src/app`;
- Hermes sessions, history search, conversation branches, attachments,
  terminal execution/cancellation, skills catalog/install lifecycle, agents,
  artifacts, permissions, and recovery routes under `dashboard/src/app/api`;
- existing unit/integration coverage in `desktop/tests` and `dashboard/tests`;
  and
- explicitly optional GBrain, UI-TARS, CAD, video transcription, and external
  catalog/network integrations, whose absence must be reported honestly.

The inventory does not promise that an optional runtime is installed or
configured. Missing functionality outside this boundary is `MISSING_FEATURE`,
not implicit permission to add a new product.

## Exact repair protocol

Every scenario follows this conceptual protocol exactly:

```text
RUN SCENARIO
      ↓
SUCCESS?
 ├── YES → record pass and continue
 └── NO
      ↓
collect evidence
      ↓
reproduce once
      ↓
classify failure
      ↓
confirmed Breadboard bug?
 ├── NO → record blocker/environment issue
 └── YES
      ↓
locate root cause
      ↓
make smallest repair
      ↓
add regression test
      ↓
run relevant existing tests
      ↓
restart/relaunch affected runtime
      ↓
replay exact original user scenario
      ↓
success?
 ├── YES → record verified repair
 └── NO → continue diagnosis
```

"Continue diagnosis" is bounded by the contract. It never means indefinite
guessing: stop at the iteration/runtime limit or on a repeated error.

## L3 bounded-loop rules

One loop invocation handles exactly one manifest scenario and, at most, one
root-cause repair. The loop must:

1. accept a scenario ID, repository revision, explicit allowed paths, relevant
   baseline commands, Electron launch mode, and a fresh QA run root;
2. read repository instructions and the previous receipt before acting;
3. verify that every mutable application path resolves below the fresh QA run
   root before launching the app;
4. start read-only against repository source, then patch only after a failure
   has been reproduced and classified as repair-eligible;
5. make all source edits in an isolated worktree or equivalent explicitly
   approved isolation boundary;
6. cap the run at three diagnosis/repair iterations and 120 minutes;
7. stop on the same error twice, any failed safety check, any forbidden action,
   a missing required input, a human gate, or inability to verify isolation;
8. preserve a scoped diff and rollback instructions; and
9. write a receipt even when it passes, blocks, fails, or reaches a gate.

The loop may advance to another scenario only as a new invocation. P0 and P1
findings take priority over P2/P3 work.

## Before a scenario

Record the existing baseline separately from exploratory results. Each
available relevant suite is recorded as `PASS`, `FAIL`, `SKIPPED`, or
`ENVIRONMENT_BLOCKED`; pre-existing failures are evidence, not automatically a
new Breadboard regression.

Resolve the scenario's `dependencies` before interaction:

- a missing **required** local runtime, fixture, build asset, or isolation
  control blocks the scenario as `TEST_ENVIRONMENT`;
- an unavailable third-party service, network endpoint, provider account, or
  optional executable blocks only the dependent assertions as
  `EXTERNAL_DEPENDENCY`;
- an intentionally disabled optional Breadboard integration is normally tested
  for a truthful, usable degraded state rather than marked as a product bug;
- credentials are never solicited, printed, copied into fixtures, or inferred;
  and
- a blocked scenario produces a finding/receipt and the inventory continues
  unless the block prevents safe Electron lifecycle or data isolation.

Use a unique disposable directory for Electron `userData` and all Breadboard
mutable state. Do not launch when any resolved database, Quartz content,
garden, conversation, artifact, skill, log, cache, credential, or agent-state
path points at the person's normal Breadboard data or at unrelated repository
data. Preserve failed-run artifacts only when requested by the harness.

## Interaction and evidence

Operate the renderer through semantic roles, labels, placeholders, text, or
stable test IDs. Do not use coordinate clicking or brittle DOM ancestry when a
semantic control exists. Wait for bounded readiness, DOM, network, run-state,
or service-state signals rather than arbitrary sleeps.

On every failure, preserve before editing:

- the exact manifest scenario and concrete inputs;
- expected and actual behavior;
- Electron main-process output, uncaught exceptions, rejections, and exits;
- renderer errors/warnings and uncaught page exceptions;
- meaningful request failures and unexpected 4xx/5xx responses;
- redacted logs from services touched by the workflow;
- a failure screenshot and Playwright trace; and
- process, application-data-path, launch-mode, revision, and timing metadata.

A normal 404, an unavailable declared-optional integration, or non-exact LLM
wording is not automatically a defect. Never place secrets or capability
tokens in artifacts.

## Classification and repair eligibility

Classify every failure before editing production code:

| Classification | Meaning | Automatic repair eligibility |
| --- | --- | --- |
| `PRODUCT_BUG` | Implemented Breadboard behavior violates a supported invariant. | Yes, after reproduction and root-cause evidence. |
| `TEST_ENVIRONMENT` | Harness, fixture, build, host, isolation, or setup failure. | No. |
| `EXTERNAL_DEPENDENCY` | Optional provider, account, network, executable, or third-party service is unavailable/broken. | No. |
| `EXPECTED_BEHAVIOR` | Observed behavior matches the supported contract. | No. |
| `FLAKY` | Failure cannot be deterministically reproduced or alternates without a known cause. | No; gather evidence and quarantine narrowly if needed. |
| `MISSING_FEATURE` | The requested behavior is not implemented. | Only when existing UI/product behavior clearly promises it already works; otherwise record only. |

Use these severities:

| Severity | Definition |
| --- | --- |
| `P0` | Security issue, data corruption/loss, or application unusable. |
| `P1` | A core user journey is completely broken. |
| `P2` | A meaningful feature fails but has a workaround. |
| `P3` | A minor functional problem. |

If classification or promised scope is ambiguous, stop for human review. Do
not turn exploratory QA into product-roadmap implementation.

## Reproduction and diagnosis

Before any repair:

1. preserve the exact task, expected result, actual result, and evidence;
2. relaunch/restart the affected runtime into the same isolated precondition;
3. reproduce the exact workflow once, without changing inputs to make it pass;
4. identify the responsible code path;
5. state a plausible causal chain that explains all material evidence; and
6. choose the smallest test layer capable of detecting the regression.

If the second attempt passes, classify `FLAKY` unless evidence establishes a
deterministic product race. Never patch nearby code merely because it appears
related.

## Minimal repair policy

For a confirmed repair-eligible defect, change only the responsible path. Add
targeted error handling or diagnostics where useful and add a permanent
regression test. Preserve existing architecture and UI unless a small semantic
label/test hook or direct defect repair requires a non-visual UI change.

Do not rewrite unrelated systems, replace frameworks, weaken validation,
bypass authentication, disable capability-token checks, expose loopback
services publicly, mock broken production behavior, swallow broad exceptions,
or relax tests to accept the defect. No repair may alter unrelated user work.

## Regression, restart, and replay

Choose the smallest durable regression layer:

- pure logic defect: unit test;
- API/serialization/persistence contract: integration test;
- renderer or UI lifecycle: Electron Playwright test;
- startup, process, path, IPC, or shutdown defect: desktop lifecycle/smoke test.

The regression must fail for the pre-repair behavior and pass after the repair.
Run the directly relevant existing suites plus required build/type/lint checks.
Then fully restart or relaunch every affected runtime and replay the exact
original user scenario through Electron. Verification requires the original
success criteria, no new fatal diagnostics, isolated persistence when expected,
and clean child-process shutdown. Compilation alone is never verification.

If replay fails, resume diagnosis only within the remaining bounds. Do not
change the scenario, expected result, or regression assertion to manufacture a
pass.

## Security boundaries

QA hooks may activate only under an explicit test mode and must leave
production behavior unchanged. Never expose API keys, service secrets, or
capability tokens to the renderer or logs; disable authentication or approval
gates; grant arbitrary filesystem/IPC access; bind internal services beyond
loopback; send external messages/posts; or operate on real gardens,
conversations, credentials, and app data.

Native dialog interception must be deterministic, scoped to QA mode, and
limited to fixture paths below the QA run root. External navigation remains
subject to the Electron allowlist and OS-browser policy.

## Human gates

Stop and request explicit approval before deletion or migration of non-QA
data, secret/credential access, any external send or public posting, payment or
billing activity, production deployment, broad service restart, installer or
uninstaller actions outside an isolated smoke environment, security-gate
changes, expanding allowed paths, applying a candidate outside its isolated
worktree, or any commit/push/PR/merge.

Use exactly:

```text
APPROVE LOOP ACTION: <action> / <scope> / <rollback>
```

Approval for one action does not authorize later actions or a wider scope.

## Stop conditions

Stop, preserve evidence, and write a receipt when:

- a required input is missing;
- QA state cannot be proven isolated;
- verification fails or cannot observe the promised invariant;
- the same error occurs twice;
- three iterations or 120 minutes are reached;
- a forbidden action/path is touched or proposed;
- a human gate is reached;
- the app or required service cannot be shut down safely;
- a repair would require a broad redesign or unrelated feature; or
- the scenario succeeds and its evidence has been recorded.

Trying unrelated alternatives after a stop condition is automated damage, not
resilience.

## Week 1 self-test and repair tooling

The contract above says what the loop must do. These modules make the safety
half of it structural rather than advisory, so a model cannot talk its way past
a boundary:

| Module | Responsibility |
| --- | --- |
| `qa/electron/classification.ts` | The failure classifier the exploratory probes use, extracted so it can be exercised with deterministic fixtures. |
| `qa/autonomous/lib/repair-gate.mjs` | `classification !== PRODUCT_BUG` ⇒ no production source mutation. Also classifies every repo path and refuses forbidden trust boundaries outright. |
| `qa/autonomous/lib/assertion-integrity.mjs` | Reads the candidate diff and rejects the obvious ways an oracle gets softened; flags ambiguous oracle edits for a human. |
| `qa/autonomous/lib/repair-worktree.mjs` | Disposable `.qa-worktrees/<finding-id>/` isolation, scoped main-tree comparison, rollback text. |
| `qa/autonomous/lib/receipt.mjs` | Validates and secret-scans a receipt before it is written; `VERIFIED_REPAIR` cannot be claimed without a passing replay, a regression test, verified isolation, and a non-rejected guard verdict. |

Commands:

```text
npm run qa:selftest            # harness unit suites + the Playwright selftest project
npm run qa:selftest:electron   # injected-fault meta-run; passes when the harness fails correctly
npm run qa:selftest:burn-in    # repeated deterministic core path, no retries
npm run qa:repair:experiments  # the controlled seeded-defect self-heal experiments
```

`npm run qa:selftest:electron` runs the `injected` Playwright project, which is
*expected to fail*. The meta-runner asserts that each injected fault became a
reported failure carrying a screenshot, a diagnostics bundle, and a trace, and
that the run exited non-zero. A green exit from that command means the harness
failed correctly; a red one means it cannot be trusted to notice a real defect.

The seeded-defect experiments in `qa/autonomous/experiments/seeded-defects.mjs`
are deliberately thrown away with their worktree. Their point is to prove the
loop can repair, not to keep artificial fixes. Each one must also demonstrate
that its new regression test *fails* when the defect is reintroduced; a
regression test that still passes is recorded as vacuous and fails the run.

## Findings and receipts

Write per-run findings beneath the harness's ignored QA-results directory and
validate their shape against `finding.schema.json`. The committed
`findings/` directory is intentionally empty; it is not evidence that a run
occurred. A receipt records the request, scenario revision, allowed paths,
commands with exit codes, evidence paths, classification/severity, diff,
tests, reviewer result, replay result, rollback, unresolved risks, and the
actual stop reason.

Do not create or populate `FIRST_QA_REPORT.md` until scenarios have genuinely
been executed. Never infer PASS, a repair, or verification from documentation,
schema validation, compilation, or a contract dry-run.

## Future native Windows layer

Playwright Electron remains the primary mechanism. A later, deliberately small
computer-use layer may cover installer UI, the real Windows file picker,
Explorer drag-and-drop, tray interactions, native notifications,
minimize/maximize behavior, and application-protocol activation. That layer
must use disposable Windows state, preserve the same evidence and gates, and
must not become a prerequisite for renderer-level scenarios or a source of
arbitrary OS mouse automation.
