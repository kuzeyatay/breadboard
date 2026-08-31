# Patent Disclosure skill integration

Breadboard ships a reviewed adaptation of
[`handsomestWei/patent-disclosure-skill`](https://github.com/handsomestWei/patent-disclosure-skill),
pinned at `ecd62fdb45b9792bb5fb2ebe8dc61157e04faab0`.

The capability appears as `/patent-disclosure-skill` in Terminal and Garden
Chat. It is also selected automatically for clear patent-disclosure, prior-art,
patent-reading, utility-model, design-patent, and office-action requests.

## What ships

- `hermes-skills/prebuilt/patent-disclosure-skill/SKILL.md` is the
  Breadboard-specific router and safety contract.
- The upstream clone remains at `patent-disclosure-skill/` as the pinned source
  snapshot and license/provenance authority.
- `patent_disclosure_guide` exposes only reviewed UTF-8 text below upstream
  `prompts/`, `references/`, `docs/`, and `examples/`, plus the root skill and
  install docs. Paths are root-contained, traversal and symlinks are rejected,
  and scripts/binaries are unreachable.
- Breadboard's conversation-scoped workspace tools hold intermediate files.
  Existing Office and artifact tools create and publish editable deliverables.
  Existing web research tools handle current public prior-art and policy
  evidence.

The packaged application stages the selected upstream text files with a source
commit receipt and per-file SHA-256 receipt. Packaging fails when the checkout
does not match the reviewed commit or contains tracked changes; package
verification rehashes the staged closure.

## Deliberate boundary

This integration does not execute the upstream Python tools. It does not install
Playwright, CadQuery, Mermaid tooling, PDF dependencies, or embedding SDKs; it
does not control CAD or Obsidian; and it cannot write an external OA vector
store. Those operations have different filesystem, browser, dependency,
credential, and persistence boundaries and need dedicated reviewed runtimes
rather than shell access hidden inside a skill.

The supported path covers the agentic core: invention/utility-model/design
disclosures, evidence-based patent reading, policy research backlogs,
office-action response drafts, versioned Markdown, editable Word output, and
published Breadboard artifacts. When an upstream helper is needed for a strict
figure or database gate, the skill records the gap instead of claiming parity.

## Security and legal posture

Selecting the skill never expands a turn's existing authority. The guidance
bridge is read-only and additionally checks that this exact skill is selected
for the active authenticated run. Private project material stays in the
conversation workspace; public patent searches should use sanitized technical
queries. Outputs are drafting and research assistance, not legal opinions,
filings, patentability guarantees, or freedom-to-operate conclusions.

## Verification

Focused coverage lives in
`dashboard/tests/patent-disclosure-skill.test.mjs`. It checks discovery on both
authenticated surfaces, anonymous-surface exclusion, tool registration,
source-path containment, intent routing, upstream revision pinning, and desktop
staging/verification contracts.
