# Breadboard neumorphic UI audit

Date: 2026-07-19

## Principal routes and regression states

- `/auth/login` and `/auth/register`: field, focus, password reveal, error, loading, and disabled states.
- `/dashboard`: navbar, target switch, garden-view segmented control, search, empty state, cluster cards/actions, background control, create/edit/upload dialogs, and terminal collapsed/expanded states.
- `/garden`: library frame loading/error states and Quartz-owned navigation.
- `/garden/:cluster/chat`: Garden header, Quartz frame, assistant panel, composer, command hub, skills/MCP/prompt tabs, dropdowns, and mobile assistant layout.
- `/gardens/:cluster`: workspace header, chat history, assistant messages, source/link/video panels, graph controls, Learn panel, destructive confirmation, validation error dialog, and responsive sidebars.
- Quartz `/`: reading layout, dashboard back link, search/search overlay, explorer, home graph housing, cluster cards, page graph controls, popovers, Markdown actions/editor, folder PDF dialog, and Page AI controls.

Baseline screenshots are stored in `dashboard/artifacts/neumorphic-before/` at desktop (1440×900), tablet (900×1000), and mobile (390×844) viewports. Matching output is stored in `dashboard/artifacts/neumorphic-after/`.

## Repeated patterns found

- Pale-green base pages with warm paper cards and charcoal/botanical controls.
- Repeated bordered paper buttons with local hover rules but no shared pressed/depth state.
- Repeated `bg-gray-900`/`bg-gray-950` form fields that map to the light palette but lacked a shared inset treatment.
- Several unrelated `shadow-xl`, `shadow-2xl`, and one-off arbitrary shadows on dialogs, command menus, toasts, assistant panels, and Quartz popovers.
- A bespoke `.neumorphic-chat-bar` recipe that was not shared with other composers or controls.
- Stable `rounded-md` through `rounded-2xl` conventions; these are preserved rather than globally increased.
- Existing motion is component-local: terminal boot reveal/conceal, panel width/position transitions, Quartz mobile explorer translation, popover opacity, progress animation, toggle thumb translation, and navigation progress. None requires a direction or timing rewrite.

## Hierarchy decisions

- Raised: navbar separation, garden cards, terminal/assistant housings, auth panels, meaningful control panels, graph housings, dialogs, and popovers.
- Inset: fields, search, composers, segmented tracks, selected rows, progress tracks, and guidance/status wells.
- Strongest depth: dialogs and floating command/search/popover surfaces only.
- Flat by design: article prose, Markdown headings/lists, terminal output lines, assistant paragraphs, graph canvases, dense table/list rows, skill audit file rows, and source text. These areas rely on borders, spacing, and typography for readability.

## Risks checked during implementation

- Fixed and sliding panels retain their original positioning and transition classes.
- Shadows are shallow enough not to create horizontal overflow at 390 px.
- Graph shadows are applied to housings, never to canvas nodes.
- Focus remains border-plus-outline based rather than shadow-only.
- Reduced-motion and forced-colors fallbacks remove transforms and decorative shadows.
- Destructive controls retain distinct danger color and confirmation prominence.
