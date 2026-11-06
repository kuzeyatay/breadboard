// Keep the complete browser closure in the emitted bundle. Serializing a
// function from Quartz's server build also serializes references to esbuild's
// keepNames helpers, which do not exist on the page and abort Quartz startup.
// @ts-ignore -- The portable loader is shared with dashboard integration tests.
import { installQuartzDocumentEditor } from "./documentEditorLoader.mjs"

installQuartzDocumentEditor()
