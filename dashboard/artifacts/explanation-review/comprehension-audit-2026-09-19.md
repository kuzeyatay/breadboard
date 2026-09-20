# Explanation comprehension review

Source changes: explanation-turn.ts, explanation-review.ts, explanation-review-runtime.ts.

The runtime now carries highlighted-selection admission into the checker. Proposed summaries and short follow-up questions can be reviewed. The review reports exact quoted concerns about prerequisites, unsupported inferences, contradictions, misleading analogies, and factual errors independently of planned mechanism coverage. Repair remains bounded to one attempt and a separate verification call. A missing or malformed concerns result cannot be treated as approval. Generation instructions now permit explicit correction of earlier false claims and keep truth-changing conditions beside their claims.

## Validation

- 66 focused tests passed, including prompt composition, selection routing, validation of concern quotes, cancellation, caching, source separation, and repair behavior.
- ESLint passed on the three changed runtime modules. Targeted git diff whitespace checks passed.
- Final live smoke replay used gpt-5.6-sol through an isolated local ChatMock server. The original cliproxy/gemini-3.6-flash-high provider was unavailable; its behavior is not validated by this replay.
- Final prompt contract SHA-256: a64c4e7543b3e5ba43ae527696d746150c56aad8d03018fa9279e07fdfdfdf2f.

| Case | Expected and observed review disposition |
| --- | --- |
| Equal energy incorrectly implies 50/50 | Repaired |
| Literal electron rotation returns after a correction | Repaired |
| Pairing explanation relies on unexplained prerequisites | Repaired |
| Correct prepared-spin counterexample | Retained unchanged |
| Correct introductory DNS account | Retained unchanged |

These are hand-authored smoke fixtures, not a controlled before/after benchmark of the original conversation. The case JSON files contain the drafts, final answers, receipts, and model responses. The evaluator separately records expectedStatusMatched; that field is not a verdict on comprehension.

## Manual assessment and limits

The final repairs remove the identified equal-energy inference, literal-rotation mechanism, and blanket preference for pairing. The two control answers were retained verbatim in the final run. Earlier iterations unnecessarily expanded both controls; scope checks were tightened before the final run.

Beginner comprehension remains imperfect. The probability repair still says “unpolarized collection” without explaining it. The rotation repair includes an equation whose g and m symbols are not defined. The pairing repair distinguishes its seat analogy from literal chairs but still leaves the concept of a spatial quantum state only partly explained. The model verifier approved these replies. They must not be presented as proof that the teaching problem is solved.

The runtime still retains the original draft if the reviewer is unavailable, needs evidence, or rejects a repair. The changes add checks, not a guarantee that erroneous text can never be shown. They do not provide durable correction memory beyond supplied conversation context. No existing user messages, model settings, or live app deployment were changed.

## Subject-independent follow-up

Production instructions were subsequently generalized: the physics examples about equal energies and negative charge carriers were replaced with rules about justified inferences, consistent quantity meanings, and cause-before-consequence. Familiar-word examples taken from the pairing exchange were replaced with the general requirement to explain the underlying concept. There are no subject-specific routing or replacement rules. Recursion and observational-correlation fixtures were added to exercise the same checks in programming and statistics. Those two new fixtures have not yet been live-replayed; the live results and prompt hash above describe the earlier revision. All 66 focused code tests still pass after generalization.
