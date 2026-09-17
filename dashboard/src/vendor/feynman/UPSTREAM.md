# Feynman PaperRank

Source: https://github.com/advaitpaliwal/feynman
Version: 0.3.49
Commit: dfdcb7cf2c73183cff7b10aa8ea8ce370c8b152c
License: MIT (see LICENSE).

Vendored source files: `src/rank/paper-rank.ts` and `src/research/contracts.ts`.
Breadboard imports the scoring, citation graph, critique, full-text extraction,
and rubric functions. It does not launch the standalone Pi runtime, workbench,
installers, telemetry, artifact writers, or model-provider/authentication code.

Local patches:

- The contracts import uses `.ts` for Breadboard's TypeScript worker loader.
- Alpha Hub's optional authenticated import is disabled; its content fetcher
  returns undefined. Breadboard explicitly supplies public Europe PMC retrieval.
- `citationCountKnown: false` excludes citation impact/velocity when a catalog
  does not provide citation counts. Scoring otherwise follows upstream.

The Breadboard adapter lives in `src/lib/feynman/service.ts`. It maps public
catalog results into the upstream paper contract, merges duplicate DOI/title
records, preserves provider provenance, and relabels OpenAlex-specific score
attribution to the actual sources. The graph contract's `openAlexId` field stores
DOI/catalog identities; no OpenAlex IDs or citation edges are invented.

To update, copy these two files from a reviewed upstream commit, reapply the
patches above, update the version/commit and run the Feynman integration tests.
