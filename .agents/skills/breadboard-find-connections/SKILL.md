---
name: breadboard-find-connections
description: Find and explain connections between notes, concepts, or sections within a Breadboard garden using its knowledge graph. Use when a reader asks how two ideas relate or wants to discover related material.
---

# Find connections

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
