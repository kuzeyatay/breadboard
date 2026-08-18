# Breadboard W2-3F — W23E-001 Authorized Trust Repair

## Decision

**W23E-001 VERIFIED_REPAIR**

The original user-facing reproduction now passes, every security-negative case
remains closed, and the regression is proven to distinguish the approved trust
contract from four specific ways of getting it wrong.

**The repair lives in the isolated worktree, not the main tree.** SH1 produces a
verified candidate; landing it is a commit, which this pass is not authorized to
make. The main tree is byte-identical to how it started.

## Authorization

Granted for exactly one contract: canonical text, line terminators only.
Explicitly excluded and honoured: no gate weakening, no review bypass, no
accepting regenerated artifacts, no repository-wide line-ending policy change, no
unrelated security changes, no registry redesign.

## Execution identity

| Field | Value |
| --- | --- |
| `findingId` | `W23E-001` |
| `baseCommit` | `9e46a6dd9152a1aafa9f3cf5beab9ee9036b91fe` |
| `executionSnapshotId` | `dba9182883afe3d9…` |
| `environmentFingerprint` | `13a9343f1161362e…` |
| `checkoutLineEndingPolicy` | `core.autocrlf=false`, per command |
| Repository `core.autocrlf` | `true` — unchanged |
| `capabilityId` | `be228038-243c-495f-a057-69d7aaac2c04` |

## Trust contract implemented

`canonicalizeReviewedText(bytes)`: strict UTF-8 decode — a re-encode must be
byte-identical, so invalid UTF-8 returns null and fails closed — then `CRLF -> LF`
and lone `CR -> LF`, then hash. Applied only to declared text extensions.

Pins now declare their scheme. A `text-v1:` pin asserts canonical text; a bare hex
pin keeps its original raw-byte meaning exactly, so no historical pin was silently
reinterpreted and the audit trail stays readable. A text pin may never
authenticate a non-text artifact.

## Migration provenance

Three artifacts, three proofs, zero blind re-pins, zero requiring human review.

| Skill | Proof | Historical rendering |
| --- | --- | --- |
| `premortem` | a line-ending rendering reproduces the existing pin | CRLF |
| `agent-loop-engineering` | a line-ending rendering reproduces the existing pin | LF |
| `bullshit-detector` | deterministic generator output reproduces the existing pin, and its canonical form equals the committed content | generator raw (mixed) |

The `localHash` of `agent-loop-engineering` was deliberately left untouched: it is
a different value from its file pin, so nothing proved what it attests to.

## Before

| Skill | enabled | healthy | dispatch |
| --- | --- | --- | --- |
| `bullshit-detector` | false | false | false |
| `premortem` | false | false | false |
| `agent-loop-engineering` | true | true | true |

Both `/premortem` and `/bullshit-detector` refused with *"That capability is
unavailable in the current surface or task mode."*

## After

| Skill | enabled | healthy | dispatch |
| --- | --- | --- | --- |
| `bullshit-detector` | **true** | **true** | **true** |
| `premortem` | **true** | **true** | **true** |
| `agent-loop-engineering` | true | true | true |

Both invocations accepted. `quartz_ai` exposure unchanged: still empty.

## Checkout matrix

All three skills verify under `core.autocrlf` **true**, **false** and **input**,
from real checkouts — and the byte forms genuinely differed across arms, so this
is canonicalisation rather than coincidence. Repository and global git config
verified unchanged before and after.

## Adversarial changes

Run against each real shipped artifact, not a synthetic sample. Every applied
content mutation is rejected: instruction word changed, sentence deleted,
unreviewed instruction inserted, frontmatter mutated, metadata mutated, trailing
newline removed, BOM inserted, whitespace mutated, invisible code point inserted,
single bit flipped. Every representation-only rendering is accepted.

Two mutations were **inapplicable** on two artifacts — the word they rewrite does
not appear — and are reported as inapplicable rather than counted as passes.

## Invalid UTF-8

Six sequences, all fail closed: lone continuation byte, truncated 3- and 4-byte
sequences, invalid start byte, overlong encoding, unpaired surrogate bytes. Every
one would have become U+FFFD under a lossy decode and then hashed happily. Valid
multibyte text is unaffected.

## Line-ending shapes

Six shapes — LF, CRLF, CR and three mixtures — collapse to **one** canonical
identity across **six** distinct raw hashes.

## Security-negative cases

| Case | healthy | Expected |
| --- | --- | --- |
| correct pin | true | true |
| wrong pin | false | false |
| changed content | false | false |
| CRLF rendering | true | true (the repair) |
| invalid UTF-8 | false | false |
| extra unpinned file | false | false |
| legacy raw pin | true | true |
| legacy raw pin, CRLF file | **false** | false — a bare pin must not gain canonical semantics |
| **missing pin** | **true** | *measured, not asserted* |

The dispatch gate still refuses every partial-failure combination and allows only
a fully verified skill.

**`missing-pin` is a new finding, `W23F-002`.** A registry entry carrying no
`fileHashes` is treated as verified. Fixing it would *strengthen* the gate, which
this authorization explicitly does not cover, so it is recorded for its own human
decision rather than changed silently.

## Regression non-vacuity

The regression distinguishes the approved contract from all four wrong verifiers:
the old raw-byte verifier, canonicalisation with CRLF folding removed,
canonicalisation that also collapses arbitrary whitespace, and a lossy decode that
accepts invalid UTF-8.

The last initially read as NOT DISTINGUISHED — my probe compared only "same
identity as the reviewed text" when the real difference is that the approved
verifier *refuses* while the lossy one returns a hash. That was a probe bug, and
so were two others found the same way: a canonicalisation probe that appended a
terminator the original lacked, and a mixed-shape probe that put a CR before a
blank line, forming a genuine CRLF. All three measured the probe rather than the
product; all three are fixed and noted.

## SH1 receipt

`W23E-001.receipt.json` / `.md`. Capability finalized, `unauthorisedChanges: []`,
`declaredButUnwritten: []`, assertion-integrity `REVIEW_REQUIRED` with zero
rejections — the one finding is the declared new regression file — isolation
verified, secret scan clean.

## Harness finding fixed on the way

**`W23F-H1`.** `finalizeRepairCapability` fed the *whole* snapshot worktree diff
to the assertion-integrity guard. On a snapshot worktree that diff is the
developer in-flight tree, so the guard adjudicated their edits — and rejected this
repair on an `assertions-removed` finding in a file the repair never touched. W2-2
made the unauthorised-change check snapshot-aware but left the integrity check
unnarrowed. `captureDiff` now accepts pathspecs and finalize passes the manifest
delta.

## Integrity

| Check | Result |
| --- | --- |
| Product changes outside authorized SH1 | **0** |
| Reviewed artifacts regenerated | **no** |
| Blind re-pins | **0** |
| Hashes changed without provenance | **0** — 3 of 3 migrated by proof |
| Repository git config changed | no — `core.autocrlf` still `true` |
| Global git config changed | no |
| `.gitattributes` changed | no — none added, none exists |
| Developer state touched | no — main tree byte-identical, `.agents` and `skills.ts` clean |
| Vendored roots modified | no — 92 roots |
| `node_modules` intact | yes (649) |
| Secret findings | 0 |
| Commit / stash / reset | none |

## Next action

1. **Land the candidate.** It is verified and isolated; landing it is a commit.
2. Decide `W23F-002` — a missing pin currently counts as verified.
3. Optionally make the `bullshit-detector` generator emit LF.
