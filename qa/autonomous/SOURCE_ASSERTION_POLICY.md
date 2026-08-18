# Breadboard source-assertion policy

When may a test assert what the source *says* rather than what the product
*does*?

This exists because 33 failing assertions accumulated across Week 2 that all
turned on the same unanswered question, and answering it one test at a time was
producing precedent by accident.

The answer is not "always prefer runtime tests". Some invariants are about
structure, and a runtime test either cannot observe them or can only observe
them after the damage is done. A test that asserts a security gate is *invoked*
is protecting something a passing behavioural test cannot: the gate might be
absent and the behaviour still correct on every input the test happened to try.

Equally, an assertion that a particular string appears in a particular file is
usually protecting nothing. It fails when the code is reorganised and passes
when the behaviour breaks — the exact opposite of a useful test.

## The classes

### S1 — structural security contract

The structure *is* the control. A gate must be invoked; a capability boundary
must be present; reviewed-hash verification must occur; an adapter must mediate
access.

**Source assertion justified.** The failure mode is omission, and omission is
often invisible to behavioural tests, which sample inputs rather than prove
universals. Removing the gate can leave every tested case passing.

Requirement: the assertion must name the boundary, not a spelling of it. Assert
that verification happens, not that a particular helper is called on line 40.

### S2 — architectural contract

A module boundary, a required registration, ownership of an IPC channel, a
public adapter seam. The architecture is deliberate and its presence carries
meaning beyond behaviour.

**Source assertion justified when the architecture is intentional and
documented.** Without documentation this collapses into I1: an undocumented
"architecture" is one person's preference, and preferences are not contracts.

Negative assertions belong here. `assert.doesNotMatch(source, /X/)` — "this
pattern must not come back" — is a structural claim about what the code must not
contain, and there is frequently no runtime equivalent, because the thing being
excluded is a *second* implementation of something that already works.

### S3 — generated or reviewed artifact contract

Reviewed guidance, a pinned generated artifact, a mandatory generated field.

**Exact-content assertion justified.** Here the file content is the product.
The reviewed-skill pin is the canonical case: the artifact is what ships to a
model, so its text is behaviour.

Requirement, learned from W23E-001: assert content, not storage representation.
An exact-content assertion must state what it treats as content and what it
treats as representation, or it will eventually authenticate a checkout instead
of an artifact.

### B1 — user or product behaviour

A route, a returned value, filtering, projection semantics, persistence, what
the user sees or can do.

**Prefer an executable test.** An alternative implementation with the same
externally relevant behaviour is valid, so pinning the current implementation is
pinning the wrong thing.

### I1 — implementation detail

A variable name, a helper's location, an exact expression, a call written in a
particular file, a CSS literal located through an arbitrary source window, a
class name nothing consumes.

**Source assertion inappropriate.** These fail on refactors and pass on
regressions.

The sharpest test for this class: *if the assertion were satisfied by adding
markup or an identifier that nothing else uses, it is I1.* An assertion that can
be satisfied with dead code is not protecting anything.

### P1 — prose and copy

Requires an explicit determination. Exact wording is a contract when a consumer
depends on it — guidance a model receives, a legal notice, a string another
system parses. It is not a contract when it is incidental phrasing.

Undetermined copy assertions stay as they are. Guessing costs more than waiting.

## Decision rules

Ask in order, and stop at the first that answers:

1. **Would an alternative implementation, preserving every externally relevant
   behaviour, still be valid?** If yes, source shape is probably not the
   contract. → B1 or I1.

2. **Is the structure itself a security, review or architecture boundary?** If
   yes, a structural assertion may be appropriate. → S1, S2 or S3.

3. **Can a deterministic executable test detect the real violation?** If yes,
   prefer it — unless the violation is *absence*, which sampling cannot prove.

4. **Does the exact content carry review, legal, security or product meaning?**
   If yes, an exact-content assertion may remain. → S3 or P1.

5. **Is the test merely locating a literal in a particular file?** If yes, it is
   implementation coupling. → I1.

## Rules that follow

**Never satisfy an assertion by adding dead code.** If the only way to make a
test pass is to add a class, attribute or identifier that nothing consumes, the
assertion is wrong. This is not negotiable, and it is what `bb-agent-run-icon`
would have cost: a class used by zero of 32 cards and defined nowhere in the
stylesheet.

**Do not delete coverage while replacing it.** A replacement must fail against a
seeded violation of the same invariant before the original is removed.

**Prefer the narrowest authoritative layer.** A returned value beats a rendered
DOM; a rendered DOM beats source text; source text is last.

**Parse, do not slice.** Where a structural assertion is justified over a
generated or declarative artifact — a stylesheet, a manifest — parse it into
units and assert over the unit. A text window between two markers silently
widens as the file grows. This is not a class change; it is the correct way to
implement S2 and S3.

**Negative assertions need a stated reason.** `doesNotMatch` is legitimate under
S2, but the comment must say what regression it prevents. Otherwise it is an
untriageable failure the first time someone writes a matching word.

**Undetermined beats guessed.** `UNRESOLVED_CONTRACT` is an acceptable resting
state. A wrong policy call is more expensive than a slow one.

## What this policy deliberately does not do

It does not forbid source assertions. It does not require a runtime test for
every contract. It does not mandate mechanical enforcement: the review helper at
`qa/harness-selftest/w23f-source-assertion-review.mjs` **reports** candidate
violations and is not wired into any gate, because a linter confident enough to
block a legitimate S1 assertion would do more harm than the coupling it removes.

## Applying it

Every held case from Weeks 2-3C through 2-3E is classified in
`.qa-results/week2-source-assertion-policy/<run-id>/source-assertion-policy-results.json`,
with the real invariant, the class, the verdict, and — where a replacement is
warranted — its design and its non-vacuity proof.
