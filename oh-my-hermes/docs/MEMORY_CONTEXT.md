# Memory Context Review

Memory context review is OMH's local, deterministic review surface for
OMH-managed state and wrapper-supplied candidates. Normal users stay in
natural-language Hermes chat. The CLI examples below are agent/operator
control-plane references, not normal-user setup.

It does not read, scrape, invoke, apply, or observe opaque Hermes internal
memory changes.

## V2 Context Model

OMH-owned records, scope items, and blocks use v2 admission and replay data:
opaque identity plus revision, canonical scope, source class, immutable review
linkage, retention, and revalidation. `pending_review`, `blocked`, `rejected`,
legacy v1, stale, expired, malformed, conflicting, superseded, or tombstoned
artifacts are review-visible but cannot influence a recall pack or handoff.

`memory_snapshot/v1`, `memory_inspection/v1`, `memory_review_card/v1`, and
`handoff_context_pack/v1` remain compact review/preparation surfaces. Their
presence is not evidence that a model, provider, or executor used context.

## Source Boundary

Hermes-native and external provider/vector context is `not_omh_reviewed`. It
may nominate one bounded OMH candidate, but it never grants OMH admission or
replay eligibility. A configured Hermes runtime may transmit rendered OMH
prefetch content in its model request; local OMH storage and computation do
not promise no egress.

## Existing Native Memory Review

`memory-sync` is English-canonical prompt guidance. Korean routing triggers
remain supported, with concise Korean help labels such as `추출` (extract),
`출처` (source), `대상` (target), `검토` (review), and `차이` (diff).

It may ask Hermes to inspect supplied claims and prepare a native `MEMORY.md`
or `USER.md` write diff. It never invokes, applies, or observes that native
write. The review states that a prepared diff is not native mutation evidence.
New facts belong in the remember/refuse/defer candidate flow instead.

## Migration and Review-Required Notice

v1 artifacts are fail-closed and display as `review_required_legacy`. Run a
report first; its deterministic counts cover records, scope items, blocks,
archive/history, candidates/reviews, indexes, declared-link journals, corrupt
or unknown artifacts, and exclusions:

```sh
# Agent/operator only.
omh memory inventory
omh memory inventory --write-ledger

# Agent/operator only: reactivate one reviewed v1 artifact, never a bulk trust grant.
omh memory reactivate <record-id> --revision <n> --apply
```

Reactivation performs a current-policy rescan, links a new immutable v2 review
record, and leaves an unsafe or failed artifact review-only.

## Batch Review and Apply

Context changes are staged before review and application:

```sh
# Agent/operator only.
omh memory batch-stage --batch memory-update-batch.json
omh memory batch-review <batch-id>
omh memory batch-apply <batch-id> --apply
```

The final step verifies the staged identities and their immutable review links
under one store lock. A direct compatibility batch reports `review_required`;
it does not make context prompt-eligible.

## Lifecycle and Dreaming

Use literal lifecycle terms: expire removes influence only; retire archives
recoverably; restore preserves the archive and creates a new pending revision;
prune hard-deletes only the manifest-declared OMH-local target set after a
report and explicit confirmation. No result extends beyond the named local
target set. Restore conflicts with newer live revisions remain review-blocked.

Dreaming remains `off` or `reminder`. It prepares reminders only, including
`stale_review_required` and `expired_volatile_records`; it never performs
consolidation, retirement, restore, or prune.

## Handoff Behavior

A handoff may contain only evaluator-eligible, conflict-free OMH context. It
records exclusions with stable reasons instead of silently reusing stale or
unreviewed material. Prepared handoff context remains preparation evidence,
not execution, model-use, provider-use, review, CI, or merge evidence.
