# GenOffice integration

Breadboard vendors GenOffice's document engines plus its native Docs renderer.
The engines add byte-preserving edits to existing DOCX/PPTX files and local
PDF-to-DOCX conversion through PDFium wasm. The renderer supplies the familiar
paginated Word-style canvas and ribbon used for human DOCX editing.

The source is pinned to GenOffice commit
`f68df70e222d47aa08211f9a2d7748c610d1d6aa`. The preserved upstream clone is
under `genoffice/`; its `BREADBOARD_UPSTREAM_COMMIT` file is the source of truth.
These packages are retained:

- `docx-engine`
- `pptx-engine`
- `pptx-render`
- `font-metrics`
- `pdf2docx`
- `ui`
- `i18n`

The upstream `apps/docs/src/renderer` and `apps/docs/src/shared` trees are also
retained. Their visual/editor source is copied from the same pin. Six focused
compatibility files are intentionally overlaid during sync: the Electron IPC
types, the renderer's global bridge declaration, the AI dock, two small browser
bundling adaptations, and a narrow `bidi-js` type boundary for PDF-to-DOCX.
The overlays live under
`dashboard/src/vendor-overrides/genoffice/` and are included in the vendor
drift check.

Their `src/` trees are copied byte-for-byte to
`dashboard/src/vendor/genoffice/`. Breadboard code imports the copies through a
small stable API in `dashboard/src/lib/genoffice/`, so vendored types do not
become application contracts.

## Deliberate boundaries

This is a focused integration of GenOffice Docs, not the whole application
suite. GenOffice's Electron main/preload processes, `ee/`, provider/search
packages, storage, and Electron utilities remain excluded. The Docs renderer
is compiled into `dashboard/public/genoffice-editor/` and runs in a same-origin
iframe so its Office UI styles cannot leak into the chat. Keeping this editor
outside the Next.js route graph also prevents editor compilation or HMR from
refreshing the owning chat. Its browser bridge loads and saves through
Breadboard's authenticated artifact API, and its AI dock hands instructions to
the owning Hermes conversation. Breadboard keeps AnyDoc ingestion and
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

For an interactive DOCX edit, the artifact viewer opens the GenOffice Docs
renderer. Saving publishes the complete DOCX package as a new immutable
artifact version after an expected-version conflict check; it does not flatten
the document into extracted paragraph fields. PPTX/XLSX retain their existing
specialized fallback editors until GenOffice exposes browser-safe suites for
those formats.

## Updating the pin

1. Review the target GenOffice commit and its Apache-2.0 licensing files.
2. Replace the retained `genoffice/` tree at that commit, keeping the seven
   packages, Docs renderer/shared sources, and the root licensing/readme files.
3. Update `genoffice/BREADBOARD_UPSTREAM_COMMIT`.
4. Read every retained `package.json`, re-check the transitive
   `@genoffice/*` dependency closure, and update dashboard runtime dependency
   versions if the manifests changed.
5. Run `cd dashboard && npm run sync:genoffice`. This also rebuilds the static
   browser editor in `public/genoffice-editor/`; use
   `npm run build:genoffice-editor` when only the bundle needs rebuilding.
6. Run the typecheck, lint, and `node --test tests/genoffice-*.test.mjs` suite.

The drift test fails if a copied file, byte, or retained package name differs
from the pinned clone. Never patch the dashboard vendor copy directly; make an
intentional upstream-pin change and re-sync it.
