# Learn pipeline dependency map

This map records the production ordering observed in `learn.ts` before the canonical shadow integration. The default `LEARN_BUILD_STATE_MODE=legacy` ordering remains authoritative.

| Stage | Principal reads | Principal writes | Canonical concepts affected | ChatMock | Determinism |
|---|---|---|---|---|---|
| Contract planning | source map, scope contract, confirmed learning map, source artifact inventory | confirmed map in SQLite; later Learning Unit Contract | section/unit intent, source scope, concepts, claims | yes, with deterministic fallback | mixed |
| Source/formula extraction | uploaded sources, source context | source-visual ledger/assets, source-anchor ledger, formula identity registry | source anchors, visuals, canonical formula identities | extraction may call model; identity verification is deterministic | mixed |
| Formula assignment planning | verified formula identities, confirmed units, previous assignments | in-memory units, omission ledger, Learning Unit Contract and assignment provenance | unit formula requirements and formula-to-unit ownership | only genuine compatible ties, independently verified | deterministic first; bounded model tie-break |
| Page generation | contract units, source anchors, assigned visuals/formulas, source dossiers | learner Markdown, visual JSON/assets, page metadata | pages, formula entries, tags, embedded visuals | yes | model generation with deterministic guards/fallbacks |
| Semantic reconciliation | final contract, final learner pages, concept registry, claim store | page semantic frontmatter, contract concepts, concept/claim registries and history | unit/page mapping, concepts, claims, tags | no | deterministic rollback-backed transaction |
| Formula projection reconciliation | final pages, contract, formula identities, anchor/visual ledgers | formula metadata, contract assignment projections, ledgers, Source Coverage | formula usage and worked-example lineage | bounded only for verified ambiguities | deterministic first; bounded model repair |
| Weak-anchor self-healing | FinalGardenState, active anchor usage, source passages | source-anchor ledger and healing reports | active evidence grounding | bounded after deterministic candidate scoring | deterministic first; bounded model decision |
| Canonical shadow (opt-in) | latest specialized repaired legacy artifacts | `.breadboard/canonical-shadow/*` only; rendering occurs in an OS temp directory | typed issues, canonical state, transactions, snapshot, disposable projections, parity | disabled in Phase 1–3 integration | deterministic |
| `repairLearningUnitsFromContract` | contract, pages, registries/ledgers, repair state | learner pages/sections and repair artifacts | broad page/section contract conformance | model-first when configured, deterministic fallback | mixed |
| `finalizeGardenExport` | full on-disk garden | normalized projections and validation reports | final rendered garden consistency | no | deterministic |
| `verifyFinalArtifactNoMutation` | finalized garden and reports | verification metadata only | acceptance evidence | no | deterministic, mutation-detecting |
| Critic loop | final exported garden, deterministic audit, anchor state | targeted repairs, critic reports/status | verified semantic issues and publish readiness | yes | model critique plus independent deterministic verification |
| Quartz publication | accepted live garden | Quartz build/public output | published navigation and pages | no | deterministic build over accepted input |

The shadow stage deliberately sits after semantic/formula/anchor specialization and before the broad legacy repair loop. Shadow failure is diagnostic; it cannot replace the live acceptance or publication decision in this phase.
