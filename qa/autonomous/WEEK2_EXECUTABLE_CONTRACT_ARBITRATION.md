# Breadboard W2-3D Executable Contract Arbitration

## Decision

**EXECUTABLE CONTRACTS CLOSED**

All eight ROUTE_QUERY and PROJECTION targets were settled by running the real
production code, inspecting consumer semantics, and proving each oracle detects
a seeded violation. Both families resolve the same way, and neither is a product
defect.

This is not the overall W2-3 decision. 30 rows remain `UNRESOLVED_CONTRACT`.

---

## Execution snapshot

| Field | Value |
| --- | --- |
| `baseCommit` | `9e46a6dd9152a1aafa9f3cf5beab9ee9036b91fe` |
| `sourceSnapshotFingerprint` | `d3bbea1179c7246e…` |
| `environmentFingerprint` | `13a9343f1161362e…` |
| `executionSnapshotId` | `e57c28dcdfe6961b…` |
| `checkoutLineEndingPolicy` | `core.autocrlf=false` (per command, deterministic) |
| Repository `core.autocrlf` | `true` — unchanged, as the developer set it |

---

## ROOT-4B / ROUTE_QUERY

**Asserted contract.** Three tests require `/api/hermes/sessions?surface=…` to
appear inside `use-agent-session.ts` and `garden-agent-chat.tsx`.

**Actual boundary.** The literal now lives in
`lib/hermes/session-client.ts :: loadHermesSessionSummaries`; both asserted files
import it. The consumer is `api/hermes/sessions/route.ts`, which recovers the
surface with `parseSurface` and then filters conversations by it — so the real
contract is that the server can recover *exactly* the surface that was sent.
Getting that wrong is cross-surface conversation leakage.

