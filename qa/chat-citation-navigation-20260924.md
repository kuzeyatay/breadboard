# EM1 chat citation navigation

The EM1 workspace chat contains `/math-2/assets/calculus-a-complete-course-10-compress-source.pdf#page=607`. The dashboard Garden asset route accepted images only, so this returned an empty 404 document. Opening that response in a desktop tab also removed the page-provided tab controls.

Changes:

- Chat Markdown converts canonical `/<garden>/assets/<source>-source.pdf` citations to the Garden PDF reader, preserving query and page fragment.
- The asset route redirects old source PDF links to the reader after its Garden access check; existing image serving is unchanged.
- The PDF reader uses an explicit citation page for the initial document load before its remembered page. Subsequent page navigation continues to save the current page.
- Native right-click menus on trusted local links offer Open Link in New Tab (background) and Open Link in New Window. This also covers embedded reader frames. Editable fields retain their existing right-click paste behavior.

Verified:

- 26 dashboard unit/render/route checks passed, including authenticated redirects and source-link validation.
- Browser integration with the real ChatMarkdown and PDF viewer plus PDF.js: a 610-page PDF opened at page 607 despite remembered page 42; navigation to page 608 persisted; closing it preserved the chat draft.
- Four desktop link routing/integration checks passed, including actual right-click input on main-document and iframe links, separate window creation, background tab creation, closing tabs, and preservation of source state.
- Changed dashboard TypeScript and ESLint checks passed. Desktop TypeScript passed with `--lib ES2022,DOM,DOM.Iterable`.

Other verification observations:

- The broader existing `tab-navigation-loading.test` fails because its fixture assumes every `window.contentView.children` entry has `webContents`; a native View does not. The failure is in fixture setup and was left unchanged.
- The ordinary desktop build initially passed. A later build encountered a concurrently modified `desktop/src/main/breadboard-use-dom.ts:43` NodeList iteration error. Adding DOM.Iterable to the compiler invocation verifies the current sources without editing that unrelated file or the project configuration.

Application state:

The running application serves `.next-desktop/standalone`. The dashboard production rebuild was not started: the Windows commit preflight reported insufficient available memory with the app running. The user explicitly chose **Keep running; leave the fix ready**. Do not close or restart their active app to apply this task without new authorization. The source changes and compiled desktop outputs are ready; a dashboard rebuild and app restart remain necessary to activate them.
