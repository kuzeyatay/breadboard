---
name: breadboard-propose-page-revision
description: Draft and submit a typed proposal to revise a Breadboard page. Never edits published markdown directly — produces a reviewable proposal. Use when a reader identifies a mistake or improvement.
---

# Propose a page revision

Procedure for proposing (never applying) a page change.

1. Confirm the issue: retrieve the page with `garden_get_page` and trace the
   questionable claim to its source (see `breadboard-trace-source`).
2. Validate the target with `garden_run_proposal_validation` to confirm the page
   exists and a revision (rather than a new note) is appropriate.
3. Draft the revision. Prepare:
   - `pageSlug`: the page to revise
   - `patchOrReplacement`: the corrected markdown
   - `rationale`: why the change is warranted, referencing evidence
   - `evidenceAnchorIds`: the source anchors that support the change
4. Submit with `garden_propose_page_revision`. Tell the reader a proposal was
   created and that THEY apply it through Breadboard after reviewing the diff and
   validators. You never publish it yourself.
