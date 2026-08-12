# Breadboard restrained neumorphic system — implementation report

Date: 2026-07-19

## 1. Visual approach

The application now uses a shallow, tactile material hierarchy derived from Breadboard's existing pale-green, warm-paper, charcoal, botanical, slate-blue, and danger colors. Raised surfaces identify controls and meaningful containers; inset surfaces identify editable/selected regions; the strongest depth is reserved for dialogs and floating popovers. Article prose, messages, terminal output, graph canvases, and dense rows remain flat.

The implementation is incremental: central CSS variables and semantic classes provide the depth recipes, while existing component markup, radii, layout, motion, and behavior remain intact.

## 2. Files changed

Central styling:

- `dashboard/src/app/globals.css`
- `quartz/quartz/styles/custom.scss`

Dashboard presentation surfaces migrated to shared primitives:

- `dashboard/src/app/auth/login/page.tsx`
- `dashboard/src/app/auth/register/page.tsx`
- `dashboard/src/app/components/navbar.tsx`
- `dashboard/src/app/components/assistant-composer.tsx`
- `dashboard/src/app/components/learn-confirmation-dialog.tsx`
- `dashboard/src/app/components/learn-error-dialog.tsx`
- `dashboard/src/app/components/knowledge-terminal.tsx`
- `dashboard/src/app/components/knowledge-graph.tsx`
- `dashboard/src/app/components/garden-video-import.tsx`
- `dashboard/src/app/components/new-note-button.tsx`
- `dashboard/src/app/components/markdown-to-pdf-button.tsx`
- `dashboard/src/app/components/toast.tsx`
- `dashboard/src/app/components/usage-limits-popover.tsx`
- `dashboard/src/app/components/hermes/activity-panel.tsx`
- `dashboard/src/app/components/hermes/command-hub.tsx`
- `dashboard/src/app/components/hermes/dashboard-agent-terminal.tsx`
- `dashboard/src/app/components/hermes/evidence-panel.tsx`
- `dashboard/src/app/components/hermes/garden-agent-chat.tsx`
- `dashboard/src/app/components/hermes/garden-assistant-switch.tsx`
- `dashboard/src/app/components/hermes/skills-catalog-panel.tsx`
- `dashboard/src/app/dashboard/dashboard-client.tsx`
- `dashboard/src/app/garden/garden-assistant.tsx`
- `dashboard/src/app/garden/library-garden-client.tsx`
- `dashboard/src/app/gardens/[clusterSlug]/workspace-client.tsx`

Regression expectations and evidence:

- `dashboard/tests/assistant-message-ui.test.mjs`
- `dashboard/tests/chat-composer-neumorphism.test.mjs`
- `dashboard/artifacts/neumorphic-ui-audit-2026-07-19.md`
- `dashboard/artifacts/neumorphic-accessibility-audit.json`
- `dashboard/artifacts/neumorphic-before/`
- `dashboard/artifacts/neumorphic-after/`

## 3. Theme variables and shared primitives

Dashboard tokens added in `globals.css`:

- Surfaces: `--neu-bg`, `--neu-surface`, `--neu-surface-raised`, `--neu-surface-pressed`
- Depth colors: `--neu-highlight`, `--neu-shadow`, `--neu-shadow-soft`, `--neu-shadow-strong`, `--neu-border`, `--neu-focus`
- Geometry/motion: `--neu-radius-sm`, `--neu-radius-md`, `--neu-radius-lg`, `--neu-duration`, `--neu-easing`
- Recipes: `--neu-raised-shadow`, `--neu-soft-shadow`, `--neu-strong-shadow`, `--neu-inset-shadow`

Semantic classes added or consolidated:

