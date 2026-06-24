---
title: "Worked Reduction with H1 H2 H3 Feedback Paths"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 100", "Page 101"]
related: ["block-diagram-reduction-rules", "standard-negative-and-positive-feedback-transfer-functions", "parallel-subtraction-in-block-diagrams", "worked-reduction-with-nested-feedback-and-bypass-path"]
tags: ["block-diagram-reduction", "h-1", "h-2", "h-3", "g-5", "positive-feedback"]
---

## Worked Reduction with H1 H2 H3 Feedback Paths

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 100, Page 101

Pages 100 and 101 contain a more complex reduction with forward blocks $G_1$, $G_2$, $G_3$, $G_4$, $G_5$ and feedback paths $H_1$, $H_2$, and $H_3$. The solution first reduces the local negative feedback around $G_1G_2$ with $H_1$, producing $G_1G_2/(1+G_1G_2H_1)$. The next feedforward combination is reduced to $(G_3-G_4)$, then cascaded with $G_5$. The feedback through $H_3$ around this section gives $((G_3-G_4)G_5)/(1+(G_3-G_4)G_5H_3)$. The remaining feedback through $H_2$ is transformed into an equivalent path $H_2/G_5$ around the product of the two reduced forward blocks. Because this outer loop is positive in the final expression, the denominator is $1$ minus the loop product. The final equivalent transfer function is written as a product of the two reduced forward sections divided by $1$ minus that product times $H_2/G_5$.

### Page-grounded details

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

#### Page 101

[Top block diagram]

R -> (+) summing junction -> block: G1G2 / (1 + G1G2H1) -> (- at next summing junction, + from left) -> block: (G3 - G4) -> block: G5 -> Y

Feedback from output Y loops upward through block H3 and enters the second summing junction with negative sign.

Feedback from output Y loops downward through block H2 / G1 and enters the first summing junction with positive sign.

->

[Second equivalent block diagram]

R -> (+) summing junction, feedback negative from below -> block: G1G2 / (1 + G1G2H1) -> block: ((G3 - G4)G5) / (1 + (G3 - G4)G5H3) -> X

Feedback from X loops downward through block H2 / G5 and returns to the summing junction with negative sign.

[Final equivalent transfer function block]

R -> large block -> Y

Large block contains:

\[
\frac{
\left(\frac{G_1G_2}{1+G_1G_2H_1}\right)
\left(\frac{(G_3-G_4)G_5}{1+(G_3-G_4)G_5H_3}\right)
}{
1-
\left(\frac{G_1G_2}{1+G_1G_2H_1}\right)
\left(\frac{(G_3-G_4)G_5}{1+(G_3-G_4)G_5H_3}\right)
\frac{H_2}{G_5}
}
\]

Now simplify the system below and find the equivalent transfer function

[Bottom block diagram]

R -> first summing junction:
- R enters with + sign.
- Feedback from lower path enters with - sign.

First summ

[Truncated for analysis]

### Key points

- The first local feedback section reduces to $G_1G_2/(1+G_1G_2H_1)$.
- The feedforward combination after the first section reduces to $(G_3-G_4)$.
- The second feedback section reduces to $((G_3-G_4)G_5)/(1+(G_3-G_4)G_5H_3)$.
- The $H_2$ feedback path is transformed to $H_2/G_5$ in the final equivalent diagram.
- The final denominator uses $1-$ because the final outer feedback is represented as positive feedback in the reduced expression.

### Related topics

- [[block-diagram-reduction-rules|Block Diagram Reduction Rules]]
- [[standard-negative-and-positive-feedback-transfer-functions|Standard Negative and Positive Feedback Transfer Functions]]
- [[parallel-subtraction-in-block-diagrams|Parallel Subtraction in Block Diagrams]]
- [[worked-reduction-with-nested-feedback-and-bypass-path|Worked Reduction with Nested Feedback and Bypass Path]]

### Relationships

- depends-on: [[block-diagram-reduction-rules|Block Diagram Reduction Rules]]
