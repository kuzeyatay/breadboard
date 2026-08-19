# Breadboard W2-3G — W23F-002 Trust Contract Decision

## Decision

**PRODUCT_BUG, severity P2. Not implemented.**

## What was actually asked

Not "should a missing hash fail closed?" but "for which provenance classes is a
reviewed pin required?" Starting from the assumption that no-pin is insecure
would have produced a global rule that breaks three legitimate classes.

## Registry entry types

| Class | Root | Pinned? | Committed |
| --- | --- | --- | --- |
| Reviewed install | `.agents/skills` | **yes — the pin decides enabled/healthy** | yes |
| First-party prebuilt | `hermes-skills/prebuilt` | **never** — `enabled`/`healthy` are literal `true` | yes |
| Quarantine | `hermes-skills/quarantine` | yes, re-hashed before promotion | no |
| Document skills / MCP | user data | no — ownership and approval, not review | no |

Three registry entries; eighteen unregistered directories under the reviewed root.

## Every no-pin path

| Path | Reachable | Healthy | Intentional |
| --- | --- | --- | --- |
| Reviewed root, record present, **no `fileHashes`** | yes | **true** | **UNDETERMINED** |
| `hermes-skills/prebuilt` | yes | true | **yes** — by construction |
| Reviewed root, **no registry record** | no | n/a | yes — explicitly commented |
| Document skills, MCP connections | yes | true | yes — different trust model |

Only the first is security-relevant.

## The contract: Model D

**A reviewed pin is mandatory for artifacts in the reviewed install root**,
because that is the only class whose trust story *is* the pin. The others have
their own: prebuilt skills are trusted by being committed product code, documents
by belonging to the user, MCP connections by explicit approval.

Model A — global fail-closed — is refuted by measurement rather than opinion: it
would mark every first-party prebuilt skill unhealthy.

Supporting evidence: absence of a registry *record* already means unavailable,
with a comment saying private workflows must not masquerade as installations;
every artifact arriving through the supported install path is pinned; and
`integrityVerified = pinnedHashes.length === 0` is a **default, not a decision** —
no comment, doc or test states any intent for the unpinned case.

## Security analysis

Measured: an entry in the reviewed root, `reviewState: approved`, with no
`fileHashes`, is healthy and dispatchable — **and stays healthy after its
guidance is edited.** For that class the absent pin removes the control entirely
rather than deferring it.

**Exploitability today: none.** All three shipped entries are pinned, and
creating an unpinned one needs write access to committed source, which already
implies the ability to edit the verifier. The real exposure is to the *review
process*: a hand-written or future-generated entry without hashes would ship
unreviewed guidance while looking approved.

**P2.** Not P0 — no live security exposure and no shipped artifact in that state.
Not P1 — no user journey is broken. A genuine fail-open default in a trust
boundary, latent.

## Repair design — not implemented

Treat absent or empty `fileHashes` on a **reviewed-root** entry as unverified.
Leave `listFirstPartySkills`, document skills and MCP connections untouched.

Regressions: an unpinned reviewed-root entry is unhealthy and undispatchable; a
pinned one is unaffected; every prebuilt skill stays healthy; a document skill
stays healthy. Non-vacuity: remove the check and the first fails; apply it
globally and the prebuilt test fails.

Held because `loop-contract.yaml` requires explicit approval for
`security_auth_capability_permission_or_sandbox_weakening`, and the W23E-001
authorization explicitly excluded strengthening this rule. SH1 eligibility alone
is not sufficient for a trust gate.

```text
APPROVE LOOP ACTION: require a reviewed pin for reviewed-install-root entries (W23F-002) / dashboard/src/lib/hermes/skills.ts / git revert the commit
```