- Containers: `.neu-surface`, `.neu-surface-subtle`, `.neu-surface-raised`
- Editable/selected regions: `.neu-inset`, `.neu-control`, `.neu-selected`, `.neu-segmented`, `.neu-progress-track`
- Controls: `.neu-button`, `.neu-button-primary`, `.neu-button-accent`, `.neu-button-destructive`, `.neu-button-icon`
- Floating/housing surfaces: `.neu-dialog`, `.neu-popover`, `.neu-composer`

Quartz uses equivalent `--neu-q-*` tokens derived from its existing `--light`, `--lightgray`, `--dark`, and `--secondary` variables. The selectors are scoped to known Quartz controls rather than global element selectors.

## 4. Components updated

- Authentication forms: raised paper panel, inset fields, dark primary action, password action, focus/disabled states.
- Main dashboard: nav controls, primary/secondary actions, segmented view switch, search, cluster/folder controls, collapsed and expanded terminal housing.
- Garden Chat and workspace: assistant shell, sidebar actions, message actions, attachment button, slash-command menu, skills controls, evidence and usage popovers.
- Learn and destructive flows: raised dialogs, inset guidance/error wells, clearly differentiated cancel/primary/destructive actions.
- Supporting workflows: video import, note editor, Markdown/PDF actions, toast, graph controls, progress/loading states.
- Quartz: back/search/explorer controls, Search overlay, graph housing, cluster cards, Markdown editor/actions, folder PDF dialog, Page AI housing/composer, global graph controls.

## 5. Areas intentionally left flat

- Article prose, headings, lists, code, and reading columns: depth would reduce reading calm.
- Assistant message text and user/assistant transcript rows: avoids nested-card noise.
- Terminal output and dense skill/evidence rows: borders, spacing, and typography already carry hierarchy.
- Graph nodes and canvas content: only the graph housing receives depth, preserving visual data encoding.
- Decorative navbar plants and page backgrounds: these remain part of the existing identity, not material controls.

## 6. Palette preservation

No replacement palette was introduced. All new colors are aliases or `color-mix()` derivatives of the existing Breadboard/Quartz theme variables. Measured representative contrast ratios:

- Primary text on app background: 14.38:1
- Muted text on app background: 5.62:1
- Primary text on paper: 15.69:1
- Raised text on primary button: 16.66:1
- Raised text on botanical button: 5.47:1
- Raised text on destructive button: 4.88:1

These representative combinations meet WCAG AA for normal text.

## 7. Motion and transition preservation

Existing sliding directions, panel positions, terminal resizing, toggle translations, progress motion, navigation progress, and component transition timings were not rewritten. The new depth system adds only short shadow/color transitions (`160ms`) and a one-pixel pressed affordance. `prefers-reduced-motion` removes the pressed transform and collapses decorative transitions/animations to `0.01ms`.

## 8. Accessibility checks

Automated browser probes are recorded in `dashboard/artifacts/neumorphic-accessibility-audit.json` for dashboard mobile, Garden Chat mobile, Quartz mobile, and 200%-equivalent Dashboard/Quartz viewports.

Results:

- No document-level horizontal overflow in any of the five scenarios.
- All sampled semantic tactile controls had an accessible name.
- Keyboard Tab focus produced a visible outline in every scenario.
- `prefers-reduced-motion: reduce` matched and sampled material transitions resolved to `0.01ms`.
- `forced-colors: active` matched, removed decorative shadows, and retained solid control borders.
- Focus is never encoded by shadow alone; material controls use an explicit two-pixel focus outline or the browser's visible native focus indicator.
- Disabled controls remove depth and lower opacity; destructive controls retain color, text, and placement distinctions.

## 9. Responsive routes and states checked

Screenshots and browser probes covered:

- Authentication at 1440×900.
- Main dashboard at 1440×900, 900×1000, and 390×844.
- Knowledge terminal collapsed and expanded at 1440×900.
- Garden Chat at 1440×900 and 390×844.
- Slash-command menu at 1440×900.
- Garden workspace and Learn destructive dialog at 1440×900.
- Quartz article/graph at 1440×900 and 390×844.
- Quartz Search overlay at 1440×900.
- Dashboard and Quartz at a 720×450 CSS viewport with a 2× device scale factor (a 200%-equivalent layout probe).

