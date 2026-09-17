# Feynman in Breadboard

Breadboard bundles the MIT-licensed [Feynman PaperRank engine](https://github.com/advaitpaliwal/feynman)
at version 0.3.49, commit `dfdcb7cf2c73183cff7b10aa8ea8ce370c8b152c`.
There is no Feynman installation, separate login, or API key to configure.

In Terminal or Garden Chat with Agent mode enabled, ask, for example:

> Use Feynman to rank papers on retrieval-augmented generation and explain the evidence gaps.

The assistant can call `feynman_research` on an ordinary authenticated turn.
`/agents:max-research <question>` also includes Feynman automatically in the first
retrieval wave, alongside Deep Research, Agent Reach and Get Doc. Its evidence
feeds final synthesis and review. Existing Max Research run
events, cancellation and saved responses carry its result.

Feynman uses public arXiv, Crossref and Europe PMC endpoints to retrieve papers,
deduplicates records, builds a citation graph from returned Crossref references,
and applies upstream relevance, citation, method and reproducibility scoring.
It inspects up to three public full texts through Europe PMC and includes
source-backed heuristic critiques and reading priorities. Responses carry direct
paper links, source provenance, full-text status and partial-source failures.

The research tool itself makes no model calls. The surrounding assistant and
Max Research synthesis use Breadboard's existing model connection. This does
not remove the account/model requirement of those existing features.

This integration exposes Feynman's literature evidence engine. It does not
install its standalone Pi agent/workbench, Alpha Hub login, biology connector
catalog, experiment execution or scheduling. PaperRank scores are relative
reading priorities, not proof of correctness. Missing citation counts are
excluded, abstract-only records are labeled, and no experiments are claimed.

Implementation:

- `dashboard/src/lib/feynman/service.ts`: bounded public retrieval and engine adapter.
- `dashboard/src/vendor/feynman/`: pinned upstream code, MIT license and patch notes.
- `dashboard/src/app/api/hermes/tools/feynman/route.ts`: capability-, session- and conversation-scoped endpoint.
- `hermes-agent/plugins/breadboard/__init__.py`: assistant tool and transport.
- `dashboard/src/lib/max-research/`: participant, planning and synthesis.

Network calls are HTTPS GETs to three fixed public hosts, with no credentials,
cookies, automatic installs or redirects. Catalog responses are limited to 8 MiB,
requests to 20 seconds, the tool to 90 seconds, and user arguments to 20 returned
papers and three full-text inspections. Stopping the request or Max Research run
aborts outstanding retrieval. One failing catalog preserves the others' results;
total failure is distinct from a successful empty search.

Run the focused checks from `dashboard`:

```powershell
node --experimental-strip-types --test tests/feynman.test.mjs tests/max-research.test.mjs
```

Public API documentation: [Crossref access](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/),
[Europe PMC REST API](https://europepmc.org/RestfulWebService).

Validated on 2026-09-07: live CRISPR and AlphaFold searches reached all three
catalogs without credentials. The AlphaFold run fetched and inspected the public
Europe PMC XML full text for DOI `10.1038/s41586-021-03819-2` (83,797 text
characters). The focused Feynman, Max Research, capability, evidence and agent
brief suites passed 138 JavaScript tests; the Hermes transport suites passed 22
Python tests. Strict Feynman typechecking and lint passed. The whole-dashboard
typecheck remains failing in existing OpenMAIC/GenOffice code; it reported no
errors in the Feynman integration files.

Restart Breadboard after updating so the running Hermes process reloads its
plugin tool catalog. No Feynman setup step is needed.
