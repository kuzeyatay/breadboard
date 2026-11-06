# Quartz handwriting settings

Implemented 2026-09-22. Handwrite source is pinned and attributed in
`dashboard/src/vendor/handwrite/README.md`.

## Using it

Open Page settings, download the original Handwrite PDF, fill all 80 boxes with
dark ink, and upload an upright JPG or PNG scan (maximum 12 MB). Preview the
generated letters before choosing **Use this handwriting**. The switch restores
the normal Quartz fonts without deleting the saved font. Math and code retain
their own fonts. Additional controls adjust text size, line spacing and graph
visibility. Fonts can be exported, imported, or removed.

The settings button is implemented in both dashboard garden navbars. Quartz also
provides a gear beside Search when its host has no settings bridge. That fallback
is active in the currently running desktop app. The navbar component will become
active with the next dashboard build; Breadboard was not restarted for this task.

## Implementation and storage

The original 8-column, 10-row template and character mapping are unchanged.
The browser worker adapts Handwrite's grid detection and glyph crop pipeline,
traces outlines with Potrace and creates an OpenType font with OpenType.js.
Processing is lazy, cancellable, bounded by a timeout, and runs off the UI thread.
Blank or incomplete scans and unsupported font files produce inline errors.

Scans are processed locally and are not uploaded. Fonts and preferences are saved
in IndexedDB for the current Quartz browser origin. They survive page navigation
and reloads, but are not account-synchronized. A different browser profile or
Quartz origin (including a different local server port) needs a font import;
Export font provides that backup. Markdown files are never modified by settings.

Host messages check both origin and source window. The settings panel is a native
modal dialog with keyboard dismissal, focus containment, and responsive styling.

## Verification

- All four real-browser tests in `dashboard/tests/quartz-handwriting.test.mjs`
  passed using the actual Quartz CLI output and offline worker. Coverage includes
  the official sample sheet, distinct generated glyphs, preview-before-enable,
  reload persistence, export/import/removal, invalid scans and fonts, processing
  cancellation, both settings entry points, navigation, dark/mobile layout,
  keyboard focus and dismissal, message validation, and closing during saving.
- The generated sample contains 82 glyphs including space and the missing-glyph
  placeholder. Sample font size is approximately 17 KB.
- Code/math font checks and exact Markdown preservation pass.
- Three existing garden refresh browser tests and three Quartz compiler/startup
  regression tests passed. Quartz and the added dashboard TypeScript modules
  type-check.
- Verified the generated font on the live EC 2 page in an isolated browser.
  Settings gears and explorer links are present in the three open desktop gardens.
  User preferences and handwriting were not replaced by the sample font.

Build worker: `node scripts/build-quartz-settings.mjs` from `dashboard`.
It also runs from the normal dashboard predev/prebuild renderer build.
Browser tests: `node --test tests/quartz-handwriting.test.mjs` from `dashboard`.
Screenshots: `qa/quartz-handwriting-preview.png`,
`qa/quartz-handwriting-mobile-dark.png`, and
`qa/quartz-handwriting-live-ec-2.png`.
