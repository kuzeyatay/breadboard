---
title: "Reduction Example with Numeric Transfer Functions"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 103"]
related: ["standard-negative-and-positive-feedback-transfer-functions", "block-diagram-reduction-rules", "parallel-subtraction-in-block-diagrams"]
tags: ["transfer-function", "positive-feedback", "g-1", "g-2", "g-3", "g-4"]
---

## Reduction Example with Numeric Transfer Functions

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 103

Page 103 gives a block diagram reduction problem with specified transfer functions $G_1=(s+2)/(s+3)$, $G_2=2/(s+2)$, $G_3=3/(s+3)$, and $G_4=s/(s+3)$. The structure has a positive inner feedback path through $G_2$ around $G_1$ and an outer negative feedback path formed by the parallel sum of $G_3$ and $G_4$. The inner positive feedback loop is reduced using the positive-feedback denominator, giving an equivalent forward block $G_1/(1-G_1G_2)$. The outer feedback path combines $G_3$ and $G_4$ as $G_3+G_4$ because both enter the lower summing junction positively before feeding the negative input of the first summing junction. The final equivalent transfer function is the inner equivalent forward block divided by $1$ plus its product with the outer feedback block.

### Page-grounded details

#### Page 103

ex/ Simplify the system below and find the equivalent transfer function

[Block diagram description:
Input `R` enters a summing junction with `+` on the input from `R` and `-` on a lower feedback input. The output goes to a second summing junction with `+` on the left input and `+` on a lower input. This then goes through block `G1` to output `Y`. From the output line, a branch feeds back left through block `G2` into the lower `+` input of the second summing junction. The same output line also branches downward to two parallel feedback paths through blocks `G3` and `G4`, both feeding a lower summing junction marked `+` and `+`; its output feeds upward into the `-` input of the first summing junction.]

`G1 = (s+2)/(s+3)`

`G2 = 2/(s+2)`

`G3 = 3/(s+3)`

`G4 = s/(s+3)`


down solution

[Reduced block diagram description:
Input `R` enters a summing junction with `+` on the input and `-` on the lower feedback input. Forward path block is `G1/(1 - G1G2)` leading to output `Y`. Feedback path from `Y` returns through block `G3 + G4` into the negative input of the summing junction.]

->

[Equivalent single-block diagram description:
Input `R` passes through one block to output `Y`. The bl

[Truncated for analysis]

### Key points

- The given transfer functions are $G_1=(s+2)/(s+3)$, $G_2=2/(s+2)$, $G_3=3/(s+3)$, and $G_4=s/(s+3)$.
- The inner loop with $G_2$ is positive feedback around $G_1$.
- The reduced inner forward block is $G_1/(1-G_1G_2)$.
- The outer feedback path combines as $G_3+G_4$.
- The final equivalent form is $\frac{G_1/(1-G_1G_2)}{1+(G_1/(1-G_1G_2))(G_3+G_4)}$.

### Related topics

- [[standard-negative-and-positive-feedback-transfer-functions|Standard Negative and Positive Feedback Transfer Functions]]
- [[block-diagram-reduction-rules|Block Diagram Reduction Rules]]
- [[parallel-subtraction-in-block-diagrams|Parallel Subtraction in Block Diagrams]]

### Relationships

- depends-on: [[standard-negative-and-positive-feedback-transfer-functions|Standard Negative and Positive Feedback Transfer Functions]]
