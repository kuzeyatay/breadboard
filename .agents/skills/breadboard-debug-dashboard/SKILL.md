---
name: breadboard-debug-dashboard
description: Debug the Breadboard Next.js dashboard — locate a failing route/component, reproduce with a focused test or dev run, and propose a fix. Terminal-only; requires repo access and permissioned commands.
---

# Debug the dashboard

Procedure for diagnosing a Breadboard dashboard issue. This is a terminal-only
skill; it uses repo inspection and permissioned commands.

1. Reproduce: identify the failing surface (route under `dashboard/src/app/api`,
   or a component under `dashboard/src/app/components`). Read the relevant files.
2. Narrow: run the focused test that covers the area
   (`node --test --experimental-strip-types dashboard/tests/<file>.test.mjs`) or a
   scoped typecheck (`npx tsc --noEmit`). These are read-only/focused and safe.
3. Inspect logs and `git diff` to see recent changes near the failure.
4. Form a hypothesis and propose the smallest fix. Show the diff BEFORE applying;
   applying an edit requires explicit approval.
5. Re-run the focused test to confirm the fix. Never broaden scope or run
   destructive commands without approval.

Follow `dashboard/AGENTS.md`: read the installed Next.js docs under
`dashboard/node_modules/next/dist/docs/` before changing route code.