The Quartz mobile Search control is intentionally icon-sized, and the back link uses compact spacing so the existing dense header does not acquire horizontal scrolling.

## 10. Commands and exact results

Dashboard:

- `npx eslint <24 edited TSX files>` — passed with zero findings.
- `npx eslint tests/assistant-message-ui.test.mjs tests/chat-composer-neumorphism.test.mjs` — passed with zero findings.
- `npx tsc --noEmit` — passed.
- `npm test` — passed: 1,212 tests, 1,198 passed, 14 skipped, 0 failed.
- `npm run build` — passed with Next.js 16.2.3: compiled, TypeScript completed, and 13/13 static pages generated. Four existing Turbopack NFT tracing warnings remain around dynamic filesystem access from `next.config.ts`/`api/markdown-edit`.
- `npm run lint` — repository-wide command did not pass: 45 findings (1 error, 44 warnings). The sole error is the existing `prefer-const` finding at `src/lib/garden-build/shadow.ts:109`; the scoped edited-file lint passes.

Quartz:

- `npx tsc --noEmit` — passed.
- `npx prettier quartz/styles/custom.scss --check` — passed.
- `npm test` — passed: 98 tests, 98 passed, 0 failed/skipped.
- `npx quartz build --concurrency 1` — passed: 590 input files parsed, 58 filtered, 3,542 files emitted. Existing content produced non-fatal LaTeX Unicode/comment warnings.
- `npm run check` — TypeScript completed, then the repository-wide Prettier phase failed because 1,172 existing content/generated files need formatting. The edited stylesheet passes its scoped Prettier check.
- `npx prettier . --list-different` — confirmed exactly 1,172 files in the existing all-files formatting backlog.

## 11. Screenshot locations

- Before: `dashboard/artifacts/neumorphic-before/`
- After: `dashboard/artifacts/neumorphic-after/`

Matching filenames use identical viewports for authentication, dashboard desktop/tablet/mobile, terminal expanded, Garden Chat desktop/mobile, slash menu, workspace, Learn route, and Quartz article desktop/mobile. The after set additionally contains `quartz-search-desktop-1440x900.png`.

The automated pre-change Learn capture reached the workspace route but did not successfully open the confirmation dialog; the user's supplied Learn screenshot is the true visual baseline for that state. The after capture does show the dialog correctly.

## 12. Remaining visual inconsistencies

- The pre-existing mobile top navigation remains dense: long brand/account labels can truncate at 390px, although the document does not horizontally scroll.
- Quartz's full knowledge-map graph is inherently visually dense on mobile; the housing now matches the material system, while graph content remains deliberately unchanged.
- Some legacy feature-local controls still use existing border/hover utilities inside otherwise migrated surfaces. They remain functional and palette-consistent; converting every nested row would violate the restrained-depth requirement.
- Repository-wide lint/format backlogs remain as documented above and are outside this presentation-only change.

## 13. Functionality not manually verified

The production builds and automated suites cover Hermes, ChatMock, ingestion, Learn, Quartz, permission-client, and generic lifecycle code paths, but this visual pass intentionally did not execute destructive or externally dependent live actions. Specifically:

- Real Clear Learn/Rebuild/Delete mutations were not submitted.
- A live Hermes permission request and error dialog were not forced against an external session.
- A real video ingestion/Scriberr/Reader job and document upload were not started.
- New-note save, Markdown/PDF export, and remote ChatMock responses were not submitted manually.
- Hover behavior was source-reviewed; keyboard, reduced-motion, forced-colors, responsive overflow, and the captured click-open states were exercised in the browser.

The local dashboard dev server was restarted after validation and remains available on port 3000. Temporary Quartz screenshot/audit servers were stopped.
