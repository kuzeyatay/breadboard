# Explain from first principles

Internal first-party workflow. This is an agent-profile instruction, not a
public skills.sh catalog entry or an installable slash command.

Procedure for grounded, bottom-up explanation using a garden's material.

1. Identify the target concept and, using `garden_search` (or `garden_get_page`),
   retrieve the garden's own definition and the sources it cites.
2. Decompose the concept into its prerequisite ideas. For each prerequisite,
   retrieve the garden's grounded content with `garden_get_page_context` and note
   the source anchors.
3. Build the explanation from the simplest assumption upward. At each step, state
   what is assumed, what is derived, and cite the page/source it comes from.
4. If a prerequisite is missing from the garden, say so explicitly rather than
   filling the gap with ungrounded knowledge.
5. End with a one-paragraph synthesis that connects the pieces, and list the
   sources used.

Never invent facts the garden does not contain. Prefer the garden's own notation
and terminology.
