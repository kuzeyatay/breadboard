<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Adding a runtime agent

Read `docs/ADDING_AN_AGENT.md` first. It covers the wiring (identity, run manager,
routes, run-kind registry, inline card, palette, settings) and the two promises the
shared tests enforce for every agent at once: a run card that survives a reload, and
artifacts that belong to the chat that made them.
