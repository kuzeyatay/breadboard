---
title: "Worked Reduction with Nested Feedback and Bypass Path"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 101", "Page 102"]
related: ["block-diagram-reduction-rules", "worked-reduction-with-h1-h2-h3-feedback-paths", "standard-negative-and-positive-feedback-transfer-functions", "parallel-subtraction-in-block-diagrams"]
tags: ["block-diagram-reduction", "bypass-path", "h-1", "h-2", "h-3", "g-3"]
---

## Worked Reduction with Nested Feedback and Bypass Path

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 101, Page 102

Pages 101 and 102 solve a diagram containing forward blocks $G_1$, $G_2$, $G_3$, feedback blocks $H_1$, $H_2$, $H_3$, and a bypass path around $G_2$. The feedback around $G_3$ with $H_3$ is first reduced to $G_3/(1+G_3H_3)$. The bypass and $G_2$ paths combine as $1/G_2+1$ after moving the branch relative to $G_2$. The lower feedback paths are converted into parallel feedback terms $H_2/G_1$ and $H_1$, which then combine as $H_2/G_1+H_1$. The forward block $G_1G_2$ under this combined negative feedback becomes $G_1G_2/[1+G_1G_2(H_2/G_1+H_1)]$. Cascading this with $(1/G_2+1)G_3/(1+G_3H_3)$ simplifies to the final equivalent transfer function $G_1G_3(1+G_2)/[(1+G_2H_2+G_2G_1H_1)(1+G_3H_3)]$.

### Page-grounded details

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

#### Page 102

Solution

[Diagram: Block diagram reduction for a control system.]

Top diagram:
R enters a summing junction with + on the R input and - on the lower feedback input.
Output goes through block G1, then to a summing junction.
A curved arrow labeled "Solution" points toward this region.
At the second summing junction: + input from G1, - input from lower path.
Output goes through block G2.
Output of G2 goes to a summing junction with + input from G2 and + input from an upper bypass path.
The upper bypass path branches before G2 and goes around G2 to the final summing junction.
Output goes through block:

G3 / (1 + G3 H3)

then output Y.

A feedback block H2 is connected from the output of G2 back to the negative input of the second summing junction.
A lower feedback path with block H1 returns from the output of G2 region back to the negative input of the first summing junction.

->

[Second diagram: reduced block diagram.]
R enters first summing junction with + from R and - from lower feedback.
Then goes to a second summing junction with + from left and - from lower feedback.
Then block:

G1 G2

Output branches downward to two feedback paths and forward to block:

1/G2 + 1

then to blo

[Truncated for analysis]

### Key points

- The $G_3$ loop with $H_3$ reduces to $G_3/(1+G_3H_3)$.
- The bypass around $G_2$ becomes the factor $1/G_2+1$.
- The lower feedback paths combine in parallel as $H_2/G_1+H_1$.
- The $G_1G_2$ section reduces to $G_1G_2/[1+G_1G_2(H_2/G_1+H_1)]$.
- The final simplified transfer function is $G_1G_3(1+G_2)/[(1+G_2H_2+G_2G_1H_1)(1+G_3H_3)]$.

### Related topics

- [[block-diagram-reduction-rules|Block Diagram Reduction Rules]]
- [[worked-reduction-with-h1-h2-h3-feedback-paths|Worked Reduction with H1 H2 H3 Feedback Paths]]
- [[standard-negative-and-positive-feedback-transfer-functions|Standard Negative and Positive Feedback Transfer Functions]]
- [[parallel-subtraction-in-block-diagrams|Parallel Subtraction in Block Diagrams]]

### Relationships

- depends-on: [[block-diagram-reduction-rules|Block Diagram Reduction Rules]]
