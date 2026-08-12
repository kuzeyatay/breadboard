# Propose a page revision

Internal first-party workflow. This is an agent-profile instruction, not a
public skills.sh catalog entry or an installable slash command.

Procedure for proposing (never applying) a page change.

1. Confirm the issue: retrieve the page with `garden_get_page` and trace the
   questionable claim to its source using the internal source-tracing workflow.
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