**Runtime behaviour.** The exported production function was called with a stubbed
`fetch` across 13 inputs — valid surfaces, spaces, Unicode, `&`, `=`, `?`, `#`,
`/`, `\`, `%`, an already-encoded value, and empty — and each captured URL was
parsed with `URL`/`URLSearchParams`.

| Invariant | Result |
| --- | --- |
| Path is exactly `/api/hermes/sessions` | HOLDS |
| Every value round-trips byte-exactly | HOLDS |
| Reserved characters cannot inject a second parameter | HOLDS |
| Valid surfaces accepted by the consumer | HOLDS |
| Invalid surfaces refused, not silently defaulted | HOLDS |
| Request issued `no-store` | HOLDS |

The `a&surface=dashboard_terminal` case matters most: it round-trips as a single
literal value, so a crafted surface cannot forge a second parameter.

**Classification: `STALE_TEST` / `IMPLEMENTATION_COUPLING`, HIGH.** The contract
is intact and stronger than when the assertions were written — the centralised
client also deduplicates concurrent requests and caches per surface. The
assertions pinned which file the literal is written in, which no consumer can
observe.

**Counterexample proof.** Five seeded builder mutations, all caught, control
clean: encoding removed, double encoding, wrong query key, wrong path, and
surface hardcoded to `dashboard_terminal` — the cross-surface leakage case.

---

## ROOT-4B / PROJECTION

**Asserted contract.** Five tests pin session-transcript projection inside
`api/hermes/sessions/route.ts`.

**Root cause — one extraction explains all five.** Presentation was extracted
from the route into `lib/hermes/session-presentation.ts`, which the route
imports. Lines 118–129 of that module contain, together, four of the failing
assertions' patterns: the branch-projection call *verbatim*, the shared
`presentConversationMessage`, `memoryUpdatedClientMessageIdsForSession`, and
`presented.metadata.responseDurationMs`. The tests read the old location.

**Runtime behaviour.** The real `projectConversationBranchMessages` was executed
over a fixture whose second turn was regenerated twice.

| Invariant | Result |
| --- | --- |
| Only the active branch survives (`[1,2,9,10]`) | HOLDS |
| Abandoned and superseded attempts excluded | HOLDS |
| The surviving turn is the newest sibling | HOLDS |
| Unbranched conversation returned unchanged | HOLDS |
| Empty transcript projects to empty | HOLDS |
| Route reaches the extracted module | HOLDS |
| Extracted module applies the asserted call verbatim | HOLDS |

**Field classification.** Active-branch membership and message id/content are
`REQUIRED_CONTRACT_FIELD`. *Which module the call is written in* is an
`IMPLEMENTATION_DETAIL` — unobservable to any consumer.

**Classification: `STALE_TEST` / `IMPLEMENTATION_COUPLING`, HIGH.**

**Counterexample proof.** Five seeded projection mutations, all caught, control
clean: projection skipped entirely, oldest sibling kept, branch-metadata rows
dropped, assistant rows dropped, empty transcript synthesising a row.

---

## Product bugs confirmed

**None.** Both families preserve their externally meaningful behaviour.

## SH1 repairs

None. No `PRODUCT_BUG` arose, so the repair path was correctly not entered.

## Test corrections

**None applied**, and this is a deliberate scope decision rather than an
omission. The replacement assertions are specified — execute the builder and
assert the recovered surface; execute the projection and assert the active
branch — and both are proven non-vacuous. But all eight targets, plus the held
`ROOT-5` case and the 18 `UI_SHAPE` rows, turn on the same unanswered question:
*when should a source-shape assertion be replaced by an executable one?*
Applying eight replacements now would set that policy by accident.

The evidence needed to apply them is now in hand; the policy decision is not.

## Prediction vs actual flips

Predicted: zero flips, because no correction was applied. Observed: zero flips.
A no-flip prediction is still a prediction — any target changing state would have
signalled an unintended side effect.

## Targeted stability

Each arbitration ran three independent times, no retries, deterministic every
time: ROUTE_QUERY 3/3, PROJECTION 3/3.

## Updated contract map

| State | Before | After |
| --- | ---: | ---: |
| `UNRESOLVED_CONTRACT` | 38 | **30** |
| `ENVIRONMENT_BLOCKED` | 13 | 13 |
| `RESOLVED_HARNESS_BUG` | 10 | 10 |
| `RESOLVED_STALE_TEST` | 1 | **9** |
| `RESOLVED_FIXTURE_BUG` | 5 | 5 |

Eight rows moved from `UNRESOLVED_CONTRACT` / MEDIUM to `RESOLVED_STALE_TEST` /
HIGH, each carrying runtime, consumer and counterexample evidence.

## Integrity

| Check | Result |
| --- | --- |
| Assertions weakened | **0** |
| Direct product edits | **0** |
| Unauthorized mutation | 0 |
| Repository git config changed | **no** — `core.autocrlf` still `true` |
| Global git config changed | no |
| Developer files changed | no |
| Vendored roots changed | no |
| `node_modules` intact | yes |
| Secret findings | 0 |
| Commit / stash / reset | none |
| `.gitattributes` added | no |

All mutations for counterexample proofs were applied to local stand-in builders,
never to product source. Nothing was seeded and left behind.

## Decision rationale

All fifteen closure criteria hold: both families executed against real production
paths (1–3); consumer semantics inspected on both sides (4); every target has an
evidence-backed final classification at HIGH confidence (5); none remains LOW
through skipped execution (6); both oracles proven non-vacuous against seeded
violations (7); flips predicted before the (empty) correction set and matched
(8–9); no `PRODUCT_BUG` so SH1 was correctly not used (10); no weakening, no
product mutation, no config change, no dependency change, no secret (11–15).

## Next recommended cluster

1. **`ROOT-4B-BEHAVIOURAL` (11)** — already behavioural assertions; reproduce
   each value or thrown error. Likeliest place for a real `PRODUCT_BUG`.
2. **`UI_SHAPE` policy (18)** — decide when a source-shape assertion should
   become executable, then apply it to `UI_SHAPE`, the eight settled here, and
   the held `ROOT-5` case in one consistent change.
3. **`PROSE_COPY` (7)** — determine whether consumers depend on exact strings.
4. **`ROOT-6` residuals (3)**, then the `learnerAction` human decision.
5. **`ROOT-8` (13)** — one frozen snapshot, both arms, to separate environment
   artefacts from post-freeze fixes.

Not ingestion, and not Week 3, until W2-3 closes.
