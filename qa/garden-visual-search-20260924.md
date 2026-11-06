# Garden visual search verification — 24 September 2026

Implemented general Garden-first visual retrieval and shared description
enrichment for stored document/OCR, website and video visuals. Implementation
and backfill commands: [GARDEN_VISUAL_SEARCH.md](../dashboard/docs/GARDEN_VISUAL_SEARCH.md).

## Checks

- 94 distinct targeted tests passed across source-figure search, cross-Garden
  authorization, description enrichment, the backfill CLI, video analysis,
  website image capture, image routing, VLM OCR, ingestion fallback/cutover and
  durable Learn workspace seeding.
- TypeScript: 12 changed entrypoints with the project's six ambient declaration
  files and their transitive dependencies; zero diagnostics. This was a scoped
  check, not a full dashboard build.
- Checked tracked edits for whitespace errors with `git diff --check`.
- A real search for `magnetic field` in `electromagnetism-1` returned 226
  candidates. The first two had usable image embeds, detector captions and
  source-page provenance. No live model was used for this check.
- Model API behavior was tested using a local HTTP fixture: requests contained
  actual image data; the read-only report made no requests; a second apply run
  reused saved descriptions.
- The Runtime V2 result validator accepts bounded, consistent description
  coverage counts. The upload completion stream preserves pending counts and
  provider-unavailable status without rejecting a successfully saved source.

## Current local coverage

The read-only inventory covered 18 local Garden directories and 774 visible
Markdown pages. These are repository directories, including test Gardens; they
are not a report of a single signed-in user's authorized Gardens.

| Image references (unique paths within each Garden) | Count |
| --- | ---: |
| Total | 1,003 |
| Existing non-generic detector/pixel descriptions | 287 |
| Available, missing a pixel/detector description | 581 |
| Missing, out-of-Garden or marked unreliable | 135 |

Full per-Garden report: [garden-visual-coverage.jsonl](../tmp/garden-visual-coverage.jsonl).
The unavailable group includes old `computer-architecture` URLs in the
`computer-architecture-2` Garden. They were not silently rebound to a different
asset. Retrieval returns no usable embed for such references.

The configured model endpoint at `127.0.0.1:8765` refused connections, so no live
AI backfill of existing Gardens was performed. Existing saved visuals can use
the new context search immediately when this code runs. Pixel descriptions can
be backfilled with the documented command after the service is available.

Coverage concerns stored, source-attached images. It does not establish complete
figure detection in original PDFs, remote websites or unsampled video content.

## Live desktop correction and background backfill

The earlier inventory above used the development checkout, and its fixed model
port was obsolete. The real desktop library is
`C:/Users/20252082/AppData/Roaming/breadboard-desktop/Data/quartz/content`.
The backfill now discovers the model endpoint from the desktop runtime manifest
and uses its selected background model, `gpt-6-luna`. Garden scope comes from
read-only ownership queries for user 1 in the live desktop database; unrelated
test-user gardens are excluded.

The first live inventory found 4,825 distinct pending image byte sequences,
covering 4,886 pending references. A pilot saved 19 descriptions and the first
bulk run saved another 168 before the desktop app quit at 12:49 UTC. Receipts
remain durable; subsequent runs reuse them. Inventory and interrupted-run reports:
`tmp/garden-visual-live-before.jsonl`, `tmp/garden-visual-background-pilot.json`,
and `tmp/garden-visual-background-all.json`.

Repaired 281 references with original files, hashes and backups retained:

- 182 stale local paths now resolve to verified existing assets.
- 32 website images were recovered from their observed publisher URLs.
- 67 equation images were rendered deterministically from exact LaTeX in their
  original URLs. A rendered formula was visually checked for correct symbols
  and unclipped layout.
- Six WordPress tracking-pixel references are excluded from visual inventory.

Repair receipts: `tmp/garden-visual-reference-repairs.json` and
`tmp/garden-visual-reference-repairs-website.json`. Fresh inventory:
`tmp/garden-visual-unavailable-after-repair.json`. Telecom 1 has 1,431 unique
image references with none unavailable; Computer Architecture has 126 with none
unavailable. Two old Electromagnetism figure references remain unavailable.

Current regression validation: 39 tests passed across figure retrieval,
cross-garden authorization, enrichment/backfill, video analysis and website
images. This includes a complete fixture-driven supervisor run using a real
local HTTP model endpoint and child process, ownership filtering, resumed
receipts, fresh coverage verification, retrieval verification and the final
completion marker. Cancellation never signals completion. Scoped TypeScript
checking of changed backfill/enrichment/retrieval modules and their transitive
dependencies returned zero diagnostics; targeted `git diff --check` passed.

At 13:07 UTC the model service had returned. Started the finite local supervisor
as hidden process 49344; a separate process check confirmed it alive and its
child backfill running. It has a six-hour deadline, retries service interruptions,
reuses saved receipts, and retries remaining descriptions individually. It does
not restart the desktop app or Learn. The attempted app scheduler connection
was unavailable; no scheduled automation was created.

Claude Code handoff: `.runtime/coordination/garden-visual-backfill.json` and its
companion Markdown file. `readyForSupervisor` remains false until fresh coverage
and Telecom 1 image retrieval pass verification. `needs_attention` indicates an
incomplete run requiring review. A completion section will be appended here by
the supervisor only after verification. Live report:
`tmp/garden-visual-background-supervised.json`.

## Completed live backfill

Verified 2026-09-24T15:56:31.816Z with gpt-6-luna: 6345 described image references, 0 pending, 2 unavailable. Telecom 1 retrieval verified. Full report: C:\Users\20252082\breadboard\tmp\garden-visual-background-emf-retry.json.verified.json.

The final ten pending Telecom assets were EMF drawings, which Sharp could not
decode. Windows GDI+ rendered all ten original EMFs to PNG; a Telecom diagram
was visually inspected for legible content. Eight source notes were relinked
to the PNGs, and original files plus before/after hashes were kept. Receipt:
`tmp/telecom-emf-repair-receipt.json`; backups:
`C:/Users/20252082/AppData/Roaming/breadboard-desktop/Data/backups/telecom-emf-repair-1790264916597`.
The backfill was restarted from durable receipts and its final pass verified
1,837 of 1,837 currently referenced Telecom images described, zero Telecom
pending/unavailable, and a usable retrieved embed. The two unavailable figures
are old Electromagnetism links to files that are absent from the source assets.

The Windows document importer now renders embedded EMF/WMF to PNG as it saves
new sources. The arbitrary first-24 embedded-image limit was removed from
AnyDoc conversion. A real EMF was rendered through the new helper. The focused
43-test group passed after the importer fix, and the 34 AnyDoc tests passed
after removing the image cap. Scoped TypeScript diagnostics: zero in the two
modified importer modules; one unrelated transitive diagnostic was present.
