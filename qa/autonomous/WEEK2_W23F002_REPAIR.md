# Breadboard W2-3H — W23F-002 Repair

## Decision

**VERIFIED_REPAIR** — candidate only. **Not committed.**

The authorization permits candidate creation; committing W23F-002 needs its own
approval.

## The fix is a policy, not a default

The defect was a default: `integrityVerified = pinnedHashes.length === 0`, so
"nothing to check" became "nothing wrong". The obvious fix — flip it to `false` —
would have been a different bug, because a pin is the trust mechanism for exactly
one class. A global rule marks every first-party prebuilt skill unhealthy.

So the rule is written as a rule:

```ts
export function requiresReviewedIntegrityPin(root: string): boolean
```

It names the reviewed install roots and nothing else, and has exactly one use:

```ts
let integrityVerified =
  pinnedHashes.length === 0 && !requiresReviewedIntegrityPin(root);
```

## Provenance matrix

| Class | Pin required | Trusted by | Changed |
| --- | --- | --- | --- |
| Reviewed install root | **yes** | the reviewed pin | **yes** |
| First-party prebuilt | no | committed product code | no |
| User documents | no | ownership | no |
| MCP connections | no | explicit approval | no |
| Unregistered directory | n/a | not a skill at all | no |

## Regression: 9/9

Negatives, all failing closed: no `fileHashes` key; an empty `fileHashes` object;
the file unlisted; wrong pin; changed content; unknown pin scheme; a partially
pinned set; and the original reproduction — edited guidance on an unpinned entry.

Positives, all unaffected: every prebuilt skill still healthy and enabled; a valid
`text-v1` pin still verifies; **a CRLF rendering of the same reviewed text still
verifies, so W23E-001 is not undone**; a valid legacy raw pin still verifies; the
three real shipped skills stay healthy.

Review state and integrity are checked as independent gates, so the fix did not
collapse them into one.

## SH1

Capability finalized, `unauthorisedChanges: []`, `declaredButUnwritten: []`,
assertion-integrity zero rejections, main tree untouched.

`repairFootprint.repairFiles` reported exactly the two files this repair wrote —
the Part C fix working in the field on its first real use, rather than the 150+
the old mechanism would have claimed.

## Not committed

```text
APPROVE LOOP ACTION: commit the W23F-002 reviewed-root pin requirement / dashboard/src/lib/hermes/skills.ts + dashboard/tests/reviewed-root-pin-required.test.mjs / git revert the commit
```
