---
title: "Block Diagram Reduction Rules"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 99"]
related: ["parallel-subtraction-in-block-diagrams", "standard-negative-and-positive-feedback-transfer-functions", "worked-reduction-with-inner-feedback-and-parallel-feedforward", "worked-reduction-with-h1-h2-h3-feedback-paths", "worked-reduction-with-nested-feedback-and-bypass-path"]
tags: ["block-diagram-reduction", "takeoff-point", "summing-junction", "g-s", "transfer-function"]
---

## Block Diagram Reduction Rules

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 99

Block diagram reduction uses algebraic transformations that preserve signal relationships while rearranging takeoff points and summing junctions into forms that are easier to solve. Page 99 emphasizes that when a signal departs from a point, the takeoff point can be moved across a block if a compensating block is inserted. If a takeoff originally before $G(s)$ is moved after $G(s)$ but must still represent the original input $U(s)$, the branch must include $1/G(s)$. Conversely, if an output takeoff after $G(s)$ is moved before the block but must still represent $Y(s)$, the branch must include $G(s)$. Summing junctions can also be moved across blocks. Moving a summing junction ahead of a block requires multiplying each input branch by $G(s)$; moving it behind the block requires dividing the bypassed input by $G(s)$. These rules allow complex diagrams to be reduced through series, parallel, and feedback equivalents.

### Page-grounded details

#### Page 99

Block diagram reduction:

- Basic idea is the point where a signal departs, we can move them
to make a structure easier to solve.

[Diagram: signal U(s) enters a takeoff point before block G(s); the main path goes through G(s) to Y(s), and a branch labeled U(s) leaves downward before the block.]
=>
[Diagram: U(s) goes through block G(s) to Y(s); from the output/takeoff point a feedback branch goes downward through block 1/G(s) and returns leftward, labeled U(s).]
arrow or  -> block by G

[Diagram: U(s) goes through block G(s) to Y(s); from output Y(s) a branch/takeoff goes downward and leftward labeled Y(s).]
=>
[Diagram: U(s) has a takeoff before block G(s); branch goes downward through block G(s) and leftward labeled Y(s), while main path continues through G(s) to Y(s).]
Delete or multiply G

[Diagram: U1(s) and U2(s) enter a summing junction Σ; U1(s) marked +, U2(s) marked -. Output goes through block G(s) to Y(s).]
=>
[Diagram: U1(s) goes through block G(s) to the + input of a summing junction Σ; U2(s) goes through block G(s) to the - input of the same summing junction; output is Y(s).]
Ahead a block multiply by G

[Diagram: U1(s) goes through block G(s) to the + input of summi

[Truncated for analysis]

### Key points

- Moving a takeoff point across a block requires compensating by $G(s)$ or $1/G(s)$.
- A branch that must preserve pre-block signal $U(s)$ after crossing $G(s)$ uses $1/G(s)$.
- A branch that must preserve post-block signal $Y(s)$ before crossing $G(s)$ uses $G(s)$.
- Moving a summing junction ahead of a block multiplies affected inputs by $G(s)$.
- Moving a summing junction behind a block divides affected inputs by $G(s)$.
- These rules are used to simplify nested feedback and parallel feedforward diagrams.

### Related topics

- [[parallel-subtraction-in-block-diagrams|Parallel Subtraction in Block Diagrams]]
- [[standard-negative-and-positive-feedback-transfer-functions|Standard Negative and Positive Feedback Transfer Functions]]
- [[worked-reduction-with-inner-feedback-and-parallel-feedforward|Worked Reduction with Inner Feedback and Parallel Feedforward]]
- [[worked-reduction-with-h1-h2-h3-feedback-paths|Worked Reduction with H1 H2 H3 Feedback Paths]]
- [[worked-reduction-with-nested-feedback-and-bypass-path|Worked Reduction with Nested Feedback and Bypass Path]]

### Relationships

- applies-to: [[worked-reduction-with-inner-feedback-and-parallel-feedforward|Worked Reduction with Inner Feedback and Parallel Feedforward]]
- applies-to: [[worked-reduction-with-h1-h2-h3-feedback-paths|Worked Reduction with H1 H2 H3 Feedback Paths]]
- applies-to: [[worked-reduction-with-nested-feedback-and-bypass-path|Worked Reduction with Nested Feedback and Bypass Path]]
