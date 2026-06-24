---
title: "Worked Reduction with Inner Feedback and Parallel Feedforward"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 99", "Page 100"]
related: ["standard-negative-and-positive-feedback-transfer-functions", "block-diagram-reduction-rules", "parallel-subtraction-in-block-diagrams", "worked-reduction-with-h1-h2-h3-feedback-paths"]
tags: ["block-diagram-reduction", "negative-unity-feedback", "parallel", "g-1g-2", "g-3", "g-4"]
---

## Worked Reduction with Inner Feedback and Parallel Feedforward

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 99, Page 100

Pages 99 and 100 present a block diagram reduction example with an input $R$, an inner negative feedback loop around the cascade $G_1G_2$, a parallel feedforward path $G_3$, and an outer negative feedback path $G_4$. The inner loop around $G_1G_2$ is first reduced using the negative feedback formula, giving $G_1G_2/(1+G_1G_2)$. This reduced forward path is then in parallel with $G_3$, so the equivalent forward transfer becomes $G_1G_2/(1+G_1G_2)+G_3$. Finally, this combined forward block lies inside an outer negative feedback loop with feedback transfer $G_4$. Applying the standard feedback formula gives the equivalent closed-loop transfer function from $R$ to $Y$ as the combined forward block divided by $1$ plus the product of the combined forward block and $G_4$.

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

#### Page 100

1 solution

negative unity feedback

[Diagram]
R enters a summing junction with a negative feedback input from the output path.
Forward path has an inner negative feedback loop around block G1G2.
A block G3 is in parallel on the upper path.
A block G4 is on the lower feedback path.
Output at the right is Y.

=>

Parallels

[Diagram]
Input enters summing junction (+ at upper input, - at lower input).
Three parallel forward paths:
G3 on top,
G1G2 / (1 + G1G2) in the middle,
G4 on bottom.
All meet at an output summing junction leading to Y.

=>

[Diagram]
R enters a summing junction (+ input from R, - feedback from output through G4).
Forward block:
G1G2 / (1 + G1G2) + G3
Output marked X.

negative feedback

=>

[Equivalent transfer function block]
R  ->  [ (G1G2 / (1 + G1G2) + G3) / (1 + (G1G2 / (1 + G1G2) + G3)G4) ]  ->  Y


Now simplify the system below, and find the equivalent transfer function

[Original block diagram]
Input enters first summing junction with three + signs:
+ input from left,
+ feedback from lower path through H2,
+ [unclear] input from vertical branch.

Then signal enters second summing junction with + from left and - feedback from lower branch H1.

Forward path

[Truncated for analysis]

### Key points

- The inner negative feedback loop around $G_1G_2$ reduces to $G_1G_2/(1+G_1G_2)$.
- The reduced inner-loop path is placed in parallel with $G_3$.
- The equivalent forward transfer is $G_1G_2/(1+G_1G_2)+G_3$.
- The outer feedback block is $G_4$.
- The final transfer function uses the negative feedback denominator $1+(	ext{forward})G_4$.

### Related topics

- [[standard-negative-and-positive-feedback-transfer-functions|Standard Negative and Positive Feedback Transfer Functions]]
- [[block-diagram-reduction-rules|Block Diagram Reduction Rules]]
- [[parallel-subtraction-in-block-diagrams|Parallel Subtraction in Block Diagrams]]
- [[worked-reduction-with-h1-h2-h3-feedback-paths|Worked Reduction with H1 H2 H3 Feedback Paths]]

### Relationships

- depends-on: [[standard-negative-and-positive-feedback-transfer-functions|Standard Negative and Positive Feedback Transfer Functions]]
