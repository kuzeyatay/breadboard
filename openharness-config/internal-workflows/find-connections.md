# Find connections

Internal first-party workflow. This is an agent-profile instruction, not a
public skills.sh catalog entry or an installable slash command.

Procedure for surfacing meaningful relationships in a garden.

1. Retrieve the starting node(s) with `garden_get_page` and their graph edges
   with `garden_get_graph_neighbors`.
2. For candidate connections, retrieve each neighbor's context and confirm the
   relationship is real (shared concepts, prerequisite/dependency, contrast, or
   citation) — do not assert a link the graph and content do not support.
3. Present each connection as: the two endpoints, the relationship type, and one
   grounded sentence explaining why they connect, with citations.
4. Prefer connections that cross documents or sections; note contradictions if
   two grounded sources disagree.
