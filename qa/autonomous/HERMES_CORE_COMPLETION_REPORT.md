# Hermes answer-leakage audit and corrected completion contract

Date: 2026-08-15 (Europe/Istanbul)

## Decision

The authenticated-provider completion replay is paused. Historical Hermes
scenario receipts are not current PASS evidence for model grounding, context
retrieval, terminal readback, artifact content, or renderer-refresh context.
Those results are superseded by this audit until the corrected specs complete a
fresh replay.

No production or nested Hermes source was changed for this methodology fix.

## Invalidated evidence

The following historical evidence must not be reported as a verified PASS:

- `qa/autonomous/HERMES_QA_REPORT.md` and
  `qa/autonomous/HERMES_PROVIDER_REPLAY_RECEIPT.json` rows for
  `garden-chat-document-grounding`, `garden-chat-follow-up-context`,
  `conversation-isolation`, `chat-cancel-and-recover`,
  `terminal-cancel-and-reuse`, and `desktop-renderer-refresh-persistence`.
- Provider-backed run `20260815120820-4696-d0239b6d` and the older provider/core
  runs, including `20260815150847-6688-d308ee70`.
- The old context receipt that accepted `NEBULA-5842` after the value had been
  supplied again in the retrieval prompt. The same defect affected the earlier
  `COBALT-731` context/grounding checks and terminal checks whose prompt
  contained the expected command output.

The old artifacts remain retained for forensic comparison, but their PASS
labels are historical and superseded, not completion evidence.

## Audit findings

1. Several tests supplied the expected answer in the same prompt that asked the
   model to return it (`echo HERMES_TERMINAL_OK`, literal artifact content, or a
   marker repeated in a readback turn). A model repeating the prompt could pass
   without using the tool, file, or prior context.
2. The previous `visibleAssistantText` helper joined the assistant transcript.
   A marker from an earlier turn could therefore satisfy a later assertion.
   Some `getByText(marker).first()` checks could also select a user bubble.
3. Renderer-refresh checks were vulnerable to asserting a persisted old marker
   rather than the newly restored assistant block.
4. The old core context replay had a real provider/tool completion in the
   database, but its UI criterion raced the renderer and did not prove a
   marker retrieval invariant. That evidence is useful diagnosis only.

## Corrections now in the QA tests

- `qa/electron/specs/hermes/core-completion.spec.ts`
  - Generates random harness-held context, terminal, and recovery values.
  - Introduces each value only in a setup turn; all readback prompts omit the
    value and explicitly state that the expected value is harness-held.
  - Adds renderer-refresh persistence and new-conversation isolation checks
    whose retrieval prompts omit the marker.
  - Splits terminal create, error, recovery, and readback into separate turns.
  - Scopes completion to the newest assistant block and waits for transcript
    persistence before the next turn.
- `qa/electron/specs/hermes/provider-backed-inventory.spec.ts`
  - Replaces fixed grounding/context/isolation values with per-run values.
  - Splits terminal create/read and error/recovery/readback turns.
  - Verifies artifact content in the real artifact viewer rather than trusting
    assistant prose, and scopes branch/turn assertions to a new assistant block.
- `qa/electron/specs/hermes/provider-terminal-inventory.spec.ts`
  - Uses random file contents and retrieval prompts with no expected value.
  - Uses the newest assistant block for completion and refresh checks.
- `qa/electron/specs/hermes/conversational-runtime.spec.ts`
  - Uses a random direct-response sentinel and no longer joins the full
    assistant transcript. This remains a direct-response smoke check, not a
    memory or grounding proof.
- `qa/electron/specs/hermes/renderer-refresh-repro.spec.ts`
  - Uses a random direct-response sentinel. Server transcript role/length data
    is diagnostic metadata only; pass/fail remains an assistant-role renderer
    assertion.

The critical Markdown/Quartz checks remain first-party document-rendering
checks, not model-grounding claims. Exploratory artifact/terminal rows remain
truthfully blocked when no completed model-backed prerequisite exists.

## Coverage of the rest of the QA suite

- `qa/electron/specs/hermes/`: all five pre-existing Hermes specs plus the new
  context correction spec were audited for prompt-supplied expected values,
  assistant-role scoping, refresh/reopen behavior, and file/artifact readback.
- `qa/electron/specs/critical/`: the Markdown/Quartz fixture checks inspect the
  rendered document and do not claim that Garden Chat retrieved its fact;
  terminal and artifact interactions are surface/lifecycle checks or remain
  blocked without a model-backed prerequisite.
- `qa/electron/specs/exploratory/`: required model-backed context, terminal,
  agent, and artifact rows remain explicitly blocked; the empty-chat and
  supporting UI probes do not assert a hidden answer.
- `qa/electron/specs/packaged/`: production-hardening/lifecycle assertions do
  not perform model retrieval and were not promoted or invalidated by this
  answer-leakage audit.
- `qa/autonomous/scenarios.json`, `loop-contract.yaml`, and the autonomous
  README contain scenario contracts and success criteria, not executable
  answer assertions; their affected Hermes rows are governed by the corrected
  Electron specs above.

## Static audit status

- `npm run qa:electron:typecheck`: PASS.
- `npm run qa:electron -- --list --skip-desktop-build`: PASS; 23 tests in 13
  files discovered.
- No QA Electron process remains running after the pause.
- Corrected focused context replay
  `20260815153711-42028-effac560`: **3 BLOCKED, 0 PASS, 0 FAIL**. The
  authenticated provider did not complete the setup/retrieval prerequisite;
  no corrected context invariant was promoted to PASS. See
  [`HERMES_CONTEXT_CORRECTION_RECEIPT.json`](HERMES_CONTEXT_CORRECTION_RECEIPT.json).
- No broader/provider completion inventory has been resumed after this audit.

## Resume gate

Before resuming the broader Hermes pass, run the corrected focused tests and
retain fresh receipts. A model-backed PASS is valid only when all of the
following are true:

1. The expected value is generated by the harness and is absent from the
   retrieval/readback prompt.
2. The value first appears in a separate setup turn or a real tool/file result.
3. The assertion reads only the newest assistant block (or the real artifact,
   file, or viewer), never a concatenated transcript.
4. Conversation refresh/reopen and cross-conversation checks prove the same
   invariant without accepting a value from the prompt itself.
5. Any provider refusal, timeout, stale composer, or missing tool result is
   recorded as `BLOCKED`/`TEST_ENVIRONMENT`, not converted into a PASS.

Until those focused replays produce new receipts, the historical provider
counts in `HERMES_QA_REPORT.md` are audit history only.
