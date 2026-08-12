# Trace to source

Internal first-party workflow. This is an agent-profile instruction, not a
public skills.sh catalog entry or an installable slash command.

Procedure for grounding a claim in its original source.

1. Locate the statement with `garden_get_page` / `garden_search`.
2. Read the page's `sourceAnchors` and use `garden_get_source_excerpt` /
   `garden_get_source_figure` to pull the original source material.
3. Compare the claim to the source. Report the source title, the location
   (page/section), and the exact excerpt that supports (or fails to support) the
   claim.
4. If the claim is not supported by any cited source, say so plainly and suggest
   proposing a correction through the internal page-revision workflow.

Always cite the specific source anchor, not just the garden.
