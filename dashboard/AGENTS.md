<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Loading feedback

Use the existing blue progress bar at the top for navigation and browser startup.
Keep the normal page and browser controls visible while loading. Do not replace
them with a loading screen, centered spinner card, or “Starting/Opening” message.
Show actual failures inline with retry actions.

# Failed chat responses

Keep failed and stopped assistant messages in the normal response layout:
thinking above, the error as response text, and the full existing bottom action
row. Regeneration belongs in that action row. Do not add a separate failure
notice, text Retry button, or Details disclosure.

# Adding a runtime agent

Read `docs/ADDING_AN_AGENT.md` first. It covers the wiring (identity, run manager,
routes, run-kind registry, inline card, palette, settings) and the two promises the
shared tests enforce for every agent at once: a run card that survives a reload, and
artifacts that belong to the chat that made them.
