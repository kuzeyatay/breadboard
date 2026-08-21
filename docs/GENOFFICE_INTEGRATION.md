# GenOffice integration

Breadboard vendors a deliberately small part of GenOffice as an in-process,
Node-only document engine. It adds two paths: byte-preserving edits to existing
DOCX/PPTX files, and local PDF-to-DOCX conversion through PDFium wasm.

The source is pinned to GenOffice commit
`f68df70e222d47aa08211f9a2d7748c610d1d6aa`. The preserved upstream clone is
under `genoffice/`; its `BREADBOARD_UPSTREAM_COMMIT` file is the source of truth.
Only these packages are retained:

- `docx-engine`
- `pptx-engine`
- `pptx-render`
- `font-metrics`
- `pdf2docx`

Their `src/` trees are copied byte-for-byte to
`dashboard/src/vendor/genoffice/`. Breadboard code imports the copies through a
small stable API in `dashboard/src/lib/genoffice/`, so vendored types do not
become application contracts.

## Deliberate boundaries

This is not an integration of the GenOffice application suite. `apps/`, `ee/`,
the AI/provider/search packages, UI, storage, parsing, and Electron utilities
are excluded. Breadboard keeps its own Hermes AI layer, AnyDoc ingestion, and
`document-structure` attachment parsing.

Breadboard does not expose or integrate the Sheets/XLSX path because GenOffice's
spreadsheet application requires a Rust sidecar, while Breadboard does not
provision a Rust toolchain or runtime binary. No Rust build step or background
service is introduced; incidental modules inside a retained upstream package
remain unreachable through Breadboard's stable seam.

OfficeCLI remains the CLI-shaped authoring path for creating new Office files.
The GenOffice seam handles edits to existing DOCX/PPTX bytes and acts as a
PPTX-preview fallback when OfficeCLI cannot render an export. The existing
markdown-to-DOCX generator also remains the path for generating a new document
from markdown. PDF-to-DOCX is beside the existing PDF viewer and does not alter
or replace it.

## Runtime flow

Eligible DOCX, PPTX, and PDF attachments are staged inside the owning Hermes
workspace while their immutable stored blobs remain unchanged. `document_edit`
first exposes stable block/element anchors, then accepts plain-text patches and
publishes the edited file as an artifact. `pdf_to_docx` converts a contained PDF
path and publishes the resulting DOCX artifact. Both tools reject paths outside
the workspace and are unavailable to Quartz.

PDFium is loaded from `@embedpdf/pdfium/pdfium.wasm`; Next standalone tracing
and desktop package verification both include that asset. Conversion is local
and performs no runtime network access.

## Updating the pin

1. Review the target GenOffice commit and its Apache-2.0 licensing files.
2. Replace the retained `genoffice/` tree at that commit, keeping only the five
   packages and the root `LICENSE`, `NOTICE`, and `README.md`.
3. Update `genoffice/BREADBOARD_UPSTREAM_COMMIT`.
4. Read every retained `package.json`, re-check the transitive
   `@genoffice/*` dependency closure, and update dashboard runtime dependency
   versions if the manifests changed.
5. Run `cd dashboard && npm run sync:genoffice`.
6. Run the typecheck, lint, and `node --test tests/genoffice-*.test.mjs` suite.

The drift test fails if a copied file, byte, or retained package name differs
from the pinned clone. Never patch the dashboard vendor copy directly; make an
intentional upstream-pin change and re-sync it.
